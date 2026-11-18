import type {
  Config,
  OpencodeClient,
  Path,
  Project,
  ProviderAuthResponse,
  ProviderListResponse,
  Todo,
} from "@opencode-ai/sdk/v2/client"
import { showToast, toaster } from "@opencode-ai/ui/toast"
import { getFilename } from "@opencode-ai/core/util/path"
import { batch, createContext, createEffect, createSignal, getOwner, onCleanup, onMount, type ParentProps, untrack, useContext } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useLanguage } from "@/context/language"
import type { InitError } from "../pages/error"
import { useGlobalSDK } from "./global-sdk"
import { useServer } from "./server"
import { listGlobalSessions } from "@/utils/global-session-list"
import {
  bootstrapDirectory,
  bootstrapGlobal,
  clearConfirmedTenantMapWrite,
  clearProviderRev,
  loadAgentsQuery,
  loadGlobalConfigQuery,
  loadPathQuery,
  loadProjectsQuery,
  loadProvidersQuery,
  rememberConfirmedTenantMapWrite,
} from "./global-sync/bootstrap"
import { createChildStoreManager } from "./global-sync/child-store"
import { applyDirectoryEvent, applyGlobalEvent, cleanupDroppedSessionCaches } from "./global-sync/event-reducer"
import { getActiveSession, preserveSessionIds, setActiveSession } from "./global-sync/active-session"
import { configureSessionViewer, setSessionView } from "@/utils/session-viewer"
import { clearSessionPrefetchDirectory } from "./global-sync/session-prefetch"
import { writeSidebarSessionSnapshot } from "./global-sync/sidebar-session-snapshot"
import { estimateRootSessionTotal, loadRootSessionsWithFallback } from "./global-sync/session-load"
import { trimSessions } from "./global-sync/session-trim"
import type { ProjectMeta } from "./global-sync/types"
import { SESSION_RECENT_LIMIT } from "./global-sync/types"
import { pathKey, type PathKey } from "@/utils/path-key"
import { isSshFileTreePending } from "@/components/onescience/remote-workspace"
import {
  defaultPlatformProjectDirectory,
  platformAuthLoggingOutEvent,
  platformAuthSessionUpdatedEvent,
  platformWorkspaceCacheClearedEvent,
  platformWorkspacePathAliases,
  storedPlatformAuthSession,
} from "@/utils/platform-auth"
import { formatServerError } from "@/utils/server-errors"
import {
  isProviderCatalogLoading,
  raceProviderCatalogWait,
  shouldJoinProviderCatalogFetch,
  shouldToastProviderCatalog,
} from "./global-sync/provider-catalog"
import { queryOptions, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/solid-query"
import { createRefreshQueue } from "./global-sync/queue"
import { directoryKey } from "./global-sync/utils"

function accountScopeFromSession() {
  return storedPlatformAuthSession()?.account.id ?? "anon"
}

type GlobalStore = {
  ready: boolean
  error?: InitError
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

export const loadMcpQuery = (directory: string, sdk: OpencodeClient) =>
  queryOptions({
    queryKey: [directory, "mcp"] as const,
    queryFn: () => sdk.mcp.status().then((r) => r.data ?? {}),
  })

export const loadLspQuery = (directory: string, sdk: OpencodeClient) =>
  queryOptions({
    queryKey: [directory, "lsp"] as const,
    queryFn: () => sdk.lsp.status().then((r) => r.data ?? []),
  })

function makeQueryOptionsApi(
  globalSDK: () => OpencodeClient,
  serverUrl: () => string,
  sdkFor: (dir: PathKey) => OpencodeClient,
) {
  return {
    globalConfig: () => loadGlobalConfigQuery(globalSDK(), serverUrl()),
    projects: () => loadProjectsQuery(globalSDK()),
    providers: (directory: PathKey | null) =>
      loadProvidersQuery(directory, directory === null ? globalSDK() : sdkFor(directory)),
    path: (directory: PathKey | null) => loadPathQuery(directory, directory === null ? globalSDK() : sdkFor(directory)),
    agents: (directory: PathKey) => loadAgentsQuery(directory, sdkFor(directory)),
    mcp: (directory: PathKey) => loadMcpQuery(directory, sdkFor(directory)),
    lsp: (directory: PathKey) => loadLspQuery(directory, sdkFor(directory)),
    sessions: (directory: PathKey) => ({ queryKey: [directory, "loadSessions"] as const }),
  }
}
export type QueryOptionsApi = ReturnType<typeof makeQueryOptionsApi>

function createGlobalSync() {
  const globalSDK = useGlobalSDK()
  const server = useServer()
  const language = useLanguage()
  const owner = getOwner()
  if (!owner) throw new Error("GlobalSync must be created within owner")

  const sdkCache = new Map<string, OpencodeClient>()
  const booting = new Map<string, Promise<void>>()
  const sessionLoads = new Map<string, Promise<void>>()
  const sessionMeta = new Map<string, { limit: number }>()

  const sdkFor = (directory: string) => {
    const key = directoryKey(directory)
    const cached = sdkCache.get(key)
    if (cached) return cached
    const sdk = globalSDK.createClient({
      directory,
      throwOnError: true,
    })
    sdkCache.set(key, sdk)
    return sdk
  }

  const queryOptionsApi = makeQueryOptionsApi(
    () => globalSDK.client,
    () => globalSDK.url,
    sdkFor,
  )
  const queryClient = useQueryClient()

  // Fetch global /provider after login (silent). Opening the model picker joins that
  // in-flight query and shows an inline loading row instead of a second toast.
  const [providersEnabled, setProvidersEnabled] = createSignal(false)
  const [authEpoch, setAuthEpoch] = createSignal(0)

  const ensureProviders = (opts?: { force?: boolean; silent?: boolean }) => {
    setProvidersEnabled(true)
    const session = storedPlatformAuthSession()
    const defaultProject = defaultPlatformProjectDirectory(session)
    const globalProviders = queryOptionsApi.providers(null)
    const emptyCatalog = { all: [], connected: [], default: {} } as ProviderListResponse
    const cached = queryClient.getQueryData(globalProviders.queryKey) as ProviderListResponse | undefined
    const hasCatalog = (cached?.all?.length ?? 0) > 0
    const fetching = queryClient.getQueryState(globalProviders.queryKey)?.fetchStatus === "fetching"
    const join = shouldJoinProviderCatalogFetch({ force: opts?.force, hasCatalog, fetching })
    const loadGlobal = () =>
      opts?.force || !join ? queryClient.fetchQuery(globalProviders) : queryClient.ensureQueryData(globalProviders)
    const loadConfig = () =>
      opts?.force ? queryClient.fetchQuery(queryOptionsApi.globalConfig()) : queryClient.ensureQueryData(queryOptionsApi.globalConfig())
    const loadProject = () => {
      if (!defaultProject) return
      const projectProviders = queryOptionsApi.providers(pathKey(defaultProject))
      return opts?.force
        ? queryClient.fetchQuery(projectProviders)
        : queryClient.ensureQueryData(projectProviders)
    }
    // Config is small; warm it without blocking the picker.
    void loadConfig().catch(() => undefined)
    // Only nag when THIS click started a slow fetch. Login already prefetches silently;
    // joining that in-flight request must not pop a second "正在拉取" toast.
    let toastId: number | undefined
    const slow = shouldToastProviderCatalog({
      silent: opts?.silent,
      force: opts?.force,
      hasCatalog,
      fetching,
    })
      ? setTimeout(() => {
          toastId = showToast({
            variant: "loading",
            title: language.t("toast.provider.catalogLoading.title"),
            description: language.t("toast.provider.catalogLoading.description"),
            persistent: true,
          })
        }, 800)
      : undefined
    // Await global /provider only. Default-project instance /provider can hang when the
    // instance is not serving, and Promise.all of that request froze the picker.
    return raceProviderCatalogWait(loadGlobal())
      .then((provider) => {
        const latest =
          (provider as ProviderListResponse | undefined) ??
          (queryClient.getQueryData(globalProviders.queryKey) as ProviderListResponse | undefined) ??
          cached
        if (provider === undefined && !(latest?.all.length)) {
          // Hung in-flight /provider: drop it so the next open starts a fresh fetch.
          void queryClient.cancelQueries({ queryKey: globalProviders.queryKey })
        } else {
          void loadProject()?.catch(() => undefined)
        }
        return latest ?? emptyCatalog
      })
      .finally(() => {
        if (slow !== undefined) clearTimeout(slow)
        if (toastId !== undefined) toaster.dismiss(toastId)
      })
  }

  const [configQuery, providerQuery, pathQuery] = useQueries(() => {
    // Rebind provider/config/path keys after login so the observer sees the account-scoped cache.
    authEpoch()
    return {
      queries: [
        queryOptionsApi.globalConfig(),
        { ...queryOptionsApi.providers(null), enabled: providersEnabled() },
        queryOptionsApi.path(null),
      ],
    }
  })

  const [globalStore, setGlobalStore] = createStore<GlobalStore>({
    get ready() {
      return bootstrap.isPending
    },
    project: [],
    session_todo: {},
    provider_auth: {},
    get path() {
      const EMPTY = { state: "", config: "", worktree: "", directory: "", home: "", project_data_root: "/data" }
      if (pathQuery.isLoading) return EMPTY
      return pathQuery.data ?? EMPTY
    },
    get provider() {
      const EMPTY = { all: [], connected: [], default: {} }
      // Keep cached catalog visible while a background refetch runs (isFetching).
      const fromQuery = providerQuery.data
      if (fromQuery?.all.length) return fromQuery
      // Observer can sit on a stale accountScope key; fetchQuery writes the live key.
      const cached = queryClient.getQueryData(queryOptionsApi.providers(null).queryKey) as
        | ProviderListResponse
        | undefined
      return cached ?? fromQuery ?? EMPTY
    },
    get config() {
      // Never mask cached config as {} while a refetch is in flight — that made Integration
      // flash/stick on "未配置 SSH 目标" under fast networks (and look fine with F12 slowing JS).
      return configQuery.data ?? {}
    },
    get reload() {
      return updateConfigMutation.isPending ? "pending" : undefined
    },
  })

  let bootedAt = 0
  let bootingRoot = false
  let eventFrame: number | undefined
  let eventTimer: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => {
    if (eventFrame !== undefined) cancelAnimationFrame(eventFrame)
    if (eventTimer !== undefined) clearTimeout(eventTimer)
  })

  const setProjects = (next: Project[] | ((draft: Project[]) => Project[])) => {
    setGlobalStore("project", next)
  }

  const setBootStore = ((...input: unknown[]) => {
    if (input[0] === "project" && Array.isArray(input[1])) {
      setProjects(input[1] as Project[])
      return input[1]
    }
    return (setGlobalStore as (...args: unknown[]) => unknown)(...input)
  }) as typeof setGlobalStore

  const bootstrap = useQuery(() => ({
    queryKey: ["bootstrap", accountScopeFromSession()],
    queryFn: async () => {
      await bootstrapGlobal({
        globalSDK: globalSDK.client,
        serverUrl: globalSDK.url,
        requestFailedTitle: language.t("common.requestFailed"),
        translate: language.t,
        formatMoreCount: (count) => language.t("common.moreCountSuffix", { count }),
        setGlobalStore: setBootStore,
        queryClient,
      })
      bootedAt = Date.now()
      return bootedAt
    },
  }))

  createEffect(() => {
    authEpoch()
    if (bootstrap.isPending) return
    if (typeof window === "undefined") return
    if (!storedPlatformAuthSession()) return
    void ensureProviders({ silent: true }).catch(() => undefined)
  })

  // Account switch / logout must drop tenant config pins so the next account's heal/refetch wins.
  // Bootstrap/config query keys are account-scoped; clearing cache forces a fresh /global/config.
  onMount(() => {
    if (typeof window === "undefined") return
    const onAccountScopeReset = () => {
      clearConfirmedTenantMapWrite()
      void queryClient.removeQueries({ queryKey: ["config"] })
      void queryClient.removeQueries({ queryKey: ["bootstrap"] })
    }
    const onAuthSession = () => setAuthEpoch((value) => value + 1)
    window.addEventListener(platformAuthLoggingOutEvent, onAccountScopeReset)
    window.addEventListener(platformWorkspaceCacheClearedEvent, onAccountScopeReset)
    window.addEventListener(platformAuthSessionUpdatedEvent, onAuthSession)
    onCleanup(() => {
      window.removeEventListener(platformAuthLoggingOutEvent, onAccountScopeReset)
      window.removeEventListener(platformWorkspaceCacheClearedEvent, onAccountScopeReset)
      window.removeEventListener(platformAuthSessionUpdatedEvent, onAuthSession)
    })
  })

  const set = ((...input: unknown[]) => {
    if (input[0] === "project" && (Array.isArray(input[1]) || typeof input[1] === "function")) {
      setProjects(input[1] as Project[] | ((draft: Project[]) => Project[]))
      return input[1]
    }
    return (setGlobalStore as (...args: unknown[]) => unknown)(...input)
  }) as typeof setGlobalStore

  const setSessionTodo = (sessionID: string, todos: Todo[] | undefined) => {
    if (!sessionID) return
    if (!todos) {
      setGlobalStore(
        "session_todo",
        produce((draft) => {
          delete draft[sessionID]
        }),
      )
      return
    }
    setGlobalStore("session_todo", sessionID, reconcile(todos, { key: "id" }))
  }

  const paused = () => untrack(() => globalStore.reload) !== undefined

  const queue = createRefreshQueue({
    paused,
    key: directoryKey,
    bootstrap: () => queryClient.fetchQuery({ queryKey: ["bootstrap"] }),
    bootstrapInstance,
  })

  const children = createChildStoreManager({
    owner,
    isBooting: (directory) => booting.has(directory),
    isLoadingSessions: (directory) => sessionLoads.has(directory),
    onBootstrap: (directory) => {
      // Disconnected / pending SSH: skip leaf APIs until 连接 (SyncProvider forces
      // bootstrap when boundWorkspaceID appears).
      if (isSshFileTreePending(directory)) return
      void bootstrapInstance(directory)
    },
    onDispose: (directory) => {
      const key = directoryKey(directory)
      queue.clear(key)
      sessionMeta.delete(key)
      sdkCache.delete(key)
      clearProviderRev(key)
      clearSessionPrefetchDirectory(key)
    },
    translate: language.t,
    queryOptions: queryOptionsApi,
    global: {
      getProvider: () => globalStore.provider,
    },
  })

  const eventDirectoryKey = (directory: string) => {
    const key = directoryKey(directory)
    if (children.children[key]) return key
    return (
      platformWorkspacePathAliases(storedPlatformAuthSession(), directory)
        .map(directoryKey)
        .find((alias) => !!children.children[alias]) ?? key
    )
  }

  async function loadSessions(directory: string) {
    const key = directoryKey(directory)
    const pending = sessionLoads.get(key)
    if (pending) return pending

    children.pin(key)
    const [store, setStore] = children.child(directory, { bootstrap: false })
    const markReady = () => {
      if (!store.sessionListReady) setStore("sessionListReady", true)
    }
    const preserved = preserveSessionIds(directory)
    const meta = sessionMeta.get(key)
    if (meta && meta.limit >= store.limit) {
      const next = trimSessions(store.session, {
        limit: store.limit,
        permission: store.permission,
        preserveIds: preserved,
      })
      if (next.length !== store.session.length) {
        setStore("session", reconcile(next, { key: "id" }))
        cleanupDroppedSessionCaches(store, setStore, next, setSessionTodo)
      }
      markReady()
      children.unpin(key)
      return
    }

    const limit = Math.max(store.limit + SESSION_RECENT_LIMIT, SESSION_RECENT_LIMIT)
    const readyTimer = setTimeout(markReady, 8_000)
    const promise = queryClient
      .fetchQuery({
        ...queryOptionsApi.sessions(key),
        // Fail fast — default retry/backoff turns a 401 into multi-second sidebar skeletons.
        retry: false,
        queryFn: () =>
          loadRootSessionsWithFallback({
            directory,
            limit,
            // /global/session reads SQLite directly — /session and /experimental/session
            // both sit behind InstanceContext and bootstrap LSP/plugins per directory.
            list: (query) => {
              const http = server.current?.http
              return listGlobalSessions({
                baseUrl: globalSDK.url,
                query,
                username: http?.username,
                password: http?.password,
              })
            },
          })
            .then((x) => {
              const nonArchived = (x.data ?? [])
                .filter((s) => !!s?.id)
                .filter((s) => !s.time?.archived)
                .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
              const activeId = getActiveSession(directory)
              const activeSession = activeId ? store.session.find((session) => session.id === activeId) : undefined
              const merged = activeSession && !nonArchived.some((session) => session.id === activeId)
                ? [...nonArchived, activeSession]
                : nonArchived
              const limit = store.limit
              const childSessions = store.session.filter((s) => !!s.parentID)
              const sessions = trimSessions([...merged, ...childSessions], {
                limit,
                permission: store.permission,
                preserveIds: preserved,
              })
              batch(() => {
                setStore(
                  "sessionTotal",
                  estimateRootSessionTotal({
                    count: nonArchived.length,
                    limit: x.limit,
                    limited: x.limited,
                  }),
                )
                setStore("session", reconcile(sessions, { key: "id" }))
                cleanupDroppedSessionCaches(store, setStore, sessions, setSessionTodo)
              })
              writeSidebarSessionSnapshot(directory, sessions)
              sessionMeta.set(key, { limit })
            })
            .catch((err) => {
              console.error("Failed to load sessions", err)
              const project = getFilename(directory)
              showToast({
                variant: "error",
                title: language.t("toast.session.listFailed.title", { project }),
                description: formatServerError(err, language.t),
              })
            })
            .then(() => null),
      })
      .then(() => {})
      .finally(() => {
        clearTimeout(readyTimer)
        markReady()
      })

    sessionLoads.set(key, promise)
    void promise.finally(() => {
      sessionLoads.delete(key)
      children.unpin(key)
    })
    return promise
  }

  function isSessionListed(directory: string, sessionID: string, store: ReturnType<typeof children.child>[0]) {
    return (store.session ?? []).some(
      (session) =>
        session.id === sessionID &&
        pathKey(session.directory) === pathKey(directory) &&
        !session.parentID &&
        !session.time?.archived,
    )
  }

  function listedRootSessionCount(directory: string, store: ReturnType<typeof children.child>[0]) {
    return (store.session ?? []).filter(
      (session) =>
        pathKey(session.directory) === pathKey(directory) && !session.parentID && !session.time?.archived,
    ).length
  }

  configureSessionViewer({
    view: async (input) => {
      await globalSDK.client.session.view(input)
    },
    viewHeartbeat: async (input) => {
      await globalSDK.client.session.viewHeartbeat(input)
    },
    unview: async (input) => {
      await globalSDK.client.session.unview(input)
    },
  })

  const setActive = (directory: string, sessionID: string | undefined) => {
    setActiveSession(directory, sessionID)
    void setSessionView(directory, sessionID)
  }

  async function ensureSessionListed(directory: string, sessionID: string) {
    setActive(directory, sessionID)
    // Never instance-bootstrap from listing. Unbound SSH + default bootstrap:true
    // raced Permission/sidebar child() and saturated HTTP/1.1 (welcome stuck under
    // session URL). SyncProvider bootstraps when !pending, and forceDirectoryBootstrap
    // after 连接 even if status was marked complete here.
    const [store, setStore] = children.child(directory, { bootstrap: false })
    if (store.status === "loading" && isSshFileTreePending(directory)) {
      setStore("status", "complete")
    }
    if (isSessionListed(directory, sessionID, store)) return

    // One list fetch is enough for sidebar scroll. A 40× limit-bump loop stacked with
    // Session sync and (historically) /provider refetch froze remote cold open.
    await loadSessions(directory)
    const [after] = children.child(directory, { bootstrap: false })
    if (isSessionListed(directory, sessionID, after)) return
    if (after.sessionTotal <= listedRootSessionCount(directory, after)) return
    setStore("limit", (limit) => (limit ?? 0) + 5)
    await loadSessions(directory)
  }

  /** Leaf bootstrap even when status is already "complete" (unbound open → 连接). */
  async function forceDirectoryBootstrap(directory: string) {
    if (!directory || isSshFileTreePending(directory)) return
    return bootstrapInstance(directory)
  }

  async function bootstrapInstance(directory: string) {
    const key = directoryKey(directory)
    if (!key) return
    const pending = booting.get(key)
    if (pending) return pending

    children.pin(key)
    const promise = Promise.resolve().then(async () => {
      const child = children.ensureChild(directory)
      const cache = children.vcsCache.get(key)
      if (!cache) return
      const sdk = sdkFor(directory)
      await bootstrapDirectory({
        directory,
        global: {
          config: globalStore.config,
          path: globalStore.path,
          project: globalStore.project,
          provider: globalStore.provider,
        },
        sdk,
        store: child[0],
        setStore: child[1],
        vcsCache: cache,
        loadSessions,
        translate: language.t,
        queryClient,
      })
    })

    booting.set(key, promise)
    void promise.finally(() => {
      booting.delete(key)
      children.unpin(key)
    })
    return promise
  }

  const unsub = globalSDK.event.listen((e) => {
    const directory = e.name
    const event = e.details
    const recent = bootingRoot || Date.now() - bootedAt < 1500

    if (directory === "global") {
      // Always refresh on dispose: config/auth changes often bootstrap within the
      // recent window, and skipping here left provider/model lists stale until F5.
      const allowRefresh = !recent || event.type === "global.disposed"
      applyGlobalEvent({
        event,
        project: globalStore.project,
        refresh: () => {
          if (!allowRefresh) return
          bootstrap.refetch()
        },
        setGlobalProject: setProjects,
      })
      if (event.type === "server.connected" || event.type === "global.disposed") {
        if (!allowRefresh) return
        for (const directory of Object.keys(children.children)) {
          queue.push(directory)
        }
      }
      return
    }

    const key = eventDirectoryKey(directory)
    const existing = children.children[key]
    if (!existing) return
    children.mark(key)
    const [store, setStore] = existing
    applyDirectoryEvent({
      event,
      directory: key,
      store,
      setStore,
      push: queue.push,
      setSessionTodo,
      vcsCache: children.vcsCache.get(key),
      loadLsp: () => {
        void queryClient.fetchQuery(queryOptionsApi.lsp(key))
      },
      loadCommands: () => {
        void sdkFor(key)
          .command.list()
          .then((x) => setStore("command", reconcile(x.data ?? [])))
      },
    })
  })

  onCleanup(unsub)
  onCleanup(() => {
    queue.dispose()
  })
  onCleanup(() => {
    for (const directory of Object.keys(children.children)) {
      children.disposeDirectory(directoryKey(directory))
    }
  })

  onMount(() => {
    if (typeof requestAnimationFrame === "function") {
      eventFrame = requestAnimationFrame(() => {
        eventFrame = undefined
        eventTimer = setTimeout(() => {
          eventTimer = undefined
          void globalSDK.event.start()
        }, 0)
      })
    } else {
      eventTimer = setTimeout(() => {
        eventTimer = undefined
        void globalSDK.event.start()
      }, 0)
    }
  })

  const projectApi = {
    loadSessions,
    meta(directory: string, patch: ProjectMeta) {
      children.projectMeta(directory, patch)
    },
    icon(directory: string, value: string | undefined) {
      children.projectIcon(directory, value)
    },
  }

  const sessionApi = {
    setActive,
    ensureListed: ensureSessionListed,
  }

  const updateConfigMutation = useMutation(() => ({
    mutationFn: async (config: Config) => {
      // Wait for the server write to finish — no optimistic UI before land.
      const result = await globalSDK.client.global.config.update({ config })
      return { data: result.data!, patch: config }
    },
    onSuccess: async ({ data, patch }) => {
      const key = queryOptionsApi.globalConfig().queryKey
      // Clients send ssh/mcp as full replace maps; the patch is the landed truth
      // (including {} after delete). Prefer it over a raced/stripped get body.
      if (patch.ssh !== undefined || patch.mcp !== undefined) {
        rememberConfirmedTenantMapWrite({
          accountId: accountScopeFromSession(),
          ssh: patch.ssh,
          mcp: patch.mcp,
        })
      }
      const merged: Config = {
        ...data,
        ...(patch.ssh !== undefined ? { ssh: patch.ssh } : {}),
        ...(patch.mcp !== undefined ? { mcp: patch.mcp } : {}),
      }
      queryClient.setQueryData(key, merged)

      // ssh/mcp-only: skip invalidate. dispose+bootstrap refetch can omit maps and
      // used to resurrect deleted entries via stale cache merge.
      const keys = Object.keys(patch)
      const tenantMapsOnly = keys.length > 0 && keys.every((k) => k === "ssh" || k === "mcp")
      if (tenantMapsOnly) return

      await queryClient.invalidateQueries({ queryKey: ["config"] })
      const refetched = await queryClient.fetchQuery(queryOptionsApi.globalConfig())
      queryClient.setQueryData(key, {
        ...refetched,
        ...(patch.ssh !== undefined ? { ssh: patch.ssh } : {}),
        ...(patch.mcp !== undefined ? { mcp: patch.mcp } : {}),
      })
    },
  }))

  const reload = async () => {
    const isProvidersQuery = (query: { queryKey: readonly unknown[] }) =>
      Array.isArray(query.queryKey) && query.queryKey.includes("providers")
    const isConfigQuery = (query: { queryKey: readonly unknown[] }) =>
      Array.isArray(query.queryKey) && query.queryKey[0] === "config"
    await queryClient.invalidateQueries({
      predicate: (query) => isProvidersQuery(query) || isConfigQuery(query),
    })
    await queryClient.refetchQueries({
      predicate: (query) => isProvidersQuery(query) || isConfigQuery(query),
      type: "all",
    })
    await bootstrap.refetch()
    for (const directory of Object.keys(children.children)) {
      queue.push(directory)
    }
  }

  return {
    data: globalStore,
    set,
    get ready() {
      return globalStore.ready
    },
    get bootstrapped() {
      return !bootstrap.isPending
    },
    get error() {
      return globalStore.error
    },
    child: children.child,
    peek: children.peek,
    forceDirectoryBootstrap,
    queryOptions: queryOptionsApi,
    // bootstrap,
    updateConfig: updateConfigMutation.mutateAsync,
    reload,
    ensureProviders,
    get providersLoading() {
      return isProviderCatalogLoading({
        allLength: globalStore.provider.all.length,
        fetching: providerQuery.isFetching,
      })
    },
    get providersFetched() {
      return providerQuery.isFetched
    },
    project: projectApi,
    session: sessionApi,
    todo: {
      set: setSessionTodo,
    },
  }
}

const GlobalSyncContext = createContext<ReturnType<typeof createGlobalSync>>()

export function GlobalSyncProvider(props: ParentProps) {
  const value = createGlobalSync()
  return <GlobalSyncContext.Provider value={value}>{props.children}</GlobalSyncContext.Provider>
}

export function useGlobalSync() {
  const context = useContext(GlobalSyncContext)
  if (!context) throw new Error("useGlobalSync must be used within GlobalSyncProvider")
  return context
}

export function useQueryOptions() {
  return useGlobalSync().queryOptions
}
