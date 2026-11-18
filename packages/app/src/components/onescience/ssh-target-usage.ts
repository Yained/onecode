import { pathKey } from "@/utils/path-key"
import { parseProjectExecutionMarker } from "@/components/onescience/project-execution"
import {
  applyServerRuntimeEnvironment,
  runtimeEnvironmentFor,
  type RuntimeEnvironment,
} from "@/components/onescience/runtime-environment"
import {
  boundWorkspaceID,
  remoteWorkspaceFor,
  remoteWorkspaceRevision,
  setRemoteWorkspaceFor,
} from "@/components/onescience/remote-workspace"
import type { SshConfigForm } from "@/components/dialog-select-ssh-form"

export type SshTargetProjectUsage = {
  directory: string
  name: string
  connected: boolean
}

export type SshIdentityFields = {
  host?: string
  hostName?: string
  username?: string
  port?: number
  enabled?: boolean
  auth?: { type?: string; keyPath?: string; password?: string }
}

function trim(value: string | undefined) {
  return value?.trim() ?? ""
}

function authKind(auth: SshIdentityFields["auth"]) {
  return auth?.type === "password" ? "password" : "key"
}

export function projectDisplayName(input: { name?: string | null; worktree?: string | null }) {
  const named = input.name?.trim()
  if (named) return named
  const parts = (input.worktree ?? "").replaceAll("\\", "/").split("/").filter(Boolean)
  return parts[parts.length - 1] || input.worktree?.trim() || "untitled"
}

export function formatSshTargetProjectNames(projects: Array<{ name: string }>) {
  return projects.map((project) => project.name).filter(Boolean).join("、")
}

export function sshIdentityChanged(previous: SshIdentityFields | undefined, next: SshIdentityFields) {
  if (!previous) return false
  if (trim(previous.host) !== trim(next.host)) return true
  if (trim(previous.hostName) !== trim(next.hostName)) return true
  if (trim(previous.username) !== trim(next.username)) return true
  if ((previous.port ?? 22) !== (next.port ?? 22)) return true
  if (authKind(previous.auth) !== authKind(next.auth)) return true
  if (authKind(next.auth) === "password") return (previous.auth?.password ?? "") !== (next.auth?.password ?? "")
  return trim(previous.auth?.keyPath) !== trim(next.auth?.keyPath)
}

export function sshDisableRequested(previous: SshIdentityFields | undefined, next: SshIdentityFields) {
  if (!previous) return false
  return previous.enabled !== false && next.enabled === false
}

export function sshConfigIdentity(config: unknown): SshIdentityFields | undefined {
  if (!config || typeof config !== "object" || !("host" in config)) return undefined
  const record = config as SshIdentityFields & { host?: string }
  if (typeof record.host !== "string" || !record.host.trim()) return undefined
  return {
    host: record.host,
    ...(typeof record.hostName === "string" ? { hostName: record.hostName } : {}),
    ...(typeof record.username === "string" ? { username: record.username } : {}),
    ...(typeof record.port === "number" ? { port: record.port } : {}),
    ...(typeof record.enabled === "boolean" ? { enabled: record.enabled } : {}),
    ...(record.auth ? { auth: record.auth } : {}),
  }
}

export function sshFormIdentity(form: SshConfigForm): SshIdentityFields {
  const port = Number(form.port.trim())
  return {
    host: form.hostName,
    hostName: form.hostName,
    username: form.username,
    port: Number.isInteger(port) && port > 0 ? port : undefined,
    auth:
      form.authType === "password"
        ? { type: "password", password: form.password }
        : { type: "key", keyPath: form.keyPath },
  }
}

export function listSshTargetProjects(input: {
  sshName: string
  projects: Array<{ name?: string | null; worktree?: string | null; execution?: unknown }>
  envFor?: (directory: string) => RuntimeEnvironment
  connectedFor?: (directory: string) => boolean
}): SshTargetProjectUsage[] {
  const sshName = input.sshName.trim()
  if (!sshName) return []
  const envFor = input.envFor ?? runtimeEnvironmentFor
  const connectedFor = input.connectedFor ?? ((directory: string) => Boolean(boundWorkspaceID(directory)))
  const seen = new Set<string>()
  const result: SshTargetProjectUsage[] = []
  for (const project of input.projects) {
    const directory = project.worktree?.trim()
    if (!directory) continue
    const key = pathKey(directory)
    if (seen.has(key)) continue
    const execution = parseProjectExecutionMarker(project.execution)
    const env = envFor(directory)
    const bound =
      (execution?.kind === "ssh" && execution.targetName === sshName) ||
      (env.kind === "ssh" && env.targetName === sshName)
    if (!bound) continue
    seen.add(key)
    result.push({
      directory,
      name: projectDisplayName(project),
      connected: connectedFor(directory),
    })
  }
  return result.sort((left, right) => left.name.localeCompare(right.name))
}

export function cascadeClientSshTarget(from: string, to: string, directories: string[]) {
  const source = from.trim()
  const target = to.trim()
  if (!source || !target || source === target) return
  for (const directory of directories) {
    applyServerRuntimeEnvironment(directory, { kind: "ssh", targetName: target })
    const binding = remoteWorkspaceFor(directory)
    if (binding?.targetName === source) {
      setRemoteWorkspaceFor(directory, { ...binding, targetName: target })
    }
  }
}

/** Keep Solid memos subscribed to live connection state. */
export function sshTargetUsageRevision() {
  return remoteWorkspaceRevision()
}
