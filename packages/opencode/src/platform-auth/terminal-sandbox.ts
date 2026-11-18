import path from "node:path"
import fs from "node:fs"
import { spawnSync } from "node:child_process"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { OneCodeExtraPath } from "@opencode-ai/core/extra-path"
import { Shell } from "@/shell/shell"
import { platformSshHome } from "@/server/ssh-config-file"
import * as PlatformAuth from "./platform-auth"

/** SSH leaf serve: product PTY/shell is the remote user's normal shell, no extra isolation. */
export function isRemoteLeafTerminal() {
  return Boolean(Flag.OPENCODE_WORKSPACE_ID?.trim())
}

/** Control-plane PTY whose cwd is not on this machine — treat as remote, never bwrap. */
export function isOffHostRemoteCwd(session: PlatformAuth.AuthSession | undefined, cwd: string | undefined) {
  if (isRemoteLeafTerminal()) return true
  if (!session || !cwd?.trim()) return false
  return !PlatformAuth.canAccessPath(session, cwd)
}

type CommandInput = {
  session?: PlatformAuth.AuthSession
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  interactive?: boolean
}

type PreparedCommand = {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  sandboxed: boolean
}

const DEFAULT_DOCKER_IMAGE = "ubuntu:24.04"
const DEFAULT_DOCKER_WORKSPACE = "/workspace"
const DEFAULT_SANDBOX_SHELL = "/bin/bash"
const DEFAULT_SANDBOX_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
/** Host toolchains under /opt (DTK / hyhal / ROCm / CUDA toolkit) are covered by binding /opt. */
const BWRAP_RO_BIND = ["/bin", "/usr", "/lib", "/lib64", "/etc", "/opt"]
/** Explicit accelerator runtimes — also used for docker -v when /opt is not fully mounted. */
const ACCELERATOR_RO_PATHS = ["/opt/hyhal", "/opt/dtk", "/opt/DTK", "/opt/rocm", "/usr/local/cuda"]
const ENV_ALLOW = new Set([
  "COLORTERM",
  "CUDA_DEVICE_ORDER",
  "CUDA_HOME",
  "CUDA_PATH",
  "CUDA_VISIBLE_DEVICES",
  "DTK_ROOT",
  "HIP_PATH",
  "HIP_VISIBLE_DEVICES",
  "HSA_OVERRIDE_GFX_VERSION",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LD_LIBRARY_PATH",
  "NVIDIA_DRIVER_CAPABILITIES",
  "NVIDIA_VISIBLE_DEVICES",
  "PATH",
  "ROCM_PATH",
  "ROCR_VISIBLE_DEVICES",
  "TERM",
  "TZ",
])
const HOST_ACCEL_ENV_KEYS = [
  "CUDA_VISIBLE_DEVICES",
  "NVIDIA_VISIBLE_DEVICES",
  "HIP_VISIBLE_DEVICES",
  "ROCR_VISIBLE_DEVICES",
  "LD_LIBRARY_PATH",
  "CUDA_HOME",
  "CUDA_PATH",
  "ROCM_PATH",
  "DTK_ROOT",
  "HIP_PATH",
  "HSA_OVERRIDE_GFX_VERSION",
] as const
const HOST_ENV_ALLOW = new Set(["DOCKER_CONTEXT", "DOCKER_HOST", "PATH"])

export function shells(session?: PlatformAuth.AuthSession, cwd?: string) {
  if (isOffHostRemoteCwd(session, cwd) || !session || PlatformAuth.terminalIsolationMode() === "native") return Shell.list()
  return Promise.resolve([
    {
      path: sandboxShell(),
      name: Shell.name(sandboxShell()),
      acceptable: true,
    },
  ])
}

export function shell(session: PlatformAuth.AuthSession | undefined, fallback: string, cwd?: string) {
  if (isOffHostRemoteCwd(session, cwd) || !session || PlatformAuth.terminalIsolationMode() === "native") return fallback
  return sandboxShell()
}

export function args(session: PlatformAuth.AuthSession | undefined, shell: string, command: string, cwd: string) {
  if (isOffHostRemoteCwd(session, cwd) || !session || PlatformAuth.terminalIsolationMode() === "native")
    return Shell.args(shell, command, path.resolve(resolveCwd(session, cwd)))
  const resolved = resolveCwd(session, cwd)
  if (PlatformAuth.terminalIsolationMode() !== "docker") return Shell.args(shell, command, resolved)
  return Shell.args(shell, command, containerCwd(requireWorkspaceRoot(session, resolved), resolved))
}

