import { Database } from "@/storage/db"
import { and, eq, inArray, isNull, notInArray } from "drizzle-orm"
import { CatalogBlobStore } from "@/catalog/blob-store"
import { modelScopeDatasetDownloadMethod, modelScopeModelDownloadMethod } from "./modelscope-catalog"
import { type OneskillsSeedPrimitive } from "./oneskills-primitive-ingest"
import {
  bundledPrimitiveSeed,
  seedBundleFromAssetsRoot,
  seedPrimitivesFromBundle,
  shouldApplyPrimitiveSeed,
  writeAppliedPrimitiveSeed,
  resolvePrimitiveSeedBundle,
  type PrimitiveSeedBundle,
} from "./oneskills-primitive-seed"
import { AIPrimitiveTable } from "./primitive.sql"
import { OneScienceResourceTable } from "./resource.sql"
import { OneSciencePrimitiveResourceTable } from "./skill.sql"
import coderAssets from "./coder-assets.json"

type StaticPrimitive = {
  id: string
  title: string
  copy: string
  tags: string[]
  provider: string
  size: string
  format: string
  href: string
  domain?: string
  assetKey?: string
}

type CoderAsset = {
  path: string
  kind: string
  name: string
  title: string
  summary: string
  sections: { title: string; content: string }[]
  content: string
}

function inferPrimitiveType(tags: string[]): string {
  if (tags.includes("Data Resources")) return "data.load"
  if (tags.includes("Model Resources")) {
    if (tags.some((tag) => tag.includes("training") || tag.includes("fine-tune"))) return "model.train"
    if (tags.some((tag) => tag === "category:model")) return "model"
    return "model.run"
  }
  if (tags.includes("App Launchers")) return tags.some((tag) => tag.includes("workflow")) ? "workflow.compose" : "app.launch"
  if (tags.includes("AI Modules")) return "code.generate"
  if (tags.includes("Metrics")) return "model.evaluate"
  if (tags.includes("DataPipes")) return "data.transform"
  if (tags.includes("Coder Assets")) return "code.generate"
  return "code.generate"
}

const SEED_PRIMITIVE_TYPES = new Set([
  "data.load",
  "data.transform",
  "model",
  "model.run",
  "model.train",
  "model.evaluate",
  "app.launch",
  "operator.apply",
  "code.generate",
  "workflow.compose",
  "runtime.submit",
])

function resolvePrimitiveType(item: StaticPrimitive) {
  if (item.size && SEED_PRIMITIVE_TYPES.has(item.size)) return item.size
  return inferPrimitiveType(item.tags)
}

function inferDomain(tags: string[]): string {
  if (tags.some((tag) => tag === "地球科学" || tag.includes("weather") || tag.includes("earth") || tag.includes("climate") || tag.includes("precipitation"))) return "地球科学"
  if (tags.some((tag) => tag === "生命科学" || tag.includes("bio") || tag.includes("protein") || tag.includes("cryo-EM"))) return "生命科学"
  if (tags.some((tag) => tag === "材料化学" || tag.includes("material") || tag.includes("dft") || tag.includes("catalysis"))) return "材料化学"
  if (tags.some((tag) => tag === "流体仿真" || tag.includes("fluid") || tag.includes("cfd") || tag.includes("boiling") || tag.includes("pde") || tag.includes("solver") || tag.includes("neural-operator") || tag.includes("fno"))) return "流体仿真"
  if (tags.some((tag) => tag === "其它" || tag.includes("codegen") || tag.includes("template") || tag.includes("boilerplate"))) return "其它"
  return "其它"
}

function sourcePage(tags: string[]) {
  return tags.find((tag) => tag.startsWith("source:"))?.slice("source:".length)
}

function sourceResourceIds(tags: string[]) {
  return tags.filter((tag) => tag.startsWith("resource:")).map((tag) => tag.slice("resource:".length))
}

function primitiveCategory(tags: string[]) {
  const explicit = tags.find((tag) => tag.startsWith("category:"))?.slice("category:".length)
  if (explicit) return explicit
  if (tags.includes("Data Resources")) return "data-processing"
  if (tags.includes("Model Resources")) return inferPrimitiveType(tags) === "model.train" ? "model-training" : "model-inference"
  if (tags.includes("App Launchers")) return "app"
  if (tags.includes("AI Modules")) return "model-component"
  if (tags.includes("Metrics")) return "evaluation"
  if (tags.includes("DataPipes")) return "data-processing"
  return "code-asset"
}

