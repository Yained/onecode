import { describe, expect, test } from "bun:test"
import {
  formatOneSkillsUpgradeError,
  gitRepoHostLabel,
  sanitizeApiErrorMessage,
  SKILL_DESCRIPTION_MAX,
  SKILL_NAME_MAX,
  validateUploadSkillFields,
} from "./onescience-skill-management"

describe("gitRepoHostLabel", () => {
  test("labels GitHub and Gitee hosts", () => {
    expect(gitRepoHostLabel("https://github.com/obra/superpowers/tree/main/skills")).toBe("GitHub")
    expect(gitRepoHostLabel("https://gitee.com/onescience-ai/oneskills/tree/master/skills")).toBe("Gitee")
    expect(gitRepoHostLabel("https://example.com/skills/index.json")).toBe("Git")
  })
})

describe("validateUploadSkillFields", () => {
  test("accepts valid name and description within limits", () => {
    expect(validateUploadSkillFields("my-skill", "Use when preparing demo data")).toBeUndefined()
  })

  test("rejects empty, invalid format, and over-length fields", () => {
    expect(validateUploadSkillFields("", "desc")).toBe("请填写技能标识、描述和 SKILL 正文")
    expect(validateUploadSkillFields("Bad_Name", "desc")).toBe(
      "技能标识需为小写字母、数字和连字符，且以字母或数字开头",
    )
    expect(validateUploadSkillFields("a".repeat(SKILL_NAME_MAX + 1), "desc")).toBe(
      `技能标识最多 ${SKILL_NAME_MAX} 个字符`,
    )
    expect(validateUploadSkillFields("ok-skill", "字".repeat(SKILL_DESCRIPTION_MAX + 1))).toBe(
      `技能描述最多 ${SKILL_DESCRIPTION_MAX} 个字符`,
    )
  })
})

describe("sanitizeApiErrorMessage", () => {
  test("replaces HTML gateway bodies with the fallback", () => {
    expect(
      sanitizeApiErrorMessage(
        "<!DOCTYPE html><html><body><h1>502 Bad Gateway</h1></body></html>",
        "更新 OneSkills 失败",
      ),
    ).toBe("更新 OneSkills 失败")
    expect(sanitizeApiErrorMessage("<html><head></head><body>error</body></html>", "fallback")).toBe("fallback")
  })

  test("keeps concise plain-text API messages", () => {
    expect(sanitizeApiErrorMessage("无法下载 OneSkills 发布包（HTTP 404）", "fallback")).toBe(
      "无法下载 OneSkills 发布包（HTTP 404）",
    )
  })
})

describe("formatOneSkillsUpgradeError", () => {
  test("keeps the in-progress message and hides other failures", () => {
    expect(formatOneSkillsUpgradeError("OneSkills 正在更新中，请稍后再试")).toBe("OneSkills 正在更新中，请稍后再试")
    expect(formatOneSkillsUpgradeError("<html>502</html>")).toBe("更新失败，建议手动更新")
    expect(formatOneSkillsUpgradeError("Failed to download OneSkills release (404 Not Found)")).toBe(
      "更新失败，建议手动更新",
    )
    expect(formatOneSkillsUpgradeError("The operation was aborted")).toBe("更新失败，建议手动更新")
  })
})
