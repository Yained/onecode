import { describe, expect, test } from "bun:test"
import { attachmentModality, findUnsupportedAttachments, modelSupportsModality } from "./model-attachments"

const pdfModel = {
  capabilities: {
    input: { text: true, image: true, audio: false, video: false, pdf: false },
  },
}

const fullModel = {
  capabilities: {
    input: { text: true, image: true, audio: false, video: false, pdf: true },
  },
}

describe("model-attachments", () => {
  test("maps pdf mime to pdf modality", () => {
    expect(attachmentModality("application/pdf")).toBe("pdf")
  })

  test("detects unsupported pdf attachments", () => {
    const unsupported = findUnsupportedAttachments(pdfModel, [
      { mime: "application/pdf", filename: "paper.pdf" },
    ])
    expect(unsupported).toEqual([{ filename: "paper.pdf", modality: "pdf" }])
  })

  test("allows pdf when model supports it", () => {
    const unsupported = findUnsupportedAttachments(fullModel, [
      { mime: "application/pdf", filename: "paper.pdf" },
    ])
    expect(unsupported).toEqual([])
  })

  test("falls back to modalities.input when capabilities are missing", () => {
    expect(modelSupportsModality({ modalities: { input: ["text", "pdf"] } }, "pdf")).toBe(true)
    expect(modelSupportsModality({ modalities: { input: ["text"] } }, "pdf")).toBe(false)
  })
})
