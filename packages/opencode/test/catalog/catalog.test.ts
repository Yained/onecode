import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "fs"
import path from "path"
import { Result, Schema } from "effect"
import { Global } from "@opencode-ai/core/global"
import { Catalog } from "@/catalog/index"
import { CatalogEmbedding } from "@/catalog/embedding"
import { CatalogEntryTable } from "@/catalog/index.sql"
import { CatalogMockStore } from "@/catalog/mock-store"
import { AIPrimitive } from "@/onescience/primitive"
import { migrateStaticPrimitives } from "@/onescience/primitive-migration"
import { oneskillsPrimitiveId } from "@/onescience/oneskills-primitive-ingest"
import { emptyCatalogSearchHint, SearchParameters } from "@/tool/catalog"
import { Database } from "@/storage/db"
import { eq } from "drizzle-orm"
import { tmpdir } from "../fixture/fixture"
import { writeDefaultOneskillsTestAssets, writeOneskillsAsset } from "../onescience/oneskills-test-assets"
import { resetDatabase } from "../fixture/db"

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await resetDatabase()
})


async function migrateCatalogOneskillsAssets() {
  const tmp = await tmpdir()
  const assetsRoot = path.join(tmp.path, "assets")
  await writeDefaultOneskillsTestAssets(assetsRoot)
  migrateStaticPrimitives({ assetsRoot })
  return tmp
}

