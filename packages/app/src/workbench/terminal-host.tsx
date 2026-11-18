import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { TerminalPanel } from "@/pages/session/terminal-panel"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { TerminalProvider, useTerminal } from "@/context/terminal"
import { platformTerminalBlocked } from "@/utils/platform-auth"
import { useSessionLayout } from "@/pages/session/session-layout"

const DOCK_ID = "os-client-terminal-dock"

export function workbenchTerminalDockElement() {
  if (typeof document === "undefined") return null
  return document.getElementById(DOCK_ID)
}

/** Portals TerminalPanel into the workbench dock (must be under TerminalProvider). */
export function WorkbenchTerminalPortal() {
  const [dock, setDock] = createSignal<HTMLElement | null>(null)

  onMount(() => {
    setDock(workbenchTerminalDockElement())
    const timer = window.setInterval(() => {
      if (dock()) return
      setDock(workbenchTerminalDockElement())
    }, 50)
    onCleanup(() => window.clearInterval(timer))
  })

  return (
    <Show when={dock()}>
      {(el) => (
        <Portal mount={el()}>
          <TerminalPanel />
        </Portal>
      )}
    </Show>
  )
}

/** ctrl+` / terminal.new for welcome page (session registers its own via use-session-commands). */
export function WorkbenchWelcomeTerminalCommands() {
  const terminal = useTerminal()
  const layout = useLayout()
  const language = useLanguage()
  const command = useCommand()
  const dialog = useDialog()
  const { view } = useSessionLayout()

  const terminalEnabled = createMemo(() => terminal.enabled() && layout.terminal.enabled())

  const openTerminal = () => {
    if (platformTerminalBlocked() || !terminalEnabled()) {
      void import("@/components/dialog-terminal-unavailable").then((x) => {
        dialog.show(() => <x.DialogTerminalUnavailable />)
      })
      return
    }
    if (terminal.all().length > 0) {
      void terminal.new().then((result) => {
        if (!result?.id) {
          void import("@/components/dialog-terminal-unavailable").then((x) => {
            dialog.show(() => <x.DialogTerminalUnavailable failure={result?.error} />)
          })
        }
      })
    }
    view().terminal.open()
  }

  command.register(() => [
    ...(terminalEnabled() || platformTerminalBlocked()
      ? [
          {
            id: "terminal.toggle",
            title: language.t("command.terminal.toggle"),
            category: language.t("command.category.view"),
            keybind: "ctrl+`",
            slash: "terminal",
            onSelect: () => {
              if (platformTerminalBlocked() || !terminalEnabled()) {
                openTerminal()
                return
              }
              view().terminal.toggle()
            },
          },
          {
            id: "terminal.new",
            title: language.t("command.terminal.new"),
            description: language.t("command.terminal.new.description"),
            category: language.t("command.category.terminal"),
            keybind: "ctrl+alt+t",
            onSelect: openTerminal,
          },
        ]
      : []),
  ])

  return null
}

export function WorkbenchWelcomeTerminalHost() {
  return (
    <TerminalProvider>
      <WorkbenchWelcomeTerminalCommands />
      <WorkbenchTerminalPortal />
    </TerminalProvider>
  )
}

export { DOCK_ID as WORKBENCH_TERMINAL_DOCK_ID }