function targetPrimitiveTypeForCategory(category: string) {
  if (category === "dataset") return "dataset"
  if (category === "data-processing") return "data.process"
  if (category === "model") return "model.architecture"
  if (category === "model-training") return "model.train"
  if (category === "model-inference") return "model.infer"
  if (category === "evaluation") return "benchmark"
  if (category === "app") return "app.run"
  if (category === "model-component") return "component"
  return undefined
}


function extractIntentTags(tags: string[]): string[] {
  return tags.filter(
    (tag) =>
      !["AI Modules", "Metrics", "DataPipes", "Data Resources", "Model Resources", "App Launchers", "Coder Assets"].includes(tag) &&
      !tag.startsWith("source:") &&
      !tag.startsWith("resource:") &&
      !tag.startsWith("model:") &&
      !tag.startsWith("category:") &&
      !tag.startsWith("skill:"),
  )
}

function intentTagsForItem(item: StaticPrimitive) {
  const tags = extractIntentTags(item.tags)
  if (tags.length) return tags
  return [item.provider, item.format, item.size].map((value) => value?.trim()).filter((value): value is string => !!value).slice(0, 4)
}

function resolveDomain(item: StaticPrimitive) {
  if (item.domain?.trim()) return item.domain.trim()
  const fromTags = inferDomain(item.tags)
  if (fromTags !== "其它") return fromTags
  const provider = item.provider?.toLowerCase() ?? ""
  if (["weather", "climate", "ocean", "precipitation", "remote-sensing", "atmosphere", "earth-system", "heliophysics"].includes(provider)) {
    return "地球科学"
  }
  if (["biology", "genomics", "drug_discovery", "medical_ai", "bioinformatics", "systems_biology", "bio"].includes(provider)) {
    return "生命科学"
  }
  if (["matchem", "material"].includes(provider)) return "材料化学"
  if (
    ["fluid-dynamics", "fluid", "pde-solving", "operator-learning", "mathematics", "industrial-cfd", "turbulence-modeling"].includes(
      provider,
    )
  ) {
    return "流体仿真"
  }
  return "其它"
}

/** OneHub model-derived runners auto-publish; dataset/app derived stay draft until manual publish. */
function isAutoCallableDerived(item: StaticPrimitive, derived: boolean) {
  if (!derived) return true
  return sourcePage(item.tags) === "models"
}

function modelTitleFromTags(tags: string[]) {
  const tag = tags.find((item) => item.startsWith("model:"))
  return tag?.slice("model:".length)
}

function resourceSyncForStaticItem(item: StaticPrimitive) {
  if (item.tags.includes("Model Resources")) {
    const title = modelTitleFromTags(item.tags)
    if (title) return modelScopeModelDownloadMethod(title)
  }
  if (item.tags.includes("Data Resources") || item.tags.includes("DataPipes")) {
    const resourceId = sourceResourceIds(item.tags)[0]
    if (resourceId) return modelScopeDatasetDownloadMethod(resourceId)
  }
  return undefined
}

function resourceSyncRequiredInputKey(page: string, category: string) {
  if (page === "models" || category === "model" || category.startsWith("model-")) return "resourceSync"
  if (page === "datasets" || category === "dataset" || category === "data-processing") return "storage"
  return "resourceSync"
}

function resourceSyncUsageSteps(syncKey: string) {
  return [
    `确认调用本原语后，先执行 resourceContract.requiredInputs 中的 ${syncKey} 命令，将关联资源同步至本地缓存。`,
    "同步完成后读取本地资源内容（README、配置、示例脚本、权重或数据文件），再确定 checkpoint、schema、入口脚本等后续参数。",
    "在资源已本地可用且用法明确前，不要跳过同步步骤直接假设路径、格式或运行入口。",
  ]
}

