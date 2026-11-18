import { Binary } from "@opencode-ai/core/util/binary"
import type { Part } from "@opencode-ai/sdk/v2/client"

function toolStatusRank(status: string | undefined) {
  if (status === "completed" || status === "error") return 2
  if (status === "running") return 1
  return 0
}

function toolOutputLength(part: Part) {
  if (part.type !== "tool") return 0
  const output = (part.state as { output?: unknown }).output
  return typeof output === "string" ? output.length : 0
}

function toolInputIdentityScore(part: Part) {
  if (part.type !== "tool") return 0
  const input = (part.state as { input?: unknown }).input
  if (!input || typeof input !== "object" || Array.isArray(input)) return 0
  const rec = input as Record<string, unknown>
  if (rec._truncated === true && typeof rec.preview === "string") return 1
  let score = 2
  for (const key of ["filePath", "path", "command", "content", "query", "pattern"] as const) {
    if (typeof rec[key] === "string" && rec[key]) score += 2
  }
  return score
}

export function pickRicherPart(existing: Part, incoming: Part): Part {
  if (existing.id !== incoming.id) return incoming
  if (existing.type === "text" && incoming.type === "text") {
    return existing.text.length > incoming.text.length ? existing : incoming
  }
  if (existing.type === "reasoning" && incoming.type === "reasoning") {
    return existing.text.length > incoming.text.length ? existing : incoming
  }
  if (existing.type === "tool" && incoming.type === "tool") {
    const existingRank = toolStatusRank(existing.state.status)
    const incomingRank = toolStatusRank(incoming.state.status)
    if (existingRank !== incomingRank) return existingRank > incomingRank ? existing : incoming
    const existingIdentity = toolInputIdentityScore(existing)
    const incomingIdentity = toolInputIdentityScore(incoming)
    if (existingIdentity !== incomingIdentity) return existingIdentity > incomingIdentity ? existing : incoming
    return toolOutputLength(existing) > toolOutputLength(incoming) ? existing : incoming
  }
  return incoming
}

/** REST catch-up must not replace a longer live SSE snapshot with a stale page. */
export function keepRicherParts(previous: readonly Part[] | undefined, incoming: Part[]): Part[] {
  if (!previous?.length) return incoming
  const byId = new Map(previous.map((part) => [part.id, part] as const))
  const used = new Set<string>()
  const next: Part[] = incoming.map((part) => {
    used.add(part.id)
    const existing = byId.get(part.id)
    return existing ? pickRicherPart(existing, part) : part
  })
  for (const part of previous) {
    if (used.has(part.id)) continue
    const result = Binary.search(next, part.id, (item) => item.id)
    if (!result.found) next.splice(result.index, 0, part)
  }
  return next
}
