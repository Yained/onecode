import { describe, expect, test, afterEach } from "bun:test"
import { Config } from "../../src/config/config"
import { PublicProviders } from "../../src/config/public-providers"

describe("tenant custom provider isolation helpers", () => {
  test("deleted_providers hard-removes provider entries from a config patch", () => {
    const existing = {
      provider: {
        keep: {
          npm: "@ai-sdk/openai-compatible",
          name: "keep",
          options: { baseURL: "https://keep.example/v1" },
          models: { "m-1": { name: "m-1" } },
        },
        drop: {
          npm: "@ai-sdk/openai-compatible",
          name: "drop",
          options: { baseURL: "https://drop.example/v1" },
          models: { "m-2": { name: "m-2" } },
        },
      },
      disabled_providers: ["drop"],
    }

    const patched = Config.testing.applyConfigPatch(existing as Config.Info, {
      deleted_providers: ["drop"],
      disabled_providers: [],
    } as Config.Info)

    expect(patched.provider?.keep).toBeTruthy()
    expect(patched.provider?.drop).toBeUndefined()
    expect(patched.disabled_providers).toEqual([])
    expect((patched as { deleted_providers?: string[] }).deleted_providers).toBeUndefined()
  })

  test("withDeletedProviders reattaches deletes stripped by writableGlobal", () => {
    const input = {
      deleted_providers: ["mk_han_1"],
      disabled_providers: [],
      provider: {
        keep: {
          npm: "@ai-sdk/openai-compatible",
          name: "keep",
          options: { baseURL: "https://keep.example/v1" },
          models: { "m-1": { name: "m-1" } },
        },
      },
    } as Config.Info

    expect((Config.testing.writableGlobal(input) as Config.Info & { deleted_providers?: string[] }).deleted_providers).toBeUndefined()
    const patch = Config.testing.withDeletedProviders(input)
    expect(patch.deleted_providers).toEqual(["mk_han_1"])

    const existing = {
      provider: {
        keep: input.provider!.keep,
        mk_han_1: {
          npm: "@ai-sdk/openai-compatible",
          name: "mk_han_1",
          options: { baseURL: "https://drop.example/v1" },
          models: { "m-2": { name: "m-2" } },
        },
      },
    } as Config.Info
    const patched = Config.testing.applyConfigPatch(existing, patch)
    expect(patched.provider?.mk_han_1).toBeUndefined()
    expect(patched.provider?.keep).toBeTruthy()
  })

  test("stripForeignCustomProviders keeps only owned openai-compatible relays", () => {
    const config = {
      provider: {
        onescience: {
          npm: "@ai-sdk/openai-compatible",
          name: "OneScience GPT",
          options: { baseURL: "https://preset.example/v1" },
          models: { "gpt-x": { name: "gpt-x" } },
        },
        owned: {
          npm: "@ai-sdk/openai-compatible",
          name: "owned",
          options: { baseURL: "https://owned.example/v1" },
          models: { "m-1": { name: "m-1" } },
        },
        foreign: {
          npm: "@ai-sdk/openai-compatible",
          name: "foreign",
          options: { baseURL: "https://foreign.example/v1" },
          models: { "m-2": { name: "m-2" } },
        },
        anthropic: {
          name: "Anthropic",
        },
      },
    } as Config.Info

    const stripped = Config.testing.stripForeignCustomProviders(config, new Set(["owned"]))
    expect(stripped.provider?.onescience).toBeTruthy()
    expect(stripped.provider?.owned).toBeTruthy()
    expect(stripped.provider?.foreign).toBeUndefined()
    expect(stripped.provider?.anthropic).toBeTruthy()
  })

  test("stripSharedSshMcp removes tenant-private maps from shared config", () => {
    const config = {
      ssh: {
        lab: { host: "login.example", remotePath: "/work/a", enabled: true },
      },
      mcp: {
        fs: { type: "local", command: ["npx", "server"], enabled: true },
      },
      provider: {
        anthropic: { name: "Anthropic" },
      },
    } as Config.Info

    const stripped = Config.testing.stripSharedSshMcp(config)
    expect(stripped.ssh).toBeUndefined()
    expect(stripped.mcp).toBeUndefined()
    expect(stripped.provider?.anthropic).toBeTruthy()
  })

  test("shouldConnectFromConfigAlone: custom relays and config apiKey only", () => {
    expect(
      Config.testing.shouldConnectFromConfigAlone("mk_han", {
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: "https://relay.example/v1" },
        models: { "m-1": {} },
      }),
    ).toBe(true)

    expect(
      Config.testing.shouldConnectFromConfigAlone("deepseek", {
        options: { apiKey: "sk-legacy-shared" },
      }),
    ).toBe(true)

    // Bare official stub must not connect every tenant (shared opencode.json leftover).
    expect(Config.testing.shouldConnectFromConfigAlone("deepseek", { name: "DeepSeek" })).toBe(false)
    expect(Config.testing.shouldConnectFromConfigAlone("deepseek", { options: { baseURL: "https://api.deepseek.com" } })).toBe(
      false,
    )
    expect(Config.testing.shouldConnectFromConfigAlone("deepseek", { options: { apiKey: "  " } })).toBe(false)
  })
})

