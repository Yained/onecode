import { withAlpha } from "@opencode-ai/ui/theme/color"
import { useTheme } from "@opencode-ai/ui/theme/context"
import { resolveThemeVariant } from "@opencode-ai/ui/theme/resolve"
import type { HexColor } from "@opencode-ai/ui/theme/types"
import { showToast } from "@opencode-ai/ui/toast"
import { readClipboardTextForPaste, rememberClipboardText } from "@opencode-ai/ui/clipboard"
import type { FitAddon, Ghostty, Terminal as Term } from "ghostty-web"
import { type ComponentProps, createEffect, createMemo, createSignal, onCleanup, onMount, splitProps } from "solid-js"
import { matchKeybind, parseKeybind } from "@/context/command"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { terminalFontFamily, useSettings } from "@/context/settings"
import { useTerminal, type LocalPTY } from "@/context/terminal"
import {
  applyTerminalTheme,
  disposeIfDisposable,
  getHoveredLinkText,
  refreshTerminal,
  setOptionIfSupported,
} from "@/utils/runtime-adapters"
import { terminalWriter } from "@/utils/terminal-writer"
import { terminalWebSocketURL } from "@/utils/terminal-websocket-url"

const TOGGLE_TERMINAL_ID = "terminal.toggle"
const DEFAULT_TOGGLE_TERMINAL_KEYBIND = "ctrl+`"
export interface TerminalProps extends ComponentProps<"div"> {
  pty: LocalPTY
  autoFocus?: boolean
  active?: boolean
  /** When false, skip replaying server buffer on connect (used when reopening the panel). */
  replay?: boolean
  onSubmit?: () => void
  onCleanup?: (pty: Partial<LocalPTY> & { id: string }) => void
  onConnect?: () => void
  onConnectError?: (error: unknown) => void
}

let modulePromise: Promise<typeof import("ghostty-web")> | undefined
let lifecycle = Promise.resolve()

const loadGhosttyModule = () => {
  if (modulePromise) return modulePromise
  modulePromise = import("ghostty-web").catch((err) => {
    modulePromise = undefined
    throw err
  })
  return modulePromise
}

const createGhostty = () =>
  loadGhosttyModule().then(async (mod) => ({
    mod,
    ghostty: await mod.Ghostty.load(),
  }))

/** Warm ghostty-web (JS + WASM) so the first terminal open is not cold. */
let preloadPromise: Promise<void> | undefined
export const preloadGhostty = () => {
  if (preloadPromise) return preloadPromise
  preloadPromise = createGhostty()
    .then(({ ghostty }) => {
      disposeIfDisposable(ghostty)
    })
    .catch(() => {
      preloadPromise = undefined
    })
  return preloadPromise
}

type TerminalColors = {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
}

const DEFAULT_TERMINAL_COLORS: Record<"light" | "dark", TerminalColors> = {
  light: {
    background: "#fcfcfc",
    foreground: "#211e1e",
    cursor: "#211e1e",
    selectionBackground: withAlpha("#211e1e", 0.2),
  },
  dark: {
    background: "#191515",
    foreground: "#d4d4d4",
    cursor: "#d4d4d4",
    selectionBackground: withAlpha("#d4d4d4", 0.25),
  },
}

const debugTerminal = (...values: unknown[]) => {
  if (!import.meta.env.DEV) return
  console.debug("[terminal]", ...values)
}

const isShiftInsertPaste = (event: KeyboardEvent) => {
  if (event.type !== "keydown") return false
  if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false

  const key = event.key.toLowerCase()
  return key === "insert" || event.code === "Insert" || event.keyCode === 45
}

const isCtrlVPaste = (event: KeyboardEvent) => {
  if (event.type !== "keydown") return false
  if (!event.ctrlKey || event.metaKey || event.altKey) return false

  const key = event.key.toLowerCase()
  return key === "v" || event.code === "KeyV"
}

