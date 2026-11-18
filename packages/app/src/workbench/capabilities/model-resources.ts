import { modelScopeDownloadModelCommand, modelScopeModelId, modelScopeModelPageUrl } from "@/pages/modelscope-catalog"
import seedResources from "../../../../opencode/src/onescience/resource-seed.json"
import type { CapabilityDomain, CapabilityResource, CapabilityScenario } from "./catalog"
import { bioFields, fluidFields, materialsFields, weatherFields } from "./onemodels/shared"

type SeedModel = {
  id: string
  title: string
  copy: string
  tags: string[]
  provider: string
  href?: string
  format?: string
  page: string
}

function normalizeTitle(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

const seedModels = (seedResources as SeedModel[]).filter((item) => item.page === "models")

function hasOnescienceSourceCoverage(enrichment: CapabilityResource | undefined) {
  const href = enrichment?.docsHref ?? ""
  return href.includes("/onescience/tree/") || href.includes("/onescience/blob/")
}

function hasModelScopeInstall(title: string) {
  return !!modelScopeModelId(title)
}

export function modelScopeIdForCapability(resource: Pick<CapabilityResource, "name" | "resourceId">) {
  const direct = modelScopeModelId(resource.name)
  if (direct) return direct
  if (!resource.resourceId) return undefined
  const seed = seedModels.find((item) => item.id === resource.resourceId)
  return seed ? modelScopeModelId(seed.title) : undefined
}

/** Not gray: OneScience source and/or ModelScope install mapping. */
export function isModelCatalogInteractive(title: string, enrichment?: CapabilityResource) {
  return hasModelScopeInstall(title) || hasOnescienceSourceCoverage(enrichment)
}

export function resolveModelDocsHref(title: string, enrichment?: CapabilityResource) {
  if (hasOnescienceSourceCoverage(enrichment) && enrichment?.docsHref) return enrichment.docsHref
  return modelScopeModelPageUrl(title)
}

/** @deprecated use isModelCatalogInteractive */
export function isModelCatalogAvailable(seed: Pick<SeedModel, "id" | "title">, enrichment?: CapabilityResource) {
  return isModelCatalogInteractive(seed.title, enrichment)
}

const weatherProviders = new Set([
  "weather",
  "climate",
  "precipitation",
  "ocean",
  "earth-system",
  "atmosphere",
  "remote-sensing",
  "heliophysics",
])
const fluidProviders = new Set([
  "fluid-dynamics",
  "pde-solving",
  "operator-learning",
  "mathematics",
  "industrial-cfd",
  "turbulence-modeling",
  "mechanics",
  "dynamic-systems",
  "industrial-aerodynamics",
  "irregular-cfd",
  "pde-foundation-model",
  "conservation-laws",
  "uncertainty-quantification",
  "stiff-pdes",
  "fractional-pdes",
  "multiphase-flow",
])
const bioProviders = new Set([
  "biology",
  "genomics",
  "drug_discovery",
  "medical_ai",
  "bioinformatics",
  "systems_biology",
])
const materialsProviders = new Set(["matchem", "material"])

export function capabilityDomainForModelSeed(item: Pick<SeedModel, "id" | "provider" | "tags">): CapabilityDomain {
  if (materialsProviders.has(item.provider) || item.id.includes("material")) return "materials"
  if (bioProviders.has(item.provider) || item.id.includes("life")) return "bio"
  if (fluidProviders.has(item.provider) || item.id.includes("fluid")) return "fluid"
  if (weatherProviders.has(item.provider) || item.id.includes("modelhub") || item.id.includes("earth")) return "weather"
  if (item.tags.some((tag) => tag.includes("材料") || tag.toLowerCase().includes("matchem"))) return "materials"
  if (item.tags.some((tag) => tag.includes("生命") || tag.toLowerCase().includes("protein"))) return "bio"
  if (item.tags.some((tag) => tag.includes("流体") || tag.toLowerCase().includes("cfd"))) return "fluid"
  return "weather"
}

function seedSlug(resourceId: string) {
  return resourceId
    .replace(/^seed-models-/, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
}

function matchScore(seedTitle: string, enrichName: string) {
  const seed = normalizeTitle(seedTitle)
  const enrich = normalizeTitle(enrichName)
  if (!seed || !enrich) return 0
  if (seed === enrich) return 10_000 + enrich.length
  if (seed.startsWith(enrich) && enrich.length >= 4) return 1_000 + enrich.length
  if (enrich.startsWith(seed) && seed.length >= 4) return 500 + seed.length
  return 0
}

function domainFields(domain: CapabilityDomain) {
  if (domain === "materials") return materialsFields
  if (domain === "fluid") return fluidFields
  if (domain === "bio") return bioFields
  return weatherFields
}

function genericScenarios(name: string, domain: CapabilityDomain): CapabilityScenario[] {
  const fields = domainFields(domain)
  return [
    {
      id: "overview",
      title: "了解模型能力",
      summary: `快速确认 ${name} 是否适合当前科研任务`,
      fields,
      capabilitySummary: {
        current: `浏览 ${name} 的适用边界与输入输出`,
        keyConfig: "任务目标 / 输入数据 / 运行环境",
        resources: name,
        deliverables: "是否采用该模型的判断与下一步计划",
      },
      expectedOutputs: "适用性结论与数据准备清单",
      promptTemplate: [
        `请评估 ${name} 是否适合我的任务。`,
        "研究对象：{{system}}",
        "输入数据：{{inputData}}",
        "任务目标：{{goal}}",
        "运行环境：{{environment}}",
        "请给出能否直接使用、缺什么数据，以及最小验证步骤。",
      ].join("\n"),
    },
    {
      id: "prepare",
      title: "准备输入数据",
      summary: `整理 ${name} 推理或训练所需的输入`,
      fields,
      capabilitySummary: {
        current: `为 ${name} 准备标准化输入`,
        keyConfig: "数据格式 / 路径 / 字段",
        resources: name,
        deliverables: "可加载的数据目录与校验结果",
      },
      expectedOutputs: "数据清单、格式检查、缺失项",
      promptTemplate: [
        `请帮我为 ${name} 准备输入数据。`,
        "研究对象：{{system}}",
        "现有数据：{{inputData}}",
        "任务目标：{{goal}}",
        "运行环境：{{environment}}",
        "请列出必需文件、转换步骤和校验命令。",
      ].join("\n"),
    },
    {
      id: "run",
      title: "跑通最小验证",
      summary: `用最小算例验证 ${name} 可运行`,
      fields,
      capabilitySummary: {
        current: `完成 ${name} 的冒烟验证`,
        keyConfig: "入口命令 / 资源规格",
        resources: name,
        deliverables: "验证日志与结果路径",
      },
      expectedOutputs: "运行日志、成功/失败判定、下一步建议",
      promptTemplate: [
        `请为 ${name} 设计并执行最小验证。`,
        "研究对象：{{system}}",
        "输入数据：{{inputData}}",
        "任务目标：{{goal}}",
        "运行环境：{{environment}}",
        "优先给出可直接执行的命令，并在需要安装依赖时先请求批准。",
      ].join("\n"),
    },
  ]
}

function toCapabilityResource(seed: SeedModel, enrichment: CapabilityResource | undefined): CapabilityResource {
  const domain = enrichment?.domain ?? capabilityDomainForModelSeed(seed)
  const name = enrichment?.name ?? seed.title
  const mappedId = modelScopeModelId(seed.title) ?? modelScopeModelId(name)
  const installable = !!mappedId
  const available = isModelCatalogInteractive(seed.title, enrichment) || isModelCatalogInteractive(name, enrichment)
  const id = enrichment?.id ?? seedSlug(seed.id)
  return {
    id,
    name,
    category: "onemodel",
    domain,
    tags: enrichment?.tags?.length ? enrichment.tags : [...seed.tags].slice(0, 6),
    blurb: enrichment?.blurb ?? seed.copy,
    ownership: "catalog",
    available,
    installable,
    resourceId: seed.id,
    docsHref: resolveModelDocsHref(seed.title, enrichment),
    intro: enrichment?.intro ?? {
      title: "30 秒看懂模型",
      subtitle: seed.copy,
      suited: seed.tags.slice(0, 4),
      notFor: ["缺少必需输入数据", "运行环境不满足", "任务与模型定位明显不符"],
      prepare: ["输入数据", "运行环境", "依赖与权重（如需要）"],
      obtain: ["推理/训练结果", "日志与产物路径"],
      steps: ["确认任务匹配", "准备数据", "配置环境", "最小验证", "扩展到正式任务"],
    },
    install: enrichment?.install ?? {
      banner: `已为你创建 ${name} 环境配置任务`,
      prompt: [
        `请为 ${name} 创建可直接跑通的环境配置任务。`,
        `模型简介：${seed.copy}`,
        ...(installable && mappedId
          ? [
              `魔搭模型页：${modelScopeModelPageUrl(seed.title)}`,
              `请优先使用魔搭下载命令获取权重/资源：${modelScopeDownloadModelCommand(mappedId)}`,
            ]
          : ["当前模型未在魔搭提供一键下载，请根据源码文档准备权重与依赖。"]),
        "要求：",
        "1. 先检查当前项目、Python/框架版本、CPU/GPU/DCU、远程环境和目录权限。",
        "2. 如需权重、数据或依赖，请列出来源与获取方式。",
        "3. 需要安装依赖或执行远程命令时，先向我请求批准。",
        "4. 配置完成后给出最小验证命令，并说明下一步可进入的任务。",
      ].filter(Boolean).join("\n"),
    },
    scenarios: enrichment?.scenarios?.length ? enrichment.scenarios : genericScenarios(name, domain),
  }
}

function assignEnrichments(enrichments: CapabilityResource[]) {
  const remaining = [...enrichments]
  const bySeedId = new Map<string, CapabilityResource>()

  for (const seed of seedModels) {
    let bestIndex = -1
    let best = 0
    for (const [index, enrichment] of remaining.entries()) {
      const score = matchScore(seed.title, enrichment.name)
      if (score > best) {
        best = score
        bestIndex = index
      }
    }
    if (bestIndex >= 0 && best >= 10_000) {
      bySeedId.set(seed.id, remaining.splice(bestIndex, 1)[0]!)
    }
  }

  const pending = seedModels.filter((seed) => !bySeedId.has(seed.id))
  pending
    .flatMap((seed) =>
      remaining.map((enrichment) => ({
        seed,
        enrichment,
        score: matchScore(seed.title, enrichment.name),
      })),
    )
    .filter((pair) => pair.score > 0)
    .sort((a, b) => b.score - a.score)
    .forEach((pair) => {
      if (bySeedId.has(pair.seed.id)) return
      if (!remaining.includes(pair.enrichment)) return
      bySeedId.set(pair.seed.id, pair.enrichment)
      const at = remaining.indexOf(pair.enrichment)
      if (at >= 0) remaining.splice(at, 1)
    })

  return bySeedId
}

let built: { items: CapabilityResource[]; aliases: Map<string, CapabilityResource> } | undefined
let builtFrom: CapabilityResource[] | undefined

export function buildModelCapabilityCatalog(enrichments: CapabilityResource[]) {
  if (built && builtFrom === enrichments) return built

  const bySeedId = assignEnrichments(enrichments.filter((item) => item.category === "onemodel"))
  const used = new Set([...bySeedId.values()])
  const leftover: CapabilityResource[] = enrichments
    .filter((item) => item.category === "onemodel" && !used.has(item))
    .map((item) => {
      const installable = hasModelScopeInstall(item.name)
      const available =
        typeof item.available === "boolean"
          ? item.available
          : isModelCatalogInteractive(item.name, item)
      return {
        ...item,
        ownership: "catalog" as const,
        available,
        installable: typeof item.installable === "boolean" ? item.installable : installable,
        docsHref: resolveModelDocsHref(item.name, item),
      }
    })
  const items: CapabilityResource[] = [
    ...seedModels.map((seed) => toCapabilityResource(seed, bySeedId.get(seed.id))),
    ...leftover,
  ]
  items.sort((a, b) => {
    const rank = (item: CapabilityResource) => {
      if (item.installable) return 2
      if (item.available !== false) return 1
      return 0
    }
    const byRank = rank(b) - rank(a)
    if (byRank !== 0) return byRank
    return a.name.localeCompare(b.name, "en")
  })

  const aliases = new Map<string, CapabilityResource>()
  for (const item of items) {
    aliases.set(item.id, item)
    if (item.resourceId) aliases.set(item.resourceId, item)
    aliases.set(normalizeTitle(item.name), item)
    aliases.set(seedSlug(item.resourceId ?? item.id), item)
  }

  const next = { items, aliases }
  built = next
  builtFrom = enrichments
  return next
}

export function listModelCapabilityResources(domain: CapabilityDomain | undefined, enrichments: CapabilityResource[]) {
  const { items } = buildModelCapabilityCatalog(enrichments)
  if (!domain) return items
  return items.filter((item) => item.domain === domain)
}

export function getModelCapabilityResource(id: string, enrichments: CapabilityResource[]) {
  const { aliases } = buildModelCapabilityCatalog(enrichments)
  return aliases.get(id) ?? aliases.get(normalizeTitle(id)) ?? aliases.get(seedSlug(id))
}

export function isCapabilityResourceAvailable(resource: CapabilityResource) {
  if (resource.ownership === "private") return true
  if (resource.category === "hpc") return true
  return resource.available !== false
}

/** Install is gated on curated ModelScope download mapping only. */
export function isCapabilityResourceInstallable(resource: CapabilityResource) {
  if (resource.ownership === "private") return true
  if (resource.category === "hpc") return true
  if (typeof resource.installable === "boolean") return resource.installable
  return hasModelScopeInstall(resource.name)
}

export function modelResourceSeedCount() {
  return seedModels.length
}