describe("public providers from shared opencode.json", () => {
  afterEach(() => {
    PublicProviders.testing.reset()
  })

  const labRelay = {
    npm: "@ai-sdk/openai-compatible",
    name: "Lab relay",
    options: { baseURL: "https://relay.example/v1", apiKey: "sk-public" },
    models: { "gpt-x": { name: "GPT X" } },
  }

  test("stripForeignCustomProviders keeps public ids even with empty keepIds", () => {
    PublicProviders.testing.replace({ "lab-relay": labRelay })
    const config = {
      provider: {
        "lab-relay": labRelay,
        foreign: {
          npm: "@ai-sdk/openai-compatible",
          name: "foreign",
          options: { baseURL: "https://foreign.example/v1" },
          models: { "m-2": { name: "m-2" } },
        },
      },
    } as Config.Info

    const stripped = Config.testing.stripForeignCustomProviders(config, new Set())
    expect(stripped.provider?.["lab-relay"]).toBeTruthy()
    expect(stripped.provider?.foreign).toBeUndefined()
  })

  test("overlayPublicProviders wins over account overlay and redacts apiKey", () => {
    PublicProviders.testing.replace({ "lab-relay": labRelay })
    const overlaid = Config.testing.overlayPublicProviders({
      provider: {
        "lab-relay": {
          npm: "@ai-sdk/openai-compatible",
          name: "hijacked",
          options: { baseURL: "https://evil.example/v1", apiKey: "sk-account" },
          models: { "other": { name: "other" } },
        },
      },
    } as Config.Info)

    expect(overlaid.public_providers).toEqual(["lab-relay"])
    expect(overlaid.provider?.["lab-relay"]?.name).toBe("Lab relay")
    expect(overlaid.provider?.["lab-relay"]?.options?.apiKey).toBeUndefined()
    expect(overlaid.provider?.["lab-relay"]?.options?.baseURL).toBe("https://relay.example/v1")
  })

  test("omitPublicProviderMutations drops public provider writes and deletes", () => {
    PublicProviders.testing.replace({ "lab-relay": labRelay })
    const patch = Config.testing.omitPublicProviderMutations({
      deleted_providers: ["lab-relay", "owned"],
      disabled_providers: ["lab-relay", "other"],
      provider: {
        "lab-relay": { name: "nope" },
        owned: { name: "owned" },
      },
      public_providers: ["should-not-write"],
    } as Config.Info)

    expect(patch.deleted_providers).toEqual(["owned"])
    expect(patch.disabled_providers).toEqual(["other"])
    expect(patch.provider?.["lab-relay"]).toBeUndefined()
    expect(patch.provider?.owned).toBeTruthy()
    expect(patch.public_providers).toBeUndefined()
  })
})
