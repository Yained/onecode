import { Popover as Kobalte } from "@kobalte/core/popover"
import { Component, ComponentProps, createMemo, createSignal, JSX, onMount, Show, ValidComponent } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocal } from "@/context/local"
import { useGlobalSync } from "@/context/global-sync"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tag } from "@opencode-ai/ui/tag"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { DialogSettings } from "@/components/dialog-settings"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { DialogCustomProvider } from "./dialog-custom-provider"
import { ModelTooltip } from "./model-tooltip"
import { useLanguage } from "@/context/language"
import { isEditableCustomProvider, isPublicProviderID } from "@/utils/custom-provider"

const isFree = (provider: string, cost: { input: number } | undefined, modelID?: string) =>
  (provider === "opencode" && (!cost || cost.input === 0)) ||
  (provider === "onescience" && modelID === "glm-5.2")

const isLimitedFree = (provider: string, modelID?: string) =>
  provider === "onescience" && modelID !== "glm-5.2"

type ModelState = ReturnType<typeof useLocal>["model"]

const ModelList: Component<{
  provider?: string
  class?: string
  onSelect: () => void
  action?: JSX.Element
  model?: ModelState
}> = (props) => {
  const model = props.model ?? useLocal().model
  const language = useLanguage()
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const providers = useProviders()

  const models = createMemo(() => {
    const available = model
      .list()
      .filter((item) => (props.provider ? item.provider.id === props.provider : true))
      .filter((item) => model.visible({ modelID: item.id, providerID: item.provider.id }))
      .map((item) => ({
        ...item,
        search: [
          item.provider.name,
          item.provider.id,
          item.name,
          item.id,
          item.family,
          isFree(item.provider.id, item.cost, item.id) ? "free 免费" : "",
          isLimitedFree(item.provider.id, item.id) ? "limited 限免" : "",
          item.latest ? "latest 最新" : "",
        ].join(" "),
      }))
    return available
  })

  return (
    <List
      class={`flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0 ${props.class ?? ""}`}
      search={{ placeholder: language.t("dialog.model.search.placeholder"), autofocus: true, action: props.action }}
      emptyMessage={language.t("dialog.model.empty")}
      key={(x) => `${x.provider.id}:${x.id}`}
      items={models}
      current={model.current()}
      scrollToCurrent={false}
      filterKeys={["search"]}
      sortBy={(a, b) => a.name.localeCompare(b.name)}
      groupBy={(x) => x.provider.name}
      sortGroupsBy={(a, b) => {
        const aProvider = a.items[0].provider.id
        const bProvider = b.items[0].provider.id
        if (popularProviders.includes(aProvider) && !popularProviders.includes(bProvider)) return -1
        if (!popularProviders.includes(aProvider) && popularProviders.includes(bProvider)) return 1
        return popularProviders.indexOf(aProvider) - popularProviders.indexOf(bProvider)
      }}
      groupHeader={(group) => {
        const providerID = group.items[0].provider.id
        const providerItem =
          providers.connected().find((p) => p.id === providerID) ?? providers.all().find((p) => p.id === providerID)
        const publicProvider = isPublicProviderID(providerID, globalSync.data.config.public_providers)
        // Match Settings → Providers editability, but never expose official Zen / OneScience / env providers.
        const canEdit =
          providerID !== "onescience" &&
          providerID !== "opencode" &&
          providerID !== "opencode-go" &&
          !publicProvider &&
          providerItem?.source !== "env"
        const isCustom = isEditableCustomProvider(
          providerID,
          globalSync.data.config.provider?.[providerID],
          providerItem,
          globalSync.data.config.public_providers,
        )
        return (
          <div class="flex items-center justify-between w-full gap-2 pr-1">
            <span class="truncate">{group.category}</span>
            <Show when={canEdit}>
              <Button
                size="small"
                variant="ghost"
                class="shrink-0 h-6 px-1.5 text-12-medium"
                onClick={() => {
                  dialog.show(() =>
                    isCustom ? (
                      <DialogCustomProvider providerID={providerID} back="picker" />
                    ) : (
                      <DialogConnectProvider provider={providerID} back="picker" />
                    ),
                  )
                }}
              >
                {language.t("common.edit")}
              </Button>
            </Show>
          </div>
        )
      }}
      itemWrapper={(item, node) => (
        <Tooltip
          class="w-full"
          placement="right-start"
          gutter={12}
          value={
            <ModelTooltip
              model={item}
              latest={item.latest}
              free={isFree(item.provider.id, item.cost, item.id)}
              limited={isLimitedFree(item.provider.id, item.id)}
            />
          }
        >
          {node}
        </Tooltip>
      )}
      onSelect={(x) => {
        model.set(x ? { modelID: x.id, providerID: x.provider.id } : undefined, {
          recent: true,
        })
        props.onSelect()
      }}
    >
      {(i) => (
        <div class="w-full flex items-center gap-x-2 text-13-regular">
          <span class="truncate">{i.name}</span>
          <Show when={isFree(i.provider.id, i.cost, i.id)}>
            <Tag>{language.t("model.tag.free")}</Tag>
          </Show>
          <Show when={isLimitedFree(i.provider.id, i.id)}>
            <Tag>{language.t("model.tag.limited")}</Tag>
          </Show>
          <Show when={i.latest}>
            <Tag>{language.t("model.tag.latest")}</Tag>
          </Show>
        </div>
      )}
    </List>
  )
}

