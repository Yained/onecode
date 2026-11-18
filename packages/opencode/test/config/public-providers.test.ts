import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "fs"
import os from "os"
import path from "path"
import { PublicProviders } from "../../src/config/public-providers"

describe("PublicProviders.loadOnce", () => {
  const prevExtra = process.env.ONECODE_EXTRA_PATH

  afterEach(() => {
    PublicProviders.testing.reset()
    if (prevExtra === undefined) delete process.env.ONECODE_EXTRA_PATH
    else process.env.ONECODE_EXTRA_PATH = prevExtra
  })

  test("loads connectable providers and skips onescience / incomplete entries", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "public-providers-"))
    const dir = path.join(root, ".config", "opencode")
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      path.join(dir, "opencode.json"),
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        provider: {
          onescience: {
            npm: "@ai-sdk/openai-compatible",
            options: { baseURL: "https://skip.example/v1", apiKey: "sk-skip" },
            models: { "gpt-x": { name: "x" } },
          },
          "lab-relay": {
            npm: "@ai-sdk/openai-compatible",
            name: "Lab",
            options: { baseURL: "https://relay.example/v1", apiKey: "sk-ok" },
            models: { "gpt-x": { name: "GPT X" } },
          },
          incomplete: {
            npm: "@ai-sdk/openai-compatible",
            options: { baseURL: "https://incomplete.example/v1" },
          },
          deepseek: {
            options: { apiKey: "sk-deepseek" },
          },
        },
      }),
    )
    process.env.ONECODE_EXTRA_PATH = root
    PublicProviders.loadOnce()
    expect(PublicProviders.has("lab-relay")).toBe(true)
    expect(PublicProviders.has("deepseek")).toBe(true)
    expect(PublicProviders.has("onescience")).toBe(false)
    expect(PublicProviders.has("incomplete")).toBe(false)
  })

  test("invalid JSON discards the whole snapshot", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "public-providers-bad-"))
    const dir = path.join(root, ".config", "opencode")
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, "opencode.json"), "{ not json")
    process.env.ONECODE_EXTRA_PATH = root
    PublicProviders.loadOnce()
    expect(PublicProviders.ids().size).toBe(0)
  })
})
