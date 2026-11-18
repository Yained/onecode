import net from "node:net"
import http from "node:http"
import { randomInt } from "node:crypto"
import type { ConfigSSH } from "@/config/ssh"
import { sshBaseArgs } from "@/onescience/modelscope-download-ssh"
import type { ModelScopeDownloadSshConfig } from "@/onescience/modelscope-download-store"
import { spawnSshProcess, runSshProcess } from "@/util/ssh-cli"
import { encodeMarker, MARKER_NAME, type SshNodeMarker } from "./ssh-node-path"

const PASSTHROUGH_ENV = [
  "OPENCODE_AUTH_CONTENT",
  "OPENCODE_CONFIG",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_RESOURCE_ATTRIBUTES",
] as const

export function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function sshPassword(config: ConfigSSH.Info) {
  return config.auth?.type === "password" ? config.auth.password : undefined
}

function sshConfig(config: ConfigSSH.Info): ModelScopeDownloadSshConfig {
  return config
}

export function sshExecArgs(config: ConfigSSH.Info, opts?: { allowStdin?: boolean }) {
  const base = sshBaseArgs(sshConfig(config))
  const args = opts?.allowStdin ? base.filter((item) => item !== "-n") : base
  return [...args, config.hostName || config.host]
}

export type RunRemoteOptions = {
  /**
   * Login shell (`bash -lc`) sources bashrc so conda / module / `onecode` resolve.
   * Health probes must skip this — scnet login-node bashrc often exceeds the poll budget.
   */
  login?: boolean
}

function remoteBash(command: string, login = true) {
  return login ? `bash -lc ${shellQuote(command)}` : `bash --noprofile --norc -c ${shellQuote(command)}`
}

export async function runRemote(config: ConfigSSH.Info, command: string, timeout = 20_000, opts?: RunRemoteOptions) {
  const result = await runSshProcess([...sshExecArgs(config), remoteBash(command, opts?.login !== false)], {
    nothrow: true,
    timeout,
    abort: AbortSignal.timeout(Math.max(1_000, timeout + 1_000)),
    password: sshPassword(config),
  })
  return {
    code: result.code,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

/** Write a remote file via SSH stdin so secrets never appear in `ps` argv. */
export async function writeRemoteFile(config: ConfigSSH.Info, remoteFile: string, contents: string, timeout = 15_000) {
  const abort = AbortSignal.timeout(timeout)
  const child = spawnSshProcess(
    [
      ...sshExecArgs(config, { allowStdin: true }),
      remoteBash(`cat > ${shellQuote(remoteFile)} && chmod 600 ${shellQuote(remoteFile)} 2>/dev/null || true`, false),
    ],
    {
      password: sshPassword(config),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      abort,
    },
  )
  try {
    child.stdin?.end(contents, "utf8")
  } catch {
    child.stdin?.end()
  }
  const code = await child.exited
  if (code !== 0) {
    throw new Error("无法写入远端文件")
  }
}

export async function pickLocalPort() {
  for (let i = 0; i < 20; i++) {
    const port = randomInt(20_000, 49_000)
    const free = await new Promise<boolean>((resolve) => {
      const server = net.createServer()
      server.once("error", () => resolve(false))
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(true))
      })
    })
    if (free) return port
  }
  throw new Error("无法在本机分配 SSH 隧道端口")
}

/** Remote bind port chosen on A. scnet SSH may land on a different node than the last probe. */
export function pickEphemeralPort() {
  return randomInt(20_000, 49_000)
}

export const LEASE_NAME = ".onescience-lease"
/** Generous so a failed connect / brief NFS stall can reconnect and reuse before the leaf exits. */
export const LEASE_TTL_SECONDS = 180
export const LEASE_TTL_MS = LEASE_TTL_SECONDS * 1000
export const LEASE_HEARTBEAT_MS = 30_000
export const LEASE_WATCHDOG_POLL_SECONDS = 5
/** Client UI budget. Must cover preflight + spawn + health + leaf init. */
export const CONNECT_TIMEOUT_MS = 360_000
export const SSH_SERVER_ALIVE_INTERVAL = 60
export const SSH_SERVER_ALIVE_COUNT_MAX = 8
export const REMOTE_HOME_SCRIPT = 'printf %s "${HOME:-}"'

export function servePidFile(remotePath: string) {
  return `${remotePath.replace(/\/+$/, "")}/.onescience-serve.pid`
}

export function leaseFile(remotePath: string) {
  return `${remotePath.replace(/\/+$/, "")}/${LEASE_NAME}`
}

export function leaseWatchdogPidFile(remotePath: string) {
  return `${remotePath.replace(/\/+$/, "")}/.onescience-lease.pid`
}

export function keepaliveScriptFile(remotePath: string) {
  return `${remotePath.replace(/\/+$/, "")}/.onescience-keepalive.sh`
}

export function keepaliveOwnerFile(remotePath: string) {
  return `${remotePath.replace(/\/+$/, "")}/.onescience-keepalive.owner`
}

