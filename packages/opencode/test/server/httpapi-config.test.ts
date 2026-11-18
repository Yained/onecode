import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Server } from "../../src/server/server"
import * as Log from "@opencode-ai/core/util/log"
import { Effect, Fiber } from "effect"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { it } from "../lib/effect"
import { waitGlobalBusEvent } from "./global-bus"

void Log.init({ print: false })

function app() {
  return Server.Default().app
}

function waitDisposed(directory: string) {
  return waitGlobalBusEvent({
    message: "timed out waiting for instance disposal",
    predicate: (event) => event.payload.type === "server.instance.disposed" && event.directory === directory,
  })
}

const tmpdirEffect = (options: Parameters<typeof tmpdir>[0]) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir(options)),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("config HttpApi", () => {
  it.live(
    "serves config update through the default server app",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })
      const disposed = yield* waitDisposed(tmp.path).pipe(Effect.forkScoped)

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              "x-opencode-directory": tmp.path,
            },
            body: JSON.stringify({ username: "patched-user", formatter: false, lsp: false }),
          }),
        ),
      )

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        username: "patched-user",
        formatter: false,
        lsp: false,
      })
      yield* Fiber.join(disposed)
      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "opencode.json")).json())).toMatchObject({
        username: "patched-user",
        formatter: false,
        lsp: false,
      })
    }),
  )

  it.live(
    "writes OneScience config to the project onescience json file",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })
      const onescience = yield* Effect.promise(() =>
        Bun.file(path.join(process.cwd(), "../../skills/onescience-workflow/assets/onescience.default.json")).json(),
      )

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              "x-opencode-directory": tmp.path,
            },
            body: JSON.stringify({ onescience }),
          }),
        ),
      )

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({ onescience })
      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "onescience.json")).json())).toEqual(onescience)
      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "config.json")).exists())).toBe(false)
    }),
  )

  it.live(
    "serves OneScience config from the project onescience json file",
    Effect.gen(function* () {
      const onescience = yield* Effect.promise(() =>
        Bun.file(path.join(process.cwd(), "../../skills/onescience-workflow/assets/onescience.default.json")).json(),
      )
      const tmp = yield* tmpdirEffect({
        init: (dir) => Bun.write(path.join(dir, "onescience.json"), JSON.stringify(onescience, null, 2)),
      })

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            headers: {
              "x-opencode-directory": tmp.path,
            },
          }),
        ),
      )

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({ onescience })
    }),
  )


  it.live(
    "serves legacy OneScience config with missing runtime sections",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({
        init: (dir) =>
          Bun.write(
            path.join(dir, "onescience.json"),
            JSON.stringify(
              {
                runtime: {
                  backend_id: "legacy",
                  remote: {},
                  target: {},
                  cluster: {},
                  script: {},
                },
              },
              null,
              2,
            ),
          ),
      })

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            headers: {
              "x-opencode-directory": tmp.path,
            },
          }),
        ),
      )

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        onescience: {
          runtime: {
            backend_id: "legacy",
            environment: {},
            conda: {},
            resources: {},
          },
        },
      })
    }),
  )

  it.live(
    "normalizes partial onescience.json with null runtime fields instead of 500",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({
        init: (dir) =>
          Bun.write(
            path.join(dir, "onescience.json"),
            JSON.stringify(
              {
                runtime: {
                  mode: "slurm",
                  // backend_id / remote / script missing — agent/UI partial save
                  execution_profile: {
                    execution_mode: null,
                    access_mode: "ssh",
                  },
                  target: {
                    scheduler_type: null,
                  },
                  cluster: null,
                  conda: null,
                  resources: {},
                },
              },
              null,
              2,
            ),
          ),
      })

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            headers: {
              "x-opencode-directory": tmp.path,
            },
          }),
        ),
      )

      expect(response.status).toBe(200)
      const body = yield* Effect.promise(() => response.json())
      expect(body.onescience?.runtime).toMatchObject({
        backend_id: "",
        remote: {},
        target: {},
        cluster: {},
        script: {},
        conda: {},
        resources: {},
        execution_profile: {
          access_mode: "ssh",
        },
      })
      expect(body.onescience?.runtime?.execution_profile?.execution_mode).toBeUndefined()
      expect(body.onescience?.runtime?.target?.scheduler_type).toBeUndefined()
    }),
  )

  it.live(
    "normalizes empty onescience.json object instead of 500",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({
        init: (dir) => Bun.write(path.join(dir, "onescience.json"), "{}\n"),
      })

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            headers: {
              "x-opencode-directory": tmp.path,
            },
          }),
        ),
      )

      expect(response.status).toBe(200)
      const body = yield* Effect.promise(() => response.json())
      expect(body.onescience?.runtime).toMatchObject({
        backend_id: "",
        remote: {},
        target: {},
        cluster: {},
        script: {},
        conda: {},
        resources: {},
      })
    }),
  )

  it.live(
    "serves config with active provider model status",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({
        config: {
          formatter: false,
          lsp: false,
          provider: {
            omniroute: {
              models: {
                "gpt-4o": {
                  status: "active",
                },
              },
            },
          },
        },
      })

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            headers: {
              "x-opencode-directory": tmp.path,
            },
          }),
        ),
      )

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        provider: {
          omniroute: {
            models: {
              "gpt-4o": {
                status: "active",
              },
            },
          },
        },
      })
    }),
  )
})
