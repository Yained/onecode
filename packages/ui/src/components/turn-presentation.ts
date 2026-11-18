import type { Part as PartType, ToolPart } from "@opencode-ai/sdk/v2"

export type PresentationTier = "simple" | "standard" | "detailed"

export type PartRef = {
  messageID: string
  partID: string
}

export type PresentationRole = "live" | "edit" | "error" | "conclusion" | "intermediate"

export type PresentationGroup =
  | {
      key: string
      type: "part"
      ref: PartRef
      role: Exclude<PresentationRole, "intermediate">
    }
  | {
      key: string
      type: "intermediate"
      refs: PartRef[]
    }
  | {
      key: string
      type: "section"
      section: "conclusion" | "changes" | "what" | "notes"
    }
  | {
      key: string
      type: "what-list"
      titles: string[]
    }

const EDIT_TOOLS = new Set(["edit", "write", "apply_patch"])
const PRESENT_MARKER = /<!--\s*present:\s*(simple|standard|detailed)\s*-->/gi

export type PresentationItem = {
  messageID: string
  part: PartType
}

export function parsePresentationTier(text: string): PresentationTier | undefined {
  const match = text.match(/<!--\s*present:\s*(simple|standard|detailed)\s*-->/i)
  if (!match?.[1]) return
  return match[1].toLowerCase() as PresentationTier
}

export function stripPresentationMarker(text: string) {
  return text.replace(PRESENT_MARKER, "").trim()
}

export function hasMarkdownHeading(text: string) {
  return /^\s{0,3}#{1,6}\s+\S/m.test(text)
}

export function partSignificance(part: PartType): "key" | "intermediate" | undefined {
  if (part.type !== "tool") return
  if (!("metadata" in part.state) || !part.state.metadata || typeof part.state.metadata !== "object") return
  const value = (part.state.metadata as Record<string, unknown>).significance
  if (value === "key" || value === "intermediate") return value
}

function isEditTool(part: ToolPart) {
  return EDIT_TOOLS.has(part.tool)
}

function isLiveTool(part: ToolPart) {
  return part.state.status === "pending" || part.state.status === "running"
}

function isErrorTool(part: ToolPart) {
  return part.state.status === "error"
}

export function classifyPart(
  part: PartType,
  opts: {
    working: boolean
    conclusionPartID?: string
  },
): PresentationRole {
  const significance = partSignificance(part)
  if (part.type === "tool") {
    if (isLiveTool(part)) return "live"
    if (significance === "key") {
      if (isErrorTool(part)) return "error"
      if (isEditTool(part)) return "edit"
      return "edit"
    }
    if (significance === "intermediate") return "intermediate"
    if (isErrorTool(part)) return "error"
    if (isEditTool(part)) return "edit"
    return "intermediate"
  }

  if (part.type === "text") {
    if (opts.conclusionPartID && part.id === opts.conclusionPartID) {
      if (opts.working) return "live"
      return "conclusion"
    }
    return "intermediate"
  }

  if (part.type === "reasoning") return "intermediate"
  return "intermediate"
}

export function findConclusionPartID(items: PresentationItem[], working: boolean) {
  if (items.length === 0) return
  const texts = items.filter((item) => item.part.type === "text" && !!(item.part as { text?: string }).text?.trim())
  if (texts.length === 0) return

  if (working) {
    const last = items.at(-1)
    if (last?.part.type === "text" && !!(last.part as { text?: string }).text?.trim()) return last.part.id
    return
  }

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (!item || item.part.type !== "text") continue
    if (!(item.part as { text?: string }).text?.trim()) continue
    return item.part.id
  }
}

// Legacy data and some upstream clients persisted titles like
// `Bash ({"command": "ls -la"})` — the raw tool input JSON glued to the tool
// name. That breaks the step-list layout, so strip the JSON payload on display.
const JSON_TITLE_TAIL = /\s*\(\s*\{[\s\S]*\}\s*\)\s*$/

export function sanitizeToolTitle(title: string | undefined): string | undefined {
  if (!title) return undefined
  const trimmed = title.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return undefined
  const stripped = trimmed.replace(JSON_TITLE_TAIL, "").trim()
  return stripped || undefined
}

export function toolStepTitle(part: ToolPart) {
  if (part.state.status === "completed" || part.state.status === "running") {
    const title = sanitizeToolTitle(part.state.title)
    if (title) return title
  }
  if (part.state.status === "error") return part.state.error ? `${part.tool}: ${part.state.error}` : part.tool
  return part.tool
}

export function inferPresentationTier(input: {
  marker?: PresentationTier
  edits: number
  errors: number
  intermediateTools: number
}): PresentationTier {
  if (input.marker) return input.marker
  if (input.errors >= 1 || input.intermediateTools >= 8 || (input.edits >= 1 && input.intermediateTools >= 5)) {
    return "detailed"
  }
  if (input.edits >= 1 || input.intermediateTools >= 3) return "standard"
  return "simple"
}

function sameRef(a: PartRef, b: PartRef) {
  return a.messageID === b.messageID && a.partID === b.partID
}

