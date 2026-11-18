import { authenticatedFetch } from "@/utils/authenticated-fetch"
import { invalidateCatalogMetricsCache } from "./catalog-metrics-client"
import { primitiveCategoryLabel, primitiveCategoryShortLabel, primitiveTypeFilters } from "./onescience-primitives"
import type { AIPrimitiveItem, AIPrimitivePageResult } from "./onescience-primitives-types"

export type PrimitiveCategoryLink = {
  callable?: AIPrimitiveItem
  draft?: AIPrimitiveItem
}

export type PrimitiveResourceLookupEntry = {
  callable?: AIPrimitiveItem
  draft?: AIPrimitiveItem
  model?: PrimitiveCategoryLink
  inference?: PrimitiveCategoryLink
  training?: PrimitiveCategoryLink
  slots?: Record<string, PrimitiveCategoryLink>
}

export type PrimitiveResourceLink = {
  callableId?: string
  draftId?: string
  modelCallableId?: string
  modelDraftId?: string
  inferenceCallableId?: string
  inferenceDraftId?: string
  trainingCallableId?: string
  trainingDraftId?: string
  datasetCallableId?: string
  datasetDraftId?: string
  dataProcessingCallableId?: string
  dataProcessingDraftId?: string
}

export type PrimitivePublishSlot = "inference" | "training" | "dataset" | "data-processing" | "default"

export type PrimitivePublishActionResult = {
  disabled: boolean
  label: string
  draftId: string | undefined
  publishSlot: PrimitivePublishSlot | undefined
  initialPrimitiveType: string | undefined
}

function slotIds(link?: PrimitiveCategoryLink) {
  return {
    callableId: link?.callable?.id,
    draftId: link?.draft?.id,
  }
}

export function mapPrimitiveResourceLink(entry?: PrimitiveResourceLookupEntry): PrimitiveResourceLink {
  if (!entry) return {}
  const slots = entry.slots ?? {}
  const model = entry.model ?? slots["model"]
  const inference = entry.inference ?? slots["model-inference"]
  const training = entry.training ?? slots["model-training"]
  const dataset = slots["dataset"]
  const dataProcessing = slots["data-processing"]
  const modelIds = slotIds(model)
  const inferenceIds = slotIds(inference)
  const trainingIds = slotIds(training)
  const datasetIds = slotIds(dataset)
  const processingIds = slotIds(dataProcessing)
  const modelDraftId = modelIds.callableId ? undefined : modelIds.draftId
  const inferenceDraftId = inferenceIds.callableId ? undefined : inferenceIds.draftId
  const trainingDraftId = trainingIds.callableId ? undefined : trainingIds.draftId
  const datasetDraftId = datasetIds.callableId ? undefined : datasetIds.draftId
  const dataProcessingDraftId = processingIds.callableId ? undefined : processingIds.draftId
  const anySlotPublished = !!(modelIds.callableId || inferenceIds.callableId || trainingIds.callableId || datasetIds.callableId || processingIds.callableId)
  return {
    callableId: entry.callable?.id ?? modelIds.callableId,
    draftId: modelDraftId
      ?? inferenceDraftId
      ?? trainingDraftId
      ?? datasetDraftId
      ?? dataProcessingDraftId
      ?? (anySlotPublished ? undefined : entry.draft?.id),
    modelCallableId: modelIds.callableId,
    modelDraftId,
    inferenceCallableId: inferenceIds.callableId,
    inferenceDraftId,
    trainingCallableId: trainingIds.callableId,
    trainingDraftId,
    datasetCallableId: datasetIds.callableId,
    datasetDraftId,
    dataProcessingCallableId: processingIds.callableId,
    dataProcessingDraftId,
  }
}

export function publishedCallablePrimitiveTypes(link: PrimitiveResourceLink) {
  return [
    ...(link.modelCallableId ? ["model"] : []),
    ...(link.inferenceCallableId ? ["model.run"] : []),
    ...(link.trainingCallableId ? ["model.train"] : []),
    ...(link.datasetCallableId ? ["data.load"] : []),
    ...(link.dataProcessingCallableId ? ["data.transform"] : []),
  ]
}