describe("Catalog", () => {
  test("declares CatalogApi middleware after endpoints so Authorization wraps handlers", async () => {
    const source = await Bun.file(
      new URL("../../src/server/routes/instance/httpapi/groups/catalog.ts", import.meta.url),
    ).text()
    const group = source.slice(source.indexOf('HttpApiGroup.make("catalog")'))
    const addAt = group.indexOf(".add(")
    const authAt = group.indexOf(".middleware(Authorization)")
    expect(addAt).toBeGreaterThanOrEqual(0)
    expect(authAt).toBeGreaterThan(addAt)
  })

  test("indexes callable primitives and searches by query", async () => {
    await using _tmp = await migrateCatalogOneskillsAssets()
    Catalog.reconcile()

    const all = Catalog.search({ kind: "primitive", k: 5 })
    expect(all.items.length).toBeGreaterThan(0)

    const tag = all.items[0]!.tags[0]
    expect(tag).toBeDefined()
    const tagged = Catalog.search({ kind: "primitive", tags: [tag!], k: 5 })
    expect(tagged.items.some((item) => item.id === all.items[0]!.id)).toBe(true)
  })

  test("indexes skills by OneSkills architecture type", () => {
    Catalog.ingestSkills({
      runtime: [
        {
          name: "onescience-orchestrator",
          description: "Task orchestrator",
          location: "/tmp/project/.opencode/oneskills/skills/onescience-orchestrator/SKILL.md",
        },
        {
          name: "onescience-primitives",
          description: "Resource recall",
          location: "/tmp/project/.opencode/oneskills/skills/onescience-primitives/SKILL.md",
          skillType: "resource",
        },
        {
          name: "onescience-research-workflow",
          description: "Workflow planner",
          location: "/tmp/project/.opencode/oneskills/skills/onescience-research-workflow/SKILL.md",
          skillType: "expert",
        },
        {
          name: "onescience-coder",
          description: "Coding executor",
          location: "/tmp/project/.opencode/oneskills/skills/onescience-coder/SKILL.md",
          skillType: "executor",
        },
      ],
    })

    const orchestrator = Catalog.search({ kind: "skill", category: "orchestrator", k: 10 })
    const resource = Catalog.search({ kind: "skill", category: "resource", k: 10 })
    const expert = Catalog.search({ kind: "skill", category: "expert", k: 10 })
    const executor = Catalog.search({ kind: "skill", category: "executor", k: 10 })

    expect(orchestrator.items.map((item) => item.name)).toContain("onescience-orchestrator")
    expect(resource.items.map((item) => item.name)).toContain("onescience-primitives")
    expect(expert.items.map((item) => item.name)).toContain("onescience-research-workflow")
    expect(executor.items.map((item) => item.name)).toContain("onescience-coder")
  })

  test("syncs skills into catalog search", () => {
    Catalog.ingestSkills({
      runtime: [
        {
          name: "onescience-workflow",
          description: "OneScience workflow entry skill",
          location: "/tmp/project/.opencode/oneskills/skills/onescience-workflow/SKILL.md",
        },
      ],
    })

    const result = Catalog.search({ kind: "skill", q: "workflow", k: 5 })
    expect(result.items.map((item) => item.name)).toContain("onescience-workflow")
    expect(result.items[0]?.source).toBe("official")
  })

  test("syncs configured repo skills into catalog search", () => {
    const repoRoot = path.join(Global.Path.repos, "github.com", "obra", "superpowers", "skills")
    Catalog.syncRuntimeSkills(
      [
        {
          name: "brainstorming",
          description: "Design before implementation",
          location: path.join(repoRoot, "brainstorming", "SKILL.md"),
        },
      ],
      "/tmp/project",
    )

    const result = Catalog.search({ kind: "skill", q: "brainstorming", k: 5 })
    expect(result.items.map((item) => item.name)).toContain("brainstorming")
    expect(result.items.find((item) => item.name === "brainstorming")?.source).toBe("repo")
  })

  test("syncs uploaded user skills into catalog search", () => {
    Catalog.syncRuntimeSkills(
      [
        {
          name: "custom-demo",
          description: "User uploaded custom skill",
          location: "/tmp/project/.opencode/skills/custom-demo/SKILL.md",
        },
      ],
      "/tmp/project",
    )

    const result = Catalog.search({ kind: "skill", q: "custom-demo", k: 5 })
    expect(result.items.map((item) => item.name)).toContain("custom-demo")
  })

  test("filters skills page results to official OneSkills only", () => {
    const repoRoot = path.join(Global.Path.repos, "github.com", "obra", "superpowers", "skills")
    Catalog.syncRuntimeSkills(
      [
        {
          name: "custom-demo",
          description: "User uploaded custom skill",
          location: "/tmp/project/.opencode/skills/custom-demo/SKILL.md",
        },
        {
          name: "brainstorming",
          description: "Repo skill",
          location: path.join(repoRoot, "brainstorming", "SKILL.md"),
        },
        {
          name: "onescience-coder",
          description: "Official OneSkills skill",
          location: "/tmp/project/.opencode/oneskills/skills/onescience-coder/SKILL.md",
        },
        // Newly released skill under oneskills tree — must appear even if not yet
        // listed in the hardcoded OFFICIAL_SKILL_NAMES allowlist.
        {
          name: "onescience-infer",
          description: "Official OneSkills infer skill",
          location: "/tmp/project/.opencode/oneskills/skills/onescience-infer/SKILL.md",
        },
      ],
      "/tmp/project",
    )

    const all = Catalog.search({ kind: "skill", k: 20 })
    expect(all.items.map((item) => item.name)).toContain("custom-demo")
    expect(all.items.map((item) => item.name)).toContain("brainstorming")
    expect(all.items.map((item) => item.name)).toContain("onescience-coder")
    expect(all.items.map((item) => item.name)).toContain("onescience-infer")

    const official = Catalog.search({ kind: "skill", officialOnly: true, k: 20 })
    expect(official.items.map((item) => item.name)).toContain("onescience-coder")
    expect(official.items.map((item) => item.name)).toContain("onescience-infer")
    expect(official.items.map((item) => item.name)).not.toContain("custom-demo")
    expect(official.items.map((item) => item.name)).not.toContain("brainstorming")
  })

  test("resolves skill body from disk", () => {
    const skillPath = "/tmp/project/.opencode/oneskills/skills/onescience-workflow/SKILL.md"
    mkdirSync(path.dirname(skillPath), { recursive: true })
    writeFileSync(skillPath, "---\nname: onescience-workflow\ndescription: workflow\n---\n\n# Workflow\n")

    Catalog.ingestSkills({
      runtime: [
        {
          name: "onescience-workflow",
          description: "OneScience workflow entry skill",
          location: skillPath,
        },
      ],
    })

    const body = Catalog.resolve("skill:onescience-workflow", "body") as {
      location?: string
      content?: string
      frontmatter?: Record<string, unknown>
    }
    expect(body.location).toBe(skillPath)
    expect(body.content).toContain("# Workflow")
    expect(body.frontmatter?.name).toBe("onescience-workflow")
    expect(body.frontmatter?.description).toBe("workflow")
  })

  test("embeds catalog entries during reconcile", () => {
    process.env.CATALOG_EMBEDDING_MODE = "local"
    Catalog.ingestSkills({
      runtime: [
        {
          name: "onescience-runtime",
          description: "Run remote jobs and observe execution logs",
          location: "/tmp/project/.opencode/oneskills/skills/onescience-runtime/SKILL.md",
        },
      ],
    })

    const result = Catalog.search({ kind: "skill", q: "remote execution logs", k: 5 })
    expect(result.items.map((item) => item.name)).toContain("onescience-runtime")
  })

  test("auto embeds callable primitives from portal sync", () => {
    process.env.CATALOG_EMBEDDING_MODE = "local"
    const created = AIPrimitive.create({
      title: "Auto Embed Primitive",
      description: "Should receive a catalog embedding after becoming callable",
      domain: "地球科学",
      primitiveType: "data.load",
      intentTags: ["auto-embed"],
    })
    const callable = AIPrimitive.update(created.id, { status: "callable" })
    const row = Database.use((db) =>
      db.select().from(CatalogEntryTable).where(eq(CatalogEntryTable.id, callable.id)).get(),
    )
    expect(row?.embedding_json?.length).toBeGreaterThan(0)
    expect(row?.embedding_model).toBe(CatalogEmbedding.LOCAL_MODEL_ID)
  })

  test("resolves primitive contract and mock location", async () => {
    await using _tmp = await migrateCatalogOneskillsAssets()
    Catalog.reconcile()
    const listed = Catalog.search({ kind: "primitive", q: "weather", k: 1 })
    const id = listed.items[0]?.id
    expect(id).toBeDefined()

    const contract = Catalog.resolve(id!, "contract")
    expect(contract).toHaveProperty("contractJson")

    const location = Catalog.resolve(id!, "location")
    expect(location).toHaveProperty("location")
  })

  test("resolve body returns oneskills companions after selection", async () => {
    await using tmp = await tmpdir()
    const assetsRoot = path.join(tmp.path, "assets")
    await writeOneskillsAsset(
      assetsRoot,
      "climate/models/fuxi",
      {
        name: "fuxi",
        type: "model",
        domain: "meteorology",
        description: "FuXi forecast primitive",
        tags: ["weather-forecast", "fuxi"],
        version: "1.0.0",
      },
      {
        "spec.md": "# FuXi spec",
        "usage.md": "# FuXi usage",
        "workflow_planning.md": "# FuXi planning",
      },
    )
    migrateStaticPrimitives({ assetsRoot })
    Catalog.reconcile()

    const id = oneskillsPrimitiveId("climate/models/fuxi")
    const body = Catalog.resolve(id, "body") as {
      companions?: Record<string, string>
      contractJson?: { agentContract?: { usage?: string[] } }
    }
    expect(body.companions).toMatchObject({
      "spec.md": "# FuXi spec",
      "usage.md": "# FuXi usage",
      "workflow_planning.md": "# FuXi planning",
    })

    const usage = body.contractJson?.agentContract?.usage ?? []
    expect(usage.some((step) => step.includes("catalog_resolve") && step.includes("body"))).toBe(true)
  })

  test("AIPrimitive CRUD keeps catalog index in sync", () => {
    const created = AIPrimitive.create({
      title: "Catalog Sync Primitive",
      description: "Draft should not appear in catalog search",
      domain: "地球科学",
      primitiveType: "model.run",
      intentTags: ["sync-test"],
    })
    expect(Catalog.listEntryIds("primitive")).not.toContain(created.id)

    const callable = AIPrimitive.update(created.id, { status: "callable" })
    expect(Catalog.listEntryIds("primitive")).toContain(callable.id)
    expect(Catalog.search({ kind: "primitive", q: "Catalog Sync", k: 5 }).items.map((item) => item.id)).toContain(callable.id)

    AIPrimitive.remove(callable.id)
    expect(Catalog.listEntryIds("primitive")).not.toContain(callable.id)
  })

  test("skips blob write when primitive has explicit href location", () => {
    const created = AIPrimitive.create({
      title: "Remote Dataset Loader",
      description: "Primitive backed by href",
      domain: "地球科学",
      primitiveType: "data.load",
      intentTags: ["href"],
      adapterJson: { href: "https://example.com/dataset" },
    })
    AIPrimitive.update(created.id, { status: "callable" })
    Catalog.syncPrimitiveFromRecord(AIPrimitive.get(created.id))

    expect(CatalogMockStore.readMockBlob(created.id)).toBeUndefined()
    const location = Catalog.resolve(created.id, "location") as { location: { type: string } }
    expect(location.location.type).toBe("href")
  })

  test("mock colleague blob is written on primitive create sync path", () => {
    const created = AIPrimitive.create({
      title: "Mock Dataset Loader",
      description: "Temporary mock primitive for catalog integration",
      domain: "地球科学",
      primitiveType: "data.load",
      intentTags: ["mock", "dataset"],
      contractJson: { targetPrimitiveType: "dataset" },
      adapterJson: { mode: "documentation" },
    })

    CatalogMockStore.writeMockBlob(created.id, {
      id: created.id,
      title: created.title,
      contractJson: created.contractJson,
    })

    AIPrimitive.update(created.id, { status: "callable" })
    Catalog.syncPrimitiveFromRecord(AIPrimitive.get(created.id))

    const found = Catalog.search({ kind: "primitive", q: "Mock Dataset", k: 5 })
    expect(found.items.map((item) => item.id)).toContain(created.id)
    const location = Catalog.resolve(created.id, "location") as { location: { type: string }; blob?: unknown }
    expect(location.location.type).toBe("local_blob")
    expect(CatalogMockStore.readMockBlob(created.id)).toMatchObject({ id: created.id })
  })

  test("maps primitive source to official or local", async () => {
    await using _tmp = await migrateCatalogOneskillsAssets()
    Catalog.reconcile()

    const official = Catalog.search({ kind: "primitive", source: "official", k: 5 })
    expect(official.items.length).toBeGreaterThan(0)
    expect(official.items.every((item) => item.source === "official")).toBe(true)

    const created = AIPrimitive.create({
      title: "User Upload Loader",
      description: "User-owned primitive",
      domain: "材料化学",
      primitiveType: "data.load",
      intentTags: ["user"],
      contractJson: { targetPrimitiveType: "dataset" },
      adapterJson: { href: "https://example.com/dataset" },
    })
    AIPrimitive.update(created.id, { status: "callable", owner: "zhangjing8" })
    Catalog.syncPrimitiveFromRecord(AIPrimitive.get(created.id))

    const local = Catalog.search({ kind: "primitive", source: "local", q: "User Upload", k: 5 })
    expect(local.items.some((item) => item.id === created.id)).toBe(true)
    expect(local.items.find((item) => item.id === created.id)?.source).toBe("local")
  })

  test("filters primitives by domain", async () => {
    await using _tmp = await migrateCatalogOneskillsAssets()
    Catalog.reconcile()

    const result = Catalog.search({ kind: "primitive", domain: "地球科学", k: 5 })
    expect(result.items.length).toBeGreaterThan(0)
    expect(result.items.every((item) => item.kind === "primitive")).toBe(true)
  })

  test("domain filter accepts English slug aliases for Chinese labels", async () => {
    await using tmp = await tmpdir()
    const assetsRoot = path.join(tmp.path, "assets")
    await writeOneskillsAsset(assetsRoot, "bio/visualization/complex_structure_visualization", {
      name: "complex_structure_visualization",
      type: "visualization",
      domain: "bio",
      description: "Interactive complex structure visualization for AlphaFold3 outputs",
      tags: ["mmcif", "pdb", "plddt", "pae", "alphafold3", "3dmol", "interactive-3d"],
      version: "1.0.0",
    })
    migrateStaticPrimitives({ assetsRoot })
    Catalog.reconcile()

    const id = oneskillsPrimitiveId("bio/visualization/complex_structure_visualization")
    const bySlug = Catalog.search({
      kind: "primitive",
      q: "complex_structure_visualization",
      domain: "bio",
      k: 10,
    })
    expect(bySlug.items.map((item) => item.id)).toContain(id)

    const byLabel = Catalog.search({
      kind: "primitive",
      q: "complex_structure_visualization",
      domain: "生命科学",
      k: 10,
    })
    expect(byLabel.items.map((item) => item.id)).toContain(id)

    const wrongDomain = Catalog.search({
      kind: "primitive",
      q: "complex_structure_visualization",
      domain: "climate",
      k: 10,
    })
    expect(wrongDomain.items.map((item) => item.id)).not.toContain(id)
  })

  test("searches era5 to the oneskills ERA5 primitive", async () => {
    await using tmp = await tmpdir()
    const assetsRoot = path.join(tmp.path, "assets")
    await writeOneskillsAsset(assetsRoot, "climate/datapipes/era5", {
      name: "ERA5 Data Loader",
      type: "datapipe",
      domain: "meteorology",
      description: "ERA5 datapipe primitive",
      tags: ["era5", "weather"],
      version: "1.0.0",
    })
    migrateStaticPrimitives({ assetsRoot })
    Catalog.reconcile()

    const result = Catalog.search({ kind: "primitive", q: "era5", k: 50 })
    expect(result.items.map((item) => item.id)).toEqual([oneskillsPrimitiveId("climate/datapipes/era5")])
    expect(result.items.map((item) => item.title)).toEqual(["ERA5 Data Loader"])
  })

  test("removes deleted primitives from catalog index", () => {
    const created = AIPrimitive.create({
      title: "Temporary Primitive",
      description: "Will be deleted",
      domain: "生命科学",
      primitiveType: "model.run",
      intentTags: ["temp"],
    })
    AIPrimitive.update(created.id, { status: "callable" })
    expect(Catalog.listEntryIds("primitive")).toContain(created.id)

    AIPrimitive.remove(created.id)
    expect(Catalog.listEntryIds("primitive")).not.toContain(created.id)
  })

  test("SearchInput domain enum accepts aliases and rejects free-form values", () => {
    expect(Result.isSuccess(Schema.decodeUnknownResult(Catalog.SearchInput)({ kind: "primitive", domain: "bio" }))).toBe(
      true,
    )
    expect(
      Result.isSuccess(Schema.decodeUnknownResult(Catalog.SearchInput)({ kind: "primitive", domain: "生命科学" })),
    ).toBe(true)
    expect(
      Result.isSuccess(Schema.decodeUnknownResult(Catalog.SearchInput)({ kind: "primitive", domain: "life science" })),
    ).toBe(false)
    expect(Result.isSuccess(Schema.decodeUnknownResult(SearchParameters)({ kind: "primitive", domain: "climate" }))).toBe(
      true,
    )
    expect(
      Result.isSuccess(Schema.decodeUnknownResult(SearchParameters)({ kind: "primitive", domain: "earth science" })),
    ).toBe(false)
  })

  test("empty catalog search hint distinguishes domain filter", () => {
    expect(emptyCatalogSearchHint({ domain: "bio" })).toContain("domain=bio is a valid domain value")
    expect(emptyCatalogSearchHint({ domain: "bio", tags: ["___no_such_tag___"] })).toContain(
      "tags filter is likely too strict",
    )
    expect(emptyCatalogSearchHint({ domain: "bio", tags: ["___no_such_tag___"] })).toContain(
      "before changing domain",
    )
    expect(emptyCatalogSearchHint({})).toContain("Broaden q")
  })
})
