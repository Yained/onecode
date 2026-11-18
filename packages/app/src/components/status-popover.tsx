import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Popover } from "@opencode-ai/ui/popover"
import { Suspense, createMemo, createSignal, lazy, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useSync } from "@/context/sync"

const Body = lazy(() => import("./status-popover-body").then((x) => ({ default: x.StatusPopoverBody })))

export function StatusPopover(props?: {
  triggerClass?: string
  placement?: "bottom-end" | "bottom-start" | "right-start"
  shift?: number
  gutter?: number
  flip?: boolean | string
  dense?: boolean
}) {
  const language = useLanguage()
  const server = useServer()
  const sync = useSync()
  const [shown, setShown] = createSignal(false)
  const ready = createMemo(() => server.healthy() === false || sync.data.mcp_ready)
  // Green only when something is actually connected; empty/idle stays neutral gray.
  const indicator = createMemo(() => {
    if (server.healthy() === undefined || !ready()) return "pending"
    if (server.healthy() === false) return "error"
    const mcp = Object.values(sync.data.mcp ?? {})
    if (mcp.some((item) => item.status !== "connected" && item.status !== "disabled")) return "error"
    if (mcp.some((item) => item.status === "connected")) return "ok"
    return "idle"
  })

  const dense = () => !!props?.dense
  const statusIcon = () => (
    <div class="relative size-4 shrink-0">
      <div class="badge-mask-tight size-4 flex items-center justify-center">
        <Icon
          name={shown() ? "status-active" : "status"}
          size="small"
          classList={{ "text-icon-weak": dense() }}
        />
      </div>
      <div
        classList={{
          "absolute -top-px -right-px size-1.5 rounded-full": true,
          "bg-icon-success-base": indicator() === "ok",
          "bg-icon-critical-base": indicator() === "error",
          "bg-border-weak-base": indicator() === "pending" || indicator() === "idle",
        }}
      />
    </div>
  )

  return (
    <Popover
      open={shown()}
      onOpenChange={setShown}
      triggerAs={dense() ? "button" : Button}
      triggerProps={
        dense()
          ? {
              type: "button",
              class:
                props?.triggerClass ??
                "flex items-center gap-2 min-w-0 w-full py-0.5 text-left bg-transparent border-0 shadow-none cursor-default focus:outline-none",
              "aria-label": language.t("status.popover.ariaLabel"),
            }
          : {
              variant: "ghost",
              class:
                props?.triggerClass ??
                "titlebar-icon h-6 px-2 gap-1.5 box-border border border-border-weak-base bg-surface-panel shadow-none shrink-0",
              "aria-label": language.t("status.popover.ariaLabel"),
              style: { scale: 1 },
            }
      }
      trigger={
        dense() ? (
          <>
            <div class="shrink-0 size-6 flex items-center justify-center">{statusIcon()}</div>
            <span class="text-14-regular text-text-strong min-w-0 flex-1 truncate text-left">
              {language.t("status.popover.trigger")}
            </span>
          </>
        ) : (
          <div class="relative flex items-center gap-1.5 min-w-0 w-full">
            {statusIcon()}
            <span class="text-12-regular text-text-strong whitespace-nowrap">
              {language.t("status.popover.trigger")}
            </span>
          </div>
        )
      }
      class={`[&_[data-slot=popover-body]]:p-0 w-[360px] max-w-[calc(100vw-40px)] bg-transparent border-0 shadow-none rounded-xl${dense() ? " status-popover-sidebar" : ""}`}
      gutter={props?.gutter ?? (dense() ? 8 : 4)}
      placement={props?.placement ?? (dense() ? "right-start" : "bottom-end")}
      shift={props?.shift ?? (dense() ? 0 : -168)}
      flip={props?.flip ?? (dense() ? false : true)}
      slide={dense() ? false : undefined}
      fitViewport
    >
      <Show when={shown()}>
        <Suspense
          fallback={
            <div class="w-[360px] h-14 rounded-xl bg-background-strong shadow-[var(--shadow-lg-border-base)]" />
          }
        >
          <Body shown={shown} />
        </Suspense>
      </Show>
    </Popover>
  )
}
