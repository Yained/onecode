import { describe, expect, test } from "bun:test"
import {
  primitiveCategoryForUse,
  primitiveDevelopPrompt,
  primitiveUseScenarios,
} from "./primitive-develop"

describe("primitiveDevelopPrompt", () => {
  const era5 = {
    id: "primitive-data-earth-era5-loader",
    title: "ERA5 Loader",
    description: "Load ERA5 reanalysis data",
    domain: "地球科学",
    primitiveType: "data.load",
    intentTags: ["weather", "era5"],
    contractJson: { primitiveCategory: "data-processing" },
  }

  test("includes primitive metadata in the development handoff prompt", () => {
    const prompt = primitiveDevelopPrompt(era5, { scenarioId: "load-preview" })
    expect(prompt).toContain("ERA5 Loader")
    expect(prompt).toContain("data.load")
    expect(prompt).toContain("weather, era5")
    expect(prompt).toContain("加载并预览数据")
  })

  test("includes selected parameters and notes in the final prompt", () => {
    const prompt = primitiveDevelopPrompt(era5, {
      scenarioId: "load-preview",
      parameters: { timeRange: "2020-01 至 2020-12", region: "东亚" },
      notes: "优先使用本地缓存",
    })
    expect(prompt).toContain("timeRange: 2020-01 至 2020-12")
    expect(prompt).toContain("region: 东亚")
    expect(prompt).toContain("优先使用本地缓存")
  })

  test("exposes different scenarios by primitive category", () => {
    expect(primitiveUseScenarios("dataset").map((item) => item.id)).toContain("build-datapipe")
    expect(primitiveUseScenarios("model-inference").map((item) => item.id)).toContain("minimal-inference")
    expect(primitiveUseScenarios("app").map((item) => item.id)).toContain("remote-workflow")
    expect(primitiveCategoryForUse({ primitiveType: "model.run", contractJson: { primitiveCategory: "model-inference" } })).toBe("model-inference")
  })
})
