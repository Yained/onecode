import { describe, expect, test } from "bun:test"
import { onescienceModelDisplayName, onescienceProviderDisplayName } from "./onescience-model-label"

describe("onescienceModelDisplayName", () => {
  test("maps built-in ids before the catalog loads", () => {
    expect(onescienceModelDisplayName({ providerID: "onescience", modelID: "gpt-5.6-luna" })).toBe("OneScience GPT")
    expect(onescienceModelDisplayName({ providerID: "onescience", modelID: "glm-5.2" })).toBe("OneScience GLM")
  })

  test("does not show the raw id when the catalog repeats it", () => {
    expect(
      onescienceModelDisplayName({
        providerID: "onescience",
        modelID: "gpt-5.6-luna",
        catalogName: "gpt-5.6-luna",
      }),
    ).toBe("OneScience GPT")
  })

  test("keeps a real catalog name", () => {
    expect(
      onescienceModelDisplayName({
        providerID: "onescience",
        modelID: "gpt-5.6-luna",
        catalogName: "OneScience GPT",
      }),
    ).toBe("OneScience GPT")
  })

  test("does not remap the same id on another provider", () => {
    expect(onescienceModelDisplayName({ providerID: "openai", modelID: "gpt-5.6-luna" })).toBe("gpt-5.6-luna")
  })
})

describe("onescienceProviderDisplayName", () => {
  test("maps the onescience provider id", () => {
    expect(onescienceProviderDisplayName("onescience")).toBe("OneScience")
    expect(onescienceProviderDisplayName("onescience", "onescience")).toBe("OneScience")
    expect(onescienceProviderDisplayName("onescience", "OneScience")).toBe("OneScience")
  })
})