export function resolveCwd(session: PlatformAuth.AuthSession | undefined, cwd: string) {
  if (isOffHostRemoteCwd(session, cwd) || !session) return path.resolve(cwd)
  // Keep cwd for any non-shared-case project (including sibling workspaces).
  // bwrap binds the project directory when it falls outside the workspace root.
  if (PlatformAuth.isSharedCasesPath(cwd)) {
    return path.resolve(PlatformAuth.defaultWorkspaceRoot(session) ?? cwd)
  }
  return path.resolve(cwd)
}

export function prepare(input: CommandInput): PreparedCommand {
  if (isOffHostRemoteCwd(input.session, input.cwd) || !input.session)
    return { ...input, cwd: path.resolve(input.cwd), env: nativeEnv(input.env), sandboxed: false }
  const mode = PlatformAuth.terminalIsolationMode()
  if (mode === "native") return native(input)
  if (mode === "bubblewrap") return bwrap(input)
  if (mode === "docker") return docker(input)
  throw new Error("Terminal access requires ONECODE_TERMINAL_ISOLATION=bubblewrap, docker, or native")
}

function workspaceRoot(session: PlatformAuth.AuthSession, cwd: string) {
  return (
    PlatformAuth.workspaceRoots(session).find((root) => PlatformAuth.isPathInsideRoot(root, cwd)) ??
    PlatformAuth.defaultWorkspaceRoot(session)
  )
}

function requireWorkspaceRoot(session: PlatformAuth.AuthSession, cwd: string) {
  const root = workspaceRoot(session, cwd)
  if (!root) throw new Error("Platform account has no workspace root for terminal access")
  return path.resolve(root)
}

/**
 * Shared official OneSkills install root used by all accounts (same as oneskills package):
 * `$ONECODE_EXTRA_PATH/.opencode/oneskills`, else `~/.opencode/oneskills`.
 * Mounted read-only into terminal sandboxes so agents/users can inspect skill files
 * without modifying the shared tree.
 */
export function sharedOneskillsPath() {
  const base = OneCodeExtraPath.root() ?? Global.Path.home
  return path.join(base, ".opencode", "oneskills").replaceAll("\\", "/")
}

function sharedOneskillsBwrapArgs() {
  const target = sharedOneskillsPath()
  if (!target || !pathExists(target)) return [] as string[]
  return [...parentDirs(target).flatMap((item) => ["--dir", item]), "--ro-bind-try", target, target]
}

function sharedOneskillsDockerArgs() {
  const target = sharedOneskillsPath()
  if (!target || !pathExists(target)) return [] as string[]
  return ["--volume", `${target}:${target}:ro`]
}

/**
 * Per-account OpenSSH home (`platform-ssh/{accountId}/`: config + identities).
 *
 * Platform shells remap HOME to the account workspace, so host/user `~/.ssh`
 * must not be used. Expose this tree as `$HOME/.ssh` (symlink in native mode,
 * bind-mount in bubblewrap/docker) and keep the absolute path visible for
 * IdentityFile entries written under platform-ssh.
 */
export function platformSshHomeForSession(session: PlatformAuth.AuthSession) {
  return platformSshHome(session.account.id).replaceAll("\\", "/")
}

function ensurePlatformSshHome(session: PlatformAuth.AuthSession) {
  const home = platformSshHomeForSession(session)
  try {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 })
    fs.mkdirSync(path.join(home, "identities"), { recursive: true, mode: 0o700 })
  } catch {
    // best-effort: mounts/links still work if the tree already exists
  }
  return home
}

/**
 * Point `{sandboxHome}/.ssh` at the account platform-ssh tree so `~/.ssh/config`
 * is always the current user's config (native has no bind-mount).
 */
