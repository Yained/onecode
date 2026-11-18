import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { useLocation, useNavigate } from "@solidjs/router"
import { Component, Show, createSignal, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import {
  type PlatformAuthSession,
  clearPlatformAuthSession,
  defaultPlatformProjectDirectory,
  platformAuthLoggingOutEvent,
  platformAuthSessionUpdatedEvent,
  platformAuthUrl,
  platformWorkspaceCacheClearedEvent,
  resolvePlatformAuthSession,
  storePlatformAuthSession,
  storedPlatformAuthSession,
  storedPlatformAuthToken,
} from "@/utils/platform-auth"
import { SettingsList } from "./settings-list"

function accountInitials(session: PlatformAuthSession) {
  return (session.account.name.trim() || session.account.email.trim() || "OS").slice(0, 2).toUpperCase()
}

function workspaceLabel(session: PlatformAuthSession) {
  const workspace = session.workspaces.find((item) => item.role === "admin") ?? session.workspaces[0]
  if (!workspace) return
  const name = workspace.name.trim()
  if (name) return name
  const slug = workspace.slug.trim()
  if (slug) return slug
  const path = workspace.defaultEnvPath.trim().replaceAll("\\", "/")
  return path.split("/").filter(Boolean).at(-1) || undefined
}

export const SettingsAccount: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const navigate = useNavigate()
  const location = useLocation()
  const [state, setState] = createStore<{
    session?: PlatformAuthSession
    loading: boolean
    error: string
  }>({
    loading: true,
    error: "",
  })
  const [loggingOut, setLoggingOut] = createSignal(false)

  const refresh = () => {
    const cached = storedPlatformAuthSession()
    if (cached) {
      setState({ session: cached, loading: false, error: "" })
      return
    }
    setState({ session: undefined, loading: false, error: "" })
  }

  onMount(() => {
    refresh()

    const token = storedPlatformAuthToken()
    if (!token) return

    void resolvePlatformAuthSession(token)
      .then(async (session) => {
        await storePlatformAuthSession(session, platform.storage)
        setState({ session, loading: false, error: "" })
      })
      .catch((error) => {
        if (storedPlatformAuthSession()) {
          setState({ session: storedPlatformAuthSession()!, loading: false, error: "" })
          return
        }
        setState({
          session: undefined,
          loading: false,
          error: error instanceof Error ? error.message : language.t("settings.account.error.session"),
        })
      })

    window.addEventListener(platformAuthSessionUpdatedEvent, refresh)
    window.addEventListener(platformAuthLoggingOutEvent, refresh)
    window.addEventListener(platformWorkspaceCacheClearedEvent, refresh)
  })

  onCleanup(() => {
    window.removeEventListener(platformAuthSessionUpdatedEvent, refresh)
    window.removeEventListener(platformAuthLoggingOutEvent, refresh)
    window.removeEventListener(platformWorkspaceCacheClearedEvent, refresh)
  })

  const goLogin = () => {
    dialog.close()
    // Soft navigate — location.assign forces a full app reload and feels very slow.
    navigate(
      platformAuthUrl({
        pathname: location.pathname || "/workspace",
        search: location.search || "",
        hash: location.hash || "",
      }),
      { replace: true },
    )
  }

  const goAccountCenter = () => {
    dialog.close()
    if (platform.platform === "desktop") {
      navigate("/account", { replace: true })
      return
    }
    window.location.assign("/account")
  }

  const logout = () => {
    if (loggingOut()) return
    setLoggingOut(true)
    void clearPlatformAuthSession(platform.storage).finally(() => {
      dialog.close()
      if (platform.platform === "desktop") {
        navigate("/login", { replace: true })
        return
      }
      window.location.assign("/login")
    })
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="os-client-settings-sticky-head sticky top-0 z-10">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.tab.account")}</h2>
          <p class="text-14-regular text-text-weak m-0">{language.t("settings.account.description")}</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px]">
        <Show
          when={!state.loading}
          fallback={
            <div class="py-10 text-center text-14-regular text-text-weak">{language.t("settings.account.loading")}</div>
          }
        >
          <Show
            when={state.session}
            fallback={
              <div class="flex flex-col items-center justify-center gap-4 px-6 py-12 text-center">
                <Icon name="status" class="size-8 text-icon-weak" />
                <div class="flex flex-col gap-2">
                  <h3 class="text-16-medium text-text-strong m-0">
                    {state.error || language.t("settings.account.loggedOut.title")}
                  </h3>
                  <p class="text-14-regular text-text-weak m-0 leading-6">
                    {language.t("settings.account.loggedOut.description")}
                  </p>
                </div>
                <Button type="button" variant="primary" size="large" onClick={goLogin}>
                  {language.t("settings.account.action.login")}
                </Button>
              </div>
            }
          >
            {(session) => (
              <>
                <div class="flex flex-col gap-1">
                  <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.account.section.profile")}</h3>
                  <SettingsList>
                    <div class="flex flex-wrap items-center gap-4 py-4 border-b border-border-weak-base">
                      <div
                        class="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-raised-base text-14-medium text-text-strong"
                        aria-hidden="true"
                      >
                        {accountInitials(session())}
                      </div>
                      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span class="text-14-medium text-text-strong truncate">{session().account.name}</span>
                        <span class="text-12-regular text-text-weak truncate">{session().account.email}</span>
                      </div>
                      <span class="text-12-regular text-text-weak shrink-0">
                        {language.t("settings.account.status.signedIn")}
                      </span>
                    </div>
                    <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap">
                      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span class="text-14-medium text-text-strong">
                          {language.t("settings.account.row.workspace.title")}
                        </span>
                        <span class="text-12-regular text-text-weak">
                          {language.t("settings.account.row.workspace.description")}
                        </span>
                      </div>
                      <span class="text-14-regular text-text-strong truncate max-w-full sm:max-w-[280px]">
                        {workspaceLabel(session()) || language.t("settings.account.row.workspace.empty")}
                      </span>
                    </div>
                    <div class="flex flex-col gap-2 py-3 last:border-none">
                      <div class="flex min-w-0 flex-col gap-0.5">
                        <span class="text-14-medium text-text-strong">
                          {language.t("settings.account.row.defaultProject.title")}
                        </span>
                        <span class="text-12-regular text-text-weak">
                          {language.t("account.defaultProject.description")}
                        </span>
                      </div>
                      <code
                        class="text-12-regular text-text-weak break-all"
                        title={defaultPlatformProjectDirectory(session())}
                      >
                        {defaultPlatformProjectDirectory(session()) || "default"}
                      </code>
                    </div>
                  </SettingsList>
                </div>

                <div class="flex flex-col gap-1">
                  <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.account.section.actions")}</h3>
                  <SettingsList>
                    <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base sm:flex-nowrap">
                      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span class="text-14-medium text-text-strong">
                          {language.t("settings.account.row.center.title")}
                        </span>
                        <span class="text-12-regular text-text-weak">
                          {language.t("settings.account.row.center.description")}
                        </span>
                      </div>
                      <Button type="button" variant="secondary" size="large" onClick={goAccountCenter}>
                        {language.t("settings.account.action.center")}
                      </Button>
                    </div>
                    <div class="flex flex-wrap items-center gap-4 py-3 sm:flex-nowrap">
                      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span class="text-14-medium text-text-strong">
                          {language.t("settings.account.row.logout.title")}
                        </span>
                        <span class="text-12-regular text-text-weak">
                          {language.t("settings.account.row.logout.description")}
                        </span>
                      </div>
                      <Button type="button" variant="ghost" size="large" onClick={logout} disabled={loggingOut()}>
                        {loggingOut()
                          ? language.t("settings.account.action.loggingOut")
                          : language.t("settings.account.action.logout")}
                      </Button>
                    </div>
                  </SettingsList>
                </div>
              </>
            )}
          </Show>
        </Show>
      </div>
    </div>
  )
}
