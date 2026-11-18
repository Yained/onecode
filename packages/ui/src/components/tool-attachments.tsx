import { For, Show } from "solid-js"
import type { FilePart } from "@opencode-ai/sdk/v2"
import { useDialog } from "../context/dialog"
import { useI18n } from "../context/i18n"
import { getFilename } from "@opencode-ai/core/util/path"
import { ImagePreview } from "./image-preview"

export function imageAttachments(attachments: FilePart[] | undefined) {
  if (!attachments?.length) return []
  return attachments.filter((item) => item.mime.startsWith("image/"))
}

export function ToolAttachments(props: {
  attachments: FilePart[]
  source?: string
  compact?: boolean
}) {
  const dialog = useDialog()
  const i18n = useI18n()
  const images = () => imageAttachments(props.attachments)

  const open = (url: string, alt?: string) => {
    dialog.show(() => <ImagePreview src={url} alt={alt} />)
  }

  return (
    <Show when={images().length > 0}>
      <div data-component="tool-attachments" data-compact={props.compact ? "" : undefined}>
        <Show when={props.source}>
          <div data-slot="tool-attachments-source" class="text-12-regular text-text-weak">
            {props.source}
          </div>
        </Show>
        <div data-slot="tool-attachments-grid">
          <For each={images()}>
            {(file) => {
              const name = file.filename ?? getFilename(props.source ?? "") ?? i18n.t("ui.message.attachment.alt")
              return (
                <button
                  type="button"
                  data-slot="tool-attachment"
                  title={name}
                  onClick={() => open(file.url, name)}
                >
                  <img data-slot="tool-attachment-image" src={file.url} alt={name} />
                  <span data-slot="tool-attachment-name">{name}</span>
                </button>
              )
            }}
          </For>
        </div>
      </div>
    </Show>
  )
}