export function modelPrimitivePublishAction(link: PrimitiveResourceLink): PrimitivePublishActionResult {
  const modelPublished = !!link.modelCallableId
  const inferencePublished = !!link.inferenceCallableId
  const trainingPublished = !!link.trainingCallableId
  const modelDraftId = modelPublished ? undefined : link.modelDraftId
  const inferenceDraftId = inferencePublished ? undefined : link.inferenceDraftId
  const trainingDraftId = trainingPublished ? undefined : link.trainingDraftId

  if (modelPublished && inferencePublished && trainingPublished) {
    return { disabled: true, label: "查看原语", draftId: undefined, publishSlot: undefined, initialPrimitiveType: undefined }
  }
  // Prefer unfinished drafts. remainingTypesCount > 1 → dialog keeps type select unlocked
  // (initialPrimitiveType is only a default). "发布推理/训练原语" only when that slot is last.
  if (!inferencePublished && inferenceDraftId) {
    return {
      disabled: false,
      label: trainingPublished ? "发布推理原语" : "发布原语",
      draftId: inferenceDraftId,
      publishSlot: "inference",
      initialPrimitiveType: "model.run",
    }
  }
  if (!trainingPublished && trainingDraftId) {
    return {
      disabled: false,
      label: inferencePublished ? "发布训练原语" : "发布原语",
      draftId: trainingDraftId,
      publishSlot: "training",
      initialPrimitiveType: "model.train",
    }
  }
  if (!modelPublished && modelDraftId) {
    return { disabled: false, label: "发布原语", draftId: modelDraftId, publishSlot: "default", initialPrimitiveType: "model" }
  }
  // Both inference & training free (model may already exist via oneskills) — do not force model.run.
  if (!inferencePublished && !trainingPublished) {
    return {
      disabled: false,
      label: "发布原语",
      draftId: undefined,
      publishSlot: "inference",
      initialPrimitiveType: modelPublished ? undefined : "model.run",
    }
  }
  if (!inferencePublished) {
    return { disabled: false, label: "发布推理原语", draftId: undefined, publishSlot: "inference", initialPrimitiveType: "model.run" }
  }
  if (!trainingPublished) {
    return { disabled: false, label: "发布训练原语", draftId: undefined, publishSlot: "training", initialPrimitiveType: "model.train" }
  }
  if (!modelPublished) {
    return { disabled: false, label: "发布原语", draftId: link.draftId, publishSlot: undefined, initialPrimitiveType: "model" }
  }
  return { disabled: false, label: "发布原语", draftId: undefined, publishSlot: undefined, initialPrimitiveType: undefined }
}

export function datasetPrimitivePublishAction(link: PrimitiveResourceLink): PrimitivePublishActionResult {
  const datasetPublished = !!link.datasetCallableId
  const processingPublished = !!link.dataProcessingCallableId
  const datasetDraftId = datasetPublished ? undefined : link.datasetDraftId
  const processingDraftId = processingPublished ? undefined : link.dataProcessingDraftId

  if (datasetPublished && processingPublished) {
    return { disabled: true, label: "查看原语", draftId: undefined, publishSlot: undefined, initialPrimitiveType: undefined }
  }
  // Prefer unfinished drafts. oneskills datapipe occupies data-processing → only dataset remains.
  if (!datasetPublished && datasetDraftId) {
    return {
      disabled: false,
      label: processingPublished ? "发布数据集原语" : "发布原语",
      draftId: datasetDraftId,
      publishSlot: "dataset",
      initialPrimitiveType: "data.load",
    }
  }
  if (!processingPublished && processingDraftId) {
    return {
      disabled: false,
      label: datasetPublished ? "发布数据处理原语" : "发布原语",
      draftId: processingDraftId,
      publishSlot: "data-processing",
      initialPrimitiveType: "data.transform",
    }
  }
  if (!datasetPublished && processingPublished) {
    return { disabled: false, label: "发布数据集原语", draftId: undefined, publishSlot: "dataset", initialPrimitiveType: "data.load" }
  }
  if (datasetPublished && !processingPublished) {
    return { disabled: false, label: "发布数据处理原语", draftId: undefined, publishSlot: "data-processing", initialPrimitiveType: "data.transform" }
  }
  return { disabled: false, label: "发布原语", draftId: link.draftId, publishSlot: undefined, initialPrimitiveType: undefined }
}

export function singleSlotPrimitivePublishAction(link: PrimitiveResourceLink): PrimitivePublishActionResult {
  if (link.callableId) {
    return { disabled: true, label: "查看原语", draftId: undefined, publishSlot: undefined, initialPrimitiveType: undefined }
  }
  return { disabled: false, label: "发布原语", draftId: link.draftId, publishSlot: undefined, initialPrimitiveType: undefined }
}

export function resourcePrimitivePublishAction(page: string | undefined, link: PrimitiveResourceLink): PrimitivePublishActionResult {
  if (page === "models") return modelPrimitivePublishAction(link)
  if (page === "datasets") return datasetPrimitivePublishAction(link)
  return singleSlotPrimitivePublishAction(link)
}

export function resourcePrimitiveSlotsPublished(page: string | undefined, link: PrimitiveResourceLink) {
  if (page === "models") return !!link.inferenceCallableId && !!link.trainingCallableId
  if (page === "datasets") return !!link.datasetCallableId && !!link.dataProcessingCallableId
  return !!link.callableId
}

