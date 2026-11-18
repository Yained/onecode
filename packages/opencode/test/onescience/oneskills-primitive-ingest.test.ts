import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync } from "fs"
import path from "path"
import { AIPrimitive } from "@/onescience/primitive"
import { AIPrimitiveTable } from "@/onescience/primitive.sql"
import { migrateStaticPrimitives } from "@/onescience/primitive-migration"
import { scanOneskillsPrimitiveAssets, oneskillsPrimitiveId } from "@/onescience/oneskills-primitive-ingest"
import {
  clearAppliedPrimitiveSeed,
  isSeedVersionNewer,
  resolvePrimitiveSeedBundle,
  validateDiskPrimitiveSeed,
  writeAppliedPrimitiveSeed,
} from "@/onescience/oneskills-primitive-seed"
import { OneScienceResource } from "@/onescience/resource"
import { CatalogBlobStore } from "@/catalog/blob-store"
import { Database } from "@/storage/db"
import { eq, isNull } from "drizzle-orm"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await resetDatabase()
})

async function writeAsset(root: string, assetKey: string, metadata: Record<string, unknown>, files: Record<string, string> = {}) {
  const dir = path.join(root, ...assetKey.split("/"))
  mkdirSync(dir, { recursive: true })
  await Bun.write(path.join(dir, "metadata.json"), JSON.stringify(metadata, null, 2))
  for (const [name, content] of Object.entries(files)) {
    await Bun.write(path.join(dir, name), content)
  }
}

