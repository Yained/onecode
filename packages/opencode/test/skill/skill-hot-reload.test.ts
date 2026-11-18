import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Skill } from "../../src/skill"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Skill.defaultLayer, CrossSpawnSpawner.defaultLayer))

describe("skill hot reload", () => {
  test("matchesSkillChange only tracks skill files", () => {
    expect(Skill.matchesSkillChange("/project/.opencode/skills/foo/SKILL.md", "change")).toBe(true)
    expect(Skill.matchesSkillChange("/project/.opencode/oneskills/skills/foo/SKILL.md", "change")).toBe(true)
    expect(Skill.matchesSkillChange("/project/src/main.ts", "change")).toBe(false)
    expect(Skill.matchesSkillChange("/project/.opencode/skills/foo", "unlink")).toBe(true)
    expect(Skill.matchesSkillChange("/project/.opencode/oneskills/skills/foo", "unlink")).toBe(true)
    expect(Skill.matchesSkillChange("/project/.opencode/skills/foo", "add")).toBe(true)
    expect(Skill.matchesSkillChange("/project/improve-codebase-architecture", "add")).toBe(false)
  })

  it.live("refresh discovers skills after .opencode is created later", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const skill = yield* Skill.Service
        expect((yield* skill.all()).some((item) => item.name === "late-skill")).toBe(false)

        yield* Effect.promise(() =>
          Bun.write(
            path.join(dir, ".opencode", "skills", "late-skill", "SKILL.md"),
            `---
name: late-skill
description: added after bootstrap
---

# Late Skill
`,
          ),
        )

        yield* skill.refresh()
        expect((yield* skill.all()).some((item) => item.name === "late-skill")).toBe(true)
      }),
    ),
  )

  it.live("refresh reloads skills after SKILL.md changes on disk", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          Bun.write(
            path.join(dir, ".opencode", "skills", "hot-skill", "SKILL.md"),
            `---
name: hot-skill
description: first version
---

# Hot Skill
`,
          ),
        )

        const skill = yield* Skill.Service
        const initial = yield* skill.all()
        expect(initial.some((item) => item.name === "hot-skill")).toBe(true)
        expect(initial.some((item) => item.name === "updated-skill")).toBe(false)

        yield* Effect.promise(() =>
          Bun.write(
            path.join(dir, ".opencode", "skills", "updated-skill", "SKILL.md"),
            `---
name: updated-skill
description: added while running
---

# Updated Skill
`,
          ),
        )

        yield* skill.refresh()
        const next = yield* skill.all()
        expect(next.some((item) => item.name === "updated-skill")).toBe(true)
      }),
    ),
  )
})
