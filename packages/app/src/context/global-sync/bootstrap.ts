import type {
  Config,
  OpencodeClient,
  Path,
  PermissionRequest,
  Project,
  ProviderAuthResponse,
  ProviderListResponse,
  QuestionRequest,
  Session,
  Todo,
} from "@opencode-ai/sdk/v2/client"
import { showToast } from "@opencode-ai/ui/toast"
import { getFilename } from "@opencode-ai/core/util/path"
import { retry } from "@opencode-ai/core/util/retry"
import { batch } from "solid-js"
import { reconcile, type SetStoreFunction, type Store } from "solid-js/store"
import type { State, VcsCache } from "./types"
import { cmp, normalizeAgentList, normalizeProviderList } from "./utils"
import { providerCatalogStaleTime } from "./provider-catalog"
import { formatServerError } from "@/utils/server-errors"
import { listProjectDataDirectories } from "@/utils/project-data-dirs"
import { QueryClient, queryOptions } from "@tanstack/solid-query"
import { loadMcpQuery } from "../global-sync"
import { storedPlatformAuthSession, storedPlatformAuthToken } from "@/utils/platform-auth"
import { authHeadersFromCachedToken } from "@/utils/auth-token"
import { mergeSessionStatusMap } from "@/utils/session-status"
import { applyServerProjectExecutions } from "@/components/onescience/project-execution"
import { boundWorkspaceID, isRemoteWorkspaceBindGrace, isSshFileTreePending, isTransientRemoteLeafError } from "@/components/onescience/remote-workspace"
import {
  projectAllowsRemoteEnvironment,
  runtimeEnvironmentFor,
  serverRuntimeEnvironmentFor,
} from "@/components/onescience/runtime-environment"
import { isWorkspaceSessionPath } from "@/workbench/routes"

type GlobalStore = {
  ready: boolean
  path: Path
  project: Project[]
  session_todo: {
    [sessionID: string]: Todo[]
  }
  provider: ProviderListResponse
  provider_auth: ProviderAuthResponse
  config: Config
  reload: undefined | "pending" | "complete"
}

/** Disconnect tears down the local tunnel; in-flight /agent then fails with Transport error. */
function isExpectedSshDisconnectError(directory: string, detail: string, liveAtStart?: string) {
  if (runtimeEnvironmentFor(directory).kind !== "ssh") return false
  const liveNow = boundWorkspaceID(directory)
  if (liveAtStart && liveAtStart !== liveNow) return true
  if (liveNow) return false
  return /Transport error|ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|network|Failed to fetch/i.test(detail)
}

function waitForPaint() {
  return new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    const timer = setTimeout(finish, 50)
    if (typeof requestAnimationFrame !== "function") return
    requestAnimationFrame(() => {
      setTimeout(() => {
        clearTimeout(timer)
        finish()
      }, 0)
    })
  })
}

function errors(list: PromiseSettledResult<unknown>[]) {
  return list.filter((item): item is PromiseRejectedResult => item.status === "rejected").map((item) => item.reason)
}

const providerRev = new Map<string, number>()

export function clearProviderRev(directory: string) {
  providerRev.delete(directory)
}

function runAll(list: Array<() => Promise<unknown>>) {
  return Promise.allSettled(list.map((item) => item()))
}

function showErrors(input: {
  errors: unknown[]
  title: string
  translate: (key: string, vars?: Record<string, string | number>) => string
  formatMoreCount: (count: number) => string
}) {
  if (input.errors.length === 0) return
  const message = formatServerError(input.errors[0], input.translate)
  const more = input.errors.length > 1 ? input.formatMoreCount(input.errors.length - 1) : ""
  showToast({
    variant: "error",
    title: input.title,
    description: message + more,
  })
}

function accountScope() {
  return storedPlatformAuthSession()?.account.id ?? "anon"
}

/** How long dispose-driven refetches should honor the last confirmed ssh/mcp write. */
const TENANT_MAP_WRITE_TTL_MS = 8_000

