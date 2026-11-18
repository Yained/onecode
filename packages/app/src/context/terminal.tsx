import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch, createEffect, createMemo, createRoot, createSignal, on, onCleanup, onMount } from "solid-js"
import { useRouteParams } from "@/hooks/use-route-params"
import { useGlobalSDK } from "./global-sdk"
import { useLayout } from "./layout"
import { useSDK } from "./sdk"
import type { Platform } from "./platform"
import { ServerConnection, useServer } from "./server"
import { defaultTitle, titleNumber } from "./terminal-title"
import { Persist, persisted, removePersisted } from "@/utils/persist"
import { decode64 } from "@/utils/base64"
import { pathKey } from "@/utils/path-key"
import {
  boundWorkspaceID,
  remoteWorkspaceFor,
  remoteWorkspaceRevision,
} from "@/components/onescience/remote-workspace"
import { runtimeEnvironmentFor } from "@/components/onescience/runtime-environment"
import {
  canUsePlatformTerminal,
  defaultPlatformWorkspaceDirectory,
  isSharedCasesPath,
  platformAuthSessionUpdatedEvent,
  platformWorkspaceCacheClearedEvent,
  storedPlatformAuthSession,
} from "@/utils/platform-auth"

export type LocalPTY = {
  id: string
  title: string
  titleNumber: number
  fresh?: boolean
  rows?: number
  cols?: number
  buffer?: string
  scrollY?: number
  cursor?: number
}

const WORKSPACE_KEY = "__workspace__"
const MAX_TERMINAL_SESSIONS = 20

/** Last session-project the shared workspace terminal host was bound to. */
let boundTerminalProjectKey: string | undefined
/** Project changed while the panel was closed — open a follow tab on next open. */
let pendingTerminalProjectFollow = false

export type TerminalCreateResult = { id?: string; error?: string }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function extractTerminalCreateError(error: unknown): string {
  const walk = (value: unknown, depth = 0): string | undefined => {
    if (depth > 5 || value == null) return
    if (typeof value === "string" && value.trim()) return value.trim()
    if (!record(value)) {
      if (value instanceof Error && value.message.trim()) return value.message.trim()
      return
    }
    if (record(value.data)) {
      const fromData = walk(value.data, depth + 1)
      if (fromData) return fromData
    }
    if (record(value.error)) {
      const fromError = walk(value.error, depth + 1)
      if (fromError) return fromError
    }
    if (record(value.body)) {
      const fromBody = walk(value.body, depth + 1)
      if (fromBody) return fromBody
    }
    if (typeof value.message === "string" && value.message.trim()) {
      if (!value.message.includes("Unexpected server error")) return value.message.trim()
    }
    if (value instanceof Error && value.message.trim()) return value.message.trim()
  }
  return walk(error) || (error instanceof Error ? error.message : "创建终端失败，请查看服务端日志")
}

