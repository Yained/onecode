import { describe, expect, test } from "bun:test"
import { isStaleChunkError } from "./stale-chunk"

describe("isStaleChunkError", () => {
  test("detects failed dynamic import module fetch", () => {
    expect(
      isStaleChunkError(
        new TypeError(
          "Failed to fetch dynamically imported module: http://218.90.133.98:8007/assets/account-system-Cc-g-UA-.js",
        ),
      ),
    ).toBe(true)
  })

  test("ignores unrelated network errors", () => {
    expect(isStaleChunkError(new TypeError("Failed to fetch"))).toBe(false)
    expect(isStaleChunkError(new Error("network timeout"))).toBe(false)
  })
})
