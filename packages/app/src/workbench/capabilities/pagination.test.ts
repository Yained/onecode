import { describe, expect, test } from "bun:test"
import {
  CAPABILITY_PAGE_SIZE_ONEDATA_LIST,
  CAPABILITY_PAGE_SIZE_RESOURCE,
  CAPABILITY_PAGE_SIZE_SCENARIO,
  clampPage,
  paginate,
  totalPagesFor,
} from "./pagination"

describe("capability pagination", () => {
  test("uses grid-aligned page sizes", () => {
    expect(CAPABILITY_PAGE_SIZE_SCENARIO).toBe(12)
    expect(CAPABILITY_PAGE_SIZE_RESOURCE).toBe(16)
    expect(CAPABILITY_PAGE_SIZE_ONEDATA_LIST).toBe(8)
  })

  test("totalPagesFor covers empty and boundary counts", () => {
    expect(totalPagesFor(0, 12)).toBe(0)
    expect(totalPagesFor(1, 12)).toBe(1)
    expect(totalPagesFor(12, 12)).toBe(1)
    expect(totalPagesFor(13, 12)).toBe(2)
    expect(totalPagesFor(16, 16)).toBe(1)
    expect(totalPagesFor(17, 16)).toBe(2)
  })

  test("clampPage keeps page within range", () => {
    expect(clampPage(0, 3)).toBe(1)
    expect(clampPage(-2, 3)).toBe(1)
    expect(clampPage(2, 3)).toBe(2)
    expect(clampPage(9, 3)).toBe(3)
    expect(clampPage(2, 0)).toBe(1)
    expect(clampPage(1.8, 3)).toBe(1)
  })

  test("paginate slices items by the given page size", () => {
    const items = Array.from({ length: 19 }, (_, index) => index + 1)
    expect(paginate(items, 1, 12)).toEqual({
      pageItems: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      page: 1,
      totalPages: 2,
      total: 19,
      pageSize: 12,
    })
    expect(paginate(items, 2, 12).pageItems).toEqual([13, 14, 15, 16, 17, 18, 19])
    expect(paginate(items, 99, 12).page).toBe(2)

    const dense = Array.from({ length: 20 }, (_, index) => index + 1)
    expect(paginate(dense, 1, 16).pageItems).toHaveLength(16)
    expect(paginate(dense, 2, 16).pageItems).toEqual([17, 18, 19, 20])

    expect(paginate([], 3, 16)).toEqual({
      pageItems: [],
      page: 1,
      totalPages: 0,
      total: 0,
      pageSize: 16,
    })
  })
})
