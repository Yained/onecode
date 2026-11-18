import { primitiveCategoryFromPrimitiveType } from "@/pages/onescience-catalog"
import { modelScopeTaskPromptHeader } from "@/pages/model-develop"

export type PrimitiveUseItem = {
  id?: string
  title: string
  description?: string
  copy?: string
  domain?: string
  primitiveType?: string
  intentTags?: readonly string[]
  tags?: readonly string[]
  contractJson?: Record<string, unknown>
}

export type PrimitiveUseScenario = {
  id: string
  label: string
  description: string
  parameterFields?: {
    id: string
    label: string
    placeholder: string
  }[]
}

export type PrimitiveUseSelection = {
  scenarioId: string
  parameters?: Record<string, string>
  notes?: string
}

export function primitiveCategoryForUse(item: Pick<PrimitiveUseItem, "primitiveType" | "contractJson">) {
  const fromContract = item.contractJson?.primitiveCategory
  if (typeof fromContract === "string" && fromContract.trim()) return fromContract
  if (item.primitiveType) return primitiveCategoryFromPrimitiveType(item.primitiveType)
  return "code-asset"
}

export function primitiveUseScenarios(category: string): PrimitiveUseScenario[] {
  if (category === "dataset") {
    return [
      {
        id: "load-preview",
        label: "加载并预览数据",
        description: "生成读取该数据集、查看变量/shape 与样本切片的示例代码。",
        parameterFields: [
          { id: "timeRange", label: "时间范围", placeholder: "例如：2020-01 至 2020-12" },
          { id: "region", label: "空间范围", placeholder: "例如：东亚区域 / 全球" },
        ],
      },
      {
        id: "build-datapipe",
        label: "接入 DataPipe",
        description: "把该数据集接入 OneScience DataPipe 或训练数据流水线。",
        parameterFields: [
          { id: "pipelineGoal", label: "流水线目标", placeholder: "例如：预训练样本生成 / 验证集切片" },
        ],
      },
      {
        id: "schema-provenance",
        label: "梳理字段与来源",
        description: "整理 schema、变量说明、下载路径和 provenance 元数据。",
      },
    ]
  }
  if (category === "model-inference") {
    return [
      {
        id: "minimal-inference",
        label: "最小推理示例",
        description: "生成可运行的最小推理脚本，并说明输入输出张量形状。",
        parameterFields: [
          { id: "inputShape", label: "输入形状", placeholder: "例如：[1, 69, 721, 1440]" },
          { id: "checkpoint", label: "权重/checkpoint", placeholder: "例如：latest / 指定路径" },
        ],
      },
      {
        id: "batch-inference",
        label: "批量推理任务",
        description: "设计批量推理或时空滚动预报任务，并给出运行参数建议。",
        parameterFields: [
          { id: "batchSize", label: "批量大小", placeholder: "例如：4" },
          { id: "horizon", label: "预报时效", placeholder: "例如：未来 10 天" },
        ],
      },
      {
        id: "evaluate-output",
        label: "检查推理输出",
        description: "分析推理结果格式、后处理步骤和可视化方式。",
      },
    ]
  }
  if (category === "model-training") {
    return [
      {
        id: "training-scaffold",
        label: "训练脚本骨架",
        description: "生成训练入口、数据加载、优化器与 checkpoint 保存逻辑。",
        parameterFields: [
          { id: "epochs", label: "训练轮数", placeholder: "例如：50" },
          { id: "learningRate", label: "学习率", placeholder: "例如：1e-4" },
        ],
      },
      {
        id: "finetune",
        label: "微调 / 继续训练",
        description: "基于已有 checkpoint 设计微调方案与数据划分。",
        parameterFields: [
          { id: "baseCheckpoint", label: "起始 checkpoint", placeholder: "例如：官方预训练权重" },
        ],
      },
      {
        id: "review-config",
        label: "检查训练配置",
        description: "审查训练配置、资源需求和潜在风险点。",
      },
    ]
  }
  if (category === "app") {
    return [
      {
        id: "remote-workflow",
        label: "远程作业提交",
        description: "生成 HPC/集群作业提交方案，包含资源、队列和入口脚本。",
        parameterFields: [
          { id: "runtime", label: "运行资源", placeholder: "例如：CPU 32核 / GPU A100 x2" },
          { id: "queue", label: "队列/分区", placeholder: "例如：gpu / compute" },
        ],
      },
      {
        id: "local-dry-run",
        label: "本地试运行",
        description: "给出本地或开发环境的试运行步骤与依赖检查清单。",
      },
      {
        id: "workflow-review",
        label: "检查工作流配置",
        description: "审查工作流输入输出、日志收集和失败恢复策略。",
        parameterFields: [
          { id: "entrypoint", label: "入口文件", placeholder: "例如：workflow.yaml / run.sh" },
        ],
      },
    ]
  }
  if (category === "evaluation") {
    return [
      {
        id: "run-metrics",
        label: "运行评估指标",
        description: "生成评估脚本，并说明指标定义与输入输出。",
        parameterFields: [
          { id: "metricTarget", label: "评估对象", placeholder: "例如：预报场 RMSE / 结构预测 lDDT" },
        ],
      },
      {
        id: "compare-runs",
        label: "对比实验结果",
        description: "设计不同实验/模型结果的对比分析与可视化。",
      },
    ]
  }
  if (category === "data-processing") {
    return [
      {
        id: "load-preview",
        label: "加载并预览数据",
        description: "生成读取数据源、查看变量/shape 与样本切片的示例代码。",
        parameterFields: [
          { id: "timeRange", label: "时间范围", placeholder: "例如：2020-01 至 2020-12" },
          { id: "region", label: "空间范围", placeholder: "例如：东亚区域 / 全球" },
        ],
      },
      {
        id: "processing-pipeline",
        label: "数据处理流水线",
        description: "生成数据清洗、转换、切片或特征工程流水线。",
        parameterFields: [
          { id: "processingGoal", label: "处理目标", placeholder: "例如：归一化 / 重采样 / 特征提取" },
        ],
      },
      {
        id: "validate-schema",
        label: "校验数据格式",
        description: "检查输入输出 schema、缺失值和批处理约束。",
      },
    ]
  }
  return [
    {
      id: "usage-example",
      label: "生成调用示例",
      description: "根据原语契约生成最小可运行示例，并说明集成方式。",
    },
    {
      id: "integrate-module",
      label: "集成到现有工程",
      description: "分析如何将该原语接入当前 OneScience 项目或模型代码。",
      parameterFields: [
        { id: "integrationTarget", label: "集成目标", placeholder: "例如：现有训练脚本 / 推理服务" },
      ],
    },
  ]
}

