import { For, Show } from "solid-js"
import { Portal } from "solid-js/web"
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { makeEventListener } from "@solid-primitives/event-listener"

export function SessionPermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject") => void
}) {
  const language = useLanguage()

  const toolTitle = () => {
    const key = `settings.permissions.tool.${props.request.permission}.title`
    const value = language.t(key as Parameters<typeof language.t>[0])
    if (value === key) return props.request.permission
    return value
  }

  const toolDescription = () => {
    const key = `settings.permissions.tool.${props.request.permission}.description`
    const value = language.t(key as Parameters<typeof language.t>[0])
    if (value === key) return ""
    return value
  }

  const decide = (response: "once" | "always" | "reject") => {
    if (props.responding) return
    props.onDecide(response)
  }

  makeEventListener(
    window,
    "keydown",
    (event) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      decide("reject")
    },
    { capture: true },
  )

  return (
    <Portal>
      <div data-component="dialog-overlay" data-permission-modal="" />
      <div data-component="dialog" data-fit="" data-size="normal" data-permission-modal="" data-transition="">
        <div data-slot="dialog-container">
          <div
            data-slot="dialog-content"
            data-expanded=""
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="session-permission-title"
            aria-describedby="session-permission-description"
          >
            <div data-slot="dialog-header">
              <div id="session-permission-title" data-slot="dialog-title" class="flex items-center gap-2 min-w-0">
                <span class="text-icon-warning-base shrink-0" aria-hidden="true">
                  <Icon name="warning" size="large" />
                </span>
                <span class="truncate">{language.t("notification.permission.title")}</span>
              </div>
            </div>

            <div id="session-permission-description" data-slot="dialog-description" class="flex flex-col gap-1">
              <div class="text-14-medium text-text-strong">{toolTitle()}</div>
              <Show when={toolDescription()}>
                <div class="text-14-regular text-text-weak">{toolDescription()}</div>
              </Show>
            </div>

            <div data-slot="dialog-body" class="w-full px-5 pb-2 flex flex-col gap-3 min-w-0">
              <Show when={props.request.patterns.length > 0}>
                <div class="flex flex-col gap-2 max-h-48 overflow-y-auto rounded-lg border border-border-weak-base bg-background-base/60 px-3 py-2">
                  <For each={props.request.patterns}>
                    {(pattern) => <code class="text-12-regular text-text-base break-all">{pattern}</code>}
                  </For>
                </div>
              </Show>
            </div>

            <div class="w-full flex flex-wrap items-center justify-end gap-2 px-5 py-4 border-t border-border-weak-base">
              <Button variant="ghost" size="normal" onClick={() => decide("reject")} disabled={props.responding}>
                {language.t("ui.permission.deny")}
              </Button>
              <Button variant="secondary" size="normal" onClick={() => decide("always")} disabled={props.responding}>
                {language.t("ui.permission.allowAlways")}
              </Button>
              <Button
                variant="primary"
                size="normal"
                autofocus
                onClick={() => decide("once")}
                disabled={props.responding}
              >
                {language.t("ui.permission.allowOnce")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  )
}
