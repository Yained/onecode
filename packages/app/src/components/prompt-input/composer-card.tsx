import { Show, type JSX } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"

export type PromptComposerCardProps = {
  title: string
  subtitle?: string
  /** Hover detail shown in a light composer-styled tip. */
  detail?: string
  preview?: JSX.Element
  badge?: JSX.Element
  busy?: boolean
  onRemove?: () => void
  removeLabel?: string
  onClick?: () => void
}

export const promptComposerCardRowClass =
  "os-composer-card-row flex flex-wrap items-start gap-1.5 empty:hidden"

function ComposerCardBody(props: PromptComposerCardProps) {
  return (
    <div
      class="group relative w-[156px] shrink-0 overflow-hidden rounded-[0.85rem] border-0 bg-[var(--os-code-user-bubble,#f4f4f4)] shadow-none"
      data-composer-card
    >
      <div
        role={props.onClick ? "button" : undefined}
        tabIndex={props.onClick ? 0 : undefined}
        class="flex w-full flex-col text-left outline-none"
        classList={{
          "cursor-pointer": !!props.onClick,
          "cursor-default": !props.onClick,
        }}
        onClick={() => props.onClick?.()}
        onKeyDown={(event) => {
          if (!props.onClick) return
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          props.onClick()
        }}
      >
        <div class="flex h-10 w-full items-center justify-center overflow-hidden">
          <Show when={props.preview} fallback={<Icon name="open-file" class="size-5 text-icon-weak" />}>
            {props.preview}
          </Show>
        </div>
        <div class="flex min-w-0 items-center gap-1 px-2 pb-1.5 pt-0.5">
          <Show when={props.badge}>
            <span class="shrink-0">{props.badge}</span>
          </Show>
          <span class="min-w-0 flex-1 truncate text-11-regular text-text-strong">{props.title}</span>
        </div>
      </div>
      <Show when={props.onRemove}>
        <IconButton
          type="button"
          icon="close-small"
          variant="ghost"
          disabled={props.busy}
          class="absolute top-1 right-1 z-10 size-4 rounded-full bg-[var(--os-code-user-bubble,#f4f4f4)] text-text-weak opacity-0 transition-opacity group-hover:opacity-100 hover:text-text-strong"
          onClick={(event) => {
            event.stopPropagation()
            props.onRemove?.()
          }}
          aria-label={props.removeLabel ?? "移除"}
        />
      </Show>
      <Show when={props.subtitle}>
        <span class="sr-only">{props.subtitle}</span>
      </Show>
    </div>
  )
}

/** Compact two-tone attachment tile aligned with composer tokens. */
export function PromptComposerCard(props: PromptComposerCardProps) {
  return (
    <Show
      when={props.detail}
      fallback={<ComposerCardBody {...props} />}
    >
      {(detail) => (
        <Tooltip
          value={<span class="os-composer-card-tip">{detail()}</span>}
          placement="top"
          openDelay={400}
          contentClass="os-composer-card-tooltip"
        >
          <ComposerCardBody {...props} />
        </Tooltip>
      )}
    </Show>
  )
}

export function promptComposerFileBadge(filename: string) {
  const ext = filename.includes(".") ? filename.split(".").pop()?.toUpperCase().slice(0, 4) : ""
  if (!ext) return null
  return (
    <span class="inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-[3px] px-0.5 text-[8px] font-semibold leading-none text-text-weak">
      {ext}
    </span>
  )
}
