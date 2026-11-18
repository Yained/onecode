import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { Process } from "@/util/process"
import { runSshProcess, sshAuthCliArgs } from "@/util/ssh-cli"
import { appendSshKnownHostsIgnoreArgs } from "@/config/ssh-known-hosts"
import { ModelScopeCliProgressTracker } from "./modelscope-download-progress"
import {
  completedRecord,
  datasetCacheLayoutRelPaths,
  datasetCacheRelPaths,
  downloadStoreKey,
  partialRecord,
  persistCliProgressToStore,
  readStore,
  writeStore,
  type ModelScopeDownloadRecord,
  type ModelScopeDownloadSshConfig,
} from "./modelscope-download-store"

export const MODELSCOPE_SSH_DOWNLOAD_POLL_INTERVAL_MS = 3_000
const SSH_COMMAND_TIMEOUT_MS = 20_000
const SSH_START_TIMEOUT_MS = 15_000
const SSH_CONFIRM_TIMEOUT_MS = 30_000
// ~30s of consecutive failures plus one final confirmation probe before a download is declared failed,
// so a brief network blip cannot kill the tracking of a healthy remote process.
const SSH_MAX_CONSECUTIVE_FAILURES = 10
const LOG_CHUNK_BYTES = 262_144
const POLL_SEPARATOR = "__OS_DL_SEP__"

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/** Prefix remote login-shell commands with `conda activate` when the user named an env. */
export function remoteCondaPrefix(condaEnv: string | undefined) {
  const name = condaEnv?.trim()
  if (!name) return ""
  return `source $(conda info --base 2>/dev/null)/etc/profile.d/conda.sh 2>/dev/null; conda activate ${shellQuote(name)} && `
}

/** pip --user and similar installs put CLIs in ~/.local/bin, which login shells often omit until the next session. */
export function remoteUserPathPrefix() {
  // No double quotes: this prefix is embedded in `bash -lc "..."` for the remote download.
  return "export PATH=$HOME/.local/bin:$HOME/bin:$PATH; "
}

export function remoteModelscopeSetup(condaEnv: string | undefined) {
  const conda = remoteCondaPrefix(condaEnv)
  return conda || remoteUserPathPrefix()
}

export type RemoteCondaEnv = {
  name: string
  path: string
  active?: boolean
}

/** Parse `conda env list` text. Skips comments, unnamed paths, and duplicate names. */
export function parseCondaEnvList(output: string): RemoteCondaEnv[] {
  const items: RemoteCondaEnv[] = []
  const seen = new Set<string>()
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const match = trimmed.match(/^(\S+)\s+(\*\s+)?(\/\S+)$/)
    if (!match) continue
    const name = match[1]
    const envPath = match[3]
    if (!name || name.startsWith("/") || !envPath) continue
    if (seen.has(name)) continue
    seen.add(name)
    items.push({
      name,
      path: envPath,
      ...(match[2] ? { active: true } : {}),
    })
  }
  return items
}

export const CONDA_ENV_LIST_SCRIPT = [
  // Match interactive login PATH (HPC modules / conda init often live in bashrc, not bash_profile).
  'export PATH="$HOME/.local/bin:$HOME/bin:$PATH"',
  '[ -f "$HOME/.bash_profile" ] && . "$HOME/.bash_profile" >/dev/null 2>&1 || true',
  '[ -f "$HOME/.profile" ] && . "$HOME/.profile" >/dev/null 2>&1 || true',
  '[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc" >/dev/null 2>&1 || true',
  'for d in "$HOME/miniconda3" "$HOME/anaconda3" "$HOME/mambaforge" "$HOME/miniforge3" "$HOME/conda"; do [ -f "$d/etc/profile.d/conda.sh" ] && . "$d/etc/profile.d/conda.sh" >/dev/null 2>&1 && break; done',
  'if command -v conda >/dev/null 2>&1; then conda env list; else echo __OS_NO_CONDA__; fi',
].join("; ")

const SSH_CONDA_LIST_TIMEOUT_MS = 45_000

function condaListResult(output: string, stderr: string, code: number, hostLabel: string) {
  if (code !== 0) {
    const detail = [stderr.trim(), output.trim()].filter(Boolean).join("\n")
    throw new Error(
      detail
        ? `failed to list conda environments on the ${hostLabel}: ${detail}`
        : `failed to list conda environments on the ${hostLabel}: command exited with code ${code}`,
    )
  }
  if (output.includes("__OS_NO_CONDA__")) return { items: [] as RemoteCondaEnv[], available: false }
  return { items: parseCondaEnvList(output), available: true }
}

