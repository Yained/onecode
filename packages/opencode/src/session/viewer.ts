import type { SessionID } from "@/session/schema"

export const VIEWER_TTL_MS = 45_000

export type ViewerEntry = {
  directory: string
  sessionID: SessionID
  viewerID: string
  lastSeen: number
}

type CanReplyInput = {
  sessionID: SessionID
  viewerID?: string
  parentSessionID?: SessionID
  now?: number
}

const entries = new Map<string, ViewerEntry>()

function key(sessionID: string, viewerID: string) {
  return `${sessionID}:${viewerID}`
}

function prune(now = Date.now()) {
  for (const [id, entry] of entries) {
    if (now - entry.lastSeen <= VIEWER_TTL_MS) continue
    entries.delete(id)
  }
}

function activeEntries(sessionID: string, now = Date.now()) {
  prune(now)
  const result: ViewerEntry[] = []
  for (const entry of entries.values()) {
    if (entry.sessionID !== sessionID) continue
    if (now - entry.lastSeen > VIEWER_TTL_MS) continue
    result.push(entry)
  }
  return result
}

export function register(input: { directory: string; sessionID: SessionID; viewerID: string; now?: number }) {
  const now = input.now ?? Date.now()
  const id = key(input.sessionID, input.viewerID)
  entries.set(id, {
    directory: input.directory,
    sessionID: input.sessionID,
    viewerID: input.viewerID,
    lastSeen: now,
  })
}

export function heartbeat(input: { sessionID: SessionID; viewerID: string; now?: number }) {
  const now = input.now ?? Date.now()
  const id = key(input.sessionID, input.viewerID)
  const existing = entries.get(id)
  if (!existing) return false
  if (now - existing.lastSeen > VIEWER_TTL_MS) {
    entries.delete(id)
    return false
  }
  existing.lastSeen = now
  return true
}

export function unregister(input: { sessionID: SessionID; viewerID: string }) {
  entries.delete(key(input.sessionID, input.viewerID))
}

export function clearViewer(viewerID: string) {
  for (const [id, entry] of entries) {
    if (entry.viewerID !== viewerID) continue
    entries.delete(id)
  }
}

export function isActiveViewer(sessionID: SessionID, viewerID: string, now = Date.now()) {
  const entry = entries.get(key(sessionID, viewerID))
  if (!entry) return false
  if (now - entry.lastSeen > VIEWER_TTL_MS) {
    entries.delete(key(sessionID, viewerID))
    return false
  }
  return true
}

export function hasActiveViewers(sessionID: SessionID, now = Date.now()) {
  return activeEntries(sessionID, now).length > 0
}

export function canReply(input: CanReplyInput) {
  const now = input.now ?? Date.now()
  const sessionViewers = activeEntries(input.sessionID, now)
  const parentViewers = input.parentSessionID ? activeEntries(input.parentSessionID, now) : []
  const viewers = [...sessionViewers, ...parentViewers]
  if (viewers.length === 0) return true
  if (!input.viewerID) return false
  return viewers.some((entry) => entry.viewerID === input.viewerID)
}

/** Test helper */
export function reset() {
  entries.clear()
}
