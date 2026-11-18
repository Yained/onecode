import { describe, expect, test } from "bun:test"
import { liveTranscriptEpoch, mergeSessionStatusMap, sessionMessagesLookComplete } from "./session-status"

describe("sessionMessagesLookComplete", () => {
  test("is false without a finished assistant", () => {
    expect(sessionMessagesLookComplete(undefined)).toBe(false)
    expect(sessionMessagesLookComplete([])).toBe(false)
    expect(sessionMessagesLookComplete([{ role: "user" }])).toBe(false)
    expect(sessionMessagesLookComplete([{ role: "assistant", time: { created: 1 } as never }])).toBe(false)
  })

  test("is true when the last assistant has completed or finished", () => {
    expect(
      sessionMessagesLookComplete([
        { role: "user" },
        { role: "assistant", time: { completed: 2 } },
      ]),
    ).toBe(true)
    expect(sessionMessagesLookComplete([{ role: "assistant", finish: "stop" }])).toBe(true)
    expect(
      sessionMessagesLookComplete([
        { role: "user" },
        { role: "assistant", time: { completed: 2 } },
        { role: "user" },
      ]),
    ).toBe(false)
  })
})

describe("mergeSessionStatusMap", () => {
  test("clears leaf busy when the local transcript already finished", () => {
    expect(
      mergeSessionStatusMap(
        { ses_1: { type: "busy" }, ses_2: { type: "busy" } },
        {
          ses_1: [{ role: "assistant", time: { completed: 1 } }],
          ses_2: [{ role: "assistant" }],
        },
      ),
    ).toEqual({
      ses_1: { type: "idle" },
      ses_2: { type: "busy" },
    })
  })
})

describe("liveTranscriptEpoch", () => {
  test("changes when text or tool output grows", () => {
    const messages = [{ id: "msg_1", role: "assistant" as const }]
    const empty = liveTranscriptEpoch(messages, { msg_1: [{ type: "text", text: "hi" }] })
    const longer = liveTranscriptEpoch(messages, { msg_1: [{ type: "text", text: "hello" }] })
    const withTool = liveTranscriptEpoch(messages, {
      msg_1: [
        { type: "text", text: "hello" },
        { type: "tool", state: { status: "running", output: "" } },
      ],
    })
    expect(longer).toBeGreaterThan(empty)
    expect(withTool).toBeGreaterThan(longer)
  })
})