type TenantMapWrite = {
  accountId: string
  at: number
  ssh?: Config["ssh"]
  mcp?: Config["mcp"]
}

let lastConfirmedTenantMapWrite: TenantMapWrite | undefined

/**
 * Record the ssh/mcp maps that just landed via config.update (full replace maps).
 * Dispose refetches often omit these briefly; applyConfirmedTenantMaps pins the UI
 * to what the user just saved/deleted until the server catch-up window ends.
 */
export function rememberConfirmedTenantMapWrite(input: {
  accountId?: string
  ssh?: Config["ssh"]
  mcp?: Config["mcp"]
}) {
  const accountId = input.accountId ?? accountScope()
  const prev = lastConfirmedTenantMapWrite?.accountId === accountId ? lastConfirmedTenantMapWrite : undefined
  lastConfirmedTenantMapWrite = {
    accountId,
    at: Date.now(),
    ssh: input.ssh !== undefined ? input.ssh : prev?.ssh,
    mcp: input.mcp !== undefined ? input.mcp : prev?.mcp,
  }
}

export function clearConfirmedTenantMapWrite() {
  lastConfirmedTenantMapWrite = undefined
}

/** True when a recent ssh pin is active for this account (in-flight save/delete). */
export function hasActiveSshPin(accountId = accountScope()): boolean {
  const write = lastConfirmedTenantMapWrite
  if (!write || write.accountId !== accountId) return false
  if (Date.now() - write.at > TENANT_MAP_WRITE_TTL_MS) return false
  return write.ssh !== undefined
}

/** In-flight save: usable ssh pin — OpenSSH hydrate must not clobber it. */
export function hasUsableSshPin(accountId = accountScope()): boolean {
  const write = lastConfirmedTenantMapWrite
  if (!write || write.accountId !== accountId) return false
  if (Date.now() - write.at > TENANT_MAP_WRITE_TTL_MS) return false
  return tenantMapHasUsableEntries(write.ssh as Record<string, unknown> | undefined)
}

/** Intentional delete pin (`{}`) — keep empty until TTL; do not refill from disk. */
export function hasEmptySshDeletePin(accountId = accountScope()): boolean {
  const write = lastConfirmedTenantMapWrite
  if (!write || write.accountId !== accountId) return false
  if (Date.now() - write.at > TENANT_MAP_WRITE_TTL_MS) return false
  return write.ssh !== undefined && Object.keys(write.ssh).length === 0
}

/** Skip OpenSSH refill while a user save/delete pin owns the map. */
export function shouldSkipOpenSshRefill(accountId = accountScope()): boolean {
  return hasUsableSshPin(accountId) || hasEmptySshDeletePin(accountId)
}

/** @internal test helper */
export function peekConfirmedTenantMapWrite() {
  return lastConfirmedTenantMapWrite
}

/**
 * Apply the last confirmed write when a refetch drops or degrades ssh/mcp.
 * Covers undefined, `{}`, and host-less Schema stubs that Integration UI filters out.
 * Confirmed `{}` after delete still wins over a stale non-empty refetch.
 */
export function applyConfirmedTenantMaps(incoming: Config, accountId = accountScope()): Config {
  const write = lastConfirmedTenantMapWrite
  if (!write || write.accountId !== accountId) return incoming
  if (Date.now() - write.at > TENANT_MAP_WRITE_TTL_MS) return incoming

  let next = incoming
  if (write.ssh !== undefined && tenantMapNeedsPin(incoming.ssh, write.ssh)) {
    next = { ...next, ssh: write.ssh }
  }
  if (write.mcp !== undefined && tenantMapNeedsPin(incoming.mcp, write.mcp)) {
    next = { ...next, mcp: write.mcp }
  }
  return next
}

function tenantMapHasUsableEntries(map: Record<string, unknown> | undefined): boolean {
  if (!map) return false
  return Object.values(map).some((entry) => {
    if (!entry || typeof entry !== "object") return false
    const value = entry as Record<string, unknown>
    if (typeof value.host === "string" && value.host && typeof value.remotePath === "string" && value.remotePath) {
      return true
    }
    if (typeof value.type === "string" && value.type.length > 0) return true
    return false
  })
}

