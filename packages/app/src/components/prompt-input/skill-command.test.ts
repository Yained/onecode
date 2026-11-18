import { describe, expect, test } from "bun:test"
import { resolveSkillCommand } from "./skill-command"

describe("resolveSkillCommand", () => {
  test("uses skill chip when present and registered as command", () => {
    expect(
      resolveSkillCommand({
        text: "请基于该技能继续开发。",
        skills: [{ name: "onescience-coder", title: "代码实现" }],
        commands: [{ name: "onescience-coder" }, { name: "init" }],
      }),
    ).toEqual({
      command: "onescience-coder",
      arguments: "请基于该技能继续开发。",
    })
  })

  test("returns undefined when skill chip is dismissed", () => {
    expect(
      resolveSkillCommand({
        text: "普通提问",
        skills: [],
        commands: [{ name: "onescience-coder" }],
      }),
    ).toBeUndefined()
  })

  test("returns undefined when skill is not a registered command", () => {
    expect(
      resolveSkillCommand({
        text: "继续",
        skills: [{ name: "missing-skill", title: "缺失" }],
        commands: [{ name: "onescience-coder" }],
      }),
    ).toBeUndefined()
  })
})
