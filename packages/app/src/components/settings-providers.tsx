import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Tag } from "@opencode-ai/ui/tag"
import { showToast } from "@opencode-ai/ui/toast"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { createMemo, onMount, type Component, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useQueryClient } from "@tanstack/solid-query"
import type { Config, ProviderListResponse } from "@opencode-ai/sdk/v2/client"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { DialogSelectProvider } from "./dialog-select-provider"
import { DialogCustomProvider } from "./dialog-custom-provider"
import { SettingsList } from "./settings-list"
import { isEditableCustomProvider, isPublicProviderID, providerListIconID } from "@/utils/custom-provider"

type ProviderSource = "env" | "api" | "config" | "custom"
type ProviderItem = ReturnType<ReturnType<typeof useProviders>["connected"]>[number]

const ONESCIENCE_ID = "onescience"

const PROVIDER_NOTES = [
  { match: (id: string) => id === "opencode", key: "dialog.provider.opencode.note" },
  { match: (id: string) => id === "opencode-go", key: "dialog.provider.opencodeGo.tagline" },
  { match: (id: string) => id === "anthropic", key: "dialog.provider.anthropic.note" },
  { match: (id: string) => id.startsWith("github-copilot"), key: "dialog.provider.copilot.note" },
  { match: (id: string) => id === "openai", key: "dialog.provider.openai.note" },
  { match: (id: string) => id === "google", key: "dialog.provider.google.note" },
  { match: (id: string) => id === "openrouter", key: "dialog.provider.openrouter.note" },
  { match: (id: string) => id === "vercel", key: "dialog.provider.vercel.note" },
] as const

