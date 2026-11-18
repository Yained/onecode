import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "fs"
import path from "path"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Project } from "../../src/project/project"
import { OneScienceCodeDefaultDirectory } from "../../src/onescience/code-default-directory"
import { resetDatabase } from "../fixture/db"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Project.defaultLayer, CrossSpawnSpawner.defaultLayer))

describe("OneScienceCodeDefaultDirectory.ensure", () => {
  const prevExtra = process.env.ONECODE_EXTRA_PATH
  const prevExplicit = process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY

  afterEach(async () => {
    await resetDatabase()
    if (prevExtra === undefined) delete process.env.ONECODE_EXTRA_PATH
    else process.env.ONECODE_EXTRA_PATH = prevExtra
    if (prevExplicit === undefined) delete process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY
    else process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY = prevExplicit
  })

  it.live("creates the default directory and registers the project", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => resetDatabase())
      const tmp = yield* tmpdirScoped()
      process.env.ONECODE_EXTRA_PATH = tmp
      delete process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY

      const target = OneScienceCodeDefaultDirectory.ensure()
      expect(target).toBe(path.join(tmp, "case"))
      expect(existsSync(target)).toBe(true)

      yield* OneScienceCodeDefaultDirectory.ensureProjectEffect(target)
      const projects = yield* Effect.gen(function* () {
        const svc = yield* Project.Service
        return yield* svc.list()
      })
      expect(projects.length).toBeGreaterThan(0)
    }),
  )
})
