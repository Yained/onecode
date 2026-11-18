import { Component, Show, createMemo, onMount } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Icon } from "@opencode-ai/ui/icon"
import { useLocation, useNavigate } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useGlobalSync } from "@/context/global-sync"
import { isPlatformAuthRequired, platformAuthUrl, storedPlatformAuthSession } from "@/utils/platform-auth"
import { SettingsAccount } from "./settings-account"
import { SettingsGeneral } from "./settings-general"
import { SettingsKeybinds } from "./settings-keybinds"
import { SettingsProviders } from "./settings-providers"
import { SettingsModels } from "./settings-models"

export type SettingsTab = "account" | "general" | "shortcuts" | "providers" | "models"

const SettingsLoginGate: Component<{ title: string; description: string }> = (props) => {
  const dialog = useDialog()
  const platform = usePlatform()
  const navigate = useNavigate()
  const location = useLocation()
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

  return (
    <div class="flex flex-col h-full items-center justify-center gap-4 px-6 py-10 text-center max-w-[420px] mx-auto">
      <Icon name="models" class="size-8 text-icon-weak" />
      <div class="flex flex-col gap-2">
        <h2 class="text-16-medium text-text-strong m-0">{props.title}</h2>
        <p class="text-14-regular text-text-weak m-0 leading-6">{props.description}</p>
      </div>
      <Button type="button" variant="primary" size="large" onClick={goLogin}>
        去登录
      </Button>
    </div>
  )
}

export const DialogSettings: Component<{ tab?: SettingsTab }> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const globalSync = useGlobalSync()
  // Model/provider toggles follow the signed-in account (including free-model switches).
  // Web / auth-required deployments: block when 未登录. Local desktop without platform auth: allow.
  const canEditModels = createMemo(() => {
    if (storedPlatformAuthSession()) return true
    if (platform.platform === "desktop" && !isPlatformAuthRequired()) return true
    return false
  })
  const initialTab = () => props.tab ?? "general"

  // Opening settings is an explicit config action — refresh catalog if stale/missing.
  onMount(() => {
    void globalSync.ensureProviders({ force: true }).catch(() => undefined)
  })

  return (
    <div class="os-client-settings-dialog-stack">
      <Dialog size="x-large" transition class="os-client-settings-dialog" title={language.t("sidebar.settings")}>
      <Tabs orientation="vertical" variant="settings" defaultValue={initialTab()} class="h-full settings-dialog">
        <Tabs.List>
          <div class="flex flex-col justify-between h-full w-full">
            <div class="flex flex-col gap-3 w-full pt-1">
              <div class="flex flex-col gap-3">
                <div class="flex flex-col gap-1.5">
                  <Tabs.SectionTitle>{language.t("settings.section.account")}</Tabs.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <Tabs.Trigger value="account">
                      <Icon name="status" />
                      {language.t("settings.tab.account")}
                    </Tabs.Trigger>
                  </div>
                </div>

                <div class="flex flex-col gap-1.5">
                  <Tabs.SectionTitle>{language.t("settings.section.desktop")}</Tabs.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <Tabs.Trigger value="general">
                      <Icon name="sliders" />
                      {language.t("settings.tab.general")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="shortcuts">
                      <Icon name="keyboard" />
                      {language.t("settings.tab.shortcuts")}
                    </Tabs.Trigger>
                  </div>
                </div>

                <div class="flex flex-col gap-1.5">
                  <Tabs.SectionTitle>{language.t("settings.section.server")}</Tabs.SectionTitle>
                  <div class="flex flex-col gap-1.5 w-full">
                    <Tabs.Trigger value="providers">
                      <Icon name="providers" />
                      {language.t("settings.providers.title")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="models">
                      <Icon name="models" />
                      {language.t("settings.models.title")}
                    </Tabs.Trigger>
                  </div>
                </div>
              </div>
            </div>
            <div class="os-client-settings-version flex flex-col gap-1 pl-1 py-1">
              <span>{language.t("app.name.desktop")}</span>
              <span>v{platform.version}</span>
            </div>
          </div>
        </Tabs.List>
        <Tabs.Content value="account" class="no-scrollbar">
          <SettingsAccount />
        </Tabs.Content>
        <Tabs.Content value="general" class="no-scrollbar">
          <SettingsGeneral />
        </Tabs.Content>
        <Tabs.Content value="shortcuts" class="no-scrollbar">
          <SettingsKeybinds />
        </Tabs.Content>
        <Tabs.Content value="providers" class="no-scrollbar">
          <Show
            when={canEditModels()}
            fallback={
              <SettingsLoginGate
                title={language.t("settings.providers.title")}
                description={language.t("settings.authRequired.models")}
              />
            }
          >
            <SettingsProviders />
          </Show>
        </Tabs.Content>
        <Tabs.Content value="models" class="no-scrollbar">
          <Show
            when={canEditModels()}
            fallback={
              <SettingsLoginGate
                title={language.t("settings.models.title")}
                description={language.t("settings.authRequired.models")}
              />
            }
          >
            <SettingsModels />
          </Show>
        </Tabs.Content>
      </Tabs>
    </Dialog>
    </div>
  )
}
