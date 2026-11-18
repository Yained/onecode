import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Command } from "../../src/command"
import { Skill } from "../../src/skill"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const node = CrossSpawnSpawner.defaultLayer
const it = testEffect(Layer.mergeAll(Command.defaultLayer, Skill.defaultLayer, node))

describe("command skill exposure", () => {
  it.live("lists child skill commands only after parent skill loads", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              `${dir}/.opencode/skills/parent-skill/SKILL.md`,
              `---
name: parent-skill
description: Parent skill.
---

# Parent Skill
`,
            ),
          )
          yield* Effect.promise(() =>
            Bun.write(
              `${dir}/.opencode/skills/parent-skill/child-skill/SKILL.md`,
              `---
name: child-skill
description: Child skill.
---

# Child Skill
`,
            ),
          )

          const command = yield* Command.Service
          const skill = yield* Skill.Service

          const before = yield* command.list()
          expect(before.find((item) => item.name === "parent-skill")).toBeDefined()
          expect(before.find((item) => item.name === "child-skill")).toBeUndefined()
          expect(yield* command.get("child-skill")).toBeUndefined()

          yield* skill.expand("parent-skill")

          const child = yield* command.get("child-skill")
          expect(child).toBeDefined()
          expect(child?.source).toBe("skill")

          const after = yield* command.list()
          expect(after.find((item) => item.name === "child-skill")).toBeDefined()
        }),
      { git: true },
    ),
  )
})