const useTerminalUiBindings = (input: {
  container: HTMLDivElement
  term: Term
  cleanups: VoidFunction[]
  handlePointerDown: () => void
  handleLinkClick: (event: MouseEvent) => void
}) => {
  const handleCopy = (event: ClipboardEvent) => {
    const selection = input.term.getSelection()
    if (!selection) return

    const clipboard = event.clipboardData
    if (!clipboard) return

    event.preventDefault()
    clipboard.setData("text/plain", selection)
    rememberClipboardText(selection)
  }

  const handlePaste = (event: ClipboardEvent) => {
    const clipboard = event.clipboardData
    const text = clipboard?.getData("text/plain") ?? clipboard?.getData("text") ?? ""
    if (!text) return

    event.preventDefault()
    event.stopPropagation()
    rememberClipboardText(text)
    input.term.paste(text)
  }

  const handleShiftInsertKey = (event: KeyboardEvent) => {
    if (!isShiftInsertPaste(event)) return

    event.preventDefault()
    event.stopImmediatePropagation()

    void readClipboardTextForPaste().then((text) => {
      if (text) input.term.paste(text)
    })
  }

  const handleTextareaFocus = () => {
    input.term.options.cursorBlink = true
  }
  const handleTextareaBlur = () => {
    input.term.options.cursorBlink = false
  }

  input.container.addEventListener("copy", handleCopy, true)
  input.cleanups.push(() => input.container.removeEventListener("copy", handleCopy, true))

  input.container.addEventListener("paste", handlePaste, true)
  input.cleanups.push(() => input.container.removeEventListener("paste", handlePaste, true))

  if (input.term.textarea) {
    input.term.textarea.addEventListener("copy", handleCopy, true)
    input.cleanups.push(() => input.term.textarea?.removeEventListener("copy", handleCopy, true))

    input.term.textarea.addEventListener("paste", handlePaste, true)
    input.cleanups.push(() => input.term.textarea?.removeEventListener("paste", handlePaste, true))

    input.term.textarea.addEventListener("keydown", handleShiftInsertKey, true)
    input.cleanups.push(() => input.term.textarea?.removeEventListener("keydown", handleShiftInsertKey, true))
  }

  input.container.addEventListener("pointerdown", input.handlePointerDown)
  input.cleanups.push(() => input.container.removeEventListener("pointerdown", input.handlePointerDown))

  input.container.addEventListener("click", input.handleLinkClick, {
    capture: true,
  })
  input.cleanups.push(() =>
    input.container.removeEventListener("click", input.handleLinkClick, {
      capture: true,
    }),
  )

  input.term.textarea?.addEventListener("focus", handleTextareaFocus)
  input.term.textarea?.addEventListener("blur", handleTextareaBlur)
  input.cleanups.push(() => input.term.textarea?.removeEventListener("focus", handleTextareaFocus))
  input.cleanups.push(() => input.term.textarea?.removeEventListener("blur", handleTextareaBlur))
}

