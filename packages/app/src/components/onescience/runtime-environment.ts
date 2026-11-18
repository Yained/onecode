import { createMemo, createSignal, type Accessor } from "solid-js"
import { useQuery } from "@tanstack/solid-query"
import { useGlobalSync } from "@/context/global-sync"
import { pathKey } from "@/utils/path-key"
import {
  listRegisteredSshTargets,
  resolveScnetMcpAvailability,
  type RegisteredSshTarget,
  type ScnetMcpAvailability,
  type SshTargetOption,
} from "@/components/onescience/execution-location"
import { useRegisteredSshConnectivity } from "@/components/onescience/use-registered-ssh-connectivity"
import {
  lastMessageRuntimeEnvironment,
  type MessageRuntimeEnvironment,
} from "@opencode-ai/ui/runtime-environment-marker"
import { isDefaultPlatformProject, isDefaultProjectWorktree, storedPlatformAuthSession } from "@/utils/platform-auth"

export type RuntimeEnvironment =
  | { kind: "local" }
  | { kind: "ssh"; targetName: string }
  | { kind: "scnet"; serverName?: string }

const STORAGE_KEY = "onescience.runtime-environment.v1"

type RuntimeEnvironmentMap = Record<string, RuntimeEnvironment>

let memory: RuntimeEnvironmentMap | undefined

const [revision, setRevision] = createSignal(0)
export const runtimeEnvironmentRevision = revision

let batchDepth = 0
let batchDirty = false

/** Stamp many projects in one paint — avoids N revision + localStorage writes on login. */
export function withRuntimeEnvironmentBatch(fn: () => void) {
  batchDepth += 1
  try {
    fn()
  } finally {
    batchDepth -= 1
    if (batchDepth === 0 && batchDirty) {
      batchDirty = false
      writeMap(readMap())
      setRevision((value) => value + 1)
    }
  }
}

function readMap(): RuntimeEnvironmentMap {
  if (memory) return memory
  if (typeof localStorage === "undefined") {
    memory = {}
    return memory
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    memory = raw ? (JSON.parse(raw) as RuntimeEnvironmentMap) : {}
  } catch {
    memory = {}
  }
  return memory
}

function writeMap(map: RuntimeEnvironmentMap) {
  memory = map
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // ignore quota / private mode
  }
}

function normalize(input: unknown): RuntimeEnvironment | undefined {
  if (!input || typeof input !== "object") return undefined
  const record = input as Record<string, unknown>
  if (record.kind === "local") return { kind: "local" }
  if (record.kind === "ssh" && typeof record.targetName === "string" && record.targetName.trim()) {
    return { kind: "ssh", targetName: record.targetName }
  }
  if (record.kind === "scnet") {
    return {
      kind: "scnet",
      ...(typeof record.serverName === "string" && record.serverName ? { serverName: record.serverName } : {}),
    }
  }
  return undefined
}

export function defaultRuntimeEnvironment(): RuntimeEnvironment {
  return { kind: "local" }
}

export function projectAllowsRemoteEnvironment(directory: string) {
  if (isDefaultProjectWorktree(directory)) return false
  return !isDefaultPlatformProject(storedPlatformAuthSession(), directory)
}

export function runtimeEnvironmentFor(directory: string): RuntimeEnvironment {
  if (!directory) return defaultRuntimeEnvironment()
  if (!projectAllowsRemoteEnvironment(directory)) return defaultRuntimeEnvironment()
  const server = normalize(readServerMap()[pathKey(directory)])
  if (server) return server
  return normalize(readMap()[pathKey(directory)]) ?? defaultRuntimeEnvironment()
}

export function serverRuntimeEnvironmentFor(directory: string): RuntimeEnvironment | undefined {
  if (!directory) return undefined
  return normalize(readServerMap()[pathKey(directory)])
}

export function applyServerRuntimeEnvironment(directory: string, env: RuntimeEnvironment) {
  if (!directory) return
  const next = projectAllowsRemoteEnvironment(directory) ? env : defaultRuntimeEnvironment()
  writeServerMap({ ...readServerMap(), [pathKey(directory)]: next })
  setRuntimeEnvironmentFor(directory, next)
}

let serverMemory: RuntimeEnvironmentMap | undefined

function readServerMap(): RuntimeEnvironmentMap {
  return serverMemory ?? {}
}

