import { createEffect, createMemo, createSignal, onCleanup, onMount, type ParentProps, Show } from "solid-js"
import { WorkbenchLeftNav } from "./left-nav"
import { WorkbenchRightPanel } from "./right-panel"
import { WorkbenchTerminalToggle } from "./terminal-toggle"
import { WORKBENCH_TERMINAL_DOCK_ID } from "./terminal-host"
import { rightDockOpenRequest, openRightDock } from "@/workbench/right-dock"
import { useLayout } from "@/context/layout"
import { useLocation } from "@solidjs/router"
import { isWorkspaceCapabilitiesPath, isWorkspaceSessionPath } from "@/workbench/routes"

const PANE_WIDTH_DEFAULT = 320

const LEFT_WIDTH_MIN = 230
const LEFT_WIDTH_MAX = 430

const RIGHT_WIDTH_MIN = 200
const RIGHT_WIDTH_MAX = 1280

function PaneToggleIcon(props: { side: "left" | "right"; open: boolean }) {
  return (
    <svg
      class="os-client-pane-toggle-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-side={props.side}
      data-open={props.open ? "true" : "false"}
    >
      <rect class="os-client-pane-toggle-icon-main" x="4.5" y="5.5" width="7.7" height="13" rx="1.35" />
      <rect class="os-client-pane-toggle-icon-divider" x="12.15" y="5.5" width="1.15" height="13" rx="0.55" />
      <rect class="os-client-pane-toggle-icon-side" x="14.05" y="5.5" width="5.45" height="13" rx="1.35" />
    </svg>
  )
}

function clampLeftWidth(value: number) {
  return Math.min(LEFT_WIDTH_MAX, Math.max(LEFT_WIDTH_MIN, Math.round(value)))
}

function clampRightWidth(value: number) {
  const max =
    typeof window === "undefined" ? RIGHT_WIDTH_MAX : Math.min(RIGHT_WIDTH_MAX, Math.floor(window.innerWidth * 0.85))
  return Math.min(max, Math.max(RIGHT_WIDTH_MIN, Math.round(value)))
}