function text(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function num(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function numberFromTitle(title: string) {
  return titleNumber(title, MAX_TERMINAL_SESSIONS)
}

function pty(value: unknown): LocalPTY | undefined {
  if (!record(value)) return

  const id = text(value.id)
  if (!id) return

  const title = text(value.title) ?? ""
  const number = num(value.titleNumber)
  const rows = num(value.rows)
  const cols = num(value.cols)
  const scrollY = num(value.scrollY)
  const cursor = num(value.cursor)

  return {
    id,
    title,
    titleNumber: number && number > 0 ? number : (numberFromTitle(title) ?? 0),
    ...(rows !== undefined ? { rows } : {}),
    ...(cols !== undefined ? { cols } : {}),
    // Scrollback lives on the PTY server — never hydrate huge ANSI blobs from
    // localStorage (slow + was a source of blank restores with seek=-1).
    ...(scrollY !== undefined ? { scrollY } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
  }
}

export function migrateTerminalState(value: unknown) {
  if (!record(value)) return value

  const seen = new Set<string>()
  const all = (Array.isArray(value.all) ? value.all : []).flatMap((item) => {
    const next = pty(item)
    if (!next || seen.has(next.id)) return []
    seen.add(next.id)
    return [next]
  })

  const active = text(value.active)

  return {
    active: active && seen.has(active) ? active : all[0]?.id,
    all,
  }
}

/** Remote PTY ids do not survive leaf reconnect; never hydrate them from localStorage. */
export function isRemoteTerminalHostScope(scope: string | undefined) {
  if (!scope) return false
  return scope.includes(":remote:") || scope.startsWith("remote:")
}

export function getWorkspaceTerminalCacheKey(dir: string, scope?: string) {
  if (scope) return `${scope}:${dir}:${WORKSPACE_KEY}`
  return `${dir}:${WORKSPACE_KEY}`
}

export function getTerminalServerScope(conn: ServerConnection.Any | undefined, key: ServerConnection.Key) {
  if (!conn) return
  if (conn.type === "sidecar" && conn.variant === "base") return
  if (conn.type === "http") {
    try {
      const url = new URL(conn.http.url)
      if (
        url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "::1" ||
        url.hostname === "[::1]"
      )
        return
    } catch {
      return key
    }
  }
  return key
}

export function getLegacyTerminalStorageKeys(dir: string, legacySessionID?: string) {
  if (!legacySessionID) return [`${dir}/terminal.v1`]
  return [`${dir}/terminal/${legacySessionID}.v1`, `${dir}/terminal.v1`]
}

type TerminalSession = ReturnType<typeof createWorkspaceTerminalSession>

type TerminalCacheEntry = {
  value: TerminalSession
  dispose: VoidFunction
}

const caches = new Set<Map<string, TerminalCacheEntry>>()

const trimTerminal = (pty: LocalPTY) => {
  if (!pty.buffer && pty.cursor === undefined && pty.scrollY === undefined && !pty.fresh) return pty
  return {
    ...pty,
    fresh: undefined,
    buffer: undefined,
    cursor: undefined,
    scrollY: undefined,
  }
}

export function clearWorkspaceTerminals(dir: string, sessionIDs?: string[], platform?: Platform, scope?: string) {
  const key = getWorkspaceTerminalCacheKey(dir, scope)
  for (const cache of caches) {
    const entry = cache.get(key)
    entry?.value.clear()
  }

  void removePersisted(Persist.workspace(dir, scope ? `terminal:${scope}` : "terminal"), platform)

  if (scope) return
  const legacy = new Set(getLegacyTerminalStorageKeys(dir))
  for (const id of sessionIDs ?? []) {
    for (const key of getLegacyTerminalStorageKeys(dir, id)) {
      legacy.add(key)
    }
  }
  for (const key of legacy) {
    void removePersisted({ key }, platform)
  }
}

function createWorkspaceTerminalSession(
  dir: string,
  legacySessionID: string | undefined,
  scope: string | undefined,
  pty: {
    client: () => ReturnType<typeof useSDK>["client"]
    directory: () => string
    cwd: () => string
    listenExited: (handler: (id: string) => void) => () => void
    createGuard?: () => string | undefined
  },
) {
  const legacy = scope ? [] : getLegacyTerminalStorageKeys(dir, legacySessionID)

  const [store, setStore, _, ready] = persisted(
    {
      ...Persist.workspace(dir, scope ? `terminal:${scope}` : "terminal", legacy),
      migrate: (value) => {
        const next = migrateTerminalState(value)
        if (!isRemoteTerminalHostScope(scope) || !record(next)) return next
        return { active: undefined, all: [] }
      },
    },
    createStore<{
      active?: string
      all: LocalPTY[]
    }>({
      all: [],
    }),
  )

  const pickNextTerminalNumber = () => {
    const existingTitleNumbers = new Set(
      store.all.flatMap((item) => {
        const direct = Number.isFinite(item.titleNumber) && item.titleNumber > 0 ? item.titleNumber : undefined
        if (direct !== undefined) return [direct]
        const parsed = numberFromTitle(item.title)
        if (parsed === undefined) return []
        return [parsed]
      }),
    )

    return (
      Array.from({ length: existingTitleNumbers.size + 1 }, (_, index) => index + 1).find(
        (number) => !existingTitleNumbers.has(number),
      ) ?? 1
    )
  }

  const removeExited = (id: string) => {
    const all = store.all
    const index = all.findIndex((x) => x.id === id)
    if (index === -1) return
    const active = store.active === id ? (index === 0 ? all[1]?.id : all[0]?.id) : store.active
    batch(() => {
      setStore("active", active)
      setStore(
        "all",
        produce((draft) => {
          draft.splice(index, 1)
        }),
      )
    })
  }

  // PTY sessions live on the main-workspace Instance; listen there (not current project dir).
  const unsub = pty.listenExited((id) => removeExited(id))
  onCleanup(unsub)

  const update = (client: ReturnType<typeof useSDK>["client"], item: Partial<LocalPTY> & { id: string }) => {
    const index = store.all.findIndex((x) => x.id === item.id)
    const previous = index >= 0 ? store.all[index] : undefined
    if (index >= 0) {
      setStore("all", index, (existing) => ({ ...existing, ...item }))
    }

    // Local scrollback/cursor fields must not hit the network — a failed request
    // used to roll back the whole row, and buffer writes made tab switches laggy.
    const syncTitle = item.title !== undefined
    const syncSize = item.buffer === undefined && item.cols !== undefined && item.rows !== undefined
    if (!syncTitle && !syncSize) return

    client.pty
      .update({
        ptyID: item.id,
        directory: pty.directory() || undefined,
        title: item.title,
        size: syncSize ? { rows: item.rows!, cols: item.cols! } : undefined,
      })
      .catch((error: unknown) => {
        if (previous && syncTitle) {
          const currentIndex = store.all.findIndex((entry) => entry.id === item.id)
          if (currentIndex >= 0) setStore("all", currentIndex, "title", previous.title)
        }
        console.error("Failed to update terminal", error)
      })
  }

  const clone = async (client: ReturnType<typeof useSDK>["client"], id: string) => {
    const blocked = pty.createGuard?.()
    if (blocked) throw new Error(blocked)
    const index = store.all.findIndex((x) => x.id === id)
    const existing = store.all[index]
    if (!existing) throw new Error("终端标签不存在")
    const next = await client.pty
      .create({
        title: existing.title,
        cwd: pty.cwd() || undefined,
        directory: pty.directory() || undefined,
      })
      .catch((error: unknown) => {
        throw new Error(extractTerminalCreateError(error))
      })
    if (!next?.data?.id) throw new Error("服务端未返回终端 ID")
    const created = next.data

    const active = store.active === existing.id

    batch(() => {
      setStore("all", index, {
        id: created.id,
        title: created.title ?? existing.title,
        titleNumber: existing.titleNumber,
        buffer: undefined,
        cursor: undefined,
        scrollY: undefined,
        rows: undefined,
        cols: undefined,
      })
      if (active) {
        setStore("active", created.id)
      }
    })
  }

  let createChain: Promise<unknown> = Promise.resolve()
  const enqueueCreate = (fn: () => Promise<TerminalCreateResult>) => {
    const run = createChain.then(fn, fn)
    createChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  const createOne = (): Promise<TerminalCreateResult> => {
    const blocked = pty.createGuard?.()
    if (blocked) return Promise.resolve({ error: blocked })
    const nextNumber = pickNextTerminalNumber()
    const client = pty.client()

    return client.pty
      .create({
        title: defaultTitle(nextNumber),
        cwd: pty.cwd() || undefined,
        directory: pty.directory() || undefined,
      })
      .then((created: { data?: { id?: string; title?: string } }) => {
        const id = created.data?.id
        if (!id) return { error: "服务端未返回终端 ID" }
        const newTerminal = {
          id,
          title: created.data?.title ?? defaultTitle(nextNumber),
          titleNumber: nextNumber,
          fresh: true,
        }
        batch(() => {
          setStore(
            produce((draft) => {
              draft.all.push(newTerminal)
              draft.active = id
            }),
          )
        })
        return { id }
      })
      .catch((error: unknown) => {
        console.error("Failed to create terminal", error)
        return { error: extractTerminalCreateError(error) }
      })
  }

  return {
    ready,
    all: createMemo(() => store.all),
    active: createMemo(() => store.active),
    clear() {
      batch(() => {
        setStore("active", undefined)
        setStore("all", [])
      })
    },
    new(): Promise<TerminalCreateResult> {
      return enqueueCreate(() => createOne())
    },
    ensure(): Promise<TerminalCreateResult> {
      return enqueueCreate(() => {
        const existing = store.all[0]
        if (existing) return Promise.resolve({ id: store.active ?? existing.id })
        return createOne()
      })
    },
    update(item: Partial<LocalPTY> & { id: string }) {
      update(pty.client(), item)
    },
    trim(id: string) {
      const index = store.all.findIndex((x) => x.id === id)
      if (index === -1) return
      setStore("all", index, (item) => trimTerminal(item))
    },
    trimAll() {
      setStore("all", (all) => {
        const next = all.map(trimTerminal)
        if (next.every((item, index) => item === all[index])) return all
        return next
      })
    },
    async clone(id: string) {
      await clone(pty.client(), id)
    },
    bind() {
      const client = pty.client()
      return {
        trim(id: string) {
          const index = store.all.findIndex((x) => x.id === id)
          if (index === -1) return
          setStore("all", index, (item) => trimTerminal(item))
        },
        update(item: Partial<LocalPTY> & { id: string }) {
          update(client, item)
        },
        async clone(id: string) {
          await clone(client, id)
        },
      }
    },
    open(id: string) {
      setStore("active", id)
    },
    next() {
      const index = store.all.findIndex((x) => x.id === store.active)
      if (index === -1) return
      const nextIndex = (index + 1) % store.all.length
      setStore("active", store.all[nextIndex]?.id)
    },
    previous() {
      const index = store.all.findIndex((x) => x.id === store.active)
      if (index === -1) return
      const prevIndex = index === 0 ? store.all.length - 1 : index - 1
      setStore("active", store.all[prevIndex]?.id)
    },
    async close(id: string) {
      const index = store.all.findIndex((f) => f.id === id)
      if (index !== -1) {
        batch(() => {
          setStore("all", index, (item) => trimTerminal(item))
          if (store.active === id) {
            const next = index > 0 ? store.all[index - 1]?.id : store.all[1]?.id
            setStore("active", next)
          }
          setStore(
            "all",
            produce((all) => {
              all.splice(index, 1)
            }),
          )
        })
      }

      await pty.client().pty.remove({ ptyID: id, directory: pty.directory() || undefined }).catch((error: unknown) => {
        console.error("Failed to close terminal", error)
      })
    },
    move(id: string, to: number) {
      const index = store.all.findIndex((f) => f.id === id)
      if (index === -1) return
      setStore(
        "all",
        produce((all) => {
          all.splice(to, 0, all.splice(index, 1)[0])
        }),
      )
    },
  }
}

export const { use: useTerminal, provider: TerminalProvider } = createSimpleContext({
  name: "Terminal",
  gate: false,
  init: () => {
    const sdk = useSDK()
    const globalSDK = useGlobalSDK()
    const server = useServer()
    const params = useRouteParams()
    const cache = new Map<string, TerminalCacheEntry>()
    const [platformSession, setPlatformSession] = createSignal(storedPlatformAuthSession())
    const projectDirectory = createMemo(() => decode64(params.dir) ?? "")
    const remoteHostID = createMemo(() => {
      remoteWorkspaceRevision()
      return boundWorkspaceID(projectDirectory()) ?? ""
    })

    // Local projects share the account main workspace Instance (same bwrap mount).
    // A connected SSH project must host PTY on that project so the workspace
    // header is sent and /pty is forwarded to the remote leaf.
    const ptyDirectory = createMemo(() => {
      remoteWorkspaceRevision()
      const project = projectDirectory()
      if (project && boundWorkspaceID(project)) return project
      const root = defaultPlatformWorkspaceDirectory(platformSession())
      if (root?.trim()) return root
      return project || sdk.directory
    })
    const ptyCwd = createMemo(() => {
      remoteWorkspaceRevision()
      const session = platformSession()
      const project = projectDirectory()
      if (project && boundWorkspaceID(project)) {
        return remoteWorkspaceFor(project)?.remotePath?.trim() || ""
      }
      const root = ptyDirectory()
      if (!project) return root
      if (isSharedCasesPath(session, project)) return root
      return project
    })
    const projectKey = createMemo(() => pathKey(projectDirectory() || ptyDirectory() || ptyCwd()))
    const layout = useLayout()
    const ptyClient = createMemo(() => {
      const workspaceID = remoteHostID()
      return sdk.createClient({
        directory: ptyDirectory(),
        throwOnError: true,
        ...(workspaceID ? { experimental_workspaceID: workspaceID } : {}),
      })
    })
    const listenExited = (handler: (id: string) => void) => {
      return globalSDK.event.listen((event) => {
        if (pathKey(event.name) !== pathKey(ptyDirectory())) return
        if (event.details.type !== "pty.exited") return
        handler((event.details as { properties: { id: string } }).properties.id)
      })
    }

    const enabled = createMemo(() => {
      const session = platformSession()
      if (!canUsePlatformTerminal(session)) return false
      // Terminal isolation is per-user (bwrap), not per-project.
      return true
    })
    const scope = createMemo(() => {
      return getTerminalServerScope(server.current, server.key)
    })
    const ptyHostScope = createMemo(() => {
      const serverScope = scope()
      const remote = remoteHostID()
      if (serverScope && remote) return `${serverScope}:remote:${remote}`
      if (remote) return `remote:${remote}`
      return serverScope
    })

    caches.add(cache)
    onCleanup(() => caches.delete(cache))

    const disposeAll = () => {
      for (const entry of cache.values()) {
        entry.dispose()
      }
      cache.clear()
    }

    onCleanup(disposeAll)
    onMount(() => {
      const refreshPlatformSession = () => setPlatformSession(storedPlatformAuthSession())
      window.addEventListener(platformWorkspaceCacheClearedEvent, refreshPlatformSession)
      window.addEventListener(platformAuthSessionUpdatedEvent, refreshPlatformSession)
      window.addEventListener("storage", refreshPlatformSession)
      onCleanup(() => {
        window.removeEventListener(platformWorkspaceCacheClearedEvent, refreshPlatformSession)
        window.removeEventListener(platformAuthSessionUpdatedEvent, refreshPlatformSession)
        window.removeEventListener("storage", refreshPlatformSession)
      })
    })

    const prune = () => {
      while (cache.size > MAX_TERMINAL_SESSIONS) {
        const first = cache.keys().next().value
        if (!first) return
        const entry = cache.get(first)
        entry?.dispose()
        cache.delete(first)
      }
    }

    const loadWorkspace = (dir: string, legacySessionID: string | undefined, serverScope: string | undefined) => {
      // Persist tabs against the main workspace so every project shares the same PTY host.
      const key = getWorkspaceTerminalCacheKey(dir, serverScope)
      const existing = cache.get(key)
      if (existing) {
        cache.delete(key)
        cache.set(key, existing)
        return existing.value
      }

      const entry = createRoot((dispose) => ({
        value: createWorkspaceTerminalSession(dir, legacySessionID, serverScope, {
          client: () => ptyClient(),
          directory: () => ptyDirectory(),
          cwd: () => ptyCwd(),
          listenExited,
          createGuard: () => {
            remoteWorkspaceRevision()
            const project = projectDirectory()
            if (!project) return
            if (runtimeEnvironmentFor(project).kind !== "ssh") return
            if (boundWorkspaceID(project)) return
            return "SSH 未连接，无法打开远端终端。请先在项目栏连接。"
          },
        }),
        dispose,
      }))

      cache.set(key, entry)
      prune()
      return entry.value
    }

    // Local: one host per account main workspace. Remote: isolate by leaf workspace.
    const workspace = createMemo(() => loadWorkspace(ptyDirectory() || params.dir!, params.id, ptyHostScope()))
    const disabledBinding = {
      trim(_id: string) {},
      update(_pty: Partial<LocalPTY> & { id: string }) {},
      async clone(_id: string) {},
    }

    // Option C: keep existing tabs; on session-project change, open a new tab in the
    // current project cwd and focus it (or defer until the panel is opened).
    createEffect(
      on(
        () => ({ key: projectKey(), ready: !enabled() || workspace().ready() }),
        (next) => {
          if (!next.ready || !next.key) return
          if (boundTerminalProjectKey === undefined) {
            boundTerminalProjectKey = next.key
            return
          }
          if (boundTerminalProjectKey === next.key) return
          boundTerminalProjectKey = next.key

          if (!enabled()) return
          if (layout.view("workbench").terminal.opened()) {
            pendingTerminalProjectFollow = false
            void workspace().new()
            return
          }
          pendingTerminalProjectFollow = workspace().all().length > 0
        },
      ),
    )

    // Only wipe local metadata when the PTY host or auth/remote scope changes.
    createEffect(
      on(
        () => ({ host: ptyDirectory() || params.dir, scope: ptyHostScope(), project: projectKey() }),
        (next, prev) => {
          if (!prev?.host) return
          if (next.host === prev.host && next.scope === prev.scope) return
          loadWorkspace(prev.host!, undefined, prev.scope).trimAll()
          // Project-switch follow already opens a tab. Auto-create only when
          // the same project reconnects to a different host (local ↔ remote).
          if (prev.project && next.project !== prev.project) return
          if (!enabled()) return
          if (layout.view("workbench").terminal.opened()) {
            pendingTerminalProjectFollow = false
            if (workspace().all().length === 0) void workspace().ensure()
            return
          }
          // Prefetch / first-open already create a tab when empty.
          pendingTerminalProjectFollow = false
        },
        { defer: true },
      ),
    )

    return {
      enabled,
      /** Instance directory used for PTY HTTP/WS calls (project when SSH is bound). */
      ptyDirectory,
      /** Bound remote workspace id, if the current project is connected over SSH. */
      ptyWorkspaceID: remoteHostID,
      /** Shell cwd when creating a new terminal (remote path when SSH is bound). */
      ptyCwd,
      /**
       * If a session-project switch happened while the panel was closed, open a tab
       * for the current project now. Returns true when a follow create was started.
       */
      followProjectIfNeeded() {
        if (!pendingTerminalProjectFollow) return false
        pendingTerminalProjectFollow = false
        if (!enabled()) return false
        if (workspace().all().length > 0) return false
        void workspace().ensure()
        return true
      },
      ptyClient,
      ready: () => !enabled() || workspace().ready(),
      all: () => (enabled() ? workspace().all() : []),
      active: () => (enabled() ? workspace().active() : undefined),
      new: (): Promise<TerminalCreateResult> =>
        enabled() ? workspace().new() : Promise.resolve({ error: "终端未启用" }),
      ensure: (): Promise<TerminalCreateResult> =>
        enabled() ? workspace().ensure() : Promise.resolve({ error: "终端未启用" }),
      update: (item: Partial<LocalPTY> & { id: string }) => {
        if (!enabled()) return
        workspace().update(item)
      },
      trim: (id: string) => {
        if (!enabled()) return
        workspace().trim(id)
      },
      trimAll: () => {
        if (!enabled()) return
        workspace().trimAll()
      },
      clone: (id: string) => (enabled() ? workspace().clone(id) : Promise.resolve()),
      bind: () => (enabled() ? workspace() : disabledBinding),
      open: (id: string) => {
        if (!enabled()) return
        workspace().open(id)
      },
      close: (id: string) => (enabled() ? workspace().close(id) : Promise.resolve()),
      move: (id: string, to: number) => {
        if (!enabled()) return
        workspace().move(id, to)
      },
      next: () => {
        if (!enabled()) return
        workspace().next()
      },
      previous: () => {
        if (!enabled()) return
        workspace().previous()
      },
    }
  },
})
