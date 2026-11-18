import { createSignal } from "solid-js"
import { pathKey } from "@/utils/path-key"
import { sshTestPayload, type SshTargetOption } from "@/components/onescience/execution-location"
import { runtimeEnvironmentFor } from "@/components/onescience/runtime-environment"
import { authTokenFromCredentials } from "@/utils/server"
import {
  platformAuthLoggingOutEvent,
  platformAuthSessionUpdatedEvent,
  platformWorkspaceCacheClearedEvent,
  storedPlatformAuthSession,
  storedPlatformAuthToken,
} from "@/utils/platform-auth"

export const SSH_CONNECT_TIMEOUT_MS = 360_000
export const SSH_CONNECT_TIMEOUT_MESSAGE = `连接远端超时（${SSH_CONNECT_TIMEOUT_MS / 1000}s）`
const STORAGE_KEY = "onescience.remote-workspace.v2"
const LEGACY_STORAGE_KEY = "onescience.remote-workspace.v1"
/** Directories the user explicitly 断开'd — must survive F5 so reconcile does not re-bind leftovers. */
const STOPPED_STORAGE_KEY = "onescience.remote-workspace.stopped.v1"

export type RemoteWorkspaceBinding = {
  workspaceID: string
  targetName: string
  remotePath?: string
}

type BindingMap = Record<string, RemoteWorkspaceBinding>
type StoredBindings = Record<string, BindingMap>
type StoppedMap = Record<string, Record<string, true>>

let memory: StoredBindings | undefined
let stoppedMemory: StoppedMap | undefined
let liveWorkspaceIDs: Record<string, Record<string, string>> = {}
/** local pathKey → Date.now() when a live workspace id was last bound */
let liveBoundAtByDirectory: Record<string, number> = {}
const [revision, setRevision] = createSignal(0)
export const remoteWorkspaceRevision = revision

/** After SSH connect, the leaf may still return 500 on files while sqlite/NFS settles. */
export const REMOTE_BIND_GRACE_MS = 60_000
/** Through-A /file must succeed before the UI shows 已连接. First connect on a cold NFS leaf is slower than the tunnel probe. */
export const REMOTE_UI_FILE_READY_TIMEOUT_MS = 240_000
export const REMOTE_UI_FILE_READY_STABLE = 6

function currentAccountId() {
  return storedPlatformAuthSession()?.account.id?.trim() || "local"
}

function persistBinding(binding: RemoteWorkspaceBinding): RemoteWorkspaceBinding {
  return {
    // Last-known id is a cache for matching A-side rows after the browser
    // restarts. It is never enough to show 已连接 — that requires A's status.
    workspaceID: binding.workspaceID.trim(),
    targetName: binding.targetName,
    ...(binding.remotePath?.trim() ? { remotePath: binding.remotePath.trim() } : {}),
  }
}

function sanitizeStoredBindings(all: StoredBindings): StoredBindings {
  const next: StoredBindings = {}
  for (const [account, map] of Object.entries(all)) {
    const cleaned: BindingMap = {}
    for (const [directory, binding] of Object.entries(map ?? {})) {
      if (!binding?.targetName) continue
      cleaned[directory] = persistBinding(binding)
    }
    if (Object.keys(cleaned).length > 0) next[account] = cleaned
  }
  return next
}

function liveWorkspaceID(accountId: string, directory: string) {
  return liveWorkspaceIDs[accountId]?.[pathKey(directory)]?.trim() || ""
}

function setLiveWorkspaceID(accountId: string, directory: string, workspaceID: string | undefined) {
  const key = pathKey(directory)
  const id = workspaceID?.trim() ?? ""
  const current = { ...(liveWorkspaceIDs[accountId] ?? {}) }
  if (!id) {
    delete current[key]
    delete liveBoundAtByDirectory[key]
  } else {
    const prev = current[key]
    current[key] = id
    if (prev !== id) liveBoundAtByDirectory[key] = Date.now()
  }
  if (Object.keys(current).length === 0) {
    const next = { ...liveWorkspaceIDs }
    delete next[accountId]
    liveWorkspaceIDs = next
    return
  }
  liveWorkspaceIDs = { ...liveWorkspaceIDs, [accountId]: current }
}