export async function listLocalCondaEnvs(): Promise<{
  items: RemoteCondaEnv[]
  available: boolean
}> {
  const result = await Process.run(["bash", "-lic", CONDA_ENV_LIST_SCRIPT], {
    nothrow: true,
    timeout: 5_000,
    abort: AbortSignal.timeout(SSH_CONDA_LIST_TIMEOUT_MS),
  }).catch(() => undefined)
  if (!result) throw new Error("failed to list conda environments on the local host: command failed to start")
  return condaListResult(result.stdout.toString(), result.stderr.toString(), result.code, "local host")
}

function sshPassword(ssh: ModelScopeDownloadSshConfig) {
  return ssh.auth?.type === "password" ? ssh.auth.password : undefined
}

export async function listSshCondaEnvs(ssh: ModelScopeDownloadSshConfig): Promise<{
  items: RemoteCondaEnv[]
  available: boolean
}> {
  const result = await runSshProcess(
    [...sshBaseArgs(ssh), ssh.hostName || ssh.host, `bash -lic ${shellQuote(CONDA_ENV_LIST_SCRIPT)}`],
    {
      nothrow: true,
      timeout: 5_000,
      abort: AbortSignal.timeout(SSH_CONDA_LIST_TIMEOUT_MS),
      password: sshPassword(ssh),
    },
  ).catch(() => undefined)
  if (!result) throw new Error("failed to list conda environments on the remote SSH host: ssh command failed to start")
  return condaListResult(result.stdout.toString(), result.stderr.toString(), result.code, "remote SSH host")
}

function controlPath(ssh: ModelScopeDownloadSshConfig) {
  const hash = createHash("sha1")
    .update(`${ssh.username ?? ""}@${ssh.hostName || ssh.host}:${ssh.port ?? 22}`)
    .digest("hex")
    .slice(0, 16)
  return path.join(os.tmpdir(), `os-dl-${hash}.sock`)
}

export function sshBaseArgs(ssh: ModelScopeDownloadSshConfig) {
  const args = ["-n", ...sshAuthCliArgs(ssh.auth, ssh.options)]
  if (ssh.port) args.push("-p", String(ssh.port))
  if (ssh.username) args.push("-l", ssh.username)
  if (process.platform !== "win32") {
    args.push("-o", "ControlMaster=auto", "-o", "ControlPersist=60s", "-o", `ControlPath=${controlPath(ssh)}`)
  }
  appendSshKnownHostsIgnoreArgs(args)
  return args
}

async function runSsh(ssh: ModelScopeDownloadSshConfig, remoteCommand: string, timeout = SSH_COMMAND_TIMEOUT_MS) {
  // Process.run's `timeout` only delays SIGKILL after abort; the abort signal is the real deadline.
  const result = await runSshProcess([...sshBaseArgs(ssh), ssh.hostName || ssh.host, remoteCommand], {
    nothrow: true,
    timeout: 5_000,
    abort: AbortSignal.timeout(timeout),
    password: sshPassword(ssh),
  }).catch(() => undefined)
  if (!result || result.code !== 0) return undefined
  return result.stdout.toString()
}

function remoteStateDir(remotePath: string) {
  return `${remotePath.replace(/\/+$/, "")}/.onescience-downloads`
}

function remoteStateName(resourceId: string) {
  return resourceId.replaceAll("/", "__")
}

/**
 * Launch script for the SSH client. Uses a non-login `bash -c` so profile job-control
 * cannot keep the SSH session open for the whole download. The modelscope child still
 * runs under `bash -lc` so conda / ~/.local/bin resolve the same as the preflight probe.
 */
export function remoteStartDownloadScript(input: {
  setup: string
  resourceId: string
  remotePath: string
  logFile: string
  statusFile: string
}) {
  const remotePath = input.remotePath.replace(/\/+$/, "")
  const stateDir = remoteStateDir(remotePath)
  const download = `${input.setup}modelscope download --dataset ${shellQuote(input.resourceId)} --cache_dir ${shellQuote(remotePath)}; echo $? > ${shellQuote(input.statusFile)}`
  return [
    "set +m",
    `mkdir -p ${shellQuote(remotePath)} ${shellQuote(stateDir)}`,
    `rm -f ${shellQuote(input.statusFile)}`,
    `nohup bash -lc ${shellQuote(download)} > ${shellQuote(input.logFile)} 2>&1 < /dev/null & echo $!`,
    "disown -a >/dev/null 2>&1 || true",
    "exit 0",
  ].join("; ")
}