type ModelSelectorTriggerProps = Omit<ComponentProps<typeof Kobalte.Trigger>, "as" | "ref">
type Dismiss = "escape" | "outside" | "select" | "manage" | "provider"

export function ModelSelectorPopover(props: {
  provider?: string
  model?: ModelState
  children?: JSX.Element
  triggerAs?: ValidComponent
  triggerProps?: ModelSelectorTriggerProps
  onClose?: (cause: "escape" | "select") => void
}) {
  const [store, setStore] = createStore<{
    open: boolean
    dismiss: Dismiss | null
  }>({
    open: false,
    dismiss: null,
  })
  const dialog = useDialog()

  const close = (dismiss: Dismiss) => {
    setStore("dismiss", dismiss)
    setStore("open", false)
  }

  const handleManage = () => {
    close("manage")
    dialog.show(() => <DialogSettings tab="models" />)
  }

  const handleConnectProvider = () => {
    close("provider")
    void import("./dialog-select-provider").then((x) => {
      dialog.show(() => <x.DialogSelectProvider />)
    })
  }
  const language = useLanguage()

  return (
    <Kobalte
      open={store.open}
      onOpenChange={(next) => {
        if (next) setStore("dismiss", null)
        setStore("open", next)
      }}
      modal={false}
      placement="top-start"
      gutter={4}
    >
      <Kobalte.Trigger as={props.triggerAs ?? "div"} {...props.triggerProps}>
        {props.children}
      </Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Content
          class="w-72 h-80 flex flex-col p-2 rounded-md border border-border-base bg-surface-raised-stronger-non-alpha shadow-md z-50 outline-none overflow-hidden"
          onEscapeKeyDown={(event) => {
            close("escape")
            event.preventDefault()
            event.stopPropagation()
          }}
          onPointerDownOutside={() => close("outside")}
          onFocusOutside={() => close("outside")}
          onCloseAutoFocus={(event) => {
            const dismiss = store.dismiss
            if (dismiss === "outside") event.preventDefault()
            if (dismiss === "escape" || dismiss === "select") {
              event.preventDefault()
              props.onClose?.(dismiss)
            }
            setStore("dismiss", null)
          }}
        >
          <Kobalte.Title class="sr-only">{language.t("dialog.model.select.title")}</Kobalte.Title>
          <ModelList
            provider={props.provider}
            model={props.model}
            onSelect={() => close("select")}
            class="p-1"
            action={
              <div class="flex items-center gap-1">
                <Tooltip placement="top" value={language.t("command.provider.connect")}>
                  <IconButton
                    icon="plus-small"
                    variant="ghost"
                    iconSize="normal"
                    class="size-6"
                    aria-label={language.t("command.provider.connect")}
                    onClick={handleConnectProvider}
                  />
                </Tooltip>
                <Tooltip placement="top" value={language.t("settings.models.title")}>
                  <IconButton
                    icon="sliders"
                    variant="ghost"
                    iconSize="normal"
                    class="size-6"
                    aria-label={language.t("settings.models.title")}
                    onClick={handleManage}
                  />
                </Tooltip>
              </div>
            }
          />
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}

export const DialogSelectModel: Component<{ provider?: string; model?: ModelState }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const [catalogSettled, setCatalogSettled] = createSignal(false)

  onMount(() => {
    // Join login's silent prefetch. Do not toast — this dialog has its own loading row.
    // Settle from the promise (with a catalog wait timeout), never from observer isFetched:
    // enabled && !fetched with an idle network used to lock this dialog on "正在拉取".
    void globalSync
      .ensureProviders({ silent: true })
      .catch(() => undefined)
      .finally(() => setCatalogSettled(true))
  })

  const showList = () => globalSync.data.provider.all.length > 0 || catalogSettled()

  const provider = () => {
    void import("./dialog-select-provider").then((x) => {
      dialog.show(() => <x.DialogSelectProvider />)
    })
  }

  const manage = () => {
    dialog.show(() => <DialogSettings tab="models" />)
  }

  return (
    <Dialog
      title={language.t("dialog.model.select.title")}
      action={
        <Button class="h-7 -my-1 text-14-medium" icon="plus-small" tabIndex={-1} onClick={provider}>
          {language.t("command.provider.connect")}
        </Button>
      }
    >
      <Show
        when={showList()}
        fallback={
          <div class="px-3 py-8 text-14-regular text-text-weak">
            {language.t("toast.provider.catalogLoading.description")}
          </div>
        }
      >
        <ModelList provider={props.provider} model={props.model} onSelect={() => dialog.close()} />
      </Show>
      <Button variant="ghost" class="ml-3 mt-5 mb-6 text-text-base self-start" onClick={manage}>
        {language.t("settings.models.title")}
      </Button>
    </Dialog>
  )
}
