import type { Part as PartType, ToolPart } from "@opencode-ai/sdk/v2"

/**
 * Local stand-in for `@opencode-ai/session-ui/message-part` grouping helpers.
 * Mirrors upstream session-ui PartGroup / groupParts / renderable so row-level
 * timeline modules can compile without the session-ui package.
 */

export type PartRef = {
  messageID: string
  partID: string
}

export type PartGroup =
  | {
      key: string
      type: "part"
      ref: PartRef
    }
  | {
      key: string
      type: "context"
      refs: PartRef[]
    }

const CONTEXT_GROUP_TOOLS = new Set(["read", "glob", "grep", "list"])
const HIDDEN_TOOLS = new Set(["todowrite"])
/** Part types that have a dedicated assistant renderer (see ui message-part PART_MAPPING). */
const MAPPED_PART_TYPES = new Set(["compaction"])

type GroupKind = "context" | "shell"

function groupKind(part: PartType): GroupKind | undefined {
  if (part.type !== "tool") return
  if (CONTEXT_GROUP_TOOLS.has(part.tool)) return "context"
  // Finished Shells collapse into one virtual row (AlphaFold turns run dozens).
  // Live pending/running shells stay individual so forceOpen still works.
  if (part.tool === "bash" && part.state.status !== "pending" && part.state.status !== "running") {
    return "shell"
  }
}

export function groupParts(parts: { messageID: string; part: PartType }[]) {
  const result: PartGroup[] = []
  let start = -1
  let kind: GroupKind | undefined

  const flush = (end: number) => {
    if (start < 0) return
    const first = parts[start]
    const last = parts[end]
    if (!first || !last) {
      start = -1
      kind = undefined
      return
    }
    result.push({
      key: `context:${first.part.id}`,
      type: "context",
      refs: parts.slice(start, end + 1).map((item) => ({
        messageID: item.messageID,
        partID: item.part.id,
      })),
    })
    start = -1
    kind = undefined
  }

  parts.forEach((item, index) => {
    const next = groupKind(item.part)
    if (next) {
      if (start >= 0 && kind !== next) flush(index - 1)
      if (start < 0) {
        start = index
        kind = next
      }
      return
    }

    flush(index - 1)
    result.push({
      key: `part:${item.messageID}:${item.part.id}`,
      type: "part",
      ref: {
        messageID: item.messageID,
        partID: item.part.id,
      },
    })
  })

  flush(parts.length - 1)
  // Keep a lone Shell as its own expandable row; only collapse runs of 2+.
  return result.flatMap((group) => {
    if (group.type !== "context" || group.refs.length !== 1) return [group]
    const ref = group.refs[0]!
    const item = parts.find((entry) => entry.part.id === ref.partID && entry.messageID === ref.messageID)
    if (!item || item.part.type !== "tool" || item.part.tool !== "bash") return [group]
    return [
      {
        key: `part:${item.messageID}:${item.part.id}`,
        type: "part" as const,
        ref,
      },
    ]
  })
}

export function renderable(part: PartType, showReasoningSummaries = true) {
  if (part.type === "tool") {
    if (HIDDEN_TOOLS.has(part.tool)) return false
    if (part.tool === "question") return part.state.status !== "pending" && part.state.status !== "running"
    return true
  }
  if (part.type === "text") return !!part.text?.trim()
  if (part.type === "reasoning") return showReasoningSummaries && !!part.text?.trim()
  return MAPPED_PART_TYPES.has(part.type)
}
