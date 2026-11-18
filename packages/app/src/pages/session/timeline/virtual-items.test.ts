import { describe, expect, test } from "bun:test"
import { filterVirtualIndexes } from "./virtual-items"

describe("filterVirtualIndexes", () => {
  test("drops out-of-range indexes", () => {
    expect(filterVirtualIndexes([-1, 0, 1, 5, 9], 5)).toEqual([0, 1])
  })
})
