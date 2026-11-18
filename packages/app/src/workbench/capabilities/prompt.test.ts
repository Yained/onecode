import { describe, expect, test } from "bun:test"
import { renderCapabilityPrompt } from "./prompt"

describe("renderCapabilityPrompt", () => {
  test("fills {{placeholders}} from values", () => {
    expect(renderCapabilityPrompt("研究对象：{{subject}}", { subject: "CuO" })).toBe("研究对象：CuO")
  })

  test("replaces multiple placeholders", () => {
    expect(
      renderCapabilityPrompt("{{system}} / {{goal}}", { system: "CuO", goal: "train MD" }),
    ).toBe("CuO / train MD")
  })

  test("leaves missing keys empty", () => {
    expect(renderCapabilityPrompt("目标：{{goal}}", {})).toBe("目标：")
  })
})
