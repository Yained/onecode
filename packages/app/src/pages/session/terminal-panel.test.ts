import { describe, expect, test } from "bun:test"
import { terminalTabLabel } from "./terminal-label"

const t = (key: string, vars?: Record<string, string | number | boolean>) => {
  if (key === "terminal.title.numbered") return `Terminal ${vars?.number}`
  if (key === "terminal.title") return "Terminal"
  return key
}

describe("terminalTabLabel", () => {
  test("returns custom title unchanged", () => {
    const label = terminalTabLabel({ title: "server", titleNumber: 3, t })
    expect(label).toBe("server")
  })

  test("normalizes default numbered title", () => {
    const label = terminalTabLabel({ title: "Terminal 2", titleNumber: 2, t })
    expect(label).toBe("Terminal 2")
  })

  test("falls back to generic title", () => {
    const label = terminalTabLabel({ title: "", titleNumber: 0, t })
    expect(label).toBe("Terminal")
  })
})

describe("terminal panel layout", () => {
  test("sits inside session chrome so left edge matches the floating conversation inset", async () => {
    const source = await Bun.file(new URL("../session.tsx", import.meta.url)).text()

    expect(source).toContain(
      'class="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden bg-background-weak pt-3 px-3 pb-0"',
    )
    expect(source).toContain("WorkbenchTerminalPortal")
    expect(source).toMatch(/workbenchEmbed\(\).*fallback=\{<TerminalPanel \/>\}/s)
  })
})

describe("terminal panel fullscreen", () => {
  test("exposes a fullscreen toggle and overlay layout", async () => {
    const source = await Bun.file(new URL("./terminal-panel.tsx", import.meta.url)).text()

    expect(source).toContain("layout.terminal.fullscreen()")
    expect(source).toContain('fixed inset-0 z-[280] flex flex-col')
    expect(source).toContain('terminal.fullscreen.enter')
    expect(source).toContain('terminal.fullscreen.exit')
  })

  test("sizes fullscreen to the layout containing block instead of 100dvh", async () => {
    const source = await Bun.file(new URL("./terminal-panel.tsx", import.meta.url)).text()

    expect(source).not.toContain('height: fullscreen() ? "100dvh"')
    expect(source).toContain('style={{ height: fullscreen() ? undefined : opened() ? `${pane()}px` : "0px" }}')
    expect(source).toContain('"bottom-0": fullscreen()')
  })

  test("provides visible and keyboard exits from fullscreen", async () => {
    const source = await Bun.file(new URL("./terminal-panel.tsx", import.meta.url)).text()

    expect(source).toContain('data-action="terminal-fullscreen-exit"')
    expect(source).toContain("os-client-terminal-fullscreen-exit")
    expect(source).toContain('onPointerDown={exitFullscreen}')
    expect(source).toContain('event.key !== "Escape"')
    expect(source).toContain("layout.terminal.closeFullscreen()")
  })

  test("exits fullscreen when the final terminal closes", async () => {
    const source = await Bun.file(new URL("./terminal-panel.tsx", import.meta.url)).text()

    expect(source).toMatch(/const close = \(\) => \{[\s\S]*view\(\)\.terminal\.close\(\)[\s\S]*layout\.terminal\.closeFullscreen\(\)[\s\S]*\}/)
  })

  test("does not leave a closed terminal panel in inert fullscreen", async () => {
    const source = await Bun.file(new URL("./terminal-panel.tsx", import.meta.url)).text()

    expect(source).toContain("const fullscreen = createMemo(() => opened() && layout.terminal.fullscreen())")
  })

  test("clears stale fullscreen state when the terminal panel is closed", async () => {
    const source = await Bun.file(new URL("./terminal-panel.tsx", import.meta.url)).text()

    expect(source).toMatch(/createEffect\(\(\) => \{[\s\S]*if \(opened\(\)\) return[\s\S]*if \(!layout\.terminal\.fullscreen\(\)\) return[\s\S]*layout\.terminal\.closeFullscreen\(\)[\s\S]*\}\)/)
  })

  test("mounts only the active terminal because ghostty serializes lifecycle", async () => {
    const source = await Bun.file(new URL("./terminal-panel.tsx", import.meta.url)).text()

    expect(source).toContain("const [keepMounted, setKeepMounted] = createSignal(false)")
    expect(source).toContain("if (!opened() && !keepMounted()) return undefined")
    expect(source).toContain("if (opened() && terminal.active()) setKeepMounted(true)")
    expect(source).toContain("<Show when={mountedId()} keyed>")
    expect(source).toContain("active={opened()}")
    expect(source).toContain("when={pty() ? props.id : undefined} keyed")
    expect(source).not.toContain("<Show when={pty()} keyed>")
    expect(source).toContain("ops.trim(id)")
    expect(source).toContain("Never persist full ANSI scrollback")
    expect(source).not.toContain("visibleId")
    expect(source).toContain("let pendingActive: string | undefined")
    expect(source).toContain("if (pendingActive && id !== pendingActive) return")
    expect(source).toContain("const createTerminal = () => {")
    expect(source).toContain("activateTerminal(id)")
    expect(source).toContain("queueMicrotask(() => activateTerminal(latest.id))")
    expect(source).toContain("Prefetch an idle PTY while closed")
    expect(source).toContain("void terminal.ensure().then((result) => {")
    expect(source).toContain("sshPtyBlocked")
    expect(source).toContain("Latch failures — do not clear autoCreated")
    expect(source).toContain("if (prev === undefined) return")
    expect(source).toContain("if (count === 0) setStore(\"autoCreated\", false)")
    expect(source).toContain("const result = await terminal.new()")
    expect(source).toContain("showTerminalUnavailable(result?.error)")
    expect(source).toContain("await terminal.close(id)")
    expect(source).toContain('const recoverKey = remoteID ? "remote" : id')
    expect(source).toContain("setStore(\"recovering\", true)")
    expect(source).toContain("if (store.recovering) return")
    expect(source).toContain("Create the replacement first so closing a dead tab does not collapse the panel.")
    expect(source).toContain("recoverTerminal(activeId, ops.clone, error)")
    expect(source).not.toContain("terminalRecoveryKey")
  })

  test("skips PTY prefetch when SSH is unbound to avoid autoCreated spin", async () => {
    const source = await Bun.file(new URL("./terminal-panel.tsx", import.meta.url)).text()
    expect(source).toContain("Unbound SSH: createGuard always fails")
    expect(source).toContain("if (sshPtyBlocked()) return")
    expect(source).toContain('return runtimeEnvironmentFor(project).kind === "ssh" && !boundWorkspaceID(project)')
    expect(source).toContain("After 连接, allow one prefetch")
  })

  test("opens and closes without height transition so fit is not delayed", async () => {
    const source = await Bun.file(new URL("./terminal-panel.tsx", import.meta.url)).text()
    expect(source).toContain('"transition-none": !fullscreen()')
  })
})
