import { describe, expect, test } from "bun:test"
import type { Prompt } from "@/context/prompt"
import {
  cacheTransientAttachment,
  clearTransientAttachment,
  clearTransientAttachmentsFromPrompt,
  hasTransientAttachment,
  isTransientAttachmentUrl,
  LARGE_ATTACHMENT_THRESHOLD_BYTES,
  materializePromptAttachments,
} from "./attachment-cache"

describe("attachment cache", () => {
  test("uses a 1 MiB threshold for transient attachments", () => {
    expect(LARGE_ATTACHMENT_THRESHOLD_BYTES).toBe(1024 * 1024)
  })

  test("materializes cached attachments only at send time", async () => {
    const url = cacheTransientAttachment(new File(["hello"], "large.txt", { type: "text/plain" }), "text/plain")
    const prompt: Prompt = [
      {
        type: "image",
        id: "attachment-1",
        filename: "large.txt",
        mime: "text/plain",
        dataUrl: url,
        uploadStatus: "ready",
      },
    ]

    const prepared = await materializePromptAttachments(prompt)
    expect(isTransientAttachmentUrl(url)).toBe(true)
    expect(hasTransientAttachment(url)).toBe(true)
    expect(prepared?.transientUrls).toEqual([url])
    const part = prepared?.prompt[0]
    expect(part?.type).toBe("image")
    if (part?.type !== "image") throw new Error("expected image attachment")
    expect(part.dataUrl.startsWith("data:text/plain;base64,")).toBe(true)
    expect(prompt[0]?.type === "image" ? prompt[0].dataUrl : "").toBe(url)

    clearTransientAttachmentsFromPrompt(prompt)
    expect(hasTransientAttachment(url)).toBe(false)
  })

  test("does not materialize when the transient file is gone", async () => {
    const url = cacheTransientAttachment(new File(["hello"], "large.txt", { type: "text/plain" }), "text/plain")
    clearTransientAttachment(url)

    expect(
      await materializePromptAttachments([
        {
          type: "image",
          id: "attachment-1",
          filename: "large.txt",
          mime: "text/plain",
          dataUrl: url,
          uploadStatus: "ready",
        },
      ]),
    ).toBeUndefined()
  })
})