function agentContract(item: StaticPrimitive) {
  const matchedAssets = coderAssetsForPrimitive(item)
  const page = sourcePage(item.tags) ?? "code"
  const category = primitiveCategory(item.tags)
  const syncCommand = resourceSyncForStaticItem(item)
  const syncKey = resourceSyncRequiredInputKey(page, category)
  const oneskills = item.id.startsWith("primitive-oneskills-")
  return {
    assetSkill: "onescience-coder",
    purpose: "为智能体执行代码实现、数据接入、模型改造、组件调用或科研工作流执行提供可操作契约。",
    usage: [
      ...(oneskills
        ? [
            "确认选用本原语后，先调用 catalog_resolve(part=body) 读取 companions（spec.md / usage.md / workflow_planning.md），再实现或运行。",
          ]
        : []),
      ...(syncCommand ? resourceSyncUsageSteps(syncKey) : []),
      "优先读取 matchedAssets 中的输入、输出、参数、风险点和源码锚点。",
      "按 resourceContract.requiredInputs 准备资源 ID、领域标签、格式和运行上下文。",
      "生成或修改代码前，先校验 primitiveType、primitiveCategory、sourceResourceIds 与资产契约是否一致。",
      "交付前按 resourceContract.acceptanceCriteria 验证适配器输出、错误处理和可追溯来源。",
    ],
    resourceContract: resourceContract(item),
    matchedAssets: matchedAssets.map((asset) => ({
      path: asset.path,
      kind: asset.kind,
      name: asset.name,
      title: asset.title,
      summary: asset.summary,
      sections: asset.sections,
      content: asset.content,
    })),
  }
}

function resourceContract(item: StaticPrimitive) {
  const page = sourcePage(item.tags) ?? "code"
  const resourceId = sourceResourceIds(item.tags)[0]
  const category = primitiveCategory(item.tags)
  const syncCommand = resourceSyncForStaticItem(item)
  const syncKey = resourceSyncRequiredInputKey(page, category)
  return {
    category,
    sourcePage: page,
    sourceResourceIds: sourceResourceIds(item.tags),
    requiredInputs: [
      ...(resourceId ? [`resourceId: ${resourceId}`] : []),
      `domain: ${item.domain ?? inferDomain(item.tags)}`,
      `format: ${item.format}`,
      `provider: ${item.provider}`,
      `primitiveType: ${resolvePrimitiveType(item)}`,
      ...(page === "models" || category.startsWith("model-") ? [`modelId: ${resourceId ?? item.provider}`] : []),
      ...(syncCommand ? [`${syncKey}: ${syncCommand}`] : []),
    ],
    outputs: category === "dataset"
      ? ["typed resource adapter result", "dataset access metadata", "schema/shape hints", "provenance record"]
      : category === "data-processing"
        ? ["typed resource adapter result", "datapipe / loader plan", "schema/shape hints", "provenance record"]
        : category === "model" || category === "model-inference" || category === "model-training"
          ? ["typed resource adapter result", "model invocation plan", "checkpoint/config metadata", "provenance record"]
          : category === "app"
            ? ["typed resource adapter result", "workflow launch plan", "runtime resource requirements", "provenance record"]
            : ["typed resource adapter result", "implementation reference", "provenance record"],
    implementationSteps: implementationSteps(item, category, syncCommand, syncKey),
    acceptanceCriteria: [
      "契约必须保留 sourceResourceIds，并能回溯到资源库条目。",
      "适配器输出必须包含资源标题、来源页面、格式、provider 和 href。",
      "智能体生成代码时必须引用 matchedAssets 中最相关的模板或索引约束。",
      ...(syncCommand
        ? ["若 requiredInputs 含 resourceSync/storage，必须先完成资源同步并阅读本地资源后，再生成实现计划、代码或作业配置。"]
        : []),
      "缺少下载、权重或运行入口时，必须显式返回待补充字段而不是静默成功。",
    ],
  }
}

