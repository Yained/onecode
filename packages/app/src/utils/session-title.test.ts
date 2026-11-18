import { describe, expect, test } from "bun:test"
import { clipSessionTitle, firstMessageServerTitle, isFirstMessageServerTitle } from "./session-title"

describe("first-message title fallback", () => {
  test("matches the server truncation used when title generation fails", () => {
    const text = "a".repeat(120)
    expect(firstMessageServerTitle(text)).toBe(`${"a".repeat(97)}...`)
    expect(isFirstMessageServerTitle(`${"a".repeat(97)}...`, text)).toBe(true)
    expect(isFirstMessageServerTitle("MACE 训练 smoke 验证", text)).toBe(false)
  })

  test("keeps a short first message as the whole fallback", () => {
    expect(isFirstMessageServerTitle("跑一遍 smoke", "跑一遍 smoke")).toBe(true)
    expect(isFirstMessageServerTitle("New session - 2026-09-18T00:00:00.000Z", "跑一遍 smoke")).toBe(false)
  })
})

describe("clipSessionTitle", () => {
  test("keeps titles up to 40 characters", () => {
    expect(clipSessionTitle("雷达驱动临近预报")).toBe("雷达驱动临近预报")
    expect(clipSessionTitle("储能材料化学研究负责人。请围绕钙离子交换固液锌电池")).toBe(
      "储能材料化学研究负责人。请围绕钙离子交换固液锌电池",
    )
    expect(clipSessionTitle("1234567890123456789012345678901234567890")).toBe(
      "1234567890123456789012345678901234567890",
    )
  })

  test("clips longer titles and keeps a tooltip-sized remainder as ellipsis", () => {
    const long = `${"测".repeat(40)}续写完整标题`
    expect(long.length).toBeGreaterThan(40)
    expect(clipSessionTitle(long)).toBe(`${"测".repeat(40)}...`)
  })
})
