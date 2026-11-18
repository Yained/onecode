import { describe, expect, test } from "bun:test"
import {
  decodePreviewPath,
  encodePreviewPath,
  hasFilePreviewTicketPath,
  parseFilePreviewPath,
} from "../../src/server/shared/file-preview"

describe("file preview paths", () => {
  test("encodes and decodes nested paths", () => {
    const path = "7pzb_figure1a/outputs/sample comparison.html"
    expect(decodePreviewPath(encodePreviewPath(path))).toBe(path)
  })

  test("rejects path traversal segments", () => {
    expect(decodePreviewPath("a/%2e%2e/b")).toBe("a/b")
    expect(decodePreviewPath("../secret")).toBe("secret")
  })

  test("parses ticket preview urls", () => {
    const ticket = "11111111-2222-3333-4444-555555555555"
    const parsed = parseFilePreviewPath(`/file/preview/${ticket}/outputs/chart.html`)
    expect(parsed).toEqual({
      ticket,
      filePath: "outputs/chart.html",
    })
    expect(hasFilePreviewTicketPath("GET", `/file/preview/${ticket}/outputs/chart.html`)).toBe(true)
    expect(hasFilePreviewTicketPath("POST", `/file/preview/${ticket}/outputs/chart.html`)).toBe(false)
    expect(hasFilePreviewTicketPath("GET", "/file/preview/ticket")).toBe(false)
  })
})