function tenantMapNeedsPin(
  incoming: Record<string, unknown> | undefined,
  confirmed: Record<string, unknown> | undefined,
): boolean {
  if (confirmed === undefined) return false
  if (incoming === undefined) return true
  const incomingKeys = Object.keys(incoming)
  const confirmedKeys = Object.keys(confirmed)
  // Confirmed delete: keep empty map even if a stale refetch still has entries.
  if (confirmedKeys.length === 0) return incomingKeys.length > 0
  // Confirmed save: restore when refetch is empty or only incomplete stubs.
  if (incomingKeys.length === 0) return true
  if (tenantMapHasUsableEntries(confirmed) && !tenantMapHasUsableEntries(incoming)) return true
  return false
}

/**
 * Fetch managed OpenSSH targets. `undefined` = request failed (do not treat as delete).
 * `{}` = durable empty list after a successful 200.
 * Concurrent callers share one in-flight request so welcome mount + bootstrap
 * cannot stack duplicate /global/ssh/targets (second one hangs on HTTP/1.1).
 */
const openSshDiskInflight = new Map<string, Promise<Config["ssh"] | undefined>>()

export async function fetchManagedOpenSshDisk(serverUrl: string): Promise<Config["ssh"] | undefined> {
  const key = serverUrl.replace(/\/+$/, "")
  const existing = openSshDiskInflight.get(key)
  if (existing) return existing

  const pending = (async () => {
    const headers: Record<string, string> = {}
    const basic = authHeadersFromCachedToken()
    if (basic?.Authorization) headers.Authorization = basic.Authorization
    const platformToken = storedPlatformAuthToken()
    if (platformToken) headers["x-platform-auth-token"] = platformToken

    // Cap wait so a hung OpenSSH disk read cannot pin an HTTP/1.1 slot and
    // freeze remote-session clicks after cache-clear refresh (Network: targets ~14s).
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5_000)
    try {
      const response = await fetch(`${key}/global/ssh/targets`, { headers, signal: controller.signal })
      if (!response.ok) return undefined
      const body = (await response.json().catch(() => undefined)) as { ssh?: Config["ssh"] } | undefined
      if (!body || typeof body !== "object") return undefined
      return body.ssh ?? {}
    } catch {
      return undefined
    } finally {
      clearTimeout(timer)
    }
  })().finally(() => {
    openSshDiskInflight.delete(key)
  })

  openSshDiskInflight.set(key, pending)
  return pending
}

/**
 * When product config.ssh is empty/stubbed after logout/login, refill from OpenSSH.
 * Skips while a user save/delete pin is active so mid-write disk snapshots cannot clobber it.
 */
export async function enrichConfigSshFromOpenSsh(input: {
  config: Config
  serverUrl: string
  accountId?: string
}): Promise<Config> {
  const accountId = input.accountId ?? accountScope()
  const resolve = () => applyConfirmedTenantMaps(input.config, accountId)
  if (accountId === "anon") return resolve()
  // Only skip for real user save/delete pins — never for a bogus empty pin from a prior race.
  if (shouldSkipOpenSshRefill(accountId)) return resolve()
  if (tenantMapHasUsableEntries(resolve().ssh as Record<string, unknown> | undefined)) return resolve()

  const disk = await fetchManagedOpenSshDisk(input.serverUrl)
  // Re-read pin after await: a concurrent hydrate/save may have landed the real map
  // while this empty /global/config enrich was still in flight (F12-vs-no-F12 race).
  if (shouldSkipOpenSshRefill(accountId)) return resolve()
  if (disk === undefined) return resolve()

  const base = resolve()
  const ssh = buildSshMapFromOpenSshDisk(disk, base)
  // Never pin {} from OpenSSH — a session-less read of OS ~/.ssh can return empty during
  // login and would block Integration hydrate for the TTL (no /global/ssh/targets in Network).
  if (Object.keys(ssh).length > 0) {
    rememberConfirmedTenantMapWrite({ accountId, ssh })
  }
  return { ...base, ssh }
}

