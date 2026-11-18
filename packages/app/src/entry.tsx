// @refresh reload

import * as Sentry from "@sentry/solid"
import { render } from "solid-js/web"
import { AppBaseProviders, AppInterface } from "@/app"
import { type Platform, PlatformProvider } from "@/context/platform"
import { dict as en } from "@/i18n/en"
import { dict as zh } from "@/i18n/zh"
import { handleNotificationClick } from "@/utils/notification-click"
import { AUTH_TOKEN_STORAGE_KEY, resolveBrowserAuth } from "@/utils/server-auth-cache"
import { authTokenFromCredentials } from "@/utils/server"
import {
  PLATFORM_AUTH_TOKEN_STORAGE_KEY,
  isPlatformAuthRequired,
  platformAuthUrl,
  shouldShowPlatformLogin,
} from "@/utils/platform-auth"
import pkg from "../package.json"
import { resolveCurrentServerUrl, resolveStoredDefaultServerUrl } from "./config/server-url"
import { ServerConnection } from "./context/server"

const DEFAULT_SERVER_URL_KEY = "opencode.settings.dat:defaultServerUrl"

const getLocale = () => {
  if (typeof navigator !== "object") return "zh" as const
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const language of languages) {
    if (!language) continue
    if (language.toLowerCase().startsWith("zh")) return "zh" as const
  }
  return "zh" as const
}

const getRootNotFoundError = () => {
  const key = "error.dev.rootNotFound" as const
  const locale = getLocale()
  return locale === "zh" ? (zh[key] ?? en[key]) : en[key]
}

const getStorage = (key: string) => {
  if (typeof localStorage === "undefined") return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const setStorage = (key: string, value: string | null) => {
  if (typeof localStorage === "undefined") return
  try {
    if (value !== null) {
      localStorage.setItem(key, value)
      return
    }
    localStorage.removeItem(key)
  } catch {
    return
  }
}

const readDefaultServerUrl = () => resolveStoredDefaultServerUrl(getStorage(DEFAULT_SERVER_URL_KEY), getCurrentUrl())
const writeDefaultServerUrl = (url: string | null) => setStorage(DEFAULT_SERVER_URL_KEY, url)

const notify: Platform["notify"] = async (title, description, href) => {
  if (!("Notification" in window)) return

  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission().catch(() => "denied")
      : Notification.permission

  if (permission !== "granted") return

  const inView = document.visibilityState === "visible" && document.hasFocus()
  if (inView) return

  const notification = new Notification(title, {
    body: description ?? "",
    icon: "/favicon-96x96-v3.png",
  })

  notification.onclick = () => {
    handleNotificationClick(href)
    notification.close()
  }
}

const openLink: Platform["openLink"] = (url) => {
  window.open(url, "_blank")
}

const back: Platform["back"] = () => {
  window.history.back()
}

const forward: Platform["forward"] = () => {
  window.history.forward()
}

const restart: Platform["restart"] = async () => {
  window.location.reload()
}

const root = document.getElementById("root")
if (!(root instanceof HTMLElement) && import.meta.env.DEV) {
  throw new Error(getRootNotFoundError())
}

const getCurrentUrl = () => {
  return resolveCurrentServerUrl({
    dev: import.meta.env.DEV,
    host: import.meta.env.VITE_OPENCODE_SERVER_HOST,
    port: import.meta.env.VITE_OPENCODE_SERVER_PORT,
    hostname: location.hostname,
    origin: location.origin,
  })
}

const getDefaultUrl = () => {
  const lsDefault = readDefaultServerUrl()
  if (lsDefault) return lsDefault
  return getCurrentUrl()
}

const clearAuthToken = () => {
  const params = new URLSearchParams(location.search)
  if (!params.has("auth_token")) return
  params.delete("auth_token")
  history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : "") + location.hash)
}

function authPathRedirectTarget(search: string) {
  const redirect = new URLSearchParams(search).get("redirect")
  if (!redirect || !redirect.startsWith("/") || redirect.startsWith("//")) return "/code"
  if (redirect.startsWith("/auth?") || redirect === "/auth") return "/code"
  return redirect
}

const platform: Platform = {
  platform: "web",
  version: pkg.version,
  openLink,
  back,
  forward,
  restart,
  notify,
  getDefaultServer: async () => {
    const stored = readDefaultServerUrl()
    return stored ? ServerConnection.Key.make(stored) : null
  },
  setDefaultServer: writeDefaultServerUrl,
}

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE ?? `web@${pkg.version}`,
    initialScope: {
      tags: {
        platform: "web",
      },
    },
    integrations: (integrations) => {
      return integrations.filter(
        (i) =>
          i.name !== "Breadcrumbs" && !(import.meta.env.OPENCODE_CHANNEL === "prod" && i.name === "GlobalHandlers"),
      )
    },
  })
}

if (root instanceof HTMLElement) {
  const platformAuthRequired = isPlatformAuthRequired()
  const platformToken = getStorage(PLATFORM_AUTH_TOKEN_STORAGE_KEY)
  if (platformToken && !getStorage(AUTH_TOKEN_STORAGE_KEY)) {
    setStorage(AUTH_TOKEN_STORAGE_KEY, authTokenFromCredentials({ password: platformToken }))
  }
  const auth = resolveBrowserAuth({
    queryToken: new URLSearchParams(location.search).get("auth_token"),
    storedToken: getStorage(AUTH_TOKEN_STORAGE_KEY),
  })
  if (auth.persist) setStorage(AUTH_TOKEN_STORAGE_KEY, auth.token)
  if (
    shouldShowPlatformLogin({
      pathname: location.pathname,
      hasToken: !!platformToken,
      authRequired: platformAuthRequired,
    })
  ) {
    location.replace(platformAuthUrl({ pathname: location.pathname, search: location.search, hash: location.hash }))
  } else if (location.pathname === "/auth") {
    location.replace(authPathRedirectTarget(location.search))
  } else {
    clearAuthToken()
    const server: ServerConnection.Http = {
      type: "http",
      authToken: !!auth.auth,
      http: {
        url: getCurrentUrl(),
        ...auth.auth,
      },
    }
    render(
      () => (
        <PlatformProvider value={platform}>
          <AppBaseProviders>
            <AppInterface
              defaultServer={ServerConnection.Key.make(getDefaultUrl())}
              servers={[server]}
              disableHealthCheck
            />
          </AppBaseProviders>
        </PlatformProvider>
      ),
      root,
    )
  }
}
