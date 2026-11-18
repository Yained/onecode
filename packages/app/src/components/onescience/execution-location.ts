export type ExecutionLocationId = "generate-only" | "local" | "slurm" | "ssh-slurm" | "mcp"

export type LocalSlurmCapability = {
  available: boolean
  sbatchVersion?: string
  sinfoAvailable?: boolean
  partitions?: string[]
  detail: string
}

export type SshTargetOption = {
  name: string
  host: string
  hostName?: string
  port?: number
  username?: string
  remotePath: string
  enabled?: boolean
  options?: Record<string, string>
  auth?: {
    type?: "config" | "agent" | "key" | "password"
    keyPath?: string
    password?: string
  }
}

export type SshConnectivityState = "idle" | "testing" | "connected" | "failed" | "skipped"

export type RegisteredSshTarget = SshTargetOption & {
  connectivity: SshConnectivityState
  connectivityMessage?: string
}

export type ScnetMcpAvailability = {
  available: boolean
  configured: boolean
  connected: boolean
  name?: string
  detail: string
}

export type ExecutionLocationAvailability = {
  id: ExecutionLocationId
  enabled: boolean
  detail?: string
  reason?: string
}

const alwaysEnabled: ExecutionLocationId[] = ["generate-only", "local"]

export function isScnetMcpName(name: string) {
  return /scnet/i.test(name)
}

type SshConfigRecord = Record<string, SshTargetOption | Omit<SshTargetOption, "name">> | undefined

function isRegisteredSshConfig(config: SshTargetOption | Omit<SshTargetOption, "name"> | undefined): config is Omit<SshTargetOption, "name"> & { host: string } {
  return !!config && typeof config === "object" && !!config.host?.trim()
}

export function listRegisteredSshTargets(ssh: SshConfigRecord): SshTargetOption[] {
  return Object.entries(ssh ?? {})
    .filter((entry): entry is [string, Omit<SshTargetOption, "name"> & { host: string; remotePath: string }] => isRegisteredSshConfig(entry[1]))
    .map(([name, config]) => ({
      name,
      host: config.host,
      hostName: config.hostName,
      port: config.port,
      username: config.username,
      remotePath: config.remotePath,
      enabled: config.enabled,
      options: "options" in config ? (config as { options?: Record<string, string> }).options : undefined,
      auth: config.auth,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function listEnabledSshTargets(ssh: SshConfigRecord): SshTargetOption[] {
  return listRegisteredSshTargets(ssh).filter((item) => item.enabled !== false)
}

export function sshConnectivityLabel(state: SshConnectivityState) {
  if (state === "connected") return "可连通"
  if (state === "failed") return "未连通"
  if (state === "testing") return "检测中"
  if (state === "skipped") return "已禁用"
  return "待检测"
}

export function summarizeRegisteredSshTargets(targets: readonly RegisteredSshTarget[]) {
  const registered = targets.length
  const enabled = targets.filter((item) => item.enabled !== false).length
  const connected = targets.filter((item) => item.connectivity === "connected").length
  if (registered === 0) return "未注册 SSH 配置"
  const parts = [`已注册 ${registered} 个`]
  if (enabled !== registered) parts.push(`${enabled} 个已启用`)
  if (connected > 0) parts.push(`${connected} 个可连通`)
  return parts.join(" · ")
}

export function isSshConnectivityPending(targets: readonly RegisteredSshTarget[]) {
  return targets.length > 0 && targets.some((item) => item.connectivity === "idle" || item.connectivity === "testing")
}

export function countConnectableSshTargets(targets: readonly RegisteredSshTarget[]) {
  return targets.filter((item) => item.enabled !== false && item.connectivity === "connected").length
}

export function summarizeConnectableSshTargets(
  targets: readonly RegisteredSshTarget[],
  probing = false,
  progress?: { current: number; total: number; name?: string },
) {
  if (probing || isSshConnectivityPending(targets)) {
    if (progress && progress.total > 0) {
      const name = progress.name ? ` · ${progress.name}` : ""
      return `正在检测 SSH 连通性（${progress.current}/${progress.total}）${name}`
    }
    return "正在检测 SSH 连通性..."
  }
  const connectable = countConnectableSshTargets(targets)
  if (targets.length === 0) return "未注册 SSH 配置"
  if (connectable > 0) return `${connectable} 个可用`
  const enabled = targets.filter((item) => item.enabled !== false).length
  if (enabled === 0) return "没有已启用的 SSH 配置"
  return "没有可连通的 SSH 配置"
}

export function sshTestPayload(target: SshTargetOption) {
  return {
    host: target.host,
    remotePath: target.remotePath,
    ...(target.hostName ? { hostName: target.hostName } : {}),
    ...(target.port ? { port: target.port } : {}),
    ...(target.username ? { username: target.username } : {}),
    ...(target.options ? { options: target.options } : {}),
    ...(target.auth ? { auth: target.auth } : {}),
  }
}

export function resolveScnetMcpAvailability(mcp: Record<string, { status?: string } | undefined> | undefined): ScnetMcpAvailability {
  const entries = Object.entries(mcp ?? {}).filter(([name]) => isScnetMcpName(name))
  if (entries.length === 0) {
    return {
      available: false,
      configured: false,
      connected: false,
      detail: "未配置 scnet MCP",
    }
  }
  const connected = entries.find(([, status]) => status?.status === "connected")
  if (!connected) {
    return {
      available: false,
      configured: true,
      connected: false,
      name: entries[0]?.[0],
      detail: "scnet MCP 已配置但未连接",
    }
  }
  return {
    available: true,
    configured: true,
    connected: true,
    name: connected[0],
    detail: `已连接 ${connected[0]}`,
  }
}

export function resolveExecutionLocationAvailability(input: {
  slurm?: LocalSlurmCapability
  registeredSshTargets: readonly RegisteredSshTarget[]
  mcp: ScnetMcpAvailability
  sshProbeLoading?: boolean
  sshProbeProgress?: { current: number; total: number; name?: string }
}): ExecutionLocationAvailability[] {
  const slurmAvailable = input.slurm?.available === true
  const sshPending = input.sshProbeLoading === true || isSshConnectivityPending(input.registeredSshTargets)
  const sshConnectable = countConnectableSshTargets(input.registeredSshTargets)
  const sshSummary = summarizeConnectableSshTargets(
    input.registeredSshTargets,
    sshPending,
    input.sshProbeProgress,
  )
  return (["generate-only", "local", "slurm", "ssh-slurm", "mcp"] as const).map((id) => {
    if (alwaysEnabled.includes(id)) return { id, enabled: true }
    if (id === "slurm") {
      return slurmAvailable
        ? { id, enabled: true, detail: input.slurm?.detail }
        : { id, enabled: false, reason: input.slurm?.detail || "当前环境未检测到可用的 Slurm（sbatch）" }
    }
    if (id === "ssh-slurm") {
      if (sshPending) return { id, enabled: false, reason: sshSummary }
      if (sshConnectable > 0) return { id, enabled: true, detail: sshSummary }
      return {
        id,
        enabled: false,
        reason: input.registeredSshTargets.length === 0
          ? "请先在集成面板注册至少一个 SSH 配置"
          : sshSummary,
      }
    }
    return input.mcp.available
      ? { id, enabled: true, detail: input.mcp.detail }
      : { id, enabled: false, reason: input.mcp.detail || "需要启用并连接 scnet MCP" }
  })
}

export function sshTargetPromptFields(target: SshTargetOption | undefined) {
  if (!target) return [] as string[]
  return [`SSH Target: ${target.name}`, `SSH Remote Path: ${target.remotePath}`]
}