function parseRemotePid(output: string | undefined) {
  const pid = Number.parseInt((output ?? "").trim().split(/\s+/).pop() ?? "", 10)
  return Number.isFinite(pid) && pid > 0 ? pid : undefined
}

async function findRemoteDownloadPid(ssh: ModelScopeDownloadSshConfig, resourceId: string) {
  // Bracket trick so pgrep does not match its own command line.
  const needle = `[m]odelscope download --dataset ${resourceId}`
  const out = await runSsh(ssh, `pgrep -f ${shellQuote(needle)} | head -n 1; true`)
  return parseRemotePid(out)
}

async function remoteProcessAlive(ssh: ModelScopeDownloadSshConfig, pid: number) {
  const out = await runSsh(ssh, `kill -0 ${pid} 2>/dev/null && echo ALIVE || echo GONE; true`)
  return (out ?? "").includes("ALIVE")
}

async function readRemoteExitCode(ssh: ModelScopeDownloadSshConfig, statusFile: string) {
  const out = await runSsh(ssh, `cat ${shellQuote(statusFile)} 2>/dev/null; true`)
  const code = Number.parseInt((out ?? "").trim().split(/\s+/).pop() ?? "", 10)
  return Number.isFinite(code) ? code : undefined
}

export function remoteLogChunkScript(logFile: string, offset: number, maxBytes = LOG_CHUNK_BYTES) {
  const file = shellQuote(logFile)
  const n = Math.max(0, Math.floor(offset))
  const c = Math.max(1, Math.floor(maxBytes))
  return [
    `f=${file}`,
    `n=${n}`,
    `c=${c}`,
    `s=$(wc -c < "$f" 2>/dev/null || echo 0)`,
    `if [ "$s" -lt "$n" ]; then n=$s; fi`,
    `if [ "$s" -gt "$n" ]; then tail -c +$((n+1)) "$f" 2>/dev/null | dd bs="$c" count=1 2>/dev/null; fi`,
  ].join("; ")
}

/** Remote paths that hold dataset files for a given cache_dir, mirroring local datasetCacheTargets. */
export function remoteCacheTargets(remotePath: string, resourceId: string) {
  const root = remotePath.replace(/\/+$/, "")
  return datasetCacheRelPaths(resourceId).map((rel) => `${root}/${rel}`)
}

async function remoteHasFiles(ssh: ModelScopeDownloadSshConfig, remotePath: string, resourceId: string) {
  const paths = await remoteExistingCachePaths(ssh, remotePath, resourceId)
  return paths.length > 0
}

/** Which display layouts currently have files under the remote cache_dir. */
export async function remoteExistingCachePaths(
  ssh: ModelScopeDownloadSshConfig,
  remotePath: string,
  resourceId: string,
) {
  const root = remotePath.replace(/\/+$/, "")
  const { legacy, hub } = datasetCacheLayoutRelPaths(resourceId)
  const targets = [...new Set([`${root}/${legacy}`, ...(legacy === hub ? [] : [`${root}/${hub}`])])]
  const script = targets
    .map((target) => `if test -n "$(ls -A ${shellQuote(target)} 2>/dev/null)"; then printf '%s\\n' ${shellQuote(target)}; fi`)
    .join("; ")
  const out = await runSsh(ssh, `${script}; true`)
  if (!out) return []
  return [...new Set(out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))]
}

/** Parse POSIX `df -Pk` stdout and return Available kilobytes. */
export function parseDfAvailableKb(output: string | undefined) {
  if (!output) return undefined
  let avail: number | undefined
  for (const line of output.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/)
    for (let i = 0; i < cols.length; i++) {
      const value = cols[i]
      const next = cols[i + 1]
      if (value && /^\d+$/.test(value) && next && /^\d+%/.test(next)) {
        avail = Number.parseInt(value, 10)
      }
    }
  }
  return avail !== undefined && Number.isFinite(avail) && avail >= 0 ? avail : undefined
}

