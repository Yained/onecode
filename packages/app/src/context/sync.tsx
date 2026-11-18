import { batch, createEffect, createMemo, onCleanup, untrack, type Accessor } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { Binary } from "@opencode-ai/core/util/binary"
import { retry } from "@opencode-ai/core/util/retry"
import { createSimpleContext } from "@opencode-ai/ui/context"
import {
  clearSessionPrefetch,
  getSessionPrefetch,
  getSessionPrefetchPromise,
  setSessionPrefetch,
} from "./global-sync/session-prefetch"
import { useGlobalSync } from "./global-sync"
import { useSDK } from "./sdk"
import { useRouteParams } from "@/hooks/use-route-params"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { SESSION_CACHE_LIMIT, dropSessionCaches, pickSessionCacheEvictions } from "./global-sync/session-cache"
import { diffs as list, message as clean } from "@/utils/diffs"
import { preserveUserMessageEnvironment } from "@opencode-ai/ui/runtime-environment-marker"
import { mergeSessionStatusMap } from "@/utils/session-status"
import { isSessionNotFoundError } from "@/utils/server-errors"
import { keepRicherParts } from "./sync-merge"
import { boundWorkspaceID, isSshFileTreePending, remoteWorkspaceRevision } from "@/components/onescience/remote-workspace"
import {
  projectAllowsRemoteEnvironment,
  runtimeEnvironmentFor,
  runtimeEnvironmentRevision,
  serverRuntimeEnvironmentFor,
} from "@/components/onescience/runtime-environment"
import { pathKey } from "@/utils/path-key"
import { isWorkbenchSharedCaseBrowse } from "@/app-routes"

const SKIP_PARTS = new Set(["patch", "step-start", "step-finish"])
/** Abort hung history fetches so the UI cannot stay on「正在加载更早的消息…」forever. */
const MESSAGE_FETCH_TIMEOUT_MS = 15_000
/** Keep enough command text for the collapsed Shell subtitle. */
const THUMBNAIL_COMMAND_CHARS = 400
/** Keep a short output preview for expand; full dumps stay on the server. */
const THUMBNAIL_OUTPUT_CHARS = 400

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise.finally(() => {
      if (timer !== undefined) clearTimeout(timer)
    }),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    }),
  ])
}

function sortParts(parts: Part[]) {
  return parts.filter((part) => !!part?.id).sort((a, b) => cmp(a.id, b.id))
}

/**
 *「加载更早」must not park multi-KB Shell dumps in the Solid store. Collapsed DOM
 * defer only helps rendering — JSON parse + reconcile of full tool outputs still
 * freezes Chromium after a few successful clicks. Keep subtitle + a tiny preview.
 * Conversation text/reasoning stays intact so skill lists and long replies render.
 */
export function thumbnailizePartForHistory(part: Part): Part {
  if (part.type === "tool") {
    const state = part.state as {
      status?: string
      input?: Record<string, unknown>
      output?: string
      title?: string
      metadata?: Record<string, unknown>
      time?: { start: number; end?: number }
      attachments?: unknown
    }
    if (state.status !== "completed") return part
    const input = state.input && typeof state.input === "object" ? { ...state.input } : {}
    for (const key of ["command", "description", "filePath", "path", "pattern", "query"] as const) {
      const value = input[key]
      if (typeof value === "string" && value.length > THUMBNAIL_COMMAND_CHARS) {
        input[key] = `${value.slice(0, THUMBNAIL_COMMAND_CHARS)}…`
      }
    }
    const output =
      typeof state.output === "string" && state.output.length > THUMBNAIL_OUTPUT_CHARS
        ? `${state.output.slice(0, THUMBNAIL_OUTPUT_CHARS)}…`
        : state.output
    return {
      ...part,
      state: {
        ...state,
        input,
        output: output ?? "",
        metadata: { _historyThumbnail: true },
        attachments: undefined,
      },
    } as Part
  }
  return part
}

function partsForStore(parts: Part[], historyThumbnail: boolean) {
  const filtered = parts.filter((part) => !SKIP_PARTS.has(part.type))
  if (!historyThumbnail) return filtered
  return filtered.map(thumbnailizePartForHistory)
}

function runInflight(map: Map<string, Promise<void>>, key: string, task: () => Promise<void>) {
  const pending = map.get(key)
  if (pending) return pending
  const promise = task().finally(() => {
    map.delete(key)
  })
  map.set(key, promise)
  return promise
}

const keyFor = (directory: string, id: string) => `${directory}\n${id}`

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

function merge<T extends { id: string }>(a: readonly T[], b: readonly T[]) {
  const map = new Map(a.map((item) => [item.id, item] as const))
  for (const item of b) map.set(item.id, item)
  return [...map.values()].sort((x, y) => cmp(x.id, y.id))
}