function readAll(): StoredBindings {
  if (memory) return memory
  if (typeof localStorage === "undefined") {
    memory = {}
    return memory
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    memory = sanitizeStoredBindings(raw ? (JSON.parse(raw) as StoredBindings) : {})
  } catch {
    memory = {}
  }
  return memory
}

function writeAll(map: StoredBindings) {
  memory = map
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {}
  setRevision((value) => value + 1)
}

function readStoppedAll(): StoppedMap {
  if (stoppedMemory) return stoppedMemory
  if (typeof localStorage === "undefined") {
    stoppedMemory = {}
    return stoppedMemory
  }
  try {
    const raw = localStorage.getItem(STOPPED_STORAGE_KEY)
    stoppedMemory = raw ? (JSON.parse(raw) as StoppedMap) : {}
  } catch {
    stoppedMemory = {}
  }
  return stoppedMemory
}

function writeStoppedAll(map: StoppedMap) {
  stoppedMemory = map
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(STOPPED_STORAGE_KEY, JSON.stringify(map))
  } catch {}
}

/** Remember that the user clicked 断开 for this project (survives F5). Cleared on 连接. */
export function markRemoteWorkspaceUserStopped(directory: string, accountId = currentAccountId()) {
  if (!directory) return
  const all = { ...readStoppedAll() }
  const next = { ...(all[accountId] ?? {}) }
  next[pathKey(directory)] = true
  all[accountId] = next
  writeStoppedAll(all)
}

export function clearRemoteWorkspaceUserStopped(directory: string, accountId = currentAccountId()) {
  if (!directory) return
  const all = { ...readStoppedAll() }
  const current = all[accountId]
  if (!current) return
  const key = pathKey(directory)
  if (!(key in current)) return
  const next = { ...current }
  delete next[key]
  if (Object.keys(next).length === 0) delete all[accountId]
  else all[accountId] = next
  writeStoppedAll(all)
}

export function isRemoteWorkspaceUserStopped(directory: string, accountId = currentAccountId()) {
  if (!directory) return false
  return Boolean(readStoppedAll()[accountId]?.[pathKey(directory)])
}

export function isRemoteWorkspaceConnected(binding?: RemoteWorkspaceBinding) {
  return Boolean(binding?.workspaceID?.trim())
}

/** Cached wrk_* from localStorage. Not a live connection. */
export function lastKnownWorkspaceID(directory: string, accountId = currentAccountId()) {
  if (!directory) return ""
  return readAll()[accountId]?.[pathKey(directory)]?.workspaceID?.trim() || ""
}

export type ListedRemoteWorkspace = {
  id?: string
  type?: string
  directory?: string | null
  extra?: unknown
}

export type RemoteWorkspaceStatusRow = {
  workspaceID?: string
  status?: string
}

function extraSshTarget(extra: unknown) {
  if (!extra || typeof extra !== "object") return ""
  const target = (extra as { sshTarget?: unknown }).sshTarget
  return typeof target === "string" ? target.trim() : ""
}

function extraLocalDirectory(extra: unknown) {
  if (!extra || typeof extra !== "object") return ""
  const local = (extra as { localDirectory?: unknown }).localDirectory
  return typeof local === "string" ? local.trim() : ""
}

function extraRemotePath(item: ListedRemoteWorkspace) {
  const extra = item.extra
  if (extra && typeof extra === "object") {
    const path = (extra as { remotePath?: unknown }).remotePath
    if (typeof path === "string" && path.trim()) return path.trim()
  }
  return typeof item.directory === "string" && item.directory.trim() ? item.directory.trim() : ""
}

function sameRemotePath(left: string, right: string) {
  return left.replace(/\/+$/, "") === right.replace(/\/+$/, "")
}

/**
 * Match a live connection from A's `workspace.list` + `status`.
 * A SQLite row alone is not enough — it survives OneCode restart and would
 * fake 已连接. Status is the process-local connection table on A.
 */
