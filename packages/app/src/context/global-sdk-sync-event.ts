import type { Event } from "@opencode-ai/sdk/v2/client"

type SyncEventPayload = {
  type?: string
  syncEvent?: {
    id?: string
    type?: string
    aggregateID?: string
    data?: Record<string, unknown>
  }
}

function syncTypeName(type: string) {
  const versioned = type.match(/^(.*)\.(\d+)$/)
  return versioned?.[1] ?? type
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function asString(value: unknown) {
  return typeof value === "string" && value ? value : undefined
}

/** Control-plane / local instance emit `{ type: "sync" }` immediately from SQLite.
 * The UI used to keep only session.updated and drop message/part sync events,
 * so the timeline depended on a later async Bus.publish. Under a burst of tool
 * parts that publish lags or fails — F5 then reads SQLite and "fixes" it. */
export function mapSyncEventToUiEvent(payload: unknown): Event | undefined {
  const envelope = payload as SyncEventPayload
  if (envelope.type !== "sync") return
  const syncEvent = envelope.syncEvent
  const type = syncTypeName(syncEvent?.type ?? "")
  const data = asRecord(syncEvent?.data)
  if (!type || !data) return

  if (type === "session.updated") {
    const info = asRecord(data.info)
    const sessionID = asString(info?.id) || asString(data.sessionID) || asString(syncEvent?.aggregateID)
    if (!sessionID || !info || typeof info.title !== "string" || !info.title) return
    return {
      id: syncEvent?.id ?? sessionID,
      type: "session.updated",
      properties: { info: { id: sessionID, ...info } },
    } as Event
  }

  if (type === "message.updated") {
    const info = asRecord(data.info)
    const sessionID = asString(info?.sessionID) || asString(data.sessionID)
    if (!info || !asString(info.id) || !sessionID) return
    return {
      id: syncEvent?.id ?? String(info.id),
      type: "message.updated",
      properties: { sessionID, info },
    } as Event
  }

  if (type === "message.removed") {
    const sessionID = asString(data.sessionID)
    const messageID = asString(data.messageID)
    if (!sessionID || !messageID) return
    return {
      id: syncEvent?.id ?? messageID,
      type: "message.removed",
      properties: { sessionID, messageID },
    } as Event
  }

  if (type === "message.part.updated") {
    const part = asRecord(data.part)
    const sessionID = asString(part?.sessionID) || asString(data.sessionID)
    const time = typeof data.time === "number" ? data.time : Date.now()
    if (!part || !asString(part.id) || !asString(part.messageID) || !sessionID) return
    return {
      id: syncEvent?.id ?? String(part.id),
      type: "message.part.updated",
      properties: { sessionID, part, time },
    } as Event
  }

  if (type === "message.part.removed") {
    const sessionID = asString(data.sessionID)
    const messageID = asString(data.messageID)
    const partID = asString(data.partID)
    if (!sessionID || !messageID || !partID) return
    return {
      id: syncEvent?.id ?? partID,
      type: "message.part.removed",
      properties: { sessionID, messageID, partID },
    } as Event
  }
}
