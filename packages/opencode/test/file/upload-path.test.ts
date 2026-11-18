import { describe, expect, test } from "bun:test"
import { File } from "../../src/file"

describe("File.normalizeUploadRelativePath", () => {
  test("accepts nested relative paths", () => {
    expect(File.normalizeUploadRelativePath("dir_test/a.txt")).toBe("dir_test/a.txt")
    expect(File.normalizeUploadRelativePath("dir_test\\b\\c.bin")).toBe("dir_test/b/c.bin")
    expect(File.normalizeUploadRelativePath("uploads/AI科学训练超节点需求分析.md")).toBe(
      "uploads/AI科学训练超节点需求分析.md",
    )
  })

  test("rejects traversal and absolute paths", () => {
    expect(File.normalizeUploadRelativePath("../secret")).toBeUndefined()
    expect(File.normalizeUploadRelativePath("/etc/passwd")).toBeUndefined()
    expect(File.normalizeUploadRelativePath("C:\\Windows\\system32")).toBeUndefined()
    expect(File.normalizeUploadRelativePath("file:///D:/Documents/众智行动/AI科学训练超节点需求分析.md")).toBeUndefined()
    expect(File.normalizeUploadRelativePath("")).toBeUndefined()
  })
})
