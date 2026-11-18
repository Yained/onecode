import { describe, expect, test } from "bun:test"
import { OneScienceReadme } from "@/onescience/readme"

describe("OneScience readme fetch", () => {
  test("converts gitee tree urls to raw README paths", () => {
    expect(
      OneScienceReadme.readmeRawUrl("https://gitee.com/onescience-ai/onescience/tree/main/examples/earth/graphcast"),
    ).toBe("https://gitee.com/onescience-ai/onescience/raw/main/examples/earth/graphcast/README.md")
  })

  test("converts gitee blob README urls to raw paths", () => {
    expect(
      OneScienceReadme.readmeRawUrl(
        "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/alphafold/README.md",
      ),
    ).toBe("https://gitee.com/onescience-ai/onescience/raw/main/examples/biosciences/alphafold/README.md")
  })

  test("converts github tree urls to raw README paths", () => {
    expect(
      OneScienceReadme.readmeRawUrl("https://github.com/Cuiyingzhe/WenHai/tree/main/src"),
    ).toBe("https://raw.githubusercontent.com/Cuiyingzhe/WenHai/main/src/README.md")
  })

  test("returns undefined for unsupported urls", () => {
    expect(OneScienceReadme.readmeRawUrl("https://deepmind.google/research/publications/gencast/")).toBeUndefined()
  })
})