function writeServerMap(map: RuntimeEnvironmentMap) {
  serverMemory = map
}

export function setRuntimeEnvironmentFor(directory: string, env: RuntimeEnvironment) {
  if (!directory) return
  const next = projectAllowsRemoteEnvironment(directory) ? env : defaultRuntimeEnvironment()
  const key = pathKey(directory)
  const maps = readMap()
  const servers = readServerMap()
  // Project bootstrap stamps every worktree; skipping no-ops avoids N revision
  // bumps remounting SessionEnvironmentBar / file tree / SDK on login.
  if (envKeyOf(normalize(maps[key]) ?? defaultRuntimeEnvironment()) === envKeyOf(next) &&
      envKeyOf(normalize(servers[key]) ?? defaultRuntimeEnvironment()) === envKeyOf(next)) {
    return
  }
  memory = { ...maps, [key]: next }
  writeServerMap({ ...servers, [key]: next })
  if (batchDepth > 0) {
    batchDirty = true
    return
  }
  writeMap(memory)
  setRevision((value) => value + 1)
}

/** Upgrade missing/local cache → ssh from durable evidence. Never rewrite an existing SSH binding to local. */
export function restoreProjectRuntimeEnvironment(directory: string, evidence: RuntimeEnvironment): boolean {
  if (!directory || evidence.kind === "local") return false
  if (!projectAllowsRemoteEnvironment(directory)) return false
  const server = serverRuntimeEnvironmentFor(directory)
  // Explicit CP local blocks restore. Missing stamp must not (cache-clear poison).
  if (server?.kind === "local") return false
  const current = runtimeEnvironmentFor(directory)
  if (current.kind !== "local") return false
  setRuntimeEnvironmentFor(directory, evidence)
  return true
}

export function resetRuntimeEnvironmentForTest() {
  memory = undefined
  serverMemory = undefined
  sessionEnvMemory = undefined
  batchDepth = 0
  batchDirty = false
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(SESSION_ENV_STORAGE_KEY)
    } catch {
      // ignore
    }
  }
  clearCondaMemory()
  setSessionEnvRevision((value) => value + 1)
  setRevision((value) => value + 1)
}

export function envKeyOf(env: RuntimeEnvironment) {
  if (env.kind === "ssh") return `ssh:${env.targetName}`
  if (env.kind === "scnet") return `scnet:${env.serverName ?? ""}`
  return "local"
}

const SESSION_ENV_STORAGE_KEY = "onescience.session-bound-environment.v1"

type SessionEnvironmentMap = Record<string, RuntimeEnvironment>

let sessionEnvMemory: SessionEnvironmentMap | undefined
const [sessionEnvRevision, setSessionEnvRevision] = createSignal(0)
export const sessionBoundEnvironmentRevision = sessionEnvRevision

function readSessionEnvMap(): SessionEnvironmentMap {
  if (sessionEnvMemory) return sessionEnvMemory
  if (typeof localStorage === "undefined") {
    sessionEnvMemory = {}
    return sessionEnvMemory
  }
  try {
    const raw = localStorage.getItem(SESSION_ENV_STORAGE_KEY)
    sessionEnvMemory = raw ? (JSON.parse(raw) as SessionEnvironmentMap) : {}
  } catch {
    sessionEnvMemory = {}
  }
  return sessionEnvMemory
}

function writeSessionEnvMap(map: SessionEnvironmentMap) {
  sessionEnvMemory = map
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(SESSION_ENV_STORAGE_KEY, JSON.stringify(map))
  } catch {
    // ignore
  }
}

export function sessionBoundEnvironmentFor(sessionID: string): RuntimeEnvironment | undefined {
  if (!sessionID) return undefined
  return normalize(readSessionEnvMap()[sessionID])
}

export function setSessionBoundEnvironmentFor(sessionID: string, env: RuntimeEnvironment) {
  if (!sessionID) return
  writeSessionEnvMap({ ...readSessionEnvMap(), [sessionID]: env })
  setSessionEnvRevision((value) => value + 1)
}

