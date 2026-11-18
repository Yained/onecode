import { beforeAll, describe, expect, mock, test } from "bun:test"
import type { ImageAttachmentPart } from "@/context/prompt"
import { cacheTransientAttachment, clearTransientAttachment } from "@/components/prompt-input/attachment-cache"

let isAttachmentReady: typeof import("@/context/prompt").isAttachmentReady
let isAttachmentUploading: typeof import("@/context/prompt").isAttachmentUploading

beforeAll(async () => {
  mock.module("@/hooks/use-route-params", () => ({
    useRouteParams: () => ({}),
  }))

  const mod = await import("@/context/prompt")
  isAttachmentReady = mod.isAttachmentReady
  isAttachmentUploading = mod.isAttachmentUploading
})

const part = (value: Partial<ImageAttachmentPart>): ImageAttachmentPart => ({
  type: "image",
  id: "attachment-1",
  filename: "paper.pdf",
  mime: "application/pdf",
  dataUrl: "",
  ...value,
})

describe("attachment readiness", () => {
  test("treats uploading attachments without data as in progress", () => {
    const attachment = part({ uploadStatus: "uploading", uploadProgress: 40 })
    expect(isAttachmentUploading(attachment)).toBe(true)
    expect(isAttachmentReady(attachment)).toBe(false)
  })

  test("treats attachments with dataUrl as ready even if status lags", () => {
    const attachment = part({ uploadStatus: "uploading", dataUrl: "data:application/pdf;base64,abc" })
    expect(isAttachmentUploading(attachment)).toBe(false)
    expect(isAttachmentReady(attachment)).toBe(true)
  })

  test("marks explicit ready attachments as sendable", () => {
    const attachment = part({ uploadStatus: "ready", dataUrl: "data:application/pdf;base64,abc" })
    expect(isAttachmentUploading(attachment)).toBe(false)
    expect(isAttachmentReady(attachment)).toBe(true)
  })

  test("treats cached transient attachments as ready", () => {
    const dataUrl = cacheTransientAttachment(new File(["hello"], "large.txt", { type: "text/plain" }), "text/plain")
    const attachment = part({ uploadStatus: "ready", dataUrl })

    expect(isAttachmentReady(attachment)).toBe(true)
    clearTransientAttachment(dataUrl)
  })

  test("does not treat missing transient attachments as ready", () => {
    const dataUrl = cacheTransientAttachment(new File(["hello"], "large.txt", { type: "text/plain" }), "text/plain")
    clearTransientAttachment(dataUrl)

    const attachment = part({ uploadStatus: "ready", dataUrl })
    expect(isAttachmentReady(attachment)).toBe(false)
  })
})
