import { AUTH_TOKEN_STORAGE_KEY } from "./server-auth-cache"
import { authTokenFromCredentials } from "./auth-token"
import { resolveCurrentServerUrl } from "@/config/server-url"
import { base64Decode } from "@opencode-ai/core/util/encode"
import { isPresetCaseSessionId } from "@/pages/preset-cases"

export const PLATFORM_AUTH_TOKEN_STORAGE_KEY = "onecode.settings.dat:platformAuthToken"
export const PLATFORM_AUTH_SESSION_STORAGE_KEY = "onecode.settings.dat:platformAuthSession"
export const PLATFORM_AUTH_REDIRECT_PARAM = "redirect"
export const platformAuthRequiredMetaName = "onescience-platform-auth-required"
export const platformWorkspaceCacheClearedEvent = "onescience:platform-workspace-cache-cleared"
/** Same-account session refresh — listeners should reload session state, not wipe workspaces. */
export const platformAuthSessionUpdatedEvent = "onescience:platform-auth-session-updated"
/** Fired synchronously at the start of logout so UI can drop tenant projects before redirect. */
export const platformAuthLoggingOutEvent = "onescience:platform-auth-logging-out"

const PLATFORM_AUTH_PUBLIC_PATHS = new Set(["/auth", "/login", "/register", "/forgot-password"])
const CODE_SESSION_NAVIGATION_STORAGE_KEY = "onescience.code-session-navigation.v1"
const SERVER_CONTEXT_STORAGE_NAME = "opencode.global.dat"
const SERVER_CONTEXT_STORAGE_KEY = "server"

type PlatformAuthCacheStorage = {
  getItem(key: string): string | null | Promise<string | null>
  setItem(key: string, value: string): unknown | Promise<unknown>
  removeItem(key: string): unknown | Promise<unknown>
}

type PlatformAuthCacheStorageProvider = (name?: string) => PlatformAuthCacheStorage | undefined

export type PlatformAccount = {
  id: string
  email: string
  name: string
  status: string
  avatarUrl?: string
  timeCreated: number
  timeUpdated?: number
}

export type PlatformWorkspace = {
  id: string
  slug: string
  name: string
  defaultEnvPath: string
  ownerAccountId?: string
  role?: string
}

export type PlatformCapabilities = {
  terminal: boolean
  terminalIsolation?: string
  terminalUnavailableReason?: string
  terminalUnavailableDetail?: string
  terminalInstallFamily?: string
  terminalInstallCommands?: string[]
  sharedCasesRoot?: string
}

export type PlatformAuthSession = {
  token: string
  expiresAt: number
  account: PlatformAccount
  workspaces: PlatformWorkspace[]
  capabilities: PlatformCapabilities
}

export type PlatformPasswordResetRequest = {
  requested: boolean
  resetToken?: string
  expiresAt?: number
  retryAfterMs?: number
}

export type PlatformRegistrationEmailRequest = {
  requested: boolean
  retryAfterMs?: number
  smtpUnreachable?: boolean
}

export function isPlatformAuthRequired(doc: Pick<Document, "querySelector"> = document) {
  const meta = doc.querySelector(`meta[name="${platformAuthRequiredMetaName}"]`)
  if (meta instanceof HTMLMetaElement) return meta.content.trim().toLowerCase() === "true"
  return false
}

export function shouldShowPlatformLogin(input: {
  pathname: string
  hasToken: boolean
  authRequired: boolean
}) {
  if (input.hasToken) return false
  if (isPlatformCodeRoute(input.pathname)) return true
  if (!input.authRequired) return false
  return !isPlatformAuthPublicPath(input.pathname)
}

export function shouldValidatePlatformSession(input: {
  pathname: string
  authRequired: boolean
}) {
  if (isPlatformAuthPublicPath(input.pathname)) return false
  if (isPlatformCodeRoute(input.pathname)) return true
  return input.authRequired
}

