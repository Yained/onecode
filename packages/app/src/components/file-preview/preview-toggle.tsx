import { Button } from "@opencode-ai/ui/button"
import { Show } from "solid-js"

export function PreviewToggleBar(props: {
  view: () => "preview" | "source"
  setView: (value: "preview" | "source") => void
  previewLabel: string
  sourceLabel: string
  chrome?: "session" | "workbench"
}) {
  return (
    <Show
      when={props.chrome === "workbench"}
      fallback={
        <div class="flex items-center gap-2 px-4 py-2 border-b border-border-weaker-base shrink-0">
          <Button
            type="button"
            size="small"
            variant={props.view() === "preview" ? "secondary" : "ghost"}
            onClick={() => props.setView("preview")}
          >
            {props.previewLabel}
          </Button>
          <Button
            type="button"
            size="small"
            variant={props.view() === "source" ? "secondary" : "ghost"}
            onClick={() => props.setView("source")}
          >
            {props.sourceLabel}
          </Button>
        </div>
      }
    >
      <div class="os-file-preview-toolbar">
        <div class="os-file-preview-toggle" role="group" aria-label="文件视图">
          <button
            type="button"
            classList={{ "is-active": props.view() === "preview" }}
            onClick={() => props.setView("preview")}
          >
            {props.previewLabel}
          </button>
          <button
            type="button"
            classList={{ "is-active": props.view() === "source" }}
            onClick={() => props.setView("source")}
          >
            {props.sourceLabel}
          </button>
        </div>
      </div>
    </Show>
  )
}
