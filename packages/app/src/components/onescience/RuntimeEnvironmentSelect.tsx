import { createMemo, createSignal, For, Show, type Accessor } from "solid-js"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogSelectSsh } from "@/components/dialog-select-ssh"
import {
  envKeyOf,
  runtimeEnvironmentLabel,
  useRuntimeEnvironment,
  validateRuntimeEnvironment,
  type RuntimeEnvironment,
} from "@/components/onescience/runtime-environment"
import { type SshConnectivityState } from "@/components/onescience/execution-location"
import {
  datasetCopyStatusForEnv,
  type DatasetDownloadCopy,
} from "@/pages/modelscope-download-client"

function dotClass(connectivity: SshConnectivityState | undefined) {
  switch (connectivity) {
    case "connected":
      return "bg-surface-success-base"
    case "failed":
      return "bg-surface-critical-base"
    case "skipped":
      return "bg-icon-weak"
    case "testing":
      return "bg-surface-warning-base animate-pulse"
    default:
      return "bg-icon-weak"
  }
}

function EnvironmentOptionBody(props: {
  title: string
  meta?: string
  presence?: "completed" | "partial"
}) {
  return (
    <div class="os-env-option">
      <div class="os-env-option-head">
        <span class="os-env-option-title">{props.title}</span>
        <Show when={props.presence === "completed"}>
          <span class="os-env-option-badge">已下载</span>
        </Show>
        <Show when={props.presence === "partial"}>
          <span class="os-env-option-badge" data-tone="partial">
            未完成
          </span>
        </Show>
      </div>
      <Show when={props.meta}>
        <div class="os-env-option-meta">{props.meta}</div>
      </Show>
    </div>
  )
}

