import { describe, expect, test } from "bun:test"

describe("useFilteredList highlight", () => {
  test("keeps the current active row when the grouped list grows", async () => {
    const source = await Bun.file(new URL("./use-filtered-list.tsx", import.meta.url)).text()
    expect(source).toContain("if (all.length === 0) return")
    expect(source).toContain("if (!current) return")
    expect(source).toContain("if (all.some((item) => props.key(item) === current)) return")
    expect(source).toContain("reset()")
  })
})

describe("list hover highlight", () => {
  test("follows the pointer with mouseenter and does not clear on mouseleave", async () => {
    const source = await Bun.file(new URL("../components/list.tsx", import.meta.url)).text()
    expect(source).toContain("onMouseEnter={() => {")
    expect(source).toContain("setActive(props.key(item))")
    expect(source).not.toContain("onMouseLeave={() => {")
  })
})