function remotePortPidsCommand(port: number) {
  // Port holders only — no /proc cmdline walks (login nodes have huge /proc).
  return [
    `(command -v fuser >/dev/null && fuser 127.0.0.1:${port}/tcp 2>/dev/null)`,
    `(command -v lsof >/dev/null && lsof -ti 127.0.0.1:${port} 2>/dev/null)`,
    `(command -v ss >/dev/null && ss -lptn src 127.0.0.1:${port} 2>/dev/null | sed -n 's/.*pid=\\([0-9][0-9]*\\).*/\\1/p')`,
  ].join(" || ")
}

function uniquePidList(command: string) {
  return `${command} 2>/dev/null | tr -cs '0-9' '\\n' | grep -E '^[0-9]+$' | grep -v "^$$" | grep -v "^$PPID$" | sort -u || true`
}

function remotePidFileCommand(remotePath: string) {
  const file = servePidFile(remotePath)
  return `if [ -f ${shellQuote(file)} ]; then pid=$(tr -d '[:space:]' < ${shellQuote(file)}); if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo "$pid"; fi; fi`
}

/**
 * Lean PID discovery for login nodes: pidfile only.
 * Never `ps` / fuser / lsof here — those hang on busy shared login nodes and
 * leave huge `bash -lc …` argv visible in `ps` for minutes during abort cleanup.
 */
export function remoteWorkspacePidsCommand(
  workspaceID: string,
  opts?: { remotePath?: string; port?: number },
) {
  void workspaceID
  void opts?.port
  if (opts?.remotePath) return uniquePidList(`( ${remotePidFileCommand(opts.remotePath)} )`)
  return "true"
}

/**
 * Leaf serves for this remote project directory — pidfile only.
 */
export function remotePathLeafPidsCommand(remotePath: string, port?: number) {
  void port
  return uniquePidList(`( ${remotePidFileCommand(remotePath)} )`)
}

export function remotePickPortScript() {
  return [
    "python3 -c 'import socket;s=socket.socket();s.bind((\"127.0.0.1\",0));print(s.getsockname()[1]);s.close()'",
    "|| python -c 'import socket;s=socket.socket();s.bind((\"127.0.0.1\",0));print(s.getsockname()[1]);s.close()'",
  ].join(" ")
}

export function remoteStartServeScript(input: {
  remotePath: string
  workspaceID: string
  port: number
  marker: SshNodeMarker
  env?: Record<string, string | undefined>
  controlPlaneUrl?: string
  /** Shared-storage lease token so a serve on another login node exits. */
  leaseToken?: string
}) {
  const remotePath = input.remotePath
  const logFile = `${remotePath}/.onescience-serve.log`
  const markerFile = `${remotePath}/${MARKER_NAME}`
  const dbFile = `${remotePath}/.opencode-db/opencode.db`
  const authFile = `${remotePath}/.opencode-auth.json`
  const marker = encodeMarker(input.marker)
  const env = [
    `OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY=${shellQuote(remotePath)}`,
    `OPENCODE_WORKSPACE_ID=${shellQuote(input.workspaceID)}`,
    "OPENCODE_EXPERIMENTAL_WORKSPACES=true",
    "OPENCODE_TERMINAL_ISOLATION=native",
    `OPENCODE_HOT_RELOAD=false`,
    `OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER=true`,
    `OPENCODE_EXPERIMENTAL_FILEWATCHER=false`,
    `OPENCODE_DB=${shellQuote(dbFile)}`,
    `OPENCODE_AUTH_CONTENT=$(cat ${shellQuote(authFile)} 2>/dev/null || true)`,
    ...(input.controlPlaneUrl ? [`ONECODE_CONTROL_PLANE_URL=${shellQuote(input.controlPlaneUrl)}`] : []),
    ...(input.leaseToken ? [`OPENCODE_SSH_LEASE_TOKEN=${shellQuote(input.leaseToken)}`] : []),
    ...PASSTHROUGH_ENV.filter((key) => key !== "OPENCODE_AUTH_CONTENT" && input.env?.[key]).map(
      (key) => `${key}=${shellQuote(input.env![key]!)}`,
    ),
  ].join(" ")
  const start = `cd ${shellQuote(remotePath)} && ${env} exec onecode serve --hostname 127.0.0.1 --port ${input.port}`
  const pidFile = servePidFile(remotePath)
  return [
    `mkdir -p ${shellQuote(`${remotePath}/.opencode-db`)}`,
    `printf %s ${shellQuote(marker)} > ${shellQuote(markerFile)}`,
    `chmod 600 ${shellQuote(markerFile)} 2>/dev/null || true`,
    input.leaseToken
      ? `printf %s ${shellQuote(input.leaseToken)} > ${shellQuote(leaseFile(remotePath))}`
      : `touch ${shellQuote(leaseFile(remotePath))}`,
    `bash --noprofile --norc -c ${shellQuote(start)} > ${shellQuote(logFile)} 2>&1 < /dev/null & echo $! | tee ${shellQuote(pidFile)}`,
  ].join("; ")
}

