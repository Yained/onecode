import type { Part } from "@opencode-ai/sdk/v2/client"

const MAX_DATA_URL_CHARS = 256 * 1024
/** Tool outputs stay tight — they are often huge and rarely need full fidelity in the timeline. */
const MAX_TOOL_OUTPUT_CHARS = 8_000
const MAX_TOOL_INPUT_BODY_CHARS = 4_000
const TOOL_INPUT_BODY_KEYS = ["content", "oldString", "newString"] as const

function stubDataUrl(url: string, mime?: string) {
  const media = mime || url.slice(5, url.indexOf(";")) || "application/octet-stream"
  return `data:${media};base64,`
}

function truncateText(text: string, max: number) {
  if (text.length <= max) return text
  const omitted = text.length - max
  return `${text.slice(0, max)}\n\n[Truncated for session UI: omitted ${omitted} chars]`
}

function compactToolInput(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input
  const next: Record<string, unknown> = { ...(input as Record<string, unknown>) }
  let changed = false
  for (const key of TOOL_INPUT_BODY_KEYS) {
    const value = next[key]
    if (typeof value !== "string" || value.length <= MAX_TOOL_INPUT_BODY_CHARS) continue
    next[key] = truncateText(value, MAX_TOOL_INPUT_BODY_CHARS)
    changed = true
  }
  return changed ? next : input
}

/** Cap SSE/live tool/file payloads before they enter the Solid store. Conversation text is kept intact. */
export function sanitizePartForClientStore(input: Part): Part {
  if (input.type === "file" && typeof input.url === "string" && input.url.length > MAX_DATA_URL_CHARS) {
    return {
      ...input,
      url: input.url.startsWith("data:")
        ? stubDataUrl(input.url, input.mime)
        : `${input.url.slice(0, 128)}…[truncated ${input.url.length} chars]`,
    }
  }

  if (input.type === "tool") {
    const state = input.state
    const compactedInput = compactToolInput(state.input)
    const output =
      state.status === "completed" && typeof state.output === "string" && state.output.length > MAX_TOOL_OUTPUT_CHARS
        ? truncateText(state.output, MAX_TOOL_OUTPUT_CHARS)
        : undefined
    if (compactedInput === state.input && output === undefined) return input
    return {
      ...input,
      state: {
        ...state,
        input: compactedInput as typeof state.input,
        ...(output !== undefined ? { output } : {}),
      },
    }
  }

  return input
}