export function isPlatformAuthPublicPath(pathname: string) {
  const value = inputPathname(pathname)
  if (value === "/") return true
  if (PLATFORM_AUTH_PUBLIC_PATHS.has(value)) return true
  // Workbench home shows a welcome + login CTA when logged out — allow browse/cancel return.
  // Session chat under /workspace/:dir/session still requires login (except shared cases below).
  if (value === "/workspace") return true
  // Unified workbench: anonymous browse of capability center / skills.
  if (value === "/workspace/capabilities" || value.startsWith("/workspace/capabilities/")) return true
  if (value === "/workspace/skills" || value.startsWith("/workspace/skills/")) return true
  // Official default cases are browse-only; Fork itself gates login.
  if (isSharedCasesSessionPath(value)) return true
  return false
}

/** `/workspace/:dir/session/:id?` under the shared cases catalog. */
export function isSharedCasesSessionPath(pathname: string) {
  const match = /^\/workspace\/([^/]+)\/session(?:\/([^/?#]+))?/.exec(inputPathname(pathname))
  if (!match?.[1]) return false
  try {
    if (isPresetCaseSessionId(match[2])) return true
    const directory = base64Decode(match[1])
    const session = storedPlatformAuthSession()
    if (isSharedCasesPath(session, directory)) return true
    return isSharedCasesPath(undefined, directory)
  } catch {
    return false
  }
}

export function isPlatformCodeRoute(pathname: string) {
  const value = inputPathname(pathname)
  return value === "/code" || value.startsWith("/code/") || value === "/dev"
}

export function platformAuthRedirectPath(input: { pathname: string; search: string; hash: string }) {
  return `${input.pathname}${input.search}${input.hash}`
}

export function platformAuthUrl(input: { pathname: string; search: string; hash: string }) {
  const params = new URLSearchParams({ [PLATFORM_AUTH_REDIRECT_PARAM]: platformAuthRedirectPath(input) })
  return `/login?${params}`
}

export function readPlatformAuthRedirect(search: string) {
  const params = new URLSearchParams(search)
  return params.get(PLATFORM_AUTH_REDIRECT_PARAM) ?? params.get("next")
}

export function platformAuthRedirectTarget(search: string) {
  const redirect = readPlatformAuthRedirect(search)
  if (!redirect || !redirect.startsWith("/") || redirect.startsWith("//")) return "/code"
  if (redirect.startsWith("/login?") || redirect === "/login" || redirect === "/register" || redirect === "/forgot-password") return "/code"
  return redirect
}

/** Prefer the page that triggered login; fall back when it would re-force login. */
export function platformAuthCancelTarget(search: string) {
  const redirect = readPlatformAuthRedirect(search)
  if (redirect && redirect.startsWith("/") && !redirect.startsWith("//")) {
    const pathname = redirect.split("?")[0]?.split("#")[0] ?? redirect
    if (isPlatformAuthPublicPath(pathname)) return redirect
  }
  return "/workspace/capabilities"
}

function inputPathname(pathname: string) {
  return pathname.trim() || "/"
}

export function storedPlatformAuthToken() {
  if (typeof localStorage === "undefined") return null
  try {
    return localStorage.getItem(PLATFORM_AUTH_TOKEN_STORAGE_KEY)
  } catch {
    return null
  }
}

export function storedPlatformAuthSession() {
  if (typeof localStorage === "undefined") return null
  try {
    const session = readStoredPlatformAuthSession()
    if (!session || localStorage.getItem(PLATFORM_AUTH_TOKEN_STORAGE_KEY) !== session.token) return null
    if (normalizeTimestamp(session.expiresAt) <= Date.now()) return null
    return session
  } catch {
    return null
  }
}

export async function storePlatformAuthSession(session: PlatformAuthSession, storageProvider?: PlatformAuthCacheStorageProvider) {
  if (typeof localStorage === "undefined") return
  const previous = readStoredPlatformAuthSession()
  // Only wipe project / lastCode caches when the signed-in account actually changes.
  const accountChanged = previous ? previous.account.id !== session.account.id : hasStoredPlatformCredentials()
  if (accountChanged) await clearPlatformWorkspaceCaches(storageProvider)
  const next = normalizePlatformAuthSession(session)
  localStorage.setItem(PLATFORM_AUTH_TOKEN_STORAGE_KEY, next.token)
  localStorage.setItem(PLATFORM_AUTH_SESSION_STORAGE_KEY, JSON.stringify(next))
  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, authTokenFromCredentials({ password: next.token }))
  if (!accountChanged) dispatchPlatformAuthSessionUpdated()
}

export async function clearPlatformAuthSession(storageProvider?: PlatformAuthCacheStorageProvider) {
  // Drop tenant UI immediately — do not wait for async cache clears / redirect.
  dispatchPlatformAuthLoggingOut()
  if (typeof localStorage !== "undefined") {
    removeLocalStorageItem(PLATFORM_AUTH_TOKEN_STORAGE_KEY)
    removeLocalStorageItem(PLATFORM_AUTH_SESSION_STORAGE_KEY)
    removeLocalStorageItem(AUTH_TOKEN_STORAGE_KEY)
  }
  await clearPlatformWorkspaceCaches(storageProvider)
}

export async function clearPlatformWorkspaceCaches(storageProvider?: PlatformAuthCacheStorageProvider) {
  if (typeof localStorage !== "undefined") {
    removeLocalStorageItem(CODE_SESSION_NAVIGATION_STORAGE_KEY)
    await clearPersistedServerWorkspaceCache(browserServerStorage())
  }
  const storage = platformStorage(storageProvider, SERVER_CONTEXT_STORAGE_NAME)
  if (storage) await clearPersistedServerWorkspaceCache(storage)
  dispatchPlatformWorkspaceCacheCleared()
}

export const DEFAULT_PLATFORM_PROJECT_NAME = "default"

/** Reserved `default` worktree is always local, even before the auth session hydrates. */
export function isDefaultProjectWorktree(target: string | undefined) {
  if (!target?.trim()) return false
  const leaf = target
    .replaceAll("\\", "/")
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean)
    .at(-1)
  return leaf === DEFAULT_PLATFORM_PROJECT_NAME
}

export function defaultPlatformWorkspaceDirectory(session?: PlatformAuthSession | null) {
  return session?.workspaces.find((workspace) => workspace.role === "admin")?.defaultEnvPath ?? session?.workspaces[0]?.defaultEnvPath
}

/** Each account workspace gets a dedicated `default` project under its root. */
export function defaultPlatformProjectDirectory(session?: PlatformAuthSession | null) {
  const root = defaultPlatformWorkspaceDirectory(session)?.trim()
  if (!root) return
  return joinWorkspacePath(root, DEFAULT_PLATFORM_PROJECT_NAME)
}

/** Personal default workspace used as the pinned / fallback project — must stay open. */
export function isPinnedPlatformWorkspace(session: PlatformAuthSession | undefined | null, target: string | undefined) {
  if (!session || !target?.trim()) return false
  const root = defaultPlatformWorkspaceDirectory(session)?.trim()
  if (!root) return false
  return normalizePath(root).path === normalizePath(target).path
}

/** The auto-created `default` project is the new fallback home and cannot be closed. */
export function isDefaultPlatformProject(session: PlatformAuthSession | undefined | null, target: string | undefined) {
  if (!session || !target?.trim()) return false
  const root = defaultPlatformProjectDirectory(session)?.trim()
  if (!root) return false
  return normalizePath(root).path === normalizePath(target).path
}

function joinWorkspacePath(root: string, name: string) {
  const base = root.trim().replace(/\\/g, "/").replace(/\/+$/, "")
  if (!base) return name
  return `${base}/${name.replace(/^\/+/, "")}`
}

export function sharedCasesRoot(session?: PlatformAuthSession | null) {
  const fromSession = session?.capabilities.sharedCasesRoot?.trim()
  const fromRuntime = runtimeSharedCasesRoot()
  // Prefer the live runtime catalog when the session still carries the demo stub `/data/case`.
  if (fromSession && !isDemoSharedCasesRoot(fromSession)) return fromSession
  if (fromRuntime) return fromRuntime
  if (fromSession) return fromSession
  return "/data/case"
}

export function isSharedCasesPath(session: PlatformAuthSession | undefined | null, target: string | undefined) {
  if (!target?.trim()) return false
  return normalizedPathIsInside(normalizePath(sharedCasesRoot(session)), normalizePath(target))
}

/** Personal workspace roots only — used for /code sticky workspace selection. */
export function isPathInsidePlatformWorkspace(session: PlatformAuthSession | undefined | null, target: string | undefined) {
  if (!session || !target?.trim()) return true
  const roots = session.workspaces.map((workspace) => workspace.defaultEnvPath).filter((root) => root.trim().length > 0)
  if (roots.length === 0) return false
  return roots.some((root) => normalizedPathIsInside(normalizePath(root), normalizePath(target)))
}

/** Personal workspace or Shared Cases (read-only catalog). */
export function canAccessPlatformPath(session: PlatformAuthSession | undefined | null, target: string | undefined) {
  if (!session || !target?.trim()) return true
  if (isSharedCasesPath(session, target)) return true
  return isPathInsidePlatformWorkspace(session, target)
}

/** Personal workspace only — Shared Cases are readable but not writable. */
export function canWritePlatformPath(session: PlatformAuthSession | undefined | null, target: string | undefined) {
  if (!session || !target?.trim()) return true
  // Account workspace wins over a runtime extra_path/case alias that would otherwise
  // mark personal forks as the official read-only catalog.
  if (isPathInsidePlatformWorkspace(session, target) && !isDemoSharedCasesRoot(target)) return true
  if (isSharedCasesPath(session, target)) return false
  return false
}

export function platformWorkspacePathAliases(session: PlatformAuthSession | undefined | null, target: string | undefined) {
  if (!session || !target?.trim()) return []
  const aliases = session.workspaces.flatMap((workspace) => {
    const root = workspace.defaultEnvPath.trim()
    if (!root) return []
    const relative = normalizedRelativePath(normalizePath(root), normalizePath(target))
    if (relative === undefined) return []
    const alias = joinWorkspaceAlias(root, relative)
    return normalizePath(alias).path === normalizePath(target).path ? [] : [alias]
  })
  return aliases.filter((alias, index) => aliases.indexOf(alias) === index)
}

export function canUsePlatformTerminal(session: PlatformAuthSession | undefined | null = storedPlatformAuthSession()) {
  return !session || session.capabilities.terminal
}

export function canOpenPlatformExternalTerminal(session: PlatformAuthSession | undefined | null = storedPlatformAuthSession()) {
  return !session
}

/** Platform account cannot open an interactive terminal — show install / config guidance. */
export function platformTerminalBlocked(session: PlatformAuthSession | undefined | null = storedPlatformAuthSession()) {
  if (!session) return false
  return session.capabilities.terminal !== true
}

export function platformTerminalInstallCommands(session: PlatformAuthSession | undefined | null = storedPlatformAuthSession()) {
  const commands = session?.capabilities.terminalInstallCommands
  if (Array.isArray(commands) && commands.length > 0) return commands
  if (session?.capabilities.terminalIsolation === "bubblewrap") {
    return [
      "# Debian / Ubuntu",
      "sudo apt-get update && sudo apt-get install -y bubblewrap",
      "# RHEL / CentOS / Rocky / AlmaLinux",
      "sudo dnf install -y bubblewrap",
      "# 或: sudo yum install -y epel-release && sudo yum install -y bubblewrap",
    ]
  }
  return []
}

export function filterPlatformAccountProjects<T extends { worktree: string; sandboxes?: string[] }>(
  projects: Iterable<T>,
  session: PlatformAuthSession | undefined | null = storedPlatformAuthSession(),
) {
  // While logging out / before login — never flash every tenant's directories.
  if (!session) {
    if (typeof document === "undefined") return Array.from(projects)
    if (isPlatformAuthRequired() || isPlatformCodeRoute(window.location.pathname)) return []
    return Array.from(projects)
  }
  return Array.from(projects).flatMap((project) => {
    if (!usableProjectPath(project.worktree)) return []
    // Shared preset cases are browse-only chat — never surface as a user project.
    if (isSharedCasesPath(session, project.worktree)) return []
    if (!canAccessPlatformPath(session, project.worktree)) return []
    const sandboxes = (project.sandboxes ?? []).filter(
      (sandbox) => canAccessPlatformPath(session, sandbox) && !isSharedCasesPath(session, sandbox),
    )
    if (sandboxes.length === (project.sandboxes?.length ?? 0)) return [project]
    return [{ ...project, sandboxes } as T]
  })
}

/** Prefer last personal code workspace, then the auto-created `default` project. */
export function personalWorkspaceDirectory(
  session: PlatformAuthSession | undefined | null = storedPlatformAuthSession(),
  lastCodeWorkspace?: string,
) {
  // After logout there is no account scope — never resurrect another tenant's lastCode.
  if (!session) return
  const last = lastCodeWorkspace?.trim()
  if (last && !isSharedCasesPath(session, last) && canAccessPlatformPath(session, last)) return last
  return defaultPlatformProjectDirectory(session)
}

export async function loginPlatformAccount(input: { email: string; password: string }) {
  return platformJson<PlatformAuthSession>("/platform/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function registerPlatformAccount(input: {
  name: string
  email: string
  password: string
  inviteCode?: string
  emailCode?: string
}) {
  return platformJson<PlatformAuthSession>("/platform/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function fetchRegistrationGate() {
  return platformJson<{ inviteRequired: boolean; emailVerificationRequired: boolean }>(
    "/global/onescience-preset/registration",
    {
      method: "GET",
    },
  )
}

export async function requestPlatformRegistrationEmail(input: { email: string }) {
  return platformJson<PlatformRegistrationEmailRequest>("/platform/auth/register/email-code", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function requestPlatformPasswordReset(input: { email: string }) {
  return platformJson<PlatformPasswordResetRequest>("/platform/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function resetPlatformPassword(input: { token: string; newPassword: string }) {
  return platformJson<boolean>("/platform/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function changePlatformPassword(input: {
  accountId: string
  currentPassword: string
  newPassword: string
}) {
  const token = storedPlatformAuthToken()
  if (!token) throw new Error("当前未登录")
  return platformJson<boolean>("/platform/auth/change-password", {
    method: "POST",
    headers: {
      Authorization: `Basic ${authTokenFromCredentials({ password: token })}`,
    },
    body: JSON.stringify({
      accountId: input.accountId,
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    }),
  })
}

export async function deletePlatformAccount() {
  const token = storedPlatformAuthToken()
  if (!token) throw new Error("当前未登录")
  return platformJson<boolean>("/platform/auth/delete-account", {
    method: "POST",
    headers: {
      Authorization: `Basic ${authTokenFromCredentials({ password: token })}`,
    },
    body: JSON.stringify({}),
  })
}

export async function resolvePlatformAuthSession(token: string) {
  return platformJson<PlatformAuthSession>(`/platform/auth/session?${new URLSearchParams({ token })}`)
}

/** True when the server rejected the platform token (not a transport/5xx failure). */
export function isPlatformAuthRejection(error: unknown) {
  const status = (error as { status?: number } | null)?.status
  return status === 401 || status === 403
}

async function platformJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(`${platformAuthServerUrl()}${url}`, {
    ...init,
    headers: requestHeaders(init?.headers),
  })
  if (response.ok) return (await response.json()) as T
  throw await platformAuthError(response)
}

async function platformAuthError(response: Response) {
  const text = await response.text().catch(() => "")
  const attach = (error: Error) => {
    ;(error as Error & { status?: number }).status = response.status
    return error
  }
  if (!text) return attach(new Error(`Request failed with status ${response.status}`))
  const trimmed = text.trim()
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<!doctype") || trimmed.startsWith("<html")) {
    return attach(new Error("服务器返回了网页而不是接口数据，请确认桌面端已连上本地服务后重试"))
  }
  try {
    const data = JSON.parse(text) as { message?: string; error?: string; retryAfterMs?: number }
    const message = data.message ?? data.error ?? text
    const error = attach(new Error(message)) as Error & { retryAfterMs?: number; status?: number }
    if (typeof data.retryAfterMs === "number" && data.retryAfterMs > 0) error.retryAfterMs = data.retryAfterMs
    return error
  } catch {
    return attach(new Error(text))
  }
}

function platformAuthServerUrl() {
  return resolveCurrentServerUrl({
    dev: import.meta.env.DEV,
    host: import.meta.env.VITE_OPENCODE_SERVER_HOST,
    port: import.meta.env.VITE_OPENCODE_SERVER_PORT,
    hostname: location.hostname,
    origin: location.origin,
  })
}

function requestHeaders(headers?: HeadersInit) {
  return {
    "content-type": "application/json",
    ...(headers instanceof Headers ? Object.fromEntries(headers.entries()) : Array.isArray(headers) ? Object.fromEntries(headers) : headers),
  }
}

function parsePlatformAuthSession(raw: string | null): PlatformAuthSession | null {
  if (!raw) return null
  const value = JSON.parse(raw) as unknown
  if (!isRecord(value) || typeof value.token !== "string" || typeof value.expiresAt !== "number") return null
  if (!isRecord(value.account) || typeof value.account.id !== "string" || !Array.isArray(value.workspaces)) return null
  return normalizePlatformAuthSession(value as Partial<PlatformAuthSession> & {
    token: string
    expiresAt: number
    account: PlatformAccount
    workspaces: PlatformWorkspace[]
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readStoredPlatformAuthSession() {
  try {
    return parsePlatformAuthSession(localStorage.getItem(PLATFORM_AUTH_SESSION_STORAGE_KEY))
  } catch {
    return null
  }
}

function hasStoredPlatformCredentials() {
  try {
    return !!localStorage.getItem(PLATFORM_AUTH_TOKEN_STORAGE_KEY) || !!localStorage.getItem(PLATFORM_AUTH_SESSION_STORAGE_KEY)
  } catch {
    return false
  }
}

function removeLocalStorageItem(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    return
  }
}

function browserServerStorage(): PlatformAuthCacheStorage {
  const key = (value: string) => `${SERVER_CONTEXT_STORAGE_NAME}:${value}`
  return {
    getItem: (value) => localStorage.getItem(key(value)),
    setItem: (value, next) => localStorage.setItem(key(value), next),
    removeItem: (value) => localStorage.removeItem(key(value)),
  }
}

function platformStorage(storageProvider: PlatformAuthCacheStorageProvider | undefined, name: string) {
  try {
    return storageProvider?.(name)
  } catch {
    return undefined
  }
}

async function clearPersistedServerWorkspaceCache(storage: PlatformAuthCacheStorage) {
  try {
    const raw = await storage.getItem(SERVER_CONTEXT_STORAGE_KEY)
    if (!raw) return
    const value = JSON.parse(raw) as unknown
    if (!isRecord(value)) return
    await storage.setItem(
      SERVER_CONTEXT_STORAGE_KEY,
      JSON.stringify({
        ...value,
        projects: {},
        lastProject: {},
        lastCodeWorkspace: {},
      }),
    )
  } catch {
    return
  }
}

function dispatchPlatformWorkspaceCacheCleared() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(platformWorkspaceCacheClearedEvent))
}

function dispatchPlatformAuthLoggingOut() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(platformAuthLoggingOutEvent))
}

function dispatchPlatformAuthSessionUpdated() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(platformAuthSessionUpdatedEvent))
}