export const SettingsProviders: Component = () => {
  const dialog = useDialog()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const providers = useProviders()
  const queryClient = useQueryClient()

  // Shared cases skip PromptInput (which normally warms /provider). Settings must fetch itself.
  onMount(() => {
    void globalSync.ensureProviders().catch(() => undefined)
  })

  const isConfigCustom = (providerID: string) => {
    const provider = globalSync.data.config.provider?.[providerID]
    const item =
      providers.connected().find((p) => p.id === providerID) ?? providers.all().find((p) => p.id === providerID)
    return isEditableCustomProvider(providerID, provider, item, globalSync.data.config.public_providers)
  }

  const displayName = (item: ProviderItem) => {
    // Prefer the user-configured 「名称」 so custom relays show hmk_1 instead of the hostname id.
    if (isConfigCustom(item.id)) {
      const configured = globalSync.data.config.provider?.[item.id]?.name?.trim()
      if (configured) return configured
    }
    return item.name
  }

  const connected = createMemo(() => {
    // Honor optimistic disabled_providers so the list drops the row before slow dispose/reload.
    const disabled = new Set(globalSync.data.config.disabled_providers ?? [])
    const items = providers
      .connected()
      .filter((p) => !disabled.has(p.id))
      .filter((p) => p.id !== "opencode" || Object.values(p.models).find((m) => m.cost?.input))
      .slice()

    // Surface user-configured custom relays first so they are easy to find after setup.
    items.sort((a, b) => {
      const aCustom = isConfigCustom(a.id) ? 0 : 1
      const bCustom = isConfigCustom(b.id) ? 0 : 1
      if (aCustom !== bCustom) return aCustom - bCustom
      return displayName(a).localeCompare(displayName(b))
    })
    return items
  })

  const popular = createMemo(() => {
    const connectedIDs = new Set(connected().map((p) => p.id))
    const items = providers
      .popular()
      .filter((p) => !connectedIDs.has(p.id))
      .slice()
    items.sort((a, b) => popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id))
    return items
  })

  const source = (item: ProviderItem): ProviderSource | undefined => {
    if (!("source" in item)) return
    const value = item.source
    if (value === "env" || value === "api" || value === "config" || value === "custom") return value
    return
  }

  const type = (item: ProviderItem) => {
    if (item.id === ONESCIENCE_ID) return language.t("settings.providers.tag.limited")
    if (isPublicProviderID(item.id, globalSync.data.config.public_providers)) {
      return language.t("settings.providers.tag.shared")
    }
    const current = source(item)
    if (current === "env") return language.t("settings.providers.tag.environment")
    if (current === "api") return language.t("provider.connect.method.apiKey")
    if (current === "config") {
      if (isConfigCustom(item.id)) return language.t("settings.providers.tag.custom")
      return language.t("settings.providers.tag.config")
    }
    if (current === "custom") return language.t("settings.providers.tag.custom")
    return language.t("settings.providers.tag.other")
  }

  const canDisconnect = (item: ProviderItem) =>
    item.id !== ONESCIENCE_ID &&
    !isPublicProviderID(item.id, globalSync.data.config.public_providers) &&
    source(item) !== "env"

  const note = (id: string) => PROVIDER_NOTES.find((item) => item.match(id))?.key

  const providersQueryKey = () => globalSync.queryOptions.providers(null).queryKey
  const configQueryKey = () => globalSync.queryOptions.globalConfig().queryKey

  const patchProviderCache = (providerID: string, before: ProviderListResponse | undefined) => {
    const nextAll = (before?.all ?? globalSync.data.provider.all).filter((item) => item.id !== providerID)
    const nextConnected = (before?.connected ?? globalSync.data.provider.connected).filter((id) => id !== providerID)
    queryClient.setQueryData(providersQueryKey(), {
      all: nextAll,
      connected: nextConnected,
      default: before?.default ?? globalSync.data.provider.default,
    } satisfies ProviderListResponse)
  }

  const restoreProviderCache = (before: ProviderListResponse) => {
    queryClient.setQueryData(providersQueryKey(), before)
  }

  let disconnecting: string | undefined

  const disconnect = async (providerID: string, name: string) => {
    if (disconnecting === providerID) return
    disconnecting = providerID

    const beforeDisabled = globalSync.data.config.disabled_providers ?? []
    const beforeConfig = { ...globalSync.data.config }
    const beforeProvider = beforeConfig.provider?.[providerID]
    const beforeProviders: ProviderListResponse = {
      all: [...globalSync.data.provider.all],
      connected: [...globalSync.data.provider.connected],
      default: { ...globalSync.data.provider.default },
    }
    // Hard-delete config.provider[id] when present. Official providers (DeepSeek, …) often
    // stay "connected" via config alone — auth.remove is not enough (tag 「配置」).
    const nextDisabled = beforeDisabled.filter((id) => id !== providerID)

    // Optimistic UI via query cache (store.provider/config are getters over react-query).
    patchProviderCache(providerID, beforeProviders)
    if (beforeProvider) {
      const nextProviderMap = Object.fromEntries(
        Object.entries(beforeConfig.provider ?? {}).filter(([id]) => id !== providerID),
      )
      queryClient.setQueryData(configQueryKey(), {
        ...beforeConfig,
        provider: nextProviderMap,
        disabled_providers: nextDisabled,
      } satisfies Config)
    } else {
      queryClient.setQueryData(configQueryKey(), {
        ...beforeConfig,
        disabled_providers: nextDisabled,
      } satisfies Config)
    }

    try {
      await globalSDK.client.auth.remove({ providerID })
      await globalSync.updateConfig({
        deleted_providers: [providerID],
        disabled_providers: nextDisabled,
      } as Parameters<typeof globalSync.updateConfig>[0])
      await globalSDK.client.global.dispose().catch(() => undefined)
      await globalSync.reload()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
        description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
      })
    } catch (err: unknown) {
      restoreProviderCache(beforeProviders)
      queryClient.setQueryData(configQueryKey(), beforeConfig)
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    } finally {
      if (disconnecting === providerID) disconnecting = undefined
    }
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="os-client-settings-sticky-head sticky top-0 z-10">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.providers.title")}</h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px]">
        <div class="flex flex-col gap-1" data-component="connected-providers-section">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.providers.section.connected")}</h3>
          <SettingsList>
            <Show
              when={connected().length > 0}
              fallback={
                <div class="py-4 text-14-regular text-text-weak">
                  {language.t("settings.providers.connected.empty")}
                </div>
              }
            >
              <For each={connected()}>
                {(item) => (
                  <div class="group flex flex-wrap items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base last:border-none">
                    <div class="flex items-center gap-3 min-w-0">
                      <ProviderIcon
                        id={providerListIconID(item.id, isConfigCustom(item.id))}
                        class="size-5 shrink-0 icon-strong-base"
                      />
                      <span class="text-14-medium text-text-strong truncate">{displayName(item)}</span>
                      <Tag>{type(item)}</Tag>
                    </div>
                    <Show
                      when={canDisconnect(item)}
                      fallback={
                        <span class="text-14-regular text-text-base opacity-0 group-hover:opacity-100 transition-opacity duration-200 pr-3 cursor-default">
                          {item.id === ONESCIENCE_ID
                            ? language.t("settings.providers.onescience.readonlyHint")
                            : isPublicProviderID(item.id, globalSync.data.config.public_providers)
                              ? language.t("settings.providers.shared.readonlyHint")
                              : language.t("settings.providers.connected.environmentDescription")}
                        </span>
                      }
                    >
                      <div class="flex items-center gap-1">
                        <Show when={isConfigCustom(item.id)}>
                          <Button
                            size="large"
                            variant="ghost"
                            onClick={() =>
                              dialog.show(() => <DialogCustomProvider providerID={item.id} back="providers" />)
                            }
                          >
                            {language.t("common.edit")}
                          </Button>
                        </Show>
                        {/* Official branded providers (DeepSeek whale, OpenAI, …) always use Connect dialog. */}
                        <Show when={!isConfigCustom(item.id)}>
                          <Button
                            size="large"
                            variant="ghost"
                            onClick={() =>
                              dialog.show(() => <DialogConnectProvider provider={item.id} back="providers" />)
                            }
                          >
                            {language.t("common.edit")}
                          </Button>
                        </Show>
                        <Button size="large" variant="ghost" onClick={() => void disconnect(item.id, displayName(item))}>
                          {isConfigCustom(item.id) ? language.t("common.delete") : language.t("common.disconnect")}
                        </Button>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </SettingsList>
        </div>

        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.providers.section.popular")}</h3>
          <SettingsList>
            <For each={popular()}>
              {(item) => (
                <div class="flex flex-wrap items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base last:border-none">
                  <div class="flex flex-col min-w-0">
                    <div class="flex items-center gap-x-3">
                      <ProviderIcon id={item.id} class="size-5 shrink-0 icon-strong-base" />
                      <span class="text-14-medium text-text-strong">{item.name}</span>
                      <Show when={item.id === "opencode"}>
                        <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                      </Show>
                      <Show when={item.id === "opencode-go"}>
                        <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                      </Show>
                    </div>
                    <Show when={note(item.id)}>
                      {(key) => <span class="text-12-regular text-text-weak pl-8">{language.t(key())}</span>}
                    </Show>
                  </div>
                  <Button
                    size="large"
                    variant="secondary"
                    icon="plus-small"
                    onClick={() => {
                      dialog.show(() => <DialogConnectProvider provider={item.id} />)
                    }}
                  >
                    {language.t("common.connect")}
                  </Button>
                </div>
              )}
            </For>

            <div
              class="flex items-center justify-between gap-4 min-h-16 border-b border-border-weak-base last:border-none flex-wrap py-3"
              data-component="custom-provider-section"
            >
              <div class="flex flex-col min-w-0">
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <ProviderIcon id="synthetic" class="size-5 shrink-0 icon-strong-base" />
                  <span class="text-14-medium text-text-strong">{language.t("provider.custom.title")}</span>
                  <Tag>{language.t("settings.providers.tag.custom")}</Tag>
                </div>
                <span class="text-12-regular text-text-weak pl-8">
                  {language.t("settings.providers.custom.description")}
                </span>
              </div>
              <Button
                size="large"
                variant="secondary"
                icon="plus-small"
                onClick={() => {
                  dialog.show(() => <DialogCustomProvider />)
                }}
              >
                {language.t("common.connect")}
              </Button>
            </div>
          </SettingsList>

          <Button
            variant="ghost"
            class="px-0 py-0 mt-5 text-14-medium text-text-interactive-base text-left justify-start hover:bg-transparent active:bg-transparent"
            onClick={() => {
              dialog.show(() => <DialogSelectProvider />)
            }}
          >
            {language.t("dialog.provider.viewAll")}
          </Button>
        </div>
      </div>
    </div>
  )
}
