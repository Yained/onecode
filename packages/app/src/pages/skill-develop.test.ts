import { describe, expect, test } from "bun:test"
import { skillDevelopHandoff, skillDevelopPrompt } from "./skill-develop"

describe("skillDevelopHandoff", () => {
  test("returns short prompt plus skill chip context for code session handoff", () => {
    const handoff = skillDevelopHandoff({
      id: "onescience-coder",
      title: "代码实现与改造",
      copy: "面向 OneScience 代码库选择最小改造路径。",
      layer: "执行层",
      tags: ["执行层", "coder"],
      provider: "OneSkills",
    })

    expect(handoff.prompt).toBe("请基于 OneSkills 技能「代码实现与改造」进行科研开发。")
    expect(handoff.prompt).not.toContain("Execution Skill:")
    expect(handoff.prompt).not.toContain("Skill ID：")
    expect(handoff.skill).toEqual({
      name: "onescience-coder",
      title: "代码实现与改造",
    })
  })

  test("skillDevelopPrompt stays aligned with handoff short prompt", () => {
    const item = {
      id: "onescience-coder",
      title: "代码实现与改造",
      copy: "面向 OneScience 代码库选择最小改造路径。",
    }
    expect(skillDevelopPrompt(item)).toBe(skillDevelopHandoff(item).prompt)
  })
})
