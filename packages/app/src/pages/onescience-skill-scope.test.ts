import { describe, expect, test } from "bun:test"
import { splitSkillScopes, canDeleteUserSkill, listUserUploadedSkills } from "./onescience-skill-scope"
import type { SkillRepoConfig } from "./onescience-skill-management"

describe("splitSkillScopes", () => {
  const projectRoot = "/data/zhangjing8"
  const globalRoot = "/home/user"
  const pathInfo = { project_data_root: "/data" }

  test("puts project-scoped git repo skills in project column", () => {
    const repoPath = "/home/user/.local/share/opencode/repos/gitee.com/onescience-ai/oneskills/skills"
    const repos: SkillRepoConfig[] = [
      {
        id: "repo-1",
        title: "OneSkills",
        url: "https://gitee.com/onescience-ai/oneskills/tree/master/skills",
        scope: "project",
        kind: "git",
        localPath: repoPath,
        timeCreated: 1,
      },
    ]
    const items = [
      {
        name: "onescience-workflow",
        description: "workflow",
        location: `${repoPath}/onescience-workflow/SKILL.md`,
      },
    ]

    const scoped = splitSkillScopes(items, projectRoot, globalRoot, pathInfo, repos)
    expect(scoped.project.map((item) => item.name)).toEqual(["onescience-workflow"])
    expect(scoped.global).toEqual([])
  })

  test("shows prefab oneskills as project skills when project oneskills repo is configured", () => {
    const repos: SkillRepoConfig[] = [
      {
        id: "repo-1",
        title: "OneSkills",
        url: "https://gitee.com/onescience-ai/oneskills/tree/master/skills",
        scope: "project",
        kind: "git",
        localPath: "/home/user/.local/share/opencode/repos/gitee.com/onescience-ai/oneskills/skills",
        timeCreated: 1,
      },
    ]
    const items = [
      {
        name: "onescience-workflow",
        description: "prefab",
        location: "/home/user/.opencode/oneskills/skills/onescience-workflow/SKILL.md",
      },
    ]

    const scoped = splitSkillScopes(items, projectRoot, globalRoot, pathInfo, repos)
    expect(scoped.project.map((item) => item.name)).toEqual(["onescience-workflow"])
    expect(scoped.global).toEqual([])
  })

  test("shows global git repo cache skills in global column", () => {
    const repos: SkillRepoConfig[] = [
      {
        id: "repo-superpowers",
        title: "superpowers",
        url: "https://github.com/obra/superpowers/tree/main/skills",
        scope: "global",
        kind: "git",
        timeCreated: 1,
      },
    ]
    const items = [
      {
        name: "brainstorming",
        description: "brainstorm",
        location: "/home/user/.local/share/opencode/repos/github.com/obra/superpowers/skills/brainstorming/SKILL.md",
      },
    ]

    const scoped = splitSkillScopes(items, projectRoot, globalRoot, pathInfo, repos)
    expect(scoped.global.map((item) => item.name)).toEqual(["brainstorming"])
    expect(scoped.project).toEqual([])
  })

  test("keeps prefab oneskills in global column when project repo is removed", () => {
    const items = [
      {
        name: "onescience-workflow",
        description: "prefab",
        location: "/home/user/.opencode/oneskills/skills/onescience-workflow/SKILL.md",
      },
    ]

    const scoped = splitSkillScopes(items, projectRoot, globalRoot, pathInfo, [])
    expect(scoped.project).toEqual([])
    expect(scoped.global.map((item) => item.name)).toEqual(["onescience-workflow"])
  })
})

describe("canDeleteUserSkill / listUserUploadedSkills", () => {
  const projectRoot = "/data/zhangjing8"
  const globalRoot = "/home/user"
  const pathInfo = { onecode_extra_path: "/data/extra", project_data_root: "/data" }

  test("allows deleting home and account uploaded skills", () => {
    expect(
      canDeleteUserSkill(
        { name: "demo", location: "/home/user/.opencode/skills/demo/SKILL.md" },
        "global",
        projectRoot,
        globalRoot,
        pathInfo,
      ),
    ).toBe(true)
    expect(
      canDeleteUserSkill(
        {
          name: "test",
          location: "/data/extra/accounts/acc-1/skills/test/SKILL.md",
        },
        "global",
        projectRoot,
        undefined,
        pathInfo,
      ),
    ).toBe(true)
    expect(
      canDeleteUserSkill(
        { name: "local", location: "/data/zhangjing8/.opencode/skills/local/SKILL.md" },
        "project",
        projectRoot,
        globalRoot,
        pathInfo,
      ),
    ).toBe(true)
  })

  test("blocks built-in, prefab, and official-prefixed skills", () => {
    expect(
      canDeleteUserSkill(
        { name: "built", location: "<built-in>" },
        "global",
        projectRoot,
        globalRoot,
        pathInfo,
      ),
    ).toBe(false)
    expect(
      canDeleteUserSkill(
        {
          name: "onescience-workflow",
          location: "/home/user/.opencode/oneskills/skills/onescience-workflow/SKILL.md",
        },
        "global",
        projectRoot,
        globalRoot,
        pathInfo,
      ),
    ).toBe(false)
    expect(
      canDeleteUserSkill(
        {
          name: "onescience-demo",
          location: "/home/user/.opencode/skills/onescience-demo/SKILL.md",
        },
        "global",
        projectRoot,
        globalRoot,
        pathInfo,
      ),
    ).toBe(false)
  })

  test("lists only uploaded skills for the upload tab", () => {
    const items = [
      { name: "test", description: "测试", location: "/data/extra/accounts/acc-1/skills/test/SKILL.md" },
      {
        name: "onescience-workflow",
        description: "prefab",
        location: "/home/user/.opencode/oneskills/skills/onescience-workflow/SKILL.md",
      },
      { name: "local", description: "项目", location: "/data/zhangjing8/.opencode/skills/local/SKILL.md" },
      { name: "built", description: "内置", location: "<built-in>" },
    ]

    expect(listUserUploadedSkills(items, projectRoot, globalRoot, pathInfo)).toEqual([
      {
        name: "local",
        description: "项目",
        location: "/data/zhangjing8/.opencode/skills/local/SKILL.md",
        scope: "project",
      },
      {
        name: "test",
        description: "测试",
        location: "/data/extra/accounts/acc-1/skills/test/SKILL.md",
        scope: "global",
      },
    ])
  })
})
