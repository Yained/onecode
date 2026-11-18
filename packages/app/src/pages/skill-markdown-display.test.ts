import { describe, expect, test } from "bun:test"
import {
  formatSkillFrontmatterScalar,
  skillFrontmatterEntries,
  skillFrontmatterHasContent,
  skillFrontmatterLabel,
  skillFrontmatterListItems,
} from "./skill-markdown-display"

describe("skill markdown display", () => {
  test("orders and labels common frontmatter fields", () => {
    const entries = skillFrontmatterEntries({
      references: ["workers", "pages"],
      description: "Workflow entry skill",
      name: "onescience-workflow",
      custom: "value",
    })

    expect(entries.map(([key]) => key)).toEqual(["name", "description", "references", "custom"])
    expect(skillFrontmatterLabel("description")).toBe("描述")
    expect(skillFrontmatterLabel("custom")).toBe("custom")
  })

  test("formats scalar and list frontmatter values", () => {
    expect(formatSkillFrontmatterScalar("line one\nline two")).toBe("line one\nline two")
    expect(formatSkillFrontmatterScalar(true)).toBe("是")
    expect(skillFrontmatterListItems(["a", "b"])).toEqual(["a", "b"])
    expect(skillFrontmatterHasContent({ name: "demo" })).toBe(true)
    expect(skillFrontmatterHasContent({})).toBe(false)
  })
})
