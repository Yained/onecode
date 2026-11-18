import { describe, expect, test } from "bun:test"
import { pickPreferredFreeModelID, defaultFreeModelCandidates, isWeakerAutomaticDefault } from "./free-model"

describe("pickPreferredFreeModelID", () => {
  test("takes the first sorted OpenCode free model", () => {
    expect(
      pickPreferredFreeModelID([
        { id: "minimax-m2.5-free", cost: { input: 0 } },
        { id: "laguna-s-2.1-free", cost: { input: 0 } },
        { id: "big-pickle", cost: { input: 0 } },
        { id: "deepseek-v4-flash-free", cost: { input: 0 } },
        { id: "gpt-5", cost: { input: 1 } },
      ]),
    ).toBe("big-pickle")
  })

  test("ignores paid models even when they match priority ids", () => {
    expect(
      pickPreferredFreeModelID([
        { id: "gpt-5", cost: { input: 1 } },
        { id: "big-pickle", cost: { input: 0 } },
      ]),
    ).toBe("big-pickle")
  })

  test("falls back to catalog order among unranked free models", () => {
    expect(
      pickPreferredFreeModelID([
        { id: "laguna-s-2.1-free", cost: { input: 0 } },
        { id: "minimax-m2.5-free", cost: { input: 0 } },
      ]),
    ).toBe("minimax-m2.5-free")
  })

  test("returns undefined when there is no free model", () => {
    expect(pickPreferredFreeModelID([{ id: "gpt-5", cost: { input: 1 } }])).toBeUndefined()
  })
})

describe("defaultFreeModelCandidates", () => {
  const opencode = {
    id: "opencode",
    models: [
      { id: "minimax-m2.5-free", cost: { input: 0 } },
      { id: "big-pickle", cost: { input: 0 } },
    ],
  }

  test("prefers OneScience GLM, then GPT, then the first OpenCode free model", () => {
    expect(
      defaultFreeModelCandidates({
        onescienceModels: ["gpt-5.6-luna", "glm-5.2"],
        opencode,
      }),
    ).toEqual([
      { providerID: "onescience", modelID: "glm-5.2" },
      { providerID: "onescience", modelID: "gpt-5.6-luna" },
      { providerID: "opencode", modelID: "big-pickle" },
    ])
  })

  test("skips GLM when it is not in the catalog", () => {
    expect(
      defaultFreeModelCandidates({
        onescienceModels: ["gpt-5.6-luna"],
        opencode,
      }),
    ).toEqual([
      { providerID: "onescience", modelID: "gpt-5.6-luna" },
      { providerID: "opencode", modelID: "big-pickle" },
    ])
  })

  test("falls back to the first OpenCode free model", () => {
    expect(defaultFreeModelCandidates({ opencode })).toEqual([
      { providerID: "opencode", modelID: "big-pickle" },
    ])
  })
})

describe("isWeakerAutomaticDefault", () => {
  const candidates = defaultFreeModelCandidates({
    onescienceModels: ["gpt-5.6-luna", "glm-5.2"],
    opencode: { id: "opencode", models: [{ id: "big-pickle", cost: { input: 0 } }] },
  })

  test("treats OneScience GPT as weaker than GLM", () => {
    expect(
      isWeakerAutomaticDefault(
        { providerID: "onescience", modelID: "gpt-5.6-luna" },
        { providerID: "onescience", modelID: "glm-5.2" },
        candidates,
      ),
    ).toBe(true)
  })

  test("keeps a user pick outside the automatic default chain", () => {
    expect(
      isWeakerAutomaticDefault(
        { providerID: "anthropic", modelID: "claude-sonnet-4" },
        { providerID: "onescience", modelID: "glm-5.2" },
        candidates,
      ),
    ).toBe(false)
  })

  test("does not treat GLM as weaker than itself", () => {
    expect(
      isWeakerAutomaticDefault(
        { providerID: "onescience", modelID: "glm-5.2" },
        { providerID: "onescience", modelID: "glm-5.2" },
        candidates,
      ),
    ).toBe(false)
  })
})