describe("oneskills primitive ingest", () => {
  test("scans metadata and companion files from assets tree", async () => {
    await using tmp = await tmpdir()
    const assets = path.join(tmp.path, "assets")
    await writeAsset(
      assets,
      "climate/models/fuxi",
      {
        name: "fuxi",
        type: "model",
        domain: "meteorology",
        description: "FuXi forecast primitive",
        tags: ["weather-forecast"],
        version: "1.0.0",
      },
      {
        "spec.md": "# FuXi spec",
        "usage.md": "# FuXi usage",
      },
    )

    const scanned = scanOneskillsPrimitiveAssets(assets)
    expect(scanned).toHaveLength(1)
    expect(scanned[0]?.assetKey).toBe("climate/models/fuxi")
    expect(scanned[0]?.metadata.name).toBe("fuxi")
    expect(scanned[0]?.files["spec.md"]).toBe("# FuXi spec")
    expect(scanned[0]?.files["usage.md"]).toBe("# FuXi usage")
  })

  test("migrateStaticPrimitives seeds from oneskills assets and maps OneHub resources", async () => {
    await using tmp = await tmpdir()
    const assets = path.join(tmp.path, "onescience-primitives", "assets")
    await writeAsset(
      assets,
      "climate/models/fuxi",
      {
        name: "fuxi",
        type: "model",
        domain: "meteorology",
        description: "FuXi forecast primitive",
        tags: ["weather-forecast"],
        version: "1.0.0",
      },
      { "spec.md": "# FuXi spec" },
    )
    await writeAsset(assets, "climate/datapipes/era5", {
      name: "era5",
      type: "datapipe",
      domain: "meteorology",
      description: "ERA5 datapipe",
      tags: ["era5"],
      version: "1.0.0",
    })

    OneScienceResource.seedDefaults()
    const result = migrateStaticPrimitives({
      assetsRoot: assets,
    })

    expect(result.migrated + result.skipped).toBeGreaterThan(0)

    const fuxiId = oneskillsPrimitiveId("climate/models/fuxi")
    const era5Id = oneskillsPrimitiveId("climate/datapipes/era5")
    const fuxi = AIPrimitive.get(fuxiId)
    const era5 = AIPrimitive.get(era5Id)

    expect(fuxi.owner).toBe("system")
    expect(fuxi.status).toBe("callable")
    expect(fuxi.sourceResourceIds).toEqual(["seed-models-modelhub-fuxi"])
    expect(fuxi.domain).toBe("地球科学")
    expect(fuxi.primitiveType).toBe("model")
    expect(fuxi.contractJson?.primitiveCategory).toBe("model")
    expect(era5.sourceResourceIds).toEqual(["seed-datasets-earth-era5"])
    expect(era5.primitiveType).toBe("data.transform")
    expect(era5.contractJson?.primitiveCategory).toBe("data-processing")

    const blob = CatalogBlobStore.readPrimitiveBlob(fuxiId)
    expect(blob?.files).toMatchObject({ "spec.md": "# FuXi spec" })
    expect(blob?.assetKey).toBe("climate/models/fuxi")

    // oneskills seeds 模型原语; OneHub model-inference draft remains a separate publishable kind
    const derived = Database.use((db) =>
      db
        .select({ id: AIPrimitiveTable.id, status: AIPrimitiveTable.status, time_deleted: AIPrimitiveTable.time_deleted })
        .from(AIPrimitiveTable)
        .where(eq(AIPrimitiveTable.id, "primitive-resource-seed-models-modelhub-fuxi"))
        .get(),
    )
    expect(derived?.time_deleted).toBeNull()
    expect(derived?.status).toBe("draft")

    // oneskills seeds datapipe (data-processing); OneHub dataset draft remains publishable
    const era5Derived = Database.use((db) =>
      db
        .select({
          id: AIPrimitiveTable.id,
          status: AIPrimitiveTable.status,
          title: AIPrimitiveTable.title,
          primitive_type: AIPrimitiveTable.primitive_type,
          contract_json: AIPrimitiveTable.contract_json,
          time_deleted: AIPrimitiveTable.time_deleted,
        })
        .from(AIPrimitiveTable)
        .where(eq(AIPrimitiveTable.id, "primitive-resource-seed-datasets-earth-era5"))
        .get(),
    )
    expect(era5Derived?.time_deleted).toBeNull()
    expect(era5Derived?.status).toBe("draft")
    expect(era5Derived?.title).toBe("全球再分析")
    expect(era5Derived?.primitive_type).toBe("data.load")
    expect(era5Derived?.contract_json?.primitiveCategory).toBe("dataset")
  })

  test("reclassifies oneskills datapipes on remigrate without seed version bump", async () => {
    const seed = {
      version: "reclassify-1",
      assets: [
        {
          assetKey: "climate/datapipes/era5",
          metadata: {
            name: "era5",
            type: "datapipe",
            domain: "meteorology",
            description: "ERA5 datapipe",
            tags: ["era5"],
          },
          files: {},
        },
      ],
    }
    OneScienceResource.seedDefaults()
    migrateStaticPrimitives({ seed })
    const id = oneskillsPrimitiveId("climate/datapipes/era5")
    Database.use((db) => {
      db.update(AIPrimitiveTable)
        .set({
          primitive_type: "data.load",
          contract_json: {
            primitiveType: "data.load",
            primitiveCategory: "dataset",
          },
          time_updated: Date.now(),
        })
        .where(eq(AIPrimitiveTable.id, id))
        .run()
    })
    expect(AIPrimitive.get(id).primitiveType).toBe("data.load")
    expect(AIPrimitive.get(id).contractJson?.primitiveCategory).toBe("dataset")

    const again = migrateStaticPrimitives({ seed })
    expect(again.oneskillsApplied).toBe(false)
    expect(AIPrimitive.get(id).primitiveType).toBe("data.transform")
    expect(AIPrimitive.get(id).contractJson?.primitiveCategory).toBe("data-processing")
  })

  test("soft-deletes oneskills system primitives only when seed version bumps", async () => {
    const v1 = {
      version: "test-1",
      assets: [
        {
          assetKey: "climate/models/fuxi",
          metadata: { name: "fuxi", type: "model", domain: "meteorology", description: "FuXi", tags: [] },
          files: {},
        },
        {
          assetKey: "climate/models/pangu",
          metadata: { name: "pangu", type: "model", domain: "meteorology", description: "Pangu", tags: [] },
          files: {},
        },
      ],
    }
    migrateStaticPrimitives({ seed: v1 })
    expect(AIPrimitive.get(oneskillsPrimitiveId("climate/models/pangu")).status).toBe("callable")

    migrateStaticPrimitives({
      seed: {
        version: "test-1",
        assets: [v1.assets[0]!],
      },
    })
    expect(AIPrimitive.get(oneskillsPrimitiveId("climate/models/pangu")).status).toBe("callable")

    migrateStaticPrimitives({
      seed: {
        version: "test-2",
        assets: [
          {
            assetKey: "climate/models/fuxi",
            metadata: { name: "fuxi", type: "model", domain: "meteorology", description: "FuXi v2", tags: [] },
            files: {},
          },
        ],
      },
    })

    expect(() => AIPrimitive.get(oneskillsPrimitiveId("climate/models/pangu"))).toThrow()
    expect(AIPrimitive.get(oneskillsPrimitiveId("climate/models/fuxi")).description).toBe("FuXi v2")

    const activeSystem = Database.use((db) =>
      db
        .select({ id: AIPrimitiveTable.id })
        .from(AIPrimitiveTable)
        .where(isNull(AIPrimitiveTable.time_deleted))
        .all()
        .filter((row) => row.id.startsWith("primitive-oneskills-")),
    )
    expect(activeSystem.map((row) => row.id)).toEqual([oneskillsPrimitiveId("climate/models/fuxi")])
  })

  test("startup resolves a seed when neither seed nor assetsRoot is passed", () => {
    clearAppliedPrimitiveSeed()
    const result = migrateStaticPrimitives()
    expect(result.seedVersion).toBeTruthy()
    expect(result.oneskillsApplied).toBe(true)
    expect(["disk", "bundled"]).toContain(result.seedSource)

    const active = Database.use((db) =>
      db
        .select({ id: AIPrimitiveTable.id })
        .from(AIPrimitiveTable)
        .where(isNull(AIPrimitiveTable.time_deleted))
        .all()
        .filter((row) => row.id.startsWith("primitive-oneskills-")),
    )
    expect(active.length).toBeGreaterThan(0)

    const again = migrateStaticPrimitives()
    expect(again.oneskillsApplied).toBe(false)
    expect(again.seedVersion).toBe(result.seedVersion)
  })
})