export const loadGlobalConfigQuery = (sdk: OpencodeClient, _serverUrl: string) =>
  queryOptions({
    queryKey: ["config", accountScope()],
    queryFn: async () => {
      // Do not await /global/ssh/targets here — that blocked bootstrapGlobal on cold
      // /workspace after cache clear (sidebar painted, clicks dead for minutes).
      // OpenSSH membership is filled after paint by hydrateSshFromOpenSshTargets.
      const data = await retry(() => sdk.global.config.get().then((x) => x.data!))
      return applyConfirmedTenantMaps(data)
    },
  })

/**
 * Disk membership only: cache-only names are dropped; product extras (enabled/submit)
 * overlay onto matching disk entries. Empty disk → empty map (deletes stick).
 */
export function buildSshMapFromOpenSshDisk(
  disk: NonNullable<Config["ssh"]>,
  current: Config,
): NonNullable<Config["ssh"]> {
  const ssh: NonNullable<Config["ssh"]> = {}
  for (const [name, diskEntry] of Object.entries(disk)) {
    if (!diskEntry || typeof diskEntry !== "object") continue
    const cached = current.ssh?.[name]
    // Membership follows disk only. Overlay product extras (enabled/submit) when present.
    if (
      cached &&
      typeof cached === "object" &&
      "host" in cached &&
      "remotePath" in cached &&
      typeof (cached as { host?: unknown }).host === "string" &&
      typeof (cached as { remotePath?: unknown }).remotePath === "string"
    ) {
      const product = cached as Record<string, unknown>
      ssh[name] = {
        ...diskEntry,
        ...(typeof product.enabled === "boolean" ? { enabled: product.enabled } : {}),
        ...(product.submit && typeof product.submit === "object" ? { submit: product.submit } : {}),
        ...(product.auth && typeof product.auth === "object" ? { auth: product.auth } : {}),
      } as NonNullable<Config["ssh"]>[string]
    } else {
      ssh[name] = diskEntry
    }
  }
  return ssh
}

/**
 * OpenSSH managed blocks are the durable source of truth across logout/login.
 * Replace Integration `config.ssh` membership from disk (including empty after delete).
 * Never resurrect cache-only names, never overwrite an in-flight save/delete pin.
 * Pass `disk` when the caller already fetched /targets so we do not issue a second request.
 */
export async function hydrateSshFromOpenSshTargets(input: {
  serverUrl: string
  queryClient: QueryClient
  disk?: Config["ssh"]
}) {
  const accountId = accountScope()
  if (accountId === "anon") return
  // In-flight save/delete already owns the map — do not clobber with a mid-write OpenSSH snapshot.
  if (shouldSkipOpenSshRefill(accountId)) return

  const disk = input.disk !== undefined ? input.disk : await fetchManagedOpenSshDisk(input.serverUrl)
  // Failed fetch must not clear a good cache (distinguish from durable empty {}).
  if (disk === undefined) return
  // User save/delete may have pinned while we were reading disk — keep that pin.
  if (shouldSkipOpenSshRefill(accountId)) return

  const key = ["config", accountId] as const
  const current = (input.queryClient.getQueryData(key) as Config | undefined) ?? {}
  const ssh = buildSshMapFromOpenSshDisk(disk, current)
  // Pin only non-empty disk maps. Pinning {} from a premature OS ~/.ssh read during login
  // made hasActiveSshPin true and skipped every later hydrate (Network showed no `targets`).
  if (Object.keys(ssh).length > 0) {
    rememberConfirmedTenantMapWrite({ accountId, ssh })
  }
  input.queryClient.setQueryData(key, { ...current, ssh })
}

export const loadProjectsQuery = (sdk: OpencodeClient) =>
  queryOptions({
    queryKey: ["project", accountScope()],
    queryFn: () =>
      retry(() =>
        sdk.project.list().then((x) => {
          const data = (x.data ?? [])
            .filter((p) => !!p?.id)
            .filter((p) => !!p.worktree && !p.worktree.includes("opencode-test"))
            .slice()
            .sort((a, b) => cmp(a.id, b.id))
          applyServerProjectExecutions(data)
          return data
        }),
      ),
  })