export function inferSessionBoundEnvironment(input: {
  sessionID?: string
  messages: Array<{ id: string; role?: string; environment?: MessageRuntimeEnvironment }>
  partsByMessage?: Record<
    string,
    Array<{ type: string; text?: string; synthetic?: boolean; ignored?: boolean }> | undefined
  >
  sessionWorkspaceID?: string | null
  binding?: { workspaceID?: string; targetName: string }
}): RuntimeEnvironment | undefined {
  if (!input.sessionID) return undefined
  const stored = sessionBoundEnvironmentFor(input.sessionID)
  if (stored) return stored
  const fromMessages = lastRuntimeEnvironmentFromMessages(input.messages, input.partsByMessage)
  if (fromMessages) return fromMessages
  if (!input.messages.some((message) => message.role === "user")) return undefined
  if (
    input.sessionWorkspaceID &&
    input.binding?.workspaceID &&
    input.sessionWorkspaceID === input.binding.workspaceID
  ) {
    return { kind: "ssh", targetName: input.binding.targetName }
  }
  return defaultRuntimeEnvironment()
}

export function sessionEnvironmentMismatch(
  sessionEnv: RuntimeEnvironment | undefined,
  projectEnv: RuntimeEnvironment,
) {
  if (!sessionEnv) return false
  return envKeyOf(sessionEnv) !== envKeyOf(projectEnv)
}

export function lastRuntimeEnvironmentFromMessages(
  messages: Array<{ id: string; role?: string; environment?: MessageRuntimeEnvironment }>,
  partsByMessage?: Record<string, Array<{ type: string; text?: string; synthetic?: boolean; ignored?: boolean }> | undefined>,
): RuntimeEnvironment | undefined {
  const found = lastMessageRuntimeEnvironment(messages, partsByMessage)
  if (!found) return undefined
  if (found.kind === "ssh") return { kind: "ssh", targetName: found.targetName }
  if (found.kind === "scnet") {
    return { kind: "scnet", ...(found.name ? { serverName: found.name } : {}) }
  }
  return { kind: "local" }
}

export function resolveSessionRuntimeEnvironment(
  messages: Array<{ id: string; role?: string; environment?: MessageRuntimeEnvironment }>,
  partsByMessage?: Record<string, Array<{ type: string; text?: string; synthetic?: boolean; ignored?: boolean }> | undefined>,
): { env: RuntimeEnvironment; ready: boolean; source: "explicit" | "default" } {
  const inferred = lastRuntimeEnvironmentFromMessages(messages, partsByMessage)
  if (inferred) return { env: inferred, ready: true, source: "explicit" }
  if (messages.length === 0) return { env: defaultRuntimeEnvironment(), ready: true, source: "default" }
  const lastUser = [...messages].reverse().find((message) => message.role === "user")
  if (!lastUser) return { env: defaultRuntimeEnvironment(), ready: false, source: "default" }
  if (!partsByMessage || partsByMessage[lastUser.id] === undefined) {
    return { env: defaultRuntimeEnvironment(), ready: false, source: "default" }
  }
  return { env: defaultRuntimeEnvironment(), ready: true, source: "default" }
}

export function shouldApplySessionRuntimeEnvironment(input: {
  resolved: { env: RuntimeEnvironment; ready: boolean; source: "explicit" | "default" }
  current: RuntimeEnvironment
  binding?: { targetName: string; workspaceID?: string }
  sessionWorkspaceID?: string | null
  hasUserTurns?: boolean
}) {
  if (!input.resolved.ready) return false
  if (envKeyOf(input.current) === envKeyOf(input.resolved.env)) return false
  // Missing metadata is not proof of local. Keep SSH for an empty new session
  // (inherit the live workspace) and for a session still bound to that workspace.
  // A local transcript with turns and no workspace_id must switch the bar back.
  if (
    input.resolved.source === "default" &&
    input.resolved.env.kind === "local" &&
    input.binding &&
    input.current.kind === "ssh" &&
    input.current.targetName === input.binding.targetName
  ) {
    if (
      input.sessionWorkspaceID &&
      input.binding.workspaceID &&
      input.sessionWorkspaceID === input.binding.workspaceID
    ) {
      return false
    }
    if (!input.hasUserTurns) return false
  }
  return true
}

