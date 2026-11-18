import { describe, expect, test } from "bun:test"
import type { Part as PartType, ToolPart } from "@opencode-ai/sdk/v2"
import {
  buildPresentationGroups,
  classifyPart,
  findConclusionPartID,
  hasMarkdownHeading,
  inferPresentationTier,
  parsePresentationTier,
  stripPresentationMarker,
} from "./turn-presentation"

function text(id: string, value: string): PartType {
  return {
    id,
    type: "text",
    text: value,
    sessionID: "s",
    messageID: "m",
  } as PartType
}

function tool(id: string, name: string, status: ToolPart["state"]["status"], title?: string): ToolPart {
  const base = {
    id,
    type: "tool" as const,
    tool: name,
    sessionID: "s",
    messageID: "m",
    callID: id,
  }
  if (status === "pending") {
    return { ...base, state: { status: "pending", input: {} } } as ToolPart
  }
  if (status === "running") {
    return { ...base, state: { status: "running", input: {}, title: title ?? name } } as ToolPart
  }
  if (status === "error") {
    return { ...base, state: { status: "error", input: {}, error: "boom", time: { start: 1, end: 2 } } } as ToolPart
  }
  return {
    ...base,
    state: { status: "completed", input: {}, output: "", title: title ?? name, time: { start: 1, end: 2 } },
  } as ToolPart
}

describe("turn-presentation", () => {
  test("parses and strips present marker", () => {
    expect(parsePresentationTier("done\n<!-- present: detailed -->")).toBe("detailed")
    expect(stripPresentationMarker("done\n<!-- present: detailed -->")).toBe("done")
  })

  test("finds conclusion as last text when idle", () => {
    const items = [
      { messageID: "m", part: text("t1", "looking") },
      { messageID: "m", part: tool("g1", "grep", "completed") },
      { messageID: "m", part: text("t2", "final answer") },
    ]
    expect(findConclusionPartID(items, false)).toBe("t2")
    expect(classifyPart(items[0]!.part, { working: false, conclusionPartID: "t2" })).toBe("intermediate")
    expect(classifyPart(items[2]!.part, { working: false, conclusionPartID: "t2" })).toBe("conclusion")
  })

  test("idle standard turn folds intermediates and keeps edits + conclusion", () => {
    const items = [
      { messageID: "m", part: text("t1", "checking files") },
      { messageID: "m", part: tool("r1", "read", "completed", "readme") },
      { messageID: "m", part: tool("g1", "grep", "completed", "pattern") },
      { messageID: "m", part: tool("g2", "glob", "completed", "*.ts") },
      { messageID: "m", part: tool("e1", "edit", "completed", "fix.ts") },
      { messageID: "m", part: text("t2", "## Fix result\nFixed the bug.\n<!-- present: standard -->") },
    ]
    const groups = buildPresentationGroups(items, { working: false })
    expect(groups.map((group) => group.type)).toEqual([
      "section",
      "part",
      "intermediate",
      "part",
    ])
    expect(groups[0]).toMatchObject({ type: "section", section: "changes" })
    expect(groups[1]).toMatchObject({ type: "part", role: "edit" })
    expect(groups[2]?.type).toBe("intermediate")
    if (groups[2]?.type === "intermediate") expect(groups[2].refs).toHaveLength(4)
    expect(groups[3]).toMatchObject({ type: "part", role: "conclusion" })
  })

  test("working keeps live tool outside intermediate fold", () => {
    const items = [
      { messageID: "m", part: tool("r1", "read", "completed") },
      { messageID: "m", part: tool("b1", "bash", "completed", "ls") },
      { messageID: "m", part: tool("b2", "bash", "running", "download") },
    ]
    const groups = buildPresentationGroups(items, { working: true })
    expect(groups.map((group) => group.type)).toEqual(["intermediate", "part"])
    expect(groups[1]).toMatchObject({ type: "part", role: "live" })
  })

  test("heuristic picks detailed when many intermediate tools", () => {
    expect(
      inferPresentationTier({
        edits: 0,
        errors: 0,
        intermediateTools: 8,
      }),
    ).toBe("detailed")
    expect(
      inferPresentationTier({
        marker: "simple",
        edits: 2,
        errors: 1,
        intermediateTools: 20,
      }),
    ).toBe("simple")
  })

  test("detects markdown headings without injecting fixed titles", () => {
    expect(hasMarkdownHeading("plain answer")).toBe(false)
    expect(hasMarkdownHeading("## Fix result\nDone")).toBe(true)
  })
})
