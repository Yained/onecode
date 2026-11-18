import { base64Encode } from "@opencode-ai/core/util/encode"
import { base64Decode } from "@opencode-ai/core/util/encode"
import { resolveCodeDevelopmentEntryHref, sessionIdFromCodePath } from "@/code-session-navigation"
import {
  defaultPlatformProjectDirectory,
  defaultPlatformWorkspaceDirectory,
  isPathInsidePlatformWorkspace,
  isPlatformAuthRequired,
  isPlatformCodeRoute,
  isSharedCasesPath,
  storedPlatformAuthSession,
  type PlatformAuthSession,
} from "@/utils/platform-auth"
import { pathKey } from "@/utils/path-key"

import { isPresetCaseSessionId } from "@/pages/preset-cases"
import { workspaceCapabilitiesHref, workspaceSessionHref } from "@/workbench/routes"

export {
  workspaceRoutes,
  workspaceCapabilitiesHref,
  workspaceCapabilityHref,
  workspaceSessionHref,
  workspaceHomeHref,
  workspaceCaseDomainHref,
  workspaceDocsHref,
  workspaceCapabilitiesCategoryHref,
  legacyWorkbenchRedirects,
} from "@/workbench/routes"

export const oneScienceRoutes = {
  code: "/code",
  codeSession: "/code/:dir/session/:id?",
  devRedirect: { from: "/dev", to: "/code" },
  login: "/login",
  register: "/register",
  forgotPassword: "/forgot-password",
  account: "/account",
  users: "/users",
} as const

export const codeDefaultDirectoryMetaName = "onescience-code-default-directory"
export const onecodeExtraPathMetaName = "onescience-onecode-extra-path"
export const fallbackCodeDefaultDirectory = "/data/case"

function onecodeExtraPathFromMeta(doc: Pick<Document, "querySelector">) {
  const meta = doc.querySelector(`meta[name="${onecodeExtraPathMetaName}"]`)
  if (meta instanceof HTMLMetaElement && meta.content.trim()) return meta.content.trim()
}

function onecodeExtraPathFromPath(path?: { onecode_extra_path?: string; project_data_root?: string }) {
  const value = path?.onecode_extra_path?.trim()
  if (value) return value
  // Desktop path API may expose the data root before onecode_extra_path is filled in.
  const root = path?.project_data_root?.trim()
  if (root && root !== "/data" && !isFallbackCodeDefaultDirectory(root)) return root
}

export function codeDefaultDirectoryForExtraPath(extraPath: string) {
  // Normalize separators so Windows data roots don't produce mixed `D:\root/case`
  // paths that fail exact session.directory SQL matches.
  const root = extraPath.trim().replaceAll("\\", "/").replace(/\/+$/, "")
  if (!root) return fallbackCodeDefaultDirectory
  return `${root}/case`
}

/** Web/serve demo workspace; also covers Windows resolving `/data/case` → `D:/data/case`. */
export function isFallbackCodeDefaultDirectory(directory: string) {
  const key = directory.trim().replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
  return key === "/data/case" || /^[a-z]:\/data\/case$/.test(key)
}

/**
 * Shared preset catalog root (read-only for logged-in accounts).
 * Includes legacy `/data/case` and container EXTRA_PATH/case (e.g. `/data/guest_data/case`).
 * Personal workspace folders (account `…/case` forks) are not the official catalog.
 */
export function isSharedCodeCatalogDirectory(
  directory: string | undefined,
  session?: PlatformAuthSession | null,
  configuredCatalog?: string,
) {
  const value = persistableWorkspacePath(directory)
  if (!value) return false
  if (isFallbackCodeDefaultDirectory(value)) return true
  // Forks land in the account workspace `case` project. Runtime extra_path/case aliases
  // that folder — do not treat it as the read-only official catalog.
  if (session && isPathInsidePlatformWorkspace(session, value)) return false
  if (isSharedCasesPath(session, value)) return true
  // Without platform auth, the configured code-default directory is the personal home
  // (desktop / single-user). Only treat it as the shared catalog when accounts are active.
  if (session || (typeof document !== "undefined" && isPlatformAuthRequired(document))) {
    const catalog = persistableWorkspacePath(configuredCatalog)
    if (catalog && pathKey(value) === pathKey(catalog)) return true
  }
  return false
}

