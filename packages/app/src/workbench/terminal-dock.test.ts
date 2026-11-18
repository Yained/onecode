import { describe, expect, test } from "bun:test"

describe("workbench terminal dock", () => {
  test("shell hosts dock under mid+right and terminal chrome toggle", async () => {
    const shell = await Bun.file(new URL("./shell.tsx", import.meta.url)).text()
    expect(shell).toContain("WORKBENCH_TERMINAL_DOCK_ID")
    expect(shell).toContain("WorkbenchTerminalToggle")
    expect(shell).toContain("has-terminal-open")
    expect(shell).toContain("--os-client-terminal-h")
    expect(shell).toContain("Drive squeeze from opened state immediately")
    expect(shell).toContain("return layout.terminal.height()")
    expect(shell).not.toContain("MutationObserver")
  })

  test("terminal toggle preloads ghostty on open, not on route entry", async () => {
    const source = await Bun.file(new URL("./terminal-toggle.tsx", import.meta.url)).text()
    expect(source).toContain("preloadGhostty")
    expect(source).toContain("Do not warm Ghostty WASM on route entry")
    expect(source).not.toContain("Warm Ghostty while the toggle is available")
    expect(source).not.toMatch(/createEffect\(\(\) => \{\s*if \(!show\(\)\) return\s*preloadGhostty\(\)/)
    expect(source).toContain("boundWorkspaceID")
    expect(source).toContain("useWorkbenchProjectDirectory")
    expect(source).toContain("return homeDirectory()")
  })

  test("welcome mounts terminal host for portal + shortcuts", async () => {
    const home = await Bun.file(new URL("./home.tsx", import.meta.url)).text()
    expect(home).toContain("WorkbenchWelcomeTerminalHost")
  })

  test("css squeezes only mid+right when terminal opens", async () => {
    const css = await Bun.file(new URL("../index.css", import.meta.url)).text()
    expect(css).toContain(".os-client-workbench.has-terminal-open .os-workspace-main")
    expect(css).toContain(
      ".os-client-workbench.has-terminal-open .os-workspace-main:has(.os-code-keepalive.is-active)",
    )
    expect(css).toContain(".os-client-workbench.has-terminal-open .os-client-right-sidebar")
    expect(css).toContain(".os-client-terminal-dock")
    expect(css).not.toContain(".os-client-workbench.has-terminal-open .os-sidebar {")
  })

  test("terminal dock left/right follow measured mid and right card edges", async () => {
    const shell = await Bun.file(new URL("./shell.tsx", import.meta.url)).text()
    const css = await Bun.file(new URL("../index.css", import.meta.url)).text()
    expect(shell).toContain("syncTerminalInset")
    expect(shell).toContain("--os-client-terminal-left")
    expect(shell).toContain("--os-client-terminal-right")
    expect(css).toContain("left: var(--os-client-terminal-left")
    expect(css).toContain("right: var(--os-client-terminal-right")
    expect(css).toContain("bottom: var(--os-client-workbench-inset)")
    expect(css).toContain("--os-client-workbench-inset: 0.5rem")
  })
})