function implementationSteps(item: StaticPrimitive, category: string, syncCommand?: string, syncKey = "resourceSync") {
  const syncSteps = syncCommand
    ? [
        `执行 requiredInputs 中的 ${syncKey} 命令，完成关联资源本地同步。`,
        "同步完成后浏览本地目录，识别 README、配置、示例脚本与权重/数据文件位置。",
      ]
    : []
  if (category === "dataset") return [
    ...syncSteps,
    "读取数据集资源的 provider、format、href、下载方式和领域标签。",
    "整理数据集介绍、访问契约与 provenance，不实现加载/切片管线。",
    "输出可被 Agent 消费的数据集契约（获取方式、schema/shape 提示、来源记录）。",
  ]
  if (category === "data-processing") return [
    ...syncSteps,
    "读取关联数据集资源与 datapipes 资产约定。",
    "定义数据发现、加载、缓存、切片/转换与 DataLoader 接口。",
    "输出统一 DataPipe 结果，并附带 shape/schema/provenance 元数据。",
  ]
  if (category === "model" || category === "model-inference" || category === "model-training") return [
    ...syncSteps,
    "读取模型资源的框架、权重入口、领域标签和运行约束。",
    "参考 models 资产定义模型配置、checkpoint 加载、输入张量和后处理接口。",
    "输出统一模型调用计划，并记录模型资源、版本和推理/训练参数。",
  ]
  if (category === "app") return [
    ...syncSteps,
    "读取应用资源的安装入口、运行环境、领域标签和 HPC/GPU 约束。",
    "参考 contracts 资产约定科研工作流的输入、输出、日志和错误处理。",
    "输出可执行科研工作流计划，并保留作业配置与资源追踪信息。",
  ]
  return [
    "读取源码或资源引用。",
    "参考 matchedAssets 的接口和命名约定实现适配。",
    "输出可验证的实现计划和来源追踪信息。",
  ]
}

function coderAssetsForPrimitive(item: StaticPrimitive) {
  const keys = primitiveAssetKeys(item)
  const exact = (coderAssets as CoderAsset[]).filter((asset) => keys.includes(asset.name.toLowerCase()))
  const fallback = fallbackCoderAssets(item)
  return [...exact, ...fallback.filter((asset) => !exact.some((matched) => matched.path === asset.path))].slice(0, 4)
}

function fallbackCoderAssets(item: StaticPrimitive) {
  if (item.tags.includes("Coder Assets")) {
    const kind = item.id.includes("datapipes") ? "datapipes" : item.id.includes("models") ? "models" : "contracts"
    return indexAssets(kind)
  }
  if (item.tags.includes("Data Resources") || item.tags.includes("DataPipes")) return indexAssets("datapipes")
  if (item.tags.includes("Model Resources")) return indexAssets("models")
  if (item.tags.includes("App Launchers")) return indexAssets("contracts")
  return []
}

function indexAssets(kind: string) {
  return (coderAssets as CoderAsset[]).filter((asset) => asset.kind === kind && (asset.name.endsWith("index") || asset.name === "TEMPLATE")).slice(0, 2)
}

function primitiveAssetKeys(item: StaticPrimitive) {
  const values = [
    item.id.replace(/^primitive-/, ""),
    item.title,
    item.copy,
    item.provider,
    ...item.tags,
    ...sourceResourceIds(item.tags),
  ]
  return [...new Set(values.flatMap((value) => [
    ...normalizedAssetKeys(value),
    ...value.split(/[^A-Za-z0-9_]+/g).flatMap((token) => normalizedAssetKeys(token)),
  ]))]
}

function normalizedAssetKeys(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/\.py$/g, "")
    .replace(/^earth-/, "")
    .replace(/^life-/, "")
    .replace(/^fluid-/, "")
    .replace(/^material-/, "")
    .replace(/^modelhub-/, "")
    .replace(/^model-/, "")
    .replace(/primitive-/g, "")
    .replace(/data-/g, "")
    .replace(/module-/g, "")
    .replace(/-loader$/g, "")
    .replace(/-runner$/g, "")
    .replace(/-primitive$/g, "")
    .replace(/-training$/g, "")
    .replace(/-finetune$/g, "")
    .replace(/-workflow$/g, "")
    .replace(/-launcher$/g, "")
    .replace(/[^a-z0-9]+/g, "")
  const dashed = value.toLowerCase().replace(/\.py$/g, "").replace(/_/g, "-")
  return [normalized, dashed, dashed.replace(/-/g, "")].filter(Boolean)
}

function adapterJson(item: StaticPrimitive) {
  const page = sourcePage(item.tags)
  const resourceId = sourceResourceIds(item.tags)[0]
  const oneskills = item.id.startsWith("primitive-oneskills-")
  if (!page || !resourceId) {
    return {
      mode: oneskills ? "oneskills_asset" : "code_reference",
      ...(oneskills
        ? {
            seedSource: "oneskills",
            assetKey: item.assetKey,
            location: {
              type: "oneskills_asset",
              path: item.href,
              assetKey: item.assetKey,
            },
          }
        : {
            reference: {
              repo: item.href,
              path: "",
              entry: "",
            },
          }),
    }
  }
  return {
    mode: page === "apps" ? "hpc_workflow" : page === "models" ? "model_reference" : "resource_reference",
    page,
    resourceId,
    href: item.href,
    ...(oneskills ? { seedSource: "oneskills", assetKey: item.assetKey } : {}),
  }
}