function normalizePath(value: string) {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+$/, "")
  const drive = /^[A-Za-z]:\//.test(normalized)
  return {
    drive,
    path: drive ? normalized.toLowerCase() : normalized,
    withoutDrive: drive ? normalized.slice(2).toLowerCase() : undefined,
  }
}

function pathIsInside(root: string, target: string) {
  return target === root || target.startsWith(`${root}/`)
}

function normalizedPathIsInside(root: ReturnType<typeof normalizePath>, target: ReturnType<typeof normalizePath>) {
  if (root.drive && target.drive) return pathIsInside(root.path, target.path)
  if (root.drive && !target.drive) return root.withoutDrive ? pathIsInside(root.withoutDrive, target.path) : false
  if (!root.drive && target.drive) return target.withoutDrive ? pathIsInside(root.path, target.withoutDrive) : false
  return pathIsInside(root.path, target.path)
}

function comparablePaths(value: ReturnType<typeof normalizePath>) {
  return [value.path, value.withoutDrive].filter((item, index, list): item is string => !!item && list.indexOf(item) === index)
}

function normalizedRelativePath(root: ReturnType<typeof normalizePath>, target: ReturnType<typeof normalizePath>) {
  return comparablePaths(root).flatMap((rootPath) =>
    comparablePaths(target).flatMap((targetPath) => {
      if (targetPath === rootPath) return [""]
      if (targetPath.startsWith(`${rootPath}/`)) return [targetPath.slice(rootPath.length + 1)]
      return []
    }),
  )[0]
}

