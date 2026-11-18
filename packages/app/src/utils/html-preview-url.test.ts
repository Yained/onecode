import { describe, expect, test } from "bun:test"
import { encodePreviewPath, workspaceRelativePath } from "./html-preview-url"

describe("html preview url helpers", () => {
  test("workspaceRelativePath strips project root", () => {
    expect(workspaceRelativePath("/tmp/project", "/tmp/project/outputs/a.html")).toBe("outputs/a.html")
    expect(workspaceRelativePath("/tmp/project", "outputs/a.html")).toBe("outputs/a.html")
  })

  test("encodePreviewPath encodes segments", () => {
    expect(encodePreviewPath("out/a b.html")).toBe("out/a%20b.html")
  })
})
