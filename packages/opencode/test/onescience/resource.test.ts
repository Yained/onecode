import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { OneScienceResource } from "@/onescience/resource"
import { OneScienceResourceTable } from "@/onescience/resource.sql"
import { Database } from "@/storage/db"
import { resetDatabase } from "../fixture/db"

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await resetDatabase()
})

describe("OneScienceResource", () => {
  test("seeds built-in resource catalog into sqlite", () => {
    const result = OneScienceResource.seedDefaults()
    const rows = Database.use((db) => db.select().from(OneScienceResourceTable).all())

    expect(result.seeded).toBeGreaterThan(0)
    expect(rows.map((row) => row.page)).toContain("datasets")
    expect(rows.map((row) => row.page)).toContain("models")
    expect(rows.map((row) => row.page)).toContain("apps")
    expect(rows.map((row) => row.page)).not.toContain("skills")
    expect(rows.map((row) => row.title)).toContain("全球再分析")
    expect(rows.map((row) => row.title)).toContain("ABACUS")
    expect(rows.map((row) => row.title)).toContain("AlphaFold")
    expect(OneScienceResource.list("datasets").items[0]?.title).toBe("全球再分析")
  })

  test("built-in resource titles are unique within each page", () => {
    OneScienceResource.seedDefaults()
    const rows = Database.use((db) =>
      db.select({ page: OneScienceResourceTable.page, title: OneScienceResourceTable.title }).from(OneScienceResourceTable).all(),
    )
    const keys = rows.map((row) => `${row.page}:${row.title}`)

    expect(new Set(keys).size).toBe(keys.length)
  })

  test("lists resources by page domain", () => {
    OneScienceResource.seedDefaults()
    const earth = OneScienceResource.list("datasets", { domain: "地球科学", limit: 200 })
    const life = OneScienceResource.list("datasets", { domain: "生命科学", limit: 200 })

    expect(earth.items.length).toBeGreaterThan(0)
    expect(life.items.length).toBeGreaterThan(0)
    expect(earth.items.every((item) => item.domain === "地球科学")).toBe(true)
    expect(life.items.every((item) => item.domain === "生命科学")).toBe(true)
    expect(earth.items.map((item) => item.id)).not.toContain(life.items[0]?.id)
  })

  test("filters resources by search query", () => {
    OneScienceResource.seedDefaults()
    const result = OneScienceResource.list("models", { q: "GraphCast", limit: 50 })

    expect(result.items.length).toBeGreaterThan(0)
    expect(result.items.every((item) => item.title.toLowerCase().includes("graphcast") || item.copy.toLowerCase().includes("graphcast") || item.tags.some((tag) => tag.toLowerCase().includes("graphcast")))).toBe(true)
  })

  test("finds newly seeded modelscope bioscience datasets by search query", () => {
    OneScienceResource.seedDefaults()
    const esm2 = OneScienceResource.list("datasets", { q: "ESM-2", limit: 50 })
    const alphafold3 = OneScienceResource.list("datasets", { q: "AlphaFold3", limit: 50 })
    const protenix = OneScienceResource.list("datasets", { q: "Protenix", limit: 50 })

    expect(esm2.items.map((item) => item.title)).toContain("ESM-2数据集")
    expect(alphafold3.items.map((item) => item.title)).toContain("AlphaFold3数据集")
    expect(protenix.items.map((item) => item.title)).toContain("Protenix数据集")
  })

  test("seeds built-in catalog automatically when the database is empty", () => {
    const result = OneScienceResource.list("models", { limit: 200 })

    expect(result.items.length).toBeGreaterThan(50)
    expect(result.items.map((item) => item.title)).toContain("GraphCast")
    expect(result.items.map((item) => item.title)).toContain("AlphaFold")
  })

  test("does not restore a built-in resource after the user deletes it", () => {
    OneScienceResource.seedDefaults()
    Database.use((db) =>
      db
        .update(OneScienceResourceTable)
        .set({ time_deleted: Date.now() })
        .where(eq(OneScienceResourceTable.id, "seed-datasets-earth-era5"))
        .run(),
    )

    OneScienceResource.seedDefaults()

    const result = OneScienceResource.list("datasets", { limit: 200 })
    expect(result.items.map((item) => item.id)).not.toContain("seed-datasets-earth-era5")
  })

  test("gets a resource by id or alias", () => {
    OneScienceResource.seedDefaults()
    const canonical = OneScienceResource.get("seed-datasets-material-omat24")
    const alias = OneScienceResource.get("material-omat24")

    expect(canonical.id).toBe("seed-datasets-material-omat24")
    expect(alias.id).toBe("seed-datasets-material-omat24")
    expect(alias.title).toBe("OMat24")
  })

  test("updates and soft deletes resources", () => {
    const accountId = "acct-resource-owner"
    const created = OneScienceResource.create(
      {
        page: "apps",
        title: "自定义应用",
        copy: "用于验证更新删除",
        domain: "材料化学",
        tags: ["custom"],
        provider: "OneScience",
        size: "Python",
        format: "CPU",
        source: "local",
      },
      accountId,
    )

    expect(created.owner).toBe(accountId)

    const updated = OneScienceResource.update(
      created.id,
      {
        title: "更新后的应用",
        tags: ["custom", "updated"],
      },
      accountId,
    )
    expect(updated.title).toBe("更新后的应用")
    expect(updated.domain).toBe("材料化学")
    expect(updated.tags).toEqual(["custom", "updated"])

    expect(OneScienceResource.remove(created.id, accountId)).toBe(true)
    expect(OneScienceResource.list("apps", { accountId }).items.map((item) => item.id)).not.toContain(created.id)
  })

  test("lists only user-created resources when customOnly is enabled", () => {
    OneScienceResource.seedDefaults()
    const accountId = "acct-custom-list"
    const before = OneScienceResource.list("datasets", { customOnly: true, limit: 200, accountId })
    OneScienceResource.create(
      {
        page: "datasets",
        title: "Custom Dataset",
        copy: "user dataset",
        domain: "地球科学",
        tags: ["custom"],
        provider: "OneScience",
        size: "NetCDF",
        format: "NetCDF",
        source: "third-party",
      },
      accountId,
    )
    const after = OneScienceResource.list("datasets", { customOnly: true, limit: 200, accountId })
    expect(before.items).toHaveLength(0)
    expect(after.items).toHaveLength(1)
    expect(after.items[0]?.title).toBe("Custom Dataset")
  })

  test("paginates resources in sql without loading the full page", () => {
    OneScienceResource.seedDefaults()
    const page = OneScienceResource.list("datasets", { limit: 5, offset: 0 })
    const next = OneScienceResource.list("datasets", { limit: 5, offset: 5 })

    expect(page.items).toHaveLength(5)
    expect(next.items).toHaveLength(5)
    expect(page.items[0]?.id).not.toBe(next.items[0]?.id)
  })

  test("counts user-created resources without listing items", () => {
    OneScienceResource.seedDefaults()
    expect(OneScienceResource.customCountsByPage("acct-count")).toEqual({
      datasets: 0,
      models: 0,
      apps: 0,
      frameworks: 0,
      byDomain: { datasets: {}, models: {}, apps: {}, frameworks: {} },
    })
    OneScienceResource.create(
      {
        page: "datasets",
        title: "Custom Dataset",
        copy: "user dataset",
        domain: "地球科学",
        tags: ["custom"],
        provider: "OneScience",
        size: "NetCDF",
        format: "NetCDF",
        source: "third-party",
      },
      "acct-count",
    )
    expect(OneScienceResource.customCountsByPage("acct-count")).toEqual({
      datasets: 1,
      models: 0,
      apps: 0,
      frameworks: 0,
      byDomain: { datasets: { 地球科学: 1 }, models: {}, apps: {}, frameworks: {} },
    })
    expect(OneScienceResource.customCountsByPage("acct-other").datasets).toBe(0)
    expect(OneScienceResource.customCountsByPage("").datasets).toBe(0)
  })

  test("exposes and deletes ownerless legacy custom uploads for any signed-in account", () => {
    OneScienceResource.seedDefaults()
    const orphan = OneScienceResource.create(
      {
        page: "models",
        title: "Legacy Orphan Model",
        copy: "pre-auth residue",
        domain: "地球科学",
        tags: ["custom"],
        provider: "OneScience",
        size: "PyTorch",
        format: "GPU",
        source: "local",
      },
      "acct-seed",
    )
    Database.use((db) =>
      db.update(OneScienceResourceTable).set({ owner: null }).where(eq(OneScienceResourceTable.id, orphan.id)).run(),
    )

    const forGuest = OneScienceResource.list("models", { customOnly: true, limit: 50, accountId: "" })
    expect(forGuest.items.some((item) => item.id === orphan.id)).toBe(true)

    const forA = OneScienceResource.list("models", { customOnly: true, limit: 50, accountId: "acct-a" })
    expect(forA.items.some((item) => item.id === orphan.id)).toBe(true)

    expect(OneScienceResource.remove(orphan.id, "acct-b")).toBe(true)
    expect(
      OneScienceResource.list("models", { customOnly: true, limit: 50, accountId: "acct-a" }).items.some(
        (item) => item.id === orphan.id,
      ),
    ).toBe(false)
  })

  test("hides other accounts' uploads and blocks preset deletion", () => {
    OneScienceResource.seedDefaults()
    const mine = OneScienceResource.create(
      {
        page: "models",
        title: "My Model",
        copy: "private model",
        domain: "地球科学",
        tags: ["custom"],
        provider: "OneScience",
        size: "PyTorch",
        format: "GPU",
        source: "local",
      },
      "acct-a",
    )
    OneScienceResource.create(
      {
        page: "models",
        title: "Other Model",
        copy: "someone else",
        domain: "地球科学",
        tags: ["custom"],
        provider: "OneScience",
        size: "PyTorch",
        format: "GPU",
        source: "local",
      },
      "acct-b",
    )

    const forA = OneScienceResource.list("models", { customOnly: true, limit: 50, accountId: "acct-a" })
    expect(forA.items.map((item) => item.title)).toEqual(["My Model"])
    expect(OneScienceResource.list("models", { customOnly: true, accountId: "" }).items).toHaveLength(0)

    const seed = OneScienceResource.list("datasets", { limit: 1 }).items[0]
    expect(seed).toBeTruthy()
    expect(() => OneScienceResource.remove(seed!.id, "acct-a")).toThrow("Preset resources cannot be deleted")
    const renamed = OneScienceResource.update(seed!.id, { title: "Preset Edited" }, "acct-a")
    expect(renamed.title).toBe("Preset Edited")
    expect(() => OneScienceResource.update(mine.id, { title: "Stolen" }, "acct-b")).toThrow(
      "Only the owning account can modify this resource",
    )
  })

  test("rejects oversized create and update payloads", async () => {
    const { Schema } = await import("effect")
    const decodeCreate = Schema.decodeUnknownSync(OneScienceResource.CreateResource)
    const decodeUpdate = Schema.decodeUnknownSync(OneScienceResource.UpdateResource)

    expect(() =>
      decodeCreate({
        page: "datasets",
        title: "x".repeat(OneScienceResource.resourceFieldLimits.title + 1),
        copy: "描述",
        domain: "地球科学",
        tags: ["custom"],
        provider: "OneScience",
        size: "NetCDF",
        format: "NetCDF",
        source: "third-party",
      }),
    ).toThrow()

    expect(() =>
      decodeUpdate({
        copy: "y".repeat(OneScienceResource.resourceFieldLimits.copy + 1),
      }),
    ).toThrow()

    expect(
      decodeCreate({
        page: "models",
        title: "Valid Model",
        copy: "valid copy",
        domain: "材料化学",
        tags: ["mlff"],
        provider: "OneScience",
        size: "PyTorch",
        format: "Checkpoint",
        source: "onescience",
      }).title,
    ).toBe("Valid Model")
  })
})