function joinWorkspaceAlias(root: string, relative: string) {
  const normalizedRoot = root.trim().replace(/\\/g, "/").replace(/\/+$/, "")
  if (!relative) return normalizedRoot
  return `${normalizedRoot}/${relative}`
}

function usableProjectPath(value: string) {
  const path = value.trim()
  return path.length > 0 && path !== "/"
}

function normalizeTimestamp(value: number) {
  return value < 10_000_000_000 ? value * 1_000 : value
}

function runtimeSharedCasesRoot() {
  if (typeof document === "undefined") return
  const meta = document.querySelector('meta[name="onescience-code-default-directory"]')
  if (meta instanceof HTMLMetaElement) {
    const value = meta.content.trim().replaceAll("\\", "/").replace(/\/+$/, "")
    if (value && !isDemoSharedCasesRoot(value)) return value
  }
  const extra = document.querySelector('meta[name="onescience-onecode-extra-path"]')
  if (extra instanceof HTMLMetaElement) {
    const root = extra.content.trim().replaceAll("\\", "/").replace(/\/+$/, "")
    if (root) return `${root}/case`
  }
}

function isDemoSharedCasesRoot(directory: string) {
  const key = directory.trim().replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
  return key === "/data/case" || /^[a-z]:\/data\/case$/.test(key)
}

