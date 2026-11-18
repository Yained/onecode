export type SshIdentityFields = {
  host?: string
  hostName?: string
  username?: string
  port?: number
  enabled?: boolean
  auth?: { type?: string; keyPath?: string; password?: string }
}

export type SshConnectedMutation = "remove" | "rename" | "identity" | "disable"

export type SshTargetProjectUsage = {
  projectID: string
  worktree: string
  name: string
  connected: boolean
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
  return parts[parts.length - 1] || input.worktree?.trim() || "未命名项目"
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
  const previousAuth = previous.auth
  const nextAuth = next.auth
  if (authKind(previousAuth) !== authKind(nextAuth)) return true
  if (authKind(nextAuth) === "password") return (previousAuth?.password ?? "") !== (nextAuth?.password ?? "")
  return trim(previousAuth?.keyPath) !== trim(nextAuth?.keyPath)
}

export function sshDisableRequested(previous: SshIdentityFields | undefined, next: SshIdentityFields) {
  if (!previous) return false
  return previous.enabled !== false && next.enabled === false
}

export function connectedSshMutation(input: {
  previousName?: string
  nextName: string
  previous?: SshIdentityFields
  next: SshIdentityFields
}): Exclude<SshConnectedMutation, "remove"> | undefined {
  if (input.previousName && input.previousName !== input.nextName) return "rename"
  if (sshIdentityChanged(input.previous, input.next)) return "identity"
  if (sshDisableRequested(input.previous, input.next)) return "disable"
  return undefined
}

export function sshTargetBusyMessage(kind: SshConnectedMutation, name: string, projects: string[]) {
  const listed = projects.filter(Boolean).join("、") || "未知项目"
  if (kind === "remove") {
    return `SSH 配置「${name}」正在被已连接的项目使用：${listed}。请先断开连接后再删除。`
  }
  if (kind === "rename") {
    return `SSH 配置「${name}」正在被已连接的项目使用：${listed}。请先断开连接后再重命名。`
  }
  if (kind === "disable") {
    return `SSH 配置「${name}」正在被已连接的项目使用：${listed}。请先断开连接后再禁用。`
  }
  return `SSH 配置「${name}」正在被已连接的项目使用：${listed}。请先断开连接后再修改主机、用户或认证。`
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

export function sshConfigSnapshot(name: string, product: unknown, disk: unknown) {
  const productMap = asStringRecord(product)
  const diskMap = asStringRecord(disk)
  const fromDisk = sshConfigIdentity(diskMap?.[name])
  const fromProduct = sshConfigIdentity(productMap?.[name])
  if (!fromDisk && !fromProduct) return undefined
  return {
    ...fromDisk,
    ...fromProduct,
    auth: fromProduct?.auth ?? fromDisk?.auth,
  }
}

function asStringRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

export function collectSshTargetUsage(input: {
  sshTarget: string
  projects: Array<{ id: string; name?: string | null; worktree: string; execution?: unknown }>
  workspaces: Array<{ type: string; project_id: string; extra?: unknown }>
  parseExecution: (raw: unknown) => { kind: string; sshTarget?: string } | undefined
  parseWorkspace: (extra: unknown) => { sshTarget?: string } | undefined
  workspaceType: string
}): SshTargetProjectUsage[] {
  const sshTarget = input.sshTarget.trim()
  if (!sshTarget) return []
  const connectedIds = new Set<string>()
  for (const workspace of input.workspaces) {
    if (workspace.type !== input.workspaceType) continue
    const extra = input.parseWorkspace(workspace.extra)
    if (extra?.sshTarget?.trim() === sshTarget) connectedIds.add(workspace.project_id)
  }
  const seen = new Set<string>()
  const result: SshTargetProjectUsage[] = []
  for (const project of input.projects) {
    const execution = input.parseExecution(project.execution)
    const bound = execution?.kind === "ssh" && execution.sshTarget?.trim() === sshTarget
    const connected = connectedIds.has(project.id)
    if (!bound && !connected) continue
    seen.add(project.id)
    result.push({
      projectID: project.id,
      worktree: project.worktree,
      name: projectDisplayName(project),
      connected,
    })
  }
  for (const workspace of input.workspaces) {
    if (workspace.type !== input.workspaceType) continue
    const extra = input.parseWorkspace(workspace.extra)
    if (extra?.sshTarget?.trim() !== sshTarget) continue
    if (seen.has(workspace.project_id)) continue
    const project = input.projects.find((item) => item.id === workspace.project_id)
    if (!project) continue
    seen.add(project.id)
    result.push({
      projectID: project.id,
      worktree: project.worktree,
      name: projectDisplayName(project),
      connected: true,
    })
  }
  return result.sort((left, right) => left.name.localeCompare(right.name))
}
