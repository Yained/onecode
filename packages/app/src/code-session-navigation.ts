import {
  codeRouteWorkspaceDirectory,
  codeSessionHref,
  codeWorkspaceDirectory,
  configuredCodeDefaultDirectory,
  isFallbackCodeDefaultDirectory,
  isSharedCodeCatalogDirectory,
} from "@/app-routes"
import { hasSessionHandoffDraft } from "@/pages/session/handoff"
import { pathKey } from "@/utils/path-key"
import {
  canAccessPlatformPath,
  defaultPlatformProjectDirectory,
  isSharedCasesPath,
  platformWorkspaceCacheClearedEvent,
  storedPlatformAuthSession,
  type PlatformAuthSession,
} from "@/utils/platform-auth"

type StoredCodeRoute = {
  directory: string
  sessionID?: string
  preferNewSession: boolean
  search: string
  hash: string
}

export type CodeDevelopmentEntryInput = {
  pathname: string
  search: string
  hash: string
  path: {
    worktree?: string
    directory?: string
    home?: string
    onecode_extra_path?: string
    project_data_root?: string
  }
  recent: Array<{ worktree: string; sandboxes?: string[] }>
  defaultDirectory?: string
  lastCodeWorkspace?: string
  accountSession?: PlatformAuthSession | null
}

const STORAGE_KEY = "onescience.code-session-navigation.v1"

let memory: StoredCodeRoute | undefined

function clearStoredRoute() {
  memory = undefined
  if (typeof localStorage === "undefined") return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    return
  }
}

if (typeof window !== "undefined") {
  window.addEventListener(platformWorkspaceCacheClearedEvent, clearStoredRoute)
}

function readStoredRoute(): StoredCodeRoute | undefined {
  if (memory) return memory
  if (typeof localStorage === "undefined") return undefined
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return undefined
    memory = JSON.parse(raw) as StoredCodeRoute
    return memory
  } catch {
    return undefined
  }
}

function writeStoredRoute(route: StoredCodeRoute) {
  memory = route
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(route))
  } catch {
    // ignore quota / private mode
  }
}

function canUseCodeDirectory(directory: string, session?: PlatformAuthSession | null) {
  const account = session ?? storedPlatformAuthSession()
  // Personal workspace or read-only Shared Cases are both valid /code targets.
  if (canAccessPlatformPath(account, directory)) return true
  // Defense: configured default case dir may differ from a stale/missing sharedCasesRoot.
  const configured = configuredCodeDefaultDirectory()
  return pathKey(directory) === pathKey(configured)
}

function personalEntryDirectory(input: CodeDevelopmentEntryInput, accountSession: PlatformAuthSession | null | undefined) {
  const configured = input.defaultDirectory ?? configuredCodeDefaultDirectory(document, input.path)
  const directory = codeWorkspaceDirectory(
    input.path,
    input.recent,
    configured,
    input.lastCodeWorkspace,
    accountSession,
  )
  // Final guard: never send a logged-in account into the shared catalog as /code home.
  if (accountSession && isSharedCodeCatalogDirectory(directory, accountSession, configured)) {
    return (
      defaultPlatformProjectDirectory(accountSession) ??
      codeWorkspaceDirectory(input.path, input.recent, undefined, input.lastCodeWorkspace, accountSession) ??
      directory
    )
  }
  return directory
}

export function resetCodeSessionNavigationForTest() {
  clearStoredRoute()
}

