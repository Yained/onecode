import { expect, test } from "bun:test"
import path from "node:path"
import { configureSubmissionEnvironment } from "../../src/server/submission-env"
import { tmpdir } from "../fixture/fixture"

test("source startup has no embedded OpenAlex key and preserves explicit runtime values", () => {
  for (const value of [undefined, "", "   ", "runtime-test-key"]) {
    const env = value === undefined ? {} : { OPENALEX_API_KEY: value }
    configureSubmissionEnvironment(env)
    expect(env.OPENALEX_API_KEY).toBe(value)
  }
})

test("compiled server injects its build key and lets runtime values override or disable it", async () => {
  await using directory = await tmpdir()
  for (const key of ["", "  ci-test-key  "]) {
    const result = await Bun.build({
      entrypoints: [path.resolve("src/server/submission-env.ts")],
      target: "node",
      format: "esm",
      define: { ONECODE_BUILTIN_OPENALEX_API_KEY: JSON.stringify(key) },
    })
    expect(result.success).toBe(true)
    const output = path.join(directory.path, key ? "with-key.mjs" : "without-key.mjs")
    await Bun.write(output, result.outputs[0])
    const compiled = await import(output)
    for (const value of [undefined, "", "   ", "runtime-test-key"]) {
      const env = value === undefined ? {} : { OPENALEX_API_KEY: value }
      compiled.configureSubmissionEnvironment(env)
      expect(env.OPENALEX_API_KEY).toBe(value ?? (key.trim() || undefined))
    }
  }
})
