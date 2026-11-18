import { describe, expect, test } from "bun:test"
import {
  collectLocalUploadEntries,
  findUploadSizeLimitError,
  formatUploadBytes,
  normalizeLocalRelativePath,
  ONEDATA_UPLOAD_MAX_FILE_BYTES,
  ONEDATA_UPLOAD_MAX_TOTAL_BYTES,
  sumUploadBytes,
  uploadRootLabel,
} from "./project-upload"

describe("project-upload helpers", () => {
  test("normalizeLocalRelativePath", () => {
    expect(normalizeLocalRelativePath("dir_test/a.txt")).toBe("dir_test/a.txt")
    expect(normalizeLocalRelativePath("../x")).toBeUndefined()
  })

  test("collectLocalUploadEntries uses webkitRelativePath", () => {
    const file = new File(["hello"], "a.txt")
    Object.defineProperty(file, "webkitRelativePath", { value: "dir_test/a.txt" })
    const collected = collectLocalUploadEntries([file])
    expect(collected.entries).toEqual([{ path: "dir_test/a.txt", file, size: 5 }])
    expect(collected.truncated).toBe(false)
    expect(sumUploadBytes(collected.entries)).toBe(5)
    expect(uploadRootLabel(collected.entries)).toBe("dir_test")
  })

  test("formatUploadBytes", () => {
    expect(formatUploadBytes(undefined)).toBe("—")
    expect(formatUploadBytes(0)).toBe("0 B")
    expect(formatUploadBytes(1536)).toBe("1.5 KB")
  })

  test("findUploadSizeLimitError rejects oversized file and total", () => {
    const small = { path: "a.txt", file: new File(["x"], "a.txt"), size: 10 }
    const huge = {
      path: "big.bin",
      file: new File([""], "big.bin"),
      size: ONEDATA_UPLOAD_MAX_FILE_BYTES + 1,
    }
    expect(
      findUploadSizeLimitError([huge], {
        maxFileBytes: ONEDATA_UPLOAD_MAX_FILE_BYTES,
        maxTotalBytes: ONEDATA_UPLOAD_MAX_TOTAL_BYTES,
      }),
    ).toEqual({
      kind: "file",
      path: "big.bin",
      size: huge.size,
      max: ONEDATA_UPLOAD_MAX_FILE_BYTES,
    })
    expect(
      findUploadSizeLimitError(
        [
          { ...small, size: 180 * 1024 * 1024 },
          { ...small, path: "b.txt", size: 180 * 1024 * 1024 },
          { ...small, path: "c.txt", size: 180 * 1024 * 1024 },
        ],
        {
          maxFileBytes: ONEDATA_UPLOAD_MAX_FILE_BYTES,
          maxTotalBytes: ONEDATA_UPLOAD_MAX_TOTAL_BYTES,
        },
      ),
    ).toMatchObject({ kind: "total", max: ONEDATA_UPLOAD_MAX_TOTAL_BYTES })
    expect(
      findUploadSizeLimitError([small], {
        maxFileBytes: ONEDATA_UPLOAD_MAX_FILE_BYTES,
        maxTotalBytes: ONEDATA_UPLOAD_MAX_TOTAL_BYTES,
      }),
    ).toBeUndefined()
  })
})
