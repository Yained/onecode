import { describe, expect, test } from "bun:test"

describe("session header open apps", () => {
  test("filters external terminal apps when terminal access is disabled", async () => {
    const source = await Bun.file(new URL("./session-header.tsx", import.meta.url)).text()

    expect(source).toContain("TERMINAL_OPEN_APPS")
    expect(source).toContain("externalTerminal() || !TERMINAL_OPEN_APPS.has(app.id)")
    expect(source).toContain("if (!item) return")
  })
})