function normalizePlatformAuthSession(
  session: Partial<PlatformAuthSession> & {
    token: string
    expiresAt: number
    account: PlatformAccount
    workspaces: PlatformWorkspace[]
  },
): PlatformAuthSession {
  const sharedRoot =
    typeof session.capabilities?.sharedCasesRoot === "string" ? session.capabilities.sharedCasesRoot.trim() : ""
  const reason =
    typeof session.capabilities?.terminalUnavailableReason === "string"
      ? session.capabilities.terminalUnavailableReason.trim()
      : ""
  const detail =
    typeof session.capabilities?.terminalUnavailableDetail === "string"
      ? session.capabilities.terminalUnavailableDetail.trim()
      : ""
  const family =
    typeof session.capabilities?.terminalInstallFamily === "string"
      ? session.capabilities.terminalInstallFamily.trim()
      : ""
  const commands = Array.isArray(session.capabilities?.terminalInstallCommands)
    ? session.capabilities.terminalInstallCommands.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : []
  return {
    token: session.token,
    expiresAt: session.expiresAt,
    account: session.account,
    workspaces: session.workspaces,
    capabilities: {
      terminal: session.capabilities?.terminal === true,
      ...(typeof session.capabilities?.terminalIsolation === "string" && session.capabilities.terminalIsolation.trim()
        ? { terminalIsolation: session.capabilities.terminalIsolation.trim() }
        : {}),
      ...(reason ? { terminalUnavailableReason: reason } : {}),
      ...(detail ? { terminalUnavailableDetail: detail } : {}),
      ...(family ? { terminalInstallFamily: family } : {}),
      ...(commands.length ? { terminalInstallCommands: commands } : {}),
      ...(sharedRoot ? { sharedCasesRoot: sharedRoot } : {}),
    },
  }
}