function remoteSafeKillPidfileBody(remotePath: string, port?: number) {
  const pf = servePidFile(remotePath)
  const pathNeedle = remotePath.replace(/\/+$/, "")
  const portNeedle = port && port > 0 ? `--port ${port}` : ""
  // Shared pidfile is visible on every login node. Only kill when /proc/$pid on
  // THIS node is our onecode serve (same-node leftover). Otherwise leave it for
  // the in-process lease watchdog on the node that actually hosts the process.
  // Use newlines — "; "-join yields illegal `then;` / `fi if`; space-join yields `fi if`.
  const portOrPath = portNeedle
    ? `printf '%s' "$cmd" | grep -F -q ${shellQuote(pathNeedle)} || printf '%s' "$cmd" | grep -F -q ${shellQuote(portNeedle)}`
    : `printf '%s' "$cmd" | grep -F -q ${shellQuote(pathNeedle)}`
  return [
    "killed=0",
    `if [ -f ${shellQuote(pf)} ]; then`,
    `  pid=$(tr -d '[:space:]' < ${shellQuote(pf)})`,
    `  if [ -n "$pid" ] && [ -r "/proc/$pid/cmdline" ]; then`,
    `    cmd=$(tr '\\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)`,
    `    if printf '%s' "$cmd" | grep -q "onecode serve"; then`,
    `      if ${portOrPath}; then`,
    `        pkill -KILL -P "$pid" >/dev/null 2>&1 || true`,
    `        kill -KILL "$pid" >/dev/null 2>&1 || true`,
    `        killed=1`,
    `        echo __KILL_LOCAL__`,
    `      else echo __SKIP_PID__`,
    `      fi`,
    `    else echo __SKIP_PID__`,
    `    fi`,
    `  else echo __NOT_THIS_NODE__`,
    `  fi`,
    `  rm -f ${shellQuote(pf)}`,
    `else echo __NO_PID__`,
    `fi`,
  ].join("\n")
}

function remoteKillServeBody(workspaceID: string, opts?: { remotePath?: string; port?: number }) {
  void workspaceID
  if (!opts?.remotePath) return "true"
  return remoteSafeKillPidfileBody(opts.remotePath, opts.port)
}

function remoteKillKeepaliveBody(remotePath: string) {
  const dir = remotePath.replace(/\/+$/, "")
  // Orphan keepalives survive client disconnect: foreground `sleep` swallows
  // SIGHUP, bash never runs the trap, and sshd reparents them.
  // Do not use pgrep -f: login-node procps often only scans a short argv prefix,
  // and Sep11 leftovers put `.onescience-lease` thousands of bytes in. `ps -ww`
  // sees the same full command `ps -ef | grep` does. SIGKILL so TERM/EXIT traps
  // cannot kill the live serve via the shared pidfile. Skip $$/$PPID.
  const needles = [keepaliveScriptFile(dir), `${dir}/.onescience-serve.pid`, `${dir}/.onescience-lease`]
  return needles
    .map(
      (needle) =>
        `for pid in $(ps -ww -eo pid= -o args= 2>/dev/null | grep -F ${shellQuote(needle)} | awk '{print $1}' || true); do case "$pid" in $$|$PPID|"") continue ;; esac; kill -KILL "$pid" >/dev/null 2>&1 || true; done`,
    )
    .join("\n")
}

function remoteKillWatchdogBody(remotePath: string) {
  const wdPid = leaseWatchdogPidFile(remotePath)
  const lease = leaseFile(remotePath)
  const keep = keepaliveScriptFile(remotePath)
  // Lease file is shared storage (any node). Do not kill $wpid from the pidfile —
  // that number is only valid on the node that wrote it.
  // Do not rm the owner file: extra SSH often lands on another login node.
  // Deleting owner on NFS makes the pinned keepalive's HUP trap skip killing
  // serve, or a leftover keepalive skip the owner check and hit the live PID.
  return `rm -f ${shellQuote(wdPid)} ${shellQuote(lease)} ${shellQuote(keep)}`
}

export function remoteKillScript(workspaceID: string, opts?: { remotePath?: string; port?: number }) {
  return [
    remoteKillServeBody(workspaceID, opts),
    ...(opts?.remotePath ? [remoteKillKeepaliveBody(opts.remotePath), remoteKillWatchdogBody(opts.remotePath)] : []),
    "echo OK",
  ].join("\n")
}

/** Supersede the shared lease then kill leftover serve only if it is on this node. */
export function remoteReclaimServeScript(input: { remotePath: string; port?: number; leaseToken: string }) {
  const remotePath = input.remotePath.replace(/\/+$/, "")
  return [
    remoteTouchLeaseScript(remotePath, input.leaseToken),
    remoteSafeKillPidfileBody(remotePath, input.port),
    "echo __RECLAIM_OK__",
  ].join("\n")
}

export function remoteTouchLeaseScript(remotePath: string, token?: string) {
  const dir = remotePath.replace(/\/+$/, "")
  const file = leaseFile(dir)
  if (token) {
    return `mkdir -p ${shellQuote(dir)} && printf %s ${shellQuote(token)} > ${shellQuote(file)} && echo OK`
  }
  return `mkdir -p ${shellQuote(dir)} && touch ${shellQuote(file)} && echo OK`
}

