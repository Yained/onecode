export const SSH_NODE_TYPE = "ssh-node"
export const MARKER_NAME = ".onescience-workspace.json"

export type SshNodeMarker = {
  version: 1
  workspaceID: string
  controlPlaneId: string
  accountId: string
  projectID: string
  createdAt: number
  servePort?: number
}

export type SshNodeExtra = {
  sshTarget: string
  remotePath?: string
  /** True when remotePath was generated as ~/.onecode/workspaces/... and may be mkdir'd. */
  createRemoteDir?: boolean
  servePort?: number
  localPort?: number
  catalogPort?: number
  catalogForward?: boolean
  accountId?: string
  controlPlaneId?: string
  projectSlug?: string
  /** Opened local project directory this ssh-node belongs to. Isolates sibling folders. */
  localDirectory?: string
  /** Snapshot of the SSH target used at connect time (same payload as workspace preflight). */
  ssh?: SshNodeTargetSnapshot
  progressKey?: string
}

export type SshNodeTargetSnapshot = {
  host: string
  remotePath: string
  hostName?: string
  port?: number
  username?: string
  options?: Record<string, string>
  auth?: { type?: "config" | "agent" | "key" | "password"; keyPath?: string; password?: string }
  enabled?: boolean
}

function parseSshSnapshot(value: unknown): SshNodeTargetSnapshot | undefined {
  if (!value || typeof value !== "object") return
  const entry = value as Record<string, unknown>
  if (typeof entry.host !== "string" || !entry.host.trim()) return
  const port = typeof entry.port === "number" && Number.isInteger(entry.port) ? entry.port : undefined
  const auth = entry.auth && typeof entry.auth === "object" ? (entry.auth as SshNodeTargetSnapshot["auth"]) : undefined
  const options =
    entry.options && typeof entry.options === "object" ? (entry.options as Record<string, string>) : undefined
  return {
    host: entry.host.trim(),
    remotePath: typeof entry.remotePath === "string" ? entry.remotePath.trim() : "",
    ...(typeof entry.hostName === "string" && entry.hostName.trim() ? { hostName: entry.hostName.trim() } : {}),
    ...(port && port >= 1 && port <= 65535 ? { port } : {}),
    ...(typeof entry.username === "string" && entry.username.trim() ? { username: entry.username.trim() } : {}),
    ...(options ? { options } : {}),
    ...(auth ? { auth } : {}),
    ...(typeof entry.enabled === "boolean" ? { enabled: entry.enabled } : {}),
  }
}

export function sanitizePathSegment(value: string) {
  const trimmed = value.trim()
  const cleaned = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "")
  return cleaned || "default"
}

