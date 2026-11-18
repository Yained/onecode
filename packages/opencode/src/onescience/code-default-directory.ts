import { AppRuntime } from "@/effect/app-runtime"
import { Project } from "@/project/project"
import { OneScienceCodeDefaultDirectory } from "@opencode-ai/core/onescience-code-default-directory"
import * as Log from "@opencode-ai/core/util/log"
import { Effect } from "effect"

const log = Log.create({ service: "onescience-code-default-directory" })

export function directory() {
  return OneScienceCodeDefaultDirectory.resolve()
}

export function ensureProjectEffect(target: string) {
  return Effect.gen(function* () {
    const project = yield* Project.Service
    yield* project.fromDirectory(target)
  })
}

export function ensure() {
  const target = OneScienceCodeDefaultDirectory.resolve()
  try {
    OneScienceCodeDefaultDirectory.ensureDirectory(target)
  } catch (error) {
    log.warn("failed to create default code workspace directory", { error, target })
  }
  AppRuntime.runFork(
    ensureProjectEffect(target).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          log.warn("failed to ensure default code workspace project", { error, target })
        }),
      ),
    ),
  )
  return target
}

export * as OneScienceCodeDefaultDirectory from "./code-default-directory"