export function mergePublishedPrimitiveLink(
  link: PrimitiveResourceLink,
  publishedId: string,
  slot: PrimitivePublishSlot,
) {
  if (slot === "inference") {
    return {
      ...link,
      inferenceCallableId: publishedId,
      inferenceDraftId: undefined,
      callableId: publishedId,
      draftId: link.trainingDraftId,
    }
  }
  if (slot === "training") {
    return {
      ...link,
      trainingCallableId: publishedId,
      trainingDraftId: undefined,
      callableId: link.inferenceCallableId ?? publishedId,
      draftId: link.inferenceDraftId,
    }
  }
  if (slot === "dataset") {
    return {
      ...link,
      datasetCallableId: publishedId,
      datasetDraftId: undefined,
      callableId: publishedId,
      draftId: link.dataProcessingDraftId,
    }
  }
  if (slot === "data-processing") {
    return {
      ...link,
      dataProcessingCallableId: publishedId,
      dataProcessingDraftId: undefined,
      callableId: link.datasetCallableId ?? publishedId,
      draftId: link.datasetDraftId,
    }
  }
  return { ...link, callableId: publishedId, draftId: undefined }
}

export type CatalogEntrySummary = {
  id: string
  kind: "skill" | "primitive"
  name: string
  title: string
  description: string
  category?: string
  tags: string[]
  source?: string
  status?: string
  score?: number
}

type CatalogSearchResponse = {
  items: CatalogEntrySummary[]
  total: number
}

export type CatalogPrimitiveListInput = {
  q?: string
  domain?: string
  primitiveType?: string
  status?: string
  limit?: number
  offset?: number
  category?: string
  summary?: boolean
  officialOnly?: boolean
}

export function oneScienceApiBaseUrl(serverUrl: string) {
  try {
    return new URL(serverUrl).toString().replace(/\/$/, "")
  } catch {
    return serverUrl.replace(/\/$/, "")
  }
}

export function primitiveCategoryFromPrimitiveType(primitiveType: string, id?: string) {
  if (primitiveType === "data.load" && id?.startsWith("primitive-resource-")) return "dataset"
  if (primitiveType === "data.load") return "data-processing"
  if (primitiveType === "data.transform") return "data-processing"
  if (primitiveType === "model") return "model"
  if (primitiveType === "model.run") return "model-inference"
  if (primitiveType === "model.train") return "model-training"
  if (primitiveType === "model.evaluate") return "evaluation"
  if (primitiveType === "app.launch" || primitiveType === "workflow.compose" || primitiveType === "app.workflow") return "app"
  if (primitiveType === "code.generate" || primitiveType === "nn.Module" || primitiveType === "asset") return "code-asset"
  return "code-asset"
}

export function primitiveTypeDisplayLabel(primitiveType: string) {
  return primitiveCategoryLabel[primitiveCategoryFromPrimitiveType(primitiveType)] ?? primitiveType
}

export function primitiveCategoryFromItem(item: AIPrimitiveItem) {
  const contractCategory = item.contractJson?.primitiveCategory
  if (typeof contractCategory === "string") return contractCategory
  const tagged = item.intentTags.find((tag) => tag.startsWith("category:"))?.slice("category:".length)
  if (tagged) return tagged
  if (item.primitiveType) return primitiveCategoryFromPrimitiveType(item.primitiveType)
  return "code-asset"
}

export function catalogEntryToPrimitiveItem(entry: CatalogEntrySummary): AIPrimitiveItem {
  const primitiveType = entry.category ?? "unknown"
  const primitiveCategory = primitiveCategoryFromPrimitiveType(primitiveType, entry.id)
  return {
    id: entry.id,
    title: entry.title,
    description: entry.description,
    domain: "",
    primitiveType,
    intentTags: entry.tags,
    status: (entry.status as AIPrimitiveItem["status"]) ?? "callable",
    owner: ownerFromCatalogSource(entry.source),
    contractJson: { primitiveCategory },
    catalogScore: entry.score,
  }
}