export async function bootstrapGlobal(input: {
  globalSDK: OpencodeClient
  serverUrl: string
  requestFailedTitle: string
  translate: (key: string, vars?: Record<string, string | number>) => string
  formatMoreCount: (count: number) => string
  setGlobalStore: SetStoreFunction<GlobalStore>
  queryClient: QueryClient
}) {
  const slow = [
    () => input.queryClient.fetchQuery(loadGlobalConfigQuery(input.globalSDK, input.serverUrl)),
    () => input.queryClient.fetchQuery(loadPathQuery(null, input.globalSDK)),
    () =>
      input.queryClient
        .fetchQuery(loadProjectsQuery(input.globalSDK))
        .then((data) => input.setGlobalStore("project", data)),
  ]
  await runAll(slow)
  await waitForPaint()
  // SSH hydrate is not needed for first paint. On a workspace session URL it
  // competes with loadSessions/bootstrap and freezes clicks (Network: targets).
  // Defer far past session cold-start; env picker / 检测 call ensureOpenSshDiskHydrated.
  const scheduleTargets =
    typeof window !== "undefined" && isWorkspaceSessionPath(window.location.pathname)
      ? (fn: () => void) => window.setTimeout(fn, 20_000)
      : typeof requestIdleCallback === "function"
        ? (fn: () => void) => requestIdleCallback(fn, { timeout: 15_000 })
        : (fn: () => void) => window.setTimeout(fn, 3_000)
  scheduleTargets(() => {
    void hydrateSshFromOpenSshTargets({
      serverUrl: input.serverUrl,
      queryClient: input.queryClient,
    }).catch(() => undefined)
  })
  // Defer multi-MB /provider until after paint so /global/session is not queued on HTTP/1.1.
  // Skip on marketing home and workbench — parsing the catalog freezes clicks / Suspense.
  if (typeof window !== "undefined" && shouldAutoFetchGlobalProviders(window.location.pathname)) {
    void input.queryClient.fetchQuery(loadProvidersQuery(null, input.globalSDK)).catch(() => undefined)
  }
  void prewarmProjectBrowseRoot({ serverUrl: input.serverUrl }).catch(() => undefined)
  // showErrors({
  //   errors: errors(),
  //   title: input.requestFailedTitle,
  //   translate: input.translate,
  //   formatMoreCount: input.formatMoreCount,
  // })
}

export async function prewarmProjectBrowseRoot(input: { serverUrl: string }) {
  await listProjectDataDirectories({ url: input.serverUrl }).catch(() => undefined)
}

/** Bootstrap never fetches /provider (HTTP/1.1 contention with /global/session). After login, global-sync prefetches via ensureProviders({ silent: true }). */
export function shouldAutoFetchGlobalProviders(_pathname: string) {
  return false
}

function groupBySession<T extends { id: string; sessionID: string }>(input: T[]) {
  return input.reduce<Record<string, T[]>>((acc, item) => {
    if (!item?.id || !item.sessionID) return acc
    const list = acc[item.sessionID]
    if (list) list.push(item)
    if (!list) acc[item.sessionID] = [item]
    return acc
  }, {})
}

function projectID(directory: string, projects: Project[]) {
  return projects.find((project) => project.worktree === directory || project.sandboxes?.includes(directory))?.id
}

function mergeSession(setStore: SetStoreFunction<State>, session: Session) {
  setStore("session", (list) => {
    const next = list.slice()
    const idx = next.findIndex((item) => item.id >= session.id)
    if (idx === -1) return [...next, session]
    if (next[idx]?.id === session.id) {
      next[idx] = session
      return next
    }
    next.splice(idx, 0, session)
    return next
  })
}