/** Heartbeat only. Must not recreate a lease that disconnect already deleted. */
export function remoteRefreshLeaseScript(remotePath: string, token?: string) {
  const file = leaseFile(remotePath)
  if (token) {
    return `if [ -f ${shellQuote(file)} ]; then printf %s ${shellQuote(token)} > ${shellQuote(file)} && echo OK; else echo GONE; fi`
  }
  return `if [ -f ${shellQuote(file)} ]; then touch ${shellQuote(file)} && echo OK; else echo GONE; fi`
}

/**
 * Ensure the lease file exists for the in-process leaf watchdog (`startSshLeafLeaseWatchdog`).
 * Do not spawn a remote `bash -lc` loop — that process argv exposes kill/serve paths in `ps`.
 * Still kills any leftover legacy bash watchdog from older clients.
 * `workspaceID` / `port` / ttl / poll kept for call-site compatibility.
 */
export function remoteEnsureLeaseWatchdogScript(input: {
  remotePath: string
  workspaceID: string
  port: number
  ttlSeconds?: number
  pollSeconds?: number
}) {
  const remotePath = input.remotePath.replace(/\/+$/, "")
  const lease = leaseFile(remotePath)
  return [
    `mkdir -p ${shellQuote(remotePath)}`,
    `touch ${shellQuote(lease)}`,
    // Clean up legacy remote bash watchdogs from older clients (if any).
    remoteKillWatchdogBody(remotePath),
    `echo LEASE_OK`,
  ].join("; ")
}

export function remoteWorkspaceAliveScript(workspaceID: string, opts?: { remotePath?: string; port?: number }) {
  return `pids=$(${remoteWorkspacePidsCommand(workspaceID, opts)}); if [ -n "$(echo "$pids" | tr -d '[:space:]')" ]; then echo ALIVE; else echo DEAD; fi`
}

export function remotePathLeafAliveScript(remotePath: string, port?: number) {
  return `pids=$(${remotePathLeafPidsCommand(remotePath, port)}); if [ -n "$(echo "$pids" | tr -d '[:space:]')" ]; then echo ALIVE; else echo DEAD; fi`
}

/** Kill leftover leafs for this remote path, keeping the serve on `keepPort`. */
export function remoteKillExtraPathLeafsScript(remotePath: string, keepPort: number) {
  // Lean: only touch pidfile PIDs that are not the keepPort listener.
  const keep = keepPort > 0 ? remotePortPidsCommand(keepPort) : "true"
  return `keep=$(${keep}); pids=$(${remotePidFileCommand(remotePath)}); for pid in $pids; do echo "$keep" | grep -qx "$pid" && continue; pkill -KILL -P "$pid" >/dev/null 2>&1 || true; kill -KILL "$pid" >/dev/null 2>&1 || true; done; echo OK`
}

export function remoteReadMarkerScript(remotePath: string) {
  const file = `${remotePath.replace(/\/+$/, "")}/${MARKER_NAME}`
  return `if [ -f ${shellQuote(file)} ]; then cat ${shellQuote(file)}; else echo __NONE__; fi`
}

export function remoteEnsureDirAndReadMarkerScript(remotePath: string) {
  return `mkdir -p ${shellQuote(remotePath)} && ${remoteReadMarkerScript(remotePath)}`
}

export function startLocalTunnel(config: ConfigSSH.Info, localPort: number, remotePort: number) {
  return startSshTunnel(config, [
    "-L",
    `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
  ])
}

export function startCatalogTunnel(
  config: ConfigSSH.Info,
  localPort: number,
  remotePort: number,
  catalogPort: number,
  controlPort: number,
) {
  return startSshTunnel(config, [
    "-L",
    `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
    "-R",
    `127.0.0.1:${catalogPort}:127.0.0.1:${controlPort}`,
  ])
}

function startSshTunnel(config: ConfigSSH.Info, forwards: string[]) {
  const args = [
    ...sshBaseArgs(sshConfig(config)),
    "-N",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    `ServerAliveInterval=${SSH_SERVER_ALIVE_INTERVAL}`,
    "-o",
    `ServerAliveCountMax=${SSH_SERVER_ALIVE_COUNT_MAX}`,
    ...forwards,
    config.hostName || config.host,
  ]
  return spawnSshProcess(args, {
    password: sshPassword(config),
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  })
}

export const SERVE_READY_MARK = "__SERVE_READY__"
export const SERVE_REUSE_MARK = "__REUSE__"

/**
 * Same-node reuse. Pidfile is path-scoped; argv has `--port` but not the remote
 * directory (only `cd` + env). Match port + onecode serve + cwd === remotePath so
 * we do not skip reuse and spawn a second leaf that fights SQLite locks / the port.
 */