/** Keep a richer in-memory transcript when the control plane page is a subset. */
export function keepRicherSessionMessages<T extends { id: string }>(previous: readonly T[] | undefined, incoming: T[]) {
  if (!previous?.length || incoming.length >= previous.length) return incoming
  const incomingIds = new Set(incoming.map((item) => item.id))
  if (!previous.some((item) => !incomingIds.has(item.id))) return incoming
  return merge(previous, incoming)
}

/** Assistant turns whose user parent is missing from the fetched page. */
export function missingAssistantParentIDs(messages: readonly Message[], knownUserIDs?: ReadonlySet<string>) {
  const users = new Set(knownUserIDs)
  for (const message of messages) {
    if (message.role === "user") users.add(message.id)
  }
  const missing = new Set<string>()
  for (const message of messages) {
    if (message.role !== "assistant") continue
    const parentID = message.parentID
    if (!parentID || users.has(parentID)) continue
    missing.add(parentID)
  }
  return [...missing]
}

/** True when the newest page boundary is an orphaned assistant turn (no user root yet). */
export function pageNeedsUserTurn(messages: readonly Message[]) {
  if (messages.length === 0) return false
  if (messages.some((message) => message.role === "user")) return false
  return messages.some((message) => message.role === "assistant")
}

/**
 * Older-page messages that belong to an already-loaded user turn (same parentID).
 * These are mid-turn assistants cut by pagination — not orphans — and must be merged.
 */
export function attachableEarlierMessages(messages: readonly Message[], knownUserIDs: ReadonlySet<string>) {
  return messages.filter((message) => {
    if (message.role === "user") return knownUserIDs.has(message.id)
    if (message.role !== "assistant") return false
    return Boolean(message.parentID && knownUserIDs.has(message.parentID))
  })
}

/** True when every row on an older page is a known user or that user's assistant. */
export function pageBelongsToKnownTurns(messages: readonly Message[], knownUserIDs: ReadonlySet<string>) {
  if (messages.length === 0) return false
  return messages.every((message) => {
    if (message.role === "user") return knownUserIDs.has(message.id)
    if (message.role === "assistant") return Boolean(message.parentID && knownUserIDs.has(message.parentID))
    return false
  })
}

type OptimisticStore = {
  message: Record<string, Message[] | undefined>
  part: Record<string, Part[] | undefined>
}

type OptimisticAddInput = {
  sessionID: string
  message: Message
  parts: Part[]
}

type OptimisticRemoveInput = {
  sessionID: string
  messageID: string
}

type OptimisticItem = {
  message: Message
  parts: Part[]
}

type MessagePage = {
  session: Message[]
  part: { id: string; part: Part[] }[]
  cursor?: string
  complete: boolean
  pageChars: number
}

const hasParts = (parts: Part[] | undefined, want: Part[]) => {
  if (!parts) return want.length === 0
  return want.every((part) => Binary.search(parts, part.id, (item) => item.id).found)
}

const mergeParts = (parts: Part[] | undefined, want: Part[]) => {
  if (!parts) return sortParts(want)
  const next = [...parts]
  let changed = false
  for (const part of want) {
    const result = Binary.search(next, part.id, (item) => item.id)
    if (result.found) continue
    next.splice(result.index, 0, part)
    changed = true
  }
  if (!changed) return parts
  return next
}

export function mergeOptimisticPage(page: MessagePage, items: OptimisticItem[]) {
  if (items.length === 0) return { ...page, confirmed: [] as string[] }

  const session = [...page.session]
  const part = new Map(page.part.map((item) => [item.id, sortParts(item.part)]))
  const confirmed: string[] = []

  for (const item of items) {
    const result = Binary.search(session, item.message.id, (message) => message.id)
    const found = result.found
    if (!found) session.splice(result.index, 0, item.message)

    const current = part.get(item.message.id)
    if (found && hasParts(current, item.parts)) {
      confirmed.push(item.message.id)
      continue
    }

    part.set(item.message.id, mergeParts(current, item.parts))
  }

  return {
    cursor: page.cursor,
    complete: page.complete,
    pageChars: page.pageChars,
    session,
    part: [...part.entries()].sort((a, b) => cmp(a[0], b[0])).map(([id, part]) => ({ id, part })),
    confirmed,
  }
}

export function applyOptimisticAdd(draft: OptimisticStore, input: OptimisticAddInput) {
  const messages = draft.message[input.sessionID]
  if (messages) {
    const result = Binary.search(messages, input.message.id, (m) => m.id)
    messages.splice(result.index, 0, input.message)
  } else {
    draft.message[input.sessionID] = [input.message]
  }
  draft.part[input.message.id] = sortParts(input.parts)
}

export function applyOptimisticRemove(draft: OptimisticStore, input: OptimisticRemoveInput) {
  const messages = draft.message[input.sessionID]
  if (messages) {
    const result = Binary.search(messages, input.messageID, (m) => m.id)
    if (result.found) messages.splice(result.index, 1)
  }
  delete draft.part[input.messageID]
}

