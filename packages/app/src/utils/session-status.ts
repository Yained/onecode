type StatusLike = { type?: string } | undefined
type MessageLike = {
  id?: string
  role?: string
  finish?: string
  time?: { completed?: number; created?: number }
}

type PartLike = {
  type?: string
  text?: string
  state?: { status?: string; output?: string }
}

/** Read live transcript fields so SSE deltas reset the busy catch-up timer. */
export function liveTranscriptEpoch(
  messages: readonly MessageLike[] | undefined,
  parts: Record<string, readonly PartLike[] | undefined> | undefined,
) {
  let epoch = messages?.length ?? 0
  if (!messages?.length) return epoch
  for (const message of messages) {
    epoch += message.time?.completed ?? 0
    const list = parts?.[messageID(message)]
    if (!list) continue
    epoch += list.length
    for (const part of list) {
      if (part.type === "text" || part.type === "reasoning") epoch += part.text?.length ?? 0
      if (part.type === "tool") {
        epoch += part.state?.status?.length ?? 0
        epoch += part.state?.output?.length ?? 0
      }
    }
  }
  return epoch
}

function messageID(message: MessageLike) {
  return message.id ?? ""
}

export function sessionMessagesLookComplete(messages: readonly MessageLike[] | undefined) {
  if (!messages?.length) return false
  const last = messages[messages.length - 1]
  if (!last || last.role === "user") return false
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant")
  if (!lastAssistant) return false
  return typeof lastAssistant.time?.completed === "number" || Boolean(lastAssistant.finish)
}

export function mergeSessionStatusMap<T extends StatusLike>(
  incoming: Record<string, T>,
  messages: Record<string, readonly MessageLike[] | undefined>,
) {
  const next = { ...incoming }
  for (const [id, status] of Object.entries(next)) {
    if (status?.type !== "busy") continue
    if (!sessionMessagesLookComplete(messages[id])) continue
    next[id] = { ...(status as object), type: "idle" } as T
  }
  return next
}
