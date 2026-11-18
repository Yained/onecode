import { describe, expect, test } from "bun:test"
import { availableBytesFromStatfs } from "@/onescience/disk-space"

describe("availableBytesFromStatfs", () => {
  test("multiplies bavail by bsize", () => {
    expect(availableBytesFromStatfs({ bavail: 1000, bsize: 4096 })).toBe(4_096_000)
  })

  test("accepts bigint fields from fs.statfs({ bigint: true })", () => {
    expect(availableBytesFromStatfs({ bavail: 3_250_000_000n, bsize: 4096n })).toBe(3_250_000_000 * 4096)
  })

  test("rejects int32-truncated negative bavail instead of reporting disk full", () => {
    expect(() => availableBytesFromStatfs({ bavail: -1_046_434_592, bsize: 4096 })).toThrow("unreliable disk space")
  })

  test("rejects zero bsize instead of reporting 0 bytes free", () => {
    expect(() => availableBytesFromStatfs({ bavail: 488_475_719, bsize: 0 })).toThrow("unreliable disk space")
  })
})