function expandResourceIdAliases(ids: string[]) {
  return ids.flatMap((id) => {
    const aliases = [id]
    if (id.startsWith("seed-datasets-")) aliases.push(id.slice("seed-datasets-".length))
    if (id.startsWith("seed-models-")) aliases.push(id.slice("seed-models-".length))
    if (id.startsWith("seed-apps-")) aliases.push(id.slice("seed-apps-".length))
    if (!id.startsWith("seed-")) {
      aliases.push(`seed-datasets-${id}`, `seed-models-${id}`, `seed-apps-${id}`)
    }
    return aliases
  })
}

function callableSlotKeys(resourceIds: string[], category: string) {
  return expandResourceIdAliases(resourceIds).map((resourceId) => `${resourceId}::${category}`)
}

function contractCategory(contract: Record<string, unknown> | null | undefined, primitiveType: string) {
  if (typeof contract?.primitiveCategory === "string" && contract.primitiveCategory) return contract.primitiveCategory
  if (primitiveType === "model") return "model"
  if (primitiveType === "model.run") return "model-inference"
  if (primitiveType === "model.train") return "model-training"
  if (primitiveType === "data.load") return "dataset"
  if (primitiveType === "data.transform") return "data-processing"
  if (primitiveType === "app.launch" || primitiveType === "workflow.compose") return "app"
  return "code-asset"
}

export function migratePrimitives(items: StaticPrimitive[]) {
  const now = Date.now()
  return Database.transaction((db) => {
    let migrated = 0
    let skipped = 0
    // Same OneHub resource may own multiple primitive kinds (e.g. model + model-inference + model-training).
    // Only suppress a derived draft when a callable already occupies the same category slot.
    const callableSlots = new Set(
      db
        .select({
          id: AIPrimitiveTable.id,
          source_resource_ids: AIPrimitiveTable.source_resource_ids,
          primitive_type: AIPrimitiveTable.primitive_type,
          contract_json: AIPrimitiveTable.contract_json,
        })
        .from(AIPrimitiveTable)
        .where(and(isNull(AIPrimitiveTable.time_deleted), eq(AIPrimitiveTable.status, "callable")))
        .all()
        .filter((row) => !row.id.startsWith("primitive-resource-"))
        .flatMap((row) =>
          callableSlotKeys(row.source_resource_ids ?? [], contractCategory(row.contract_json, row.primitive_type)),
        ),
    )

    for (const [index, item] of items.entries()) {
      const resourceIds = sourceResourceIds(item.tags)
      const derived = item.id.startsWith("primitive-resource-")
      const primitiveType = resolvePrimitiveType(item)
      const category = primitiveCategory(item.tags)

      const existing = db
        .select({ id: AIPrimitiveTable.id, time_deleted: AIPrimitiveTable.time_deleted })
        .from(AIPrimitiveTable)
        .where(eq(AIPrimitiveTable.id, item.id))
        .get()

      if (derived && existing?.time_deleted != null) {
        skipped++
        continue
      }

      if (derived && callableSlotKeys(resourceIds, category).some((key) => callableSlots.has(key))) {
        if (existing) {
          db.update(AIPrimitiveTable)
            .set({ time_deleted: now, time_updated: now })
            .where(eq(AIPrimitiveTable.id, item.id))
            .run()
        }
        skipped++
        continue
      }

      const slug = item.id.replace(/^primitive-/, "")
      const publish = isAutoCallableDerived(item, derived)
      const row = {
        id: item.id,
        slug,
        title: item.title,
        description: item.copy,
        domain: resolveDomain(item),
        primitive_type: primitiveType,
        intent_tags: intentTagsForItem(item),
        source_resource_ids: resourceIds.length > 0 ? resourceIds : null,
        status: publish ? ("callable" as const) : ("draft" as const),
        contract_json: {
          id: slug,
          name: item.title,
          intent: intentTagsForItem(item),
          sourceResourceIds: sourceResourceIds(item.tags),
          primitiveType,
          primitiveCategory: category,
          targetPrimitiveType: targetPrimitiveTypeForCategory(category),
          ...(agentContract(item) ? { agentContract: agentContract(item) } : {}),
        },
        adapter_json: adapterJson(item),
        validation_json: null,
        quality_score: null,
        owner: derived ? "platform" : "system",
        time_created: now - index,
        time_updated: now,
        time_deleted: null,
      }

      if (existing) {
        db.update(AIPrimitiveTable)
          .set({
            slug: row.slug,
            title: row.title,
            description: row.description,
            domain: row.domain,
            primitive_type: row.primitive_type,
            intent_tags: row.intent_tags,
            source_resource_ids: row.source_resource_ids,
            status: row.status,
            contract_json: row.contract_json,
            adapter_json: row.adapter_json,
            validation_json: row.validation_json,
            quality_score: row.quality_score,
            owner: row.owner,
            time_updated: row.time_updated,
            time_deleted: row.time_deleted,
          })
          .where(eq(AIPrimitiveTable.id, item.id))
          .run()
        syncPrimitiveResourceRelations(db, item, now)
        if (row.status === "callable") callableSlotKeys(resourceIds, category).forEach((key) => callableSlots.add(key))
        skipped++
        continue
      }

      db.insert(AIPrimitiveTable).values(row).run()
      syncPrimitiveResourceRelations(db, item, now)
      if (row.status === "callable") callableSlotKeys(resourceIds, category).forEach((key) => callableSlots.add(key))
      migrated++
    }

    return { migrated, skipped }
  })
}

