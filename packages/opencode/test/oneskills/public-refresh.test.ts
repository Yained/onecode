import { describe, expect, test } from "bun:test"
import { msUntilNextShanghaiMidnight } from "@/oneskills/public-refresh"

describe("OneSkillsPublicRefresh", () => {
  test("msUntilNextShanghaiMidnight stays within one day plus jitter", () => {
    const delay = msUntilNextShanghaiMidnight()
    expect(delay).toBeGreaterThan(0)
    expect(delay).toBeLessThanOrEqual(86_400_000 + 30 * 60 * 1000)
  })
})
