import type { AIPrimitiveItem } from "./onescience-primitives-types"
import { modelScopeDatasetId, modelScopeModelId } from "./modelscope-catalog"

const requiredInputKeyMap: Record<string, string> = {
  storage: "storageLocation",
  schema: "dataSchema",
  access: "accessMethod",
  auth: "authHint",
  transformOutput: "transformOutput",
  checkpoint: "checkpointPath",
  resourceSync: "modelAcquisitionMethod",
  modelAcquisition: "modelAcquisitionMethod",
  framework: "framework",
  inputSpec: "inputSpec",
  outputSpec: "outputSpec",
  datasetIds: "datasetRefs",
  baseCheckpoint: "baseCheckpoint",
  outputCheckpointDir: "outputCheckpointDir",
  trainingConfig: "trainingConfigHint",
  runtime: "runtime",
  entrypoint: "entrypoint",
  resources: "resourceRequirements",
  image: "containerImage",
  inputs: "inputArtifacts",
  install: "installEntry",
  hardware: "hardwareSupport",
  language: "frameworkLanguage",
  adapterRepo: "adapterRepo",
}

const legacyResourceDerivedDescriptionPrefix = /^将(?:资源库数据集|模型库资源|应用库资源)「[^」]+」接入为(?:可调用(?:数据加载|模型推理)原语|可执行科研工作流原语)：\s*/

export function normalizePrimitiveDescription(description: string) {
  return description.replace(legacyResourceDerivedDescriptionPrefix, "").trim()
}

export function parseRequiredInputsToExtraValues(requiredInputs: string[]) {
  const values: Record<string, string> = {}
  for (const line of requiredInputs) {
    const index = line.indexOf(":")
    if (index <= 0) continue
    const prefix = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()
    if (!value) continue
    const key = requiredInputKeyMap[prefix]
    if (key) values[key] = value
  }
  return values
}

export function draftFormState(draft: AIPrimitiveItem) {
  const contract = draft.contractJson
  const agentContract = contract?.agentContract
  const resourceContract =
    agentContract && typeof agentContract === "object"
      ? (agentContract as Record<string, unknown>).resourceContract
      : undefined
  const requiredInputs =
    resourceContract && typeof resourceContract === "object" && Array.isArray((resourceContract as Record<string, unknown>).requiredInputs)
      ? (resourceContract as { requiredInputs: unknown[] }).requiredInputs.filter((item): item is string => typeof item === "string")
      : []

  return {
    title: draft.title,
    description: normalizePrimitiveDescription(draft.description),
    domain: draft.domain,
    primitiveType: draft.primitiveType,
    intentTags: draft.intentTags.join(", "),
    extraValues: parseRequiredInputsToExtraValues(requiredInputs),
  }
}

export function resourceCardIdFromResourceId(resourceId: string) {
  if (resourceId.startsWith("seed-datasets-")) return resourceId.slice("seed-datasets-".length)
  if (resourceId.startsWith("seed-models-")) return resourceId.slice("seed-models-".length)
  if (resourceId.startsWith("seed-apps-")) return resourceId.slice("seed-apps-".length)
  return resourceId
}

export function factoryDraftResourcePage(item: AIPrimitiveItem): "datasets" | "models" | "apps" | undefined {
  const resource = item.resources?.[0]
  const resourceId = item.sourceResourceIds?.[0] ?? resource?.id
  if (resource?.page === "datasets" || resource?.page === "models" || resource?.page === "apps") return resource.page
  if (!resourceId) return undefined
  if (resourceId.startsWith("seed-datasets-") || resourceId.startsWith("custom-datasets-")) return "datasets"
  if (resourceId.startsWith("seed-models-") || resourceId.startsWith("custom-models-")) return "models"
  if (resourceId.startsWith("seed-apps-") || resourceId.startsWith("custom-apps-")) return "apps"
}

/** Hide factory drafts whose OneHub resource is ModelScope-unavailable (greyed out). Callable items always stay. */
export function isFactoryQueueItemVisible(item: AIPrimitiveItem, resolveModelTitle?: (cardId: string) => string | undefined) {
  if (item.status !== "draft") return true
  const resource = item.resources?.[0]
  const resourceId = item.sourceResourceIds?.[0] ?? resource?.id
  if (!resourceId) return true
  if (resourceId.startsWith("custom-")) return true
  const page = factoryDraftResourcePage(item)
  if (!page || page === "apps") return true
  const cardId = resourceCardIdFromResourceId(resourceId)
  if (page === "datasets") return !!modelScopeDatasetId(cardId)
  const title = resolveModelTitle?.(cardId) ?? resource?.title ?? item.title
  return !!modelScopeModelId(title)
}

export function factoryStageHint(stage: "all" | "draft" | "callable") {
  if (stage === "draft") return "从数据集、模型、应用等资源发布原语，草稿在此跟踪"
  if (stage === "callable") return "可调用原语进入目录供智能体检索"
  return "从数据集、模型、应用等资源发布原语，草稿在此跟踪；可调用原语进入目录供智能体检索。"
}

export function resourceHubHref(page: string, resourceId: string, options?: { publish?: boolean; draftId?: string; primitiveType?: string }) {
  const params = new URLSearchParams({ highlight: resourceCardIdFromResourceId(resourceId) })
  if (options?.publish) params.set("publish", "1")
  if (options?.draftId) params.set("draftId", options.draftId)
  if (options?.primitiveType) params.set("primitiveType", options.primitiveType)
  return `/${page}?${params}`
}

export function factoryDraftResourceTarget(item: AIPrimitiveItem) {
  const resource = item.resources?.[0]
  const resourceId = item.sourceResourceIds?.[0] ?? resource?.id
  if (!resourceId) return undefined
  const page = factoryDraftResourcePage(item)
  if (!page) return undefined
  return resourceHubHref(page, resourceId, {
    publish: true,
    draftId: item.id,
    primitiveType: item.primitiveType,
  })
}

export function publishSlotFromPrimitiveType(primitiveType?: string): "inference" | "training" | "dataset" | "data-processing" | "default" {
  if (primitiveType === "model.run") return "inference"
  if (primitiveType === "model.train") return "training"
  if (primitiveType === "data.load") return "dataset"
  if (primitiveType === "data.transform") return "data-processing"
  return "default"
}
