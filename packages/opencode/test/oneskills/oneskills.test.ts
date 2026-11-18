import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs"
import { Global } from "@opencode-ai/core/global"
import { OneSkills } from "@/oneskills/index"
import { OneSkillsManifest } from "@/oneskills/manifest"
import { Catalog } from "@/catalog/index"
import { resetDatabase } from "../fixture/db"

describe("OneSkills", () => {
  const prevExtra = process.env.ONECODE_EXTRA_PATH
  const prevClient = process.env.OPENCODE_CLIENT

  afterEach(() => {
    if (prevExtra === undefined) delete process.env.ONECODE_EXTRA_PATH
    else process.env.ONECODE_EXTRA_PATH = prevExtra
    if (prevClient === undefined) delete process.env.OPENCODE_CLIENT
    else process.env.OPENCODE_CLIENT = prevClient
  })

  test("uses global oneskills layout under ~/.opencode/oneskills", () => {
    delete process.env.OPENCODE_CLIENT
    expect(OneSkills.NAMESPACE_ROOT).toBe(".opencode/oneskills")
    expect(OneSkills.root()).toContain(path.join(".opencode", "oneskills"))
    expect(OneSkills.skillsDir()).toContain(path.join("oneskills", "skills"))
    expect(OneSkills.manifestFile()).toContain(path.join("oneskills", "catalog", "manifest.json"))
  })

  test("desktop uses ~/.agents/oneskills install root and scans ~/.agents skills", () => {
    delete process.env.ONECODE_EXTRA_PATH
    process.env.OPENCODE_CLIENT = "desktop"
    expect(OneSkills.namespaceRoot()).toBe(".agents/oneskills")
    expect(OneSkills.root()).toBe(path.join(Global.Path.home, ".agents", "oneskills"))
    expect(OneSkills.globalSkillScanTargets()).toEqual([
      { root: path.join(Global.Path.home, ".agents", "oneskills"), patterns: ["skills/*/SKILL.md"] },
      { root: path.join(Global.Path.home, ".agents", "skills"), patterns: ["*/SKILL.md"] },
      {
        root: path.join(Global.Path.home, ".opencode"),
        patterns: ["oneskills/skills/*/SKILL.md", "{skill,skills}/*/SKILL.md", "skill/*/SKILL.md"],
      },
    ])
  })

  test("uses ONECODE_EXTRA_PATH for global oneskills when set", () => {
    process.env.ONECODE_EXTRA_PATH = "/data/private"
    expect(OneSkills.globalProjectRoot()).toBe("/data/private")
    expect(OneSkills.root()).toBe(path.join("/data/private", ".opencode", "oneskills"))
    expect(OneSkills.globalSkillScanTargets()).toEqual([
      {
        root: path.join("/data/private", ".opencode", "oneskills"),
        patterns: ["skills/*/SKILL.md"],
      },
      {
        root: path.join(Global.Path.home, ".opencode"),
        patterns: ["{skill,skills}/*/SKILL.md", "skill/*/SKILL.md"],
      },
    ])
  })

  test("decodes catalog manifest entries", () => {
    const manifest = OneSkillsManifest.decodeManifest({
      schema_version: 1,
      package: "oneskills",
      skills: [
        {
          id: "skill:onescience-research-workflow",
          name: "onescience-research-workflow",
          description: "workflow planner",
          type: "expert",
          tags: ["workflow"],
          location: "skills/onescience-research-workflow/SKILL.md",
          source: "official",
        },
      ],
    })
    expect(OneSkillsManifest.indexByName(manifest).get("onescience-research-workflow")?.type).toBe("expert")
  })

  test("removes legacy flat official skills under ~/.opencode/skills", () => {
    const tmp = `/tmp/oneskills-legacy-${Date.now()}`
    const workflow = path.join(tmp, ".opencode", "skills", "onescience-workflow")
    const parallel = path.join(tmp, ".opencode", "skills", "onescience-parallel")
    mkdirSync(workflow, { recursive: true })
    mkdirSync(parallel, { recursive: true })
    writeFileSync(path.join(workflow, "SKILL.md"), "---\nname: onescience-workflow\n---\n")
    writeFileSync(path.join(parallel, "SKILL.md"), "---\nname: onescience-parallel\n---\n")

    const removed = OneSkills.removeLegacyFlatLayout(tmp)
    expect(removed).toContain(".opencode/skills/onescience-workflow")
    expect(removed).toContain(".opencode/skills/onescience-parallel")
    expect(existsSync(workflow)).toBe(false)
    expect(existsSync(parallel)).toBe(false)
    rmSync(tmp, { recursive: true, force: true })
  })
})

describe("Catalog ingest", () => {
  const prevExtra = process.env.ONECODE_EXTRA_PATH
  const prevClient = process.env.OPENCODE_CLIENT

  afterEach(() => {
    if (prevExtra === undefined) delete process.env.ONECODE_EXTRA_PATH
    else process.env.ONECODE_EXTRA_PATH = prevExtra
    if (prevClient === undefined) delete process.env.OPENCODE_CLIENT
    else process.env.OPENCODE_CLIENT = prevClient
  })

  test("indexes scanned skills with manifest metadata", async () => {
    await resetDatabase()
    Catalog.ingestSkills({
      runtime: [
        {
          name: "onescience-workflow",
          description: "workflow entry",
          location: "/tmp/.opencode/oneskills/skills/onescience-workflow/SKILL.md",
        },
      ],
    })
    const result = Catalog.search({ kind: "skill", q: "workflow", k: 5 })
    expect(result.items.map((item) => item.name)).toContain("onescience-workflow")
  })

  test("includes global and project opencode roots in skill scan roots", () => {
    delete process.env.OPENCODE_CLIENT
    const roots = Catalog.skillScanRoots("/tmp/project")
    expect(roots).toContainEqual({
      root: path.join(Global.Path.home, ".opencode"),
      patterns: ["oneskills/skills/*/SKILL.md", "{skill,skills}/*/SKILL.md", "skill/*/SKILL.md"],
    })
    expect(roots).toContainEqual({ root: "/tmp/project/.opencode", patterns: ["oneskills/skills/*/SKILL.md", "{skill,skills}/*/SKILL.md"] })
    expect(roots).toContainEqual({ root: "/tmp/project/.opencode/oneskills", patterns: ["oneskills/skills/*/SKILL.md", "{skill,skills}/*/SKILL.md"] })
  })

  test("uses ONECODE_EXTRA_PATH for global oneskills scan roots when set", () => {
    process.env.ONECODE_EXTRA_PATH = "/data/private"
    const roots = Catalog.skillScanRoots("/tmp/project")
    expect(roots).toContainEqual({
      root: path.join("/data/private", ".opencode", "oneskills"),
      patterns: ["skills/*/SKILL.md"],
    })
    expect(roots).toContainEqual({
      root: path.join(Global.Path.home, ".opencode"),
      patterns: ["{skill,skills}/*/SKILL.md", "skill/*/SKILL.md"],
    })
    expect(
      roots.some(
        (item) =>
          item.root === path.join(Global.Path.home, ".opencode") &&
          item.patterns.some((pattern) => pattern.includes("oneskills")),
      ),
    ).toBe(false)
    expect(roots).toContainEqual({ root: "/tmp/project/.opencode", patterns: ["oneskills/skills/*/SKILL.md", "{skill,skills}/*/SKILL.md"] })
  })
})
