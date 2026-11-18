import { describe, expect, test } from "bun:test"
import { fuzzyMatchParts, fuzzyMatchText } from "./fuzzy-match"

describe("fuzzyMatchText", () => {
  test("empty query matches anything", () => {
    expect(fuzzyMatchText("anything", "")).toBe(true)
    expect(fuzzyMatchText("anything", "   ")).toBe(true)
  })

  test("still accepts contiguous substrings", () => {
    expect(fuzzyMatchText("TEM-1β-内酰胺酶深度突变效应排序", "TEM")).toBe(true)
    expect(fuzzyMatchText("GraphCast weather model", "graphcast")).toBe(true)
  })

  test("allows non-contiguous character hits in order", () => {
    expect(fuzzyMatchText("深度突变效应排序", "突效")).toBe(true)
    expect(fuzzyMatchText("一维语言与三维扩散融合的分子生成", "一三维")).toBe(true)
    expect(fuzzyMatchText("深度突变效应排序", "效突")).toBe(false)
  })

  test("splits whitespace into AND tokens", () => {
    expect(fuzzyMatchText("Best-of-K 对齐的靶标特异性三维分子生成", "三维 分子")).toBe(true)
    expect(fuzzyMatchText("Best-of-K 对齐的靶标特异性三维分子生成", "三维 不存在")).toBe(false)
  })

  test("fuzzyMatchParts joins fields before matching", () => {
    expect(fuzzyMatchParts(["GraphCast", "天气集合预报", "weather"], "graph 天气")).toBe(true)
    expect(fuzzyMatchParts(["GraphCast", "天气集合预报"], "fluid")).toBe(false)
  })
})
