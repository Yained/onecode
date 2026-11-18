// @refresh reload

import {
  ACCEPTED_FILE_EXTENSIONS,
  ACCEPTED_FILE_TYPES,
  AppBaseProviders,
  AppInterface,
  authTokenFromCredentials,
  AUTH_TOKEN_STORAGE_KEY,
  handleNotificationClick,
  loadLocaleDict,
  normalizeLocale,
  setAuthenticatedFetchCredentials,
  setRuntimeServerUrl,
  type Locale,
  type Platform,
  PlatformProvider,
  ServerConnection,
  useCommand,
} from "@opencode-ai/app"
import * as Sentry from "@sentry/solid"
import type { AsyncStorage } from "@solid-primitives/storage"
import { createEffect, createResource, createSignal, onCleanup, onMount, Show } from "solid-js"
import { render } from "solid-js/web"
import pkg from "../../package.json"
import { initI18n, t } from "./i18n"
import { SetupWizard } from "./setup-wizard"
import { webviewZoom } from "./webview-zoom"
import "./styles.css"
import { useTheme } from "@opencode-ai/ui/theme"
import { DesktopMemoryRouter } from "./desktop-router"

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(t("error.dev.rootNotFound"))
}

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE ?? `desktop@${pkg.version}`,
    initialScope: {
      tags: {
        platform: "desktop",
      },
    },
    integrations: (integrations) => {
      return integrations.filter(
        (i) =>
          i.name !== "Breadcrumbs" &&
          !(
            import.meta.env.OPENCODE_CHANNEL === "prod" &&
            (i.name === "GlobalHandlers" || i.name === "BrowserApiErrors")
          ),
      )
    },
  })
}

void initI18n()

const deepLinkEvent = "opencode:deep-link"

/** Desktop loads via oc:// — no sidecar HTML meta. Seed path meta from the install wizard store. */
function injectDesktopWorkspaceMeta(dataRoot: string | null | undefined) {
  const ensure = (name: string, content: string) => {
    let meta = document.querySelector(`meta[name="${name}"]`)
    if (!(meta instanceof HTMLMetaElement)) {
      meta = document.createElement("meta")
      meta.setAttribute("name", name)
      document.head.appendChild(meta)
    }
    meta.setAttribute("content", content)
  }
  // OneScience Desktop always uses platform accounts — chat/session writes require login.
  ensure("onescience-platform-auth-required", "true")
  const root = dataRoot?.trim()
  if (!root) return
  const normalized = root.replaceAll("\\", "/").replace(/\/+$/, "")
  ensure("onescience-onecode-extra-path", root)
  ensure("onescience-code-default-directory", `${normalized}/case`)
}

const emitDeepLinks = (urls: string[]) => {
  if (urls.length === 0) return
  window.__OPENCODE__ ??= {}
  const pending = window.__OPENCODE__.deepLinks ?? []
  window.__OPENCODE__.deepLinks = [...pending, ...urls]
  window.dispatchEvent(new CustomEvent(deepLinkEvent, { detail: { urls } }))
}

const listenForDeepLinks = () => {
  void window.api.consumeInitialDeepLinks().then((urls) => emitDeepLinks(urls))
  return window.api.onDeepLink((urls) => emitDeepLinks(urls))
}