/**
 * Logical parents of a remote path, longest first. The disk probe does **not** SSH per
 * ancestor — `remoteDiskDfScript` walks this chain inside one remote shell command.
 */
export function remoteDiskProbeAncestors(remotePath: string): string[] {
  const raw = remotePath.trim()
  if (!raw) return []
  const absolute = raw.startsWith("/")
  let current = raw.replace(/\/+$/, "")
  if (!current) return absolute ? ["/"] : []
  const ancestors: string[] = []
  while (current) {
    ancestors.push(current)
    if (current === "/") break
    const slash = current.lastIndexOf("/")
    if (slash < 0) break
    current = slash === 0 ? "/" : current.slice(0, slash)
  }
  return ancestors
}

/** One remote command: walk `$p` to an existing parent, then df once. Never `$HOME` / `~`. */
export function remoteDiskDfScript(remotePath: string): string | undefined {
  const start = remotePath.trim().replace(/\/+$/, "")
  if (!start) return undefined
  return [
    `p=${shellQuote(start)}`,
    `while [ -n "$p" ] && [ ! -e "$p" ]; do if [ "$p" = "/" ]; then break; fi; n=\${p%/*}; if [ -z "$n" ] || [ "$n" = "$p" ]; then break; fi; p="$n"; done`,
    // HPC df wrappers (ParaStor/Lustre) often reject GNU `-P`; `-k` then plain `df` match what users run by hand.
    `if [ -e "$p" ]; then LC_ALL=C df -k "$p" 2>/dev/null || LC_ALL=C df "$p" 2>/dev/null; fi`,
    "true",
  ].join("; ")
}

export async function getSshRemoteDiskBytes(ssh: ModelScopeDownloadSshConfig, remotePath: string) {
  const script = remoteDiskDfScript(remotePath)
  if (!script) return undefined
  const kb = parseDfAvailableKb(await runSsh(ssh, script))
  if (kb === undefined) return undefined
  return kb * 1024
}

type SshEnvironment = Extract<NonNullable<ModelScopeDownloadRecord["environment"]>, { kind: "ssh" }>

type Watcher = {
  timer: ReturnType<typeof setInterval>
  tracker: ModelScopeCliProgressTracker
  failures: number
  polling: boolean
  logOffset: number
}

const watchers = new Map<string, Watcher>()

function watchKey(directory: string, key: string) {
  return `${path.resolve(directory)}\0${key}`
}

function stopWatcher(id: string) {
  const watcher = watchers.get(id)
  if (!watcher) return
  clearInterval(watcher.timer)
  watchers.delete(id)
}

async function updateRecord(
  directory: string,
  key: string,
  update: (record: ModelScopeDownloadRecord) => ModelScopeDownloadRecord | undefined,
) {
  const store = await readStore(directory)
  const current = store[key]
  if (!current) return undefined
  const next = update(current)
  if (!next) return current
  store[key] = next
  await writeStore(directory, store)
  return next
}

async function finalizeSshDownload(
  directory: string,
  key: string,
  record: ModelScopeDownloadRecord,
  env: SshEnvironment,
  exitCode: number | undefined,
) {
  const cachePaths = await remoteExistingCachePaths(env.ssh, env.remote_path, record.resource_id)
  const hasFiles = cachePaths.length > 0
  await updateRecord(directory, key, (current) => {
    if (current.status !== "downloading") return undefined
    // Only a clean exit means completed: leftover cache from a cancelled/failed run must not
    // promote a failed retry to "completed" just because files exist.
    if (exitCode === 0) return completedRecord(current, Date.now(), cachePaths)
    const failed: ModelScopeDownloadRecord = {
      ...current,
      status: "failed",
      finished_at: Date.now(),
      error: exitCode === undefined ? "interrupted" : `exit ${exitCode}`,
      pid: undefined,
    }
    return hasFiles ? partialRecord(failed, current.resource_id) : failed
  })
}

