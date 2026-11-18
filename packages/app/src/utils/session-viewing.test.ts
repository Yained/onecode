import { describe, expect, test } from "bun:test"
import { isViewingSession } from "./session-viewing"

describe("isViewingSession", () => {
  test("matches current session in same directory", () => {
    expect(
      isViewingSession({
        directory: "/tmp/proj",
        sessionID: "ses_1",
        currentDirectory: "/tmp/proj",
        currentSessionID: "ses_1",
      }),
    ).toBe(true)
  })

  test("matches child session when viewing parent", () => {
    expect(
      isViewingSession({
        directory: "/tmp/proj",
        sessionID: "ses_child",
        currentDirectory: "/tmp/proj",
        currentSessionID: "ses_parent",
        sessions: [{ id: "ses_child", parentID: "ses_parent" }],
      }),
    ).toBe(true)
  })

  test("rejects different directory or session", () => {
    expect(
      isViewingSession({
        directory: "/tmp/other",
        sessionID: "ses_1",
        currentDirectory: "/tmp/proj",
        currentSessionID: "ses_1",
      }),
    ).toBe(false)
    expect(
      isViewingSession({
        directory: "/tmp/proj",
        sessionID: "ses_2",
        currentDirectory: "/tmp/proj",
        currentSessionID: "ses_1",
        sessions: [{ id: "ses_2" }],
      }),
    ).toBe(false)
  })
})
