import { describe, expect, test } from "bun:test"
import { OneScienceTaxonomy } from "@/onescience/taxonomy"

describe("OneScienceTaxonomy", () => {
  test("defines the initial task profiles", () => {
    expect(OneScienceTaxonomy.taskProfiles.map((item) => item.id)).toEqual([
      "model-development",
      "dataset-building",
      "data-analysis",
      "model-training",
      "model-inference-testing",
      "research-workflow-building",
      "paper-reproduction",
      "model-performance-analysis",
      "operator-performance-optimization",
      "model-optimization",
      "model-adaptation",
    ])
  })

  test("maps model development to required scientific primitives", () => {
    expect(OneScienceTaxonomy.getTaskProfile("model-development")?.requiredPrimitiveTypes).toEqual([
      "component",
      "dataset",
      "model.architecture",
      "adapter",
    ])
  })

  test("keeps paper reproduction as a full lifecycle task", () => {
    expect(OneScienceTaxonomy.getTaskProfile("paper-reproduction")?.capabilityFamilies).toEqual([
      "resource.discovery",
      "data.building",
      "model.building",
      "training",
      "inference.evaluation",
      "report.reproducibility",
    ])
  })


  test("adds data analysis as a lightweight research assistant task", () => {
    const profile = OneScienceTaxonomy.getTaskProfile("data-analysis")

    expect(profile?.title).toBe("数据分析")
    expect(profile?.requiredPrimitiveTypes).toEqual(["dataset", "data.process", "report"])
    expect(profile?.capabilityFamilies).toEqual(["resource.discovery", "data.building", "inference.evaluation", "report.reproducibility"])
  })

  test("adds model optimization distinct from infrastructure performance tuning", () => {
    const profile = OneScienceTaxonomy.getTaskProfile("model-optimization")

    expect(profile?.title).toBe("模型优化")
    expect(profile?.requiredPrimitiveTypes).toEqual(["model.architecture", "model.train", "benchmark"])
    expect(profile?.optionalPrimitiveTypes).toEqual(expect.arrayContaining(["adapter", "profile", "model.infer"]))
  })

  test("includes profiling and benchmarking for model performance analysis", () => {
    const profile = OneScienceTaxonomy.getTaskProfile("model-performance-analysis")

    expect(profile?.requiredPrimitiveTypes).toEqual(["profile", "benchmark"])
    expect(profile?.capabilityFamilies).toContain("performance.optimization")
  })

  test("normalizes legacy primitive types deterministically", () => {
    expect(OneScienceTaxonomy.normalizePrimitiveType("data.load")).toBe("dataset")
    expect(OneScienceTaxonomy.normalizePrimitiveType("data.transform")).toBe("data.process")
    expect(OneScienceTaxonomy.normalizePrimitiveType("model.run")).toBe("model.infer")
    expect(OneScienceTaxonomy.normalizePrimitiveType("model.evaluate")).toBe("benchmark")
    expect(OneScienceTaxonomy.normalizePrimitiveType("app.launch")).toBe("app.run")
    expect(OneScienceTaxonomy.normalizePrimitiveType("operator.apply")).toBe("component")
    expect(OneScienceTaxonomy.normalizePrimitiveType("code.generate")).toBeUndefined()
    expect(OneScienceTaxonomy.normalizePrimitiveType("runtime.submit")).toBeUndefined()
  })
})
