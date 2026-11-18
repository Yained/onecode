import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { AIPrimitive } from "@/onescience/primitive"
import { migratePrimitives } from "@/onescience/primitive-migration"
import { OneScienceResource } from "@/onescience/resource"
import { OneScienceSkill } from "@/onescience/skill"
import { resetDatabase } from "../fixture/db"

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await resetDatabase()
})

describe("OneScienceSkill", () => {
  test("no longer seeds static skills into the database", () => {
    OneScienceResource.seedDefaults()
    const result = OneScienceSkill.seedDefaults()

    expect(result.seeded).toBe(0)
    expect(result.updated).toBe(0)
    expect(OneScienceSkill.list().items).toEqual([])
  })

  test("binds primitives to existing resources", () => {
    OneScienceResource.seedDefaults()
    OneScienceSkill.upsertUser({
      id: "onescience-coder",
      title: "OneScience Coder",
      copy: "coder skill",
      layer: "执行层",
      tags: ["onescience"],
    })
    migratePrimitives([
      {
        id: "primitive-data-earth-era5-loader",
        title: "ERA5 Data Loader",
        copy: "加载 ERA5 单层再分析数据。",
        tags: ["Data Resources", "skill:onescience-coder", "source:datasets", "resource:earth-era5", "weather"],
        provider: "Copernicus CDS",
        size: "data.load",
        format: "NetCDF/GRIB",
        href: "https://example.com/era5",
      },
      {
        id: "primitive-app-openfoam-runner",
        title: "OpenFOAM Case Runner",
        copy: "启动 OpenFOAM CFD 案例。",
        tags: ["App Launchers", "category:app", "skill:onescience-runtime", "source:apps", "resource:openfoam", "cfd"],
        provider: "OpenFOAM",
        size: "app.launch",
        format: "CPU/GPU/MPI",
        href: "https://example.com/openfoam",
      },
    ])
    const result = OneScienceSkill.seedPrimitiveRelations()

    expect(result.skillBindings).toBe(0)
    expect(result.resourceBindings).toBe(1)
    expect(OneScienceSkill.listWithPrimitives().items.find((item) => item.id === "onescience-coder")?.primitives ?? []).toEqual([])
    expect(AIPrimitive.listWithResources({ limit: 10 }).items.find((item) => item.id === "primitive-data-earth-era5-loader")?.resources ?? []).toEqual([])
    expect(AIPrimitive.listWithResources({ limit: 10 }).items.find((item) => item.id === "primitive-app-openfoam-runner")?.resources?.map((item) => item.id) ?? []).toContain("seed-apps-openfoam")
  })

  test("does not attach primitives to skills after decoupling", () => {
    OneScienceResource.seedDefaults()
    OneScienceSkill.upsertUser({
      id: "onescience-coder",
      title: "OneScience Coder",
      copy: "coder skill",
      layer: "执行层",
      tags: ["onescience"],
    })
    migratePrimitives([
      {
        id: "primitive-data-earth-era5-loader",
        title: "ERA5 Data Loader",
        copy: "加载 ERA5 单层再分析数据。",
        tags: ["Data Resources", "skill:onescience-coder", "source:datasets", "resource:earth-era5", "weather"],
        provider: "Copernicus CDS",
        size: "data.load",
        format: "NetCDF/GRIB",
        href: "https://example.com/era5",
      },
      {
        id: "primitive-resource-seed-datasets-earth-era5",
        title: "ERA5 Derived Draft",
        copy: "Derived draft loader",
        tags: ["Data Resources", "skill:onescience-coder", "source:datasets", "resource:earth-era5", "weather"],
        provider: "Copernicus CDS",
        size: "data.load",
        format: "NetCDF/GRIB",
        href: "https://example.com/era5-derived",
      },
    ])
    OneScienceSkill.seedPrimitiveRelations()

    const coder = OneScienceSkill.listWithPrimitives().items.find((item) => item.id === "onescience-coder")
    expect(coder?.primitives ?? []).toEqual([])
  })
})
