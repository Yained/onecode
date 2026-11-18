import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js"
import { useLocation } from "@solidjs/router"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { decode64 } from "@/utils/base64"
import {
  canWritePlatformPath,
  isPlatformAuthRequired,
  platformAuthSessionUpdatedEvent,
  platformTerminalBlocked,
  platformWorkspaceCacheClearedEvent,
  storedPlatformAuthSession,
} from "@/utils/platform-auth"
import { useWorkbenchProjectDirectory } from "@/workbench/current-project"
import { isWorkspaceHomePath, isWorkspaceSessionPath, workspaceSessionRouteParams } from "@/workbench/routes"
import { boundWorkspaceID } from "@/components/onescience/remote-workspace"
import { preloadGhostty } from "@/components/terminal"

/** Terminal control for workbench chrome — welcome + session routes only. */
export function WorkbenchTerminalToggle() {
  const location = useLocation()
  const layout = useLayout()
  const language = useLanguage()
  const command = useCommand()
  const dialog = useDialog()
  const [platformSession, setPlatformSession] = createSignal(storedPlatformAuthSession())
  const homeDirectory = useWorkbenchProjectDirectory()

  const active = createMemo(
    () => isWorkspaceHomePath(location.pathname) || isWorkspaceSessionPath(location.pathname),
  )

  const show = createMemo(() => {
    if (!active()) return false
    if (isPlatformAuthRequired() && !platformSession()) return false
    if (layout.terminal.enabled()) return true
    return platformTerminalBlocked(platformSession())
  })

  const opened = createMemo(() => layout.view("workbench").terminal.opened())

  const directory = createMemo(() => {
    const session = workspaceSessionRouteParams(location.pathname)
    if (session?.dir) return decode64(session.dir) ?? ""
    return homeDirectory()
  })

  onMount(() => {
    const refresh = () => setPlatformSession(storedPlatformAuthSession())
    window.addEventListener(platformWorkspaceCacheClearedEvent, refresh)
    window.addEventListener(platformAuthSessionUpdatedEvent, refresh)
    window.addEventListener("storage", refresh)
    onCleanup(() => {
      window.removeEventListener(platformWorkspaceCacheClearedEvent, refresh)
      window.removeEventListener(platformAuthSessionUpdatedEvent, refresh)
      window.removeEventListener("storage", refresh)
    })
  })

  // Do not warm Ghostty WASM on route entry — compile/instantiate blocks the
  // main thread after sidebar paint (clicks dead on cache-clear /workspace).
  // Preload only when the user opens the terminal.

  // Leave welcome/session → close so mid+right are not squeezed on other pages.
  createEffect(
    on(active, (value, prev) => {
      if (prev === undefined || value || !prev) return
      if (!opened()) return
      layout.view("workbench").terminal.close()
      layout.terminal.closeFullscreen()
    }),
  )

  const toggle = () => {
    if (platformTerminalBlocked(platformSession()) || !layout.terminal.enabled()) {
      void import("@/components/dialog-terminal-unavailable").then((x) => {
        dialog.show(() => <x.DialogTerminalUnavailable />)
      })
      return
    }
    if (!opened()) {
      const dir = directory()
      // SSH-connected projects host PTY on the leaf — local write access is not required.
      if (dir && !boundWorkspaceID(dir) && !canWritePlatformPath(platformSession(), dir)) return
      // Kick WASM again on open intent in case the earlier preload failed.
      preloadGhostty()
    }
    layout.view("workbench").terminal.toggle()
  }

  return (
    <Show when={show()}>
      <button
        type="button"
        class="os-client-panel-toggle os-client-terminal-toggle"
        classList={{ "is-active": opened() }}
        data-tooltip={language.t("command.terminal.toggle")}
        aria-label={language.t("command.terminal.toggle")}
        aria-expanded={opened()}
        aria-controls="terminal-panel"
        title={`${language.t("command.terminal.toggle")} (${command.keybind("terminal.toggle")})`}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          toggle()
        }}
        onClick={(event) => event.preventDefault()}
      >
        <TerminalToggleIcon active={opened()} />
      </button>
    </Show>
  )
}

function TerminalToggleIcon(props: { active: boolean }) {
  return (
    <svg class="os-client-pane-toggle-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4.5" y="5.5" width="15" height="13" rx="1.35" fill="none" stroke="currentColor" stroke-width="1.4" />
      <path
        d="M8 10.25l2.4 2.25L8 14.75M12.25 14.75H16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
        opacity={props.active ? 1 : 0.85}
      />
    </svg>
  )
}
