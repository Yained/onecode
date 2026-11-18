import { describe, expect, test } from "bun:test"
import { isModelDefaultVisible } from "./model-visibility"

describe("isModelDefaultVisible", () => {
  test("respects explicit hide and show", () => {
    expect(
      isModelDefaultVisible({
        userVisibility: "hide",
        providerID: "opencode",
        inLatestSet: true,
        free: true,
        hasValidReleaseDate: true,
      }),
    ).toBe(false)
    expect(
      isModelDefaultVisible({
        userVisibility: "show",
        providerID: "opencode",
        inLatestSet: false,
        free: false,
        hasValidReleaseDate: true,
      }),
    ).toBe(true)
  })

  test("shows free models after the release window (Big Pickle)", () => {
    expect(
      isModelDefaultVisible({
        providerID: "opencode",
        inLatestSet: false,
        free: true,
        hasValidReleaseDate: true,
      }),
    ).toBe(true)
  })

  test("hides old paid models by default", () => {
    expect(
      isModelDefaultVisible({
        providerID: "opencode",
        inLatestSet: false,
        free: false,
        hasValidReleaseDate: true,
      }),
    ).toBe(false)
  })

  test("shows onescience and latest and undated models", () => {
    expect(
      isModelDefaultVisible({
        providerID: "onescience",
        inLatestSet: false,
        free: false,
        hasValidReleaseDate: true,
      }),
    ).toBe(true)
    expect(
      isModelDefaultVisible({
        providerID: "anthropic",
        inLatestSet: true,
        free: false,
        hasValidReleaseDate: true,
      }),
    ).toBe(true)
    expect(
      isModelDefaultVisible({
        providerID: "anthropic",
        inLatestSet: false,
        free: false,
        hasValidReleaseDate: false,
      }),
    ).toBe(true)
  })
})
