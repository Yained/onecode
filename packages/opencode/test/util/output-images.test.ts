import { describe, expect, test } from "bun:test"
import { imagePathsFromText } from "../../src/util/output-images"

describe("imagePathsFromText", () => {
  test("collects saved-to paths", () => {
    expect(imagePathsFromText("Saved plot to outputs/cfdbench_pressure_field.png")).toEqual([
      "outputs/cfdbench_pressure_field.png",
    ])
  })

  test("collects relative image paths from output", () => {
    expect(imagePathsFromText("Wrote visualization to result/smoke_demo/nmse_by_case.png")).toEqual([
      "result/smoke_demo/nmse_by_case.png",
    ])
  })

  test("ignores python paths", () => {
    expect(imagePathsFromText("python scripts/plot.py outputs/plot.png")).toEqual(["outputs/plot.png"])
  })

  test("deduplicates repeated paths", () => {
    const text = [
      "Saved plot to outputs/plot.png",
      "Saved plot to outputs/plot.png",
      "Also wrote outputs/plot.png",
    ].join("\n")
    expect(imagePathsFromText(text)).toEqual(["outputs/plot.png"])
  })
})
