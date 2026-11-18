import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Switch } from "@opencode-ai/ui/switch"
import { Tabs } from "@opencode-ai/ui/tabs"
import { useMutation, useQueryClient } from "@tanstack/solid-query"
import { showToast } from "@opencode-ai/ui/toast"
import { type Accessor, createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { sshConnectivityLabel } from "@/components/onescience/execution-location"
import {
  managedSshMapGeneration,
  rememberManagedSshMap,
  useRegisteredSshConnectivity,
} from "@/components/onescience/use-registered-ssh-connectivity"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useGlobalSync, useQueryOptions } from "@/context/global-sync"
import { fetchManagedOpenSshDisk, hydrateSshFromOpenSshTargets } from "@/context/global-sync/bootstrap"
import { useGlobalSDK } from "@/context/global-sdk"
import { pathKey } from "@/utils/path-key"
import type { Config } from "@opencode-ai/sdk/v2/client"

const useMcpToggleMutation = () => {
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()
  const queryClient = useQueryClient()
  const queryOptions = useQueryOptions()

  return useMutation(() => ({
    mutationFn: async (name: string) => {
      const status = sync.data.mcp[name]
      await (status?.status === "connected" ? sdk.client.mcp.disconnect({ name }) : sdk.client.mcp.connect({ name }))
    },
    onSuccess: () => queryClient.refetchQueries(queryOptions.mcp(pathKey(sync.directory))),
    onError: (err) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))
}

export function StatusPopoverBody(props: { shown: Accessor<boolean> }) {
  const sync = useSync()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const queryClient = useQueryClient()
  const dialog = useDialog()
  const language = useLanguage()

  let dialogRun = 0
  let dialogDead = false
  onCleanup(() => {
    dialogDead = true
    dialogRun += 1
  })

  // Disk OpenSSH is the Integration display source of truth when the popover opens.
  // Keep a local override so empty config.ssh / pin races cannot hide targets that
  // `/global/ssh/targets` already returned (the F12-vs-no-F12 failure mode).
  const [sshFromDisk, setSshFromDisk] = createSignal<Config["ssh"] | undefined>()

  createEffect(() => {
    if (!props.shown()) {
      setSshFromDisk(undefined)
      return
    }
    let cancelled = false
    const generation = managedSshMapGeneration()
    void (async () => {
      const disk = await fetchManagedOpenSshDisk(globalSDK.url)
      if (cancelled || generation !== managedSshMapGeneration() || disk === undefined) return
      setSshFromDisk(disk)
      rememberManagedSshMap(disk)
      await hydrateSshFromOpenSshTargets({
        serverUrl: globalSDK.url,
        queryClient,
        disk,
      }).catch(() => undefined)
    })()
    onCleanup(() => {
      cancelled = true
    })
  })

  const toggleMcp = useMcpToggleMutation()
  const mcpNames = createMemo(() => {
    const names = new Set<string>([
      ...Object.keys(globalSync.data.config.mcp ?? {}),
      ...Object.keys(sync.data.mcp ?? {}),
    ])
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  })
  const mcpStatus = (name: string) => sync.data.mcp?.[name]?.status
  const sshItems = createMemo(() => {
    const map = sshFromDisk() ?? globalSync.data.config.ssh ?? {}
    return Object.entries(map)
      .map(([name, config]) => ({ name, config }))
      .filter(
        (item): item is { name: string; config: NonNullable<Config["ssh"]>[string] & { host?: string; remotePath?: string } } =>
          !!item.config && typeof item.config === "object" && "host" in item.config,
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  })
  const sshMap = createMemo(() => sshFromDisk() ?? globalSync.data.config.ssh)
  const sshConnectivity = useRegisteredSshConnectivity({ ssh: sshMap })

  const openSshDialog = (mode?: "add") => {
    const run = ++dialogRun
    void import("./dialog-select-ssh").then((x) => {
      if (dialogDead || dialogRun !== run) return
      dialog.show(() => (
        <div class="os-ssh-dialog-stack">
          <x.DialogSelectSsh initialMode={mode} />
        </div>
      ))
    })
  }

  return (
    <div class="flex items-center gap-1 w-[360px] rounded-xl shadow-[var(--shadow-lg-border-base)]">
      <Tabs
        aria-label={language.t("status.popover.ariaLabel")}
        class="tabs bg-background-strong rounded-xl overflow-hidden"
        data-component="tabs"
        data-active="mcp"
        defaultValue="mcp"
        variant="alt"
      >
        <Tabs.List data-slot="tablist" class="bg-transparent border-b-0 px-4 pt-2 pb-0 gap-3 h-10">
          <Tabs.Trigger value="mcp" data-slot="tab" class="text-12-regular">
            {language.t("status.popover.tab.mcp")}
          </Tabs.Trigger>
          <Tabs.Trigger value="ssh" data-slot="tab" class="text-12-regular">
            {language.t("status.popover.tab.ssh")}
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="mcp">
          <div class="flex flex-col px-2 pb-2">
            <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14 gap-2">
              <Show
                when={mcpNames().length > 0}
                fallback={
                  <div class="text-14-regular text-text-base text-center my-auto py-2">
                    {language.t("dialog.mcp.empty")}
                  </div>
                }
              >
                <For each={mcpNames()}>
                  {(name) => {
                    const status = () => mcpStatus(name)
                    const enabled = () => status() === "connected"
                    return (
                      <button
                        type="button"
                        class="flex items-center gap-2 w-full h-8 pl-3 pr-2 py-1 rounded-md hover:bg-surface-raised-base-hover transition-colors text-left"
                        onClick={() => {
                          if (toggleMcp.isPending) return
                          toggleMcp.mutate(name)
                        }}
                        disabled={toggleMcp.isPending && toggleMcp.variables === name}
                      >
                        <div
                          classList={{
                            "size-2 rounded-full shrink-0": true,
                            "bg-icon-success-base": enabled(),
                            "bg-border-weak-base": !enabled(),
                          }}
                        />
                        <span class="text-14-regular text-text-base truncate flex-1">{name}</span>
                        <div onClick={(event) => event.stopPropagation()}>
                          <Switch
                            checked={enabled()}
                            disabled={toggleMcp.isPending && toggleMcp.variables === name}
                            onChange={() => {
                              if (toggleMcp.isPending) return
                              toggleMcp.mutate(name)
                            }}
                          />
                        </div>
                      </button>
                    )
                  }}
                </For>
              </Show>
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="ssh">
          <div class="flex flex-col px-2 pb-2">
            <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14 gap-2">
              <Show
                when={sshItems().length > 0}
                fallback={
                  <div class="text-14-regular text-text-base text-center my-auto py-2">
                    {language.t("dialog.ssh.empty")}
                  </div>
                }
              >
                <For each={sshItems()}>
                  {(item) => {
                    const connectivity = () => sshConnectivity.byName()[item.name]
                    return (
                    <button
                      type="button"
                      class="flex flex-col gap-0.5 w-full px-3 py-1.5 rounded-md hover:bg-surface-raised-base-hover transition-colors text-left"
                      onClick={() => openSshDialog()}
                    >
                      <div class="flex items-center gap-2 min-w-0">
                        <span
                          class="os-ssh-connectivity-dot shrink-0"
                          data-state={sshConnectivity.loading() && !connectivity() ? "testing" : (connectivity()?.connectivity ?? "idle")}
                          aria-hidden="true"
                        />
                        <span class="text-14-regular text-text-base truncate">{item.name}</span>
                        <span class="text-11-regular text-text-weaker shrink-0">
                          {item.config.enabled === false
                            ? language.t("dialog.ssh.status.disabled")
                            : language.t("dialog.ssh.status.enabled")}
                        </span>
                        <Show when={connectivity()}>
                          {(target) => (
                            <span class="text-11-regular text-text-weaker shrink-0">
                              · {sshConnectivityLabel(target().connectivity)}
                            </span>
                          )}
                        </Show>
                        <Show when={sshConnectivity.loading() && !connectivity()}>
                          <span class="text-11-regular text-text-weaker shrink-0">· 检测中...</span>
                        </Show>
                      </div>
                      <Show when={item.config.remotePath}>
                        <span class="text-12-regular text-text-weak truncate pl-3.5">
                          {item.config.remotePath}
                        </span>
                      </Show>
                    </button>
                    )
                  }}
                </For>
              </Show>
              <div class="flex flex-wrap gap-2 pt-1">
                <Button variant="secondary" class="h-8 px-3 py-1.5" onClick={() => openSshDialog()}>
                  {language.t("status.popover.action.manageSsh")}
                </Button>
                <Button variant="secondary" icon="plus-small" class="h-8 px-3 py-1.5" onClick={() => openSshDialog("add")}>
                  {language.t("dialog.ssh.addButton")}
                </Button>
              </div>
            </div>
          </div>
        </Tabs.Content>
      </Tabs>
    </div>
  )
}
