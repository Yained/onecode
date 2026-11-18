import { describe, expect, test } from "bun:test"
import { lockoutMs } from "./onescience-preset"

describe("lockoutMs", () => {
  test("grows with failures and caps at one hour", () => {
    expect(lockoutMs(1)).toBe(0)
    expect(lockoutMs(2)).toBe(5_000)
    expect(lockoutMs(3)).toBe(15_000)
    expect(lockoutMs(4)).toBe(30_000)
    expect(lockoutMs(5)).toBe(60_000)
    expect(lockoutMs(6)).toBe(5 * 60_000)
    expect(lockoutMs(7)).toBe(15 * 60_000)
    expect(lockoutMs(8)).toBe(60 * 60_000)
    expect(lockoutMs(20)).toBe(60 * 60_000)
  })
})
