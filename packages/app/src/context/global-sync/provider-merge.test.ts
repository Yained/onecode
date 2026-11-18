import { describe, expect, test } from "bun:test"
import type { Provider, ProviderListResponse } from "@opencode-ai/sdk/v2/client"
import { mergeProviderLists, shouldMergeGlobalProviders } from "./provider-merge"

function provider(id: string, models: Provider["models"] = {}): Provider {
  return {
    id,
    name: id,
    source: "config",
    env: [],
    options: {},
    models,
  } as Provider
}

function list(partial: Partial<ProviderListResponse>): ProviderListResponse {
  return {
    all: partial.all ?? [],
    connected: partial.connected ?? [],
    default: partial.default ?? {},
  }
}

describe("mergeProviderLists", () => {
  test("keeps custom provider when directory omits it from connected", () => {
    const local = list({
      all: [provider("opencode")],
      connected: ["opencode"],
    })
    const global = list({
      all: [provider("opencode"), provider("rehdasu", { "gpt-5.6-terra": { id: "gpt-5.6-terra" } as never })],
      connected: ["opencode", "rehdasu"],
    })

    const merged = mergeProviderLists(local, global)
    expect(merged.connected).toEqual(["opencode", "rehdasu"])
    expect(merged.all.some((item) => item.id === "rehdasu")).toBe(true)
    expect(merged.all.find((item) => item.id === "rehdasu")?.models["gpt-5.6-terra"]).toBeTruthy()
  })

  test("does not add providers that are only in global.all but not connected", () => {
    const local = list({
      all: [provider("opencode")],
      connected: ["opencode"],
    })
    const global = list({
      all: [provider("opencode"), provider("anthropic")],
      connected: ["opencode"],
    })

    const merged = mergeProviderLists(local, global)
    expect(merged.connected).toEqual(["opencode"])
    expect(merged.all.some((item) => item.id === "anthropic")).toBe(false)
  })

  test("prefers globally connected source/options over local catalog stubs", () => {
    const local = list({
      all: [
        {
          ...provider("deepseek"),
          source: "custom",
          options: {},
        } as Provider,
      ],
      connected: [],
    })
    const global = list({
      all: [
        {
          ...provider("deepseek"),
          source: "api",
          options: { apiKey: "sk-test" },
        } as Provider,
      ],
      connected: ["deepseek"],
    })

    const merged = mergeProviderLists(local, global)
    const item = merged.all.find((entry) => entry.id === "deepseek")
    expect(merged.connected).toContain("deepseek")
    expect(item?.source).toBe("api")
    expect(item?.options).toEqual({ apiKey: "sk-test" })
  })

  test("merges models with directory entries winning on conflict", () => {
    const local = list({
      all: [
        provider("rehdasu", {
          a: { id: "a", name: "local-a" } as never,
          b: { id: "b", name: "local-b" } as never,
        }),
      ],
      connected: ["rehdasu"],
    })
    const global = list({
      all: [
        provider("rehdasu", {
          a: { id: "a", name: "global-a" } as never,
          c: { id: "c", name: "global-c" } as never,
        }),
      ],
      connected: ["rehdasu"],
    })

    const merged = mergeProviderLists(local, global)
    const models = merged.all.find((item) => item.id === "rehdasu")?.models ?? {}
    expect((models.a as { name: string }).name).toBe("local-a")
    expect((models.b as { name: string }).name).toBe("local-b")
    expect((models.c as { name: string }).name).toBe("global-c")
  })

  test("prefers global display name when local model name is an id stub", () => {
    const local = list({
      all: [
        provider("onescience", {
          "glm-5.2": { id: "glm-5.2", name: "glm-5.2" } as never,
        }),
      ],
      connected: ["onescience"],
    })
    const global = list({
      all: [
        provider("onescience", {
          "glm-5.2": { id: "glm-5.2", name: "OneScience GLM" } as never,
        }),
      ],
      connected: ["onescience"],
    })

    const merged = mergeProviderLists(local, global)
    const models = merged.all.find((item) => item.id === "onescience")?.models ?? {}
    expect((models["glm-5.2"] as { name: string }).name).toBe("OneScience GLM")
  })
})

describe("shouldMergeGlobalProviders", () => {
  test("true when directory all is empty but global is not", () => {
    expect(
      shouldMergeGlobalProviders(list({ all: [], connected: [] }), list({ all: [provider("opencode")], connected: [] })),
    ).toBe(true)
  })

  test("true when directory is missing a globally connected id", () => {
    expect(
      shouldMergeGlobalProviders(
        list({ all: [provider("opencode")], connected: ["opencode"] }),
        list({ all: [provider("opencode"), provider("rehdasu")], connected: ["opencode", "rehdasu"] }),
      ),
    ).toBe(true)
  })

  test("false when connected sets already cover global", () => {
    expect(
      shouldMergeGlobalProviders(
        list({ all: [provider("opencode"), provider("rehdasu")], connected: ["opencode", "rehdasu"] }),
        list({ all: [provider("opencode"), provider("rehdasu")], connected: ["rehdasu"] }),
      ),
    ).toBe(false)
  })
})
