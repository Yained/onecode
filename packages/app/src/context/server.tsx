import { createSimpleContext } from "@opencode-ai/ui/context"
import { type Accessor, batch, createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { persistableWorkspacePath } from "@/app-routes"
import { Persist, persisted } from "@/utils/persist"
import { pathKey } from "@/utils/path-key"
import { platformAuthLoggingOutEvent, platformWorkspaceCacheClearedEvent } from "@/utils/platform-auth"
import { useCheckServerHealth } from "@/utils/server-health"
import { setRuntimeServerUrl } from "@/config/server-url"

type StoredProject = { worktree: string; expanded: boolean }
type StoredServer = string | ServerConnection.HttpBase | ServerConnection.Any
const HEALTH_POLL_INTERVAL_MS = 10_000

export function normalizeServerUrl(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return
  const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`
  return withProtocol.replace(/\/+$/, "")
}

export function serverName(conn?: ServerConnection.Any, ignoreDisplayName = false) {
  if (!conn) return ""
  if (conn.displayName && !ignoreDisplayName) return conn.displayName
  return conn.http.url.replace(/^https?:\/\//, "").replace(/\/+$/, "")
}

function projectsKey(key: ServerConnection.Key) {
  if (!key) return ""
  if (key === "sidecar") return "local"
  if (isLocalHost(key)) return "local"
  return key
}

function isLocalHost(url: string) {
  const host = url.replace(/^https?:\/\//, "").split(":")[0]
  if (host === "localhost" || host === "127.0.0.1") return "local"
}

function normalizeServerConnection(input: ServerConnection.Any): ServerConnection.Any | undefined {
  if (input.type !== "http") return input
  const url = normalizeServerUrl(input.http.url)
  if (!url) return
  return { ...input, authToken: undefined, http: { ...input.http, url } }
}

export function createSshServerConnection(input: {
  host: string
  remotePath: string
  http: ServerConnection.HttpBase
  displayName?: string
  username?: string
  port?: string
  keyPath?: string
  command?: string
  remotePort?: string
}): ServerConnection.Ssh {
  const port = Number(input.port)
  const remotePort = Number(input.remotePort)
  const keyPath = input.keyPath?.trim()
  const command = input.command?.trim()
  return {
    type: "ssh",
    host: input.host.trim(),
    remotePath: input.remotePath.trim(),
    http: input.http,
    displayName: input.displayName?.trim() || undefined,
    username: input.username?.trim() || undefined,
    port: Number.isFinite(port) && port > 0 ? port : undefined,
    auth: keyPath ? { type: "key", keyPath } : { type: "config" },
    startup:
      command || (Number.isFinite(remotePort) && remotePort > 0)
        ? {
            command: command || undefined,
            remotePort: Number.isFinite(remotePort) && remotePort > 0 ? remotePort : undefined,
          }
        : undefined,
  }
}

export function resolveServerList(input: {
  props?: Array<ServerConnection.Any>
  stored: StoredServer[]
}): Array<ServerConnection.Any> {
  const servers = [
    ...input.stored.map((value) =>
      typeof value === "string"
        ? {
            type: "http" as const,
            http: { url: value },
          }
        : value,
    ),
    ...(input.props ?? []),
  ]

  const deduped = new Map<ServerConnection.Key, ServerConnection.Any>()
  for (const value of servers) {
    const conn: ServerConnection.Any = "type" in value ? value : { type: "http", http: value }
    const key = ServerConnection.key(conn)
    if (deduped.has(key) && conn.type === "http" && !conn.authToken) continue
    deduped.set(key, conn)
  }

  return [...deduped.values()]
}

export namespace ServerConnection {
  type Base = { displayName?: string }

  export type HttpBase = {
    url: string
    username?: string
    password?: string
  }

  // Regular web connections
  export type Http = {
    type: "http"
    http: HttpBase
    authToken?: boolean
  } & Base

  export type Sidecar = {
    type: "sidecar"
    http: HttpBase
  } & (
    | // Regular desktop server
    { variant: "base" }
    // WSL server (windows only)
    | {
        variant: "wsl"
        distro: string
      }
  ) &
    Base

  // Remote server desktop can SSH into
  export type Ssh = {
    type: "ssh"
    host: string
    port?: number
    username?: string
    remotePath: string
    auth?: {
      type: "config" | "agent" | "key" | "password"
      keyPath?: string
    }
    startup?: {
      command?: string
      remotePort?: number
    }
    tunnel?: {
      localPort: number
      remotePort: number
      status: "connecting" | "connected" | "disconnected" | "error"
    }
    http: HttpBase
  } & Base

  export type Any =
    | Http
    // All these are desktop-only
    | (Sidecar | Ssh)

  export const key = (conn: Any): Key => {
    switch (conn.type) {
      case "http":
        return Key.make(conn.http.url)
      case "sidecar": {
        if (conn.variant === "wsl") return Key.make(`wsl:${conn.distro}`)
        return Key.make("sidecar")
      }
      case "ssh":
        return Key.make(`ssh:${conn.host}:${conn.remotePath}`)
    }
  }

  export type Key = string & { _brand: "Key" }
  export const Key = { make: (v: string) => v as Key }
}

export const { use: useServer, provider: ServerProvider } = createSimpleContext({
  name: "Server",
  init: (props: {
    defaultServer: ServerConnection.Key
    disableHealthCheck?: boolean
    servers?: Array<ServerConnection.Any>
  }) => {
    const checkServerHealth = useCheckServerHealth()

    const [store, setStore, _, ready] = persisted(
      Persist.global("server", ["server.v3"]),
      createStore({
        list: [] as StoredServer[],
        projects: {} as Record<string, StoredProject[]>,
        lastProject: {} as Record<string, string>,
        lastCodeWorkspace: {} as Record<string, string>,
      }),
    )

    if (typeof window !== "undefined") {
      const clearPlatformWorkspaceCache = () => {
        batch(() => {
          setStore("projects", {})
          setStore("lastProject", {})
          setStore("lastCodeWorkspace", {})
        })
      }
      window.addEventListener(platformWorkspaceCacheClearedEvent, clearPlatformWorkspaceCache)
      window.addEventListener(platformAuthLoggingOutEvent, clearPlatformWorkspaceCache)
      onCleanup(() => {
        window.removeEventListener(platformWorkspaceCacheClearedEvent, clearPlatformWorkspaceCache)
        window.removeEventListener(platformAuthLoggingOutEvent, clearPlatformWorkspaceCache)
      })
    }

    const storedKey = (x: StoredServer) =>
      ServerConnection.key(typeof x === "string" ? { type: "http", http: { url: x } } : "type" in x ? x : { type: "http", http: x })

    const allServers = createMemo((): Array<ServerConnection.Any> => {
      return resolveServerList({ stored: store.list, props: props.servers })
    })

    const [state, setState] = createStore({
      active: props.defaultServer,
      healthy: undefined as boolean | undefined,
    })

    const healthy = () => state.healthy

    function startHealthPolling(conn: ServerConnection.Any) {
      let alive = true
      let busy = false

      const run = () => {
        if (busy) return
        busy = true
        void check(conn)
          .then((next) => {
            if (!alive) return
            setState("healthy", next)
          })
          .finally(() => {
            busy = false
          })
      }

      run()
      const interval = setInterval(run, HEALTH_POLL_INTERVAL_MS)
      return () => {
        alive = false
        clearInterval(interval)
      }
    }

    function setActive(input: ServerConnection.Key) {
      if (state.active !== input) setState("active", input)
    }

    function add(input: ServerConnection.Any) {
      const conn = normalizeServerConnection(input)
      if (!conn) return
      return batch(() => {
        const key = ServerConnection.key(conn)
        const existing = store.list.findIndex((x) => storedKey(x) === key)
        if (existing !== -1) {
          setStore("list", existing, conn)
        } else {
          setStore("list", store.list.length, conn)
        }
        setState("active", ServerConnection.key(conn))
        return conn
      })
    }

    function remove(key: ServerConnection.Key) {
      const list = store.list.filter((x) => storedKey(x) !== key)
      batch(() => {
        setStore("list", list)
        if (state.active === key) {
          const next = list[0]
          setState("active", next ? storedKey(next) : props.defaultServer)
        }
      })
    }

    const isReady = createMemo(() => ready() && !!state.active)

    const check = (conn: ServerConnection.Any) => checkServerHealth(conn.http).then((x) => x.healthy)

    createEffect(() => {
      const current_ = current()
      if (!current_) return

      if (props.disableHealthCheck) {
        setState("healthy", true)
        return
      }
      setState("healthy", undefined)
      onCleanup(startHealthPolling(current_))
    })

    createEffect(() => {
      const url = current()?.http.url
      setRuntimeServerUrl(url)
      onCleanup(() => setRuntimeServerUrl(undefined))
    })

    const origin = createMemo(() => projectsKey(state.active))
    const projectsList = createMemo(() => store.projects[origin()] ?? [])
    const current: Accessor<ServerConnection.Any | undefined> = createMemo(
      () => allServers().find((s) => ServerConnection.key(s) === state.active) ?? allServers()[0],
    )
    const isLocal = createMemo(() => {
      const c = current()
      return (c?.type === "sidecar" && c.variant === "base") || (c?.type === "http" && isLocalHost(c.http.url))
    })

    return {
      ready: isReady,
      healthy,
      isLocal,
      get key() {
        return state.active
      },
      get name() {
        return serverName(current())
      },
      get list() {
        return allServers()
      },
      get current() {
        return current()
      },
      setActive,
      add,
      remove,
      projects: {
        list: projectsList,
        open(directory: string) {
          const key = origin()
          if (!key) return
          const current = store.projects[key] ?? []
          const target = pathKey(directory)
          if (current.find((x) => pathKey(x.worktree) === target)) return
          setStore("projects", key, [{ worktree: directory, expanded: true }, ...current])
        },
        close(directory: string) {
          const key = origin()
          if (!key) return
          const current = store.projects[key] ?? []
          const target = pathKey(directory)
          setStore(
            "projects",
            key,
            current.filter((x) => pathKey(x.worktree) !== target),
          )
        },
        expand(directory: string) {
          const key = origin()
          if (!key) return
          const current = store.projects[key] ?? []
          const index = current.findIndex((x) => pathKey(x.worktree) === pathKey(directory))
          if (index !== -1) setStore("projects", key, index, "expanded", true)
        },
        collapse(directory: string) {
          const key = origin()
          if (!key) return
          const current = store.projects[key] ?? []
          const index = current.findIndex((x) => pathKey(x.worktree) === pathKey(directory))
          if (index !== -1) setStore("projects", key, index, "expanded", false)
        },
        move(directory: string, toIndex: number) {
          const key = origin()
          if (!key) return
          const current = store.projects[key] ?? []
          const fromIndex = current.findIndex((x) => pathKey(x.worktree) === pathKey(directory))
          if (fromIndex === -1 || fromIndex === toIndex) return
          const result = [...current]
          const [item] = result.splice(fromIndex, 1)
          result.splice(toIndex, 0, item)
          setStore("projects", key, result)
        },
        last() {
          const key = origin()
          if (!key) return
          return persistableWorkspacePath(store.lastProject[key])
        },
        lastCode() {
          const key = origin()
          if (!key) return
          const code = persistableWorkspacePath(store.lastCodeWorkspace[key])
          if (code) return code
          return persistableWorkspacePath(store.lastProject[key])
        },
        touch(directory: string) {
          const key = origin()
          const path = persistableWorkspacePath(directory)
          if (!key || !path) return
          setStore("lastProject", key, path)
        },
        touchCode(directory: string) {
          const key = origin()
          const path = persistableWorkspacePath(directory)
          if (!key || !path) return
          setStore("lastCodeWorkspace", key, path)
          setStore("lastProject", key, path)
        },
      },
    }
  },
})