function remoteLocalServePidAssign(remotePath: string, port: number) {
  const pidFile = servePidFile(remotePath)
  const pathNeedle = remotePath.replace(/\/+$/, "")
  const portNeedle = `--port ${port}`
  // Newlines only — avoid `then;` from "; "-join and keep `then cmd` valid.
  return [
    `if [ -f ${shellQuote(pidFile)} ]; then`,
    `  pid=$(tr -d '[:space:]' < ${shellQuote(pidFile)})`,
    `  if [ -n "$pid" ] && [ -r "/proc/$pid/cmdline" ]; then`,
    `    cmd=$(tr '\\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)`,
    `    cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || true)`,
    `    if printf '%s' "$cmd" | grep -q "onecode serve" && printf '%s' "$cmd" | grep -F -q ${shellQuote(portNeedle)} && [ "$cwd" = ${shellQuote(pathNeedle)} ]; then`,
    `      SERVE_PID="$pid"`,
    `      REUSE=1`,
    `    fi`,
    `  fi`,
    `fi`,
  ].join("\n")
}

/** Kill every onecode serve on this node bound to `port` (orphans after keepalive SIGKILL). */
export function remoteKillPortServeBody(port: number) {
  const portNeedle = `--port ${port}`
  return [
    `for pid in $(ps -ww -eo pid= -o args= 2>/dev/null | grep -F ${shellQuote(portNeedle)} | grep -E 'onecode serve|\\.onecode serve' | awk '{print $1}' || true); do`,
    `  case "$pid" in $$|$PPID|"") continue ;; esac`,
    `  pkill -KILL -P "$pid" >/dev/null 2>&1 || true`,
    `  kill -KILL "$pid" >/dev/null 2>&1 || true`,
    `done`,
  ].join("\n")
}

/** Free whoever is LISTENing on 127.0.0.1:port (broader than cmdline grep). */
export function remoteFreeListenPortBody(port: number) {
  return [
    `for pid in $(${uniquePidList(remotePortPidsCommand(port))}); do`,
    `  case "$pid" in $$|$PPID|"") continue ;; esac`,
    `  pkill -KILL -P "$pid" >/dev/null 2>&1 || true`,
    `  kill -KILL "$pid" >/dev/null 2>&1 || true`,
    `done`,
  ].join("\n")
}

/** Start or reuse serve and keep this SSH session (and its -L/-R) on the same login node.
 * Same-node leftover is reused (touch lease, do not write a new token). Other-node leftover
 * cannot be killed here; a new serve writes a new lease so that node's watchdog exits.
 *
 * Tunnel tear-down (HUP) must NOT kill serve: failed health / UI blips would destroy the
 * user's session. Explicit disconnect uses remoteKillScript + lease delete instead.
 * `reuseOnly` skips startFresh so sync/probes cannot resurrect a killed leaf after disconnect.
 */
export const SERVE_REUSE_MISS_MARK = "__SERVE_REUSE_MISS__"

export function remotePinnedKeepaliveScript(
  input: Parameters<typeof remoteStartServeScript>[0] & {
    catalogToken?: string
    /** When true, only reattach to a same-node leftover serve — never spawn a new leaf. */
    reuseOnly?: boolean
  },
) {
  const pidFile = servePidFile(input.remotePath)
  const lease = leaseFile(input.remotePath)
  const ownerFile = keepaliveOwnerFile(input.remotePath)
  const logFile = `${input.remotePath.replace(/\/+$/, "")}/.onescience-serve.log`
  const beatNew = input.leaseToken
    ? `printf %s ${shellQuote(input.leaseToken)} > ${shellQuote(lease)}`
    : `touch ${shellQuote(lease)}`
  const beatReuse = `touch ${shellQuote(lease)}`
  const stillOwner = `[ "$(tr -d "[:space:]" < "$OWNER_FILE" 2>/dev/null)" = "$OWNER" ]`
  // Only when lease is gone (disconnect deleted it) or we still own the pin.
  const cleanupOwned = `if [ -n "$SERVE_PID" ] && ${stillOwner}; then pkill -KILL -P "$SERVE_PID" >/dev/null 2>&1 || true; kill -KILL "$SERVE_PID" >/dev/null 2>&1 || true; fi`
  const startFresh = [
    remoteKillPortServeBody(input.port),
    // Also free the TCP listen via fuser/lsof/ss — ps-grep can miss orphans whose
    // cmdline no longer matches, leaving "Is port N in use?" after migration.
    remoteFreeListenPortBody(input.port),
    remoteSafeKillPidfileBody(input.remotePath, input.port),
    `sleep 0.4`,
    remoteStartServeScript(input),
    `SERVE_PID=$(tr -d "[:space:]" < ${shellQuote(pidFile)} 2>/dev/null || true)`,
    `LISTENING=0`,
    `for _ in $(seq 1 80); do if grep -q "opencode server listening" ${shellQuote(logFile)} 2>/dev/null; then LISTENING=1; break; fi; sleep 0.25; done`,
  ].join("\n")
  // Sync/probes call target({create:false}) → retunnel. After user disconnect the
  // leaf is gone; startFresh here would resurrect it on the old port.
  const onReuseMiss = input.reuseOnly
    ? [`printf '%s\\n' ${shellQuote(SERVE_REUSE_MISS_MARK)}`, `exit 1`].join("\n")
    : startFresh
  return [
    "export TMOUT=0",
    "SERVE_PID=",
    "REUSE=0",
    "OWNER=$$",
    `OWNER_FILE=${shellQuote(ownerFile)}`,
    // Prove the script parsed and began (distinguishes syntax-abort from later failure).
    `printf '%s\\n' '__KEEPALIVE_BOOT__'`,
    `printf %s "$OWNER" > "$OWNER_FILE"`,
    // Do not kill serve on tunnel drop — prefer orphan+reuse over session death.
    `trap 'exit 0' INT TERM HUP`,
    `trap 'true' EXIT`,
    // Same-node leftovers (often PPID 1 after sshd reparent) keep rewriting
    // the shared lease. SIGKILL so their EXIT trap cannot race us.
    remoteKillKeepaliveBody(input.remotePath),
    ...(input.catalogToken ? [remoteWriteCatalogTokenScript(input.remotePath, input.catalogToken)] : []),
    remoteLocalServePidAssign(input.remotePath, input.port),
    `if [ "$REUSE" -eq 0 ]; then`,
    onReuseMiss,
    `fi`,
    // Never claim ready when a fresh start failed to listen (e.g. port still busy).
    `if [ "$REUSE" -eq 1 ]; then`,
    `printf '%s\\n' ${shellQuote(SERVE_REUSE_MARK)}`,
    `printf '%s\\n' ${shellQuote(SERVE_READY_MARK)}`,
    `elif [ "\${LISTENING:-0}" -eq 1 ]; then`,
    `printf '%s\\n' ${shellQuote(SERVE_READY_MARK)}`,
    `else`,
    `printf '%s\\n' '__SERVE_LISTEN_FAIL__'`,
    `exit 1`,
    `fi`,
    // Missing lease = stop (disconnect deletes it on NFS). Do not recreate it —
    // that would keep the frozen serve's watchdog alive after a failed connect.
    `if [ "$REUSE" -eq 1 ]; then while :; do [ -f ${shellQuote(lease)} ] || { ${cleanupOwned}; exit 0; }; ${stillOwner} || exit 0; ${beatReuse}; sleep 30 & wait $! || true; done; else while :; do [ -f ${shellQuote(lease)} ] || { ${cleanupOwned}; exit 0; }; ${stillOwner} || exit 0; ${beatNew}; sleep 30 & wait $! || true; done; fi`,
  ].join("\n")
}