/** Official default cases — browse even when logged out or the root path aliases. */
export function isWorkbenchSharedCaseBrowse(directory: string | undefined, sessionID?: string) {
  if (isPresetCaseSessionId(sessionID)) return true
  if (!directory?.trim()) return false
  const session = storedPlatformAuthSession()
  // Personal forks live under the account workspace. They are not catalog browse.
  if (session && isPathInsidePlatformWorkspace(session, directory) && !isFallbackCodeDefaultDirectory(directory)) {
    return false
  }
  if (isFallbackCodeDefaultDirectory(directory)) return true
  if (isSharedCasesPath(session, directory)) return true
  if (!session && isSharedCasesPath(undefined, directory)) return true
  return isSharedCodeCatalogDirectory(directory, session)
}

function sameWorkspacePath(left: string, right: string) {
  return left.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase() === right.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
}

function shouldIgnoreRememberedCodeWorkspace(remembered: string, configured: string | undefined) {
  // Always drop the web demo / shared catalog once anything else is available — including when
  // configured is still `/data/case` but Windows already materialized `D:/data/case`, or when
  // the container catalog is EXTRA_PATH/case (e.g. `/data/guest_data/case`).
  if (isFallbackCodeDefaultDirectory(remembered) || isSharedCodeCatalogDirectory(remembered, null, configured)) {
    if (!configured) return true
    if (sameWorkspacePath(remembered, configured)) return false
    return true
  }
  if (!configured) return false
  if (sameWorkspacePath(remembered, configured)) return false
  return false
}

export function configuredCodeDefaultDirectory(
  doc: Pick<Document, "querySelector"> = document,
  path?: { onecode_extra_path?: string; project_data_root?: string },
) {
  const meta = doc.querySelector(`meta[name="${codeDefaultDirectoryMetaName}"]`)
  if (meta instanceof HTMLMetaElement && meta.content.trim()) {
    const fromMeta = meta.content.trim()
    // Prefer live data-root over a stale baked `/data/case` meta (desktop injects both).
    if (!isFallbackCodeDefaultDirectory(fromMeta)) return fromMeta
  }

  const env = (import.meta as ImportMeta & { env?: { VITE_ONESCIENCE_CODE_DEFAULT_DIRECTORY?: string } }).env
  const configured = env?.VITE_ONESCIENCE_CODE_DEFAULT_DIRECTORY?.trim()
  if (configured && !isFallbackCodeDefaultDirectory(configured)) return configured

  const extra = onecodeExtraPathFromMeta(doc) ?? onecodeExtraPathFromPath(path)
  if (extra) return codeDefaultDirectoryForExtraPath(extra)

  if (configured) return configured
  return fallbackCodeDefaultDirectory
}

function projectWorkspacePath(project: { worktree: string; sandboxes?: string[] }) {
  const worktree = persistableWorkspacePath(project.worktree)
  if (worktree) return worktree
  for (const sandbox of project.sandboxes ?? []) {
    const path = persistableWorkspacePath(sandbox)
    if (path) return path
  }
}

function lastOpenedWorkspace(recent: Array<{ worktree: string; sandboxes?: string[] }>) {
  for (const project of recent) {
    const path = projectWorkspacePath(project)
    if (path) return path
  }
}

function isServeProcessDirectory(directory: string | undefined, path: { directory?: string }) {
  const serve = persistableWorkspacePath(path.directory)
  const value = persistableWorkspacePath(directory)
  return !!serve && !!value && serve === value
}

/**
 * Resolve the workspace directory for entering OneScience /code development.
 * Priority: user last personal workspace → account `default` project → recent history → fallback.
 * Never returns the shared preset catalog for logged-in / platform-auth deployments.
 */
