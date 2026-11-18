import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { Tabs } from "@opencode-ai/ui/tabs"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"

import { SortableTerminalTab } from "@/components/session"
import { Terminal } from "@/components/terminal"
import { boundWorkspaceID, remoteWorkspaceRevision } from "@/components/onescience/remote-workspace"
import { runtimeEnvironmentFor, runtimeEnvironmentRevision } from "@/components/onescience/runtime-environment"
import { useCommand } from "@/context/command"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useTerminal } from "@/context/terminal"
import { terminalTabLabel } from "@/pages/session/terminal-label"
import { createSizing, focusTerminalById } from "@/pages/session/helpers"
import { getTerminalHandoff, setTerminalHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import type { LocalPTY } from "@/context/terminal"
import { decode64 } from "@/utils/base64"
import { storedPlatformAuthSession } from "@/utils/platform-auth"

function connectErrorMessage(error: unknown) {
  if (typeof error === "string" && error.trim()) return error.trim()
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return undefined
}

function TerminalView(props: {
  id: string
  active: boolean
  panelFresh: boolean
  onConnect: (pty: LocalPTY, id: string) => void
  onCleanup: (partial: Partial<LocalPTY> & { id: string }) => void
  onConnectError: (pty: LocalPTY, id: string, error?: unknown) => void
}) {
  const terminal = useTerminal()
  const pty = createMemo(() => terminal.all().find((item) => item.id === props.id))

  // Key by id only — never by the pty object. `ops.update` / connect handlers replace
  // the store object on every connect; object-keyed Show remounts Ghostty in a loop
  // and the canvas stays at opacity:0 (blank white tab).
  return (
    <Show when={pty() ? props.id : undefined} keyed>
      {(id) => {
        const current = () => terminal.all().find((item) => item.id === id)
        return (
          <Show when={current()}>
            {(active) => (
              <Terminal
                pty={active()}
                autoFocus={props.active}
                active={props.active}
                replay={!props.panelFresh}
                onConnect={() => {
                  const item = current()
                  if (!item) return
                  props.onConnect(item, id)
                }}
                onCleanup={props.onCleanup}
                onConnectError={(error) => {
                  const item = current()
                  if (!item) return
                  props.onConnectError(item, id, error)
                }}
              />
            )}
          </Show>
        )
      }}
    </Show>
  )
}

export function TerminalPanel() {
  const delays = [120, 240]
  const layout = useLayout()
  const terminal = useTerminal()
  const language = useLanguage()
  const command = useCommand()
  const dialog = useDialog()
  const { params, view } = useSessionLayout()

  const terminalEnabled = createMemo(() => terminal.enabled() && layout.terminal.enabled())
  const opened = createMemo(() => terminalEnabled() && view().terminal.opened())
  const fullscreen = createMemo(() => opened() && layout.terminal.fullscreen())
  const size = createSizing()
  const height = createMemo(() => layout.terminal.height())
  const close = () => {
    view().terminal.close()
    layout.terminal.closeFullscreen()
  }
  const exitFullscreen = (event?: Event) => {
    event?.preventDefault()
    event?.stopPropagation()
    layout.terminal.closeFullscreen()
  }
  const toggleFullscreen = () => layout.terminal.toggleFullscreen()
  let root: HTMLDivElement | undefined
  // After the first open, keep the active Ghostty instance mounted while the
  // panel is collapsed so reopen does not pay WASM + WS setup again.
  const [keepMounted, setKeepMounted] = createSignal(false)
  const mountedId = createMemo(() => {
    if (!opened() && !keepMounted()) return undefined
    return terminal.active()
  })

  createEffect(() => {
    if (opened() && terminal.active()) setKeepMounted(true)
  })
  createEffect(() => {
    if (terminal.all().length === 0) setKeepMounted(false)
  })

  let pendingActive: string | undefined

  const activateTerminal = (id: string) => {
    pendingActive = id
    terminal.open(id)
    queueMicrotask(() => {
      if (terminal.active() !== id) terminal.open(id)
      focusTerminalById(id)
      queueMicrotask(() => {
        if (pendingActive === id) pendingActive = undefined
      })
    })
  }

  const showTerminalUnavailable = (failure?: string) => {
    void import("@/components/dialog-terminal-unavailable").then((x) => {
      dialog.show(() => <x.DialogTerminalUnavailable failure={failure} />)
    })
  }

  const createTerminal = () => {
    if (!terminalEnabled()) {
      showTerminalUnavailable()
      return
    }
    void terminal.new().then((result) => {
      if (!result?.id) {
        showTerminalUnavailable(result?.error)
        return
      }
      activateTerminal(result.id)
    })
  }

  const [store, setStore] = createStore({
    autoCreated: false,
    activeDraggable: undefined as string | undefined,
    recovered: {} as Record<string, boolean>,
    recovering: false,
    panelFresh: false,
    view: typeof window === "undefined" ? 1000 : (window.visualViewport?.height ?? window.innerHeight),
  })

  const max = () => store.view * 0.6
  const pane = () => Math.min(height(), max())

  onMount(() => {
    if (typeof window === "undefined") return

    const sync = () => setStore("view", window.visualViewport?.height ?? window.innerHeight)
    const port = window.visualViewport

    sync()
    makeEventListener(window, "resize", sync)
    if (port) makeEventListener(port, "resize", sync)
    makeEventListener(window, "keydown", (event) => {
      if (event.key !== "Escape") return
      if (!fullscreen()) return
      exitFullscreen()
    })
  })

  createEffect(() => {
    if (opened()) return
    if (!layout.terminal.fullscreen()) return
    layout.terminal.closeFullscreen()
  })

  /** Unbound SSH: createGuard always fails — never call ensure() (resets autoCreated → spin). */
  const sshPtyBlocked = createMemo(() => {
    remoteWorkspaceRevision()
    runtimeEnvironmentRevision()
    const project = decode64(params.dir) ?? ""
    if (!project) return false
    return runtimeEnvironmentFor(project).kind === "ssh" && !boundWorkspaceID(project)
  })

  createEffect(() => {
    if (!terminalEnabled()) {
      if (view().terminal.opened()) close()
      return
    }
    if (!opened()) return

    // Session project changed while closed — open a tab in the new project cwd.
    if (terminal.followProjectIfNeeded()) {
      setStore("autoCreated", true)
      return
    }

    if (sshPtyBlocked()) {
      if (store.autoCreated) return
      setStore("autoCreated", true)
      showTerminalUnavailable("SSH 未连接，无法打开远端终端。请先在项目栏连接。")
      return
    }

    if (!terminal.ready() || terminal.all().length !== 0 || store.autoCreated) return
    void terminal.ensure().then((result) => {
      if (!result?.id) {
        // Latch — resetting autoCreated re-enters this effect and freezes the tab.
        showTerminalUnavailable(result?.error)
        return
      }
      activateTerminal(result.id)
    })
    setStore("autoCreated", true)
  })

  // Prefetch an idle PTY while closed so the first open skips create RTT.
  createEffect(() => {
    if (!terminalEnabled() || !terminal.ready()) return
    if (terminal.all().length > 0 || store.autoCreated) return
    // Unbound SSH cannot create a PTY; keep autoCreated false so connect can prefetch later.
    if (sshPtyBlocked()) return
    setStore("autoCreated", true)
    void terminal.ensure().then((result) => {
      if (result?.id) return
      // Latch failures — do not clear autoCreated (was an infinite microtask loop).
    })
  })

  createEffect(
    on(
      () => terminal.all().length,
      (count, prev) => {
        // Ignore the initial 0 so prefetch's autoCreated flag is not cleared
        // before the in-flight create lands (that race opened 2–3 tabs).
        if (prev === undefined) return
        if (count === 0) setStore("autoCreated", false)
      },
    ),
  )

  // After 连接, allow one prefetch / open create (previous unbound open latched autoCreated).
  createEffect(
    on(
      () => {
        remoteWorkspaceRevision()
        const project = decode64(params.dir) ?? ""
        return project ? (boundWorkspaceID(project) ?? "") : ""
      },
      (bound, prev) => {
        if (!bound || bound === prev) return
        setStore("autoCreated", false)
      },
    ),
  )

  createEffect(
    on(
      () => terminal.all().length,
      (count, prev) => {
        if (prev === undefined || count <= prev) return
        const latest = terminal.all()[count - 1]
        if (!latest) return
        queueMicrotask(() => activateTerminal(latest.id))
      },
    ),
  )

  createEffect(
    on(
      () => terminal.all().length,
      (count, prevCount) => {
        if (store.recovering) return
        if (prevCount === undefined || prevCount <= 0 || count !== 0) return
        if (!opened()) return
        close()
      },
    ),
  )

  createEffect(
    on(
      () => opened(),
      (open, prev) => {
        if (prev && !open) {
          // Panel closed — next open may create/follow a project tab; keep metadata.
          setStore("panelFresh", true)
        }
      },
    ),
  )

  // Ghostty serializes terminal mounts via a global lifecycle queue, so only one
  // Terminal instance can be mounted at a time. Key the view so each tab switch
  // fully remounts and connects to the correct PTY.
  const focus = (id: string) => {
    focusTerminalById(id)

    const frame = requestAnimationFrame(() => {
      if (!opened()) return
      if (terminal.active() !== id) return
      focusTerminalById(id)
    })

    const timers = delays.map((ms) =>
      window.setTimeout(() => {
        if (!opened()) return
        if (terminal.active() !== id) return
        focusTerminalById(id)
      }, ms),
    )

    return () => {
      cancelAnimationFrame(frame)
      for (const timer of timers) clearTimeout(timer)
    }
  }

  createEffect(
    on(
      () => [opened(), mountedId()] as const,
      ([next, id]) => {
        if (!next || !id) return
        const stop = focus(id)
        onCleanup(stop)
      },
    ),
  )

  createEffect(() => {
    if (opened()) return
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) return
    if (!root?.contains(active)) return
    active.blur()
  })

  createEffect(() => {
    const dir = params.dir
    if (!dir) return
    if (!terminal.ready()) return
    language.locale()

    setTerminalHandoff(
      dir,
      terminal.all().map((pty) =>
        terminalTabLabel({
          title: pty.title,
          titleNumber: pty.titleNumber,
          t: language.t as (key: string, vars?: Record<string, string | number | boolean>) => string,
        }),
      ),
    )
  })

  const handoff = createMemo(() => {
    const dir = params.dir
    if (!dir) return []
    return getTerminalHandoff(dir) ?? []
  })

  const all = terminal.all
  const ids = createMemo(() => all().map((pty) => pty.id))
  const ops = terminal.bind()

  const recoverTerminal = (id: string, clone: (id: string) => Promise<void>, error?: unknown) => {
    const session = storedPlatformAuthSession()
    // Capability missing / bubblewrap blocked — show install guidance, do not clone.
    if (session && session.capabilities.terminal !== true) {
      showTerminalUnavailable()
      return
    }
    const remoteID = terminal.ptyWorkspaceID?.()
    // Remote: one retry for the whole host (titleNumber collides across stale→new tabs).
    // Local: one retry per PTY id.
    const recoverKey = remoteID ? "remote" : id
    if (store.recovered[recoverKey]) {
      showTerminalUnavailable(
        connectErrorMessage(error) || (remoteID ? "无法连接到远端终端" : "无法连接到已保存的终端。请关闭后新建。"),
      )
      return
    }
    setStore("recovered", recoverKey, true)
    setStore("recovering", true)
    void (async () => {
      try {
        if (remoteID) {
          // Create the replacement first so closing a dead tab does not collapse the panel.
          const result = await terminal.new()
          if (!result?.id) {
            showTerminalUnavailable(result?.error)
            return
          }
          activateTerminal(result.id)
          await terminal.close(id)
          return
        }
        await clone(id)
      } catch (caught) {
        showTerminalUnavailable(connectErrorMessage(caught) || connectErrorMessage(error) || String(caught))
      } finally {
        setStore("recovering", false)
      }
    })()
  }

  const markTerminalConnected = (id: string) => {
    setStore("recovered", id, false)
    setStore("recovered", "remote", false)
    setStore("panelFresh", false)
    // Drop any leftover local buffer metadata after a successful connect.
    // Scrollback is owned by the server (seek=0 on remount).
    ops.trim(id)
  }

  const persistTerminal = (partial: Parameters<typeof ops.update>[0]) => {
    const existing = terminal.all().find((item) => item.id === partial.id)
    if (!existing) return
    // Never persist full ANSI scrollback — it bloated localStorage and made tab
    // switches lag. Size stays in sync via live pushSize while the tab is mounted.
    ops.update({
      id: partial.id,
      cursor: partial.cursor,
      rows: partial.rows,
      cols: partial.cols,
    })
  }

  const handleTerminalDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeDraggable", id)
  }

  const handleTerminalDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return

    const terminals = terminal.all()
    const fromIndex = terminals.findIndex((t) => t.id === draggable.id.toString())
    const toIndex = terminals.findIndex((t) => t.id === droppable.id.toString())
    if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
      terminal.move(draggable.id.toString(), toIndex)
    }
  }

  const handleTerminalDragEnd = () => {
    setStore("activeDraggable", undefined)

    const activeId = terminal.active()
    if (!activeId) return
    requestAnimationFrame(() => {
      if (terminal.active() !== activeId) return
      focusTerminalById(activeId)
    })
  }

  return (
    <div
      ref={root}
      id="terminal-panel"
      role="region"
      aria-label={language.t("terminal.title")}
      aria-hidden={!opened()}
      inert={!opened()}
      class="w-full shrink-0 overflow-hidden bg-background-stronger"
      classList={{
        "relative": !fullscreen(),
        // Above workbench chrome (z-250) so fullscreen owns the viewport.
        "fixed inset-0 z-[280] flex flex-col": fullscreen(),
        "border-t border-border-weak-base": opened() && !fullscreen(),
        // Instant open/close — height animation made the dock feel laggy and
        // delayed the first fit/connect until the transition finished.
        "transition-none": !fullscreen(),
      }}
      style={{ height: fullscreen() ? undefined : opened() ? `${pane()}px` : "0px" }}
    >
      <div
        class="absolute inset-x-0 top-0 flex flex-col"
        classList={{
          "pointer-events-none": !opened(),
          "bottom-0": fullscreen(),
        }}
        style={{ height: fullscreen() ? undefined : `${pane()}px` }}
      >
        <Show when={!fullscreen()}>
          <div class="hidden md:block" onPointerDown={() => size.start()}>
            <ResizeHandle
              direction="vertical"
              size={pane()}
              min={100}
              max={max()}
              collapseThreshold={50}
              onResize={(next) => {
                size.touch()
                layout.terminal.resize(next)
              }}
              onCollapse={close}
            />
          </div>
        </Show>
        <Show
          when={terminal.ready()}
          fallback={
            <div class="flex flex-col h-full pointer-events-none">
              <div class="h-10 flex items-center gap-2 px-2 border-b border-border-weaker-base bg-background-stronger overflow-hidden">
                <For each={handoff()}>
                  {(title) => (
                    <div class="px-2 py-1 rounded-md bg-surface-base text-14-regular text-text-weak truncate max-w-40">
                      {title}
                    </div>
                  )}
                </For>
                <div class="flex-1" />
                <div class="text-text-weak pr-2">
                  {language.t("common.loading")}
                  {language.t("common.loading.ellipsis")}
                </div>
              </div>
              <div class="flex-1 flex items-center justify-center text-text-weak">{language.t("terminal.loading")}</div>
            </div>
          }
        >
          <DragDropProvider
            onDragStart={handleTerminalDragStart}
            onDragEnd={handleTerminalDragEnd}
            onDragOver={handleTerminalDragOver}
            collisionDetector={closestCenter}
          >
            <DragDropSensors />
            <ConstrainDragYAxis />
            <div class="os-client-terminal-chrome flex flex-col h-full">
              <Tabs
                variant="alt"
                value={terminal.active()}
                onChange={(id) => {
                  if (!id || id === terminal.active()) return
                  if (pendingActive && id !== pendingActive) return
                  activateTerminal(id)
                }}
                class="os-client-terminal-tabs !h-auto !flex-none"
              >
                <Tabs.List class="os-client-terminal-tabs-list h-10 border-b border-border-weaker-base">
                  <SortableProvider ids={ids()}>
                    <For each={all()}>{(pty) => <SortableTerminalTab terminal={pty} onClose={close} />}</For>
                  </SortableProvider>
                  <div class="os-client-terminal-tabs-actions ms-auto h-full flex items-center justify-center gap-1 pe-1">
                    <TooltipKeybind
                      title={language.t("command.terminal.new")}
                      keybind={command.keybind("terminal.new")}
                      class="flex items-center"
                    >
                      <IconButton
                        icon="plus-small"
                        variant="ghost"
                        iconSize="large"
                        onClick={createTerminal}
                        aria-label={language.t("command.terminal.new")}
                      />
                    </TooltipKeybind>
                    <Show
                      when={fullscreen()}
                      fallback={
                        <IconButton
                          icon="expand"
                          variant="ghost"
                          iconSize="large"
                          title={language.t("terminal.fullscreen.enter")}
                          onClick={toggleFullscreen}
                          aria-label={language.t("terminal.fullscreen.enter")}
                          aria-pressed={false}
                        />
                      }
                    >
                      <button
                        type="button"
                        data-action="terminal-fullscreen-exit"
                        class="os-client-terminal-fullscreen-exit"
                        onPointerDown={exitFullscreen}
                        onClick={exitFullscreen}
                        aria-label={language.t("terminal.fullscreen.exit")}
                      >
                        {language.t("terminal.fullscreen.exit")}
                      </button>
                    </Show>
                  </div>
                </Tabs.List>
              </Tabs>
              <div class="flex-1 min-h-0 relative">
                <Show when={mountedId()} keyed>
                  {(id) => (
                    <div id={`terminal-wrapper-${id}`} class="absolute inset-0">
                      <TerminalView
                        id={id}
                        active={opened()}
                        panelFresh={store.panelFresh}
                        onConnect={(pty, activeId) => markTerminalConnected(activeId)}
                        onCleanup={persistTerminal}
                        onConnectError={(pty, activeId, error) => recoverTerminal(activeId, ops.clone, error)}
                      />
                    </div>
                  )}
                </Show>
              </div>
            </div>
            <DragOverlay>
              <Show when={store.activeDraggable} keyed>
                {(id) => (
                  <Show when={all().find((pty) => pty.id === id)}>
                    {(t) => (
                      <div class="relative p-1 h-10 flex items-center bg-background-stronger text-14-regular">
                        {terminalTabLabel({
                          title: t().title,
                          titleNumber: t().titleNumber,
                          t: language.t as (key: string, vars?: Record<string, string | number | boolean>) => string,
                        })}
                      </div>
                    )}
                  </Show>
                )}
              </Show>
            </DragOverlay>
          </DragDropProvider>
        </Show>
      </div>
    </div>
  )
}