function warmSessions(input: {
  ids: string[]
  store: Store<State>
  setStore: SetStoreFunction<State>
  sdk: OpencodeClient
}) {
  const known = new Set(input.store.session.map((item) => item.id))
  const ids = [...new Set(input.ids)].filter((id) => !!id && !known.has(id))
  if (ids.length === 0) return Promise.resolve()
  return Promise.all(
    ids.map((sessionID) =>
      retry(() => input.sdk.session.get({ sessionID })).then((x) => {
        const session = x.data
        if (!session?.id) return
        mergeSession(input.setStore, session)
      }),
    ),
  ).then(() => undefined)
}

export const loadProvidersQuery = (directory: string | null, sdk: OpencodeClient) =>
  queryOptions({
    queryKey: [directory, "providers", accountScope()],
    queryFn: () => retry(() => sdk.provider.list().then((x) => normalizeProviderList(x.data!))),
    // Catalog is multi-MB; keep a non-empty result warm so opening the picker does not re-download.
    // Empty success (login/auth race) is immediately stale so the next open refetches.
    staleTime: (query) => providerCatalogStaleTime((query.state.data as ProviderListResponse | undefined)?.all.length),
    gcTime: 6 * 60 * 60 * 1000,
  })

export const loadAgentsQuery = (directory: string | null, sdk: OpencodeClient) =>
  queryOptions({
    queryKey: [directory, "agents", accountScope()],
    queryFn: () => retry(() => sdk.app.agents().then((x) => normalizeAgentList(x.data))),
  })

export const loadPathQuery = (directory: string | null, sdk: OpencodeClient) =>
  queryOptions<Path>({
    queryKey: [directory, "path", accountScope()],
    queryFn: () => retry(() => sdk.path.get().then((x) => x.data!)),
  })

