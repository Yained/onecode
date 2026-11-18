import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SystemSkillsCommand } from "../../src/cli/cmd/debug"
import { SkillCommand } from "../../src/cli/cmd/debug/skill"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(CrossSpawnSpawner.defaultLayer))

afterEach(async () => {
  await disposeAllInstances()
})

describe("cli debug skill", () => {
  const withNestedSkills = (assertOutput: (output: string) => void, command: () => Promise<void>) =>
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

          const output: string[] = []
          const originalWrite = process.stdout.write
          const originalCwd = process.cwd()
          process.stdout.write = ((chunk: string | Uint8Array) => {
            output.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"))
            return true
          }) as typeof process.stdout.write
          process.chdir(dir)

          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              process.stdout.write = originalWrite
              process.chdir(originalCwd)
            }),
          )

          yield* Effect.promise(command)
          assertOutput(output.join(""))
        }),
      { git: true },
    )

  it.live("prints only top-level skills", () =>
    withNestedSkills(
      (output) => {
        expect(output).toContain('"name": "parent-skill"')
        expect(output).not.toContain('"name": "child-skill"')
      },
      () => Promise.resolve(SkillCommand.handler({ _: [], $0: "debug" } as any)),
    ),
  )

  it.live("prints raw available_skills without child skills", () =>
    withNestedSkills(
      (output) => {
        expect(output).toContain("<available_skills>")
        expect(output).toContain("<name>parent-skill</name>")
        expect(output).not.toContain("<name>child-skill</name>")
      },
      () => Promise.resolve(SystemSkillsCommand.handler({ _: [], $0: "debug" } as any)),
    ),
  )
})