/** Tiny remote argv: script body goes over stdin so `ps | grep onecode` does not match keepalive. */
export function remotePinnedKeepaliveBootstrap(remotePath: string) {
  const file = keepaliveScriptFile(remotePath)
  return `cat > ${shellQuote(file)} && chmod 700 ${shellQuote(file)} && exec bash --login ${shellQuote(file)}`
}

export function startPinnedServeTunnel(input: {
  config: ConfigSSH.Info
  localPort: number
  remotePort: number
  remotePath: string
  keepScript: string
  catalogPort?: number
  controlPort?: number
}) {
  const forwards = ["-L", `127.0.0.1:${input.localPort}:127.0.0.1:${input.remotePort}`]
  if (input.catalogPort && input.controlPort) {
    forwards.push("-R", `127.0.0.1:${input.catalogPort}:127.0.0.1:${input.controlPort}`)
  }
  const args = [
    ...sshBaseArgs(sshConfig(input.config)).filter((item) => item !== "-n"),
    "-o",
    "ControlMaster=no",
    "-o",
    "ControlPath=none",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    `ServerAliveInterval=${SSH_SERVER_ALIVE_INTERVAL}`,
    "-o",
    `ServerAliveCountMax=${SSH_SERVER_ALIVE_COUNT_MAX}`,
    ...forwards,
    input.config.hostName || input.config.host,
    remoteBash(remotePinnedKeepaliveBootstrap(input.remotePath), false),
  ]
  const child = spawnSshProcess(args, {
    password: sshPassword(input.config),
    stdin: "pipe",
    stdout: "pipe",
    // Unread stderr pipes stall sshd I/O and freeze -L forwards on noisy login-node bashrc.
    stderr: "ignore",
  })
  try {
    child.stdin?.end(input.keepScript, "utf8")
  } catch {
    child.stdin?.end()
  }
  return child
}

export function catalogTokenPath(remotePath: string) {
  return `${remotePath.replace(/\/+$/, "")}/.opencode-catalog-token`
}

export function remoteWriteCatalogTokenScript(remotePath: string, token: string) {
  const file = catalogTokenPath(remotePath)
  return `printf %s ${shellQuote(token)} > ${shellQuote(file)} && chmod 600 ${shellQuote(file)} 2>/dev/null || true`
}

export function remoteDeleteCatalogTokenScript(remotePath: string) {
  return `rm -f ${shellQuote(catalogTokenPath(remotePath))}`
}