export function WorkbenchShell(props: ParentProps) {
  const layout = useLayout()
  const location = useLocation()
  const [leftOpen, setLeftOpen] = createSignal(true)
  const [rightOpen, setRightOpen] = createSignal(false)
  const [leftWidth, setLeftWidth] = createSignal(PANE_WIDTH_DEFAULT)
  const [rightWidth, setRightWidth] = createSignal(PANE_WIDTH_DEFAULT)
  const [resizingLeft, setResizingLeft] = createSignal(false)
  const [resizingRight, setResizingRight] = createSignal(false)
  const [measuredTerminalHeight, setMeasuredTerminalHeight] = createSignal(0)
  const [terminalInset, setTerminalInset] = createSignal({ left: 0, right: 0 })
  const [rootEl, setRootEl] = createSignal<HTMLElement>()
  const [dockEl, setDockEl] = createSignal<HTMLDivElement>()

  // Drive squeeze from opened state immediately — waiting on ResizeObserver made
  // mid+right lag a frame (or more) behind the dock, which felt like open jank.
  const terminalOpened = createMemo(() => layout.view("workbench").terminal.opened())
  const terminalOpen = () => terminalOpened()
  const terminalHeight = createMemo(() => {
    if (!terminalOpened()) return 0
    const measured = measuredTerminalHeight()
    if (measured > 0) return measured
    return layout.terminal.height()
  })

  /** Align dock to mid-column left and rightmost mid/right card edge. */
  const syncTerminalInset = () => {
    const root = rootEl()
    if (!root) return
    const main = root.querySelector<HTMLElement>(":scope > .os-workspace-main")
    if (!main) return

    const rootBox = root.getBoundingClientRect()
    const cs = getComputedStyle(root)
    const paddingEdgeLeft = rootBox.left + (parseFloat(cs.borderLeftWidth) || 0)
    const paddingEdgeRight = rootBox.right - (parseFloat(cs.borderRightWidth) || 0)
    const mainBox = main.getBoundingClientRect()
    const right = root.querySelector<HTMLElement>(":scope > .os-client-right-sidebar")
    const endBox = right?.getBoundingClientRect() ?? mainBox

    setTerminalInset({
      left: Math.max(0, Math.round(mainBox.left - paddingEdgeLeft)),
      right: Math.max(0, Math.round(paddingEdgeRight - endBox.right)),
    })
  }

  const onCapabilities = createMemo(() => isWorkspaceCapabilitiesPath(location.pathname))

  const toggleLeft = () => {
    setLeftOpen((open) => {
      if (!open) setLeftWidth(PANE_WIDTH_DEFAULT)
      return !open
    })
  }

  const toggleRight = () => {
    if (onCapabilities()) return
    setRightOpen((open) => {
      if (!open) {
        setRightWidth(PANE_WIDTH_DEFAULT)
        if (isWorkspaceSessionPath(location.pathname)) openRightDock("directory")
      }
      return !open
    })
  }

  createEffect(() => {
    if (!onCapabilities()) return
    setRightOpen(false)
  })

  createEffect(() => {
    const request = rightDockOpenRequest()
    if (!request) return
    if (isWorkspaceCapabilitiesPath(location.pathname)) return
    setRightOpen(true)
    setRightWidth((width) => (width > 0 ? width : PANE_WIDTH_DEFAULT))
  })

  const startLeftResize = (event: PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = leftWidth()
    setResizingLeft(true)

    const onMove = (move: PointerEvent) => {
      setLeftWidth(clampLeftWidth(startWidth + (move.clientX - startX)))
    }
    const onUp = () => {
      setResizingLeft(false)
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
  }

  const startRightResize = (event: PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = rightWidth()
    setResizingRight(true)

    const onMove = (move: PointerEvent) => {
      setRightWidth(clampRightWidth(startWidth + (startX - move.clientX)))
    }
    const onUp = () => {
      setResizingRight(false)
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
  }

  createEffect(() => {
    const el = dockEl()
    if (!el || typeof ResizeObserver === "undefined") return

    const sync = () => {
      const panel = el.querySelector("#terminal-panel") as HTMLElement | null
      setMeasuredTerminalHeight(panel ? Math.round(panel.getBoundingClientRect().height) : 0)
    }

    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    onCleanup(() => observer.disconnect())
  })

  createEffect(() => {
    if (terminalOpened()) return
    setMeasuredTerminalHeight(0)
  })

  // Workbench starts with terminal closed; user must open explicitly.
  onMount(() => {
    layout.view("workbench").terminal.close()
    layout.terminal.closeFullscreen()
    setMeasuredTerminalHeight(0)
  })

  createEffect(() => {
    // Track pane geometry that shifts the mid/right cards.
    leftOpen()
    rightOpen()
    leftWidth()
    rightWidth()
    resizingLeft()
    resizingRight()
    terminalOpen()
    rootEl()

    syncTerminalInset()
    const frame = requestAnimationFrame(syncTerminalInset)
    onCleanup(() => cancelAnimationFrame(frame))
  })

  createEffect(() => {
    const root = rootEl()
    if (!root || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => syncTerminalInset())
    observer.observe(root)
    const main = root.querySelector(":scope > .os-workspace-main")
    if (main) observer.observe(main)
    const right = root.querySelector(":scope > .os-client-right-sidebar")
    if (right) observer.observe(right)
    onCleanup(() => observer.disconnect())
  })

  return (
    <main
      ref={setRootEl}
      class="os-client-workbench"
      classList={{
        "has-left-sidebar": leftOpen(),
        "has-right-sidebar": rightOpen(),
        "is-resizing-left": resizingLeft(),
        "is-resizing-right": resizingRight(),
        "has-terminal-open": terminalOpen(),
        "has-terminal-fullscreen": layout.terminal.fullscreen() && layout.view("workbench").terminal.opened(),
      }}
      style={{
        "--os-client-sidebar-w": `${leftWidth()}px`,
        "--os-client-tool-w": `${rightWidth()}px`,
        "--os-client-terminal-h": `${terminalHeight()}px`,
        "--os-client-terminal-left": `${terminalInset().left}px`,
        "--os-client-terminal-right": `${terminalInset().right}px`,
      }}
    >
      <div class="os-client-workbench-chrome">
        <button
          type="button"
          class="os-client-panel-toggle"
          classList={{ "is-active": leftOpen() }}
          data-tooltip={leftOpen() ? "关闭左侧栏" : "打开左侧栏"}
          aria-label={leftOpen() ? "关闭左侧栏" : "打开左侧栏"}
          onClick={toggleLeft}
        >
          <PaneToggleIcon side="left" open={leftOpen()} />
        </button>
        <WorkbenchTerminalToggle />
        <button
          type="button"
          class="os-client-panel-toggle"
          classList={{ "is-active": rightOpen() }}
          disabled={onCapabilities()}
          data-tooltip={
            onCapabilities() ? "能力中心不可用右侧栏" : rightOpen() ? "关闭右侧栏" : "打开右侧栏"
          }
          aria-label={
            onCapabilities() ? "能力中心不可用右侧栏" : rightOpen() ? "关闭右侧栏" : "打开右侧栏"
          }
          onClick={toggleRight}
        >
          <PaneToggleIcon side="right" open={rightOpen()} />
        </button>
      </div>

      <Show when={leftOpen()}>
        <WorkbenchLeftNav />
        <div
          class="os-client-pane-resizer os-client-pane-resizer-sidebar"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整左边栏宽度"
          aria-valuenow={leftWidth()}
          aria-valuemin={LEFT_WIDTH_MIN}
          aria-valuemax={LEFT_WIDTH_MAX}
          tabindex="0"
          onPointerDown={startLeftResize}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault()
              setLeftWidth((width) => clampLeftWidth(width - 16))
              return
            }
            if (event.key !== "ArrowRight") return
            event.preventDefault()
            setLeftWidth((width) => clampLeftWidth(width + 16))
          }}
        />
      </Show>

      <section class="os-workspace-main">{props.children}</section>

      <Show when={rightOpen()}>
        <div
          class="os-client-pane-resizer os-client-pane-resizer-tool"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整右边栏宽度"
          aria-valuenow={rightWidth()}
          aria-valuemin={RIGHT_WIDTH_MIN}
          aria-valuemax={RIGHT_WIDTH_MAX}
          tabindex="0"
          onPointerDown={startRightResize}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault()
              setRightWidth((width) => clampRightWidth(width + 16))
              return
            }
            if (event.key !== "ArrowRight") return
            event.preventDefault()
            setRightWidth((width) => clampRightWidth(width - 16))
          }}
        />
        <WorkbenchRightPanel />
      </Show>

      <div
        ref={setDockEl}
        id={WORKBENCH_TERMINAL_DOCK_ID}
        class="os-client-terminal-dock"
        classList={{ "is-open": terminalOpen() }}
        aria-hidden={!terminalOpen()}
      />
    </main>
  )
}
