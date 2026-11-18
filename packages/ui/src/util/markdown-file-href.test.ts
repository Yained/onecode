import { describe, expect, test } from "bun:test"
import {
  isWorkspaceFileHref,
  looksLikeFilePathCode,
  normalizeWorkspaceFileHref,
  renderMarkdownFileLink,
} from "./markdown-file-href"

describe("markdown-file-href", () => {
  test("treats relative and absolute paths as workspace files", () => {
    expect(isWorkspaceFileHref("training_config.yaml")).toBe(true)
    expect(isWorkspaceFileHref("outputs/plot.png")).toBe(true)
    expect(isWorkspaceFileHref("/data/zhangjing8_test/training_config.yaml")).toBe(true)
    expect(isWorkspaceFileHref("file:///tmp/a.ts")).toBe(true)
  })

  test("rejects web and fragment hrefs", () => {
    expect(isWorkspaceFileHref("https://example.com")).toBe(false)
    expect(isWorkspaceFileHref("mailto:a@b.com")).toBe(false)
    expect(isWorkspaceFileHref("#section")).toBe(false)
  })

  test("normalizes file urls", () => {
    expect(normalizeWorkspaceFileHref("file:///tmp/a.ts")).toBe("/tmp/a.ts")
    expect(normalizeWorkspaceFileHref("outputs%2Fplot.png")).toBe("outputs/plot.png")
  })

  test("detects file-like code spans", () => {
    expect(looksLikeFilePathCode("training_config.yaml")).toBe("training_config.yaml")
    expect(looksLikeFilePathCode("src/a.ts")).toBe("src/a.ts")
    expect(looksLikeFilePathCode("not a file")).toBe(false)
    expect(looksLikeFilePathCode("https://example.com")).toBe(false)
  })

  test("renders file link markup", () => {
    expect(renderMarkdownFileLink("training_config.yaml", "config")).toContain('class="file-link"')
    expect(renderMarkdownFileLink("training_config.yaml", "config")).toContain('data-file-path="training_config.yaml"')
    expect(renderMarkdownFileLink("training_config.yaml", "config")).not.toContain("target=")
  })
})
