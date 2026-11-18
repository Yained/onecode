import { describe, expect, test } from "bun:test"

describe("titlebar terminal toggle", () => {
  test("renders the terminal toggle in the right titlebar area", async () => {
    const source = await Bun.file(new URL("./titlebar.tsx", import.meta.url)).text()
    const right = source.indexOf('id="opencode-titlebar-right"')
    const toggle = source.indexOf('aria-label={language.t("command.terminal.toggle")}', right)
    const enabled = source.indexOf("layout.terminal.enabled()")

    expect(right).toBeGreaterThan(-1)
    expect(toggle).toBeGreaterThan(right)
    expect(enabled).toBeGreaterThan(-1)
  })

  test("does not call useTerminal outside SessionProviders", async () => {
    const source = await Bun.file(new URL("./titlebar.tsx", import.meta.url)).text()
    expect(source).not.toContain('from "@/context/terminal"')
    expect(source).not.toMatch(/\buseTerminal\s*\(/)
    expect(source).toContain("canWritePlatformPath")
    expect(source).toContain("boundWorkspaceID")
    expect(source).toContain("platformTerminalBlocked")
  })

  test("allows closing an open terminal even when the workspace is read-only", async () => {
    const source = await Bun.file(new URL("./titlebar.tsx", import.meta.url)).text()
    expect(source).toContain("Always allow close")
    expect(source).toContain("sessionLayout.view().terminal.opened()")
  })
})