export function fingerprintDirectory(directory: string) {
  const normalized = directory.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
  let hash = 5381
  for (let i = 0; i < normalized.length; i++) {
    hash = Math.imul(hash, 33) ^ normalized.charCodeAt(i)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

export function projectSlugFor(directory: string) {
  const parts = directory.replaceAll("\\", "/").split("/").filter(Boolean)
  const name = sanitizePathSegment(parts[parts.length - 1] || "default")
  return `${name}-${fingerprintDirectory(directory)}`
}

export function normalizeDirectoryKey(directory: string) {
  return directory.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
}

/** True when an ssh-node (or other workspace extra) belongs to this opened folder. */
export function workspaceBelongsToDirectory(input: {
  extra: unknown
  workspaceProjectID: string
  openedDirectory: string
  openedProjectID: string
}) {
  const record =
    input.extra && typeof input.extra === "object" && !Array.isArray(input.extra)
      ? (input.extra as Record<string, unknown>)
      : undefined
  const local = typeof record?.localDirectory === "string" ? record.localDirectory.trim() : ""
  const slug = typeof record?.projectSlug === "string" ? record.projectSlug.trim() : ""
  if (local) return normalizeDirectoryKey(local) === normalizeDirectoryKey(input.openedDirectory)
  if (slug) return slug === projectSlugFor(input.openedDirectory)
  return input.workspaceProjectID === input.openedProjectID
}

export function posixJoin(...parts: string[]) {
  return parts
    .map((part, index) => {
      const value = part.replaceAll("\\", "/").replace(/\/+$/, "")
      if (index === 0) return value.replace(/\/+$/, "") || "/"
      return value.replace(/^\/+/, "")
    })
    .filter((part, index) => (index === 0 ? part.length > 0 : part.length > 0))
    .join("/")
    .replace(/\/{2,}/g, "/")
}

export function defaultRemotePath(input: {
  basePath: string
  controlPlaneId: string
  accountId: string
  projectSlug: string
}) {
  // Leave the root slash intact; posixJoin removes trailing separators safely.
  const base = input.basePath.replaceAll("\\", "/") || "."
  return posixJoin(
    base,
    "onecode_remote/workspaces",
    sanitizePathSegment(input.controlPlaneId),
    sanitizePathSegment(input.accountId),
    sanitizePathSegment(input.projectSlug),
  )
}

export function parseSshNodeExtra(extra: unknown): SshNodeExtra | undefined {
  if (!extra || typeof extra !== "object") return undefined
  const record = extra as Record<string, unknown>
  if (typeof record.sshTarget !== "string" || !record.sshTarget.trim()) return undefined
  const ssh = parseSshSnapshot(record.ssh)
  return {
    sshTarget: record.sshTarget.trim(),
    ...(typeof record.remotePath === "string" && record.remotePath.trim() ? { remotePath: record.remotePath.trim() } : {}),
    ...(typeof record.createRemoteDir === "boolean" ? { createRemoteDir: record.createRemoteDir } : {}),
    ...(typeof record.servePort === "number" && Number.isFinite(record.servePort) ? { servePort: record.servePort } : {}),
    ...(typeof record.localPort === "number" && Number.isFinite(record.localPort) ? { localPort: record.localPort } : {}),
    ...(typeof record.catalogPort === "number" && Number.isFinite(record.catalogPort) ? { catalogPort: record.catalogPort } : {}),
    ...(typeof record.catalogForward === "boolean" ? { catalogForward: record.catalogForward } : {}),
    ...(typeof record.accountId === "string" && record.accountId.trim() ? { accountId: record.accountId.trim() } : {}),
    ...(typeof record.controlPlaneId === "string" && record.controlPlaneId.trim()
      ? { controlPlaneId: record.controlPlaneId.trim() }
      : {}),
    ...(typeof record.projectSlug === "string" && record.projectSlug.trim()
      ? { projectSlug: record.projectSlug.trim() }
      : {}),
    ...(typeof record.localDirectory === "string" && record.localDirectory.trim()
      ? { localDirectory: record.localDirectory.trim() }
      : {}),
    ...(ssh ? { ssh } : {}),
    ...(typeof record.progressKey === "string" && record.progressKey.trim()
      ? { progressKey: record.progressKey.trim() }
      : {}),
  }
}

export function parseMarker(text: string): SshNodeMarker | undefined {
  try {
    const data = JSON.parse(text) as Partial<SshNodeMarker>
    if (data.version !== 1) return undefined
    if (typeof data.workspaceID !== "string" || !data.workspaceID.trim()) return undefined
    if (typeof data.controlPlaneId !== "string" || !data.controlPlaneId.trim()) return undefined
    if (typeof data.accountId !== "string" || !data.accountId.trim()) return undefined
    if (typeof data.projectID !== "string" || !data.projectID.trim()) return undefined
    return {
      version: 1,
      workspaceID: data.workspaceID,
      controlPlaneId: data.controlPlaneId,
      accountId: data.accountId,
      projectID: data.projectID,
      createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
      ...(typeof data.servePort === "number" && Number.isFinite(data.servePort) && data.servePort > 0
        ? { servePort: data.servePort }
        : {}),
    }
  } catch {
    return undefined
  }
}

export function encodeMarker(marker: SshNodeMarker) {
  return `${JSON.stringify(marker, null, 2)}\n`
}

export function markerConflict(
  existing: SshNodeMarker | undefined,
  expected: Pick<SshNodeMarker, "controlPlaneId" | "accountId"> & { projectID?: string },
) {
  if (!existing) return undefined
  if (sanitizePathSegment(existing.controlPlaneId) !== sanitizePathSegment(expected.controlPlaneId)) {
    return `远端目录已被其他 control plane（${existing.controlPlaneId}）占用`
  }
  if (sanitizePathSegment(existing.accountId) !== sanitizePathSegment(expected.accountId)) {
    return `远端目录已被其他账号（${existing.accountId}）占用`
  }
  return undefined
}
