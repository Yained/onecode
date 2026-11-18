import { describe, expect, test } from "bun:test"
import type { SessionID } from "../../src/session/schema"
import * as SessionViewer from "../../src/session/viewer"

const sessionA = "ses_viewer_a" as SessionID
const sessionB = "ses_viewer_b" as SessionID

describe("SessionViewer", () => {
  test("allows reply when no active viewers", () => {
    SessionViewer.reset()
    expect(SessionViewer.canReply({ sessionID: sessionA })).toBe(true)
    expect(SessionViewer.canReply({ sessionID: sessionA, viewerID: "anyone" })).toBe(true)
  })

  test("requires matching viewer when session has viewers", () => {
    SessionViewer.reset()
    SessionViewer.register({ directory: "/tmp/proj", sessionID: sessionA, viewerID: "tab-1", now: 1_000 })
    expect(SessionViewer.canReply({ sessionID: sessionA, viewerID: "tab-1", now: 1_000 })).toBe(true)
    expect(SessionViewer.canReply({ sessionID: sessionA, viewerID: "tab-2", now: 1_000 })).toBe(false)
    expect(SessionViewer.canReply({ sessionID: sessionA, now: 1_000 })).toBe(false)
  })

  test("parent session viewers can reply for child sessions", () => {
    SessionViewer.reset()
    SessionViewer.register({ directory: "/tmp/proj", sessionID: sessionA, viewerID: "parent-tab", now: 1_000 })
    expect(
      SessionViewer.canReply({
        sessionID: sessionB,
        parentSessionID: sessionA,
        viewerID: "parent-tab",
        now: 1_000,
      }),
    ).toBe(true)
    expect(
      SessionViewer.canReply({
        sessionID: sessionB,
        parentSessionID: sessionA,
        viewerID: "other",
        now: 1_000,
      }),
    ).toBe(false)
  })

  test("expires viewers after TTL", () => {
    SessionViewer.reset()
    SessionViewer.register({ directory: "/tmp/proj", sessionID: sessionA, viewerID: "tab-1", now: 1_000 })
    expect(SessionViewer.hasActiveViewers(sessionA, 1_000 + SessionViewer.VIEWER_TTL_MS + 1)).toBe(false)
    expect(SessionViewer.canReply({ sessionID: sessionA, now: 1_000 + SessionViewer.VIEWER_TTL_MS + 1 })).toBe(true)
  })

  test("heartbeat refreshes lease and clearViewer removes all", () => {
    SessionViewer.reset()
    SessionViewer.register({ directory: "/tmp/proj", sessionID: sessionA, viewerID: "tab-1", now: 1_000 })
    SessionViewer.register({ directory: "/tmp/proj", sessionID: sessionB, viewerID: "tab-1", now: 1_000 })
    expect(SessionViewer.heartbeat({ sessionID: sessionA, viewerID: "tab-1", now: 20_000 })).toBe(true)
    expect(SessionViewer.isActiveViewer(sessionA, "tab-1", 20_000)).toBe(true)
    SessionViewer.clearViewer("tab-1")
    expect(SessionViewer.hasActiveViewers(sessionA, 20_000)).toBe(false)
    expect(SessionViewer.hasActiveViewers(sessionB, 20_000)).toBe(false)
  })
})
