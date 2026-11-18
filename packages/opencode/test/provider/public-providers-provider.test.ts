import { afterEach, expect, test } from "bun:test"
import { WithInstance } from "../../src/project/with-instance"
import { Provider } from "@/provider/provider"
import { PublicProviders } from "../../src/config/public-providers"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { Effect } from "effect"
import { AppRuntime } from "../../src/effect/app-runtime"
import { tmpdir } from "../fixture/fixture"

const labRelay = {
  npm: "@ai-sdk/openai-compatible",
  name: "Lab relay",
  options: { baseURL: "https://relay.example/v1", apiKey: "sk-public" },
  models: { "gpt-x": { name: "GPT X" } },
}

afterEach(() => {
  PublicProviders.testing.reset()
})

test("public provider from shared opencode.json connects with models for all users", async () => {
  PublicProviders.testing.replace({ "lab-relay": labRelay })

  await using tmp = await tmpdir()
  const providers = await WithInstance.provide({
    directory: tmp.path,
    fn: async () =>
      AppRuntime.runPromise(
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          return yield* provider.list()
        }),
      ),
  })

  const id = ProviderID.make("lab-relay")
  expect(providers[id]).toBeDefined()
  expect(providers[id].source).toBe("env")
  expect(providers[id].key).toBe("sk-public")
  expect(providers[id].models[ModelID.make("gpt-x")]).toBeDefined()
  expect(providers[id].models[ModelID.make("gpt-x")].name).toBe("GPT X")
})