export function handoffRenderKey(
  env: RuntimeEnvironment,
  ctx?: { sshTarget?: SshTargetOption; condaEnv?: string },
) {
  const conda = ctx?.condaEnv?.trim() ?? ""
  if (env.kind === "ssh") {
    const host = ctx?.sshTarget?.host ?? ""
    const remotePath = ctx?.sshTarget?.remotePath ?? ""
    return `ssh:${env.targetName}:${host}:${remotePath}:${conda}`
  }
  return `${envKeyOf(env)}:${conda}`
}

const CONDA_STORAGE_KEY = "onescience.session-conda.v1"

type SessionCondaMap = Record<string, string>

let condaMemory: SessionCondaMap | undefined
const [condaRevision, setCondaRevision] = createSignal(0)
export const sessionCondaEnvRevision = condaRevision

function readCondaMap(): SessionCondaMap {
  if (condaMemory) return condaMemory
  if (typeof localStorage === "undefined") {
    condaMemory = {}
    return condaMemory
  }
  try {
    const raw = localStorage.getItem(CONDA_STORAGE_KEY)
    condaMemory = raw ? (JSON.parse(raw) as SessionCondaMap) : {}
  } catch {
    condaMemory = {}
  }
  return condaMemory
}

function writeCondaMap(map: SessionCondaMap) {
  condaMemory = map
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(CONDA_STORAGE_KEY, JSON.stringify(map))
  } catch {
    // ignore quota / private mode
  }
}

function condaMapKey(directory: string, env: RuntimeEnvironment) {
  return `${pathKey(directory)}::${envKeyOf(env)}`
}

export function sessionCondaEnvFor(directory: string, env: RuntimeEnvironment) {
  if (!directory) return ""
  return readCondaMap()[condaMapKey(directory, env)] ?? ""
}

export function setSessionCondaEnvFor(directory: string, env: RuntimeEnvironment, condaEnv: string) {
  if (!directory) return
  const key = condaMapKey(directory, env)
  const trimmed = condaEnv.trim()
  const next = { ...readCondaMap() }
  if (trimmed) next[key] = trimmed
  else delete next[key]
  writeCondaMap(next)
  setCondaRevision((value) => value + 1)
}