const createPlatform = (): Platform => {
  const os = (() => {
    const ua = navigator.userAgent
    if (ua.includes("Mac")) return "macos"
    if (ua.includes("Windows")) return "windows"
    if (ua.includes("Linux")) return "linux"
    return undefined
  })()

  const isWslEnabled = async () => {
    if (os !== "windows") return false
    return window.api
      .getWslConfig()
      .then((config) => config.enabled)
      .catch(() => false)
  }

  const wslHome = async () => {
    if (!(await isWslEnabled())) return undefined
    return window.api.wslPath("~", "windows").catch(() => undefined)
  }

  const handleWslPicker = async <T extends string | string[]>(result: T | null): Promise<T | null> => {
    if (!result || !(await isWslEnabled())) return result
    if (Array.isArray(result)) {
      return Promise.all(result.map((path) => window.api.wslPath(path, "linux").catch(() => path))) as any
    }
    return window.api.wslPath(result, "linux").catch(() => result) as any
  }

  const storage = (() => {
    const cache = new Map<string, AsyncStorage>()

    const createStorage = (name: string) => {
      const api: AsyncStorage = {
        getItem: (key: string) => window.api.storeGet(name, key),
        setItem: (key: string, value: string) => window.api.storeSet(name, key, value),
        removeItem: (key: string) => window.api.storeDelete(name, key),
        clear: () => window.api.storeClear(name),
        key: async (index: number) => (await window.api.storeKeys(name))[index],
        getLength: () => window.api.storeLength(name),
        get length() {
          return api.getLength()
        },
      }
      return api
    }

    return (name = "default.dat") => {
      const cached = cache.get(name)
      if (cached) return cached
      const api = createStorage(name)
      cache.set(name, api)
      return api
    }
  })()

  return {
    platform: "desktop",
    os,
    version: pkg.version,

    async openDirectoryPickerDialog(opts) {
      const defaultPath = await wslHome()
      const result = await window.api.openDirectoryPicker({
        multiple: opts?.multiple ?? false,
        title: opts?.title ?? t("desktop.dialog.chooseFolder"),
        defaultPath,
      })
      return await handleWslPicker(result)
    },

    async openFilePickerDialog(opts) {
      const result = await window.api.openFilePicker({
        multiple: opts?.multiple ?? false,
        title: opts?.title ?? t("desktop.dialog.chooseFile"),
        accept: opts?.accept ?? ACCEPTED_FILE_TYPES,
        extensions: opts?.extensions ?? ACCEPTED_FILE_EXTENSIONS,
      })
      return handleWslPicker(result)
    },

    async saveFilePickerDialog(opts) {
      const result = await window.api.saveFilePicker({
        title: opts?.title ?? t("desktop.dialog.saveFile"),
        defaultPath: opts?.defaultPath,
      })
      return handleWslPicker(result)
    },

    openLink(url: string) {
      window.api.openLink(url)
    },
    async openPath(path: string, app?: string) {
      if (os === "windows") {
        const resolvedApp = app ? await window.api.resolveAppPath(app).catch(() => null) : null
        const resolvedPath = await (async () => {
          if (await isWslEnabled()) {
            const converted = await window.api.wslPath(path, "windows").catch(() => null)
            if (converted) return converted
          }
          return path
        })()
        return window.api.openPath(resolvedPath, resolvedApp ?? undefined)
      }
      return window.api.openPath(path, app)
    },

    back() {
      window.history.back()
    },

    forward() {
      window.history.forward()
    },

    storage,

    checkUpdate: async () => {
      const config = await window.api.getWindowConfig().catch(() => ({ updaterEnabled: false }))
      if (!config.updaterEnabled) return { updateAvailable: false }
      return window.api.checkUpdate()
    },

    updateAndRestart: async () => {
      const config = await window.api.getWindowConfig().catch(() => ({ updaterEnabled: false }))
      if (!config.updaterEnabled) return
      await window.api.installUpdate()
    },

    restart: async () => {
      await window.api.killSidecar().catch(() => undefined)
      window.api.relaunch()
    },

    notify: async (title, description, href) => {
      const focused = await window.api.getWindowFocused().catch(() => document.hasFocus())
      if (focused) return

      const notification = new Notification(title, {
        body: description ?? "",
        icon: "https://onescience.ai/favicon-96x96-v3.png",
      })
      notification.onclick = () => {
        void window.api.showWindow()
        void window.api.setWindowFocus()
        handleNotificationClick(href)
        notification.close()
      }
    },

    fetch: (input, init) => {
      if (input instanceof Request) return fetch(input)
      return fetch(input, init)
    },

    getWslEnabled: () => isWslEnabled(),

    setWslEnabled: async (enabled) => {
      await window.api.setWslConfig({ enabled })
    },

    getDefaultServer: async () => {
      const url = await window.api.getDefaultServerUrl().catch(() => null)
      if (!url) return null
      return ServerConnection.Key.make(url)
    },

    setDefaultServer: async (url: string | null) => {
      await window.api.setDefaultServerUrl(url)
    },

    sshConnect: (config) => window.api.sshConnect(config),

    sshDisconnect: (key) => window.api.sshDisconnect(key),

    sshStatus: async (key) => {
      const status = await window.api.sshStatus(key)
      return { ...status, key: ServerConnection.Key.make(status.key) }
    },

    sshLogs: (key) => window.api.sshLogs(key),

    getDisplayBackend: async () => {
      return window.api.getDisplayBackend().catch(() => null)
    },

    setDisplayBackend: async (backend) => {
      await window.api.setDisplayBackend(backend)
    },

    parseMarkdown: (markdown: string) => window.api.parseMarkdownCommand(markdown),

    webviewZoom,

    checkAppExists: async (appName: string) => {
      return window.api.checkAppExists(appName)
    },

    async readClipboardImage() {
      const image = await window.api.readClipboardImage().catch(() => null)
      if (!image) return null
      const blob = new Blob([image.buffer], { type: "image/png" })
      return new File([blob], `pasted-image-${Date.now()}.png`, {
        type: "image/png",
      })
    },
  }
}

let menuTrigger = null as null | ((id: string) => void)
window.api.onMenuCommand((id) => {
  menuTrigger?.(id)
})
listenForDeepLinks()