export function liveWorkspaceFromServer(input: {
  targetName: string
  list?: readonly ListedRemoteWorkspace[]
  status?: readonly RemoteWorkspaceStatusRow[]
  preferredWorkspaceID?: string
  /** Opened local project folder — ignore sibling projects on the same SSH target. */
  localDirectory?: string
  /** Remembered remote cwd — do not steal a differently-pathed leftover workspace. */
  preferredRemotePath?: string
}): RemoteWorkspaceBinding | undefined {
  const wanted = input.targetName.trim()
  if (!wanted) return undefined
  const liveIds = new Set(
    (input.status ?? []).flatMap((row) => {
      if (row.status && row.status !== "connected") return []
      const id = row.workspaceID?.trim()
      return id ? [id] : []
    }),
  )
  if (liveIds.size === 0) return undefined
  const preferred = input.preferredWorkspaceID?.trim()
  const preferredPath = input.preferredRemotePath?.trim()
  const opened = input.localDirectory?.trim()
  let matched: RemoteWorkspaceBinding | undefined
  let matchedPath = false
  for (const item of input.list ?? []) {
    const workspaceID = item.id?.trim()
    if (!workspaceID || !liveIds.has(workspaceID)) continue
    if (item.type && item.type !== "ssh-node") continue
    if (extraSshTarget(item.extra) !== wanted) continue
    const local = extraLocalDirectory(item.extra)
    if (opened && local && pathKey(local) !== pathKey(opened)) continue
    const remotePath = extraRemotePath(item)
    // Same SSH target can host many projects. Without a preferred workspace id,
    // do not adopt a live row whose remote cwd disagrees with what this project
    // last used — that clobbers e.g. test_dir with ~/.onecode/workspaces/...
    if (
      preferredPath &&
      remotePath &&
      !sameRemotePath(remotePath, preferredPath) &&
      !(preferred && workspaceID === preferred)
    ) {
      continue
    }
    const next = {
      workspaceID,
      targetName: wanted,
      ...(remotePath ? { remotePath } : {}),
    }
    if (preferred && workspaceID === preferred) return next
    if (preferredPath && remotePath && sameRemotePath(remotePath, preferredPath)) {
      if (!matchedPath) {
        matched = next
        matchedPath = true
      }
      continue
    }
    if (!matchedPath) matched ??= next
  }
  return matched
}

function sameRemoteBinding(left?: RemoteWorkspaceBinding, right?: RemoteWorkspaceBinding) {
  return (
    (left?.workspaceID ?? "") === (right?.workspaceID ?? "") &&
    (left?.targetName ?? "") === (right?.targetName ?? "") &&
    (left?.remotePath ?? "") === (right?.remotePath ?? "")
  )
}

/**
 * Overlay A's live list+status onto the browser cache. Connected means the
 * control plane still tracks this workspace — not that localStorage said so.
 */
export function applyServerRemoteWorkspace(
  directory: string,
  input: {
    targetName: string
    list?: readonly ListedRemoteWorkspace[]
    status?: readonly RemoteWorkspaceStatusRow[]
    /** When false, only overlay a live match — never drop 已连接 on a lagging poll. */
    clearIfAbsent?: boolean
  },
  accountId = currentAccountId(),
): RemoteWorkspaceBinding | undefined {
  if (!directory) return undefined
  const remembered = remoteWorkspaceFor(directory, accountId)
  const live = liveWorkspaceFromServer({
    ...input,
    preferredWorkspaceID: lastKnownWorkspaceID(directory, accountId),
    localDirectory: directory,
    preferredRemotePath: remembered?.remotePath,
  })
  if (!live && input.clearIfAbsent === false) return undefined
  const next: RemoteWorkspaceBinding | undefined = live
    ? {
        workspaceID: live.workspaceID,
        targetName: live.targetName,
        // Prefer the live cwd when we matched this project's workspace; fall
        // back to the remembered override so disconnect/reconnect keeps test_dir.
        ...(live.remotePath || remembered?.remotePath
          ? { remotePath: live.remotePath || remembered?.remotePath }
          : {}),
      }
    : remembered?.targetName || input.targetName.trim()
      ? {
          workspaceID: "",
          targetName: remembered?.targetName || input.targetName.trim(),
          ...(remembered?.remotePath ? { remotePath: remembered.remotePath } : {}),
        }
      : undefined
  if (sameRemoteBinding(remembered, next)) return live
  setRemoteWorkspaceFor(directory, next, accountId)
  return live
}

