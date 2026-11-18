import { describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import * as PlatformAuth from "../../src/platform-auth/platform-auth"
import { skillOverrideRank, SkillOverrideRank } from "../../src/skill/override-rank"

describe("skillOverrideRank", () => {
  const home = "/home/test-user"
  const project = "/tmp/opencode-project"
  const ctx = { directory: project, worktree: project }

  const withHome = (run: () => void) => {
    const prev = process.env.OPENCODE_TEST_HOME
    const prevHome = process.env.HOME
    process.env.OPENCODE_TEST_HOME = home
    process.env.HOME = home
    try {
      run()
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_TEST_HOME
      else process.env.OPENCODE_TEST_HOME = prev
      if (prevHome === undefined) delete process.env.HOME
      else process.env.HOME = prevHome
    }
  }

  test("ranks global user skills above prefab and repo cache", () => {
    withHome(() => {
      expect(
        skillOverrideRank(path.join(home, ".opencode", "oneskills", "skills", "demo", "SKILL.md"), ctx),
      ).toBe(SkillOverrideRank.prefab)
      expect(
        skillOverrideRank(path.join(Global.Path.repos, "gitee.com", "onescience-ai", "oneskills", "skills", "demo", "SKILL.md"), ctx),
      ).toBe(SkillOverrideRank.repo)
      expect(
        skillOverrideRank(path.join(home, ".opencode", "skills", "demo", "SKILL.md"), ctx),
      ).toBe(SkillOverrideRank.global)
      expect(
        skillOverrideRank(path.join(Global.Path.config, "skills", "demo", "SKILL.md"), ctx),
      ).toBe(SkillOverrideRank.global)
    })
  })

  test("does not rank account oneskills above the shared install", () => {
    withHome(() => {
      const accountSkill = path.join(PlatformAuth.accountOneskillsRoot("acct-1"), "skills", "demo", "SKILL.md")
      const sharedSkill = path.join(home, ".opencode", "oneskills", "skills", "demo", "SKILL.md")
      expect(skillOverrideRank(accountSkill, ctx)).toBe(SkillOverrideRank.prefab)
      expect(skillOverrideRank(accountSkill, ctx)).toBe(skillOverrideRank(sharedSkill, ctx))
    })
  })

  test("ranks project user skills highest", () => {
    withHome(() => {
      expect(
        skillOverrideRank(path.join(project, ".opencode", "skills", "demo", "SKILL.md"), ctx),
      ).toBe(SkillOverrideRank.project)
      expect(
        skillOverrideRank(path.join(project, ".opencode", "skill", "demo", "SKILL.md"), ctx),
      ).toBe(SkillOverrideRank.project)
    })
  })

  test("treats project-local opencode as project scope when home matches project", () => {
    withHome(() => {
      const same = { directory: project, worktree: project }
      expect(
        skillOverrideRank(path.join(project, ".opencode", "skills", "demo", "SKILL.md"), same),
      ).toBe(SkillOverrideRank.project)
    })
  })
})
