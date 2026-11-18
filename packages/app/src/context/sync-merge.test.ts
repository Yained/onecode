import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2/client"
import { keepRicherParts, pickRicherPart } from "./sync-merge"

type Text = Extract<Part, { type: "text" }>

const textPart = (id: string, sessionID: string, messageID: string, text = id): Text => ({
  id,
  sessionID,
  messageID,
  type: "text",
  text,
})

describe("keepRicherParts", () => {
  test("keeps longer live text and extra local parts", () => {
    const live = textPart("prt_1", "ses_1", "msg_1", "hello from sse stream")
    const stale = textPart("prt_1", "ses_1", "msg_1", "hello")
    const extra = textPart("prt_2", "ses_1", "msg_1")
    const merged = keepRicherParts([live, extra], [stale])
    expect(merged.map((item) => item.id)).toEqual(["prt_1", "prt_2"])
    expect(merged[0]).toBe(live)
  })
})

describe("pickRicherPart", () => {
  test("prefers completed tool output over a running snapshot", () => {
    const running = {
      id: "prt_tool",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "tool" as const,
      tool: "catalog_search",
      callID: "call_1",
      state: { status: "running" as const, input: {}, time: { start: 1 } },
    }
    const completed = {
      ...running,
      state: {
        status: "completed" as const,
        input: {},
        output: "found 3 primitives",
        title: "catalog_search",
        metadata: {},
        time: { start: 1, end: 2 },
      },
    }
    expect(pickRicherPart(completed as Part, running as Part)).toBe(completed)
    expect(pickRicherPart(running as Part, completed as Part)).toBe(completed)
  })

  test("does not replace a write path with a truncated stub of equal output", () => {
    const live = {
      id: "prt_write",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "tool" as const,
      tool: "write",
      callID: "call_1",
      state: {
        status: "completed" as const,
        input: { filePath: "/tmp/plan.md", content: "# plan" },
        output: "Wrote file successfully.",
        title: "plan.md",
        metadata: { filepath: "/tmp/plan.md" },
        time: { start: 1, end: 2 },
      },
    }
    const truncated = {
      ...live,
      state: {
        ...live.state,
        input: { _truncated: true, preview: '{"content":"# plan' },
        metadata: { _truncated: true, omittedChars: 9000 },
      },
    }
    expect(pickRicherPart(live as Part, truncated as Part)).toBe(live)
    expect(pickRicherPart(truncated as Part, live as Part)).toBe(live)
  })
})