function setOptimisticAdd(setStore: (...args: unknown[]) => void, input: OptimisticAddInput) {
  setStore("message", input.sessionID, (messages: Message[] | undefined) => {
    if (!messages) return [input.message]
    const result = Binary.search(messages, input.message.id, (m) => m.id)
    const next = [...messages]
    next.splice(result.index, 0, input.message)
    return next
  })
  setStore("part", input.message.id, sortParts(input.parts))
}

function setOptimisticRemove(setStore: (...args: unknown[]) => void, input: OptimisticRemoveInput) {
  setStore("message", input.sessionID, (messages: Message[] | undefined) => {
    if (!messages) return messages
    const result = Binary.search(messages, input.messageID, (m) => m.id)
    if (!result.found) return messages
    const next = [...messages]
    next.splice(result.index, 1)
    return next
  })
  setStore("part", (part: Record<string, Part[] | undefined>) => {
    if (!(input.messageID in part)) return part
    const next = { ...part }
    delete next[input.messageID]
    return next
  })
}

function preserveMessageEnvironments(previous: Message[] | undefined, next: Message[]): Message[] {
  if (!previous?.length) return next
  const byId = new Map(previous.map((message) => [message.id, message]))
  return next.map((message) => preserveUserMessageEnvironment(byId.get(message.id), message))
}

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const globalSync = useGlobalSync()
    const sdk = useSDK()
    const params = useRouteParams()

    type Child = ReturnType<(typeof globalSync)["child"]>
    type Setter = Child[1]

    // Never bootstrap on read — instance bootstrap (and historically /provider) saturates
    // HTTP/1.1 and leaves /code sidebar session skeletons visible for ~1s.
    const current = createMemo(() => globalSync.child(sdk.directory, { bootstrap: false }))
    const prevBoundByDirectory = new Map<string, string>()

    createEffect(() => {
      const directory = sdk.directory
      if (!directory) return
      // Wait until project.list has stamped execution env. Opening a remote session
      // before that treats the dir as local and instance-bootstraps on A (cache-clear freeze).
      if (!globalSync.bootstrapped) return
      runtimeEnvironmentRevision()
      // Track live bind so 连接 re-runs this effect for forceDirectoryBootstrap.
      remoteWorkspaceRevision()
      const bound = boundWorkspaceID(directory) ?? ""
      const sessionID = params.id
      const dirKey = pathKey(directory)
      const prevBound = prevBoundByDirectory.get(dirKey) ?? ""
      const becameBound = !!bound && bound !== prevBound
      prevBoundByDirectory.set(dirKey, bound)
      const markChildReady = () => {
        const [store, setStore] = globalSync.child(directory, { bootstrap: false })
        if (store.status === "loading") setStore("status", "complete")
      }
      // Shared catalog is local browse-only. A leftover SSH bind used to skip
      // instance bootstrap while status stayed "loading", which gated Session
      // behind SyncProvider.ready and left the workbench session pane blank.
      if (isWorkbenchSharedCaseBrowse(directory, sessionID)) {
        untrack(() => {
          markChildReady()
          void globalSync.project.loadSessions(directory).finally(() => {
            queueMicrotask(() => {
              void globalSync.forceDirectoryBootstrap(directory)
            })
          })
        })
        return
      }
      // Unbound SSH / unconfirmed remote: session.tsx sync loads control-plane SQLite.
      // Existing session IDs still need ready=true — otherwise createSimpleContext
      // gates Session and personal case forks paint a blank pane (default cases
      // used to be the only path that marked complete).
      if (isSshFileTreePending(directory)) {
        untrack(() => markChildReady())
        return
      }
      untrack(() => {
        void globalSync.project.loadSessions(directory).finally(() => {
          queueMicrotask(() => {
            // Disconnected SSH: SQLite history only — never /agent /file /vcs against A or a dead leaf.
            if (isSshFileTreePending(directory)) {
              markChildReady()
              return
            }
            // Unbound open may have marked status complete without leaf APIs. child(bootstrap:true)
            // only runs onBootstrap when status==="loading", so 连接 must force bootstrapInstance.
            if (becameBound) {
              void globalSync.forceDirectoryBootstrap(directory)
              // Session page re-syncs transcript when boundWorkspaceID appears; do not
              // keep the unbound empty [] from F5.
              return
            }
            // After global bootstrap, SSH projects are stamped. If kind is still ssh but
            // unbound, do not instance-bootstrap (cache-clear race / path alias). Local only.
            if (runtimeEnvironmentFor(directory).kind === "ssh") {
              markChildReady()
              return
            }
            // Cache-clear wipes client preference; missing CP execution leaves kind as the
            // *default* local. Bootstrapping then floods /agent|/status|/vcs on HTTP/1.1
            // (welcome stuck, Network 0 kB). Wait until CP/marker confirms local.
            if (
              projectAllowsRemoteEnvironment(directory) &&
              serverRuntimeEnvironmentFor(directory)?.kind !== "local"
            ) {
              markChildReady()
              return
            }
            // Existing session *or* bare new-session composer: leaf bootstrap clears
            // status "loading" so SyncProvider.ready becomes true. Skipping bootstrap
            // for !sessionID left first-login 「新建会话」 as an empty keepalive shell.
            globalSync.child(directory, { bootstrap: true })
          })
        })
      })
    })

    const target = (directory?: string) => {
      if (!directory || directory === sdk.directory) return current()
      return globalSync.child(directory, { bootstrap: false })
    }
    const absolute = (path: string) => (current()[0].path.directory + "/" + path).replace("//", "/")
    const initialMessagePageSize = 12
    // Shell details are deferred + history parts are thumbnailized, so pages can
    // be moderately large again while draining back to the previous user turn.
    const historyMessagePageSize = 12
    const inflight = new Map<string, Promise<void>>()
    const inflightDiff = new Map<string, Promise<void>>()
    const inflightTodo = new Map<string, Promise<void>>()
    const optimistic = new Map<string, Map<string, OptimisticItem>>()
    const maxDirs = 30
    const seen = new Map<string, Set<string>>()
    const [meta, setMeta] = createStore({
      limit: {} as Record<string, number>,
      cursor: {} as Record<string, string | undefined>,
      complete: {} as Record<string, boolean>,
      loading: {} as Record<string, boolean>,
      /** Approx serialized size of the most recent history page for this session. */
      lastPageChars: {} as Record<string, number>,
    })

    const getSession = (sessionID: string) => {
      const store = current()[0]
      const match = Binary.search(store.session, sessionID, (s) => s.id)
      if (match.found) return store.session[match.index]
      return undefined
    }

    const setOptimistic = (directory: string, sessionID: string, item: OptimisticItem) => {
      const key = keyFor(directory, sessionID)
      const list = optimistic.get(key)
      if (list) {
        list.set(item.message.id, { message: item.message, parts: sortParts(item.parts) })
        return
      }
      optimistic.set(key, new Map([[item.message.id, { message: item.message, parts: sortParts(item.parts) }]]))
    }

    const clearOptimistic = (directory: string, sessionID: string, messageID?: string) => {
      const key = keyFor(directory, sessionID)
      if (!messageID) {
        optimistic.delete(key)
        return
      }

      const list = optimistic.get(key)
      if (!list) return
      list.delete(messageID)
      if (list.size === 0) optimistic.delete(key)
    }

    const getOptimistic = (directory: string, sessionID: string) => [
      ...(optimistic.get(keyFor(directory, sessionID))?.values() ?? []),
    ]

    const seenFor = (directory: string) => {
      const existing = seen.get(directory)
      if (existing) {
        seen.delete(directory)
        seen.set(directory, existing)
        return existing
      }
      const created = new Set<string>()
      seen.set(directory, created)
      while (seen.size > maxDirs) {
        const first = seen.keys().next().value
        if (!first) break
        const stale = [...(seen.get(first) ?? [])]
        seen.delete(first)
        const [, setStore] = globalSync.child(first, { bootstrap: false })
        evict(first, setStore, stale)
      }
      return created
    }

    const clearMeta = (directory: string, sessionIDs: string[]) => {
      if (sessionIDs.length === 0) return
      for (const sessionID of sessionIDs) {
        clearOptimistic(directory, sessionID)
      }
      setMeta(
        produce((draft) => {
          for (const sessionID of sessionIDs) {
            const key = keyFor(directory, sessionID)
            delete draft.limit[key]
            delete draft.cursor[key]
            delete draft.complete[key]
            delete draft.loading[key]
          }
        }),
      )
    }

    const evict = (directory: string, setStore: Setter, sessionIDs: string[]) => {
      if (sessionIDs.length === 0) return
      clearSessionPrefetch(directory, sessionIDs)
      for (const sessionID of sessionIDs) {
        globalSync.todo.set(sessionID, undefined)
      }
      setStore(
        produce((draft) => {
          dropSessionCaches(draft, sessionIDs)
        }),
      )
      clearMeta(directory, sessionIDs)
    }

    const touch = (directory: string, setStore: Setter, sessionID: string) => {
      const stale = pickSessionCacheEvictions({
        seen: seenFor(directory),
        keep: sessionID,
        limit: SESSION_CACHE_LIMIT,
      })
      evict(directory, setStore, stale)
    }

    const fetchMessages = async (input: {
      client: typeof sdk.client
      sessionID: string
      limit: number
      before?: string
    }): Promise<MessagePage> => {
      const messages = await withTimeout(
        retry(() =>
          input.client.session.messages({ sessionID: input.sessionID, limit: input.limit, before: input.before }),
        ),
        MESSAGE_FETCH_TIMEOUT_MS,
        "session.messages",
      )
      const items = (messages.data ?? []).filter((x) => !!x?.info?.id)
      const session = items.map((x) => clean(x.info)).sort((a, b) => cmp(a.id, b.id))
      const part = items.map((message) => ({ id: message.info.id, part: sortParts(message.parts) }))
      const cursor = messages.response.headers.get("x-next-cursor") ?? undefined
      // Prefer Content-Length; fall back to a cheap stringify of parts only.
      const headerBytes = Number(messages.response.headers.get("content-length") ?? 0)
      const pageChars =
        Number.isFinite(headerBytes) && headerBytes > 0
          ? headerBytes
          : part.reduce((sum, row) => sum + JSON.stringify(row.part).length, 0)
      return {
        session,
        part,
        cursor,
        complete: !cursor,
        pageChars,
      }
    }

    const tracked = (directory: string, sessionID: string) => seen.get(directory)?.has(sessionID) ?? false

    const loadMessages = async (input: {
      directory: string
      client: typeof sdk.client
      setStore: Setter
      sessionID: string
      limit: number
      before?: string
      mode?: "replace" | "prepend"
      force?: boolean
    }) => {
      const key = keyFor(input.directory, input.sessionID)
      if (meta.loading[key] && !input.force) return

      setMeta("loading", key, true)
      const bindAtStart = boundWorkspaceID(input.directory) ?? ""
      const [store] = globalSync.child(input.directory, { bootstrap: false })
      const cachedUsers = new Set(
        (store.message[input.sessionID] ?? []).filter((message) => message.role === "user").map((message) => message.id),
      )
      try {
        // Newest page first on replace. Do not hoist the turn's user root or absorb
        // mid-turn assistants — that made AlphaFold look like "already at the top"
        // while the middle was still behind「加载更早」. Assistant-only windows still
        // render; load-earlier / prepend walks backward and merges same-turn replies.
        const page = await fetchMessages({
          client: input.client,
          sessionID: input.sessionID,
          limit: input.limit,
          before: input.before,
        })
        if (!tracked(input.directory, input.sessionID)) return
        if ((boundWorkspaceID(input.directory) ?? "") !== bindAtStart) return
        const next = mergeOptimisticPage(page, getOptimistic(input.directory, input.sessionID))
        setMeta("lastPageChars", key, page.pageChars)
        for (const messageID of next.confirmed) {
          clearOptimistic(input.directory, input.sessionID, messageID)
        }
        const [currentStore] = globalSync.child(input.directory, { bootstrap: false })
        const cached = input.mode === "prepend" ? (currentStore.message[input.sessionID] ?? []) : []
        const existingIds =
          input.mode === "prepend" ? new Set(cached.map((message) => message.id)) : undefined
        const novelMessages = existingIds
          ? next.session.filter((message) => !existingIds.has(message.id))
          : next.session
        const novelUsers = novelMessages.filter((message) => message.role === "user")
        // Empty/duplicate older pages: clear cursor so「加载更早」disappears at the true top.
        if (input.mode === "prepend" && novelMessages.length === 0) {
          batch(() => {
            setMeta("cursor", key, undefined)
            setMeta("complete", key, true)
            setSessionPrefetch({
              directory: input.directory,
              sessionID: input.sessionID,
              limit: cached.length,
              cursor: undefined,
              complete: true,
            })
          })
          return
        }
        // Older pages with no *new* user turn: either mid-turn assistants of a cached
        // user (merge them) or true orphans (advance cursor without polluting the store).
        if (input.mode === "prepend" && novelUsers.length === 0) {
          const knownUsers = new Set(cachedUsers)
          const attachable = attachableEarlierMessages(novelMessages, knownUsers)
          if (attachable.length > 0) {
            const attachableIDs = new Set(attachable.map((message) => message.id))
            const message = merge(cached, attachable)
            batch(() => {
              input.setStore("message", input.sessionID, reconcile(message, { key: "id" }))
              for (const p of next.part) {
                if (!attachableIDs.has(p.id)) continue
                const filtered = partsForStore(p.part, true)
                if (filtered.length) input.setStore("part", p.id, filtered)
              }
              setMeta("limit", key, message.length)
              setMeta("cursor", key, next.cursor)
              setMeta("complete", key, next.complete)
              setSessionPrefetch({
                directory: input.directory,
                sessionID: input.sessionID,
                limit: message.length,
                cursor: next.cursor,
                complete: next.complete,
              })
            })
            return
          }
          // True orphans (unknown parent): skip merge, walk cursor past them.
          // When the open window is still assistant-only, treat same-parent assistants
          // as attachable even without a cached user so「加载更早」can walk backward.
          if (knownUsers.size === 0) {
            const orphanAssistants = novelMessages.filter((message) => message.role === "assistant")
            if (orphanAssistants.length > 0) {
              const attachableIDs = new Set(orphanAssistants.map((message) => message.id))
              const message = merge(cached, orphanAssistants)
              batch(() => {
                input.setStore("message", input.sessionID, reconcile(message, { key: "id" }))
                for (const p of next.part) {
                  if (!attachableIDs.has(p.id)) continue
                  const filtered = partsForStore(p.part, true)
                  if (filtered.length) input.setStore("part", p.id, filtered)
                }
                setMeta("limit", key, message.length)
                setMeta("cursor", key, next.cursor)
                setMeta("complete", key, next.complete)
                setSessionPrefetch({
                  directory: input.directory,
                  sessionID: input.sessionID,
                  limit: message.length,
                  cursor: next.cursor,
                  complete: next.complete,
                })
              })
              return
            }
          }
          batch(() => {
            setMeta("cursor", key, next.cursor)
            setMeta("complete", key, !next.cursor)
            setSessionPrefetch({
              directory: input.directory,
              sessionID: input.sessionID,
              limit: cached.length,
              cursor: next.cursor,
              complete: !next.cursor,
            })
          })
          return
        }
        const incoming =
          input.mode === "prepend"
            ? merge(cached, next.session)
            : keepRicherSessionMessages(currentStore.message[input.sessionID], next.session)
        const message = preserveMessageEnvironments(currentStore.message[input.sessionID], incoming)
        batch(() => {
          input.setStore("message", input.sessionID, reconcile(message, { key: "id" }))
          for (const p of next.part) {
            // History pagination (open +「加载更早」): store thumbnails, not full Shell dumps.
            const filtered = partsForStore(p.part, true)
            if (!filtered.length) continue
            input.setStore("part", p.id, keepRicherParts(currentStore.part[p.id], filtered))
          }
          setMeta("limit", key, message.length)
          setMeta("cursor", key, next.cursor)
          setMeta("complete", key, next.complete)
          setSessionPrefetch({
            directory: input.directory,
            sessionID: input.sessionID,
            limit: message.length,
            cursor: next.cursor,
            complete: next.complete,
          })
        })
      } catch {
        // Timed out / failed: clear loading and stop autofill from retrying forever.
        // Keep whatever messages are already cached so the timeline can still render.
        if (!tracked(input.directory, input.sessionID)) return
        if (input.mode === "prepend") {
          setMeta("complete", key, true)
          return
        }
        const [currentStore] = globalSync.child(input.directory, { bootstrap: false })
        if (currentStore.message[input.sessionID] === undefined) {
          if (isSshFileTreePending(input.directory) || (boundWorkspaceID(input.directory) ?? "") !== bindAtStart) {
            return
          }
          batch(() => {
            input.setStore("message", input.sessionID, [])
            setMeta("limit", key, 0)
            setMeta("complete", key, true)
          })
        }
      } finally {
        setMeta(
          produce((draft) => {
            if (!tracked(input.directory, input.sessionID)) {
              delete draft.loading[key]
              return
            }
            draft.loading[key] = false
          }),
        )
      }
    }

    return {
      get data() {
        return current()[0]
      },
      get set(): Setter {
        return current()[1]
      },
      get status() {
        return current()[0].status
      },
      get ready() {
        return current()[0].status !== "loading"
      },
      get project() {
        const store = current()[0]
        const match = Binary.search(globalSync.data.project, store.project, (p) => p.id)
        if (match.found) return globalSync.data.project[match.index]
        return undefined
      },
      session: {
        get: getSession,
        optimistic: {
          add(input: { directory?: string; sessionID: string; message: Message; parts: Part[] }) {
            const directory = input.directory ?? sdk.directory
            const [, setStore] = target(input.directory)
            setOptimistic(directory, input.sessionID, { message: input.message, parts: input.parts })
            setOptimisticAdd(setStore as (...args: unknown[]) => void, input)
          },
          remove(input: { directory?: string; sessionID: string; messageID: string }) {
            const directory = input.directory ?? sdk.directory
            const [, setStore] = target(input.directory)
            clearOptimistic(directory, input.sessionID, input.messageID)
            setOptimisticRemove(setStore as (...args: unknown[]) => void, input)
          },
        },
        addOptimisticMessage(input: {
          sessionID: string
          messageID: string
          parts: Part[]
          agent: string
          model: { providerID: string; modelID: string }
          variant?: string
        }) {
          const message: Message = {
            id: input.messageID,
            sessionID: input.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: input.agent,
            model: { ...input.model, variant: input.variant },
          }
          const [, setStore] = target()
          setOptimistic(sdk.directory, input.sessionID, { message, parts: input.parts })
          setOptimisticAdd(setStore as (...args: unknown[]) => void, {
            sessionID: input.sessionID,
            message,
            parts: input.parts,
          })
        },
        async sync(sessionID: string, opts?: { force?: boolean }) {
          const directory = sdk.directory
          const client = sdk.client
          const [store, setStore] = globalSync.child(directory, { bootstrap: false })
          const key = keyFor(directory, sessionID)
          const bindKey = boundWorkspaceID(directory) ?? ""

          touch(directory, setStore, sessionID)

          const seeded = getSessionPrefetch(directory, sessionID)
          if (seeded && store.message[sessionID] !== undefined && meta.limit[key] === undefined) {
            batch(() => {
              setMeta("limit", key, seeded.limit)
              setMeta("cursor", key, seeded.cursor)
              setMeta("complete", key, seeded.complete)
              setMeta("loading", key, false)
            })
          }

          return runInflight(inflight, `${key}\n${bindKey}`, async () => {
            try {
              const pending = getSessionPrefetchPromise(directory, sessionID)
              if (pending) {
                await pending
                const seeded = getSessionPrefetch(directory, sessionID)
                if (seeded && store.message[sessionID] !== undefined && meta.limit[key] === undefined) {
                  batch(() => {
                    setMeta("limit", key, seeded.limit)
                    setMeta("cursor", key, seeded.cursor)
                    setMeta("complete", key, seeded.complete)
                    setMeta("loading", key, false)
                  })
                }
              }

              const hasSession = Binary.search(store.session, sessionID, (s) => s.id).found
              let cached = store.message[sessionID] !== undefined && meta.limit[key] !== undefined
              // Cross-project leave can fail to compact (sdk.directory already flipped).
              // Never early-return an oversized「加载更早」window — remounting it freezes
              // the main thread on project switch before any「加载更早」click.
              if (cached && !opts?.force) {
                const size = store.message[sessionID]?.length ?? 0
                // Never early-return an oversized「加载更早」window — remounting it freezes
                // the main thread on project switch before any「加载更早」click.
                if (size > initialMessagePageSize) {
                  evict(directory, setStore, [sessionID])
                  cached = false
                } else if (hasSession) {
                  return
                }
              }

              // Never re-fetch with meta.limit (grows as the user clicks「加载更早」).
              // That previously re-hydrated the entire expanded window on return and froze
              // AlphaFold-sized sessions. Replace loads always use the first-page size.
              const limit = initialMessagePageSize
              const needsSession = !hasSession || !!opts?.force
              const needsMessages = !cached || !!opts?.force

              if (needsSession) {
                await retry(() => client.session.get({ sessionID })).then((session) => {
                  if (!tracked(directory, sessionID)) return
                  const data = session.data
                  if (!data) return
                  setStore(
                    "session",
                    produce((draft) => {
                      const match = Binary.search(draft, sessionID, (s) => s.id)
                      if (match.found) {
                        draft[match.index] = data
                        return
                      }
                      draft.splice(match.index, 0, data)
                    }),
                  )
                })
              }

              if (needsMessages) {
                await loadMessages({
                  directory,
                  client,
                  setStore,
                  sessionID,
                  limit,
                  force: !!opts?.force || !!bindKey,
                })
              }
            } catch (error) {
              // Unbound/dead SSH routing must not leave message[id] undefined (skeleton forever)
              // or throw into createResource (blank white pane). Seed an empty page and only
              // propagate true Session-not-found so the route can bounce.
              if (tracked(directory, sessionID) && store.message[sessionID] === undefined) {
                if (!isSshFileTreePending(directory)) {
                  batch(() => {
                    setStore("message", sessionID, [])
                    setMeta("limit", key, 0)
                    setMeta("complete", key, true)
                    setMeta("loading", key, false)
                  })
                }
              }
              if (isSessionNotFoundError(error)) throw error
              console.error("session sync failed", error)
            }
          })
        },
        async diff(sessionID: string, opts?: { force?: boolean }) {
          const directory = sdk.directory
          const client = sdk.client
          const [store, setStore] = globalSync.child(directory, { bootstrap: false })
          touch(directory, setStore, sessionID)
          if (store.session_diff[sessionID] !== undefined && !opts?.force) return

          const key = keyFor(directory, sessionID)
          return runInflight(inflightDiff, key, () =>
            retry(() => client.session.diff({ sessionID })).then((diff) => {
              if (!tracked(directory, sessionID)) return
              setStore("session_diff", sessionID, reconcile(list(diff.data), { key: "file" }))
            }),
          )
        },
        async todo(sessionID: string, opts?: { force?: boolean }) {
          const directory = sdk.directory
          const client = sdk.client
          const [store, setStore] = globalSync.child(directory, { bootstrap: false })
          touch(directory, setStore, sessionID)
          const existing = store.todo[sessionID]
          const cached = globalSync.data.session_todo[sessionID]
          if (existing !== undefined) {
            if (cached === undefined) {
              globalSync.todo.set(sessionID, existing)
            }
            if (!opts?.force) return
          }

          if (cached !== undefined) {
            setStore("todo", sessionID, reconcile(cached, { key: "id" }))
          }

          const key = keyFor(directory, sessionID)
          return runInflight(inflightTodo, key, () =>
            retry(() => client.session.todo({ sessionID })).then((todo) => {
              if (!tracked(directory, sessionID)) return
              const list = todo.data ?? []
              setStore("todo", sessionID, reconcile(list, { key: "id" }))
              globalSync.todo.set(sessionID, list)
            }),
          )
        },
        history: {
          more(sessionID: string) {
            const store = current()[0]
            const key = keyFor(sdk.directory, sessionID)
            if (store.message[sessionID] === undefined) return false
            if (meta.limit[key] === undefined) return false
            if (meta.complete[key]) return false
            return !!meta.cursor[key]
          },
          loading(sessionID: string) {
            const key = keyFor(sdk.directory, sessionID)
            return meta.loading[key] ?? false
          },
          /** Approx size of the last fetched history page (for fat-page drain abort). */
          lastPageChars(sessionID: string) {
            const key = keyFor(sdk.directory, sessionID)
            return meta.lastPageChars[key] ?? 0
          },
          /** Hide「加载更早」when older pages are only non-visible orphans / exhausted. */
          markComplete(sessionID: string) {
            const directory = sdk.directory
            const key = keyFor(directory, sessionID)
            const [store] = globalSync.child(directory, { bootstrap: false })
            const cached = store.message[sessionID] ?? []
            batch(() => {
              setMeta("cursor", key, undefined)
              setMeta("complete", key, true)
              setSessionPrefetch({
                directory,
                sessionID,
                limit: cached.length,
                cursor: undefined,
                complete: true,
              })
            })
          },
          /**
           * Drop an expanded in-memory history window when leaving a session.
           * After「加载更早」the store can hold the full AlphaFold transcript; keeping it
           * makes the next mount rebuild the whole timeline projection and freeze the UI.
           *
           * `directory` must be the session's own directory. On project switch, cleanup
           * runs after sdk.directory already points at the target project — using the
           * live directory would compact the wrong store (or no-op) and leave the
           * expanded cache to remount on return.
           */
          compact(sessionID: string, directory = sdk.directory) {
            const [store, setStore] = globalSync.child(directory, { bootstrap: false })
            const messages = store.message[sessionID]
            if (!messages || messages.length <= initialMessagePageSize) return
            evict(directory, setStore, [sessionID])
          },
          async loadMore(sessionID: string, count?: number) {
            const directory = sdk.directory
            const client = sdk.client
            const [, setStore] = globalSync.child(directory, { bootstrap: false })
            touch(directory, setStore, sessionID)
            const key = keyFor(directory, sessionID)
            const step = count ?? historyMessagePageSize
            if (meta.loading[key]) return
            if (meta.complete[key]) return
            const before = meta.cursor[key]
            if (!before) return

            await loadMessages({
              directory,
              client,
              setStore,
              sessionID,
              limit: step,
              before,
              mode: "prepend",
            })
          },
          /** Replace thumbnailized history parts with the full server message on Shell expand. */
          async hydrateMessage(sessionID: string, messageID: string) {
            const directory = sdk.directory
            const client = sdk.client
            const [, setStore] = globalSync.child(directory, { bootstrap: false })
            touch(directory, setStore, sessionID)
            const response = await withTimeout(
              retry(() => client.session.message({ sessionID, messageID })),
              MESSAGE_FETCH_TIMEOUT_MS,
              "session.message",
            )
            const parts = response.data?.parts
            if (!parts?.length) return
            const filtered = parts.filter((part) => !!part?.id && !SKIP_PARTS.has(part.type))
            setStore("part", messageID, sortParts(filtered))
          },
        },
        async status() {
          if (isSshFileTreePending(sdk.directory)) return
          const [store, setStore] = globalSync.child(sdk.directory, { bootstrap: false })
          await retry(() =>
            sdk.client.session.status().then((x) =>
              setStore("session_status", mergeSessionStatusMap(x.data ?? {}, store.message)),
            ),
          )
        },
        evict(sessionID: string, directory = sdk.directory) {
          const [, setStore] = globalSync.child(directory, { bootstrap: false })
          seenFor(directory).delete(sessionID)
          evict(directory, setStore, [sessionID])
        },
        fetch: async (count = 10) => {
          const directory = sdk.directory
          const client = sdk.client
          const [store, setStore] = globalSync.child(directory, { bootstrap: false })
          setStore("limit", (x) => x + count)
          await client.session.list().then((x) => {
            const sessions = (x.data ?? [])
              .filter((s) => !!s?.id)
              .sort((a, b) => cmp(a.id, b.id))
              .slice(0, store.limit)
            setStore("session", reconcile(sessions, { key: "id" }))
          })
        },
        more: createMemo(() => current()[0].session.length >= current()[0].limit),
        archive: async (sessionID: string) => {
          const directory = sdk.directory
          const client = sdk.client
          const [, setStore] = globalSync.child(directory, { bootstrap: false })
          await client.session.update({ sessionID, time: { archived: Date.now() } })
          setStore(
            produce((draft) => {
              const match = Binary.search(draft.session, sessionID, (s) => s.id)
              if (match.found) draft.session.splice(match.index, 1)
            }),
          )
        },
      },
      absolute,
      get directory() {
        return current()[0].path.directory
      },
    }
  },
})