export function remoteWorkspaceFor(
  directory: string,
  accountId = currentAccountId(),
): RemoteWorkspaceBinding | undefined {
  if (!directory) return undefined
  const stored = readAll()[accountId]?.[pathKey(directory)]
  const workspaceID = liveWorkspaceID(accountId, directory)
  if (!stored && !workspaceID) return undefined
  return {
    workspaceID,
    targetName: stored?.targetName ?? "",
    ...(stored?.remotePath ? { remotePath: stored.remotePath } : {}),
  }
}

export function setRemoteWorkspaceFor(
  directory: string,
  binding: RemoteWorkspaceBinding | undefined,
  accountId = currentAccountId(),
) {
  if (!directory) return
  const all: StoredBindings = { ...readAll() }
  const next: BindingMap = { ...(all[accountId] ?? {}) }
  const key = pathKey(directory)
  const previous = next[key]
  const liveBefore = liveWorkspaceID(accountId, directory)
  if (!binding) {
    if (!previous && !liveBefore) return
    delete next[key]
    setLiveWorkspaceID(accountId, directory, undefined)
  } else {
    const persisted = persistBinding(binding)
    if (sameRemoteBinding(previous, persisted) && liveBefore === persisted.workspaceID.trim()) return
    next[key] = persisted
    setLiveWorkspaceID(accountId, directory, binding.workspaceID)
  }
  if (Object.keys(next).length === 0) delete all[accountId]
  else all[accountId] = next
  writeAll(all)
}

/** Paths under ~/onecode_remote/workspaces/... are the adapter default when no remotePath was supplied. */
export function isAutoDefaultRemotePath(path: string | undefined) {
  if (!path?.trim()) return false
  const normalized = path.trim().replaceAll("\\", "/")
  return /(?:^|\/)\.?onecode(?:_remote)?\/workspaces\//.test(normalized)
}

/** Restore remotePath from control-plane execution.
 * Fill when missing; also replace auto-default `.onecode/workspaces/...` leftovers
 * after a cache-clear reconnect that forgot the custom path.
 */
export function setRemoteWorkspacePaths(
  items: Array<{ directory: string; targetName: string; remotePath: string }>,
  accountId = currentAccountId(),
) {
  if (items.length === 0) return
  const all: StoredBindings = { ...readAll() }
  const next: BindingMap = { ...(all[accountId] ?? {}) }
  let changed = false
  for (const item of items) {
    if (!item.directory || !item.remotePath.trim()) continue
    const key = pathKey(item.directory)
    const previous = next[key]
    const previousPath = previous?.remotePath?.trim()
    const incoming = item.remotePath.trim()
    if (previousPath) {
      if (previousPath === incoming) continue
      // Keep an intentional custom override; only heal auto-default leftovers.
      if (!isAutoDefaultRemotePath(previousPath) || isAutoDefaultRemotePath(incoming)) continue
    }
    const persisted = persistBinding({
      workspaceID: previous?.workspaceID ?? liveWorkspaceID(accountId, item.directory) ?? "",
      targetName: previous?.targetName?.trim() || item.targetName,
      remotePath: incoming,
    })
    if (sameRemoteBinding(previous, persisted)) continue
    next[key] = persisted
    changed = true
  }
  if (!changed) return
  if (Object.keys(next).length === 0) delete all[accountId]
  else all[accountId] = next
  writeAll(all)
}

export function resetRemoteWorkspaceForTest() {
  memory = undefined
  stoppedMemory = undefined
  liveWorkspaceIDs = {}
  liveBoundAtByDirectory = {}
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(LEGACY_STORAGE_KEY)
      localStorage.removeItem(STOPPED_STORAGE_KEY)
    } catch {}
  }
  setRevision((value) => value + 1)
}

export function forgetLiveRemoteWorkspacesForTest() {
  liveWorkspaceIDs = {}
  liveBoundAtByDirectory = {}
  memory = undefined
  setRevision((value) => value + 1)
}