render(() => {
  const platform = createPlatform()
  const [windowConfig] = createResource(() => window.api.getWindowConfig().catch(() => ({ updaterEnabled: false })))
  const loadLocale = async () => {
    const current = await platform.storage?.("opencode.global.dat").getItem("language")
    const legacy = current ? undefined : await platform.storage?.().getItem("language.v1")
    const raw = current ?? legacy
    if (!raw) return
    const locale = raw.match(/"locale"\s*:\s*"([^"]+)"/)?.[1]
    if (!locale) return
    const next = normalizeLocale(locale)
    if (next !== "en") await loadLocaleDict(next)
    return next satisfies Locale
  }

  const [windowCount] = createResource(() => window.api.getWindowCount())

  // Fetch sidecar credentials (available immediately, before health check)
  const [sidecar] = createResource(() => window.api.awaitInitialization(() => undefined))

  const [defaultServer] = createResource(() =>
    platform.getDefaultServer?.().then((url) => {
      if (url) return ServerConnection.key({ type: "http", http: { url } })
    }),
  )
  const [locale] = createResource(loadLocale)
  const [workspaceMetaReady] = createResource(async () => {
    try {
      const root = typeof window.api.getDataRoot === "function" ? await window.api.getDataRoot() : null
      injectDesktopWorkspaceMeta(root)
    } catch {
      injectDesktopWorkspaceMeta(null)
    }
    return true
  })
  const [setupComplete, { mutate: setSetupComplete }] = createResource(async () => {
    try {
      if (typeof window.api.getSetupComplete !== "function") return true
      return await window.api.getSetupComplete()
    } catch {
      // Missing IPC / store errors must not blank the whole window.
      return true
    }
  })

  const servers = () => {
    const data = sidecar()
    if (!data) return []
    const server: ServerConnection.Sidecar = {
      displayName: "Local Server",
      type: "sidecar",
      variant: "base",
      http: {
        url: data.url,
        username: data.username ?? undefined,
        password: data.password ?? undefined,
      },
    }
    return [server] as ServerConnection.Any[]
  }

  // OneScience authenticatedFetch reads localStorage / runtime credentials.
  // Sidecar password is random each launch — keep both in sync for catalog APIs.
  createEffect(() => {
    const data = sidecar()
    if (!data?.password) {
      setAuthenticatedFetchCredentials(undefined)
      setRuntimeServerUrl(undefined)
      return
    }
    const username = data.username ?? "opencode"
    setAuthenticatedFetchCredentials({ username, password: data.password })
    setRuntimeServerUrl(data.url)
    try {
      localStorage.setItem(
        AUTH_TOKEN_STORAGE_KEY,
        authTokenFromCredentials({ username, password: data.password }),
      )
    } catch {
      // ignore quota / private mode
    }
  })

  function handleClick(e: MouseEvent) {
    const fileLink = (e.target as HTMLElement).closest("a.file-link")
    if (fileLink) return
    const link = (e.target as HTMLElement).closest("a.external-link") as HTMLAnchorElement | null
    if (link?.href) {
      e.preventDefault()
      platform.openLink(link.href)
    }
  }

  function Inner() {
    const cmd = useCommand()
    menuTrigger = (id) => cmd.trigger(id)

    const theme = useTheme()

    createEffect(() => {
      theme.themeId()
      theme.mode()
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--background-base").trim()
      if (bg) {
        void window.api.setBackgroundColor(bg)
      }
    })

    return null
  }

  onMount(() => {
    document.addEventListener("click", handleClick)
    onCleanup(() => {
      document.removeEventListener("click", handleClick)
    })
  })

  const [bootTimedOut, setBootTimedOut] = createSignal(false)
  onMount(() => {
    const timer = setTimeout(() => setBootTimedOut(true), 45_000)
    onCleanup(() => clearTimeout(timer))
  })

  const bootReady = () =>
    !defaultServer.loading &&
    !sidecar.loading &&
    !windowConfig.loading &&
    !windowCount.loading &&
    !locale.loading &&
    !workspaceMetaReady.loading &&
    !setupComplete.loading

  const bootError = () =>
    sidecar.error ?? windowConfig.error ?? windowCount.error ?? defaultServer.error ?? setupComplete.error

  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders locale={locale.latest}>
        <Show
          when={bootReady()}
          fallback={
            <div class="w-screen h-screen bg-background-base flex items-center justify-center text-text-weak text-13-regular">
              <Show when={bootTimedOut() || bootError()} fallback={<span>Starting OneCode…</span>}>
                <pre class="max-w-[40rem] whitespace-pre-wrap p-6 text-12-regular text-text-strong">
                  {`OneCode failed to start.\n${
                    bootError()
                      ? String(bootError())
                      : "Timed out waiting for local server / window config.\nCheck main process logs and that win32 native modules are packaged."
                  }`}
                </pre>
              </Show>
            </div>
          }
        >
          {(_) => {
            return (
              <>
                <Show when={setupComplete.latest === false}>
                  <SetupWizard
                    onComplete={() => {
                      void window.api.getDataRoot().then((root) => injectDesktopWorkspaceMeta(root))
                      setSetupComplete(true)
                      // Data-root changes require sidecar restart to inject env.
                      void window.api.killSidecar().finally(() => window.api.relaunch())
                    }}
                  />
                </Show>
                <Show when={setupComplete.latest !== false}>
                  <AppInterface
                    defaultServer={defaultServer.latest ?? ServerConnection.Key.make("sidecar")}
                    servers={servers()}
                    router={DesktopMemoryRouter}
                  >
                    <Inner />
                  </AppInterface>
                </Show>
              </>
            )
          }}
        </Show>
      </AppBaseProviders>
    </PlatformProvider>
  )
}, root!)
