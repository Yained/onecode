import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Catalog } from "../../src/catalog/index"
import { Skill } from "../../src/skill"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideInstance, provideTmpdirInstance, tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import path from "path"
import fs from "fs/promises"

const node = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(Skill.defaultLayer, node))

async function createGlobalSkill(homeDir: string) {
  const skillDir = path.join(homeDir, ".claude", "skills", "global-test-skill")
  await fs.mkdir(skillDir, { recursive: true })
  await Bun.write(
    path.join(skillDir, "SKILL.md"),
    `---
name: global-test-skill
description: A global skill from ~/.claude/skills for testing.
---

# Global Test Skill

This skill is loaded from the global home directory.
`,
  )
}

const withHome = <A, E, R>(home: string, self: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const prev = process.env.OPENCODE_TEST_HOME
      process.env.OPENCODE_TEST_HOME = home
      return prev
    }),
    () => self,
    (prev) =>
      Effect.sync(() => {
        process.env.OPENCODE_TEST_HOME = prev
      }),
  )

describe("skill", () => {
  test("formats built-in skill locations without file URLs", () => {
    const output = Skill.fmt(
      [
        {
          name: "customize-opencode",
          description: "Built-in skill.",
          location: "<built-in>",
        },
      ],
      { verbose: true },
    )

    expect(output).toContain("<location><built-in></location>")
    expect(output).not.toContain("%3Cbuilt-in%3E")
    expect(output).not.toContain("file://")
  })

  test("truncates long skill descriptions in verbose fmt", () => {
    const long = "x".repeat(400)
    const output = Skill.fmt(
      [
        {
          name: "huge-skill",
          description: long,
          location: "<built-in>",
        },
      ],
      { verbose: true },
    )
    expect(output).toContain("<name>huge-skill</name>")
    expect(output).not.toContain(long)
    expect(output).toContain("…")
  })

  it.live("discovers skills from .opencode/skills/ directory", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skills", "test-skill", "SKILL.md"),
              `---
name: test-skill
description: A test skill for verification.
---

# Test Skill

Instructions here.
`,
            ),
          )

          const skill = yield* Skill.Service
          const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
          expect(list.length).toBe(1)
          const item = list.find((x) => x.name === "test-skill")
          expect(item).toBeDefined()
          expect(item!.description).toBe("A test skill for verification.")
          expect(item!.location).toContain(path.join("skills", "test-skill", "SKILL.md"))
        }),
      { git: true },
    ),
  )

  it.live("discovers skills from .opencode/oneskills/skills/ directory", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "oneskills", "skills", "prefab-skill", "SKILL.md"),
              `---
name: prefab-skill
description: A prefabricated OneSkills skill.
---

# Prefab Skill
`,
            ),
          )

          const skill = yield* Skill.Service
          const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
          expect(list.length).toBe(1)
          const item = list.find((x) => x.name === "prefab-skill")
          expect(item).toBeDefined()
          expect(item!.description).toBe("A prefabricated OneSkills skill.")
          expect(item!.location).toContain(path.join("oneskills", "skills", "prefab-skill", "SKILL.md"))
        }),
      { git: true },
    ),
  )

  it.live("discovers skills from configured skills.paths", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const skillRoot = path.join(dir, "external-skills")
          yield* Effect.promise(async () => {
            await Bun.write(
              path.join(skillRoot, "repo-skill", "SKILL.md"),
              `---
name: repo-skill
description: Loaded from skills.paths.
---

# Repo Skill
`,
            )
            await Bun.write(
              path.join(dir, ".opencode", "opencode.json"),
              JSON.stringify({
                skills: {
                  paths: [skillRoot],
                },
              }),
            )
          })

          const skill = yield* Skill.Service
          const item = (yield* skill.all()).find((x) => x.name === "repo-skill")
          expect(item).toBeDefined()
          expect(item!.description).toBe("Loaded from skills.paths.")
        }),
      { git: true },
    ),
  )

  it.live("refreshes catalog when configured repo skills are loaded", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          Catalog.initAutoSync()
          const skillRoot = path.join(dir, "external", "skills")
          yield* Effect.promise(async () => {
            await Bun.write(
              path.join(skillRoot, "repo-skill", "SKILL.md"),
              `---
name: repo-skill
description: Loaded from configured repo path
---

# Repo Skill
`,
            )
            await Bun.write(
              path.join(dir, ".opencode", "opencode.json"),
              JSON.stringify({
                skills: {
                  paths: [skillRoot],
                },
              }),
            )
          })

          const skill = yield* Skill.Service
          yield* skill.refresh()
          const result = Catalog.search({ kind: "skill", q: "repo-skill", k: 5 })
          expect(result.items.map((item) => item.name)).toContain("repo-skill")
        }),
      { git: true },
    ),
  )

  it.live("user .opencode/skills/ overrides same-name .opencode/oneskills/skills/", () =>
    provideTmpdirInstance(
      (dir) =>
        withHome(
          dir,
          Effect.gen(function* () {
            yield* Effect.promise(() =>
              Bun.write(
                path.join(dir, ".opencode", "oneskills", "skills", "shared-skill", "SKILL.md"),
                `---
name: shared-skill
description: Prefab version.
---

# Prefab
`,
              ),
            )
            yield* Effect.promise(() =>
              Bun.write(
                path.join(dir, ".opencode", "skills", "shared-skill", "SKILL.md"),
                `---
name: shared-skill
description: User override version.
---

# User
`,
              ),
            )

            const skill = yield* Skill.Service
            const item = (yield* skill.all()).find((x) => x.name === "shared-skill")
            expect(item).toBeDefined()
            expect(item!.description).toBe("User override version.")
            expect(item!.location).toContain(path.join(".opencode", "skills", "shared-skill", "SKILL.md"))
          }),
        ),
      { git: true },
    ),
  )

  it.live("project skills override global skills and prefab skills", () =>
    provideTmpdirInstance(
      (projectDir) =>
        Effect.gen(function* () {
          const homeDir = path.join(projectDir, "home")
          yield* Effect.promise(() => fs.mkdir(homeDir, { recursive: true }))
          yield* withHome(
            homeDir,
            Effect.gen(function* () {
              yield* Effect.promise(() =>
                Bun.write(
                  path.join(homeDir, ".opencode", "oneskills", "skills", "tier-skill", "SKILL.md"),
                  `---
name: tier-skill
description: Global prefab version.
---

# Global Prefab
`,
                ),
              )
              yield* Effect.promise(() =>
                Bun.write(
                  path.join(homeDir, ".opencode", "skills", "tier-skill", "SKILL.md"),
                  `---
name: tier-skill
description: Global user version.
---

# Global User
`,
                ),
              )
              yield* Effect.promise(() =>
                Bun.write(
                  path.join(projectDir, ".opencode", "skills", "tier-skill", "SKILL.md"),
                  `---
name: tier-skill
description: Project user version.
---

# Project User
`,
                ),
              )

              const skill = yield* Skill.Service
              const item = (yield* skill.all()).find((x) => x.name === "tier-skill")
              expect(item).toBeDefined()
              expect(item!.description).toBe("Project user version.")
              expect(item!.location).toContain(path.join(projectDir, ".opencode", "skills", "tier-skill", "SKILL.md"))
            }),
          )
        }),
      { git: true },
    ),
  )

  it.live("global user skills override prefab when project has no override", () =>
    provideTmpdirInstance(
      (projectDir) =>
        Effect.gen(function* () {
          const homeDir = path.join(projectDir, "home")
          yield* Effect.promise(() => fs.mkdir(homeDir, { recursive: true }))
          yield* withHome(
            homeDir,
            Effect.gen(function* () {
              yield* Effect.promise(() =>
                Bun.write(
                  path.join(homeDir, ".opencode", "oneskills", "skills", "tier-skill", "SKILL.md"),
                  `---
name: tier-skill
description: Global prefab version.
---

# Global Prefab
`,
                ),
              )
              yield* Effect.promise(() =>
                Bun.write(
                  path.join(homeDir, ".opencode", "skills", "tier-skill", "SKILL.md"),
                  `---
name: tier-skill
description: Global user version.
---

# Global User
`,
                ),
              )

              const skill = yield* Skill.Service
              const item = (yield* skill.all()).find((x) => x.name === "tier-skill")
              expect(item).toBeDefined()
              expect(item!.description).toBe("Global user version.")
              expect(item!.location).toContain(path.join(homeDir, ".opencode", "skills", "tier-skill", "SKILL.md"))
            }),
          )
        }),
      { git: true },
    ),
  )

  it.live("still discovers legacy .opencode/skill/ directory", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skill", "legacy-skill", "SKILL.md"),
              `---
name: legacy-skill
description: A legacy singular-path skill.
---

# Legacy Skill
`,
            ),
          )

          const skill = yield* Skill.Service
          const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
          expect(list.length).toBe(1)
          expect(list[0].name).toBe("legacy-skill")
          expect(list[0].location).toContain(path.join("skill", "legacy-skill", "SKILL.md"))
        }),
      { git: true },
    ),
  )

  it.live("loads skill content on demand", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skills", "lazy-skill", "SKILL.md"),
              `---
name: lazy-skill
description: A lazy-loaded skill.
---

# Lazy Skill

Loaded on demand.
`,
            ),
          )

          const skill = yield* Skill.Service
          const meta = yield* skill.all()
          const item = meta.find((x) => x.name === "lazy-skill")
          expect(item).toBeDefined()
          expect("content" in item!).toBe(false)

          const loaded = yield* skill.get("lazy-skill")
          expect(loaded).toBeDefined()
          expect(loaded!.content).toContain("# Lazy Skill")
          expect(loaded!.content).toContain("Loaded on demand.")
        }),
      { git: true },
    ),
  )

  it.live("discovers child skills only after loading the parent skill", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(
                path.join(dir, ".opencode", "skills", "parent-skill", "SKILL.md"),
                `---
name: parent-skill
description: Parent skill.
---

# Parent Skill
`,
              ),
              Bun.write(
                path.join(dir, ".opencode", "skills", "parent-skill", "child-skill", "SKILL.md"),
                `---
name: child-skill
description: Child skill.
---

# Child Skill
`,
              ),
              Bun.write(
                path.join(
                  dir,
                  ".opencode",
                  "skills",
                  "parent-skill",
                  "child-skill",
                  "grandchild-skill",
                  "SKILL.md",
                ),
                `---
name: grandchild-skill
description: Grandchild skill.
---

# Grandchild Skill
`,
              ),
            ]),
          )

          const skill = yield* Skill.Service

          const initial = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
          expect(initial.map((item) => item.name)).toEqual(["parent-skill"])

          yield* skill.expand("parent-skill")
          const afterParent = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
          expect(afterParent.find((item) => item.name === "child-skill")).toBeDefined()
          expect(afterParent.find((item) => item.name === "grandchild-skill")).toBeUndefined()

          yield* skill.expand("child-skill")
          const afterChild = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
          expect(afterChild.find((item) => item.name === "grandchild-skill")).toBeDefined()
        }),
      { git: true },
    ),
  )

  it.live("exposes child skills via available() only after loading the parent", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(
                path.join(dir, ".opencode", "skills", "parent-skill", "SKILL.md"),
                `---
name: parent-skill
description: Parent skill.
---

# Parent Skill
`,
              ),
              Bun.write(
                path.join(dir, ".opencode", "skills", "parent-skill", "child-skill", "SKILL.md"),
                `---
name: child-skill
description: Child skill.
---

# Child Skill
`,
              ),
              Bun.write(
                path.join(
                  dir,
                  ".opencode",
                  "skills",
                  "parent-skill",
                  "child-skill",
                  "grandchild-skill",
                  "SKILL.md",
                ),
                `---
name: grandchild-skill
description: Grandchild skill.
---

# Grandchild Skill
`,
              ),
            ]),
          )

          const skill = yield* Skill.Service

          const initial = (yield* skill.available()).filter((s) => s.location !== "<built-in>")
          expect(initial.map((item) => item.name)).toEqual(["parent-skill"])

          yield* skill.expand("parent-skill")
          const afterParent = (yield* skill.available()).filter((s) => s.location !== "<built-in>")
          expect(afterParent.find((item) => item.name === "child-skill")).toBeDefined()
          expect(afterParent.find((item) => item.name === "grandchild-skill")).toBeUndefined()

          yield* skill.expand("child-skill")
          const afterChild = (yield* skill.available()).filter((s) => s.location !== "<built-in>")
          expect(afterChild.find((item) => item.name === "grandchild-skill")).toBeDefined()
        }),
      { git: true },
    ),
  )

  it.live("skill.get loads content but does NOT expose child skills", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(
                path.join(dir, ".opencode", "skills", "parent-skill", "SKILL.md"),
                `---
name: parent-skill
description: Parent skill.
---

# Parent Skill
`,
              ),
              Bun.write(
                path.join(dir, ".opencode", "skills", "parent-skill", "child-skill", "SKILL.md"),
                `---
name: child-skill
description: Child skill.
---

# Child Skill
`,
              ),
            ]),
          )

          const skill = yield* Skill.Service

          // Reading content (the side effect that command-list serialization
          // triggers via the template getter) must NOT cascade-expand.
          const loaded = yield* skill.get("parent-skill")
          expect(loaded?.content).toContain("Parent Skill")

          const after = (yield* skill.available()).filter((s) => s.location !== "<built-in>")
          expect(after.map((item) => item.name)).toEqual(["parent-skill"])
          expect(after.find((item) => item.name === "child-skill")).toBeUndefined()
        }),
      { git: true },
    ),
  )

  it.live("returns currently discovered skill directories from Skill.dirs", () =>
    provideTmpdirInstance(
      (dir) =>
        withHome(
          dir,
          Effect.gen(function* () {
            yield* Effect.promise(() =>
              Promise.all([
                Bun.write(
                  path.join(dir, ".opencode", "skills", "dir-skill", "SKILL.md"),
                  `---
name: dir-skill
description: Skill for dirs test.
---

# Dir Skill
`,
                ),
                Bun.write(
                  path.join(dir, ".opencode", "skills", "dir-skill", "child-dir-skill", "SKILL.md"),
                  `---
name: child-dir-skill
description: Child dir skill.
---

# Child Dir Skill
`,
                ),
              ]),
            )

            const skill = yield* Skill.Service
            const initialDirs = yield* skill.dirs()
            expect(initialDirs).toContain(path.join(dir, ".opencode", "skills", "dir-skill"))
            expect(initialDirs).not.toContain(path.join(dir, ".opencode", "skills", "dir-skill", "child-dir-skill"))

            yield* skill.expand("dir-skill")
            const expandedDirs = yield* skill.dirs()
            expect(expandedDirs).toContain(path.join(dir, ".opencode", "skills", "dir-skill", "child-dir-skill"))
          }),
        ),
      { git: true },
    ),
  )

  it.live("discovers multiple skills from .opencode/skills/ directory", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(
                path.join(dir, ".opencode", "skills", "skill-one", "SKILL.md"),
                `---
name: skill-one
description: First test skill.
---

# Skill One
`,
              ),
              Bun.write(
                path.join(dir, ".opencode", "skills", "skill-two", "SKILL.md"),
                `---
name: skill-two
description: Second test skill.
---

# Skill Two
`,
              ),
            ]),
          )

          const skill = yield* Skill.Service
          const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
          expect(list.length).toBe(2)
          expect(list.find((x) => x.name === "skill-one")).toBeDefined()
          expect(list.find((x) => x.name === "skill-two")).toBeDefined()
        }),
      { git: true },
    ),
  )

  it.live("skips skills with missing frontmatter", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skills", "no-frontmatter", "SKILL.md"),
              `# No Frontmatter

Just some content without YAML frontmatter.
`,
            ),
          )

          const skill = yield* Skill.Service
          expect((yield* skill.all()).filter((s) => s.location !== "<built-in>")).toEqual([])
        }),
      { git: true },
    ),
  )

  it.live("discovers skills without descriptions", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".opencode", "skills", "manual-skill", "SKILL.md"),
              `---
name: manual-skill
---

# Manual Skill

Instructions here.
`,
            ),
          )

          const skill = yield* Skill.Service
          const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
          expect(list.length).toBe(1)
          const item = list.find((x) => x.name === "manual-skill")
          expect(item).toBeDefined()
          expect(item!.description).toBeUndefined()
          expect(Skill.fmt(list, { verbose: false })).toBe("No skills are currently available.")
          expect(Skill.fmt(list, { verbose: true })).toBe("No skills are currently available.")
        }),
      { git: true },
    ),
  )

  it.live("discovers skills from .claude/skills/ directory", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".claude", "skills", "claude-skill", "SKILL.md"),
              `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
            ),
          )

          const skill = yield* Skill.Service
          const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
          expect(list.length).toBe(1)
          const item = list.find((x) => x.name === "claude-skill")
          expect(item).toBeDefined()
          expect(item!.location).toContain(path.join(".claude", "skills", "claude-skill", "SKILL.md"))
        }),
      { git: true },
    ),
  )

  it.live("discovers global skills from ~/.claude/skills/ directory", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir({ git: true })),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )

      yield* withHome(
        tmp.path,
        Effect.gen(function* () {
          yield* Effect.promise(() => createGlobalSkill(tmp.path))
          yield* Effect.gen(function* () {
            const skill = yield* Skill.Service
            const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
            expect(list.length).toBe(1)
            expect(list[0].name).toBe("global-test-skill")
            expect(list[0].description).toBe("A global skill from ~/.claude/skills for testing.")
            expect(list[0].location).toContain(path.join(".claude", "skills", "global-test-skill", "SKILL.md"))
          }).pipe(provideInstance(tmp.path))
        }),
      )
    }),
  )

  it.live("returns empty array when no skills exist", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const skill = yield* Skill.Service
          expect((yield* skill.all()).filter((s) => s.location !== "<built-in>")).toEqual([])
        }),
      { git: true },
    ),
  )

  it.live("discovers skills from .agents/skills/ directory", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".agents", "skills", "agent-skill", "SKILL.md"),
              `---