export function linkAccountSshHome(sandboxHome: string, platformSsh: string) {
  const linkPath = path.join(sandboxHome, ".ssh")
  const target = path.resolve(platformSsh)
  try {
    const st = fs.lstatSync(linkPath)
    if (st.isSymbolicLink()) {
      let current = fs.readlinkSync(linkPath)
      if (!path.isAbsolute(current)) current = path.resolve(path.dirname(linkPath), current)
      if (path.resolve(current) === target) return
      fs.unlinkSync(linkPath)
    } else {
      // Workspace-owned path: replace so a real directory cannot shadow account SSH.
      fs.rmSync(linkPath, { recursive: true, force: true })
    }
  } catch (err) {
    if (!(err && typeof err === "object" && "code" in err && err.code === "ENOENT")) {
      // continue to create attempt
    }
  }
  try {
    // Junctions work without admin on Windows; POSIX uses a normal symlink.
    fs.symlinkSync(target, linkPath, process.platform === "win32" ? "junction" : undefined)
  } catch {
    // best-effort: absolute IdentityFile paths still work on native full FS
  }
}

/**
 * bubblewrap cannot bind-mount onto a symlink (native mode leaves `~/.ssh` →
 * platform-ssh). Replace with an empty directory mount point on the host.
 */
export function ensureSshBindMountPoint(sandboxHome: string) {
  const mountPoint = path.join(sandboxHome, ".ssh")
  try {
    const st = fs.lstatSync(mountPoint)
    if (st.isSymbolicLink() || st.isFile()) {
      fs.unlinkSync(mountPoint)
    } else if (st.isDirectory()) {
      return mountPoint.replace(/\\/g, "/")
    } else {
      fs.rmSync(mountPoint, { recursive: true, force: true })
    }
  } catch (err) {
    if (!(err && typeof err === "object" && "code" in err && err.code === "ENOENT")) {
      // fall through to mkdir
    }
  }
  try {
    fs.mkdirSync(mountPoint, { recursive: true, mode: 0o700 })
  } catch {
    // best-effort: --dir in bwrap args may still create the path
  }
  return mountPoint.replace(/\\/g, "/")
}

function platformSshBwrapArgs(session: PlatformAuth.AuthSession, sandboxHome: string) {
  const target = ensurePlatformSshHome(session)
  if (!target || !pathExists(target)) return [] as string[]
  const homeSsh = ensureSshBindMountPoint(sandboxHome)
  return [
    ...parentDirs(target).flatMap((item) => ["--dir", item]),
    "--ro-bind-try",
    target,
    target,
    ...parentDirs(homeSsh).flatMap((item) => ["--dir", item]),
    "--dir",
    homeSsh,
    "--ro-bind-try",
    target,
    homeSsh,
  ]
}

function platformSshDockerArgs(session: PlatformAuth.AuthSession, containerHome: string) {
  const target = ensurePlatformSshHome(session)
  if (!target || !pathExists(target)) return [] as string[]
  const homeSsh = `${containerHome.replace(/\/+$/, "")}/.ssh`
  return ["--volume", `${target}:${target}:ro`, "--volume", `${target}:${homeSsh}:ro`]
}

/**
 * Native mode: no bwrap/docker, but platform multi-tenant still needs per-account
 * `~/.ssh`. Remap HOME to the workspace and symlink `.ssh` → platform-ssh/{id}.
 */
function native(input: CommandInput): PreparedCommand {
  const session = input.session!
  const cwd = resolveCwd(session, input.cwd)
  const root = requireWorkspaceRoot(session, input.cwd)
  const home = ensureSandboxHome(root)
  const platformSsh = ensurePlatformSshHome(session)
  linkAccountSshHome(home, platformSsh)
  const user = sandboxUserName(session)
  return {
    command: input.command,
    args: input.args,
    cwd,
    env: {
      ...nativeEnv(input.env),
      HOME: home,
      USER: user,
      LOGNAME: user,
      ONECODE_WORKSPACE_ROOT: root.replaceAll("\\", "/"),
      ONECODE_PLATFORM_SSH_HOME: platformSsh,
    },
    sandboxed: false,
  }
}

function sandboxShell() {
  return process.env.ONECODE_TERMINAL_SANDBOX_SHELL?.trim() || process.env.OPENCODE_TERMINAL_SANDBOX_SHELL?.trim() || DEFAULT_SANDBOX_SHELL
}

function dockerImage() {
  return process.env.ONECODE_TERMINAL_SANDBOX_IMAGE?.trim() || process.env.OPENCODE_TERMINAL_SANDBOX_IMAGE?.trim() || DEFAULT_DOCKER_IMAGE
}

