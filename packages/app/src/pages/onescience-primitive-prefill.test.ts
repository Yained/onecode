import { describe, expect, test } from "bun:test"
import {
  factoryDraftResourceTarget,
  factoryStageHint,
  isFactoryQueueItemVisible,
  publishSlotFromPrimitiveType,
  resourceHubHref,
} from "./onescience-primitive-prefill"
import type { AIPrimitiveItem } from "./onescience-primitives-types"

const item = (input: Partial<AIPrimitiveItem> & Pick<AIPrimitiveItem, "id">): AIPrimitiveItem => ({
  title: input.title ?? input.id,
  description: input.description ?? "",
  domain: input.domain ?? "材料化学",
  primitiveType: input.primitiveType ?? "data.load",
  intentTags: input.intentTags ?? [],
  status: input.status ?? "draft",
  ...input,
})

describe("factory stage hint and draft resource target", () => {
  test("returns stage-specific factory tips", () => {
    expect(factoryStageHint("draft")).toBe("从数据集、模型、应用等资源发布原语，草稿在此跟踪")
    expect(factoryStageHint("callable")).toBe("可调用原语进入目录供智能体检索")
    expect(factoryStageHint("all")).toBe("从数据集、模型、应用等资源发布原语，草稿在此跟踪；可调用原语进入目录供智能体检索。")
  })

  test("builds resource hub links that reopen the publish dialog for drafts", () => {
    expect(resourceHubHref("datasets", "seed-datasets-era5")).toBe("/datasets?highlight=era5")
    expect(resourceHubHref("datasets", "seed-datasets-era5", { publish: true, draftId: "draft-1", primitiveType: "data.load" }))
      .toBe("/datasets?highlight=era5&publish=1&draftId=draft-1&primitiveType=data.load")
    expect(factoryDraftResourceTarget(item({
      id: "draft-1",
      sourceResourceIds: ["seed-datasets-era5"],
      primitiveType: "data.load",
    }))).toBe("/datasets?highlight=era5&publish=1&draftId=draft-1&primitiveType=data.load")
    expect(factoryDraftResourceTarget(item({
      id: "draft-2",
      resources: [{ id: "custom-models-abc", title: "Model", page: "models", relationType: "source" }],
      primitiveType: "model.run",
    }))).toBe("/models?highlight=custom-models-abc&publish=1&draftId=draft-2&primitiveType=model.run")
    expect(publishSlotFromPrimitiveType("data.load")).toBe("dataset")
    expect(publishSlotFromPrimitiveType("model.run")).toBe("inference")
  })

  test("hides factory drafts for ModelScope-unavailable OneHub resources", () => {
    expect(isFactoryQueueItemVisible(item({
      id: "ready-dataset",
      status: "draft",
      sourceResourceIds: ["seed-datasets-life-ms-alphafold3"],
    }))).toBe(true)
    expect(isFactoryQueueItemVisible(item({
      id: "grey-dataset",
      status: "draft",
      sourceResourceIds: ["seed-datasets-earth-s2s"],
    }))).toBe(false)
    expect(isFactoryQueueItemVisible(item({
      id: "ready-model",
      status: "draft",
      primitiveType: "model.run",
      sourceResourceIds: ["seed-models-fluid-gp-for-to"],
      resources: [{ id: "seed-models-fluid-gp-for-to", title: "GP_for_TO", page: "models", relationType: "source" }],
    }))).toBe(true)
    expect(isFactoryQueueItemVisible(item({
      id: "grey-model",
      status: "draft",
      primitiveType: "model.run",
      sourceResourceIds: ["seed-models-unavailable"],
      title: "UnavailableModel",
      resources: [{ id: "seed-models-unavailable", title: "UnavailableModel", page: "models", relationType: "source" }],
    }), (cardId) => cardId === "unavailable" ? "UnavailableModel" : undefined)).toBe(false)
    expect(isFactoryQueueItemVisible(item({
      id: "custom-draft",
      status: "draft",
      sourceResourceIds: ["custom-datasets-abc"],
    }))).toBe(true)
    expect(isFactoryQueueItemVisible(item({
      id: "callable-keep",
      status: "callable",
      sourceResourceIds: ["seed-datasets-earth-s2s"],
    }))).toBe(true)
  })
})
