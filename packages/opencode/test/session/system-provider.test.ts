import { describe, expect, test } from "bun:test"
import { SystemPrompt } from "../../src/session/system"
import type { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"

function model(partial: { providerID: string; apiID: string }): Provider.Model {
  return {
    id: ModelID.make(partial.apiID),
    providerID: ProviderID.make(partial.providerID),
    api: { id: partial.apiID, npm: "@ai-sdk/openai-compatible", url: "http://example" },
    name: partial.apiID,
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2025-01-01",
    variants: {},
  } as Provider.Model
}

describe("SystemPrompt.provider", () => {
  test("does not bake onescience output into every provider prompt", () => {
    const prompts = SystemPrompt.provider(model({ providerID: "openai", apiID: "gpt-4.1" }))
    expect(prompts.join("\n")).not.toContain("os-science")
    expect(SystemPrompt.onescienceOutput({ full: false })).toContain("same language as the user")
    expect(SystemPrompt.onescienceOutput({ full: false })).toContain("Do not mix colloquial bilingual phrasing")
    expect(SystemPrompt.onescienceOutput({ full: false })).toContain("Proper nouns, API names, library names, model IDs")
    expect(SystemPrompt.onescienceOutput({ full: false }).length).toBeLessThan(
      SystemPrompt.onescienceOutput({ full: true }).length,
    )
  })

  test("uses default prompt for deepseek like upstream OpenCode", () => {
    const prompts = SystemPrompt.provider(
      model({ providerID: "deepseek-v4-sugon", apiID: "deepseek-v4-pro" }),
    )
    expect(prompts).toHaveLength(1)
    expect(prompts.join("\n")).not.toContain("os-science")
    expect(prompts.join("\n")).toContain("You are opencode")
  })
})