function clearCondaMemory() {
  condaMemory = undefined
  setCondaRevision((value) => value + 1)
  if (typeof localStorage === "undefined") return
  try {
    localStorage.removeItem(CONDA_STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function resetSessionCondaEnvForTest() {
  clearCondaMemory()
}

export function runtimeEnvironmentLabel(env: RuntimeEnvironment) {
  if (env.kind === "ssh") return `SSH: ${env.targetName}`
  if (env.kind === "scnet") return env.serverName ? `SCNet: ${env.serverName}` : "SCNet"
  return "本地运行"
}

export type RuntimeEnvironmentValidation = {
  env: RuntimeEnvironment
  valid: boolean
  reason?: string
}

export function validateRuntimeEnvironment(
  env: RuntimeEnvironment,
  input: {
    sshTargets: readonly Pick<RegisteredSshTarget, "name" | "enabled">[]
    scnet: ScnetMcpAvailability
  },
): RuntimeEnvironmentValidation {
  if (env.kind === "ssh") {
    const target = input.sshTargets.find((item) => item.name === env.targetName)
    if (!target) {
      return {
        env,
        valid: false,
        reason: `SSH 配置「${env.targetName}」已删除或不存在`,
      }
    }
    if (target.enabled === false) {
      return {
        env,
        valid: false,
        reason: `SSH 配置「${env.targetName}」已禁用`,
      }
    }
    return { env, valid: true }
  }
  if (env.kind === "scnet") {
    if (!input.scnet.connected) {
      return {
        env,
        valid: false,
        reason: input.scnet.configured ? "scnet MCP 已配置但未连接" : "未配置 scnet MCP",
      }
    }
    return { env, valid: true }
  }
  return { env, valid: true }
}

export function runtimeEnvironmentPromptFields(
  env: RuntimeEnvironment,
  ctx: {
    directory: string
    sshTarget?: SshTargetOption
    scnet?: ScnetMcpAvailability
    condaEnv?: string
  },
): string[] {
  const conda = ctx.condaEnv?.trim()
  if (env.kind === "ssh") {
    const target = ctx.sshTarget
    if (!target) return ["SSH 远程（目标配置缺失，请重新选择运行环境）"]
    return [
      `SSH 远程 · ${target.name}`,
      `工作目录：${target.remotePath}`,
      ...(conda ? [`Conda：${conda}`] : []),
    ]
  }
  if (env.kind === "scnet") {
    const name = env.serverName ?? ctx.scnet?.name ?? "scnet"
    return [`SCNet 远程 · ${name}`, ...(conda ? [`Conda：${conda}`] : [])]
  }
  return []
}

export function resolveRuntimeEnvironmentSnapshot(input: {
  directory: string
  ssh?: Record<string, SshTargetOption> | undefined
  mcp?: Parameters<typeof resolveScnetMcpAvailability>[0]
}): { env: RuntimeEnvironment; sshTarget?: SshTargetOption; scnet: ScnetMcpAvailability } {
  const stored = runtimeEnvironmentFor(input.directory)
  const sshTargets = listRegisteredSshTargets(input.ssh)
  const scnet = resolveScnetMcpAvailability(input.mcp)
  const result = validateRuntimeEnvironment(stored, { sshTargets, scnet })
  // A stored SSH binding is immutable. Missing/disabled targets must not display as local.
  const env = stored.kind === "ssh" ? stored : result.env
  const sshTarget = env.kind === "ssh" ? sshTargets.find((item) => item.name === env.targetName) : undefined
  return { env, sshTarget, scnet }
}

const injectedScope = new Map<string, string>()

export function resetRuntimeEnvironmentInjectionForTest() {
  injectedScope.clear()
}

export function runtimeEnvironmentInjection(input: {
  scope: string
  env: RuntimeEnvironment
  ctx: {
    directory: string
    sshTarget?: SshTargetOption
    scnet?: ScnetMcpAvailability
    condaEnv?: string
  }
}): { key: string; header: string } | undefined {
  if (input.env.kind === "local" || input.env.kind === "ssh") return undefined
  const fields = runtimeEnvironmentPromptFields(input.env, input.ctx)
  if (fields.length === 0) return undefined
  const key = `${envKeyOf(input.env)}:env-v3`
  return { key, header: `【环境信息】\n${fields.join("\n")}` }
}

export function markRuntimeEnvironmentInjected(scope: string, key: string) {
  injectedScope.set(scope, key)
}

export function useRuntimeEnvironment(directory: Accessor<string>, options?: {
  probeSsh?: Accessor<boolean>
}) {
  const globalSync = useGlobalSync()
  const connectivity = useRegisteredSshConnectivity({ auto: options?.probeSsh })

  const needsMcp = createMemo(() => {
    revision()
    // Welcome / SSH projects do not need MCP availability — fetching it on cold
    // /workspace contended HTTP/1.1 with /targets and froze clicks.
    return runtimeEnvironmentFor(directory()).kind === "scnet"
  })

  const mcp = useQuery(() => ({
    ...globalSync.queryOptions.mcp(pathKey(directory() || "/")),
    enabled: !!directory() && needsMcp(),
  }))

  const stored = createMemo<RuntimeEnvironment>(() => {
    revision()
    return runtimeEnvironmentFor(directory())
  })

  const sshTargets = createMemo(() => connectivity.targets())

  const scnet = createMemo(() => resolveScnetMcpAvailability(mcp.data))

  const validation = createMemo(() =>
    validateRuntimeEnvironment(stored(), { sshTargets: sshTargets(), scnet: scnet() }),
  )

  const resolvedEnv = createMemo(() => {
    const storedEnv = stored()
    if (storedEnv.kind === "ssh") return storedEnv
    return validation().env
  })

  const setEnv = (env: RuntimeEnvironment) => {
    const dir = directory()
    if (!dir) return
    setRuntimeEnvironmentFor(dir, env)
  }

  const sshTarget = createMemo(() => {
    const env = resolvedEnv()
    if (env.kind !== "ssh") return undefined
    return sshTargets().find((item) => item.name === env.targetName)
  })

  const injection = (scope: string) =>
    runtimeEnvironmentInjection({
      scope,
      env: resolvedEnv(),
      ctx: {
        directory: directory(),
        sshTarget: sshTarget(),
        scnet: scnet(),
        condaEnv: sessionCondaEnvFor(directory(), resolvedEnv()),
      },
    })

  return {
    env: resolvedEnv,
    setEnv,
    validation,
    sshTargets,
    scnet,
    sshTarget,
    sshProbe: connectivity,
    injection,
  }
}