export function codeWorkspaceDirectory(
  path: { worktree?: string; directory?: string; home?: string; onecode_extra_path?: string; project_data_root?: string },
  recent: Array<{ worktree: string; sandboxes?: string[] }>,
  defaultDirectory?: string,
  lastCodeWorkspace?: string,
  accountSession?: PlatformAuthSession | null,
) {
  const catalog = persistableWorkspacePath(defaultDirectory)
  const rejectShared = (value: string | undefined) => {
    if (!value) return undefined
    // Logged-in accounts must never enter /code on the shared catalog (Fork-only surface).
    if (accountSession && isSharedCodeCatalogDirectory(value, accountSession, catalog)) return undefined
    if (!accountSession && isPlatformAuthRequired() && isSharedCodeCatalogDirectory(value, null, catalog)) {
      return undefined
    }
    return value
  }
  const configured = rejectShared(accountScopedWorkspacePath(defaultDirectory, accountSession))
  const remembered = rejectShared(accountScopedWorkspacePath(lastCodeWorkspace, accountSession))
  const accountDefault = persistableWorkspacePath(defaultPlatformProjectDirectory(accountSession))
  const accountWorkspace = persistableWorkspacePath(defaultPlatformWorkspaceDirectory(accountSession))
  const preferredPersonal = accountDefault ?? accountWorkspace
  const preferredConfigured = configured ?? preferredPersonal
  if (
    remembered &&
    !isServeProcessDirectory(remembered, path) &&
    !shouldIgnoreRememberedCodeWorkspace(remembered, catalog ?? preferredConfigured)
  ) {
    return remembered
  }
  if (accountDefault) return accountDefault
  // Never treat EXTRA_PATH/case (shared catalog) as a personal home — only /data/case used to
  // be filtered via isFallbackCodeDefaultDirectory, which missed container paths.
  if (configured && !isSharedCodeCatalogDirectory(configured, accountSession, catalog)) return configured
  const last = rejectShared(accountScopedWorkspacePath(lastOpenedWorkspace(recent), accountSession))
  if (
    last &&
    !isServeProcessDirectory(last, path) &&
    !shouldIgnoreRememberedCodeWorkspace(last, catalog ?? preferredConfigured)
  ) {
    return last
  }
  if (preferredPersonal) return preferredPersonal
  if (configured) return configured
  const fallback =
    rejectShared(accountScopedWorkspacePath(path.worktree || path.directory || path.home || "/", accountSession)) ??
    preferredPersonal ??
    "/"
  // Never leave desktop on the web demo path when EXTRA_PATH/case is known.
  if (
    isSharedCodeCatalogDirectory(fallback, accountSession, catalog) &&
    preferredPersonal &&
    !isSharedCodeCatalogDirectory(preferredPersonal, accountSession, catalog)
  ) {
    return preferredPersonal
  }
  if (
    isFallbackCodeDefaultDirectory(fallback) &&
    preferredConfigured &&
    !isFallbackCodeDefaultDirectory(preferredConfigured)
  ) {
    return preferredConfigured
  }
  return fallback
}

export function codeEntryWorkspaceDirectory(input: {
  path: { worktree?: string; directory?: string; home?: string; onecode_extra_path?: string; project_data_root?: string }
  recent: Array<{ worktree: string; sandboxes?: string[] }>
  lastCodeWorkspace?: string
  accountSession?: PlatformAuthSession | null
}) {
  const accountSession = input.accountSession ?? storedPlatformAuthSession()
  return codeWorkspaceDirectory(
    input.path,
    input.recent,
    configuredCodeDefaultDirectory(document, input.path),
    input.lastCodeWorkspace,
    accountSession,
  )
}

/** OneHub 资源页优先使用当前连接的工作区，而不是演示默认目录。 */
export function oneScienceResourceWorkspaceDirectory(
  path: { worktree?: string; directory?: string; home?: string },
  recent: Array<{ worktree: string }>,
  defaultDirectory?: string,
  lastOpened?: string,
) {
  const touched = persistableWorkspacePath(lastOpened)
  if (touched) return touched
  const last = lastOpenedWorkspace(recent)
  if (last) return last
  const syncRoot = projectDisplayRoot(path.worktree, path.directory ?? path.home ?? "")
  const fromSync = persistableWorkspacePath(syncRoot)
  if (fromSync) return fromSync
  if (defaultDirectory) return defaultDirectory
  return path.home || "/"
}

