import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { migratePrimitives } from "@/onescience/primitive-migration"
import { OneScienceTaskProfile } from "@/onescience/task-profile"
import { resetDatabase } from "../fixture/db"

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await resetDatabase()
})

describe("OneScienceTaskProfile", () => {
  test("lists task profiles with primitive counts", () => {
    migratePrimitives([
      {
        id: "primitive-data-earth-era5-loader",
        title: "ERA5 Data Loader",
        copy: "加载 ERA5 单层再分析数据。",
        tags: ["Data Resources", "category:dataset", "skill:onescience-coder", "source:datasets", "resource:earth-era5", "weather"],
        provider: "Copernicus CDS",
        size: "data.load",
        format: "NetCDF/GRIB",
        href: "https://example.com/era5",
      },
      {
        id: "primitive-model-aurora-runner",
        title: "Aurora Weather Runner",
        copy: "运行 Aurora 天气模型推理。",
        tags: ["Model Resources", "category:model-inference", "skill:onescience-runtime", "source:models", "resource:earth-aurora", "weather"],
        provider: "Microsoft Research",
        size: "model.run",
        format: "PyTorch",
        href: "https://example.com/aurora",
      },
    ])

    const result = OneScienceTaskProfile.list()

    expect(result.items.map((item) => item.id)).toContain("paper-reproduction")
    expect(result.items.find((item) => item.id === "paper-reproduction")?.primitiveCount).toBeGreaterThanOrEqual(2)
    expect(result.items.find((item) => item.id === "model-inference-testing")?.primitiveCount).toBeGreaterThanOrEqual(1)
    expect(result.items.find((item) => item.id === "paper-reproduction")?.executionSkills).toContain("onescience-runtime")
  })
})

describe("OneScience task profile experimental API", () => {
  test("declares task profile endpoint", async () => {
    const source = await Bun.file(new URL("../../src/server/routes/instance/httpapi/groups/experimental.ts", import.meta.url)).text()

    expect(source).toContain('oneScienceTaskProfile: "/experimental/onescience/task-profile"')
    expect(source).toContain('HttpApiEndpoint.get("oneScienceTaskProfileList"')
  })
})
