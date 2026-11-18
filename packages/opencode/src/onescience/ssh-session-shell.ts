import type { ConfigSSH } from "@/config/ssh"

type SshAuth = {
  type?: "config" | "agent" | "key" | "password"
  keyPath?: string
  password?: string
}

type SshConnection = {
  host: string
  hostName?: string
  port?: number
  username?: string
  options?: Record<string, string>
  auth?: SshAuth
}

export type SshRuntimeSelection = {
  targetName: string
  condaEnv?: string
}

export type ResolvedSshShellTarget = {
  name: string
  remotePath: string
  ssh: SshConnection
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function condaPrefix(condaEnv: string | undefined) {
  const name = condaEnv?.trim()
  if (!name) return ""
  return `source $(conda info --base 2>/dev/null)/etc/profile.d/conda.sh 2>/dev/null; conda activate ${shellQuote(name)} && `
}

export function parseSshRuntimeFromText(text: string): SshRuntimeSelection | undefined {
  const env =
    text.match(/^SSH 远程\s*[·(（]\s*([^\n）)]+)/m) ||
    text.match(/^Execution Environment:\s*SSH 远程\s*[·(（]\s*([^\n）)]+)/m)
  const targetName = env?.[1]?.trim()
  if (!targetName || /配置缺失/.test(targetName)) return undefined
  const conda =
    text.match(/^Conda[：:]\s*(\S+)\s*$/m)?.[1]?.trim() || text.match(/^Conda Env:\s*(\S+)\s*$/m)?.[1]?.trim()
  return conda ? { targetName, condaEnv: conda } : { targetName }
}

export function parseSshRuntimeFromMessages(
  messages: ReadonlyArray<{ info?: { role?: string }; parts?: ReadonlyArray<{ type?: string; text?: string }> }>,
): SshRuntimeSelection | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.info?.role !== "user") continue
    for (const part of msg.parts ?? []) {
      if (part.type !== "text" || !part.text) continue
      const parsed = parseSshRuntimeFromText(part.text)
      if (parsed) return parsed
    }
  }
}

export function sshRemoteWorkdir(requested: string | undefined, remotePath: string) {
  const value = requested?.trim()
  if (!value) return remotePath
  if (/^[a-zA-Z]:[\\/]/.test(value)) return remotePath
  if (value.includes("\\")) return remotePath
  return value
}

export function wrapSshShellCommand(command: string, workdir: string, condaEnv?: string) {
  const setup = `${condaPrefix(condaEnv)}cd ${shellQuote(workdir)} && `
  return `bash -lc ${shellQuote(`${setup}${command}`)}`
}

export function resolveSshShellTarget(
  targetName: string,
  ssh: Record<string, ConfigSSH.Info | { enabled?: boolean }> | undefined,
): ResolvedSshShellTarget | undefined {
  const target = ssh?.[targetName]
  if (!target || !("host" in target) || typeof target.host !== "string" || !target.host.trim()) return undefined
  if (!("remotePath" in target) || typeof target.remotePath !== "string" || !target.remotePath.trim()) return undefined
  if (target.enabled === false) return undefined
  return {
    name: targetName,
    remotePath: target.remotePath,
    ssh: {
      host: target.host,
      ...(target.hostName ? { hostName: target.hostName } : {}),
      ...(target.port ? { port: target.port } : {}),
      ...(target.username ? { username: target.username } : {}),
      ...(target.options ? { options: target.options } : {}),
      ...(target.auth
        ? {
            auth: {
              type: target.auth.type,
              keyPath: target.auth.keyPath,
              ...(target.auth.type === "password" && target.auth.password ? { password: target.auth.password } : {}),
            },
          }
        : {}),
    },
  }
}

export function sshShellPassword(target: ResolvedSshShellTarget) {
  return target.ssh.auth?.type === "password" ? target.ssh.auth.password : undefined
}
