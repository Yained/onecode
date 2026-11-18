import type { Prompt, ImageAttachmentPart } from "@/context/prompt"
import { uuid } from "@/utils/uuid"
import { readFileDataUrl } from "./attachment-upload"

const TRANSIENT_PREFIX = "attachment-cache:"
export const LARGE_ATTACHMENT_THRESHOLD_BYTES = 1024 * 1024

type CachedAttachment = {
  file: File
  previewUrl?: string
}

const cache = new Map<string, CachedAttachment>()

export function isTransientAttachmentUrl(url: string) {
  return url.startsWith(TRANSIENT_PREFIX)
}

export function cacheTransientAttachment(file: File, mime: string) {
  const dataUrl = `${TRANSIENT_PREFIX}${uuid()}`
  const previewUrl =
    mime.startsWith("image/") && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : undefined
  cache.set(dataUrl, {
    file,
    ...(previewUrl ? { previewUrl } : {}),
  })
  return dataUrl
}

export function hasTransientAttachment(url: string) {
  return isTransientAttachmentUrl(url) && cache.has(url)
}

export function resolveAttachmentPreviewSrc(part: Pick<ImageAttachmentPart, "dataUrl" | "mime">) {
  if (!isTransientAttachmentUrl(part.dataUrl)) return part.dataUrl
  return cache.get(part.dataUrl)?.previewUrl
}

export async function materializeAttachmentDataUrl(part: Pick<ImageAttachmentPart, "dataUrl" | "mime">) {
  if (!isTransientAttachmentUrl(part.dataUrl)) return part.dataUrl
  const cached = cache.get(part.dataUrl)
  if (!cached) return undefined
  return readFileDataUrl(cached.file, part.mime)
}

export function collectTransientAttachmentUrls(prompt: Prompt) {
  return prompt.flatMap((part) => (part.type === "image" && isTransientAttachmentUrl(part.dataUrl) ? [part.dataUrl] : []))
}

export function clearTransientAttachment(url: string) {
  const cached = cache.get(url)
  if (!cached) return
  if (cached.previewUrl && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(cached.previewUrl)
  }
  cache.delete(url)
}

export function clearTransientAttachments(urls: string[]) {
  urls.forEach(clearTransientAttachment)
}

export function clearTransientAttachmentsFromPrompt(prompt: Prompt) {
  clearTransientAttachments(collectTransientAttachmentUrls(prompt))
}

export async function materializePromptAttachments(prompt: Prompt) {
  const transientUrls = collectTransientAttachmentUrls(prompt)
  const next = await Promise.all(
    prompt.map(async (part) => {
      if (part.type !== "image") return part
      const dataUrl = await materializeAttachmentDataUrl(part)
      if (!dataUrl) return
      return dataUrl === part.dataUrl ? part : { ...part, dataUrl }
    }),
  )
  const prepared = next.filter((part): part is Prompt[number] => !!part)
  if (prepared.length !== prompt.length) return
  return { prompt: prepared, transientUrls }
}