/** One SSH round-trip: ssh ok + path + marker + onecode version. */
export function remoteCombinedPreflightScript(remotePath: string, opts?: { createIfMissing?: boolean }) {
  const markerFile = `${remotePath.replace(/\/+$/, "")}/${MARKER_NAME}`
  const pathCheck =
    opts?.createIfMissing === false
      ? `if [ -d ${shellQuote(remotePath)} ] && [ -r ${shellQuote(remotePath)} ] && [ -x ${shellQuote(remotePath)} ]; then printf '__PATH_OK__\\n'; else printf '__PATH_FAIL__\\n'; exit 0; fi`
      : `if mkdir -p ${shellQuote(remotePath)} && test -w ${shellQuote(remotePath)}; then printf '__PATH_OK__\\n'; else printf '__PATH_FAIL__\\n'; exit 0; fi`
  return [
    "set +e",
    `printf '__SSH_OK__\\n'`,
    pathCheck,
    `if [ -f ${shellQuote(markerFile)} ]; then printf '__MARKER__\\n'; cat ${shellQuote(markerFile)}; printf '\\n__MARKER_END__\\n'; else printf '__MARKER_NONE__\\n'; fi`,
    `if command -v onecode >/dev/null 2>&1; then onecode --version; printf '__ONECODE_OK__\\n'; else printf '__ONECODE_MISSING__\\n'; fi`,
    "exit 0",
  ].join("; ")
}

export function remoteServeLogScript(remotePath: string) {
  const logFile = `${remotePath.replace(/\/+$/, "")}/.onescience-serve.log`
  return `if [ -f ${shellQuote(logFile)} ]; then echo __SERVE_LOG__; tail -n 40 ${shellQuote(logFile)}; else echo __NO_LOG__; fi`
}

export function isHealthyHttpStatus(status: number) {
  return status === 200 || status === 204 || status === 401 || status === 403
}

/** Instance routes must actually list files. 401/403 only means the HTTP server is up. */
export function isInstanceReadyHttpStatus(status: number) {
  return status === 200 || status === 204
}

/** Local -L probe after serve has printed "listening". Lease `sleep 30` is not part of this wait.
 * NFS sqlite fcntl can stall the leaf for a few seconds (State=D); prefer waiting over tearing down. */
export const REMOTE_SERVE_HEALTH_TIMEOUT_MS = 60_000
/** Single HTTP attempt; short probes false-fail during D-state blips. */
export const REMOTE_SERVE_HEALTH_PROBE_MS = 5_000
/** Wait for keepalive stdout mark after login-node bashrc; does not include HTTP health. */
export const REMOTE_SERVE_SPAWN_TIMEOUT_MS = 90_000
/** After tunnel+health: wait until the leaf can serve instance routes (files/providers). */
export const REMOTE_LEAF_READY_TIMEOUT_MS = 300_000
export const REMOTE_LEAF_READY_PROBE_MS = 15_000
/** Old full serve starts OneSkills ~1s after listen; require /file to stay healthy through that. */
export const REMOTE_LEAF_READY_STABLE_MS = 12_000

export function parseServeBootstrapDetail(log: string): string | undefined {
  const failed = [...log.matchAll(/^serve: bootstrap failed:.*$/gm)].at(-1)?.[0]
  if (failed) return failed.replace(/^serve:\s*/, "")
  const lines = log
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("serve:"))
  const last = lines.at(-1)
  if (!last) return
  if (last.includes("ready")) return "正在确认远端服务"
  if (/ssh-leaf lean/i.test(last)) return "远端叶子精简启动"
  if (/OneSkills/i.test(last)) return "正在准备 OneSkills"
  if (/migration/i.test(last)) return "正在执行启动迁移"
  if (/catalog/i.test(last)) return "正在加载模型目录"
  return last.replace(/^serve:\s*/, "")
}

export function serveBootstrapFailed(log: string): string | undefined {
  const match = log.match(/^serve: bootstrap failed:\s*(.*)$/m)
  const reason = match?.[1]?.trim()
  return reason || undefined
}

export function serveLogShowsReady(log: string) {
  return /(?:^|\n)serve: ready(?:\s|$)/m.test(log)
}

/** OneSkills / migrations / catalog are still running; HTTP instance routes will hang until they finish. */
export function serveLogStillSeeding(log: string) {
  if (serveBootstrapFailed(log) || serveLogShowsReady(log)) return false
  // Lean leaf path is not a seed stall.
  if (/serve: ssh-leaf lean/.test(log)) return false
  // Old full serve prints listening first; seed starts ~1s later and never logs "serve: bootstrap"
  // on some builds. Treat listening-without-ready as still seeding.
  if (/opencode server listening/.test(log)) return true
  return /serve: (bootstrap OneSkills|startup migrations|catalog bootstrap)/.test(log)
}

export async function readServeLog(config: ConfigSSH.Info, remotePath: string) {
  const result = await runRemote(config, remoteServeLogScript(remotePath), 8_000, { login: false })
  const text = result.stdout.replace(/^__SERVE_LOG__\s*/, "").trim()
  if (!text || text === "__NO_LOG__") return ""
  return text
}

function probeLocalHttp(port: number, path: string, timeoutMs: number, headers?: Record<string, string>) {
  return new Promise<number>((resolve, reject) => {
    const req = http.get(
      {
        host: "127.0.0.1",
        family: 4,
        port,
        path,
        agent: false,
        headers,
      },
      (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      },
    )
    // `timeout` on http.get only covers connect; setTimeout also fires after the socket is up.
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      reject(new Error("timeout"))
    })
    req.on("error", reject)
  })
}

function probeLocalHealth(port: number, timeoutMs = REMOTE_SERVE_HEALTH_PROBE_MS) {
  return probeLocalHttp(port, "/global/health", timeoutMs)
}

