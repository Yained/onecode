import { Component, For, Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { ProgressCircle } from "@opencode-ai/ui/progress-circle"
import { useLanguage } from "@/context/language"
import type { PromptUploadItem } from "./attachments"
import { PromptComposerCard, promptComposerFileBadge } from "./composer-card"

type PromptUploadProgressProps = {
  items: PromptUploadItem[]
  onRetry: (id: string) => void
  onDismiss: (id: string) => void
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export const PromptUploadProgress: Component<PromptUploadProgressProps> = (props) => {
  const language = useLanguage()

  const statusLabel = (item: PromptUploadItem) => {
    if (item.status === "uploading") return language.t("prompt.upload.status.uploading")
    if (item.status === "success") return language.t("prompt.upload.status.success")
    return item.message || language.t("prompt.upload.status.error")
  }

  const preview = (item: PromptUploadItem) => {
    if (item.status === "uploading") {
      return <ProgressCircle percentage={Math.max(item.progress, 8)} size={28} strokeWidth={3} />
    }
    if (item.status === "error") {
      return <Icon name="circle-x" class="size-5 text-text-danger-base" />
    }
    return <Icon name="open-file" class="size-5 text-text-weak" />
  }

  return (
    <Show when={props.items.length > 0}>
      <div class="contents" data-component="prompt-upload-progress">
        <For each={props.items}>
          {(item) => (
            <PromptComposerCard
              title={item.filename}
              detail={`${formatBytes(item.size)} · ${statusLabel(item)}`}
              subtitle={`${formatBytes(item.size)} · ${statusLabel(item)}`}
              preview={preview(item)}
              badge={promptComposerFileBadge(item.filename) ?? undefined}
              onRemove={() => props.onDismiss(item.id)}
              removeLabel={language.t("prompt.upload.dismiss")}
              onClick={item.status === "error" ? () => props.onRetry(item.id) : undefined}
            />
          )}
        </For>
      </div>
    </Show>
  )
}
