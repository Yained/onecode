import { describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"

describe("Identifier.ascending", () => {
  test("stays monotonic when the wall clock steps backward", () => {
    const first = Identifier.ascending("message")
    const second = Identifier.create("msg", "ascending", Date.now() - 60_000)
    expect(second > first).toBe(true)
  })
})
