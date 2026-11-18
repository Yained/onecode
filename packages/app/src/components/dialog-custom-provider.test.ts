import { describe, expect, test } from "bun:test"
import { deriveProviderIdentity, validateCustomProvider } from "./dialog-custom-provider-form"

const t = (key: string) => key

describe("deriveProviderIdentity", () => {
  test("uses hostname labels from base URL", () => {
    expect(deriveProviderIdentity("https://rehdasu.cn/v1")).toEqual({
      providerID: "rehdasu",
      name: "rehdasu.cn",
    })
  })
})

describe("validateCustomProvider", () => {
  test("builds trimmed config payload", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: " Custom Provider ",
        baseURL: "https://api.example.com ",
        apiKey: " {env: CUSTOM_PROVIDER_KEY} ",
        models: [{ row: "m0", id: " model-a ", name: " Model A ", err: {} }],
        headers: [
          { row: "h0", key: " X-Test ", value: " enabled ", err: {} },
          { row: "h1", key: "", value: "", err: {} },
        ],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result).toEqual({
      providerID: "custom-provider",
      name: "Custom Provider",
      key: undefined,
      config: {
        npm: "@ai-sdk/openai-compatible",
        name: "Custom Provider",
        env: ["CUSTOM_PROVIDER_KEY"],
        options: {
          baseURL: "https://api.example.com",
          headers: {
            "X-Test": "enabled",
          },
        },
        models: {
          "model-a": { name: "model-a" },
        },
      },
    })
  })

  test("derives provider id from 名称 so the list shows hmk_1 not the relay host", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "",
        name: "hmk_1",
        baseURL: "https://rehdasu.cn/v1",
        apiKey: "sk-test",
        models: [{ row: "m0", id: "gpt-5.6", name: "", err: {} }],
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result).toEqual({
      providerID: "hmk_1",
      name: "hmk_1",
      key: "sk-test",
      config: {
        npm: "@ai-sdk/openai-compatible",
        name: "hmk_1",
        options: {
          baseURL: "https://rehdasu.cn/v1",
        },
        models: {
          "gpt-5.6": { name: "gpt-5.6" },
        },
      },
    })
  })

  test("auto-fills identity and model display name from URL / model id", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "",
        name: "",
        baseURL: "https://rehdasu.cn/v1",
        apiKey: "sk-test",
        models: [{ row: "m0", id: "gpt-5.6-terra", name: "", err: {} }],
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result).toEqual({
      providerID: "rehdasu",
      name: "rehdasu.cn",
      key: "sk-test",
      config: {
        npm: "@ai-sdk/openai-compatible",
        name: "rehdasu.cn",
        options: {
          baseURL: "https://rehdasu.cn/v1",
        },
        models: {
          "gpt-5.6-terra": { name: "gpt-5.6-terra" },
        },
      },
    })
  })

  test("flags duplicate rows and allows reconnecting disabled providers", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "secret",
        models: [
          { row: "m0", id: "model-a", name: "Model A", err: {} },
          { row: "m1", id: "model-a", name: "Model A 2", err: {} },
        ],
        headers: [
          { row: "h0", key: "Authorization", value: "one", err: {} },
          { row: "h1", key: "authorization", value: "two", err: {} },
        ],
        err: {},
      },
      t,
      disabledProviders: ["custom-provider"],
      existingProviderIDs: new Set(["custom-provider"]),
    })

    expect(result.result).toBeUndefined()
    expect(result.err.providerID).toBeUndefined()
    expect(result.models[1]).toEqual({
      id: "provider.custom.error.duplicate",
      name: undefined,
    })
    expect(result.headers[1]).toEqual({
      key: "provider.custom.error.duplicate",
      value: undefined,
    })
  })

  test("allows editing an existing provider id", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com/v1",
        apiKey: "",
        models: [{ row: "m0", id: "model-a", name: "Model A", err: {} }],
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(["custom-provider"]),
      editingProviderID: "custom-provider",
    })

    expect(result.err.providerID).toBeUndefined()
    expect(result.result?.providerID).toBe("custom-provider")
    expect(result.result?.config.options?.baseURL).toBe("https://api.example.com/v1")
  })
})

describe("DialogCustomProvider layout", () => {
  test("does not nest a second dialog-level scrollbar", async () => {
    const source = await Bun.file(new URL("./dialog-custom-provider.tsx", import.meta.url)).text()
    expect(source).toContain('class="flex flex-col gap-6 px-2.5 pb-3"')
    expect(source).not.toContain("overflow-y-auto max-h-[60vh]")
  })
})