function dockerWorkspace() {
  return process.env.ONECODE_TERMINAL_SANDBOX_WORKDIR?.trim() || process.env.OPENCODE_TERMINAL_SANDBOX_WORKDIR?.trim() || DEFAULT_DOCKER_WORKSPACE
}

function bwrapCommand() {
  return process.env.ONECODE_BWRAP_PATH?.trim() || process.env.OPENCODE_BWRAP_PATH?.trim() || "bwrap"
}

function dockerCommand() {
  return process.env.ONECODE_DOCKER_PATH?.trim() || process.env.OPENCODE_DOCKER_PATH?.trim() || "docker"
}

/**
 * Sandbox HOME is the account workspace root so `~` maps to
 * `.../workspaces/<account>/` and project dirs show as `~/default`, `~/case`.
 *
 * Path helpers (workspaceEnvRoot) must still tolerate HOME under workspaces so
 * OneCode itself never nests `~/privated_data/workspaces/...` again.
 */
export function sandboxHomePath(workspaceRoot: string) {
  return path.resolve(workspaceRoot).replaceAll("\\", "/")
}

/** Prompt / whoami identity inside the sandbox — platform account, not host OS user. */
export function sandboxUserName(session: PlatformAuth.AuthSession) {
  const raw = session.account.name?.trim() || session.account.email?.split("@")[0]?.trim() || "user"
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "")
  return (cleaned || "user").slice(0, 32)
}

const SHELL_ALIASES_REL = ".onecode/shell-aliases.sh"
const SHELL_HOOK_BEGIN = "# >>> onecode shell aliases >>>"
const SHELL_HOOK_END = "# <<< onecode shell aliases <<<"
const SHELL_HOOK = `${SHELL_HOOK_BEGIN}
[ -f "$HOME/${SHELL_ALIASES_REL}" ] && . "$HOME/${SHELL_ALIASES_REL}"
${SHELL_HOOK_END}`
const DEFAULT_SHELL_ALIASES = `# Managed by OneCode. Override in ~/.bashrc or ~/.zshrc after this file is sourced.
alias egrep='egrep --color=auto'
alias fgrep='fgrep --color=auto'
alias grep='grep --color=auto'
alias l='ls -CF'
alias la='ls -A'
alias ll='ls -alF'
alias ls='ls --color=auto'
alias mv='mv -i'
alias rm='rm -i'
`
const LOGIN_BASH_PROFILE = `# Login shell entry for OneCode terminals (bash -l).
[ -n "$BASH_VERSION" ] && [ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"
`

export function sandboxShellAliasesPath(home: string) {
  return path.join(home, SHELL_ALIASES_REL)
}

function ensureShellHook(file: string) {
  let current = ""
  try {
    current = fs.readFileSync(file, "utf8")
  } catch {
    fs.writeFileSync(file, `${SHELL_HOOK}\n`, { encoding: "utf8" })
    return
  }
  if (current.includes(SHELL_HOOK_BEGIN)) return
  fs.writeFileSync(file, `${SHELL_HOOK}\n${current}`, { encoding: "utf8" })
}

function firstExistingName(home: string, names: string[]) {
  return names.find((name) => {
    try {
      fs.accessSync(path.join(home, name))
      return true
    } catch {
      return false
    }
  })
}

/** Seed default aliases into remapped sandbox HOME (native / bubblewrap / docker). */
export function ensureSandboxShellAliases(home: string) {
  fs.mkdirSync(path.join(home, ".onecode"), { recursive: true })
  fs.writeFileSync(sandboxShellAliasesPath(home), DEFAULT_SHELL_ALIASES, { encoding: "utf8" })
  ensureShellHook(path.join(home, ".bashrc"))
  ensureShellHook(path.join(home, ".zshrc"))
  const loginName = firstExistingName(home, [".bash_profile", ".bash_login", ".profile"])
  if (loginName) {
    ensureShellHook(path.join(home, loginName))
    return
  }
  fs.writeFileSync(path.join(home, ".bash_profile"), LOGIN_BASH_PROFILE, { encoding: "utf8" })
}

function ensureSandboxHome(workspaceRoot: string) {
  const home = sandboxHomePath(workspaceRoot)
  try {
    fs.mkdirSync(home, { recursive: true })
    // Unix shells only; Windows platform terminals use PowerShell and ignore these rc files.
    if (process.platform !== "win32") ensureSandboxShellAliases(home)
  } catch {
    // best-effort: shell can still start if mkdir races or permissions differ
  }
  return home
}