async function pollSshDownload(directory: string, key: string, id: string) {
  const watcher = watchers.get(id)
  if (!watcher || watcher.polling) return
  watcher.polling = true
  try {
    const store = await readStore(directory)
    const record = store[key]
    if (!record || record.status !== "downloading" || record.environment?.kind !== "ssh") {
      stopWatcher(id)
      return
    }
    const env = record.environment
    const pid = record.pid
    if (!pid) {
      stopWatcher(id)
      await updateRecord(directory, key, (current) =>
        current.status === "downloading"
          ? { ...current, status: "failed", finished_at: Date.now(), error: "interrupted", pid: undefined }
          : undefined,
      )
      return
    }

    // Trailing `true`: the remote command's exit code must not conflate a missing log/status file
    // with an ssh outage — connection failures already surface as ssh's own non-zero exit.
    const command = [
      `kill -0 ${pid} 2>/dev/null && echo ALIVE || echo GONE`,
      `echo ${POLL_SEPARATOR}`,
      `cat ${shellQuote(env.status_file)} 2>/dev/null`,
      `echo ${POLL_SEPARATOR}`,
      `wc -c < ${shellQuote(env.log_file)} 2>/dev/null || echo 0`,
      `echo ${POLL_SEPARATOR}`,
      remoteLogChunkScript(env.log_file, watcher.logOffset),
      "true",
    ].join("; ")
    const out = await runSsh(env.ssh, command)
    if (out === undefined) {
      watcher.failures += 1
      if (watcher.failures >= SSH_MAX_CONSECUTIVE_FAILURES) {
        // Final confirmation with a longer timeout before declaring the download failed —
        // a reachable host resets the counter and polling continues normally.
        const confirmed = await runSsh(env.ssh, `kill -0 ${pid} 2>/dev/null && echo ALIVE || echo GONE`, SSH_CONFIRM_TIMEOUT_MS)
        if (confirmed !== undefined) {
          watcher.failures = 0
          return
        }
        stopWatcher(id)
        await updateRecord(directory, key, (current) =>
          current.status === "downloading"
            ? { ...current, status: "failed", finished_at: Date.now(), error: "ssh unreachable", pid: undefined }
            : undefined,
        )
      }
      return
    }
    watcher.failures = 0

    const parts = out.split(POLL_SEPARATOR)
    const alive = (parts[0] ?? "").includes("ALIVE")
    const statusText = (parts[1] ?? "").trim()
    const logSize = Number.parseInt((parts[2] ?? "").trim(), 10)
    const logChunk = parts.slice(3).join(POLL_SEPARATOR)
    if (Number.isFinite(logSize) && logSize < watcher.logOffset) {
      watcher.logOffset = Math.max(0, logSize)
    }
    if (logChunk) {
      watcher.tracker.feed(logChunk)
      watcher.logOffset += Buffer.byteLength(logChunk)
      await persistCliProgressToStore(directory, key, watcher.tracker)
    }

    if (alive) return
    stopWatcher(id)
    const exitCode = statusText === "" ? undefined : Number.parseInt(statusText, 10)
    await finalizeSshDownload(
      directory,
      key,
      record,
      env,
      exitCode !== undefined && Number.isFinite(exitCode) ? exitCode : undefined,
    )
  } finally {
    watcher.polling = false
  }
}

/** Rebuild the polling loop for an interrupted (server-restarted) SSH download. Idempotent. */
export function ensureSshDownloadWatcher(directory: string, key: string, record: ModelScopeDownloadRecord) {
  if (record.status !== "downloading" || record.environment?.kind !== "ssh") return
  const id = watchKey(directory, key)
  if (watchers.has(id)) return
  const watcher: Watcher = {
    tracker: new ModelScopeCliProgressTracker(),
    failures: 0,
    polling: false,
    logOffset: 0,
    timer: setInterval(() => {
      void pollSshDownload(directory, key, id)
    }, MODELSCOPE_SSH_DOWNLOAD_POLL_INTERVAL_MS),
  }
  watchers.set(id, watcher)
  void pollSshDownload(directory, key, id)
}

