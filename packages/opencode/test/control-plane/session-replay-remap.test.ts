import { describe, expect, test } from "bun:test"
import {
  isSessionIdentityReplayType,
  leafIdentityFromProject,
  remapSessionReplayEvents,
} from "../../src/control-plane/session-replay-remap"

describe("remapSessionReplayEvents", () => {
  test("rewrites session.created onto the leaf project and remote directory", () => {
    const [event] = remapSessionReplayEvents(
      [
        {
          type: "session.created.1",
          data: {
            sessionID: "ses_1",
            info: {
              id: "ses_1",
              projectID: "proj-acct-test_dir",
              directory: "D:/data/workspaces/acct/test_dir",
              title: "ls",
            },
          },
        },
      ],
      { projectID: "global", directory: "/home/onescience2026/test_dir" },
    )
    expect(event?.data.info).toEqual({
      id: "ses_1",
      projectID: "global",
      directory: "/home/onescience2026/test_dir",
      title: "ls",
    })
  })

  test("leaves message events unchanged", () => {
    const events = [
      {
        type: "message.updated.1",
        data: { sessionID: "ses_1", info: { projectID: "proj-acct-test_dir" } },
      },
    ]
    expect(remapSessionReplayEvents(events, { projectID: "global", directory: "/tmp/x" })).toEqual(events)
  })

  test("detects versioned session identity types", () => {
    expect(isSessionIdentityReplayType("session.created")).toBe(true)
    expect(isSessionIdentityReplayType("session.created.1")).toBe(true)
    expect(isSessionIdentityReplayType("session.updated.1")).toBe(true)
    expect(isSessionIdentityReplayType("message.updated.1")).toBe(false)
  })

  test("reads leaf identity from /project/current payloads", () => {
    expect(leafIdentityFromProject({ id: "abc", worktree: "/home/proj" })).toEqual({
      projectID: "abc",
      directory: "/home/proj",
    })
    expect(leafIdentityFromProject({ id: "  ", worktree: "/home/proj" })).toBeUndefined()
  })
})