export type MigrateStaticPrimitivesOptions = {
  /** Explicit seed bundle. When omitted, resolves disk-vs-bundled with validation fallback. */
  seed?: PrimitiveSeedBundle
  /**
   * Dev/test override: build a transient seed from a disk assets tree.
   * Does not become production truth unless paired with a bumped `seedVersion`.
   */
  assetsRoot?: string
  seedVersion?: string
  /** Re-apply even when applied marker already matches bundle version. */
  force?: boolean
  /** When true (default if oneskills seeds applied), soft-delete legacy non-oneskills system seeds. */
  purgeLegacySystem?: boolean
  /** Forwarded to seed resolution when neither `seed` nor `assetsRoot` is set. */
  projectRoot?: string
}

export type MigrateStaticPrimitivesResult = {
  migrated: number
  skipped: number
  seedVersion: string
  oneskillsApplied: boolean
  seedSource: "disk" | "bundled" | "explicit"
  seedFallbackReason?: string
}

function applyPrimitiveSeedBundle(
  bundle: PrimitiveSeedBundle,
  options: MigrateStaticPrimitivesOptions,
  meta: { source: MigrateStaticPrimitivesResult["seedSource"]; fallbackReason?: string },
): MigrateStaticPrimitivesResult {
  const versionBumped = shouldApplyPrimitiveSeed(bundle, { force: options.force })
  const seeds = seedPrimitivesFromBundle(bundle)
  const seedItems: StaticPrimitive[] = seeds.map((item) => ({
    id: item.id,
    title: item.title,
    copy: item.copy,
    tags: item.tags,
    provider: item.provider,
    size: item.size,
    format: item.format,
    href: item.href,
    domain: item.domain,
    assetKey: item.assetKey,
  }))

  const result = migratePrimitives([...seedItems, ...resourceDerivedPrimitives()])
  writeOneskillsBlobs(seeds)
  if (versionBumped) {
    softDeleteAbsentSystemSeeds({
      keepIds: new Set(seeds.map((item) => item.id)),
      purgeLegacy: options.purgeLegacySystem ?? seeds.length > 0,
    })
    writeAppliedPrimitiveSeed({
      version: bundle.version,
      appliedAt: new Date().toISOString(),
      assetCount: seeds.length,
    })
  }
  return {
    ...result,
    seedVersion: bundle.version,
    oneskillsApplied: versionBumped,
    seedSource: meta.source,
    ...(meta.fallbackReason ? { seedFallbackReason: meta.fallbackReason } : {}),
  }
}

