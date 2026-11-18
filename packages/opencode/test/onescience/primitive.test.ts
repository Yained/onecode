import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { AIPrimitive } from "@/onescience/primitive"
import { AIPrimitiveTable } from "@/onescience/primitive.sql"
import { migratePrimitives, migrateStaticPrimitives, migrateResourceDerivedDescriptions } from "@/onescience/primitive-migration"
import { oneskillsPrimitiveId } from "@/onescience/oneskills-primitive-ingest"
import { OneScienceResource } from "@/onescience/resource"
import { ExperimentalHttpApiServer } from "@/server/routes/instance/httpapi/server"
import { Database } from "@/storage/db"
import { Context } from "effect"
import { eq } from "drizzle-orm"
import { tmpdir } from "../fixture/fixture"
import { emptyAssetsRoot, writeDefaultOneskillsTestAssets } from "./oneskills-test-assets"
import { resetDatabase } from "../fixture/db"

const primitiveHttpContext = Context.empty() as Context.Context<unknown>

async function primitiveHttpRequest(path: string, init?: RequestInit) {
  return ExperimentalHttpApiServer.webHandler().handler(
    new Request(`http://localhost${path}`, {
      ...init,
      headers: {
        "x-opencode-directory": process.cwd(),
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    }),
    primitiveHttpContext,
  )
}

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await resetDatabase()
})


async function migrateWithOneskillsAssets() {
  const tmp = await tmpdir()
  const assetsRoot = `${tmp.path}/assets`
  await writeDefaultOneskillsTestAssets(assetsRoot)
  migrateStaticPrimitives({ assetsRoot })
  return tmp
}

async function migrateWithoutOneskillsAssets() {
  const tmp = await tmpdir()
  migrateStaticPrimitives({ assetsRoot: emptyAssetsRoot(tmp.path) })
  return tmp
}

