import fs from "fs"
import os from "os"
import path from "path"
import { isSshKnownHostsOptionKey } from "@/config/ssh-known-hosts"
import { Process, type Child, type Options, type RunOptions, type Result } from "@/util/process"

const UNIX_SSH_DIRS = ["/usr/local/bin", "/usr/bin", "/bin"]
const PASSWORD_OPTION_SKIP = new Set([
  "batchmode",
  "passwordauthentication",
  "pubkeyauthentication",
  "preferredauthentications",
  "kbdinteractiveauthentication",
  "numberofpasswordprompts",
])

export type SshCliAuth = {
  type?: "config" | "agent" | "key" | "password"
  keyPath?: string
  password?: string
}

export function sshSearchPath(base = process.env.PATH ?? process.env.Path ?? "") {
  if (process.platform === "win32") return base
  const prefix = UNIX_SSH_DIRS.join(path.delimiter)
  if (!base) return prefix
  return `${prefix}${path.delimiter}${base}`
}

function executableName(cmd: string) {
  if (process.platform !== "win32") return cmd
  return cmd.toLowerCase().endsWith(".exe") ? cmd : `${cmd}.exe`
}

function isExecutable(file: string) {
  try {
    fs.accessSync(file, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function resolveSshExecutable(env: NodeJS.ProcessEnv = process.env) {
  const override = env.SSH_PATH?.trim() || env.ONECODE_SSH?.trim()
  if (override) return override
  // Bun/Node resolve a bare "ssh" against the *current process* PATH, not the
  // child env. systemd/non-login PATH often omits what an interactive shell has,
  // so always spawn an absolute path when the binary exists on disk.
  const PATH = sshSearchPath(env.PATH ?? env.Path)
  for (const dir of PATH.split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, executableName("ssh"))
    if (isExecutable(candidate)) return candidate
  }
  return "ssh"
}

export function describeSshLookup() {
  const bin = resolveSshExecutable()
  const PATH = process.env.PATH ?? process.env.Path ?? ""
  return { bin, PATH }
}

export function sshProcessEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, PATH: sshSearchPath(env.PATH ?? env.Path) }
}

export function isSshMissingError(text: string) {
  return (
    /Executable not found in \$PATH:\s*["']?ssh["']?/i.test(text) ||
    /spawn ssh ENOENT/i.test(text) ||
    /not found: ssh/i.test(text)
  )
}

export function sshMissingOnServerMessage() {
  const { bin, PATH } = describeSshLookup()
  const pathHint = PATH.trim() ? PATH : "(empty)"
  if (bin !== "ssh") {
    return `OneCode backend failed to spawn ssh at ${bin}. Process PATH=${pathHint}`
  }
  return `OneCode backend cannot find ssh on this process PATH (login-shell which ssh is not used). Process PATH=${pathHint}. If /usr/bin/ssh exists, restart the OneCode service so it picks up the binary via absolute path.`
}

export function resolveNamedExecutable(cmd: string, env: NodeJS.ProcessEnv = process.env) {
  const PATH = sshSearchPath(env.PATH ?? env.Path)
  for (const dir of PATH.split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, executableName(cmd))
    if (isExecutable(candidate)) return candidate
  }
  return undefined
}

export function sshAuthCliArgs(auth: SshCliAuth | undefined, options?: Record<string, string>) {
  const type = auth?.type === "agent" || !auth?.type ? "config" : auth.type
  const args: string[] = []
  if (type !== "password") args.push("-o", "BatchMode=yes")
  args.push("-o", "ConnectTimeout=8")
  for (const [key, value] of Object.entries(options ?? {})) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) continue
    if (isSshKnownHostsOptionKey(key)) continue
    if (type === "password" && PASSWORD_OPTION_SKIP.has(key.toLowerCase())) continue
    args.push("-o", `${key}=${value}`)
  }
  if (type === "key" && auth?.keyPath) {
    args.push("-i", auth.keyPath, "-o", "IdentitiesOnly=yes")
  }
  if (type === "password") {
    args.push(
      "-o",
      "PreferredAuthentications=password,keyboard-interactive",
      "-o",
      "PubkeyAuthentication=no",
      "-o",
      "NumberOfPasswordPrompts=1",
    )
  }
  return args
}

function writeAskpassScript(password: string) {
  const file = path.join(os.tmpdir(), `os-askpass-${process.pid}-${Date.now()}${process.platform === "win32" ? ".cmd" : ""}`)
  if (process.platform === "win32") {
    const escaped = password.replaceAll("^", "^^").replaceAll("%", "%%").replaceAll("&", "^&").replaceAll("<", "^<").replaceAll(">", "^>")
    fs.writeFileSync(file, `@echo off\r\necho ${escaped}\r\n`, { encoding: "utf8" })
  } else {
    const escaped = password.replaceAll("'", "'\\''")
    fs.writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' '${escaped}'\n`, { mode: 0o700 })
    fs.chmodSync(file, 0o700)
  }
  return file
}

export type SshRunOptions = RunOptions & { password?: string }
export type SshSpawnOptions = Options & { password?: string }

function attachPassword(env: NodeJS.ProcessEnv, password: string) {
  const sshpass = resolveNamedExecutable("sshpass", env)
  if (sshpass) {
    return { bin: sshpass, prefix: ["-e"] as string[], env: { ...env, SSHPASS: password }, askpass: undefined }
  }
  const askpass = writeAskpassScript(password)
  return {
    bin: undefined as string | undefined,
    prefix: [] as string[],
    env: {
      ...env,
      DISPLAY: env.DISPLAY || "none",
      SSH_ASKPASS: askpass,
      SSH_ASKPASS_REQUIRE: "force",
    },
    askpass,
  }
}

export async function runSshProcess(args: string[], opts: SshRunOptions = {}): Promise<Result> {
  const { password, ...runOpts } = opts
  const env = sshProcessEnv(runOpts.env ?? process.env)
  const bin = resolveSshExecutable(env)
  if (!password) return Process.run([bin, ...args], { ...runOpts, env })

  const auth = attachPassword(env, password)
  try {
    return await Process.run([auth.bin ?? bin, ...auth.prefix, ...(auth.bin ? [bin] : []), ...args], {
      ...runOpts,
      env: auth.env,
    })
  } finally {
    if (auth.askpass) fs.unlink(auth.askpass, () => undefined)
  }
}

export function spawnSshProcess(args: string[], opts: SshSpawnOptions = {}): Child {
  const { password, ...spawnOpts } = opts
  const env = sshProcessEnv(spawnOpts.env ?? process.env)
  const bin = resolveSshExecutable(env)
  if (!password) return Process.spawn([bin, ...args], { ...spawnOpts, env })

  const auth = attachPassword(env, password)
  const child = Process.spawn([auth.bin ?? bin, ...auth.prefix, ...(auth.bin ? [bin] : []), ...args], {
    ...spawnOpts,
    env: auth.env,
  })
  if (auth.askpass) {
    void child.exited.finally(() => fs.unlink(auth.askpass!, () => undefined))
  }
  return child
}