export function directoriesForRemoteWorkspace(workspaceID: string, accountId = currentAccountId()): string[] {
  if (!workspaceID) return []
  const map = readAll()[accountId] ?? {}
  const live = liveWorkspaceIDs[accountId] ?? {}
  const keys = new Set([...Object.keys(map), ...Object.keys(live)])
  return [...keys].filter((directory) => (live[directory] || map[directory]?.workspaceID) === workspaceID)
}

/** Leaf SSE uses the remote cwd; map it back to the bound local project directory. */
export function remapRemoteEventDirectory(
  directory: string | undefined,
  workspaceID: string | undefined,
  accountId = currentAccountId(),
): string {
  const raw = directory?.trim() || "global"
  if (raw === "global" || !workspaceID) return raw
  const bound = directoriesForRemoteWorkspace(workspaceID, accountId)
  if (bound.length === 0) return raw
  const rawKey = pathKey(raw)
  const exact = bound.find((item) => pathKey(item) === rawKey)
  if (exact) return exact
  if (bound.length === 1) return bound[0]!
  return raw
}

/** Sidebar lists sessions by the local project worktree. Leaf session.created
 * carries the remote cwd; rewrite it so the new row is visible without a refresh. */
export function bindRemoteSessionDirectory<T extends { type: string; properties?: unknown }>(
  payload: T,
  directory: string,
): T {
  if (payload.type !== "session.created" && payload.type !== "session.updated") return payload
  const properties = payload.properties
  if (!properties || typeof properties !== "object") return payload
  const info = (properties as { info?: { directory?: string } }).info
  if (!info || typeof info.directory !== "string") return payload
  if (pathKey(info.directory) === pathKey(directory)) return payload
  return {
    ...payload,
    properties: {
      ...properties,
      info: { ...info, directory },
    },
  }
}

export function boundWorkspaceID(directory: string): string | undefined {
  if (!directory) return undefined
  const env = runtimeEnvironmentFor(directory)
  const binding = remoteWorkspaceFor(directory)
  if (env.kind !== "ssh" || !binding) return undefined
  if (binding.targetName !== env.targetName) return undefined
  if (!binding.workspaceID.trim()) return undefined
  return binding.workspaceID
}

/** True when the file tree must not hit A or a dead leaf: SSH project, not live-bound.
 * Uses the persisted targetName so a refresh does not list before env hydrate. */
export function isSshFileTreePending(directory: string) {
  if (!directory) return false
  if (boundWorkspaceID(directory)) return false
  if (runtimeEnvironmentFor(directory).kind === "ssh") return true
  return Boolean(remoteWorkspaceFor(directory)?.targetName?.trim())
}

/** Fresh bind: suppress "远端正在初始化" spam and quietly retry leaf APIs. */
export function isRemoteWorkspaceBindGrace(directory: string, graceMs = REMOTE_BIND_GRACE_MS) {
  if (!directory || !boundWorkspaceID(directory)) return false
  const at = liveBoundAtByDirectory[pathKey(directory)]
  if (!at) return false
  return Date.now() - at < graceMs
}

export function isTransientRemoteLeafError(message: string) {
  return /Unexpected server error|远端服务未就绪|远端正在初始化|未在时限内就绪|请稍后再试|ECONNRESET|ETIMEDOUT|fetch failed/i.test(
    message,
  )
}

/** Poll the same /file path the workbench uses (A → tunnel → leaf) before binding. */
export async function waitForWorkspaceFileList(input: {
  list: () => Promise<unknown>
  timeoutMs?: number
  abort?: AbortSignal
  stable?: number
  onDetail?: (detail: string) => void
}) {
  const timeoutMs = input.timeoutMs ?? REMOTE_UI_FILE_READY_TIMEOUT_MS
  const need = input.stable ?? REMOTE_UI_FILE_READY_STABLE
  const started = Date.now()
  let ok = 0
  let lastErr = ""
  input.onDetail?.("正在等待文件服务")
  while (Date.now() - started < timeoutMs) {
    if (input.abort?.aborted) throw new Error("已取消连接")
    try {
      await input.list()
      ok += 1
      if (ok >= need) return
      input.onDetail?.("远端文件服务已响应，正在确认稳定")
    } catch (err) {
      ok = 0
      lastErr = err instanceof Error ? err.message : String(err ?? "")
      input.onDetail?.("正在等待文件服务")
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  const hint = lastErr ? `（${lastErr.split("\n")[0]!.slice(0, 120)}）` : ""
  throw new Error(`远端文件服务未在时限内就绪${hint}。请稍后再次点连接。`)
}

if (typeof window !== "undefined") {
  const bump = () => setRevision((value) => value + 1)
  const dropLive = () => {
    liveWorkspaceIDs = {}
    liveBoundAtByDirectory = {}
    stoppedMemory = undefined
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.removeItem(STOPPED_STORAGE_KEY)
      } catch {}
    }
    bump()
  }
  window.addEventListener(platformWorkspaceCacheClearedEvent, dropLive)
  window.addEventListener(platformAuthLoggingOutEvent, dropLive)
  window.addEventListener(platformAuthSessionUpdatedEvent, bump)
}