/** Non-git projects use worktree "/" as a permission sentinel, not a display path. */
export function projectDisplayRoot(worktree: string | undefined, directory: string) {
  if (worktree && worktree !== "/") return worktree
  return directory
}

export function persistableWorkspacePath(path: string | undefined) {
  const value = path?.trim()
  if (!value || value === "/") return undefined
  return value
}

export function codeWorkspaceRecentProjects<T extends { worktree: string; time?: { updated?: number; created?: number } }>(
  projects: Iterable<T>,
) {
  return Array.from(projects)
    .sort((a, b) => (b.time?.updated ?? b.time?.created ?? 0) - (a.time?.updated ?? a.time?.created ?? 0))
    .slice(0, 5)
}

export function codeSkillManagerHref(directory: string, tab: "upload" | "repo" | "open" = "open") {
  return `${codeSessionHref(directory)}?skillManager=${tab}`
}

export function codeSessionHref(directory: string, sessionID?: string) {
  const base = `/code/${base64Encode(directory)}/session`
  if (!sessionID) return base
  return `${base}/${sessionID}`
}

export function defaultProjectSessionHref(
  prefix: string = oneScienceRoutes.code,
  path?: { onecode_extra_path?: string; project_data_root?: string },
) {
  const directory =
    defaultPlatformProjectDirectory(storedPlatformAuthSession()) ?? configuredCodeDefaultDirectory(document, path)
  if (prefix === oneScienceRoutes.code) return codeSessionHref(directory)
  return `${prefix}/${base64Encode(directory)}/session`
}

export function codePromptHref(directory: string, prompt: string) {
  return `${codeSessionHref(directory)}?prompt=${encodeURIComponent(prompt)}`
}

export function codeDevelopmentEntryHref(input: {
  pathname: string
  search: string
  hash: string
  path: { worktree?: string; directory?: string; home?: string; onecode_extra_path?: string; project_data_root?: string }
  recent: Array<{ worktree: string }>
  defaultDirectory?: string
  lastCodeWorkspace?: string
  accountSession?: PlatformAuthSession | null
}) {
  return resolveCodeDevelopmentEntryHref(input)
}

export function workspaceDevelopmentEntryHref(input: Parameters<typeof codeDevelopmentEntryHref>[0]) {
  const codeHref = codeDevelopmentEntryHref(input)
  const pathOnly = codeHref.split(/[?#]/)[0] ?? codeHref
  const directory = codeRouteWorkspaceDirectory(pathOnly)
  if (!directory) return workspaceCapabilitiesHref()
  const sessionID = sessionIdFromCodePath(pathOnly)
  const suffix = codeHref.slice(pathOnly.length)
  return `${workspaceSessionHref(directory, sessionID)}${suffix}`
}

export function codeSlugSessionHref(slug: string, sessionID?: string) {
  const base = `/code/${slug}/session`
  if (!sessionID) return base
  return `${base}/${sessionID}`
}

export function codeRouteWorkspaceDirectory(pathname: string) {
  const match = /^\/code\/([^/]+)(?:\/session(?:\/[^/?#]+)?)?/.exec(pathname)
  if (!match) return undefined
  try {
    return base64Decode(match[1])
  } catch {
    return undefined
  }
}

export function sessionHrefForPath(pathname: string, slug: string, sessionID?: string) {
  const base = `${pathname.startsWith("/code/") ? "/code" : ""}/${slug}/session`
  if (!sessionID) return base
  return `${base}/${sessionID}`
}

function accountScopedWorkspacePath(path: string | undefined, session?: PlatformAuthSession | null) {
  const value = persistableWorkspacePath(path)
  if (!value) return undefined
  if (!session) {
    // Web logout / code routes without a session must not resurrect another tenant's path.
    if (typeof document !== "undefined" && (isPlatformAuthRequired(document) || isPlatformCodeRoute(window.location.pathname))) {
      return undefined
    }
    return value
  }
  return isPathInsidePlatformWorkspace(session, value) ? value : undefined
}
