import { describe, expect, test } from "bun:test"
import {
  isEditableCustomProvider,
  isReservedProviderID,
  isTenantCustomProviderConfig,
  providerListIconID,
} from "./custom-provider"

describe("custom-provider helpers", () => {
  test("treats openai-compatible config as tenant custom", () => {
    expect(
      isTenantCustomProviderConfig("mk_han", {
        npm: "@ai-sdk/openai-compatible",
        name: "mk_han",
        options: { baseURL: "https://rehdasu.cn/v1" },
        models: { "gpt-5.6": { name: "gpt-5.6" } },
      }),
    ).toBe(true)
  })

  test("treats baseURL + models without npm as tenant custom", () => {
    expect(
      isTenantCustomProviderConfig("mk_han", {
        name: "mk_han",
        options: { baseURL: "https://rehdasu.cn/v1" },
        models: { "gpt-5.6": {} },
      }),
    ).toBe(true)
  })

  test("does not treat official providers as custom based on source alone", () => {
    expect(
      isEditableCustomProvider("deepseek", undefined, {
        id: "deepseek",
        source: "custom",
        options: {},
        models: { "deepseek-chat": {} },
      }),
    ).toBe(false)
    expect(
      isEditableCustomProvider("deepseek", { models: { "deepseek-chat": {} } }, {
        id: "deepseek",
        source: "config",
        options: {},
        models: { "deepseek-chat": {} },
      }),
    ).toBe(false)
    // Even if config looks like a relay, branded ids stay official (whale DeepSeek).
    expect(
      isEditableCustomProvider(
        "deepseek",
        {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: "http://47.84.183.235:18080/v1" },
          models: { "DeepSeek-V4": {} },
        },
        { id: "deepseek", source: "config" },
      ),
    ).toBe(false)
    expect(isEditableCustomProvider("openai", undefined, { id: "openai", source: "api" })).toBe(false)
    expect(isEditableCustomProvider("onescience", undefined, { id: "onescience", source: "env" })).toBe(false)
  })

  test("falls back to runtime shape when config is stale", () => {
    expect(
      isEditableCustomProvider("mk_han", undefined, {
        id: "mk_han",
        source: "config",
        options: { baseURL: "https://rehdasu.cn/v1" },
        models: { "gpt-5.6": {} },
      }),
    ).toBe(true)
  })

  test("treats branded catalog ids as reserved", () => {
    expect(isReservedProviderID("deepseek")).toBe(true)
    expect(isReservedProviderID("openai")).toBe(true)
    expect(isReservedProviderID("my-relay")).toBe(false)
    expect(providerListIconID("deepseek", true)).toBe("deepseek")
    expect(providerListIconID("deepseek", false)).toBe("deepseek")
    expect(providerListIconID("my-relay", true)).toBe("synthetic")
  })

  test("treats public_providers as read-only", () => {
    expect(
      isEditableCustomProvider(
        "lab-relay",
        {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: "https://relay.example/v1" },
          models: { "gpt-x": {} },
        },
        { id: "lab-relay", source: "env" },
        ["lab-relay"],
      ),
    ).toBe(false)
  })
})
