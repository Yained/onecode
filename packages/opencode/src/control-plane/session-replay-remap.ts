export type SessionReplayLeafIdentity = {
  projectID: string
  directory: string
}

export type SessionReplayEvent = {
  type: string
  data: Record<string, unknown>
}

export function isSessionIdentityReplayType(type: string) {
  return type === "session.created" || type.startsWith("session.created.") || type === "session.updated" || type.startsWith("session.updated.")
}

function withLeafIdentity(info: Record<string, unknown>, leaf: SessionReplayLeafIdentity) {
  return {
    ...info,
    projectID: leaf.projectID,
    directory: leaf.directory,
  }
}

/** Warp copies a local session onto a remote leaf. The leaf ProjectTable does not
 * contain the control-plane `proj-…` id, so session.created would 500 on FK. */
export function remapSessionReplayEvents<T extends SessionReplayEvent>(events: T[], leaf: SessionReplayLeafIdentity): T[] {
  const projectID = leaf.projectID.trim()
  const directory = leaf.directory.trim()
  if (!projectID && !directory) return events

  return events.map((event) => {
    if (!isSessionIdentityReplayType(event.type)) return event
    const info = event.data?.info
    if (!info || typeof info !== "object" || Array.isArray(info)) return event
    return {
      ...event,
      data: {
        ...event.data,
        info: withLeafIdentity(info as Record<string, unknown>, {
          projectID: projectID || String((info as { projectID?: unknown }).projectID ?? ""),
          directory: directory || String((info as { directory?: unknown }).directory ?? ""),
        }),
      },
    }
  })
}

export function leafIdentityFromProject(input: { id?: unknown; worktree?: unknown; directory?: unknown }) {
  const projectID = typeof input.id === "string" ? input.id.trim() : ""
  const directory =
    (typeof input.directory === "string" && input.directory.trim()) ||
    (typeof input.worktree === "string" && input.worktree.trim()) ||
    ""
  if (!projectID) return undefined
  return { projectID, directory }
}