export function samePresentationGroup(a: PresentationGroup, b: PresentationGroup) {
  if (a === b) return true
  if (a.key !== b.key || a.type !== b.type) return false
  if (a.type === "part") {
    if (b.type !== "part") return false
    return sameRef(a.ref, b.ref) && a.role === b.role
  }
  if (a.type === "section") {
    if (b.type !== "section") return false
    return a.section === b.section
  }
  if (a.type === "what-list") {
    if (b.type !== "what-list") return false
    return a.titles.length === b.titles.length && a.titles.every((title, i) => title === b.titles[i])
  }
  if (b.type !== "intermediate") return false
  if (a.refs.length !== b.refs.length) return false
  return a.refs.every((ref, i) => sameRef(ref, b.refs[i]!))
}

export function samePresentationGroups(a: readonly PresentationGroup[] | undefined, b: readonly PresentationGroup[] | undefined) {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  return a.every((item, i) => samePresentationGroup(item, b[i]!))
}

function refOf(item: PresentationItem): PartRef {
  return { messageID: item.messageID, partID: item.part.id }
}

export function buildPresentationGroups(
  items: PresentationItem[],
  opts: {
    working: boolean
  },
): PresentationGroup[] {
  const conclusionPartID = findConclusionPartID(items, opts.working)
  const classified = items.map((item) => ({
    item,
    role: classifyPart(item.part, { working: opts.working, conclusionPartID }),
  }))

  const markerText = classified
    .filter((entry) => entry.item.part.type === "text")
    .map((entry) => (entry.item.part as { text?: string }).text ?? "")
    .join("\n")
  const marker = parsePresentationTier(markerText)

  const edits = classified.filter((entry) => entry.role === "edit")
  const errors = classified.filter((entry) => entry.role === "error")
  const intermediates = classified.filter((entry) => entry.role === "intermediate")
  const conclusions = classified.filter((entry) => entry.role === "conclusion")
  const lives = classified.filter((entry) => entry.role === "live")

  const intermediateTools = intermediates.filter((entry) => entry.item.part.type === "tool").length
  const tier = inferPresentationTier({
    marker,
    edits: edits.length,
    errors: errors.length,
    intermediateTools,
  })

  if (opts.working) {
    const result: PresentationGroup[] = []
    let firstIntermediateAt = -1
    const intermediateRefs: PartRef[] = []

    for (const entry of classified) {
      if (entry.role === "intermediate") {
        if (firstIntermediateAt < 0) firstIntermediateAt = result.length
        intermediateRefs.push(refOf(entry.item))
        continue
      }
      result.push({
        key: `part:${entry.item.messageID}:${entry.item.part.id}`,
        type: "part",
        ref: refOf(entry.item),
        role: entry.role,
      })
    }

    if (intermediateRefs.length > 0) {
      const group: PresentationGroup = {
        key: `intermediate:${intermediateRefs[0]!.partID}`,
        type: "intermediate",
        refs: intermediateRefs,
      }
      const at = firstIntermediateAt < 0 ? result.length : firstIntermediateAt
      result.splice(at, 0, group)
    }

    return result
  }

  const result: PresentationGroup[] = []
  const whatTitles = classified
    .filter((entry) => entry.item.part.type === "tool")
    .map((entry) => toolStepTitle(entry.item.part as ToolPart))
    .filter(Boolean)
    .slice(0, 12)

  if (tier === "detailed" && whatTitles.length > 0) {
    result.push({ key: "section:what", type: "section", section: "what" })
    result.push({ key: "what-list", type: "what-list", titles: whatTitles })
  }

  if (edits.length > 0 && tier !== "simple") {
    result.push({ key: "section:changes", type: "section", section: "changes" })
    for (const entry of edits) {
      result.push({
        key: `part:${entry.item.messageID}:${entry.item.part.id}`,
        type: "part",
        ref: refOf(entry.item),
        role: "edit",
      })
    }
  } else if (edits.length > 0) {
    for (const entry of edits) {
      result.push({
        key: `part:${entry.item.messageID}:${entry.item.part.id}`,
        type: "part",
        ref: refOf(entry.item),
        role: "edit",
      })
    }
  }

  if (errors.length > 0) {
    if (tier === "detailed") result.push({ key: "section:notes", type: "section", section: "notes" })
    for (const entry of errors) {
      result.push({
        key: `part:${entry.item.messageID}:${entry.item.part.id}`,
        type: "part",
        ref: refOf(entry.item),
        role: "error",
      })
    }
  }

  if (intermediates.length > 0) {
    result.push({
      key: `intermediate:${intermediates[0]!.item.part.id}`,
      type: "intermediate",
      refs: intermediates.map((entry) => refOf(entry.item)),
    })
  }

  if (conclusions.length > 0) {
    for (const entry of conclusions) {
      result.push({
        key: `part:${entry.item.messageID}:${entry.item.part.id}`,
        type: "part",
        ref: refOf(entry.item),
        role: "conclusion",
      })
    }
  }

  // Keep live parts if somehow present while idle (e.g. status lag)
  for (const entry of lives) {
    result.push({
      key: `part:${entry.item.messageID}:${entry.item.part.id}`,
      type: "part",
      ref: refOf(entry.item),
      role: "live",
    })
  }

  return result
}