export const Terminal = (props: TerminalProps) => {
  const platform = usePlatform()
  const sdk = useSDK()
  const terminalHost = useTerminal()
  const settings = useSettings()
  const theme = useTheme()
  const language = useLanguage()
  const server = useServer()
  // Local PTY stays on the account workspace; a bound SSH project hosts PTY on the leaf.
  const directory = createMemo(() => terminalHost.ptyDirectory() || sdk.directory)
  const workspaceID = createMemo(() => terminalHost.ptyWorkspaceID()?.trim() || undefined)
  const client = createMemo(() => terminalHost.ptyClient() ?? sdk.client)
  const url = sdk.url
  const auth = server.current?.http
  const username = auth?.username ?? "opencode"
  const password = auth?.password ?? ""
  const sameOrigin = new URL(url, location.href).origin === location.origin
  let container!: HTMLDivElement
  const [local, others] = splitProps(props, [
    "pty",
    "class",
    "classList",
    "autoFocus",
    "active",
    "replay",
    "onConnect",
    "onConnectError",
  ])
  const id = local.pty.id
  const fresh = !!local.pty.fresh
  // Always replay from the live PTY server buffer. Local ANSI snapshots were a
  // common source of blank tabs (bad/empty saves + seek=-1 skips server history)
  // and writing them into persisted storage made tab switches laggy.
  const storedCursor =
    typeof local.pty.cursor === "number" && Number.isSafeInteger(local.pty.cursor) ? local.pty.cursor : undefined
  let ws: WebSocket | undefined
  let term: Term | undefined
  let _ghostty: Ghostty
  let fitAddon: FitAddon
  let handleResize: () => void
  let fitFrame: number | undefined
  let sizeTimer: ReturnType<typeof setTimeout> | undefined
  let pendingSize: { cols: number; rows: number } | undefined
  let lastSize: { cols: number; rows: number } | undefined
  let disposed = false
  let releaseLifecycle: (() => void) | undefined
  const cleanups: VoidFunction[] = []
  let cursor = fresh ? 0 : (storedCursor ?? 0)
  let seek = 0
  let output: ReturnType<typeof terminalWriter> | undefined
  let drop: VoidFunction | undefined
  let reconn: ReturnType<typeof setTimeout> | undefined
  let tries = 0
  let startConnect: (() => void) | undefined
  const [revealed, setRevealed] = createSignal(false)

  const cleanup = () => {
    if (!cleanups.length) return
    const fns = cleanups.splice(0).reverse()
    for (const fn of fns) {
      try {
        fn()
      } catch (err) {
        debugTerminal("cleanup failed", err)
      }
    }
  }

  const pushSize = (cols: number, rows: number) => {
    return client()
      .pty.update({
        ptyID: id,
        directory: directory() || undefined,
        size: { cols, rows },
      })
      .catch((err) => {
        debugTerminal("failed to sync terminal size", err)
      })
  }

  const getTerminalColors = (): TerminalColors => {
    const mode = theme.mode() === "dark" ? "dark" : "light"
    const fallback = DEFAULT_TERMINAL_COLORS[mode]
    const currentTheme = theme.themes()[theme.themeId()]
    if (!currentTheme) return fallback
    const variant = mode === "dark" ? currentTheme.dark : currentTheme.light
    if (!variant?.seeds && !variant?.palette) return fallback
    const resolved = resolveThemeVariant(variant, mode === "dark")
    const text = resolved["text-stronger"] ?? fallback.foreground
    const background = resolved["background-stronger"] ?? fallback.background
    const alpha = mode === "dark" ? 0.25 : 0.2
    const base = text.startsWith("#") ? (text as HexColor) : (fallback.foreground as HexColor)
    const selectionBackground = withAlpha(base, alpha)
    return {
      background,
      foreground: text,
      cursor: text,
      selectionBackground,
    }
  }

  const terminalColors = createMemo(getTerminalColors)

  const scheduleFit = () => {
    if (disposed) return
    if (!fitAddon) return
    if (fitFrame !== undefined) return

    fitFrame = requestAnimationFrame(() => {
      fitFrame = undefined
      if (disposed) return
      const before = term ? { cols: term.cols, rows: term.rows } : undefined
      fitAddon.fit()
      const next = term
      if (next && before && (before.cols !== next.cols || before.rows !== next.rows)) refreshTerminal(next)
    })
  }

  const scheduleSize = (cols: number, rows: number) => {
    if (disposed) return
    if (lastSize?.cols === cols && lastSize?.rows === rows) return

    pendingSize = { cols, rows }

    if (!lastSize) {
      lastSize = pendingSize
      void pushSize(cols, rows)
      return
    }

    if (sizeTimer !== undefined) return
    sizeTimer = setTimeout(() => {
      sizeTimer = undefined
      const next = pendingSize
      if (!next) return
      pendingSize = undefined
      if (disposed) return
      if (lastSize?.cols === next.cols && lastSize?.rows === next.rows) return
      lastSize = next
      void pushSize(next.cols, next.rows)
    }, 100)
  }

  createEffect(() => {
    const colors = terminalColors()
    if (!term) return
    applyTerminalTheme(term, colors)
  })

  createEffect(() => {
    const font = terminalFontFamily(settings.appearance.terminalFont())
    if (!term) return
    setOptionIfSupported(term, "fontFamily", font)
    scheduleFit()
  })

  createEffect(() => {
    if (local.active === false) return
    // Collapsed keepalive → reopen: fit after layout applies height (same frame + next).
    scheduleFit()
    const again = requestAnimationFrame(() => {
      scheduleFit()
      const t = term
      if (!t) return
      refreshTerminal(t)
      startConnect?.()
    })
    onCleanup(() => cancelAnimationFrame(again))
  })

  let zoom = platform.webviewZoom?.()
  createEffect(() => {
    const next = platform.webviewZoom?.()
    if (next === undefined) return
    if (next === zoom) return
    zoom = next
    scheduleFit()
  })

  const focusTerminal = () => {
    const t = term
    if (!t) return
    t.focus()
    t.textarea?.focus()
    setTimeout(() => t.textarea?.focus(), 0)
  }
  const handlePointerDown = () => {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && activeElement !== container && !container.contains(activeElement)) {
      activeElement.blur()
    }
    focusTerminal()
  }

  const handleLinkClick = (event: MouseEvent) => {
    if (!event.shiftKey && !event.ctrlKey && !event.metaKey) return
    if (event.altKey) return
    if (event.button !== 0) return

    const t = term
    if (!t) return

    const text = getHoveredLinkText(t)
    if (!text) return

    event.preventDefault()
    event.stopImmediatePropagation()
    platform.openLink(text)
  }

  onMount(() => {
    setRevealed(false)
    const turn = lifecycle
    lifecycle = new Promise<void>((resolve) => {
      releaseLifecycle = resolve
    })

    const run = async () => {
      // Overlap WASM load, lifecycle wait, and connect-ticket fetch.
      const loading = createGhostty()
      const ticketPromise: Promise<string | undefined> = client()
        .pty.connectToken(
          { ptyID: id, directory: directory() },
          {
            throwOnError: false,
            headers: { "x-opencode-ticket": "1" },
          },
        )
        .then((result): string | undefined => {
          if (result.response.status === 200 && result.data?.ticket) return result.data.ticket
          if (result.response.status === 404 || result.response.status === 405) return undefined
          if (result.response.status === 403)
            throw new Error("PTY connect ticket rejected by origin or CSRF checks. Check the server CORS config.")
          throw new Error(`PTY connect ticket failed with ${result.response.status}`)
        })
        .catch((err: unknown): string | undefined => {
          if (err instanceof Error && err.message.includes("Request is not supported")) return undefined
          throw err
        })

      await turn
      if (disposed) return

      debugTerminal("mount", { id, fresh, seek })

      const loaded = await loading
      if (disposed) {
        disposeIfDisposable(loaded.ghostty)
        return
      }

      const mod = loaded.mod
      const g = loaded.ghostty

      const t = new mod.Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontSize: 14,
        fontFamily: terminalFontFamily(settings.appearance.terminalFont()),
        allowTransparency: false,
        convertEol: false,
        theme: terminalColors(),
        scrollback: 10_000,
        ghostty: g,
      })
      cleanups.push(() => t.dispose())
      cleanups.push(() => disposeIfDisposable(g))
      if (disposed) {
        cleanup()
        return
      }
      _ghostty = g
      term = t
      output = terminalWriter((data, done) =>
        t.write(data, () => {
          done?.()
        }),
      )

      t.attachCustomKeyEventHandler((event) => {
        const key = event.key.toLowerCase()

        if (event.ctrlKey && event.shiftKey && !event.metaKey && key === "c") {
          document.execCommand("copy")
          return true
        }

        // Shift+Insert does not fire paste like Ctrl+V. Block ^M and paste manually
        // in handleShiftInsertKey (Clipboard API or last in-app copy cache).
        if (isShiftInsertPaste(event)) return true
        if (isCtrlVPaste(event)) return false

        // allow for toggle terminal keybinds in parent
        const config = settings.keybinds.get(TOGGLE_TERMINAL_ID) ?? DEFAULT_TOGGLE_TERMINAL_KEYBIND
        const keybinds = parseKeybind(config)

        return matchKeybind(keybinds, event)
      })

      const fit = new mod.FitAddon()
      cleanups.push(() => disposeIfDisposable(fit))
      t.loadAddon(fit)
      fitAddon = fit

      container.replaceChildren()
      t.open(container)
      if (typeof t.reset === "function") t.reset()
      else t.clear()
      // Show the canvas immediately — do not wait on HTTP/WS or the panel looks blank
      // for seconds while Ghostty/connect finish.
      setRevealed(true)
      useTerminalUiBindings({
        container,
        term: t,
        cleanups,
        handlePointerDown,
        handleLinkClick,
      })

      if (local.autoFocus !== false) focusTerminal()

      if (typeof document !== "undefined" && document.fonts) {
        void document.fonts.ready.then(scheduleFit)
      }

      const onResize = t.onResize((size) => {
        if (local.active === false) return
        scheduleSize(size.cols, size.rows)
        refreshTerminal(t)
        startConnect?.()
      })
      cleanups.push(() => disposeIfDisposable(onResize))
      const onData = t.onData((data) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(data)
      })
      cleanups.push(() => disposeIfDisposable(onData))
      const onKey = t.onKey((key) => {
        if (key.key == "Enter") {
          props.onSubmit?.()
        }
      })
      cleanups.push(() => disposeIfDisposable(onKey))

      const startResize = () => {
        fit.observeResize()
        handleResize = scheduleFit
        window.addEventListener("resize", handleResize)
        cleanups.push(() => window.removeEventListener("resize", handleResize))
      }

      fit.fit()
      lastSize = { cols: t.cols, rows: t.rows }
      if (t.rows <= 0 || t.cols <= 0) {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            fit.fit()
            lastSize = { cols: t.cols, rows: t.rows }
            resolve()
          })
        })
      }
      // Size sync is best-effort — never block first paint / websocket connect on it.
      if (t.rows > 0 && t.cols > 0) void pushSize(t.cols, t.rows)

      refreshTerminal(t)
      startResize()

      const once = { value: false }
      const decoder = new TextDecoder()
      let gotOutput = false

      const fail = (err: unknown) => {
        if (disposed) return
        if (once.value) return
        once.value = true
        setRevealed(true)
        local.onConnectError?.(err)
      }

      const revealTimer = window.setTimeout(() => {
        if (disposed) return
        if (!revealed()) setRevealed(true)
      }, 2_500)
      cleanups.push(() => window.clearTimeout(revealTimer))

      const gone = () =>
        client()
          .pty.get({ ptyID: id }, { throwOnError: false })
          .then((result) => result.response.status === 404)
          .catch((err) => {
            debugTerminal("failed to inspect terminal session", err)
            return false
          })

      const connectToken = async (): Promise<string | undefined> => {
        const result = await client()
          .pty.connectToken(
            { ptyID: id, directory: directory() },
            {
              throwOnError: false,
              headers: { "x-opencode-ticket": "1" },
            },
          )
          .catch((err: unknown) => {
            if (err instanceof Error && err.message.includes("Request is not supported")) return undefined
            throw err
          })
        if (!result) return undefined
        if (result.response.status === 200 && result.data?.ticket) return result.data.ticket
        if (result.response.status === 404 || result.response.status === 405) return undefined
        if (result.response.status === 403)
          throw new Error("PTY connect ticket rejected by origin or CSRF checks. Check the server CORS config.")
        throw new Error(`PTY connect ticket failed with ${result.response.status}`)
      }

      let firstTicket: Promise<string | undefined> | undefined = ticketPromise
      const retry = (err: unknown) => {
        if (disposed) return
        if (reconn !== undefined) return

        const ms = Math.min(250 * 2 ** Math.min(tries, 4), 4_000)
        reconn = setTimeout(async () => {
          reconn = undefined
          if (disposed) return
          if (await gone()) {
            if (disposed) return
            fail(err)
            return
          }
          if (disposed) return
          tries += 1
          firstTicket = undefined
          open()
        }, ms)
      }

      const open = async () => {
        if (disposed) return
        drop?.()

        const pending = firstTicket
        firstTicket = undefined
        const ticket = await (pending ?? connectToken()).catch((err) => {
          fail(err)
          return undefined
        })
        if (once.value) return
        if (disposed) return

        const socket = new WebSocket(
          terminalWebSocketURL({
            url,
            id,
            directory: directory(),
            cursor: seek,
            ticket,
            workspace: workspaceID(),
            sameOrigin,
            username,
            password,
            authToken: server.current?.type === "http" ? server.current.authToken : false,
          }),
        )
        socket.binaryType = "arraybuffer"
        ws = socket

        const handleOpen = () => {
          if (disposed) return
          tries = 0
          local.onConnect?.()
          scheduleSize(t.cols, t.rows)
          refreshTerminal(t)
          if (!revealed()) setRevealed(true)
        }

        const handleMessage = (event: MessageEvent) => {
          if (disposed) return
          if (event.data instanceof ArrayBuffer) {
            const bytes = new Uint8Array(event.data)
            if (bytes[0] !== 0) return
            const json = decoder.decode(bytes.subarray(1))
            try {
              const meta = JSON.parse(json) as { cursor?: unknown }
              const next = meta?.cursor
              if (typeof next === "number" && Number.isSafeInteger(next) && next >= 0) {
                cursor = next
                seek = next
              }
            } catch (err) {
              debugTerminal("invalid websocket control frame", err)
            }
            // Meta is sent after scrollback replay. Only then is it safe to nudge
            // an empty shell — poking earlier can inject Enter mid-replay.
            if (!gotOutput && ws?.readyState === WebSocket.OPEN) {
              const poke = window.setTimeout(() => {
                if (disposed || gotOutput) return
                if (ws?.readyState === WebSocket.OPEN) ws.send("\r")
              }, 50)
              cleanups.push(() => window.clearTimeout(poke))
            }
            return
          }

          const data = typeof event.data === "string" ? event.data : ""
          if (!data) return
          gotOutput = true
          output?.push(data)
          cursor += data.length
          seek = cursor
          if (!revealed()) setRevealed(true)
        }

        const handleError = (error: Event) => {
          if (disposed) return
          debugTerminal("websocket error", error)
        }

        const stop = () => {
          socket.removeEventListener("open", handleOpen)
          socket.removeEventListener("message", handleMessage)
          socket.removeEventListener("error", handleError)
          socket.removeEventListener("close", handleClose)
          if (ws === socket) ws = undefined
          if (drop === stop) drop = undefined
          if (socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) socket.close(1000)
        }

        const handleClose = (event: CloseEvent) => {
          if (ws === socket) ws = undefined
          if (drop === stop) drop = undefined
          socket.removeEventListener("open", handleOpen)
          socket.removeEventListener("message", handleMessage)
          socket.removeEventListener("error", handleError)
          socket.removeEventListener("close", handleClose)
          if (disposed) return
          if (event.code === 1000) return
          retry(new Error(language.t("terminal.connectionLost.abnormalClose", { code: event.code })))
        }

        drop = stop
        socket.addEventListener("open", handleOpen)
        socket.addEventListener("message", handleMessage)
        socket.addEventListener("error", handleError)
        socket.addEventListener("close", handleClose)
      }

      startConnect = () => {
        if (disposed || ws || once.value) return
        if (local.active === false) return
        fit.fit()
        lastSize = { cols: t.cols, rows: t.rows }
        if (t.rows <= 0 || t.cols <= 0) return
        void pushSize(t.cols, t.rows)
        void open()
      }

      startConnect()
    }

    void run().catch((err) => {
      if (disposed) return
      showToast({
        variant: "error",
        title: language.t("terminal.connectionLost.title"),
        description: err instanceof Error ? err.message : language.t("terminal.connectionLost.description"),
      })
      local.onConnectError?.(err)
    })
  })

  onCleanup(() => {
    disposed = true
    debugTerminal("unmount", { id })
    try {
      if (fitFrame !== undefined) cancelAnimationFrame(fitFrame)
      if (sizeTimer !== undefined) clearTimeout(sizeTimer)
      if (reconn !== undefined) clearTimeout(reconn)
      drop?.()
      if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) ws.close(1000)

      const saved = (() => {
        if (!props.onCleanup || !term) return
        return {
          id,
          cursor,
          rows: term.rows,
          cols: term.cols,
        }
      })()

      // Dispose before notifying so the next terminal never paints into a live ghostty instance.
      cleanup()

      if (saved) props.onCleanup?.(saved)
    } finally {
      // Must always unblock the global Ghostty lifecycle queue.
      releaseLifecycle?.()
      releaseLifecycle = undefined
    }
  })

  return (
    <div
      ref={container}
      data-component="terminal"
      data-pty-id={id}
      data-prevent-autofocus
      tabIndex={-1}
      style={{
        "background-color": terminalColors().background,
        opacity: revealed() ? 1 : 0,
      }}
      classList={{
        ...local.classList,
        "select-text": true,
        "size-full px-6 py-3 font-mono relative overflow-hidden": true,
        [local.class ?? ""]: !!local.class,
      }}
      {...others}
    />
  )
}