name: agent-skill
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
            ),
          )

          const skill = yield* Skill.Service
          const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
          expect(list.length).toBe(1)
          const item = list.find((x) => x.name === "agent-skill")
          expect(item).toBeDefined()
          expect(item!.location).toContain(path.join(".agents", "skills", "agent-skill", "SKILL.md"))
        }),
      { git: true },
    ),
  )

  it.live("discovers global skills from ~/.agents/skills/ directory", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir({ git: true })),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )

      yield* withHome(
        tmp.path,
        Effect.gen(function* () {
          const skillDir = path.join(tmp.path, ".agents", "skills", "global-agent-skill")
          yield* Effect.promise(() => fs.mkdir(skillDir, { recursive: true }))
          yield* Effect.promise(() =>
            Bun.write(
              path.join(skillDir, "SKILL.md"),
              `---
name: global-agent-skill
description: A global skill from ~/.agents/skills for testing.
---

# Global Agent Skill

This skill is loaded from the global home directory.
`,
            ),
          )

          yield* Effect.gen(function* () {
            const skill = yield* Skill.Service
            const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
            expect(list.length).toBe(1)
            expect(list[0].name).toBe("global-agent-skill")
            expect(list[0].description).toBe("A global skill from ~/.agents/skills for testing.")
            expect(list[0].location).toContain(path.join(".agents", "skills", "global-agent-skill", "SKILL.md"))
          }).pipe(provideInstance(tmp.path))
        }),
      )
    }),
  )

  it.live("discovers skills from both .claude/skills/ and .agents/skills/", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(
                path.join(dir, ".claude", "skills", "claude-skill", "SKILL.md"),
                `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
              ),
              Bun.write(
                path.join(dir, ".agents", "skills", "agent-skill", "SKILL.md"),
                `---
name: agent-skill
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
              ),
            ]),
          )

          const skill = yield* Skill.Service
          const list = (yield* skill.all()).filter((s) => s.location !== "<built-in>")
          expect(list.length).toBe(2)
          expect(list.find((x) => x.name === "claude-skill")).toBeDefined()
          expect(list.find((x) => x.name === "agent-skill")).toBeDefined()
        }),
      { git: true },
    ),
  )

  it.live("properly resolves top-level directories that skills live in", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(
                path.join(dir, ".claude", "skills", "claude-skill", "SKILL.md"),
                `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
              ),
              Bun.write(
                path.join(dir, ".agents", "skills", "agent-skill", "SKILL.md"),
                `---
name: agent-skill
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
              ),
              Bun.write(
                path.join(dir, ".opencode", "skill", "opencode-skill-legacy", "SKILL.md"),
                `---
name: opencode-skill-legacy
description: A skill in the .opencode/skill directory.
---

# OpenCode Skill
`,
              ),
              Bun.write(
                path.join(dir, ".opencode", "skills", "opencode-skill", "SKILL.md"),
                `---
name: opencode-skill
description: A skill in the .opencode/skills directory.
---

# OpenCode Skill
`,
              ),
              Bun.write(
                path.join(dir, ".opencode", "skills", "opencode-skill", "child", "SKILL.md"),
                `---
name: nested-opencode-skill
description: Nested skill.
---

# Nested OpenCode Skill
`,
              ),
            ]),
          )

          const skill = yield* Skill.Service
          const dirs = yield* skill.dirs()
          expect(dirs.length).toBe(4)
          expect(dirs).not.toContain(path.join(dir, ".opencode", "skills", "opencode-skill", "child"))
        }),
      { git: true },
    ),
  )
})
