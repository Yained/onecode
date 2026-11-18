import { describe, expect, test } from "bun:test"
import { migrateTerminalState } from "@/context/terminal"

describe("migrateTerminalState scrollback", () => {
  test("strips persisted ANSI buffers so tab switches stay fast", () => {
    expect(
      migrateTerminalState({
        active: "one",
        all: [{ id: "one", title: "Terminal 1", titleNumber: 1, buffer: "huge-ansi", cursor: 9 }],
      }),
    ).toEqual({
      active: "one",
      all: [{ id: "one", title: "Terminal 1", titleNumber: 1, cursor: 9 }],
    })
  })
})
