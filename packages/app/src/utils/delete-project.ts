import {
  boundWorkspaceID,
  lastKnownWorkspaceID,
  markRemoteWorkspaceUserStopped,
  remoteWorkspaceFor,
  setRemoteWorkspaceFor,
} from "@/components/onescience/remote-workspace"

export const ARCHIVE_LIST_TIMEOUT_MS = 3_000
export const WORKSPACE_REMOVE_TIMEOUT_MS = 8_000
export const SESSION_WARP_TIMEOUT_MS = 8_000
export const LIVE_DISCONNECT_TIMEOUT_MS = 45_000
export const PROJECT_REMOVE_TIMEOUT_MS = 20_000

type SessionListClient = {
  experimental: {
    session: {
      list: (
        params: { directory: string; roots: boolean; archived: boolean; limit: number },
        options?: { signal?: AbortSignal },
      ) => Promise<{ data?: Array<{ time?: { archived?: number | null } }> }>
    }
    workspace: {
      list: (
        params: { directory: string },
        options?: { signal?: AbortSignal },
      ) => Promise<{ data?: Array<{ id?: string | null }> }>
      remove: (params: { id: string; directory: string }, options?: { signal?: AbortSignal }) => Promise<unknown>
      warp: (
        params: { directory: string; id: null; sessionID: string; copyChanges: boolean },
        options?: { signal?: AbortSignal },
      ) => Promise<unknown>
    }
  }
  project: {
    remove: (
      params: { directory: string },
      options?: { signal?: AbortSignal },
    ) => Promise<{ data?: boolean | null }>
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string, abort?: AbortController) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise.finally(() => {
      if (timer !== undefined) clearTimeout(timer)
    }),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(message))
        abort?.abort()
      }, ms)
    }),
  ])
}

/** Live bind only — leftover lastKnown wrk_* is not 已连接. */
export function liveRemoteWorkspaceID(directory: string) {
  if (!directory) return ""
  return boundWorkspaceID(directory)?.trim() || remoteWorkspaceFor(directory)?.workspaceID?.trim() || ""
}

export function sessionUsesLiveRemote(session: { directory?: string; workspaceID?: string | null }) {
  const directory = session.directory?.trim()
  if (!directory) return false
  const live = liveRemoteWorkspaceID(directory)
  if (!live) return false
  const bound = session.workspaceID?.trim()
  if (!bound) return true
  return bound === live
}

export function projectHasLiveRemote(directory: string) {
  return Boolean(liveRemoteWorkspaceID(directory))
}

/** Archived-root probe must not pin the delete button on a dead leftover SSH. */
export async function hasArchivedProjectRoots(client: SessionListClient, directory: string) {
  const abort = new AbortController()
  try {
    const listed = await withTimeout(
      client.experimental.session.list(
        { directory, roots: true, archived: true, limit: 1 },
        { signal: abort.signal },
      ),
      ARCHIVE_LIST_TIMEOUT_MS,
      "检查归档会话超时",
      abort,
    )
    return (listed.data ?? []).some((session) => !!session.time?.archived)
  } catch {
    return false
  }
}

function leftoverWorkspaceIDs(directory: string, listed: Array<{ id?: string | null }> | undefined) {
  const ids = new Set<string>()
  const live = remoteWorkspaceFor(directory)?.workspaceID?.trim()
  const known = lastKnownWorkspaceID(directory)
  if (live) ids.add(live)
  if (known) ids.add(known)
  for (const item of listed ?? []) {
    const id = item.id?.trim()
    if (id) ids.add(id)
  }
  return [...ids]
}

/**
 * Kill a live SSH bind before deleting a session/project.
 * No-ops when the UI already shows 未连接.
 */
export async function disconnectLiveRemoteWorkspace(
  client: SessionListClient,
  directory: string,
  sessionIDs: string[] = [],
) {
  const live = liveRemoteWorkspaceID(directory)
  if (!live) return { ok: true as const, error: undefined as unknown }

  for (const sessionID of sessionIDs) {
    const id = sessionID.trim()
    if (!id) continue
    const abort = new AbortController()
    await withTimeout(
      client.experimental.workspace.warp(
        { directory, id: null, sessionID: id, copyChanges: false },
        { signal: abort.signal },
      ),
      SESSION_WARP_TIMEOUT_MS,
      "断开远端超时",
      abort,
    ).catch(() => undefined)
  }

  const abort = new AbortController()
  try {
    await withTimeout(
      client.experimental.workspace.remove({ id: live, directory }, { signal: abort.signal }),
      LIVE_DISCONNECT_TIMEOUT_MS,
      "断开远端超时",
      abort,
    )
  } catch (error) {
    return { ok: false as const, error }
  }

  const remembered = remoteWorkspaceFor(directory)
  markRemoteWorkspaceUserStopped(directory)
  setRemoteWorkspaceFor(directory, {
    workspaceID: "",
    targetName: remembered?.targetName ?? "",
    ...(remembered?.remotePath?.trim() ? { remotePath: remembered.remotePath.trim() } : {}),
  })
  return { ok: true as const, error: undefined as unknown }
}

/** Drop leftover ssh-node rows even when the UI already shows 未连接. */
export async function removeLeftoverRemoteWorkspaces(client: SessionListClient, directory: string) {
  const abort = new AbortController()
  const listed = await withTimeout(
    client.experimental.workspace.list({ directory }, { signal: abort.signal }),
    ARCHIVE_LIST_TIMEOUT_MS,
    "列出远端 workspace 超时",
    abort,
  ).catch(() => ({ data: [] as Array<{ id?: string | null }> }))
  const ids = leftoverWorkspaceIDs(directory, listed.data)
  await Promise.all(
    ids.map((id) => {
      const itemAbort = new AbortController()
      return withTimeout(
        client.experimental.workspace.remove({ id, directory }, { signal: itemAbort.signal }),
        WORKSPACE_REMOVE_TIMEOUT_MS,
        "停止远端 workspace 超时",
        itemAbort,
      ).catch(() => undefined)
    }),
  )
}

export async function requestProjectRemove(client: SessionListClient, directory: string) {
  const abort = new AbortController()
  try {
    const result = await withTimeout(
      client.project.remove({ directory }, { signal: abort.signal }),
      PROJECT_REMOVE_TIMEOUT_MS,
      "删除项目超时",
      abort,
    )
    return { ok: Boolean(result.data), error: undefined as unknown }
  } catch (error) {
    return { ok: false, error }
  }
}
