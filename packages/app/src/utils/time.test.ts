import { describe, expect, test } from "bun:test"
import { getRelativeTime, getRelativeTimeFromMillis } from "./time"

const t = (key: string, params?: Record<string, string | number>) => {
  if (key === "common.time.justNow") return "刚刚"
  if (key === "common.time.minutesAgo.short") return `${params?.count}分钟前`
  if (key === "common.time.hoursAgo.short") return `${params?.count}小时前`
  if (key === "common.time.daysAgo.short") return `${params?.count}天前`
  return key
}

describe("relative time formatting", () => {
  test("treats slightly future timestamps as just now", () => {
    const now = 1_700_000_000_000
    expect(getRelativeTimeFromMillis(now + 2_000, t, now)).toBe("刚刚")
  })

  test("formats past timestamps as ago", () => {
    const now = 1_700_000_000_000
    expect(getRelativeTimeFromMillis(now - 120_000, t, now)).toBe("2分钟前")
  })

  test("getRelativeTime keeps past formatting for ISO strings", () => {
    const now = Date.now()
    expect(getRelativeTime(new Date(now - 120_000).toISOString(), t)).toBe("2分钟前")
  })
})
