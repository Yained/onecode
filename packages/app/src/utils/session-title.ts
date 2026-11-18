import type { Message, Part } from "@opencode-ai/sdk/v2"

const pattern = /^(New session|Child session)(?: - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)?$/

/** Sidebar / list labels. Full title stays in a styled hover tooltip. */
export const SESSION_TITLE_DISPLAY_MAX = 40

export function clipSessionTitle(title?: string) {
  const value = (title ?? "").replace(/\s+/g, " ").trim()
  if (!value) return value
  if (value.length <= SESSION_TITLE_DISPLAY_MAX) return value
  return `${value.slice(0, SESSION_TITLE_DISPLAY_MAX)}...`
}

/** Strip default English titles so callers can fall back to localized copy. */
export function sessionTitle(title?: string) {
  if (!title) return title
  if (pattern.test(title)) return
  return title
}

/** Prefer server title; otherwise use first user text as a provisional label. */
export function displaySessionTitle(input: {
  title?: string
  fallbackText?: string
  emptyLabel: string
}) {
  const fromServer = sessionTitle(input.title)
  if (fromServer) return fromServer
  const provisional = provisionalTitleFromText(input.fallbackText)
  if (provisional) return provisional
  return input.emptyLabel
}

export function provisionalTitleFromText(text?: string) {
  const raw = (text ?? "").replace(/\s+/g, " ").trim()
  if (!raw) return
  return raw.length > 48 ? `${raw.slice(0, 45)}...` : raw
}

/** Historical 100-char first-message titles written before ensureTitle stopped copying long prompts. */
export function firstMessageServerTitle(text?: string) {
  const raw = (text ?? "").replace(/\s+/g, " ").trim()
  if (!raw) return
  return raw.length > 100 ? `${raw.substring(0, 97)}...` : raw
}

export function isFirstMessageServerTitle(title: string, text?: string) {
  const fallback = firstMessageServerTitle(text)
  return !!fallback && title === fallback
}

export function firstUserMessageText(
  sessionID: string,
  messages: Record<string, Message[] | undefined> | undefined,
  parts: Record<string, Part[] | undefined> | undefined,
) {
  const sessionMessages = messages?.[sessionID]
  if (!sessionMessages?.length) return
  const first = sessionMessages.find((message) => message.role === "user")
  if (!first) return
  const messageParts = parts?.[first.id]
  if (!messageParts?.length) return
  return messageParts
    .filter((part) => part.type === "text" && !part.synthetic)
    .map((part) => ("text" in part ? String(part.text ?? "") : ""))
    .map((text) => text.trim())
    .find((text) => text.length > 0)
}
