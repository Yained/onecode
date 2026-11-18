import { Tooltip } from "@opencode-ai/ui/tooltip"
import type { JSX } from "solid-js"
import { Dynamic } from "solid-js/web"
import { clipSessionTitle } from "@/utils/session-title"

export function SessionTitleLabel(props: {
  full: string
  class?: string
  hover?: boolean
  fit?: boolean
  tag?: "span" | "h1"
  slot?: string
  placement?: "top" | "right" | "bottom" | "left" | "bottom-start" | "top-start"
  onDblClick?: JSX.EventHandlerUnion<HTMLElement, MouseEvent>
}): JSX.Element {
  const full = () => (props.full ?? "").replace(/\s+/g, " ").trim() || props.full
  return (
    <Tooltip
      inactive={props.hover === false || !full()}
      placement={props.placement ?? "right"}
      gutter={8}
      class={`os-client-session-title-trigger${props.fit ? " is-fit" : ""}`}
      contentClass="os-client-session-title-tooltip"
      value={<span class="os-client-session-title-tip">{full()}</span>}
    >
      <Dynamic
        component={props.tag ?? "span"}
        class={props.class ?? "os-client-task-title"}
        data-slot={props.slot}
        onDblClick={props.onDblClick}
      >
        {clipSessionTitle(full())}
      </Dynamic>
    </Tooltip>
  )
}
