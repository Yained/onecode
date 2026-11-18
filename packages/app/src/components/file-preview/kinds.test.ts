import { describe, expect, test } from "bun:test"
import { filePreviewKind, hasSourceToggle, isPdfPath, isXyzPath } from "./kinds"

describe("file preview kinds", () => {
  test("detects previewable extensions", () => {
    expect(filePreviewKind("out/plot.html")).toBe("html")
    expect(filePreviewKind("README.md")).toBe("markdown")
    expect(filePreviewKind("data/table.CSV")).toBe("csv")
    expect(filePreviewKind("paper.PDF")).toBe("pdf")
    expect(filePreviewKind("traj.xyz")).toBe("xyz")
    expect(filePreviewKind("train.extxyz")).toBe("xyz")
    expect(filePreviewKind("main.py")).toBe("text")
  })

  test("source toggle availability", () => {
    expect(hasSourceToggle("html")).toBe(true)
    expect(hasSourceToggle("xyz")).toBe(true)
    expect(hasSourceToggle("pdf")).toBe(false)
    expect(isPdfPath("a.pdf")).toBe(true)
    expect(isXyzPath("b.extxyz")).toBe(true)
  })
})