export async function bootstrapDirectory(input: {
  directory: string
  sdk: OpencodeClient
  store: Store<State>
  setStore: SetStoreFunction<State>
  vcsCache: VcsCache
  loadSessions: (directory: string) => Promise<void> | void
  translate: (key: string, vars?: Record<string, string | number>) => string
  global: {
    config: Config
    path: Path
    project: Project[]
    provider: ProviderListResponse
  }
  queryClient: QueryClient
}) {
  const loading = input.store.status !== "complete"
  const seededProject = projectID(input.directory, input.global.project)
  const seededPath = input.global.path.directory === input.directory ? input.global.path : undefined
  if (seededProject) input.setStore("project", seededProject)
  if (seededPath) input.setStore("path", seededPath)
  if (Object.keys(input.store.config).length === 0 && Object.keys(input.global.config).length > 0) {
    input.setStore("config", reconcile(input.global.config, { merge: false }))
  }
  if (loading) input.setStore("status", "partial")

  const rev = (providerRev.get(input.directory) ?? 0) + 1
  providerRev.set(input.directory, rev)
  ;(async () => {
    // Session list first — /global/session must not wait behind multi-MB /provider on HTTP/1.1.
    await Promise.resolve(input.loadSessions(input.directory))
    await waitForPaint()

    const ssh = runtimeEnvironmentFor(input.directory).kind === "ssh"
    const liveAtStart = boundWorkspaceID(input.directory)
    // SSH project without a live bind: do not hit leaf-routed instance APIs.
    // Also skip while env is still unknown (cache-clear race treated the dir as local).
    const unconfirmedRemoteCapable =
      !liveAtStart &&
      projectAllowsRemoteEnvironment(input.directory) &&
      serverRuntimeEnvironmentFor(input.directory)?.kind !== "local"
    if ((ssh && !liveAtStart) || isSshFileTreePending(input.directory) || unconfirmedRemoteCapable) {
      if (loading) input.setStore("status", "complete")
      return
    }

    const slow = [
      () =>
        input.queryClient
          .ensureQueryData(loadAgentsQuery(input.directory, input.sdk))
          .then((data) => input.setStore("agent", data)),
      () =>
        retry(() => input.sdk.config.get().then((x) => input.setStore("config", reconcile(x.data!, { merge: false })))),
      () =>
        retry(() =>
          input.sdk.session.status().then((x) =>
            input.setStore("session_status", mergeSessionStatusMap(x.data ?? {}, input.store.message)),
          ),
        ),
      !seededProject &&
        (() => retry(() => input.sdk.project.current()).then((x) => input.setStore("project", x.data!.id))),
      !seededPath &&
        (() =>
          input.queryClient.ensureQueryData(loadPathQuery(input.directory, input.sdk)).then((data) => {
            const next = projectID(data.directory ?? input.directory, input.global.project)
            if (next) input.setStore("project", next)
          })),
      () =>
        retry(() =>
          input.sdk.vcs.get().then((x) => {
            const next = x.data ?? input.store.vcs
            input.setStore("vcs", next)
            if (next) input.vcsCache.setStore("value", next)
          }),
        ),
      () => retry(() => input.sdk.command.list().then((x) => input.setStore("command", x.data ?? []))),
      () =>
        retry(() =>
          input.sdk.permission.list().then((x) => {
            const ids = (x.data ?? []).map((perm) => perm?.sessionID).filter((id): id is string => !!id)
            const grouped = groupBySession(
              (x.data ?? []).filter((perm): perm is PermissionRequest => !!perm?.id && !!perm.sessionID),
            )
            return warmSessions({ ids, store: input.store, setStore: input.setStore, sdk: input.sdk }).then(() =>
              batch(() => {
                for (const sessionID of Object.keys(input.store.permission)) {
                  if (grouped[sessionID]) continue
                  input.setStore("permission", sessionID, [])
                }
                for (const [sessionID, permissions] of Object.entries(grouped)) {
                  input.setStore(
                    "permission",
                    sessionID,
                    reconcile(
                      permissions.filter((p) => !!p?.id).sort((a, b) => cmp(a.id, b.id)),
                      { key: "id" },
                    ),
                  )
                }
              }),
            )
          }),
        ),
      () =>
        retry(() =>
          input.sdk.question.list().then((x) => {
            const ids = (x.data ?? []).map((question) => question?.sessionID).filter((id): id is string => !!id)
            const grouped = groupBySession((x.data ?? []).filter((q): q is QuestionRequest => !!q?.id && !!q.sessionID))
            return warmSessions({ ids, store: input.store, setStore: input.setStore, sdk: input.sdk }).then(() =>
              batch(() => {
                for (const sessionID of Object.keys(input.store.question)) {
                  if (grouped[sessionID]) continue
                  input.setStore("question", sessionID, [])
                }
                for (const [sessionID, questions] of Object.entries(grouped)) {
                  input.setStore(
                    "question",
                    sessionID,
                    reconcile(
                      questions.filter((q) => !!q?.id).sort((a, b) => cmp(a.id, b.id)),
                      { key: "id" },
                    ),
                  )
                }
              }),
            )
          }),
        ),
      !ssh && (() => input.queryClient.fetchQuery(loadMcpQuery(input.directory, input.sdk))),
    ].filter(Boolean) as (() => Promise<any>)[]

    const slowErrs = errors(await runAll(slow))
    if (slowErrs.length > 0) {
      console.error("Failed to finish bootstrap instance", slowErrs[0])
      const project = getFilename(input.directory)
      const detail = formatServerError(slowErrs[0], input.translate)
      const quietGrace =
        isRemoteWorkspaceBindGrace(input.directory) && isTransientRemoteLeafError(detail)
      if (!quietGrace && !isExpectedSshDisconnectError(input.directory, detail, liveAtStart)) {
        showToast({
          variant: "error",
          title: input.translate("toast.project.reloadFailed.title", { project }),
          description: isTransientRemoteLeafError(detail)
            ? input.translate("toast.file.remoteNotReady.description")
            : detail,
        })
      }
    }

    // Do not fetch /provider here — multi-MB payloads stall HTTP/1.1 and delay sidebar
    // session lists. Prompt/settings fetch providers when those UIs mount.

    if (loading && slowErrs.length === 0) input.setStore("status", "complete")
  })()
}