export function primitiveLiteralMatch(item: AIPrimitiveItem, q: string) {
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const haystack = [item.id, item.slug ?? "", item.title, item.description, ...item.intentTags].join(" ").toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

export function pruneCatalogSearchResults(items: readonly AIPrimitiveItem[], q?: string): AIPrimitiveItem[] {
  const query = q?.trim() ?? ""
  const ranked = [...items].toSorted((a, b) => (b.catalogScore ?? 0) - (a.catalogScore ?? 0))
  if (!query) return ranked

  const literal = ranked.filter((item) => primitiveLiteralMatch(item, query))
  const pool = literal.length > 0 ? literal : ranked
  const scored = pool.filter((item) => typeof item.catalogScore === "number" && item.catalogScore > 0)
  if (scored.length <= 1) return pool.length > 0 ? pool : ranked.slice(0, 1)

  const top = Math.max(...scored.map((item) => item.catalogScore!))
  const min = top * 0.85
  const kept = pool.filter((item) => item.catalogScore === undefined || item.catalogScore >= min)
  return kept.length > 0 ? kept : pool.slice(0, 1)
}

export async function searchPrimitivesViaCatalog(serverUrl: string, input?: CatalogPrimitiveListInput) {
  const result = await searchCatalogEntries(serverUrl, {
    kind: "primitive",
    q: input?.q,
    domain: input?.domain,
    primitiveType: input?.primitiveType,
    status: input?.status,
    limit: input?.limit ?? 50,
  })
  if (!result.loaded) return { items: [], loaded: false as const }
  const filtered = filterAIPrimitiveItems(result.items.map(catalogEntryToPrimitiveItem), {
    category: input?.category,
    status: input?.status,
    domain: input?.domain,
    primitiveType: input?.primitiveType,
  })
  return {
    items: pruneCatalogSearchResults(filtered.items, input?.q),
    loaded: true as const,
    total: filtered.items.length,
  }
}

const skillGroupTitles = {
  orchestrator: "编排层",
  resource: "资源层",
  expert: "专家层",
  executor: "执行层",
} as const

export const skillSystemGroups = [
  { id: "orchestrator", title: skillGroupTitles.orchestrator, copy: "理解用户意图、维护 Task State，并调度资源层、专家层与执行层技能。" },
  { id: "resource", title: skillGroupTitles.resource, copy: "召回 AI 原语、模型卡、数据契约与轻量规划知识，为编排与执行提供资源摘要。" },
  { id: "expert", title: skillGroupTitles.expert, copy: "面向具体科研意图输出 planner proposal，把工作流、数据处理等方案交给编排层融合。" },
  { id: "executor", title: skillGroupTitles.executor, copy: "完成代码实现、数据分析、环境安装、任务提交、论文复现与平台操作等实际执行。" },
] as const

const legacyLayerToGroupId = {
  "入口层": "orchestrator",
  "协作与路由层": "expert",
  "执行层": "executor",
  "保障层": "executor",
  "其它": "executor",
} as const

export function skillGroupTitleFromId(id: string | undefined) {
  if (!id) return skillGroupTitles.executor
  return skillSystemGroups.find((group) => group.id === id)?.title ?? skillGroupTitles.executor
}

export function skillGroupIdFromTitle(title: string) {
  return skillSystemGroups.find((group) => group.title === title)?.id
}

function skillGroupFromEntry(entry: { name: string; category?: string; tags: string[] }) {
  if (entry.category && entry.category in skillGroupTitles) {
    return skillGroupTitles[entry.category as keyof typeof skillGroupTitles]
  }
  if (entry.category && entry.category in legacyLayerToGroupId) {
    return skillGroupTitleFromId(legacyLayerToGroupId[entry.category as keyof typeof legacyLayerToGroupId])
  }
  const fromTag = entry.tags.find((tag) => tag in skillGroupTitles)
  if (fromTag) return skillGroupTitles[fromTag as keyof typeof skillGroupTitles]
  const legacyTag = entry.tags.find((tag) => tag in legacyLayerToGroupId)
  if (legacyTag) return skillGroupTitleFromId(legacyLayerToGroupId[legacyTag as keyof typeof legacyLayerToGroupId])
  if (entry.name === "onescience-orchestrator") return skillGroupTitles.orchestrator
  return skillGroupTitles.executor
}

function skillSourceLabel(source?: string) {
  if (source === "official") return "OneSkills"
  if (source === "repo") return "技能仓库"
  if (source === "local" || source === "opencode-config") return "本地技能"
  return source ?? "catalog"
}

export async function listCatalogSkills(serverUrl: string, input?: { layer?: string; q?: string; limit?: number }) {
  const groupId = input?.layer && input.layer !== "全部" ? skillGroupIdFromTitle(input.layer) : undefined
  const result = await searchCatalogEntries(serverUrl, {
    kind: "skill",
    q: input?.q,
    category: groupId,
    limit: input?.limit ?? 50,
    officialOnly: true,
  })
  if (!result.loaded) return { items: [], loaded: false as const }
  return {
    items: result.items.map((entry) => ({
      id: entry.name,
      title: entry.title || entry.name,
      copy: entry.description,
      layer: skillGroupFromEntry(entry),
      tags: entry.tags,
      provider: skillSourceLabel(entry.source),
      size: entry.source ?? "skill",
      format: "SKILL.md",
      href: undefined,
      metricLabel: "规模" as const,
      action: "开发" as const,
      primitives: [] as { id: string; title: string }[],
      sortOrder: skillSystemGroups.findIndex((group) => group.title === skillGroupFromEntry(entry)),
    })),
    loaded: true as const,
    nextOffset: undefined as number | undefined,
  }
}

export const PRIMITIVE_OWNER_LOCAL = "local"
export const PRIMITIVE_OWNER_PLATFORM = "platform"
export const PRIMITIVE_OWNER_SYSTEM = "system"
export const RECENT_PRIMITIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export type PrimitiveCatalogScope = "all" | "mine" | "recent"

export const primitiveCatalogScopeFilters: { id: PrimitiveCatalogScope; label: string; hint?: string }[] = [
  { id: "all", label: "全部" },
  { id: "mine", label: "我的" },
  { id: "recent", label: "最近", hint: "最近 7 天" },
]

export function countPrimitivesByCategory(items: readonly AIPrimitiveItem[]) {
  const counts = new Map<string, number>()
  for (const item of items) {
    const category = primitiveCategoryFromItem(item)
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  return counts
}

export type PrimitiveCategoryFilterOption = {
  label: string
  shortLabel: string
  category?: string
  count: number
}

export function primitiveCategoryFilterOptions(items: readonly AIPrimitiveItem[]) {
  const counts = countPrimitivesByCategory(items)
  return primitiveTypeFilters.flatMap((filter) => {
    if (!filter.category) return []
    const count = counts.get(filter.category) ?? 0
    if (count === 0) return []
    return [{
      label: filter.label,
      shortLabel: primitiveCategoryShortLabel[filter.category] ?? filter.label,
      category: filter.category,
      count,
    } satisfies PrimitiveCategoryFilterOption]
  })
}

export const PRIMITIVE_CATEGORY_BAR_SCOPED_MIN_ITEMS = 6
export const PRIMITIVE_CATEGORY_BAR_SCOPED_MIN_CATEGORIES = 2

export function shouldShowPrimitiveCategoryBar(
  scope: PrimitiveCatalogScope,
  items: readonly AIPrimitiveItem[],
  options: readonly PrimitiveCategoryFilterOption[],
) {
  if (options.length === 0) return false
  if (scope === "all") return true
  if (items.length < PRIMITIVE_CATEGORY_BAR_SCOPED_MIN_ITEMS) return false
  return options.length >= PRIMITIVE_CATEGORY_BAR_SCOPED_MIN_CATEGORIES
}

export function isSystemOwnedPrimitive(item: AIPrimitiveItem) {
  return item.owner === PRIMITIVE_OWNER_SYSTEM
}

export function isPlatformTemplatePrimitive(item: AIPrimitiveItem) {
  return item.owner === PRIMITIVE_OWNER_PLATFORM || item.owner === PRIMITIVE_OWNER_LOCAL
}

export function isUserCreatedPrimitiveId(id: string) {
  return /^primitive-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}

/** Preset catalog rows guests may browse (mirrors backend isPresetPrimitive). */
export function isPresetCatalogPrimitive(item: { id: string; owner?: string | null }) {
  if (item.owner === PRIMITIVE_OWNER_SYSTEM) return true
  if (item.owner !== PRIMITIVE_OWNER_PLATFORM && item.owner !== PRIMITIVE_OWNER_LOCAL) return false
  if (!item.id.startsWith("primitive-resource-")) return false
  return !item.id.startsWith("primitive-resource-custom-")
}

export function ownerFromCatalogSource(source?: string) {
  if (source === "local" || source === "opencode-config") return PRIMITIVE_OWNER_LOCAL
  if (source === "official") return PRIMITIVE_OWNER_SYSTEM
}

export function isUserOwnedPrimitive(item: AIPrimitiveItem, userResourceIds: ReadonlySet<string>, accountId?: string) {
  if (accountId && item.owner === accountId) return true
  if (isPlatformTemplatePrimitive(item) || isSystemOwnedPrimitive(item)) return false
  if (item.owner && item.owner !== PRIMITIVE_OWNER_SYSTEM && item.owner !== PRIMITIVE_OWNER_PLATFORM) return true
  if (isUserCreatedPrimitiveId(item.id)) return true
  return item.sourceResourceIds?.some((id) => userResourceIds.has(id) || id.startsWith("custom-")) ?? false
}

export function enrichPrimitiveItemFromCatalog(item: AIPrimitiveItem, source: readonly AIPrimitiveItem[]) {
  const match = source.find((entry) => entry.id === item.id)
  if (!match) return item
  return {
    ...item,
    owner: match.owner ?? item.owner,
    sourceResourceIds: item.sourceResourceIds ?? match.sourceResourceIds,
    timeCreated: item.timeCreated ?? match.timeCreated,
    domain: item.domain || match.domain,
    slug: item.slug ?? match.slug,
    contractJson: item.contractJson ?? match.contractJson,
  }
}

export function isRecentPrimitive(item: AIPrimitiveItem, now = Date.now()) {
  if (!item.timeCreated) return false
  return now - item.timeCreated <= RECENT_PRIMITIVE_WINDOW_MS
}

export function filterPrimitivesByCatalogScope(
  items: readonly AIPrimitiveItem[],
  scope: PrimitiveCatalogScope,
  userResourceIds: ReadonlySet<string>,
  accountId?: string,
) {
  let result: AIPrimitiveItem[]
  if (scope === "all") result = [...items]
  else if (scope === "mine") result = items.filter((item) => isUserOwnedPrimitive(item, userResourceIds, accountId))
  else {
    result = items
      .filter((item) => isRecentPrimitive(item))
      .toSorted((a, b) => (b.timeCreated ?? 0) - (a.timeCreated ?? 0))
  }
  // Guests only browse presets; never other accounts' published callables.
  if (!accountId) result = result.filter(isPresetCatalogPrimitive)
  return result
}

export function primitiveCatalogHref(input: { id: string; scope?: Extract<PrimitiveCatalogScope, "mine" | "recent">; openDetail?: boolean; openUse?: boolean }) {
  const params = new URLSearchParams({ tab: "catalog", highlight: input.id })
  if (input.scope) params.set("scope", input.scope)
  if (input.openDetail) params.set("openDetail", "1")
  if (input.openUse) params.set("openUse", "1")
  return `/primitives?${params}`
}

export async function fetchUserUploadedResourceIds(serverUrl: string) {
  const ids = new Set<string>()
  for (const page of ["datasets", "models", "apps"] as const) {
    let offset = 0
    while (true) {
      const query = new URLSearchParams({ page, limit: "100", offset: String(offset), customOnly: "true" })
      const response = await authenticatedFetch(`${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/resource?${query}`)
      if (!response.ok) break
      const result = await response.json() as { items: { id: string }[]; nextOffset?: number }
      for (const item of result.items) ids.add(item.id)
      if (typeof result.nextOffset !== "number") break
      offset = result.nextOffset
    }
  }
  return ids
}

export function filterAIPrimitiveItems(items: readonly AIPrimitiveItem[], input?: CatalogPrimitiveListInput): AIPrimitivePageResult {
  let result = [...items]
  if (input?.status) result = result.filter((item) => item.status === input.status)
  if (input?.domain) result = result.filter((item) => item.domain === input.domain)
  if (input?.category) result = result.filter((item) => primitiveCategoryFromItem(item) === input.category)
  if (input?.primitiveType) result = result.filter((item) => item.primitiveType === input.primitiveType)
  if (input?.q?.trim()) {
    const q = input.q.trim().toLowerCase()
    result = result.filter((item) =>
      item.id.toLowerCase().includes(q) ||
      item.title.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      (item.slug ?? "").toLowerCase().includes(q) ||
      item.intentTags.some((tag) => tag.toLowerCase().includes(q)),
    )
  }

  const offset = input?.offset ?? 0
  if (input?.limit !== undefined || input?.offset !== undefined) {
    const limit = input.limit ?? result.length
    const slice = result.slice(offset, offset + limit)
    return {
      items: slice,
      loaded: true,
      nextOffset: offset + slice.length < result.length ? offset + limit : undefined,
    }
  }

  return { items: result, loaded: true }
}

export async function searchCatalogEntries(serverUrl: string, input: CatalogPrimitiveListInput & { kind?: "skill" | "primitive" }) {
  const body: Record<string, unknown> = {
    kind: input.kind ?? "primitive",
    k: Math.max(1, Math.min(input.limit ?? 50, 50)),
  }
  if (input.q?.trim()) body.q = input.q.trim()
  if (input.category) body.category = input.category
  if (input.primitiveType) body.category = input.primitiveType
  if (input.status) body.status = input.status
  if (input.domain) body.domain = input.domain
  if (input.officialOnly) body.officialOnly = true

  const response = await authenticatedFetch(`${oneScienceApiBaseUrl(serverUrl)}/catalog/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) return { items: [], total: 0, loaded: false as const }
  const data = (await response.json()) as CatalogSearchResponse
  return { ...data, loaded: true as const }
}

export async function resolveCatalogEntry(serverUrl: string, id: string, part: "summary" | "location" | "contract" | "body" | "assets" = "contract") {
  const response = await authenticatedFetch(
    `${oneScienceApiBaseUrl(serverUrl)}/catalog/entries/${encodeURIComponent(id)}/resolve?part=${part}`,
  )
  if (!response.ok) return undefined
  return (await response.json()) as Record<string, unknown>
}

export type CatalogSkillBodyResult = {
  loaded: boolean
  location?: string
  content?: string
  frontmatter?: Record<string, unknown>
  error?: string
}

export async function fetchCatalogSkillBody(serverUrl: string, skillName: string): Promise<CatalogSkillBodyResult> {
  const result = await resolveCatalogEntry(serverUrl, `skill:${skillName}`, "body")
  if (!result) return { loaded: false, error: "无法加载技能内容" }
  const content = typeof result.content === "string" ? result.content : undefined
  const location = typeof result.location === "string" ? result.location : undefined
  const frontmatter =
    result.frontmatter && typeof result.frontmatter === "object" && !Array.isArray(result.frontmatter)
      ? result.frontmatter as Record<string, unknown>
      : undefined
  const error = typeof result.error === "string" ? result.error : content ? undefined : "技能文件不可用"
  return { loaded: true, location, content, frontmatter, error }
}

export async function loadAllAIPrimitives(serverUrl: string, input?: Omit<CatalogPrimitiveListInput, "limit" | "offset">): Promise<AIPrimitivePageResult> {
  let offset = 0
  let collected: AIPrimitiveItem[] = []
  while (true) {
    const page = await listAIPrimitivesExperimental(serverUrl, { ...input, limit: 100, offset })
    if (page.loaded !== true) return { items: collected, loaded: collected.length > 0 }
    collected = offset === 0 ? page.items : [...collected, ...page.items]
    if (typeof page.nextOffset !== "number") return { items: collected, loaded: true }
    offset = page.nextOffset
  }
}

export async function listAIPrimitivesExperimental(serverUrl: string, input?: CatalogPrimitiveListInput): Promise<AIPrimitivePageResult> {
  const pageSize = input?.limit ?? 100
  const explicitPage = input?.limit !== undefined || input?.offset !== undefined
  const loadPage = async (offset: number): Promise<AIPrimitivePageResult> => {
    const query = new URLSearchParams()
    if (input?.status) query.set("status", input.status)
    query.set("summary", input?.summary === false ? "false" : "true")
    query.set("limit", String(pageSize))
    query.set("offset", String(offset))
    if (input?.domain) query.set("domain", input.domain)
    if (input?.primitiveType) query.set("primitiveType", input.primitiveType)
    const response = await authenticatedFetch(`${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/primitive?${query}`)
    if (!response.ok) return { items: [], loaded: false }
    return { ...(await response.json()) as AIPrimitivePageResult, loaded: true }
  }
  try {
    const loadAll = async (offset: number, items: AIPrimitiveItem[]): Promise<AIPrimitivePageResult> => {
      const page = await loadPage(offset)
      if (explicitPage || page.loaded !== true || typeof page.nextOffset !== "number") return { ...page, items: [...items, ...page.items] }
      return loadAll(page.nextOffset, [...items, ...page.items])
    }
    return loadAll(input?.offset ?? 0, [])
  } catch {
    return { items: [], loaded: false }
  }
}

export async function lookupPrimitiveByResource(serverUrl: string, resourceId: string) {
  const result = await lookupPrimitivesByResources(serverUrl, [resourceId])
  if (!result.loaded) return { loaded: false as const }
  const entry = result.items[resourceId]
  return {
    loaded: true as const,
    callable: entry?.callable,
    draft: entry?.draft,
    inference: entry?.inference,
    training: entry?.training,
    slots: entry?.slots,
  }
}

const primitiveResourceLookupCache = new Map<string, PrimitiveResourceLookupEntry>()
const callableCatalogCache = new Map<string, { items: AIPrimitiveItem[]; updatedAt: number }>()
const callableCatalogCacheMaxAge = 30_000
const callablePrimitiveTotalInflight = new Map<string, Promise<number | undefined>>()

export function invalidateCallablePrimitiveTotalCache() {
  callablePrimitiveTotalInflight.clear()
}

export function invalidatePrimitiveCatalogCaches() {
  invalidateCatalogMetricsCache()
  invalidateCallablePrimitiveTotalCache()
  callableCatalogCache.clear()
}

export async function fetchCallablePrimitiveTotal(serverUrl: string, input?: { refresh?: boolean }) {
  const base = oneScienceApiBaseUrl(serverUrl)
  if (input?.refresh) callablePrimitiveTotalInflight.delete(base)
  const inflight = callablePrimitiveTotalInflight.get(base)
  if (inflight) return inflight
  const promise = listAIPrimitivesExperimental(serverUrl, { status: "callable" })
    .then((result) => (result.loaded === true ? result.items.length : undefined))
    .finally(() => {
      if (callablePrimitiveTotalInflight.get(base) === promise) callablePrimitiveTotalInflight.delete(base)
    })
  callablePrimitiveTotalInflight.set(base, promise)
  return promise
}

export function readCallableCatalogCache(serverUrl: string) {
  const cached = callableCatalogCache.get(serverUrl)
  if (!cached || Date.now() - cached.updatedAt > callableCatalogCacheMaxAge) return
  return cached.items
}

export function writeCallableCatalogCache(serverUrl: string, items: AIPrimitiveItem[]) {
  callableCatalogCache.set(serverUrl, { items, updatedAt: Date.now() })
}

export function readCachedPrimitiveResourceLookups(serverUrl: string, resourceIds: readonly string[]) {
  const items: Record<string, PrimitiveResourceLookupEntry> = {}
  const missing: string[] = []
  for (const id of resourceIds) {
    if (!id) continue
    const key = `${serverUrl}:${id}`
    if (!primitiveResourceLookupCache.has(key)) {
      missing.push(id)
      continue
    }
    items[id] = primitiveResourceLookupCache.get(key) ?? {}
  }
  return { items, missing }
}

export function invalidatePrimitiveResourceLookupCacheEntry(serverUrl: string, resourceId: string) {
  primitiveResourceLookupCache.delete(`${serverUrl}:${resourceId}`)
}

export function invalidatePrimitiveResourceLookupCache(serverUrl?: string) {
  if (!serverUrl) {
    primitiveResourceLookupCache.clear()
    callableCatalogCache.clear()
    return
  }
  for (const key of primitiveResourceLookupCache.keys()) {
    if (key.startsWith(`${serverUrl}:`)) primitiveResourceLookupCache.delete(key)
  }
  callableCatalogCache.delete(serverUrl)
}

export async function lookupPrimitivesByResources(serverUrl: string, resourceIds: string[]) {
  const ids = [...new Set(resourceIds.filter(Boolean))]
  if (ids.length === 0) return { loaded: true as const, items: {} as Record<string, PrimitiveResourceLookupEntry> }

  const items: Record<string, PrimitiveResourceLookupEntry> = {}
  const missing: string[] = []
  for (const id of ids) {
    const key = `${serverUrl}:${id}`
    if (!primitiveResourceLookupCache.has(key)) {
      missing.push(id)
      continue
    }
    items[id] = primitiveResourceLookupCache.get(key) ?? {}
  }

  if (missing.length === 0) return { loaded: true as const, items }

  const chunkSize = 40
  for (let offset = 0; offset < missing.length; offset += chunkSize) {
    const chunk = missing.slice(offset, offset + chunkSize)
    const query = new URLSearchParams({ resourceIds: chunk.join(",") })
    const response = await authenticatedFetch(`${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/primitive/by-resources?${query}`)
    if (!response.ok) return { loaded: false as const, items }
    const data = (await response.json()) as {
      items: Array<{ resourceId: string } & PrimitiveResourceLookupEntry>
    }
    for (const entry of data.items) {
      const value: PrimitiveResourceLookupEntry = {
        callable: entry.callable,
        draft: entry.draft,
        model: entry.model,
        inference: entry.inference,
        training: entry.training,
        slots: entry.slots,
      }
      primitiveResourceLookupCache.set(`${serverUrl}:${entry.resourceId}`, value)
      items[entry.resourceId] = value
    }
  }
  for (const id of missing) {
    if (items[id]) continue
    const empty = {}
    primitiveResourceLookupCache.set(`${serverUrl}:${id}`, empty)
    items[id] = empty
  }
  return { loaded: true as const, items }
}

export async function publishAIPrimitive(serverUrl: string, id: string, payload: Record<string, unknown>) {
  const response = await authenticatedFetch(`${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/primitive/${encodeURIComponent(id)}/publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { message?: string } | undefined
    throw new Error(body?.message ?? "发布失败")
  }
  invalidatePrimitiveResourceLookupCache(serverUrl)
  invalidatePrimitiveCatalogCaches()
  return (await response.json()) as AIPrimitiveItem
}

export async function listAIPrimitivesFromDatabase(serverUrl: string, input?: CatalogPrimitiveListInput): Promise<AIPrimitivePageResult> {
  const explicitPage = input?.limit !== undefined || input?.offset !== undefined
  const page = await listAIPrimitivesExperimental(serverUrl, explicitPage ? input : {
    status: input?.status ?? "callable",
    domain: input?.domain,
    primitiveType: input?.primitiveType,
  })
  if (page.loaded !== true) return { items: [], loaded: false }
  if (!explicitPage) return filterAIPrimitiveItems(page.items, input)
  const filtered = filterAIPrimitiveItems(page.items, {
    q: input.q,
    category: input.category,
    status: input.status,
    domain: input.domain,
    primitiveType: input.primitiveType,
  })
  return { ...filtered, nextOffset: page.nextOffset }
}

export async function updateAIPrimitive(serverUrl: string, id: string, payload: Record<string, unknown>) {
  const response = await authenticatedFetch(`${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/primitive/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error("更新失败")
  invalidatePrimitiveResourceLookupCache(serverUrl)
  invalidatePrimitiveCatalogCaches()
  return (await response.json()) as AIPrimitiveItem
}

export async function createAIPrimitive(serverUrl: string, payload: Record<string, unknown>) {
  const response = await authenticatedFetch(`${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/primitive`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error("创建失败")
  invalidatePrimitiveResourceLookupCache(serverUrl)
  invalidatePrimitiveCatalogCaches()
  return (await response.json()) as AIPrimitiveItem
}