export type WorkspacePreflightCheck = {
  id: "ssh" | "remotePath" | "onecode" | "marker"
  ok: boolean
  skipped?: boolean
  message: string
  detail?: string
}

export type WorkspacePreflightResult = {
  ok: boolean
  remotePath: string
  checks: WorkspacePreflightCheck[]
}

export const SSH_CONNECT_STEPS = [
  { id: "preflight", message: "检测执行条件" },
  { id: "prepare", message: "准备远端目录" },
  { id: "serve", message: "启动 onecode serve" },
  { id: "health", message: "确认服务已启动" },
  { id: "tunnel", message: "建立本机隧道" },
  { id: "init", message: "初始化远端环境" },
  { id: "session", message: "同步会话" },
] as const

export const SSH_PREFLIGHT_STEPS = [
  { id: "ssh", message: "检测 SSH 连通" },
  { id: "remotePath", message: "检查远端目录" },
  { id: "marker", message: "检查目录占用" },
  { id: "onecode", message: "检测 onecode" },
] as const

export type ConnectProgressStep = {
  id: string
  message: string
  status: "pending" | "current" | "ok" | "fail"
  detail?: string
}

export function sshConnectProgressKey(targetName: string, directory: string) {
  return `${targetName.trim()}::${directory.replaceAll("\\", "/")}`
}

export function sshPreflightProgressKey(targetName: string, directory: string) {
  return `preflight::${sshConnectProgressKey(targetName, directory)}`
}

export function initialConnectSteps(): ConnectProgressStep[] {
  return SSH_CONNECT_STEPS.map((item, index) => ({
    id: item.id,
    message: item.message,
    status: index === 0 ? "current" : "pending",
  }))
}

export function fileWaitConnectSteps(detail: string): ConnectProgressStep[] {
  return SSH_CONNECT_STEPS.map((item) => ({
    id: item.id,
    message: item.message,
    status: item.id === "session" ? ("current" as const) : ("ok" as const),
    ...(item.id === "session" ? { detail } : {}),
  }))
}

export function mergeConnectProgress(steps: ConnectProgressStep[]): ConnectProgressStep[] {
  const backend = steps.filter((item) => item.id !== "session")
  if (backend.length === 0) return initialConnectSteps()
  const session: ConnectProgressStep = {
    id: "session",
    message: "同步会话",
    status: backend.some((item) => item.status === "fail")
      ? "pending"
      : backend.every((item) => item.status === "ok")
        ? "current"
        : "pending",
  }
  return [...backend, session]
}

export function initialPreflightSteps(): ConnectProgressStep[] {
  return SSH_PREFLIGHT_STEPS.map((item, index) => ({
    id: item.id,
    message: item.message,
    status: index === 0 ? "current" : "pending",
  }))
}

export async function fetchSshConnectProgress(input: {
  globalUrl: string
  key: string
  auth?: { username?: string; password?: string }
}): Promise<ConnectProgressStep[]> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (input.auth?.password) {
      headers.Authorization = `Basic ${authTokenFromCredentials({
        username: input.auth.username,
        password: input.auth.password,
      })}`
    }
    const platformToken = storedPlatformAuthToken()
    if (platformToken) headers["x-platform-auth-token"] = platformToken
    const response = await fetch(`${input.globalUrl.replace(/\/$/, "")}/global/ssh/connect-progress`, {
      method: "POST",
      headers,
      body: JSON.stringify({ key: input.key }),
    })
    if (!response.ok) return []
    const data = (await response.json()) as { steps?: ConnectProgressStep[] }
    return Array.isArray(data.steps) ? data.steps : []
  } catch {
    return []
  }
}