export function RuntimeEnvironmentSelect(props: {
  directory: Accessor<string>
  /** Controlled override: when set, selection stays local to the caller (e.g. download dialog). */
  value?: Accessor<RuntimeEnvironment>
  onChange?: (env: RuntimeEnvironment) => void
  /** "pill" for the session bar; "field" renders a full-width form field for dialogs. */
  variant?: "pill" | "field"
  /** Dataset copies used to mark environments that already have this dataset. */
  downloadedCopies?: Accessor<DatasetDownloadCopy[]>
  /** Session bar is local / SSH only; dataset dialogs may still offer SCNet. */
  hideScnet?: boolean
  disabled?: boolean
}) {
  const dialog = useDialog()
  const [open, setOpen] = createSignal(false)
  const runtime = useRuntimeEnvironment(props.directory, { probeSsh: open })

  const current = () => props.value?.() ?? runtime.env()
  const value = () => envKeyOf(current())
  const presenceOf = (env: RuntimeEnvironment) => datasetCopyStatusForEnv(props.downloadedCopies?.() ?? [], env)

  const validation = createMemo(() => {
    if (!props.value) return runtime.validation()
    return validateRuntimeEnvironment(current(), { sshTargets: runtime.sshTargets(), scnet: runtime.scnet() })
  })

  const apply = (env: RuntimeEnvironment) => {
    if (props.onChange) {
      props.onChange(env)
    } else {
      runtime.setEnv(env)
    }
    setOpen(false)
  }

  const select = (input: unknown) => {
    const key = String(input)
    if (key === "local") {
      apply({ kind: "local" })
      return
    }
    if (key.startsWith("ssh:")) {
      apply({ kind: "ssh", targetName: key.slice(4) })
      return
    }
    if (key.startsWith("scnet:")) {
      apply({ kind: "scnet", serverName: key.slice(6) || undefined })
    }
  }

  const currentConnectivity = () => {
    const env = current()
    if (env.kind === "local") return "connected" as const
    if (env.kind === "ssh") return runtime.sshTargets().find((item) => item.name === env.targetName)?.connectivity
    return runtime.scnet().connected ? ("connected" as const) : ("failed" as const)
  }

  const sshMeta = (target: { enabled?: boolean; connectivity: SshConnectivityState }) => {
    if (target.enabled === false) return "已禁用"
    if (target.connectivity === "failed") return "未连通"
    if (target.connectivity === "testing") return "检测中"
    return undefined
  }

  const field = () => props.variant === "field"
  const currentPresence = () => presenceOf(current())
  const showScnet = () => !props.hideScnet || current().kind === "scnet"
  const disabled = () => Boolean(props.disabled)
  return (
    <DropdownMenu
      open={disabled() ? false : open()}
      onOpenChange={(next) => {
        if (disabled()) return
        setOpen(next)
      }}
      gutter={4}
      placement={field() ? "bottom-start" : "bottom-end"}
    >
      <DropdownMenu.Trigger
        disabled={disabled()}
        class={
          field()
            ? "os-env-field-trigger"
            : "flex items-center gap-1.5 rounded-md border border-border-weak-base bg-surface-base px-2 py-1 text-12-regular text-text-base hover:bg-surface-base-hover data-[expanded]:bg-surface-base-hover disabled:pointer-events-none disabled:opacity-60"
        }
        title={disabled() ? "连接进行中，请稍候" : (validation().reason ?? "选择运行环境")}
      >
        <span class={`size-1.5 shrink-0 rounded-full ${dotClass(currentConnectivity())}`} />
        <span class={field() ? "os-env-field-label" : "max-w-[180px] truncate"}>{runtimeEnvironmentLabel(current())}</span>
        <Show when={currentPresence() === "completed"}>
          <span class="os-env-option-badge">已下载</span>
        </Show>
        <Show when={currentPresence() === "partial"}>
          <span class="os-env-option-badge" data-tone="partial">
            未完成
          </span>
        </Show>
        <Icon name="chevron-down" size="small" class={field() ? "os-env-field-chevron" : "text-icon-weak"} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          class={`os-env-select-content min-w-[280px] [&_[data-slot=dropdown-menu-radio-item]]:pl-1 [&_[data-slot=dropdown-menu-item]]:pl-1${field() ? " os-env-select-content-field" : ""}`}
        >
          <DropdownMenu.Group>
            <DropdownMenu.GroupLabel class="!px-1 !py-1">运行环境</DropdownMenu.GroupLabel>
            <DropdownMenu.RadioGroup class="os-env-select-group" value={value()} onChange={select}>
              <DropdownMenu.RadioItem value="local" closeOnSelect onSelect={() => setOpen(false)}>
                <span class="size-1.5 shrink-0 rounded-full bg-surface-success-base" />
                <DropdownMenu.ItemLabel>
                  <EnvironmentOptionBody
                    title="本地运行"
                    meta="当前项目目录"
                    presence={presenceOf({ kind: "local" })}
                  />
                </DropdownMenu.ItemLabel>
                <DropdownMenu.ItemIndicator />
              </DropdownMenu.RadioItem>
              <For each={runtime.sshTargets()}>
                {(target) => (
                  <DropdownMenu.RadioItem
                    value={`ssh:${target.name}`}
                    disabled={target.enabled === false}
                    closeOnSelect
                    onSelect={() => setOpen(false)}
                  >
                    <span class={`size-1.5 shrink-0 rounded-full ${dotClass(target.connectivity)}`} />
                    <DropdownMenu.ItemLabel>
                      <EnvironmentOptionBody
                        title={`SSH: ${target.name}`}
                        meta={sshMeta(target)}
                        presence={presenceOf({ kind: "ssh", targetName: target.name })}
                      />
                    </DropdownMenu.ItemLabel>
                    <DropdownMenu.ItemIndicator />
                  </DropdownMenu.RadioItem>
                )}
              </For>
              <Show when={showScnet() && runtime.scnet().configured}>
                <DropdownMenu.RadioItem
                  value={`scnet:${runtime.scnet().name ?? ""}`}
                  disabled={!runtime.scnet().connected}
                  closeOnSelect
                  onSelect={() => setOpen(false)}
                >
                  <span
                    class={`size-1.5 shrink-0 rounded-full ${runtime.scnet().connected ? "bg-surface-success-base" : "bg-surface-critical-base"}`}
                  />
                  <DropdownMenu.ItemLabel>
                    <EnvironmentOptionBody
                      title={runtime.scnet().name ? `SCNet: ${runtime.scnet().name}` : "SCNet"}
                      meta={runtime.scnet().detail}
                    />
                  </DropdownMenu.ItemLabel>
                  <DropdownMenu.ItemIndicator />
                </DropdownMenu.RadioItem>
              </Show>
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Group>
          <DropdownMenu.Separator class="my-1" />
          <DropdownMenu.Item
            onSelect={() => {
              setOpen(false)
              dialog.show(() => (
                <div class="os-ssh-dialog-stack">
                  <DialogSelectSsh />
                </div>
              ))
            }}
          >
            <Icon name="plus" size="small" class="text-icon-weak" />
            <DropdownMenu.ItemLabel>管理 SSH 配置…</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
          <Show when={showScnet() && !runtime.scnet().configured}>
            <DropdownMenu.Item disabled>
              <DropdownMenu.ItemLabel>
                <span class="text-text-weak">未配置 scnet MCP（AK/SK），配置后可选择 SCNet 环境</span>
              </DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </Show>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
