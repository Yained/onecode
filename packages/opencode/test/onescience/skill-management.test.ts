import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, rmSync } from "fs"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { OneScienceSkill } from "@/onescience/skill"
import { parseGitHubSkillSource, parseGitSkillSource } from "@/util/repository"
import { OneScienceSkillManagement } from "@/onescience/skill-management"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await resetDatabase()
})

describe("OneScienceSkillManagement", () => {
  const prevExtra = process.env.ONECODE_EXTRA_PATH

  afterEach(() => {
    if (prevExtra === undefined) delete process.env.ONECODE_EXTRA_PATH
    else process.env.ONECODE_EXTRA_PATH = prevExtra
  })

  test("parses GitHub skill source URLs", () => {
    expect(parseGitHubSkillSource("https://github.com/obra/superpowers/tree/main/skills")).toEqual({
      host: "github.com",
      owner: "obra",
      repo: "superpowers",
      branch: "main",
      subpath: "skills",
    })
    expect(parseGitHubSkillSource("https://github.com/obra/superpowers")).toEqual({
      host: "github.com",
      owner: "obra",
      repo: "superpowers",
      branch: "main",
      subpath: "",
    })
  })

  test("resolves skill root from nested skills directory", () => {
    const repo = path.join(process.cwd(), ".test-skill-root")
    mkdirSync(path.join(repo, "skills", "brainstorming"), { recursive: true })
    Bun.write(path.join(repo, "skills", "brainstorming", "SKILL.md"), "---\nname: brainstorming\n---\n")

    try {
      expect(OneScienceSkillManagement.resolveSkillRootFromClone(repo, "")).toBe(path.join(repo, "skills"))
      expect(OneScienceSkillManagement.hasDiscoverableSkills(path.join(repo, "skills"))).toBe(true)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  test("parses Gitee skill source URLs", () => {
    expect(parseGitSkillSource("https://gitee.com/onescience-ai/oneskills/tree/master/skills")).toEqual({
      host: "gitee.com",
      owner: "onescience-ai",
      repo: "oneskills",
      branch: "master",
      subpath: "skills",
    })
  })

  test("detects legacy GitHub repo manifest entries that need repair", () => {
    expect(
      OneScienceSkillManagement.skillRepoEntriesNeedRepair([
        {
          id: "repo-test",
          title: "superpowers",
          url: "https://github.com/obra/superpowers/",
          scope: "global",
          timeCreated: Date.now(),
        },
      ]),
    ).toBe(true)
    expect(
      OneScienceSkillManagement.skillRepoEntriesNeedRepair([
        {
          id: "repo-test",
          title: "superpowers",
          url: "https://github.com/obra/superpowers/",
          scope: "global",
          kind: "git",
          localPath: "/tmp/superpowers/skills",
          timeCreated: Date.now(),
        },
      ]),
    ).toBe(false)
  })

  test("lists configured repos without git sync", async () => {
    await using tmp = await tmpdir()
    const repo = await OneScienceSkillManagement.addRepo(tmp.path, {
      title: "Demo Skills",
      url: "https://example.com/.well-known/skills/",
      scope: "project",
    })

    const listed = await OneScienceSkillManagement.listReposFast(tmp.path)
    expect(listed.map((item) => item.id)).toContain(repo.id)
  })

  test("removeRepo clears skills.paths for git repos even without localPath", async () => {
    await using tmp = await tmpdir()
    const skillRoot = path.join(Global.Path.repos, "github.com", "obra", "superpowers", "skills")
    const opencodeDir = path.join(tmp.path, ".opencode")
    mkdirSync(opencodeDir, { recursive: true })
    await Bun.write(
      path.join(opencodeDir, "onescience-skill-repos.json"),
      JSON.stringify({
        items: [
          {
            id: "repo-orphan-superpowers",
            title: "superpowers",
            url: "https://github.com/obra/superpowers/tree/main/skills",
            scope: "project",
            kind: "git",
            timeCreated: Date.now(),
          },
        ],
      }),
    )
    await Bun.write(
      path.join(opencodeDir, "opencode.json"),
      JSON.stringify({
        skills: {
          urls: [],
          paths: [skillRoot, path.join(tmp.path, "keep-me")],
        },
      }),
    )

    await OneScienceSkillManagement.removeRepo(tmp.path, "repo-orphan-superpowers")

    const config = (await Bun.file(path.join(opencodeDir, "opencode.json")).json()) as {
      skills?: { paths?: string[] }
    }
    expect(config.skills?.paths).toEqual([path.join(tmp.path, "keep-me")])
  })

  test("adds repo config and uploads a project skill", async () => {
    await using tmp = await tmpdir()
    const repo = await OneScienceSkillManagement.addRepo(tmp.path, {
      title: "Demo Skills",
      url: "https://example.com/.well-known/skills/",
      scope: "project",
    })

    expect(repo.title).toBe("Demo Skills")
    expect(repo.scope).toBe("project")

    const listed = await OneScienceSkillManagement.listRepos(tmp.path)
    expect(listed.items.map((item) => item.id)).toContain(repo.id)

    const config = await Bun.file(path.join(tmp.path, ".opencode", "opencode.json")).json() as { skills?: { urls?: string[] } }
    expect(config.skills?.urls).toContain("https://example.com/.well-known/skills/")

    const uploaded = await OneScienceSkillManagement.uploadSkill(tmp.path, {
      name: "demo-skill",
      description: "A demo user skill",
      scope: "project",
      skillBody: "## Usage\n\nRun the demo.",
      tags: ["demo", "custom"],
    })

    expect(uploaded.name).toBe("demo-skill")
    expect(existsSync(path.join(tmp.path, ".opencode", "skills", "demo-skill", "SKILL.md"))).toBe(true)
    expect(OneScienceSkill.list().items.map((item) => item.id)).toContain("custom-skill-demo-skill")

    await OneScienceSkillManagement.removeRepo(tmp.path, repo.id)
    const afterRemove = await OneScienceSkillManagement.listRepos(tmp.path)
    expect(afterRemove.items.some((item) => item.id === repo.id)).toBe(false)
  })

  test("rejects over-long skill name or description on upload", async () => {
    await using tmp = await tmpdir()
    await expect(
      OneScienceSkillManagement.uploadSkill(tmp.path, {
        name: "a".repeat(OneScienceSkillManagement.SKILL_NAME_MAX + 1),
        description: "ok",
        scope: "project",
        skillBody: "## Usage",
      }),
    ).rejects.toThrow(`技能标识最多 ${OneScienceSkillManagement.SKILL_NAME_MAX} 个字符`)

    await expect(
      OneScienceSkillManagement.uploadSkill(tmp.path, {
        name: "ok-skill",
        description: "字".repeat(OneScienceSkillManagement.SKILL_DESCRIPTION_MAX + 1),
        scope: "project",
        skillBody: "## Usage",
      }),
    ).rejects.toThrow(`技能描述最多 ${OneScienceSkillManagement.SKILL_DESCRIPTION_MAX} 个字符`)
  })

  test("uploads a global skill into home opencode directory", async () => {
    await using tmp = await tmpdir()
    const homeOpencode = path.join(Global.Path.home, ".opencode")
    const skillDir = path.join(homeOpencode, "skills", "global-demo-skill")
    const skillFile = path.join(skillDir, "SKILL.md")

    if (existsSync(skillDir)) rmSync(skillDir, { recursive: true, force: true })

    const uploaded = await OneScienceSkillManagement.uploadSkill(tmp.path, {
      name: "global-demo-skill",
      description: "Global scope demo",
      scope: "global",
      skillBody: "## Usage\n\nGlobal demo skill.",
    })

    expect(uploaded.scope).toBe("global")
    expect(existsSync(skillFile)).toBe(true)

    if (existsSync(skillDir)) rmSync(skillDir, { recursive: true, force: true })
  })

  test("deletes an uploaded project skill", async () => {
    await using tmp = await tmpdir()
    const uploaded = await OneScienceSkillManagement.uploadSkill(tmp.path, {
      name: "delete-me",
      description: "Temporary skill",
      scope: "project",
      skillBody: "## Usage\n\nTemporary skill.",
    })

    expect(existsSync(path.join(uploaded.path, "SKILL.md"))).toBe(true)

    const deleted = await OneScienceSkillManagement.deleteSkill(tmp.path, {
      name: "delete-me",
      scope: "project",
    })

    expect(deleted.name).toBe("delete-me")
    expect(existsSync(path.join(uploaded.path, "SKILL.md"))).toBe(false)
    expect(OneScienceSkill.list().items.some((item) => item.id === "custom-skill-delete-me")).toBe(false)
  })

  test("uploads project skill into shadow storage when project directory is read-only", async () => {
    await using tmp = await tmpdir()
    const extra = path.join(tmp.path, "extra")
    const project = path.join(extra, "case")
    mkdirSync(project, { recursive: true })
    chmodSync(project, 0o555)
    process.env.ONECODE_EXTRA_PATH = extra

    try {
      const uploaded = await OneScienceSkillManagement.uploadSkill(project, {
        name: "shadow-skill",
        description: "Shadow scope demo",
        scope: "project",
        skillBody: "## Usage\n\nShadow skill.",
      })

      expect(uploaded.path).toContain(path.join("projects", "case", ".opencode", "skills", "shadow-skill"))
      expect(existsSync(path.join(uploaded.path, "SKILL.md"))).toBe(true)

      const sharedConfig = path.join(extra, ".config", "opencode", "opencode.json")
      const config = await Bun.file(sharedConfig).json() as { skills?: { paths?: string[] } }
      expect(config.skills?.paths?.some((item) => item.includes("projects/case/.opencode/skills"))).toBe(true)
    } finally {
      chmodSync(project, 0o755)
    }
  })

  test("uploads skill assets from zip, tar, and tar.gz archives", async () => {
    await using tmp = await tmpdir()
    const source = path.join(tmp.path, "source")
    mkdirSync(path.join(source, "references"), { recursive: true })
    mkdirSync(path.join(source, "assets"), { recursive: true })
    await Bun.write(path.join(source, "references", "guide.md"), "# Guide\n")
    await Bun.write(path.join(source, "assets", "template.json"), '{"kind":"demo"}\n')

    const cases = [
      { archiveName: "assets.zip", skillName: "zip-skill", omitArchiveName: true },
      { archiveName: "assets.tar", skillName: "tar-skill", omitArchiveName: false },
      { archiveName: "assets.tar.gz", skillName: "targz-skill", omitArchiveName: false },
    ] as const

    for (const item of cases) {
      const archivePath = path.join(tmp.path, item.archiveName)
      if (item.archiveName.endsWith(".zip")) {
        const proc = Bun.spawn(["zip", "-qr", archivePath, "references", "assets"], { cwd: source })
        expect(await proc.exited).toBe(0)
      } else {
        const gzip = item.archiveName.endsWith(".gz")
        const proc = Bun.spawn(
          gzip
            ? ["tar", "-czf", archivePath, "-C", source, "references", "assets"]
            : ["tar", "-cf", archivePath, "-C", source, "references", "assets"],
        )
        expect(await proc.exited).toBe(0)
      }

      const uploaded = await OneScienceSkillManagement.uploadSkill(tmp.path, {
        name: item.skillName,
        description: `Upload with ${item.archiveName}`,
        scope: "project",
        skillBody: "## Usage\n\nArchive upload demo.",
        assetsArchiveBase64: Buffer.from(await Bun.file(archivePath).arrayBuffer()).toString("base64"),
        ...(item.omitArchiveName ? {} : { assetsArchiveName: item.archiveName }),
      })

      expect(existsSync(path.join(uploaded.path, "references", "guide.md"))).toBe(true)
      expect(existsSync(path.join(uploaded.path, "assets", "template.json"))).toBe(true)
    }
  })
})
