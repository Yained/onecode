import { describe, expect, test } from "bun:test"
import { sanitizePartForClientStore } from "./sanitize-part"
import type { Part } from "@opencode-ai/sdk/v2/client"

describe("sanitizePartForClientStore", () => {
  test("stubs oversized file urls", () => {
    const part = {
      id: "prt_1",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "file",
      mime: "application/octet-stream",
      filename: "big.xlsx",
      url: "data:application/octet-stream;base64," + "A".repeat(300_000),
    } as Part
    const next = sanitizePartForClientStore(part)
    expect(next.type).toBe("file")
    if (next.type === "file") {
      expect(next.url.length).toBeLessThan(100)
    }
  })

  test("truncates huge tool output", () => {
    const part = {
      id: "prt_2",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "tool",
      callID: "c1",
      tool: "bash",
      state: {
        status: "completed",
        input: {},
        output: "z".repeat(20_000),
        title: "",
        metadata: {},
        time: { start: 0, end: 1 },
      },
    } as Part
    const next = sanitizePartForClientStore(part)
    expect(next.type).toBe("tool")
    if (next.type === "tool" && next.state.status === "completed") {
      expect(next.state.output.length).toBeLessThan(20_000)
      expect(next.state.output).toContain("Truncated for session UI")
    }
  })

  test("keeps conversation text and reasoning intact", () => {
    const text = {
      id: "prt_text",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "text" as const,
      text: "assistant reply\n".repeat(4_000),
    } as Part
    const reasoning = {
      id: "prt_reason",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "reasoning" as const,
      text: "thinking\n".repeat(5_000),
      time: { start: 1 },
    } as Part
    expect(sanitizePartForClientStore(text)).toEqual(text)
    expect(sanitizePartForClientStore(reasoning)).toEqual(reasoning)
  })

  test("keeps write filePath while truncating huge content", () => {
    const filePath = "/data/guest/workspaces/zhao/test01/.onescience/plan.md"
    const part = {
      id: "prt_write",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "tool" as const,
      callID: "c2",
      tool: "write",
      state: {
        status: "running" as const,
        input: { filePath, content: "# plan\n" + "x".repeat(20_000) },
        title: "",
        metadata: {},
        time: { start: 0 },
      },
    } as Part
    const next = sanitizePartForClientStore(part)
    expect(next.type).toBe("tool")
    if (next.type === "tool") {
      expect(next.state.input).toMatchObject({ filePath })
      expect(String((next.state.input as { content?: string }).content).length).toBeLessThan(20_000)
      expect(next.state.input).not.toHaveProperty("_truncated")
    }
  })
})