export function migrateStaticPrimitives(options: MigrateStaticPrimitivesOptions = {}): MigrateStaticPrimitivesResult {
  if (options.seed) {
    return applyPrimitiveSeedBundle(options.seed, options, { source: "explicit" })
  }
  if (options.assetsRoot) {
    const bundle = seedBundleFromAssetsRoot(options.assetsRoot, options.seedVersion ?? `disk-${Date.now()}`)
    return applyPrimitiveSeedBundle(bundle, options, { source: "explicit" })
  }

  const resolved = resolvePrimitiveSeedBundle({ projectRoot: options.projectRoot })
  try {
    return applyPrimitiveSeedBundle(resolved.bundle, options, {
      source: resolved.source,
      fallbackReason: resolved.fallbackReason,
    })
  } catch (error) {
    if (resolved.source !== "disk") throw error
    const reason = error instanceof Error ? error.message : "disk seed apply failed"
    return applyPrimitiveSeedBundle(bundledPrimitiveSeed(), options, {
      source: "bundled",
      fallbackReason: reason,
    })
  }
}

/** Rewrite legacy owner=local resource drafts to owner=platform (shared templates). */
export function migrateLocalOwnersToPlatform() {
  return Database.use((db) => {
    const rows = db
      .select({ id: AIPrimitiveTable.id })
      .from(AIPrimitiveTable)
      .where(and(eq(AIPrimitiveTable.owner, "local"), isNull(AIPrimitiveTable.time_deleted)))
      .all()
    if (rows.length === 0) return 0
    const now = Date.now()
    for (const row of rows) {
      db.update(AIPrimitiveTable)
        .set({ owner: "platform", time_updated: now })
        .where(eq(AIPrimitiveTable.id, row.id))
        .run()
    }
    return rows.length
  })
}

function writeOneskillsBlobs(seeds: OneskillsSeedPrimitive[]) {
  for (const seed of seeds) {
    CatalogBlobStore.writePrimitiveBlob(seed.id, {
      id: seed.id,
      title: seed.title,
      description: seed.copy,
      assetKey: seed.assetKey,
      metadata: seed.metadata,
      files: seed.files,
      primitiveType: seed.size,
      domain: seed.domain,
    })
  }
}

function softDeleteAbsentSystemSeeds(input: { keepIds: Set<string>; purgeLegacy: boolean }) {
  const now = Date.now()
  Database.use((db) => {
    const rows = db
      .select({
        id: AIPrimitiveTable.id,
        owner: AIPrimitiveTable.owner,
      })
      .from(AIPrimitiveTable)
      .where(and(isNull(AIPrimitiveTable.time_deleted), eq(AIPrimitiveTable.owner, "system")))
      .all()

    const removeIds = rows
      .filter((row) => {
        if (row.id.startsWith("primitive-oneskills-")) return !input.keepIds.has(row.id)
        if (!input.purgeLegacy) return false
        if (row.id.startsWith("primitive-resource-")) return false
        return true
      })
      .map((row) => row.id)

    if (removeIds.length === 0) return
    for (const chunk of chunkIds(removeIds, 200)) {
      db.update(AIPrimitiveTable)
        .set({ time_deleted: now, time_updated: now })
        .where(inArray(AIPrimitiveTable.id, chunk))
        .run()
    }
  })
}

function chunkIds(ids: string[], size: number) {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size))
  return chunks
}

function resourceDerivedPrimitives(): StaticPrimitive[] {
  return Database.use((db) => db
    .select()
    .from(OneScienceResourceTable)
    .where(and(isNull(OneScienceResourceTable.time_deleted)))
    .all())
    .filter((resource) => resource.page === "datasets" || resource.page === "models" || resource.page === "apps")
    .map((resource) => {
      const page = resource.page as "datasets" | "models" | "apps"
      const category = page === "datasets" ? "dataset" : page === "models" ? "model-inference" : "app"
      const skill = category === "dataset" ? "onescience-coder" : "onescience-runtime"
      const fallbackTags = [resource.provider, resource.format].filter((value): value is string => !!value?.trim())
      const tags = [
        page === "datasets" ? "Data Resources" : page === "models" ? "Model Resources" : "App Launchers",
        `category:${category}`,
        `skill:${skill}`,
        `source:${page}`,
        `resource:${resource.id}`,
        ...(page === "models" ? [`model:${resource.title}`] : []),
        ...(resource.tags.length > 0 ? resource.tags : fallbackTags),
      ]
      return {
        id: `primitive-resource-${resource.id}`,
        title: page === "datasets" ? resource.title : page === "models" ? `${resource.title} Model Runner` : `${resource.title} App Launcher`,
        copy: resource.copy,
        tags,
        provider: resource.provider,
        size: page === "datasets" ? "data.load" : page === "models" ? "model.run" : "app.launch",
        format: resource.format,
        href: resource.href ?? "",
        domain: resource.domain,
      }
    })
}