function allowedEnv(
  env: Record<string, string>,
  home: string,
  cwd: string,
  options?: { path?: string; workspaceRoot?: string; user?: string; platformSshHome?: string },
) {
  const next = Object.fromEntries(
    Object.entries(env).filter(([key, value]) => typeof value === "string" && ENV_ALLOW.has(key.toUpperCase())),
  ) as Record<string, string>
  // Prefer host accelerator visibility when the caller did not set it explicitly.
  for (const key of HOST_ACCEL_ENV_KEYS) {
    if (next[key] !== undefined) continue
    const host = process.env[key]
    if (typeof host === "string" && host.length > 0) next[key] = host
  }
  const user = options?.user?.trim() || "user"
  const platformSsh = options?.platformSshHome?.replaceAll("\\", "/")
  return {
    ...next,
    PATH: options?.path ?? next.PATH ?? DEFAULT_SANDBOX_PATH,
    HOME: home,
    USER: user,
    LOGNAME: user,
    // Keep a stable prompt; host /etc/bashrc may otherwise leak confusing PS1.
    PS1: "\\u@\\h:\\w\\$ ",
    OPENCODE_TERMINAL: "1",
    PWD: cwd,
    ...(options?.workspaceRoot
      ? { ONECODE_WORKSPACE_ROOT: options.workspaceRoot.replaceAll("\\", "/") }
      : {}),
    // Account SSH is mounted at $HOME/.ssh and at this absolute path (IdentityFile).
    ...(platformSsh ? { ONECODE_PLATFORM_SSH_HOME: platformSsh } : {}),
  }
}

function hostEnv() {
  const next = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => typeof value === "string" && HOST_ENV_ALLOW.has(key.toUpperCase()),
    ),
  ) as Record<string, string>
  if (!next.PATH) next.PATH = process.env.PATH ?? process.env.Path ?? DEFAULT_SANDBOX_PATH
  return next
}

function nativeEnv(env: Record<string, string>) {
  const next = Object.fromEntries(Object.entries(env).filter(([, value]) => typeof value === "string")) as Record<
    string,
    string
  >
  if (!next.PATH) next.PATH = process.env.PATH ?? process.env.Path ?? DEFAULT_SANDBOX_PATH
  return next
}

function parentDirs(target: string) {
  const parts = path.posix.resolve(target.replace(/\\/g, "/")).split("/").filter(Boolean)
  return parts.slice(0, -1).map((_, index) => `/${parts.slice(0, index + 1).join("/")}`)
}