export function sessionIdFromCodePath(pathname: string) {
  const match = /^\/code\/[^/]+\/session(?:\/([^/?#]+))?/.exec(pathname)
  return match?.[1]
}

function slugFromCodePath(pathname: string) {
  const match = /^\/code\/([^/]+)\/session/.exec(pathname)
  return match?.[1]
}

export function markCodeNewSessionIntent(slug: string) {
  const directory = codeRouteWorkspaceDirectory(`/code/${slug}/session`)
  if (!directory) return
  if (!canUseCodeDirectory(directory)) return
  writeStoredRoute({
    directory,
    sessionID: undefined,
    preferNewSession: true,
    search: "",
    hash: "",
  })
}

export function isCodeNewSessionIntent(slug: string) {
  const directory = codeRouteWorkspaceDirectory(`/code/${slug}/session`)
  if (!directory) return false
  const stored = readStoredRoute()
  return !!stored && pathKey(stored.directory) === pathKey(directory) && stored.preferNewSession
}

export function clearCodeNewSessionIntent(slug: string) {
  const directory = codeRouteWorkspaceDirectory(`/code/${slug}/session`)
  if (!directory) return
  const stored = readStoredRoute()
  if (!stored || pathKey(stored.directory) !== pathKey(directory) || !stored.preferNewSession) return
  writeStoredRoute({ ...stored, preferNewSession: false })
}

export function rememberCodeSessionNavigation(pathname: string, search = "", hash = "") {
  if (!pathname.startsWith("/code/")) return
  const directory = codeRouteWorkspaceDirectory(pathname)
  if (!directory) return
  if (!canUseCodeDirectory(directory)) return
  // Shared preset cases are browse-only chat — do not become the restore target.
  if (isSharedCasesPath(storedPlatformAuthSession(), directory)) return

  const sessionID = sessionIdFromCodePath(pathname)
  const slug = slugFromCodePath(pathname)
  const hasPromptParam = search.includes("prompt=")
  const hasHandoffDraft = slug ? hasSessionHandoffDraft(slug) : false
  const stored = readStoredRoute()
  const sameDirectory = stored && pathKey(stored.directory) === pathKey(directory)
  const preferNewSession = sessionID
    ? false
    : hasPromptParam || hasHandoffDraft || (sameDirectory ? stored!.preferNewSession : false)

  writeStoredRoute({
    directory,
    sessionID,
    preferNewSession,
    search: preferNewSession ? "" : search,
    hash: preferNewSession ? "" : hash,
  })
}

type DevelopmentEntryInput = CodeDevelopmentEntryInput

export function resolveCodeDevelopmentEntryHref(input: DevelopmentEntryInput) {
  const accountSession = input.accountSession ?? storedPlatformAuthSession()
  const configured = input.defaultDirectory ?? configuredCodeDefaultDirectory(document, input.path)
  const directory = personalEntryDirectory(input, accountSession)

  // Desktop may already be on `/code/{D:/data/case}/…` from an earlier fallback; rewrite.
  // Also rewrite when the current /code path is outside the account workspace.
  // Keep Shared Cases browse routes intact only when a concrete preset session is open.
  if (input.pathname.startsWith("/code/")) {
    const current = codeRouteWorkspaceDirectory(input.pathname)
    if (current && !canUseCodeDirectory(current, accountSession)) {
      return codeSessionHref(directory)
    }
    // Blank "new session" under the shared catalog is never a valid home — it shows the
    // Fork banner while 「当前」 still displays the personal default project.
    if (
      current &&
      accountSession &&
      isSharedCodeCatalogDirectory(current, accountSession, configured) &&
      !sessionIdFromCodePath(input.pathname)
    ) {
      return codeSessionHref(directory)
    }
    if (
      current &&
      isFallbackCodeDefaultDirectory(current) &&
      directory &&
      !isFallbackCodeDefaultDirectory(directory)
    ) {
      const sessionID = sessionIdFromCodePath(input.pathname)
      if (accountSession && sessionID && isSharedCasesPath(accountSession, current)) {
        return `${input.pathname}${input.search}${input.hash}`
      }
      // Same rule as cold「科研开发」entry: restore workspace, not the heavy session.
      return codeSessionHref(directory)
    }
    return `${input.pathname}${input.search}${input.hash}`
  }

  // From outside /code (首页 / 案例 / … → 科研开发): restore the last *workspace*
  // only. Auto-opening the last session freezes cold entry when that session is a
  // huge AlphaFold/Protein transcript (sync + timeline projection before paint).
  // Session IDs stay in storage so in-app sidebar clicks can still open them.
  return codeSessionHref(directory)
}
