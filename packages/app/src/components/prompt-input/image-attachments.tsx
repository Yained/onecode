import { Component, For, Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { ProgressCircle } from "@opencode-ai/ui/progress-circle"
import { isAttachmentReady, isAttachmentUploading, type ImageAttachmentPart } from "@/context/prompt"
import { useLanguage } from "@/context/language"
import { resolveAttachmentPreviewSrc } from "./attachment-cache"
import { PromptComposerCard, promptComposerFileBadge } from "./composer-card"

type PromptImageAttachmentsProps = {
  attachments: ImageAttachmentPart[]
  unsupportedIds?: string[]
  onOpen: (attachment: ImageAttachmentPart) => void
  onRemove: (id: string) => void
  removeLabel: string
}

export const PromptImageAttachments: Component<PromptImageAttachmentsProps> = (props) => {
  const language = useLanguage()

  const unsupported = (attachment: ImageAttachmentPart) => props.unsupportedIds?.includes(attachment.id) ?? false

  const detail = (attachment: ImageAttachmentPart) => {
    if (unsupported(attachment)) return language.t("prompt.attachment.unsupported")
    if (isAttachmentUploading(attachment)) {
      const progress = attachment.uploadProgress ?? 0
      return progress > 0
        ? language.t("prompt.attachment.uploadingProgress", { progress: String(progress) })
        : language.t("prompt.attachment.uploading")
    }
    if (attachment.uploadStatus === "error") return language.t("prompt.attachment.uploadFailed")
    if (attachment.uploadStatus === "ready" && !isAttachmentReady(attachment)) {
      return language.t("prompt.attachment.unavailable")
    }
    return attachment.filename
  }

  const preview = (attachment: ImageAttachmentPart) => {
    const previewSrc = resolveAttachmentPreviewSrc(attachment)
    if (attachment.mime.startsWith("image/") && previewSrc) {
      return <img src={previewSrc} alt={attachment.filename} class="size-full object-cover" />
    }
    if (isAttachmentUploading(attachment)) {
      return (
        <div class="flex flex-col items-center gap-1">
          <ProgressCircle percentage={attachment.uploadProgress ?? 0} size={28} strokeWidth={3} />
          <Show when={(attachment.uploadProgress ?? 0) > 0}>
            <span class="text-10-medium text-text-weak">{attachment.uploadProgress}%</span>
          </Show>
        </div>
      )
    }
    return (
      <Icon
        name={
          attachment.mime.startsWith("application/") && attachment.mime !== "application/octet-stream"
            ? "open-file"
            : "folder"
        }
        class="size-5 text-text-weak"
      />
    )
  }

  return (
    <Show when={props.attachments.length > 0}>
      <div class="contents">
        <For each={props.attachments}>
          {(attachment) => (
            <PromptComposerCard
              title={attachment.filename}
              detail={detail(attachment)}
              preview={preview(attachment)}
              badge={promptComposerFileBadge(attachment.filename) ?? undefined}
              onRemove={() => props.onRemove(attachment.id)}
              removeLabel={props.removeLabel}
              onClick={
                isAttachmentReady(attachment) && !unsupported(attachment)
                  ? () => props.onOpen(attachment)
                  : undefined
              }
            />
          )}
        </For>
      </div>
    </Show>
  )
}
