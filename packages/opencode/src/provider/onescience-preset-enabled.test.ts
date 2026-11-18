import { describe, expect, test } from "bun:test"
import { isOnescienceProviderEnabled, resolvePresetSecret } from "./onescience-preset-enabled"

describe("isOnescienceProviderEnabled", () => {
  test("shows OneScience when either GPT or GLM key is set", () => {
    expect(isOnescienceProviderEnabled({ gptApiKey: "", glmApiKey: "" })).toBe(false)
    expect(isOnescienceProviderEnabled({ gptApiKey: "  ", glmApiKey: "" })).toBe(false)
    expect(isOnescienceProviderEnabled({ gptApiKey: "gpt-key", glmApiKey: "" })).toBe(true)
    expect(isOnescienceProviderEnabled({ gptApiKey: "", glmApiKey: "glm-key" })).toBe(true)
    expect(isOnescienceProviderEnabled({ gptApiKey: "gpt-key", glmApiKey: "glm-key" })).toBe(true)
  })
})

describe("resolvePresetSecret", () => {
  test("hides the model when no source has a key", () => {
    expect(resolvePresetSecret({})).toBe("")
    expect(resolvePresetSecret({ override: "  ", env: "", baked: "" })).toBe("")
  })

  test("uses CI-baked keys when env is unset (npm install or source without keys)", () => {
    expect(resolvePresetSecret({ env: undefined, baked: "baked-gpt" })).toBe("baked-gpt")
    expect(resolvePresetSecret({ env: undefined, baked: "" })).toBe("")
  })

  test("accepts a runtime env key without dropping the other model's baked key", () => {
    expect(resolvePresetSecret({ env: "runtime-glm", baked: "baked-glm" })).toBe("runtime-glm")
    expect(resolvePresetSecret({ env: undefined, baked: "baked-gpt" })).toBe("baked-gpt")
  })

  test("falls through empty env to baked so CI keys still work", () => {
    expect(resolvePresetSecret({ env: "", baked: "baked-gpt" })).toBe("baked-gpt")
  })

  test("admin override still wins", () => {
    expect(
      resolvePresetSecret({
        override: "admin-gpt",
        env: "runtime-gpt",
        baked: "baked-gpt",
      }),
    ).toBe("admin-gpt")
  })
})