function syncPrimitiveResourceRelations(db: Parameters<Parameters<typeof Database.transaction>[0]>[0], item: StaticPrimitive, now: number) {
  const page = sourcePage(item.tags)
  const resourceIds = sourceResourceIds(item.tags)
  if (page && resourceIds.length > 0) {
    db.update(OneSciencePrimitiveResourceTable)
      .set({ time_deleted: now, time_updated: now })
      .where(and(
        eq(OneSciencePrimitiveResourceTable.primitive_id, item.id),
        notInArray(OneSciencePrimitiveResourceTable.resource_id, resourceIds),
        isNull(OneSciencePrimitiveResourceTable.time_deleted),
      ))
      .run()
  }
  resourceIds.forEach((resourceId, index) => {
    if (!page) return
    const id = `${item.id}:${resourceId}`
    const resource = db
      .select({ id: OneScienceResourceTable.id })
      .from(OneScienceResourceTable)
      .where(and(eq(OneScienceResourceTable.id, resourceId), isNull(OneScienceResourceTable.time_deleted)))
      .get()
    if (!resource) return
    const existing = db
      .select({ id: OneSciencePrimitiveResourceTable.id })
      .from(OneSciencePrimitiveResourceTable)
      .where(eq(OneSciencePrimitiveResourceTable.id, id))
      .get()
    const row = {
      id,
      primitive_id: item.id,
      resource_id: resourceId,
      resource_page: page,
      relation_type: "source",
      sort_order: index,
      time_created: now,
      time_updated: now,
      time_deleted: null,
    }
    if (existing) {
      db.update(OneSciencePrimitiveResourceTable)
        .set({
          primitive_id: row.primitive_id,
          resource_id: row.resource_id,
          resource_page: row.resource_page,
          relation_type: row.relation_type,
          sort_order: row.sort_order,
          time_updated: row.time_updated,
          time_deleted: row.time_deleted,
        })
        .where(eq(OneSciencePrimitiveResourceTable.id, id))
        .run()
      return
    }
    db.insert(OneSciencePrimitiveResourceTable).values(row).run()
  })
}

export function migrateResourceDerivedDescriptions() {
  const prefix = /^将(?:资源库数据集|模型库资源|应用库资源)「[^」]+」接入为(?:可调用(?:数据加载|模型推理)原语|可执行科研工作流原语)：\s*/
  const now = Date.now()
  return Database.use((db) => {
    const rows = db
      .select()
      .from(AIPrimitiveTable)
      .where(isNull(AIPrimitiveTable.time_deleted))
      .all()
    let updated = 0
    for (const row of rows) {
      if (!prefix.test(row.description)) continue
      const description = row.description.replace(prefix, "").trim()
      if (!description || description === row.description) continue
      db.update(AIPrimitiveTable)
        .set({ description, time_updated: now })
        .where(eq(AIPrimitiveTable.id, row.id))
        .run()
      updated++
    }
    return { updated }
  })
}

export function migratePrimitiveStatuses() {
  const now = Date.now()
  return Database.use((db) => {
    const rows = db
      .select()
      .from(AIPrimitiveTable)
      .where(isNull(AIPrimitiveTable.time_deleted))
      .all()

    let updated = 0
    let removed = 0
    for (const row of rows) {
      if (row.status === "draft" || row.status === "callable") continue
      if (row.status === "deprecated") {
        db.update(AIPrimitiveTable)
          .set({ time_deleted: now, time_updated: now })
          .where(eq(AIPrimitiveTable.id, row.id))
          .run()
        removed++
        continue
      }
      db.update(AIPrimitiveTable)
        .set({
          status: row.status === "verified" ? "callable" : "draft",
          time_updated: now,
        })
        .where(eq(AIPrimitiveTable.id, row.id))
        .run()
      updated++
    }
    return { updated, removed }
  })
}
