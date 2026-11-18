import { Effect, Layer } from "effect"
import { Skill } from "../../src/skill"

export const empty = Layer.mock(Skill.Service)({
  get: () => Effect.succeed(undefined),
  all: () => Effect.succeed([]),
  available: () => Effect.succeed([]),
  dirs: () => Effect.succeed([]),
})

export * as SkillTest from "./skill"
