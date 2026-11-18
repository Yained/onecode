import {
  applyServerRuntimeEnvironment,
  projectAllowsRemoteEnvironment,
  restoreProjectRuntimeEnvironment,
  runtimeEnvironmentFor,
  withRuntimeEnvironmentBatch,
  type RuntimeEnvironment,
} from "@/components/onescience/runtime-environment"
import { setRemoteWorkspacePaths, isAutoDefaultRemotePath } from "@/components/onescience/remote-workspace"
import { authTokenFromCredentials } from "@/utils/server"
import { storedPlatformAuthToken } from "@/utils/platform-auth"

export const PROJECT_EXECUTION_MARKER = ".onescience-execution.json"

export function serializeProjectExecutionMarker(env: RuntimeEnvironment, remotePath?: string) {
  if (env.kind === "ssh") {
    return JSON.stringify(
      {
        kind: "ssh",
        targetName: env.targetName,
        ...(remotePath?.trim() ? { remotePath: remotePath.trim() } : {}),
      },
      null,
      2,
    )
  }
  if (env.kind === "scnet") {
    return JSON.stringify(
      { kind: "scnet", ...(env.serverName ? { serverName: env.serverName } : {}) },
      null,
      2,
    )
  }
  return JSON.stringify({ kind: "local" }, null, 2)
}

export function parseProjectExecutionMarker(raw: unknown): RuntimeEnvironment | undefined {
  const record = markerRecord(raw)
  if (!record) return undefined
  if (record.kind === "local") return { kind: "local" }
  const sshName =
    (typeof record.targetName === "string" && record.targetName.trim()) ||
    (typeof record.sshTarget === "string" && record.sshTarget.trim()) ||
    ""
  if (record.kind === "ssh" && sshName) {
    return { kind: "ssh", targetName: sshName }
  }
  if (record.kind === "scnet") {
    return {
      kind: "scnet",
      ...(typeof record.serverName === "string" && record.serverName.trim()
        ? { serverName: record.serverName.trim() }
        : {}),
    }
  }
  return undefined
}

/** Control-plane / marker JSON may also carry the last remote cwd for this project. */
export function remotePathFromProjectExecution(raw: unknown): string | undefined {
  const record = markerRecord(raw)
  if (!record || record.kind !== "ssh") return undefined
  return typeof record.remotePath === "string" && record.remotePath.trim() ? record.remotePath.trim() : undefined
}

function markerRecord(raw: unknown): Record<string, unknown> | undefined {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw !== "string") return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
  return undefined
}

export function extractFileReadText(data: unknown): string {
  if (typeof data === "string") return data
  if (!data || typeof data !== "object") return ""
  const content = (data as { content?: unknown }).content
  return typeof content === "string" ? content : ""
}

export function sshEvidenceFromRuntime(env?: RuntimeEnvironment): { kind: "ssh"; targetName: string } | undefined {
  if (env?.kind === "ssh" && env.targetName.trim()) return { kind: "ssh", targetName: env.targetName.trim() }
  return undefined
}

export function sshEvidenceFromBinding(binding?: { targetName?: string } | null): { kind: "ssh"; targetName: string } | undefined {
  const name = binding?.targetName?.trim()
  if (!name) return undefined
  return { kind: "ssh", targetName: name }
}

export type ListedWorkspace = {
  id?: string
  type?: string
  directory?: string | null
  extra?: unknown
}

export function sshEvidenceFromWorkspaceList(workspaces: readonly ListedWorkspace[] | undefined): { kind: "ssh"; targetName: string } | undefined {
  const live = liveSshWorkspaceFromList(workspaces)
  if (live) return { kind: "ssh", targetName: live.targetName }
  return sshTargetFromWorkspaceList(workspaces)
}

function sshTargetFromWorkspaceList(workspaces: readonly ListedWorkspace[] | undefined): { kind: "ssh"; targetName: string } | undefined {
  for (const item of workspaces ?? []) {
    const targetName = sshTargetName(item)
    if (targetName) return { kind: "ssh", targetName }
  }
  return undefined
}

export function liveSshWorkspaceFromList(workspaces: readonly ListedWorkspace[] | undefined): {
  workspaceID: string
  targetName: string
  remotePath?: string
} | undefined {
  for (const item of workspaces ?? []) {
    const targetName = sshTargetName(item)
    const workspaceID = item?.id?.trim()
    if (!targetName || !workspaceID) continue
    const remotePath = workspaceRemotePath(item)
    return { workspaceID, targetName, ...(remotePath ? { remotePath } : {}) }
  }
  return undefined
}

function sshTargetName(item: ListedWorkspace | undefined) {
  if (!item || item.type !== "ssh-node") return undefined
  const extra = item.extra
  if (!extra || typeof extra !== "object") return undefined
  const target = (extra as { sshTarget?: unknown }).sshTarget
  return typeof target === "string" && target.trim() ? target.trim() : undefined
}

function workspaceRemotePath(item: ListedWorkspace) {
  const extra = item.extra
  if (extra && typeof extra === "object") {
    const path = (extra as { remotePath?: unknown }).remotePath
    if (typeof path === "string" && path.trim()) return path.trim()
  }
  return typeof item.directory === "string" && item.directory.trim() ? item.directory.trim() : undefined
}