export function waitForServeReadyMark(
  session: { stdout?: NodeJS.ReadableStream | null; exited: Promise<unknown> },
  timeoutMs = REMOTE_SERVE_SPAWN_TIMEOUT_MS,
) {
  const stdout = session.stdout
  if (!stdout) {
    return Promise.reject(new Error("SSH 会话没有 stdout，无法确认远端 serve 已拉起"))
  }
  return new Promise<boolean>((resolve, reject) => {
    let settled = false
    let buf = ""
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        stdout.off("data", onData)
        stdout.off("error", onError)
        reject(error)
        return
      }
      resolve(buf.includes(SERVE_REUSE_MARK))
    }
    const timer = setTimeout(() => {
      finish(new Error("远端 serve 未在时限内启动（登录节点可能仍在执行 bashrc）"))
    }, timeoutMs)
    const onData = (chunk: Buffer | string) => {
      if (settled) return
      buf += typeof chunk === "string" ? chunk : chunk.toString("utf8")
      if (buf.length > 65_536) buf = buf.slice(-32_768)
      if (buf.includes(SERVE_READY_MARK)) finish()
    }
    const onError = (error: Error) => finish(error)
    stdout.on("data", onData)
    stdout.on("error", onError)
    stdout.resume()
    void session.exited.then(
      () => finish(new Error("SSH 会话在远端 serve 启动前断开（登录节点可能换机，或远端 serve 未起来）")),
      (error) => finish(error instanceof Error ? error : new Error(String(error))),
    )
  })
}

export async function waitForHealth(port: number, timeoutMs = REMOTE_SERVE_HEALTH_TIMEOUT_MS) {
  const url = `http://127.0.0.1:${port}/global/health`
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const status = await probeLocalHealth(port, REMOTE_SERVE_HEALTH_PROBE_MS)
      if (isHealthyHttpStatus(status)) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`本机隧道已建立，但健康检查超时：${url}`)
}

/** Tunnel health is not enough: /global/health can pass while OneSkills/catalog seed still blocks files and send. */
export async function waitForLeafReady(input: {
  port: number
  directory: string
  timeoutMs?: number
  stableMs?: number
  abort?: () => boolean
  onDetail?: (detail: string) => void
  readLog?: () => Promise<string>
}) {
  const timeoutMs = input.timeoutMs ?? REMOTE_LEAF_READY_TIMEOUT_MS
  const stableMs = input.stableMs ?? REMOTE_LEAF_READY_STABLE_MS
  const started = Date.now()
  let lastDetail = "正在初始化远端环境"
  let consecutiveFileOk = 0
  let healthySince = 0
  input.onDetail?.(lastDetail)
  const headers = { "x-opencode-directory": input.directory }
  while (Date.now() - started < timeoutMs) {
    if (input.abort?.()) throw new Error("已取消连接")
    let seeding = false
    if (input.readLog) {
      const log = await input.readLog().catch(() => "")
      const failed = serveBootstrapFailed(log)
      if (failed) throw new Error(`远端 serve 初始化失败：${failed}`)
      seeding = serveLogStillSeeding(log)
      const detail = parseServeBootstrapDetail(log)
      if (detail && detail !== lastDetail) {
        lastDetail = detail
        input.onDetail?.(detail)
      }
    }
    // NFS seed freezes B's event loop; extra SSH can still read the log.
    // Do not burn the budget on HTTP probes until seed finishes or we have no log.
    if (!seeding) {
      try {
        const configStatus = await probeLocalHttp(input.port, "/config", REMOTE_LEAF_READY_PROBE_MS, headers)
        if (isHealthyHttpStatus(configStatus)) {
          // /config or /file 401 is not enough — UI then hits /file and gets Unexpected server error.
          const fileStatus = await probeLocalHttp(input.port, "/file?path=", REMOTE_LEAF_READY_PROBE_MS, headers)
          if (isInstanceReadyHttpStatus(fileStatus)) {
            consecutiveFileOk += 1
            if (!healthySince) healthySince = Date.now()
            const stable = stableMs <= 0 || Date.now() - healthySince >= stableMs
            if (consecutiveFileOk >= 2 && stable) {
              input.onDetail?.("远端环境已就绪")
              return
            }
            lastDetail = "远端文件服务已响应，正在确认稳定"
            input.onDetail?.(lastDetail)
          } else {
            consecutiveFileOk = 0
            healthySince = 0
            lastDetail = "远端配置已就绪，正在等待文件服务"
            input.onDetail?.(lastDetail)
          }
        } else {
          consecutiveFileOk = 0
          healthySince = 0
        }
      } catch {
        consecutiveFileOk = 0
        healthySince = 0
      }
    } else {
      consecutiveFileOk = 0
      healthySince = 0
    }
    await new Promise((resolve) => setTimeout(resolve, seeding ? 2_000 : 1_000))
  }
  const hint = lastDetail && lastDetail !== "正在初始化远端环境" ? `（${lastDetail}）` : ""
  throw new Error(`远端环境未在时限内就绪${hint}。进程可能已在远端运行，请稍后重试连接。`)
}
