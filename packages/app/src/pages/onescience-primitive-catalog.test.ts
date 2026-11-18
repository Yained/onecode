import { describe, expect, test } from "bun:test"
import {
  RECENT_PRIMITIVE_WINDOW_MS,
  catalogEntryToPrimitiveItem,
  enrichPrimitiveItemFromCatalog,
  filterPrimitivesByCatalogScope,
  isRecentPrimitive,
  isUserCreatedPrimitiveId,
  isUserOwnedPrimitive,
  loadAllAIPrimitives,
  mapPrimitiveResourceLink,
  modelPrimitivePublishAction,
  ownerFromCatalogSource,
  primitiveCatalogHref,
  primitiveCategoryFilterOptions,
  shouldShowPrimitiveCategoryBar,
} from "./onescience-catalog"
import type { AIPrimitiveItem } from "./onescience-primitives-types"

const item = (input: Partial<AIPrimitiveItem> & Pick<AIPrimitiveItem, "id">): AIPrimitiveItem => ({
  title: input.title ?? input.id,
  description: input.description ?? "",
  domain: input.domain ?? "材料化学",
  primitiveType: input.primitiveType ?? "data.load",
  intentTags: input.intentTags ?? [],
  status: input.status ?? "callable",
  ...input,
})

describe("primitive catalog scope", () => {
  test("marks user-owned primitives by owner or custom resource link", () => {
    const userResources = new Set(["custom-datasets-abc"])
    expect(isUserOwnedPrimitive(item({ id: "p1", owner: "local" }), userResources)).toBe(false)
    expect(isUserOwnedPrimitive(item({ id: "p1b", owner: "platform" }), userResources)).toBe(false)
    expect(isUserOwnedPrimitive(item({ id: "p1c", owner: "acct-1" }), userResources, "acct-1")).toBe(true)
    expect(isUserOwnedPrimitive(item({ id: "p2", owner: "system" }), userResources)).toBe(false)
    expect(isUserOwnedPrimitive(item({ id: "p3", sourceResourceIds: ["custom-datasets-abc"] }), userResources)).toBe(true)
    expect(isUserOwnedPrimitive(item({ id: "p4", sourceResourceIds: ["seed-datasets-earth-era5"] }), userResources)).toBe(false)
    expect(isUserCreatedPrimitiveId("primitive-32b614b8-d319-4dba-8cc8-63c8f383a62e")).toBe(true)
    expect(isUserOwnedPrimitive(item({ id: "primitive-32b614b8-d319-4dba-8cc8-63c8f383a62e" }), userResources)).toBe(true)
    expect(isUserOwnedPrimitive(item({ id: "primitive-data-earth-era5-loader", owner: "system" }), userResources)).toBe(false)
  })

  test("ignores stale inference drafts when inference is already callable", () => {
    const link = mapPrimitiveResourceLink({
      callable: item({ id: "callable-infer", primitiveType: "model.run", status: "callable" }),
      draft: item({ id: "stale-infer-draft", primitiveType: "model.run", status: "draft" }),
      inference: {
        callable: item({ id: "callable-infer", primitiveType: "model.run", status: "callable" }),
      },
    })
    expect(link.inferenceCallableId).toBe("callable-infer")
    expect(link.inferenceDraftId).toBeUndefined()
    expect(link.draftId).toBeUndefined()
    expect(modelPrimitivePublishAction(link)).toEqual({
      disabled: false,
      label: "发布训练原语",
      draftId: undefined,
      publishSlot: "training",
      initialPrimitiveType: "model.train",
    })
  })

  test("maps catalog search entries to local ownership and enriches missing fields from source", () => {
    expect(ownerFromCatalogSource("local")).toBe("local")
    expect(ownerFromCatalogSource("official")).toBe("system")
    const fromCatalog = catalogEntryToPrimitiveItem({
      id: "primitive-32b614b8-d319-4dba-8cc8-63c8f383a62e",
      kind: "primitive",
      name: "mine",
      title: "Mine",
      description: "mine",
      category: "data.load",
      tags: [],
      source: "local",
      status: "callable",
    })
    expect(fromCatalog.owner).toBe("local")
    const source = [item({
      id: "primitive-32b614b8-d319-4dba-8cc8-63c8f383a62e",
      owner: "acct-user-1",
      sourceResourceIds: ["custom-datasets-abc"],
      domain: "地球科学",
    })]
    const mine = filterPrimitivesByCatalogScope(
      [enrichPrimitiveItemFromCatalog(fromCatalog, source)],
      "mine",
      new Set(),
      "acct-user-1",
    )
    expect(mine.map((entry) => entry.id)).toEqual(["primitive-32b614b8-d319-4dba-8cc8-63c8f383a62e"])
  })

  test("filters recent primitives within seven days and sorts newest first", () => {
    const recent = item({ id: "recent", timeCreated: Date.now() - 86_400_000 })
    const old = item({ id: "old", timeCreated: Date.now() - RECENT_PRIMITIVE_WINDOW_MS - 1 })
    expect(isRecentPrimitive(recent)).toBe(true)
    expect(isRecentPrimitive(old)).toBe(false)
    expect(filterPrimitivesByCatalogScope([old, recent], "recent", new Set(), "acct-1").map((entry) => entry.id)).toEqual(["recent"])
  })

  test("hides non-preset primitives from guests", () => {
    const preset = item({
      id: "primitive-resource-seed-datasets-earth-era5",
      owner: "platform",
      title: "ERA5",
    })
    const userPublished = item({
      id: "primitive-32b614b8-d319-4dba-8cc8-63c8f383a62e",
      owner: "acct-user-1",
      title: "User Published",
    })
    const orphan = item({
      id: "primitive-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      owner: undefined,
      title: "Orphan",
    })
    expect(filterPrimitivesByCatalogScope([preset, userPublished, orphan], "all", new Set()).map((entry) => entry.id))
      .toEqual(["primitive-resource-seed-datasets-earth-era5"])
    expect(filterPrimitivesByCatalogScope([preset, userPublished], "all", new Set(), "acct-user-1").map((entry) => entry.id))
      .toEqual(["primitive-resource-seed-datasets-earth-era5", "primitive-32b614b8-d319-4dba-8cc8-63c8f383a62e"])
  })

  test("builds catalog links with highlight, scope, and detail flags", () => {
    expect(primitiveCatalogHref({ id: "primitive-1" })).toBe("/primitives?tab=catalog&highlight=primitive-1")
    expect(primitiveCatalogHref({ id: "primitive-1", scope: "mine", openDetail: true }))
      .toBe("/primitives?tab=catalog&highlight=primitive-1&scope=mine&openDetail=1")
    expect(primitiveCatalogHref({ id: "primitive-1", scope: "recent", openDetail: true }))
      .toBe("/primitives?tab=catalog&highlight=primitive-1&scope=recent&openDetail=1")
    expect(primitiveCatalogHref({ id: "primitive-1", openUse: true }))
      .toBe("/primitives?tab=catalog&highlight=primitive-1&openUse=1")
  })

  test("builds category options with counts and hides empty categories", () => {
    const items = [
      item({ id: "a", contractJson: { primitiveCategory: "model-component" } }),
      item({ id: "b", contractJson: { primitiveCategory: "model-component" } }),
      item({ id: "c", contractJson: { primitiveCategory: "dataset" } }),
    ]
    const options = primitiveCategoryFilterOptions(items)
    expect(options.find((option) => option.shortLabel === "全部")).toBeUndefined()
    expect(options.find((option) => option.shortLabel === "模型组件")?.count).toBe(2)
    expect(options.find((option) => option.shortLabel === "数据集")?.count).toBe(1)
    expect(primitiveCategoryFilterOptions([items[0]!]).map((option) => option.shortLabel)).toEqual(["模型组件"])
  })

  test("shows category bar on all scope and hides it for small scoped lists", () => {
    const items = [
      item({ id: "a", contractJson: { primitiveCategory: "model-component" } }),
      item({ id: "b", contractJson: { primitiveCategory: "dataset" } }),
    ]
    const options = primitiveCategoryFilterOptions(items)
    expect(shouldShowPrimitiveCategoryBar("all", items, options)).toBe(true)
    expect(shouldShowPrimitiveCategoryBar("mine", items, options)).toBe(false)
    expect(shouldShowPrimitiveCategoryBar("recent", items, options)).toBe(false)

    const many = Array.from({ length: 8 }, (_, index) =>
      item({
        id: `p-${index}`,
        contractJson: { primitiveCategory: index % 2 === 0 ? "model-component" : "dataset" },
      }),
    )
    const manyOptions = primitiveCategoryFilterOptions(many)
    expect(shouldShowPrimitiveCategoryBar("mine", many, manyOptions)).toBe(true)
  })
})

describe("loadAllAIPrimitives", () => {
  test("paginates through primitive list pages", async () => {
    const originalFetch = globalThis.fetch
    const calls: string[] = []
    globalThis.fetch = (async (input) => {
      const url = String(input)
      calls.push(url)
      const offset = Number(new URL(url).searchParams.get("offset") ?? "0")
      if (offset === 0) {
        return new Response(JSON.stringify({
          items: [{ id: "p-1", title: "One", description: "", domain: "其它", primitiveType: "code.generate", intentTags: [], status: "draft" }],
          nextOffset: 100,
        }), { status: 200 })
      }
      return new Response(JSON.stringify({
        items: [{ id: "p-2", title: "Two", description: "", domain: "其它", primitiveType: "code.generate", intentTags: [], status: "draft" }],
      }), { status: 200 })
    }) as typeof fetch
    try {
      const result = await loadAllAIPrimitives("http://127.0.0.1:4096")
      expect(result.loaded).toBe(true)
      expect(result.items.map((entry) => entry.id)).toEqual(["p-1", "p-2"])
      expect(calls).toHaveLength(2)
      expect(calls[0]).toContain("offset=0")
      expect(calls[0]).not.toContain("status=")
      expect(calls[1]).toContain("offset=100")
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