function extraReadOnlyBinds() {
  return (process.env.ONECODE_TERMINAL_SANDBOX_RO_BIND ?? process.env.OPENCODE_TERMINAL_SANDBOX_RO_BIND ?? "")
    .split(/[;\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function extraDevBinds() {
  return (process.env.ONECODE_TERMINAL_SANDBOX_DEV_BIND ?? process.env.OPENCODE_TERMINAL_SANDBOX_DEV_BIND ?? "")
    .split(/[;\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

/** Host accelerator passthrough (NVIDIA GPU + Hygon DCU / ROCm). Disable with ONECODE_TERMINAL_SANDBOX_GPU=0. */
function acceleratorPassthroughEnabled() {
  const raw = (
    process.env.ONECODE_TERMINAL_SANDBOX_ACCEL ??
    process.env.ONECODE_TERMINAL_SANDBOX_GPU ??
    process.env.OPENCODE_TERMINAL_SANDBOX_GPU ??
    "1"
  )
    .trim()
    .toLowerCase()
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "disabled" || raw === "none")
}

function isAcceleratorDevName(name: string) {
  // NVIDIA
  if (name === "nvidia-caps" || name.startsWith("nvidia")) return true
  // Hygon DCU / AMD ROCm share KFD + DRM render nodes
  if (name === "kfd" || name === "mkfd" || name === "dri") return true
  // WSL2 CUDA surface
  if (name === "dxg") return true
  return false
}

/** True when the host exposes at least one accelerator device node. */
export function hostHasAcceleratorDevices() {
  try {
    for (const name of fs.readdirSync("/dev")) {
      if (isAcceleratorDevName(name)) return true
    }
  } catch {
    // non-Linux
  }
  for (const name of ["nvidiactl", "nvidia0", "kfd", "mkfd", "dri", "dxg"]) {
    if (pathExists(`/dev/${name}`)) return true
  }
  return false
}

/**
 * Namespace flags for bubblewrap.
 *
 * Default: `--unshare-all --share-net` so OneCode can run as a normal multi-tenant
 * service user (filesystem / pid / ipc isolation) while keeping **host network**
 * (SSH, curl, package mirrors, etc.). Never require host root / sudo onecode.
 *
 * NVIDIA/CUDA often refuses init inside userns; for real GPU/DCU use prefer
 * `ONECODE_TERMINAL_ISOLATION=docker` (non-root OneCode + docker group + --gpus/--device).
 *
 * Advanced only:
 * - ONECODE_TERMINAL_SANDBOX_USERNS=0 → skip user ns (needs CAP_SYS_ADMIN; not for multi-tenant)
 * - ONECODE_TERMINAL_SANDBOX_SHARE_NET=0 → also isolate network (empty netns; outbound fails)
 */
export function bwrapUnshareArgs(): string[] {
  const force = (process.env.ONECODE_TERMINAL_SANDBOX_USERNS ?? "").trim().toLowerCase()
  const shareNet = bwrapShareHostNetwork()
  if (force === "0" || force === "false" || force === "none" || force === "skip") {
    return unshareWithoutUserArgs(shareNet)
  }
  return shareNet ? ["--unshare-all", "--share-net"] : ["--unshare-all"]
}

/** Default true: keep host network under bubblewrap. Opt out with SHARE_NET=0. */
export function bwrapShareHostNetwork() {
  const raw = (process.env.ONECODE_TERMINAL_SANDBOX_SHARE_NET ?? "").trim().toLowerCase()
  if (raw === "0" || raw === "false" || raw === "off" || raw === "none" || raw === "no") return false
  return true
}

function unshareWithoutUserArgs(shareNet: boolean) {
  if (shareNet) {
    return ["--unshare-pid", "--unshare-ipc", "--unshare-uts", "--unshare-cgroup"]
  }
  return ["--unshare-pid", "--unshare-ipc", "--unshare-net", "--unshare-uts", "--unshare-cgroup"]
}

let bwrapSizeFlag: boolean | undefined

function bwrapSupportsSizeFlag() {
  if (bwrapSizeFlag !== undefined) return bwrapSizeFlag
  if (process.platform === "win32") {
    bwrapSizeFlag = false
    return false
  }
  const result = spawnSync(bwrapCommand(), ["--help"], { encoding: "utf8", timeout: 3_000 })
  const help = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
  // Older Ubuntu bubblewrap has --tmpfs but not --size / --perms (Unknown option --size).
  bwrapSizeFlag = /(?:^|\s)--size(?:\s|=|$)/m.test(help)
  return bwrapSizeFlag
}

/**
 * Optionally enlarge sandbox /dev/shm for CUDA/HIP.
 * `--dev /dev` already creates a private shm; remounting with `--size` requires newer bwrap.
 * Default: no remount (compatible with older hosts). Set ONECODE_TERMINAL_SANDBOX_SHM_SIZE=<bytes>
 * to enlarge when supported; unsupported bwrap silently skips.
 */
function sandboxShmArgs() {
  const raw = process.env.ONECODE_TERMINAL_SANDBOX_SHM_SIZE?.trim()
  // Explicit disable
  if (raw === "0" || raw === "false" || raw === "off") return []
  // Default off for compatibility — older bwrap dies on unknown --size (breaks all terminals).
  if (!raw) return []
  if (!/^\d+$/.test(raw)) return []
  if (!bwrapSupportsSizeFlag()) return []
  return ["--size", raw, "--perms", "1777", "--tmpfs", "/dev/shm"]
}

function pathExists(target: string) {
  try {
    return fs.existsSync(target)
  } catch {
    return false
  }
}

/**
 * `--dev /dev` creates a minimal private /dev; host accelerators must be bound explicitly.
 * Covers NVIDIA (`/dev/nvidia*`) and Hygon DCU / ROCm (`/dev/kfd`, `/dev/mkfd`, `/dev/dri`).
 * `/dev/shm` is sized separately via sandboxShmArgs() — do not remount host shm here.
 */
export function hostAcceleratorDevBinds() {
  if (!acceleratorPassthroughEnabled()) return [] as string[]
  const seen = new Set<string>()
  const args: string[] = []
  const add = (target: string) => {
    const full = path.posix.resolve(target.replace(/\\/g, "/"))
    if (seen.has(full)) return
    seen.add(full)
    args.push("--dev-bind-try", full, full)
  }
  try {
    for (const name of fs.readdirSync("/dev")) {
      if (isAcceleratorDevName(name)) add(`/dev/${name}`)
    }
  } catch {
    // ignore missing /dev (non-Linux test hosts)
  }
  // Well-known nodes even if readdir is filtered (ENOENT is ignored by -try at runtime).
  for (const name of [
    "kfd",
    "mkfd",
    "dri",
    "dxg",
    "nvidiactl",
    "nvidia-uvm",
    "nvidia-uvm-tools",
    "nvidia-modeset",
    "nvidia-caps",
  ]) {
    add(`/dev/${name}`)
  }
  for (const item of extraDevBinds()) {
    const [source, target] = item.includes("=") ? item.split("=", 2) : [item, item]
    const fullSource = path.posix.resolve(source.replace(/\\/g, "/"))
    const fullTarget = path.posix.resolve((target || source).replace(/\\/g, "/"))
    if (seen.has(fullTarget)) continue
    seen.add(fullTarget)
    args.push("--dev-bind-try", fullSource, fullTarget)
  }
  return args
}

/** @deprecated use hostAcceleratorDevBinds */
export function hostGpuDevBinds() {
  return hostAcceleratorDevBinds()
}

/** Extra RO binds for accelerator user-space stacks (hyhal / DTK / ROCm / CUDA). */
export function hostAcceleratorRoBinds() {
  if (!acceleratorPassthroughEnabled()) return [] as string[]
  const seen = new Set<string>()
  const args: string[] = []
  const add = (target: string) => {
    const full = path.posix.resolve(target.replace(/\\/g, "/"))
    if (seen.has(full) || !pathExists(full)) return
    seen.add(full)
    args.push("--ro-bind-try", full, full)
  }
  for (const item of ACCELERATOR_RO_PATHS) add(item)
  // Versioned DTK trees commonly installed as /opt/DTK-24.04.x
  try {
    for (const name of fs.readdirSync("/opt")) {
      if (/^dtk/i.test(name) || /^rocm/i.test(name) || /^cuda/i.test(name) || name === "hyhal") {
        add(`/opt/${name}`)
      }
    }
  } catch {
    // ignore
  }
  // WSL2 NVIDIA user-space shims
  add("/usr/lib/wsl/lib")
  return args
}

function bindArgs(flag: string, value: string) {
  const [source, target] = value.includes("=") ? value.split("=", 2) : [value, value]
  return [flag, source, target]
}

let warnedAcceleratorUserns = false
function warnAcceleratorUsernsOnce() {
  if (warnedAcceleratorUserns) return
  warnedAcceleratorUserns = true
  console.warn(
    "[terminal-sandbox] accelerator devices present with bubblewrap+userns; CUDA/HIP often fail here. " +
      "Prefer ONECODE_TERMINAL_ISOLATION=docker (non-root OneCode in the docker group) for GPU/DCU terminals.",
  )
}

function bwrap(input: CommandInput): PreparedCommand {
  const root = requireWorkspaceRoot(input.session!, input.cwd)
  const cwd = resolveCwd(input.session, input.cwd)
  const home = ensureSandboxHome(root)
  const user = sandboxUserName(input.session!)
  const platformSsh = ensurePlatformSshHome(input.session!)
  const env = allowedEnv(input.env, home, cwd, { workspaceRoot: root, user, platformSshHome: platformSsh })
  const forAccelerator = acceleratorPassthroughEnabled()
  const unshare = bwrapUnshareArgs()

  // When the terminal is opened from a project outside the workspace root (e.g. a
  // sibling workspace under the same account), bind that project's directory too
  // so --chdir succeeds and the user lands in the project path, not the root.
  const extraBinds: string[] = []
  const normalizedCwd = path.resolve(cwd).replace(/\\/g, "/")
  const normalizedRoot = path.resolve(root).replace(/\\/g, "/")
  if (!normalizedCwd.startsWith(`${normalizedRoot}/`) && normalizedCwd !== normalizedRoot) {
    extraBinds.push(...parentDirs(normalizedCwd).flatMap((item) => ["--dir", item]))
    extraBinds.push("--bind", normalizedCwd, normalizedCwd)
  }

  if (forAccelerator && hostHasAcceleratorDevices() && unshare.includes("--unshare-all")) {
    warnAcceleratorUsernsOnce()
  }

  return {
    command: bwrapCommand(),
    args: [
      ...unshare,
      "--die-with-parent",
      "--new-session",
      "--clearenv",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      ...hostAcceleratorDevBinds(),
      ...sandboxShmArgs(),
      "--tmpfs",
      "/tmp",
      "--dir",
      "/run",
      ...BWRAP_RO_BIND.flatMap((item) => ["--ro-bind-try", item, item]),
      ...hostAcceleratorRoBinds(),
      ...extraReadOnlyBinds().flatMap((item) => bindArgs("--ro-bind-try", item)),
      ...sharedOneskillsBwrapArgs(),
      ...parentDirs(root).flatMap((item) => ["--dir", item]),
      "--bind",
      root,
      root,
      // Overlay after workspace bind so $HOME/.ssh is the account platform-ssh tree.
      ...platformSshBwrapArgs(input.session!, home),
      ...extraBinds,
      ...Object.entries(env).flatMap(([key, value]) => ["--setenv", key, value]),
      "--chdir",
      cwd,
      "--",
      input.command,
      ...input.args,
    ],
    cwd: root,
    env: hostEnv(),
    sandboxed: true,
  }
}

function containerCwd(root: string, cwd: string) {
  const relative = path.relative(root, cwd).replace(/\\/g, "/")
  if (!relative) return dockerWorkspace()
  return `${dockerWorkspace().replace(/\/+$/, "")}/${relative}`
}

function dockerAcceleratorArgs() {
  if (!acceleratorPassthroughEnabled()) return [] as string[]
  const args: string[] = []
  // NVIDIA Container Toolkit (no-op / fail at runtime if toolkit missing — docker mode is optional).
  if (pathExists("/dev/nvidiactl") || pathExists("/dev/nvidia0")) {
    args.push("--gpus", "all")
  }
  // Hygon DCU / ROCm device nodes (official container docs).
  for (const device of ["/dev/kfd", "/dev/mkfd", "/dev/dri"]) {
    if (pathExists(device)) args.push(`--device=${device}`)
  }
  for (const volume of ACCELERATOR_RO_PATHS) {
    if (pathExists(volume)) args.push("--volume", `${volume}:${volume}:ro`)
  }
  // Host DTK / hyhal / CUDA trees under /opt (versioned dirs).
  if (pathExists("/opt")) args.push("--volume", "/opt:/opt:ro")
  // Match common DCU/NVIDIA container recommendations; keep process non-root via --user.
  args.push("--group-add", "video", "--group-add", "render", "--ipc", "host")
  return args
}

function docker(input: CommandInput): PreparedCommand {
  const root = requireWorkspaceRoot(input.session!, input.cwd)
  const cwd = resolveCwd(input.session, input.cwd)
  ensureSandboxHome(root)
  const containerRoot = dockerWorkspace().replace(/\/+$/, "")
  const user = sandboxUserName(input.session!)
  const platformSsh = ensurePlatformSshHome(input.session!)
  const env = allowedEnv(input.env, containerRoot, containerCwd(root, cwd), {
    path: DEFAULT_SANDBOX_PATH,
    workspaceRoot: containerRoot,
    user,
    platformSshHome: platformSsh,
  })
  return {
    command: dockerCommand(),
    args: [
      "run",
      "--rm",
      "-i",
      ...(input.interactive ? ["-t"] : []),
      ...dockerUserArgs(),
      ...dockerAcceleratorArgs(),
      "--workdir",
      containerCwd(root, cwd),
      "--volume",
      `${root}:${dockerWorkspace()}`,
      ...sharedOneskillsDockerArgs(),
      ...platformSshDockerArgs(input.session!, containerRoot),
      ...Object.entries(env).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
      dockerImage(),
      input.command,
      ...input.args,
    ],
    cwd: root,
    env: hostEnv(),
    sandboxed: true,
  }
}

function dockerUserArgs() {
  if (typeof process.getuid !== "function" || typeof process.getgid !== "function") return []
  return ["--user", `${process.getuid()}:${process.getgid()}`]
}