describe("oneskills primitive seed resolution", () => {
  test("isSeedVersionNewer compares upstream then content hash", () => {
    expect(isSeedVersionNewer("2026.07.10+aaaa", "2026.07.09+bbbb")).toBe(true)
    expect(isSeedVersionNewer("2026.07.09+aaaa", "2026.07.10+bbbb")).toBe(false)
    expect(isSeedVersionNewer("2026.07.09+cccc", "2026.07.09+bbbb")).toBe(true)
    expect(isSeedVersionNewer("2026.07.09+bbbb", "2026.07.09+bbbb")).toBe(false)
    expect(isSeedVersionNewer("2026.07.09+aaaa", undefined)).toBe(true)
  })

  test("validateDiskPrimitiveSeed rejects sparse or low-quality assets", () => {
    const bundled = {
      version: "bundled-1",
      assets: Array.from({ length: 10 }, (_, index) => ({
        assetKey: `climate/models/m${index}`,
        metadata: { name: `m${index}`, description: `model ${index}` },
        files: {},
      })),
    }
    const sparse = {
      version: "disk-1",
      assets: [
        {
          assetKey: "climate/models/only",
          metadata: { name: "only", description: "one" },
          files: {},
        },
      ],
    }
    expect(validateDiskPrimitiveSeed(sparse, bundled).ok).toBe(false)

    const undiagnosed = {
      version: "disk-2",
      assets: Array.from({ length: 10 }, (_, index) => ({
        assetKey: `climate/models/m${index}`,
        metadata: { name: `m${index}`, description: index < 3 ? "ok" : "" },
        files: {},
      })),
    }
    expect(validateDiskPrimitiveSeed(undiagnosed, bundled).ok).toBe(false)
  })

  test("resolvePrimitiveSeedBundle falls back to bundled when disk fails validation", async () => {
    await using tmp = await tmpdir()
    const assets = path.join(tmp.path, "assets")
    await writeAsset(assets, "climate/models/fuxi", {
      name: "fuxi",
      type: "model",
      domain: "meteorology",
      description: "FuXi",
      tags: [],
    })
    await Bun.write(path.join(tmp.path, "VERSION"), "2099.01.01\n")

    clearAppliedPrimitiveSeed()
    const bundled = {
      version: "2026.01.01+bundled",
      upstreamVersion: "2026.01.01",
      assets: Array.from({ length: 10 }, (_, index) => ({
        assetKey: `climate/models/m${index}`,
        metadata: { name: `m${index}`, description: `model ${index}` },
        files: {},
      })),
    }

    // tryBuildDisk reads VERSION from OneSkills.root — override via assetsRoot only.
    // Force "newer" by clearing applied and providing a disk tree; validation uses bundled count.
    const resolved = resolvePrimitiveSeedBundle({
      assetsRoot: assets,
      bundled,
      dbPath: Database.getPath(),
    })
    expect(resolved.source).toBe("bundled")
    expect(resolved.fallbackReason).toContain("below minimum")
  })

  test("resolvePrimitiveSeedBundle keeps already-applied disk snapshot", async () => {
    await using tmp = await tmpdir()
    const projectRoot = tmp.path
    const installedAssets = path.join(
      projectRoot,
      ".opencode/oneskills/skills/onescience-primitives/assets",
    )
    const assetsList = Array.from({ length: 4 }, (_, index) => ({
      key: `climate/models/m${index}`,
      name: `m${index}`,
    }))
    for (const item of assetsList) {
      await writeAsset(installedAssets, item.key, {
        name: item.name,
        type: "model",
        domain: "meteorology",
        description: `${item.name} model`,
        tags: ["weather"],
      })
    }
    mkdirSync(path.join(projectRoot, ".opencode/oneskills"), { recursive: true })
    await Bun.write(path.join(projectRoot, ".opencode/oneskills/VERSION"), "2099.06.01\n")

    const disk = resolvePrimitiveSeedBundle({
      projectRoot,
      bundled: {
        version: "2020.01.01+old",
        assets: assetsList.map((item) => ({
          assetKey: item.key,
          metadata: { name: item.name, description: `${item.name} model` },
          files: {},
        })),
      },
      dbPath: Database.getPath(),
    })
    expect(disk.source).toBe("disk")
    clearAppliedPrimitiveSeed()
    writeAppliedPrimitiveSeed({
      version: disk.bundle.version,
      appliedAt: new Date().toISOString(),
      assetCount: disk.bundle.assets.length,
    })

    const again = resolvePrimitiveSeedBundle({
      projectRoot,
      bundled: {
        version: "2020.01.01+old",
        assets: disk.bundle.assets,
      },
      dbPath: Database.getPath(),
    })
    expect(again.source).toBe("disk")
    expect(again.bundle.version).toBe(disk.bundle.version)
  })

  test("resolvePrimitiveSeedBundle falls back when disk is older than applied bundled", async () => {
    await using tmp = await tmpdir()
    const projectRoot = tmp.path
    const installedAssets = path.join(
      projectRoot,
      ".opencode/oneskills/skills/onescience-primitives/assets",
    )
    const assetsList = Array.from({ length: 4 }, (_, index) => ({
      key: `climate/models/m${index}`,
      name: `m${index}`,
    }))
    for (const item of assetsList) {
      await writeAsset(installedAssets, item.key, {
        name: item.name,
        type: "model",
        domain: "meteorology",
        description: `${item.name} model`,
        tags: ["weather"],
      })
    }
    mkdirSync(path.join(projectRoot, ".opencode/oneskills"), { recursive: true })
    await Bun.write(path.join(projectRoot, ".opencode/oneskills/VERSION"), "2020.01.01\n")
    clearAppliedPrimitiveSeed()
    writeAppliedPrimitiveSeed({
      version: "2099.01.01+bundled",
      appliedAt: new Date().toISOString(),
      assetCount: 4,
    })

    const resolved = resolvePrimitiveSeedBundle({
      projectRoot,
      bundled: {
        version: "2099.01.01+bundled",
        assets: assetsList.map((item) => ({
          assetKey: item.key,
          metadata: { name: item.name, description: `${item.name} model` },
          files: {},
        })),
      },
      dbPath: Database.getPath(),
    })
    expect(resolved.source).toBe("bundled")
    expect(resolved.fallbackReason).toContain("older than applied")
  })
})