export type ProjectExecutionHydrateClient = {
  fileRead: (path: string) => Promise<unknown>
}

export async function hydrateProjectRuntimeEnvironment(
  directory: string,
  client: ProjectExecutionHydrateClient,
): Promise<{ env: RuntimeEnvironment; remotePath?: string } | undefined> {
  if (!directory || !projectAllowsRemoteEnvironment(directory)) return undefined
  if (runtimeEnvironmentFor(directory).kind !== "local") return undefined

  const file = await client.fileRead(PROJECT_EXECUTION_MARKER).catch(() => undefined)
  const text = extractFileReadText(file)
  const fromFile = sshEvidenceFromRuntime(parseProjectExecutionMarker(text))
  if (fromFile && restoreProjectRuntimeEnvironment(directory, fromFile)) {
    const remotePath = remotePathFromProjectExecution(text)
    if (remotePath) {
      setRemoteWorkspacePaths([{ directory, targetName: fromFile.targetName, remotePath }])
    }
    return { env: fromFile, ...(remotePath ? { remotePath } : {}) }
  }
  return undefined
}

export function projectExecutionHydrateClientFromSdk(
  sdk: {
    client: {
      file: {
        read: (input: { path: string; directory?: string }) => Promise<{ data?: unknown }>
        write: (input: { path: string; content: string; directory?: string }) => Promise<unknown>
      }
    }
  },
  directory: string,
): ProjectExecutionHydrateClient {
  return {
    fileRead: async (path) => {
      const result = await sdk.client.file.read({ path, directory })
      return result.data
    },
  }
}

export async function persistProjectExecutionMarker(
  write: (input: { path: string; content: string; directory?: string }) => Promise<unknown>,
  directory: string,
  env: RuntimeEnvironment,
  remotePath?: string,
) {
  if (!directory || env.kind === "local") return
  await write({
    directory,
    path: PROJECT_EXECUTION_MARKER,
    content: serializeProjectExecutionMarker(env, remotePath),
  })
}

/** Prefer binding, then control-plane execution. Skip auto-default bindings when CP has a real path. */
export function resolveProjectRemotePath(input: {
  directory: string
  bindingPath?: string
  execution?: unknown
}) {
  const fromExec = remotePathFromProjectExecution(input.execution)
  const fromBinding = input.bindingPath?.trim() || undefined
  if (fromBinding && !isAutoDefaultRemotePath(fromBinding)) return fromBinding
  if (fromExec) return fromExec
  return fromBinding
}

export function applyServerProjectExecutions(
  projects: Array<{ worktree?: string; execution?: unknown } | null | undefined>,
) {
  const pathRestores: Array<{ directory: string; targetName: string; remotePath: string }> = []
  withRuntimeEnvironmentBatch(() => {
    for (const project of projects) {
      if (!project?.worktree) continue
      if (!projectAllowsRemoteEnvironment(project.worktree)) {
        applyServerRuntimeEnvironment(project.worktree, { kind: "local" })
        continue
      }
      const env = parseProjectExecutionMarker(project.execution)
      // Missing execution must NOT stamp server-local: that blocked marker restore and
      // made unbound remotes instance-bootstrap (cache-clear / first-click freeze).
      // Explicit CP `{ kind: "local" }` still clears a stale SSH preference.
      if (!env) continue
      applyServerRuntimeEnvironment(project.worktree, env)
      const remotePath = remotePathFromProjectExecution(project.execution)
      if (env.kind === "ssh" && remotePath) {
        pathRestores.push({ directory: project.worktree, targetName: env.targetName, remotePath })
      }
    }
  })
  setRemoteWorkspacePaths(pathRestores)
}

export function controlPlaneExecutionBody(env: RuntimeEnvironment, remotePath?: string) {
  if (env.kind === "ssh") {
    return {
      kind: "ssh" as const,
      sshTarget: env.targetName,
      ...(remotePath?.trim() ? { remotePath: remotePath.trim() } : {}),
    }
  }
  if (env.kind === "local") return { kind: "local" as const }
  return undefined
}

export async function persistProjectExecutionToControlPlane(input: {
  globalUrl: string
  directory: string
  projectID?: string
  env: RuntimeEnvironment
  remotePath?: string
  auth?: { username?: string; password?: string }
}) {
  if (!input.directory) return
  const env = projectAllowsRemoteEnvironment(input.directory) ? input.env : { kind: "local" as const }
  const execution = controlPlaneExecutionBody(env, env.kind === "ssh" ? input.remotePath : undefined)
  if (!execution) return
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (input.auth?.password) {
    headers.Authorization = `Basic ${authTokenFromCredentials({
      username: input.auth.username,
      password: input.auth.password,
    })}`
  }
  const platformToken = storedPlatformAuthToken()
  if (platformToken) headers["x-platform-auth-token"] = platformToken
  await fetch(`${input.globalUrl.replace(/\/$/, "")}/global/project/execution`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      directory: input.directory,
      ...(input.projectID ? { projectID: input.projectID } : {}),
      execution,
    }),
  }).catch(() => undefined)
}