export async function startSshDatasetDownload(input: {
  directory: string
  resourceId: string
  targetName: string
  remotePath: string
  ssh: ModelScopeDownloadSshConfig
  condaEnv?: string
  estimatedTotalBytes?: number
}): Promise<ModelScopeDownloadRecord> {
  const remotePath = input.remotePath.trim().replace(/\/+$/, "")
  if (!remotePath) throw new Error("remote storage directory is empty")

  const condaEnv = input.condaEnv?.trim() || undefined
  const setup = remoteModelscopeSetup(condaEnv)
  const detected = await runSsh(input.ssh, `bash -lc ${shellQuote(`${setup}command -v modelscope`)}`)
  if (!detected?.trim()) {
    throw new Error(
      condaEnv
        ? `modelscope CLI not found in conda environment ${condaEnv}`
        : "modelscope CLI not found on the remote SSH host",
    )
  }

  // Best-effort: a retry after failed/partial must not leave a previous remote process running.
  await runSsh(
    input.ssh,
    `pkill -f ${shellQuote(`modelscope download --dataset ${input.resourceId}`)} 2>/dev/null; true`,
  )

  const stateDir = remoteStateDir(remotePath)
  const stateName = remoteStateName(input.resourceId)
  const logFile = `${stateDir}/${stateName}.log`
  const statusFile = `${stateDir}/${stateName}.status`

  const script = remoteStartDownloadScript({
    setup,
    resourceId: input.resourceId,
    remotePath,
    logFile,
    statusFile,
  })
  const started = await runSsh(input.ssh, `bash -c ${shellQuote(script)}`, SSH_START_TIMEOUT_MS)
  let pid = parseRemotePid(started) ?? (await findRemoteDownloadPid(input.ssh, input.resourceId))
  const cachePaths = await remoteExistingCachePaths(input.ssh, remotePath, input.resourceId)
  if (!pid) {
    if (cachePaths.length > 0) {
      pid = 0
    } else {
      throw new Error("remote download failed to start")
    }
  }

  const environment: SshEnvironment = {
    kind: "ssh",
    target_name: input.targetName,
    remote_path: remotePath,
    log_file: logFile,
    status_file: statusFile,
    ssh: input.ssh,
  }
  const base: ModelScopeDownloadRecord = {
    resource_id: input.resourceId,
    kind: "dataset",
    status: "downloading",
    started_at: Date.now(),
    environment,
    downloaded_bytes: 0,
    ...(pid > 0 ? { pid } : {}),
    ...(input.estimatedTotalBytes && input.estimatedTotalBytes > 0
      ? { estimated_total_bytes: input.estimatedTotalBytes }
      : {}),
  }

  const alive = pid > 0 ? await remoteProcessAlive(input.ssh, pid) : false
  const exitCode = alive ? undefined : await readRemoteExitCode(input.ssh, statusFile)
  const record =
    !alive && (exitCode === 0 || cachePaths.length > 0)
      ? completedRecord(base, Date.now(), cachePaths)
      : base

  const key = downloadStoreKey(environment, input.resourceId)
  const store = await readStore(input.directory)
  store[key] = record
  await writeStore(input.directory, store)

  if (record.status === "downloading") ensureSshDownloadWatcher(input.directory, key, record)
  return record
}

export async function cancelSshDatasetDownload(directory: string, key: string, record: ModelScopeDownloadRecord) {
  const env = record.environment
  if (env?.kind !== "ssh") return record
  stopWatcher(watchKey(directory, key))
  const pid = record.pid
  const kill = [
    pid ? `kill ${pid} 2>/dev/null` : undefined,
    `pkill -f ${shellQuote(`modelscope download --dataset ${record.resource_id}`)} 2>/dev/null`,
    "true",
  ]
    .filter(Boolean)
    .join("; ")
  await runSsh(env.ssh, kill)

  const cancelled: ModelScopeDownloadRecord = {
    ...record,
    status: "failed",
    finished_at: Date.now(),
    error: "cancelled",
    pid: undefined,
  }
  const hasFiles = await remoteHasFiles(env.ssh, env.remote_path, record.resource_id)
  const next = hasFiles ? partialRecord(cancelled, record.resource_id) : cancelled
  // A watcher poll may have finalized the record concurrently; never overwrite a terminal state.
  const stored = await updateRecord(directory, key, (current) =>
    current.status === "downloading" ? next : undefined,
  )
  return stored ?? next
}

export async function deleteSshDatasetDownload(directory: string, key: string, record: ModelScopeDownloadRecord) {
  const env = record.environment
  if (env?.kind !== "ssh") throw new Error("not an ssh download")
  if (record.status === "downloading") throw new Error("download in progress")
  const targets = remoteCacheTargets(env.remote_path, record.resource_id).map(shellQuote).join(" ")
  const out = await runSsh(env.ssh, `rm -rf ${targets}`, 120_000)
  if (out === undefined) throw new Error("delete failed")
  if (await remoteHasFiles(env.ssh, env.remote_path, record.resource_id)) throw new Error("delete failed")

  const store = await readStore(directory)
  delete store[key]
  await writeStore(directory, store)
}