export function primitiveDevelopPrompt(item: PrimitiveUseItem, selection: PrimitiveUseSelection) {
  const normalized = normalizeUseItem(item)
  const category = primitiveCategoryForUse(normalized)
  const scenario = primitiveUseScenarios(category).find((entry) => entry.id === selection.scenarioId)
  const tags = normalized.intentTags?.filter(Boolean).slice(0, 6).join(", ") || "未标注"
  const parameterLines = Object.entries(selection.parameters ?? {})
    .filter(([, value]) => value.trim())
    .map(([key, value]) => `${key}: ${value.trim()}`)
  const notes = selection.notes?.trim()

  return `${modelScopeTaskPromptHeader}请基于 AI 原语「${normalized.title}」进行科研开发。

原语 ID：${normalized.id ?? "未指定"}
原语类型：${normalized.primitiveType ?? "unknown"}
原语类别：${category}
领域：${normalized.domain ?? "未指定"}
能力描述：${normalized.description}
意图标签：${tags}

使用场景：${scenario?.label ?? selection.scenarioId}
场景说明：${scenario?.description ?? "按原语契约完成对应开发任务。"}${parameterLines.length ? `\n\n我已确认的参数：\n${parameterLines.map((line) => `- ${line}`).join("\n")}` : ""}${notes ? `\n\n补充说明：\n${notes}` : ""}

请根据该原语契约和上述场景生成可运行的 OneScience 方案，说明关键输入输出，并列出仍需我确认的运行参数。`
}

function normalizeUseItem(item: PrimitiveUseItem) {
  return {
    id: item.id,
    title: item.title,
    description: item.description ?? item.copy ?? item.title,
    domain: item.domain,
    primitiveType: item.primitiveType,
    intentTags: item.intentTags ?? item.tags,
    contractJson: item.contractJson,
  }
}