describe("AIPrimitive", () => {
  test("migrates resource-derived primitives with source metadata", () => {
    migratePrimitives([
      {
        id: "primitive-data-earth-era5-loader",
        title: "ERA5 Data Loader",
        copy: "加载 ERA5 单层再分析数据，支持气象变量、时间范围和区域裁剪。",
        tags: ["Data Resources", "skill:onescience-coder", "source:datasets", "resource:earth-era5", "weather", "reanalysis"],
        provider: "Copernicus CDS",
        size: "data.load",
        format: "NetCDF/GRIB",
        href: "https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels",
      },
    ])

    const created = AIPrimitive.get("primitive-data-earth-era5-loader")

    expect(created.primitiveType).toBe("data.load")
    expect(created.targetPrimitiveType).toBe("data.process")
    expect(created.capabilityFamilies).toEqual(expect.arrayContaining(["data.building"]))
    expect(created.taskProfiles).toEqual(expect.arrayContaining(["dataset-building", "data-analysis"]))
    expect(created.executionSkills).toEqual(expect.arrayContaining(["onescience-coder"]))
    expect(created.sourceResourceIds).toEqual(["earth-era5"])
    expect(created.intentTags).toEqual(["weather", "reanalysis"])
    expect(created.adapterJson).toEqual({
      mode: "resource_reference",
      page: "datasets",
      resourceId: "earth-era5",
      href: "https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels",
    })
    expect(created.contractJson).toMatchObject({
      id: "data-earth-era5-loader",
      name: "ERA5 Data Loader",
      intent: ["weather", "reanalysis"],
      sourceResourceIds: ["earth-era5"],
      primitiveType: "data.load",
      primitiveCategory: "data-processing",
    })
  })

  test("updates existing static primitives with category bindings", () => {
    migratePrimitives([
      {
        id: "primitive-model-aurora-runner",
        title: "Aurora Weather Runner",
        copy: "旧描述",
        tags: ["Model Resources", "source:models", "resource:earth-aurora", "weather"],
        provider: "Microsoft Research",
        size: "model.run",
        format: "PyTorch",
        href: "https://example.com/old",
      },
    ])

    migratePrimitives([
      {
        id: "primitive-model-aurora-runner",
        title: "Aurora Weather Runner",
        copy: "新描述",
        tags: ["Model Resources", "category:model-inference", "skill:onescience-runtime", "source:models", "resource:earth-aurora", "weather"],
        provider: "Microsoft Research",
        size: "model.run",
        format: "PyTorch",
        href: "https://example.com/new",
      },
    ])

    const updated = AIPrimitive.get("primitive-model-aurora-runner")

    expect(updated.description).toBe("新描述")
    expect(updated.targetPrimitiveType).toBe("model.infer")
    expect(updated.capabilityFamilies).toEqual(expect.arrayContaining(["inference.evaluation", "runtime.deployment"]))
    expect(updated.taskProfiles).toEqual(expect.arrayContaining(["model-inference-testing", "research-workflow-building", "paper-reproduction"]))
    expect(updated.executionSkills).toEqual(expect.arrayContaining(["onescience-runtime"]))
    expect(updated.intentTags).toEqual(["weather"])
    expect(updated.contractJson?.primitiveCategory).toBe("model-inference")
  })

  test("enriches primitive contracts with onescience-coder asset guidance", () => {
    migratePrimitives([
      {
        id: "primitive-data-earth-era5-loader",
        title: "ERA5 Data Loader",
        copy: "加载 ERA5 单层再分析数据，支持气象变量、时间范围和区域裁剪。",
        tags: ["Data Resources", "category:dataset", "skill:onescience-coder", "source:datasets", "resource:earth-era5", "weather"],
        provider: "Copernicus CDS",
        size: "data.load",
        format: "NetCDF/GRIB",
        href: "https://example.com/era5",
      },
      {
        id: "primitive-module-earth-attention-2d",
        title: "EarthAttention2D",
        copy: "二维窗口多头自注意力组件。",
        tags: ["AI Modules", "category:model-component", "skill:onescience-coder", "attention", "earthattention2d.py", "weather"],
        provider: "onescience.modules.attention",
        size: "nn.Module",
        format: "PyTorch",
        href: "https://example.com/earthattention2d.py",
      },
    ])

    const era5 = AIPrimitive.get("primitive-data-earth-era5-loader")
    const attention = AIPrimitive.get("primitive-module-earth-attention-2d")

    const era5Contract = era5.contractJson?.agentContract as { assetSkill?: string; matchedAssets?: { path?: string; kind?: string; content?: string }[] } | undefined
    const attentionContract = attention.contractJson?.agentContract as { assetSkill?: string; matchedAssets?: { path?: string; kind?: string; content?: string }[] } | undefined

    expect(era5Contract?.assetSkill).toBe("onescience-coder")
    expect(era5Contract?.matchedAssets?.[0]?.path).toBe("skills/onescience-coder/assets/datapipes/era5.md")
    expect(era5Contract?.matchedAssets?.[0]?.kind).toBe("datapipes")
    expect(era5Contract?.matchedAssets?.[0]?.content).toContain("ERA5Datapipe")
    expect(attentionContract?.assetSkill).toBe("onescience-coder")
    expect(attentionContract?.matchedAssets?.[0]?.path).toBe("skills/onescience-coder/assets/contracts/earthattention2d.md")
    expect(attentionContract?.matchedAssets?.[0]?.kind).toBe("contracts")
    expect(attentionContract?.matchedAssets?.[0]?.content).toContain("支持输入")
  })

  test("derives dataset and model primitives from database resources", async () => {
    OneScienceResource.seedDefaults()
    await using _tmp = await migrateWithoutOneskillsAssets()

    const firstPage = AIPrimitive.listWithResources({ limit: 100 })
    const secondPage = AIPrimitive.listWithResources({ limit: 100, offset: 100 })
    const thirdPage = AIPrimitive.listWithResources({ limit: 100, offset: 200 })
    const items = [...firstPage.items, ...secondPage.items, ...thirdPage.items]

    expect(items.length).toBeGreaterThan(200)
    expect(items.some((item) => item.sourceResourceIds?.includes("seed-datasets-earth-era5") && item.contractJson?.primitiveCategory === "dataset")).toBe(true)
    expect(items.some((item) => item.sourceResourceIds?.includes("seed-models-modelhub") && item.contractJson?.primitiveCategory === "model-inference")).toBe(true)
    expect(items.find((item) => item.sourceResourceIds?.includes("seed-datasets-earth-era5"))?.resources?.[0]).toMatchObject({ id: "seed-datasets-earth-era5", page: "datasets", relationType: "source" })
  })

  test("enriches resource-derived primitive contracts with coder asset contracts", async () => {
    OneScienceResource.seedDefaults()
    await using _tmp = await migrateWithoutOneskillsAssets()

    const era5 = AIPrimitive.get("primitive-resource-seed-datasets-earth-era5")
    const fourcastnet = AIPrimitive.get("primitive-resource-seed-models-modelhub-fourcastnet")
    const openfoam = AIPrimitive.get("primitive-resource-seed-apps-openfoam")
    const era5Contract = era5.contractJson?.agentContract as { resourceContract?: { requiredInputs?: string[]; outputs?: string[]; implementationSteps?: string[]; acceptanceCriteria?: string[] }; matchedAssets?: { path?: string; kind?: string; content?: string }[] } | undefined
    const fourcastnetContract = fourcastnet.contractJson?.agentContract as { resourceContract?: { requiredInputs?: string[]; outputs?: string[]; implementationSteps?: string[]; acceptanceCriteria?: string[] }; matchedAssets?: { path?: string; kind?: string; content?: string }[] } | undefined
    const openfoamContract = openfoam.contractJson?.agentContract as { matchedAssets?: { path?: string; kind?: string }[]; resourceContract?: { implementationSteps?: string[] } } | undefined

    expect(era5Contract?.matchedAssets?.map((asset) => asset.path)).toContain("skills/onescience-coder/assets/datapipes/era5.md")
    expect(era5Contract?.resourceContract?.requiredInputs).toContain("resourceId: seed-datasets-earth-era5")
    expect(era5Contract?.resourceContract?.outputs).toContain("typed resource adapter result")
    expect(era5Contract?.resourceContract?.acceptanceCriteria?.length).toBeGreaterThan(2)
    expect(fourcastnetContract?.matchedAssets?.map((asset) => asset.path)).toContain("skills/onescience-coder/assets/models/fourcastnet.md")
    expect(fourcastnetContract?.resourceContract?.implementationSteps?.some((step) => step.includes("模型资源"))).toBe(true)
    expect(openfoamContract?.matchedAssets?.some((asset) => asset.kind === "contracts")).toBe(true)
    expect(openfoamContract?.resourceContract?.implementationSteps?.some((step) => step.includes("科研工作流"))).toBe(true)
  })

  test("embeds ModelScope resource sync commands in oneskills seeded callable contracts", async () => {
    OneScienceResource.seedDefaults()
    await using _tmp = await migrateWithOneskillsAssets()

    const graphcast = AIPrimitive.get(oneskillsPrimitiveId("climate/models/graphcast"))
    const era5 = AIPrimitive.get(oneskillsPrimitiveId("climate/datapipes/era5"))
    const graphcastContract = graphcast.contractJson?.agentContract as {
      usage?: string[]
      resourceContract?: { requiredInputs?: string[]; implementationSteps?: string[] }
    } | undefined
    const era5Contract = era5.contractJson?.agentContract as {
      resourceContract?: { requiredInputs?: string[]; implementationSteps?: string[] }
    } | undefined

    expect(graphcastContract?.resourceContract?.requiredInputs?.some((line) =>
      line.startsWith("resourceSync: modelscope download --model OneScience/GraphCast"),
    )).toBe(true)
    expect(graphcastContract?.usage?.[0]).toContain("catalog_resolve")
    expect(graphcastContract?.usage?.[0]).toContain("body")
    expect(graphcastContract?.usage?.some((step) => step.includes("resourceSync"))).toBe(true)
    expect(graphcastContract?.resourceContract?.implementationSteps?.[0]).toContain("resourceSync")
    expect(era5Contract?.resourceContract?.requiredInputs?.some((line) =>
      line.startsWith("storage: modelscope download --dataset OneScience/ERA5"),
    )).toBe(true)
  })

  test("creates primitives with json record metadata", () => {
    const created = AIPrimitive.create({
      title: "ERA5 Loader",
      description: "Loads ERA5 data",
      domain: "地球科学",
      primitiveType: "data.load",
      intentTags: ["era5", "loader"],
      contractJson: { input: "date-range", required: true },
      adapterJson: { mode: "script" },
    })

    expect(created.contractJson).toMatchObject({ input: "date-range", required: true })
    expect(created.adapterJson).toEqual({ mode: "script" })
  })

  test("keeps resource-derived primitive descriptions as resource copy", async () => {
    OneScienceResource.seedDefaults()
    await using _tmp = await migrateWithoutOneskillsAssets()

    const fourcastnet = AIPrimitive.get("primitive-resource-seed-models-modelhub-fourcastnet")
    expect(fourcastnet.description).toBe("NVIDIA 全球高分辨率神经算子天气预报模型")
    expect(fourcastnet.description).not.toContain("接入为可调用")
  })

  test("strips legacy resource-derived description prefixes", async () => {
    OneScienceResource.seedDefaults()
    await using _tmp = await migrateWithoutOneskillsAssets()
    Database.use((db) => {
      db.update(AIPrimitiveTable)
        .set({
          description: "将模型库资源「FourCastNet」接入为可调用模型推理原语：NVIDIA 全球高分辨率神经算子天气预报模型",
          time_updated: Date.now(),
        })
        .where(eq(AIPrimitiveTable.id, "primitive-resource-seed-models-modelhub-fourcastnet"))
        .run()
    })

    const result = migrateResourceDerivedDescriptions()
    const fourcastnet = AIPrimitive.get("primitive-resource-seed-models-modelhub-fourcastnet")

    expect(result.updated).toBe(1)
    expect(fourcastnet.description).toBe("NVIDIA 全球高分辨率神经算子天气预报模型")
  })

  test("keeps dataset/app resource-derived primitives in draft until published", async () => {
    OneScienceResource.seedDefaults()
    await using _tmp = await migrateWithoutOneskillsAssets()

    const derived = AIPrimitive.get("primitive-resource-seed-datasets-earth-era5")
    expect(derived.status).toBe("draft")
    expect(derived.owner).toBe("platform")
  })

  test("auto-publishes model resource-derived primitives with completed contracts", async () => {
    OneScienceResource.seedDefaults()
    await using _tmp = await migrateWithoutOneskillsAssets()

    const fourcastnet = AIPrimitive.get("primitive-resource-seed-models-modelhub-fourcastnet")
    expect(fourcastnet.status).toBe("callable")
    expect(fourcastnet.owner).toBe("platform")
    expect(fourcastnet.intentTags.length).toBeGreaterThan(0)
    expect(fourcastnet.domain.trim().length).toBeGreaterThan(0)
    expect(fourcastnet.contractJson?.primitiveCategory).toBe("model-inference")
    expect(fourcastnet.adapterJson?.mode).toBe("model_reference")
    const agentContract = fourcastnet.contractJson?.agentContract as { resourceContract?: { requiredInputs?: string[] } } | undefined
    expect(agentContract?.resourceContract?.requiredInputs?.length).toBeGreaterThan(0)

    const emptyTagged = AIPrimitive.get("primitive-resource-seed-models-modelhub-w-mae")
    expect(emptyTagged.status).toBe("callable")
    expect(emptyTagged.intentTags.length).toBeGreaterThan(0)
  })

  test("suppresses OneHub drafts only when oneskills occupies the same category slot", async () => {
    OneScienceResource.seedDefaults()
    await using _tmp = await migrateWithOneskillsAssets()
    // oneskills datapipe occupies data-processing; OneHub keeps a separate dataset draft
    const era5Datapipe = AIPrimitive.get(oneskillsPrimitiveId("climate/datapipes/era5"))
    expect(era5Datapipe.status).toBe("callable")
    expect(era5Datapipe.primitiveType).toBe("data.transform")
    expect(era5Datapipe.contractJson?.primitiveCategory).toBe("data-processing")
    const era5Dataset = AIPrimitive.get("primitive-resource-seed-datasets-earth-era5")
    expect(era5Dataset.status).toBe("draft")
    expect(era5Dataset.primitiveType).toBe("data.load")
    expect(era5Dataset.contractJson?.primitiveCategory).toBe("dataset")
    expect(era5Dataset.title).toBe("全球再分析")
    // oneskills model is 模型原语; OneHub model-inference auto-publishes on a separate category slot
    expect(AIPrimitive.get(oneskillsPrimitiveId("climate/models/fuxi")).primitiveType).toBe("model")
    expect(AIPrimitive.get("primitive-resource-seed-models-modelhub-fuxi").status).toBe("callable")
    expect(AIPrimitive.get("primitive-resource-seed-models-modelhub-fuxi").contractJson?.primitiveCategory).toBe("model-inference")
  })

  test("marks oneskills seeded primitives as system-owned", async () => {
    await using _tmp = await migrateWithOneskillsAssets()
    expect(AIPrimitive.get(oneskillsPrimitiveId("climate/models/graphcast")).owner).toBe("system")
  })

  test("re-migrates callable derived primitives back to draft", async () => {
    OneScienceResource.seedDefaults()
    await using _tmp = await migrateWithoutOneskillsAssets()
    Database.use((db) => {
      db.update(AIPrimitiveTable)
        .set({ status: "callable", time_updated: Date.now() })
        .where(eq(AIPrimitiveTable.id, "primitive-resource-seed-datasets-earth-era5"))
        .run()
    })
    migrateStaticPrimitives({ assetsRoot: emptyAssetsRoot(_tmp.path) })
    expect(AIPrimitive.get("primitive-resource-seed-datasets-earth-era5").status).toBe("draft")
  })

  test("publishes draft primitives after required fields are present", () => {
    const created = AIPrimitive.create({
      title: "ERA5 Loader",
      description: "Loads ERA5 data",
      domain: "地球科学",
      primitiveType: "data.load",
      intentTags: ["era5"],
      sourceResourceIds: ["seed-datasets-earth-era5"],
      contractJson: {
        primitiveCategory: "dataset",
        agentContract: {
          resourceContract: {
            requiredInputs: ["resourceId: seed-datasets-earth-era5", "storage: /data/era5/"],
          },
        },
      },
      adapterJson: { mode: "resource_reference" },
    })

    const published = AIPrimitive.publish(created.id)
    expect(published.status).toBe("callable")
  })

  test("rejects publish when required contract fields are missing", () => {
    const created = AIPrimitive.create({
      title: "Incomplete Loader",
      description: "Missing contract",
      domain: "地球科学",
      primitiveType: "data.load",
      intentTags: ["era5"],
      sourceResourceIds: ["seed-datasets-earth-era5"],
    })

    expect(() => AIPrimitive.publish(created.id)).toThrow(/not ready to publish/)
  })

  test("publishes dataset primitives without storage location", () => {
    const created = AIPrimitive.create({
      title: "ERA5 Loader",
      description: "Loads ERA5 data",
      domain: "地球科学",
      primitiveType: "data.load",
      intentTags: ["era5"],
      sourceResourceIds: ["seed-datasets-earth-era5"],
      contractJson: {
        primitiveCategory: "dataset",
        agentContract: {
          resourceContract: {
            requiredInputs: ["resourceId: seed-datasets-earth-era5"],
          },
        },
      },
      adapterJson: { mode: "resource_reference" },
    })

    const published = AIPrimitive.publish(created.id)
    expect(published.status).toBe("callable")
    expect(published.owner).toBe("platform")
  })

  test("lookupBySourceResource returns callable and draft primitives", () => {
    const draft = AIPrimitive.create({
      title: "Draft Loader",
      description: "Draft only",
      domain: "地球科学",
      primitiveType: "data.load",
      intentTags: ["era5"],
      sourceResourceIds: ["lookup-resource"],
    })
    AIPrimitive.publish(draft.id, {
      contractJson: {
        primitiveCategory: "dataset",
        agentContract: { resourceContract: { requiredInputs: ["resourceId: lookup-resource", "storage: /data/lookup/"] } },
      },
      adapterJson: { mode: "resource_reference" },
    })

    const lookup = AIPrimitive.lookupBySourceResource("lookup-resource")
    expect(lookup.callable?.id).toBe(draft.id)
    expect(lookup.draft).toBeUndefined()
  })

  test("lookupBySourceResources returns batch lookup results", () => {
    const draft = AIPrimitive.create({
      title: "Batch Loader",
      description: "Batch only",
      domain: "地球科学",
      primitiveType: "data.load",
      intentTags: ["era5"],
      sourceResourceIds: ["batch-resource"],
    })

    const lookup = AIPrimitive.lookupBySourceResources(["batch-resource", "missing-resource"])
    expect(lookup["batch-resource"]?.draft?.id).toBe(draft.id)
    expect(lookup["missing-resource"]?.callable).toBeUndefined()
    expect(lookup["missing-resource"]?.draft).toBeUndefined()
  })

  test("resolves dataset resource aliases when looking up primitives", async () => {
    OneScienceResource.seedDefaults()
    await using _tmp = await migrateWithoutOneskillsAssets()

    const lookup = AIPrimitive.lookupBySourceResource("material-omat24")

    expect(lookup.callable).toBeUndefined()
    expect(lookup.draft?.id).toBe("primitive-resource-seed-datasets-material-omat24")
    expect(AIPrimitive.lookupBySourceResource("fluid-cfdbench").draft?.id).toBe("primitive-resource-seed-datasets-fluid-cfdbench")
  })

  test("binds callable model runners to model-specific resource ids", async () => {
    OneScienceResource.seedDefaults()
    await using _tmp = await migrateWithOneskillsAssets()

    const graphcast = AIPrimitive.lookupBySourceResource("modelhub")
    expect(graphcast.model?.callable?.id).toBe(oneskillsPrimitiveId("climate/models/graphcast"))
    expect(graphcast.model?.callable?.primitiveType).toBe("model")
    expect(graphcast.inference?.callable?.id).toBe("primitive-resource-seed-models-modelhub")
    expect(graphcast.inference?.callable?.primitiveType).toBe("model.run")
    expect(graphcast.training?.callable).toBeUndefined()
    expect(AIPrimitive.lookupBySourceResource("modelhub-fourcastnet").inference?.callable?.id).toBe(
      "primitive-resource-seed-models-modelhub-fourcastnet",
    )
    expect(AIPrimitive.lookupBySourceResource("modelhub-fuxi").model?.callable?.id).toBe(oneskillsPrimitiveId("climate/models/fuxi"))
    expect(AIPrimitive.lookupBySourceResource("modelhub-fuxi").inference?.callable?.id).toBe(
      "primitive-resource-seed-models-modelhub-fuxi",
    )
    expect(AIPrimitive.lookupBySourceResource("life").model?.callable?.id).toBe(oneskillsPrimitiveId("bio/models/alphafold"))
    expect(AIPrimitive.lookupBySourceResource("life-openfold").model?.callable?.id).toBe(oneskillsPrimitiveId("bio/models/openfold"))
    expect(AIPrimitive.lookupBySourceResource("life-openfold").training?.callable).toBeUndefined()
  })

  test("ignores stale primitive resource relations when source ids moved to model-specific resources", async () => {
    OneScienceResource.seedDefaults()
    await using _tmp = await migrateWithOneskillsAssets()

    migratePrimitives([
      {
        id: "primitive-model-climax-finetune",
        title: "ClimaX Fine-tune Primitive",
        copy: "ClimaX fine-tune",
        tags: ["Model Resources", "category:model-training", "skill:onescience-runtime", "source:models", "resource:modelhub-climax", "model:ClimaX"],
        provider: "Microsoft ClimaX",
        size: "model.train",
        format: "PyTorch",
        href: "https://example.com/climax",
        domain: "地球科学",
      },
    ])

    Database.use((db) => {
      db.update(AIPrimitiveTable)
        .set({ source_resource_ids: ["modelhub-climax"] })
        .where(eq(AIPrimitiveTable.id, "primitive-model-climax-finetune"))
        .run()
    })

    const lookup = AIPrimitive.lookupBySourceResource("modelhub")
    expect(lookup.model?.callable?.id).toBe(oneskillsPrimitiveId("climate/models/graphcast"))
    expect(lookup.training?.callable).toBeUndefined()
    expect(AIPrimitive.lookupBySourceResource("modelhub-climax").training?.callable?.id).toBe("primitive-model-climax-finetune")
  })

  test("allows publishing training and inference callables for the same model resource", async () => {
    OneScienceResource.seedDefaults()
    await using _tmp = await migrateWithOneskillsAssets()

    const training = AIPrimitive.create({
      title: "GraphCast Fine-tune",
      description: "Fine-tune GraphCast on downstream weather tasks",
      domain: "地球科学",
      primitiveType: "model.train",
      intentTags: ["graphcast", "fine-tune"],
      sourceResourceIds: ["modelhub"],
      contractJson: {
        primitiveCategory: "model-training",
        agentContract: {
          resourceContract: {
            requiredInputs: ["resourceId: modelhub", "checkpointPath: /models/graphcast/"],
          },
        },
      },
      adapterJson: { mode: "model_reference", page: "models", resourceId: "modelhub" },
    })

    const published = AIPrimitive.publish(training.id)
    expect(published.status).toBe("callable")
    expect(AIPrimitive.lookupBySourceResource("modelhub").model?.callable?.id).toBe(oneskillsPrimitiveId("climate/models/graphcast"))
    expect(AIPrimitive.lookupBySourceResource("modelhub").training?.callable?.id).toBe(training.id)
  })

  test("HTTP GET primitive list returns all statuses when status is omitted", async () => {
    OneScienceResource.seedDefaults()
    await using _tmp = await migrateWithOneskillsAssets()

    const all = await primitiveHttpRequest("/experimental/onescience/primitive?limit=100&summary=true")
    expect(all.status).toBe(200)
    const allBody = (await all.json()) as { items: Array<{ status: string }> }
    expect(allBody.items.some((item) => item.status === "draft")).toBe(true)
    expect(allBody.items.some((item) => item.status === "callable")).toBe(true)

    const drafts = await primitiveHttpRequest("/experimental/onescience/primitive?status=draft&limit=100&summary=true")
    expect(drafts.status).toBe(200)
    const draftBody = (await drafts.json()) as { items: Array<{ status: string }> }
    expect(draftBody.items.length).toBeGreaterThan(0)
    expect(draftBody.items.every((item) => item.status === "draft")).toBe(true)

    const callableOnly = await primitiveHttpRequest("/experimental/onescience/primitive?status=callable&limit=100&summary=true")
    expect(callableOnly.status).toBe(200)
    const callableBody = (await callableOnly.json()) as { items: Array<{ status: string }> }
    expect(callableBody.items.every((item) => item.status === "callable")).toBe(true)
    expect(callableBody.items.length).toBeGreaterThan(0)
    expect(callableBody.items.length).toBeLessThanOrEqual(100)
    expect(AIPrimitive.count({ status: "callable" })).toBeGreaterThanOrEqual(callableBody.items.length)
  })

  test("rejects deleting seed resource-derived platform drafts", async () => {
    OneScienceResource.seedDefaults()
    await using _tmp = await migrateWithoutOneskillsAssets()

    const derived = AIPrimitive.get("primitive-resource-seed-datasets-earth-era5")
    expect(derived.owner).toBe("platform")
    expect(derived.status).toBe("draft")
    expect(AIPrimitive.isPresetPrimitive(derived)).toBe(true)
    expect(() => AIPrimitive.remove(derived.id, "acct-a")).toThrow(/cannot be deleted/)
    expect(AIPrimitive.get(derived.id).status).toBe("draft")
  })

  test("allows deleting user-uuid drafts stamped as platform", async () => {
    const uuidDraft = AIPrimitive.create(
      {
        title: "test_add_data Data Loader",
        description: "pre-auth uuid residue",
        domain: "地球科学",
        primitiveType: "data.load",
        intentTags: ["user"],
      },
      "platform",
    )
    expect(AIPrimitive.isUserCreatedPrimitiveId(uuidDraft.id)).toBe(true)
    expect(AIPrimitive.isPresetPrimitive(uuidDraft)).toBe(false)
    expect(AIPrimitive.isCommunalPrimitive(uuidDraft)).toBe(true)
    expect(AIPrimitive.remove(uuidDraft.id, "acct-other")).toBe(true)
  })

  test("HTTP DELETE rejects seed resource-derived platform drafts", async () => {
    OneScienceResource.seedDefaults()
    await using _tmp = await migrateWithoutOneskillsAssets()

    const response = await primitiveHttpRequest("/experimental/onescience/primitive/primitive-resource-seed-datasets-earth-era5", {
      method: "DELETE",
    })
    // Built-in rejection → 400; auth-required guests → 401.
    expect([400, 401]).toContain(response.status)
    expect(AIPrimitive.get("primitive-resource-seed-datasets-earth-era5").status).toBe("draft")
  })

  test("copy-on-publish creates per-account callables while keeping shared drafts", async () => {
    OneScienceResource.seedDefaults()
    await using _tmp = await migrateWithoutOneskillsAssets()
    const draft = AIPrimitive.get("primitive-resource-seed-datasets-earth-era5")
    expect(draft.status).toBe("draft")
    expect(draft.owner).toBe("platform")

    const ready = {
      title: draft.title,
      description: draft.description,
      domain: draft.domain,
      primitiveType: draft.primitiveType,
      intentTags: draft.intentTags,
      contractJson: {
        ...(draft.contractJson ?? {}),
        primitiveCategory: "dataset",
        agentContract: {
          resourceContract: {
            requiredInputs: ["resourceId: seed-datasets-earth-era5"],
          },
        },
      },
      adapterJson: draft.adapterJson ?? { mode: "resource_reference" },
    }

    const publishedA = AIPrimitive.publish(draft.id, ready, "acct-a")
    expect(publishedA.id).not.toBe(draft.id)
    expect(publishedA.status).toBe("callable")
    expect(publishedA.owner).toBe("acct-a")
    expect(AIPrimitive.get(draft.id).status).toBe("draft")

    const publishedB = AIPrimitive.publish(draft.id, ready, "acct-b")
    expect(publishedB.id).not.toBe(publishedA.id)
    expect(publishedB.owner).toBe("acct-b")

    const lookupA = AIPrimitive.lookupBySourceResource("seed-datasets-earth-era5", "acct-a")
    expect(lookupA.slots?.dataset?.callable?.id).toBe(publishedA.id)
    expect(lookupA.slots?.dataset?.draft).toBeUndefined()

    const lookupB = AIPrimitive.lookupBySourceResource("seed-datasets-earth-era5", "acct-b")
    expect(lookupB.slots?.dataset?.callable?.id).toBe(publishedB.id)

    const lookupC = AIPrimitive.lookupBySourceResource("seed-datasets-earth-era5", "acct-c")
    expect(lookupC.slots?.dataset?.callable).toBeUndefined()
    expect(lookupC.slots?.dataset?.draft?.id).toBe(draft.id)

    expect(AIPrimitive.list({ accountId: "acct-a" }).items.some((item) => item.id === publishedB.id)).toBe(false)
    expect(AIPrimitive.list({ accountId: "acct-a" }).items.some((item) => item.id === publishedA.id)).toBe(true)
    expect(AIPrimitive.list({ accountId: "acct-a" }).items.some((item) => item.id === draft.id)).toBe(true)

    const guestList = AIPrimitive.list({ status: "callable", accountId: "", limit: 100 })
    expect(guestList.items.some((item) => item.id === publishedA.id)).toBe(false)
    expect(guestList.items.some((item) => item.id === publishedB.id)).toBe(false)
    expect(AIPrimitive.list({ accountId: "" }).items.some((item) => item.id === draft.id)).toBe(true)
    expect(AIPrimitive.isVisibleToAccount(publishedA.owner, "", publishedA.id)).toBe(false)
    expect(AIPrimitive.isVisibleToAccount(draft.owner, "", draft.id)).toBe(true)
  })

  test("guests cannot list ownerless or user-owned callables", async () => {
    const orphan = AIPrimitive.create({
      title: "Orphan Callable",
      description: "pre-auth residue",
      domain: "地球科学",
      primitiveType: "data.load",
      intentTags: ["legacy"],
      contractJson: { primitiveCategory: "dataset" },
      adapterJson: { mode: "resource_reference" },
    })
    AIPrimitive.publish(orphan.id, undefined, undefined)
    const owned = AIPrimitive.create(
      {
        title: "User Callable",
        description: "owned",
        domain: "地球科学",
        primitiveType: "data.load",
        intentTags: ["user"],
        contractJson: { primitiveCategory: "dataset" },
        adapterJson: { mode: "resource_reference" },
      },
      "acct-user",
    )
    AIPrimitive.publish(owned.id, undefined, "acct-user")

    const guest = AIPrimitive.list({ status: "callable", accountId: "", limit: 100 })
    expect(guest.items.some((item) => item.id === orphan.id || item.title === "Orphan Callable")).toBe(false)
    expect(guest.items.some((item) => item.id === owned.id)).toBe(false)
  })

  test("same account can publish another slot after copy-on-publish", async () => {
    OneScienceResource.seedDefaults()
    await using _tmp = await migrateWithoutOneskillsAssets()
    const datasetDraft = AIPrimitive.get("primitive-resource-seed-datasets-earth-era5")

    const processingDraft = AIPrimitive.create({
      title: "ERA5 Processing",
      description: "Process ERA5",
      domain: "地球科学",
      primitiveType: "data.transform",
      intentTags: ["era5"],
      sourceResourceIds: ["seed-datasets-earth-era5"],
      contractJson: {
        primitiveCategory: "data-processing",
        agentContract: { resourceContract: { requiredInputs: ["resourceId: seed-datasets-earth-era5"] } },
      },
      adapterJson: { mode: "resource_reference" },
    }, "acct-a")

    const publishedDataset = AIPrimitive.publish(
      datasetDraft.id,
      {
        contractJson: {
          ...(datasetDraft.contractJson ?? {}),
          primitiveCategory: "dataset",
          agentContract: { resourceContract: { requiredInputs: ["resourceId: seed-datasets-earth-era5"] } },
        },
        adapterJson: datasetDraft.adapterJson ?? { mode: "resource_reference" },
      },
      "acct-a",
    )
    expect(publishedDataset.owner).toBe("acct-a")

    const publishedProcessing = AIPrimitive.publish(processingDraft.id, undefined, "acct-a")
    expect(publishedProcessing.owner).toBe("acct-a")
    expect(publishedProcessing.id).toBe(processingDraft.id)

    const lookup = AIPrimitive.lookupBySourceResource("seed-datasets-earth-era5", "acct-a")
    expect(lookup.slots?.dataset?.callable?.id).toBe(publishedDataset.id)
    expect(lookup.slots?.["data-processing"]?.callable?.id).toBe(publishedProcessing.id)
  })

  test("rejects deleting oneskills seeded system primitives", async () => {
    await using _tmp = await migrateWithOneskillsAssets()
    const id = oneskillsPrimitiveId("climate/models/graphcast")
    expect(() => AIPrimitive.remove(id)).toThrow(/cannot be deleted/)
    expect(AIPrimitive.get(id).status).toBe("callable")

    const created = AIPrimitive.create({
      title: "User Loader",
      description: "User-owned primitive",
      domain: "地球科学",
      primitiveType: "data.load",
      intentTags: ["user"],
    })
    expect(AIPrimitive.remove(created.id)).toBe(true)
    expect(() => AIPrimitive.get(created.id)).toThrow()
  })

  test("allows any signed-in account to delete ownerless legacy primitives", async () => {
    const orphan = AIPrimitive.create({
      title: "Legacy Orphan",
      description: "pre-auth residue",
      domain: "地球科学",
      primitiveType: "data.load",
      intentTags: ["legacy"],
    })
    expect(orphan.owner).toBeUndefined()
    expect(AIPrimitive.list({ accountId: "acct-a" }).items.some((item) => item.id === orphan.id)).toBe(true)
    expect(() => AIPrimitive.remove(orphan.id, "")).toThrow(/Login required/)
    expect(AIPrimitive.remove(orphan.id, "acct-b")).toBe(true)
    expect(AIPrimitive.list({ accountId: "acct-a" }).items.some((item) => item.id === orphan.id)).toBe(false)
  })

  test("HTTP DELETE rejects oneskills seeded system primitives", async () => {
    await using _tmp = await migrateWithOneskillsAssets()
    const id = oneskillsPrimitiveId("climate/models/graphcast")

    const response = await primitiveHttpRequest(`/experimental/onescience/primitive/${id}`, {
      method: "DELETE",
    })
    expect(response.status).toBe(400)
    expect(AIPrimitive.get(id).status).toBe("callable")
  })

  test("HTTP GET and PATCH return 404 for missing or deleted primitives", async () => {
    const created = AIPrimitive.create({
      title: "HTTP Not Found",
      description: "Deleted primitive",
      domain: "地球科学",
      primitiveType: "data.load",
      intentTags: ["http"],
    })

    const missing = await primitiveHttpRequest("/experimental/onescience/primitive/primitive-missing-id")
    expect(missing.status).toBe(404)

    AIPrimitive.remove(created.id)

    const deleted = await primitiveHttpRequest(`/experimental/onescience/primitive/${created.id}`)
    expect(deleted.status).toBe(404)

    const updateDeleted = await primitiveHttpRequest(`/experimental/onescience/primitive/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "Should not update" }),
    })
    expect(updateDeleted.status).toBe(404)
  })

  test("counts callable primitives without listing items", async () => {
    await using _tmp = await migrateWithOneskillsAssets()
    expect(AIPrimitive.count({ status: "callable" })).toBeGreaterThan(0)
    expect(AIPrimitive.count({ status: "draft" })).toBeGreaterThanOrEqual(0)
    const listed = AIPrimitive.list({ status: "callable", limit: 500 })
    expect(AIPrimitive.count({ status: "callable" })).toBe(listed.items.length)
  })

  test("HTTP GET catalog metrics returns counts in one response", async () => {
    await using _tmp = await migrateWithOneskillsAssets()
    const response = await primitiveHttpRequest("/experimental/onescience/catalog-metrics")
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      datasets: number
      models: number
      apps: number
      frameworks: number
      callablePrimitives: number
      byDomain: {
        datasets: Record<string, number>
        models: Record<string, number>
        apps: Record<string, number>
        frameworks: Record<string, number>
      }
    }
    expect(body.callablePrimitives).toBeGreaterThan(0)
    expect(body.datasets).toBeGreaterThanOrEqual(0)
    expect(body.frameworks).toBeGreaterThanOrEqual(0)
    expect(body.byDomain).toEqual({
      datasets: expect.any(Object),
      models: expect.any(Object),
      apps: expect.any(Object),
      frameworks: expect.any(Object),
    })
  })
})
