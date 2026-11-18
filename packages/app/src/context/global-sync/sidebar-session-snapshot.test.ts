import { describe, expect, test } from "bun:test"
import {
  readSidebarSessionSnapshot,
  writeSidebarSessionSnapshot,
} from "./sidebar-session-snapshot"

describe("sidebar session snapshot", () => {
  test("round-trips root sessions and skips archived/child", () => {
    const directory = `/tmp/sidebar-snap-${Date.now()}`
    writeSidebarSessionSnapshot(directory, [
      { id: "a", title: "A", directory, parentID: undefined, time: {} } as never,
      { id: "b", title: "B", directory, parentID: "a", time: {} } as never,
      { id: "c", title: "C", directory, parentID: undefined, time: { archived: Date.now() } } as never,
      { id: "d", title: "D", directory, parentID: undefined, time: {} } as never,
    ])
    expect(readSidebarSessionSnapshot(directory).map((session) => session.id)).toEqual(["a", "d"])
  })
})
