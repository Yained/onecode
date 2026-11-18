import { createSignal } from "solid-js"
import type { CapabilityDomain, CapabilityResource, CapabilityScenario } from "./catalog"

export type PrivateModelAsset = {
  id: string
  name: string
  blurb: string
  tags: string[]
  domain: CapabilityDomain
  createdAt: number
}

const STORAGE_KEY = "os-capability-private-models"

const defaultFields = [
  { id: "system", label: "研究对象 / 材料体系", placeholder: "例如：目标体系或任务对象" },
  { id: "inputData", label: "输入数据", placeholder: "例如：权重路径、配置或样例输入", multiline: true },
  { id: "goal", label: "任务目标", placeholder: "希望得到什么结果", multiline: true },
  { id: "environment", label: "运行环境", placeholder: "例如：远程 GPU / 单卡冒烟" },
]

function readStored(): PrivateModelAsset[] {
  if (typeof localStorage === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as PrivateModelAsset[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.blurb === "string" &&
        Array.isArray(item.tags) &&
        (item.domain === "materials" ||
          item.domain === "weather" ||
          item.domain === "fluid" ||
          item.domain === "bio"),
    )
  } catch {
    return []
  }
}

function writeStored(items: PrivateModelAsset[]) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

const [privateModels, setPrivateModels] = createSignal<PrivateModelAsset[]>(readStored())

export function resetPrivateModelsForTests() {
  setPrivateModels([])
  writeStored([])
}

export function listPrivateModels(domain?: CapabilityDomain | "all") {
  const items = privateModels()
  if (!domain || domain === "all") return items
  return items.filter((item) => item.domain === domain)
}

export function savePrivateModel(input: {
  name: string
  blurb: string
  tags: string[]
  domain: CapabilityDomain
}) {
  const asset: PrivateModelAsset = {
    id: `private_${Date.now()}`,
    name: input.name.trim(),
    blurb: input.blurb.trim(),
    tags: input.tags.map((tag) => tag.trim()).filter(Boolean),
    domain: input.domain,
    createdAt: Date.now(),
  }
  const next = [asset, ...privateModels().filter((item) => item.id !== asset.id)]
  setPrivateModels(next)
  writeStored(next)
  return asset
}

export function isPrivateCapabilityId(id: string) {
  return id.startsWith("private_")
}

function defaultScenarios(asset: PrivateModelAsset): CapabilityScenario[] {
  const prompt = [
    `请基于私有模型「${asset.name}」开始科研任务。`,
    "研究对象 / 材料体系：{{system}}",
    "输入数据：{{inputData}}",
    "任务目标：{{goal}}",
    "运行环境：{{environment}}",
    "该模型来自私有资产，已登记为后台 AI 原语，可供 Agent 检索与编排。请先确认权重/依赖可用，再给出可执行步骤。",
  ].join("\n")

  return [
    {
      id: `${asset.id}-run`,
      title: "运行私有模型",
      summary: asset.blurb,
      fields: defaultFields,
      capabilitySummary: {
        current: asset.name,
        keyConfig: asset.tags.join(" / ") || "私有模型配置",
        resources: "用户私有环境",
        deliverables: "任务结果与可复现记录",
      },
      expectedOutputs: "运行日志、关键结果摘要与下一步建议",
      promptTemplate: prompt,
    },
    {
      id: `${asset.id}-eval`,
      title: "评估私有模型",
      summary: "检查精度、稳定性与是否可进入后续工作流",
      fields: defaultFields,
      capabilitySummary: {
        current: asset.name,
        keyConfig: "评估指标与样例集",
        resources: "用户私有环境",
        deliverables: "评估报告",
      },
      expectedOutputs: "误差/指标表、异常样本与结论",
      promptTemplate: prompt.replace("开始科研任务", "完成评估"),
    },
    {
      id: `${asset.id}-integrate`,
      title: "接入工作流",
      summary: "把私有模型接到现有数据与下游任务",
      fields: defaultFields,
      capabilitySummary: {
        current: asset.name,
        keyConfig: "输入输出契约",
        resources: "用户私有环境",
        deliverables: "可复用工作流片段",
      },
      expectedOutputs: "接入方案、命令清单与验证结果",
      promptTemplate: prompt.replace("开始科研任务", "完成工作流接入"),
    },
  ]
}

export function privateModelToResource(asset: PrivateModelAsset): CapabilityResource {
  const tags = asset.tags.includes("私有") ? asset.tags : ["私有", ...asset.tags]
  return {
    id: asset.id,
    name: asset.name,
    category: "onemodel",
    domain: asset.domain,
    tags,
    blurb: asset.blurb,
    ownership: "private",
    docsHref: "",
    intro: {
      title: "30 秒看懂私有模型",
      subtitle: asset.blurb,
      suited: asset.tags.slice(0, 4),
      notFor: ["缺少权重或依赖说明", "与当前领域明显不匹配"],
      prepare: ["模型权重或访问入口", "运行依赖", "样例输入"],
      obtain: ["推理/训练结果", "评估摘要", "可复现配置"],
      steps: ["确认领域与标签", "检查依赖", "选择任务场景", "创建任务并由 Agent 执行"],
    },
    install: {
      banner: `已为你创建「${asset.name}」私有模型环境配置任务`,
      prompt: [
        `请为私有模型「${asset.name}」创建可运行环境配置任务。`,
        `简介：${asset.blurb}`,
        `标签：${tags.join("、")}`,
        "要求：先检查当前项目与运行环境，再给出最小验证命令；该资产已作为后台 AI 原语登记，可供后续 Agent 编排。",
      ].join("\n"),
    },
    scenarios: defaultScenarios(asset),
  }
}

export function listPrivateModelResources(domain?: CapabilityDomain | "all") {
  return listPrivateModels(domain).map(privateModelToResource)
}

export function getPrivateModelResource(id: string) {
  const asset = privateModels().find((item) => item.id === id)
  if (!asset) return undefined
  return privateModelToResource(asset)
}
