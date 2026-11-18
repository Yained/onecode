import { describe, expect, test } from "bun:test"
import { readFileDataUrl } from "./attachment-upload"

describe("readFileDataUrl", () => {
  test("returns a data url for text files", async () => {
    const file = new File(["hello"], "note.txt", { type: "text/plain" })
    const url = await readFileDataUrl(file, "text/plain")
    expect(url.startsWith("data:text/plain;base64,")).toBe(true)
  })

  test("reports progress while reading", async () => {
    const file = new File([new Uint8Array(64 * 1024)], "large.bin", { type: "application/octet-stream" })
    const progress: number[] = []
    await readFileDataUrl(file, "application/octet-stream", (value) => progress.push(value))
    expect(progress.at(-1)).toBe(100)
  })
})