export async function abortSshConnect(input: {
  globalUrl: string
  key: string
  auth?: { username?: string; password?: string }
}) {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (input.auth?.password) {
      headers.Authorization = `Basic ${authTokenFromCredentials({
        username: input.auth.username,
        password: input.auth.password,
      })}`
    }
    const platformToken = storedPlatformAuthToken()
    if (platformToken) headers["x-platform-auth-token"] = platformToken
    await fetch(`${input.globalUrl.replace(/\/$/, "")}/global/ssh/connect-abort`, {
      method: "POST",
      headers,
      body: JSON.stringify({ key: input.key }),
    })
  } catch {
    return
  }
}

export function remoteProjectSlug(directory: string) {
  const parts = directory.replaceAll("\\", "/").split("/").filter(Boolean)
  const name =
    (parts[parts.length - 1] || "default").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "default"
  const normalized = directory.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
  let hash = 5381
  for (let i = 0; i < normalized.length; i++) {
    hash = Math.imul(hash, 33) ^ normalized.charCodeAt(i)
  }
  return `${name}-${(hash >>> 0).toString(16).padStart(8, "0")}`
}

function sanitizeRemoteSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "default"
}

function projectLeafName(projectName?: string) {
  if (!projectName?.trim()) return ""
  return projectName.trim().replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || ""
}

/** Display path for the create-folder dialog. Backend still expands $HOME and inserts controlPlaneId when this value is not submitted. */
export function previewDefaultRemotePath(input: { accountId?: string; projectName?: string }) {
  const account = sanitizeRemoteSegment(input.accountId?.trim() || "local")
  const leaf = sanitizeRemoteSegment(projectLeafName(input.projectName) || "project")
  return `~/onecode_remote/workspaces/${account}/${leaf}`
}

export function remoteHttpErrorMessage(data: unknown, text: string, fallback: string) {
  if (data && typeof data === "object") {
    const rec = data as { data?: { message?: unknown }; message?: unknown; error?: unknown }
    const inner =
      (typeof rec.data?.message === "string" && rec.data.message) ||
      (typeof rec.message === "string" && rec.message) ||
      (typeof rec.error === "string" && rec.error)
    if (inner && inner.trim()) return inner.trim()
  }
  const trimmed = text.trim()
  if (trimmed && !trimmed.startsWith("{") && !trimmed.startsWith("[")) return trimmed
  return fallback
}

export async function preflightSshWorkspace(input: {
  globalUrl: string
  directory: string
  target: SshTargetOption
  accountId?: string
  projectID?: string
  remotePath?: string
  progressKey?: string
  auth?: { username?: string; password?: string }
  signal?: AbortSignal
}): Promise<WorkspacePreflightResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (input.auth?.password) {
    headers.Authorization = `Basic ${authTokenFromCredentials({
      username: input.auth.username,
      password: input.auth.password,
    })}`
  }
  const platformToken = storedPlatformAuthToken()
  if (platformToken) headers["x-platform-auth-token"] = platformToken
  const response = await fetch(`${input.globalUrl.replace(/\/$/, "")}/global/ssh/workspace-preflight`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      config: sshTestPayload(input.target),
      projectSlug: remoteProjectSlug(input.directory),
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.projectID ? { projectID: input.projectID } : {}),
      ...(input.remotePath?.trim() ? { remotePath: input.remotePath.trim() } : {}),
      ...(input.progressKey ? { progressKey: input.progressKey } : {}),
    }),
    signal: input.signal,
  })
  const text = await response.text()
  let data: unknown
  try {
    data = text ? JSON.parse(text) : undefined
  } catch {
    data = undefined
  }
  if (!response.ok || !data || typeof data !== "object") {
    throw new Error(remoteHttpErrorMessage(data, text, "预检失败"))
  }
  return data as WorkspacePreflightResult
}
