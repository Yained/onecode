type PrimitiveCategory = "dataset" | "model" | "model-training" | "model-inference" | "model-component" | "data-processing" | "evaluation" | "app" | "code-asset"

export const primitiveTypeFilters: { label: string; category?: PrimitiveCategory }[] = [
  { label: "全部" },
  { label: "数据集原语", category: "dataset" },
  { label: "模型原语", category: "model" },
  { label: "模型训练原语", category: "model-training" },
  { label: "模型推理原语", category: "model-inference" },
  { label: "模型组件原语", category: "model-component" },
  { label: "数据处理原语", category: "data-processing" },
  { label: "评估指标原语", category: "evaluation" },
  { label: "应用原语", category: "app" },
  { label: "代码资产原语", category: "code-asset" },
]

export const primitiveCategoryLabel: Record<string, string> = Object.fromEntries(
  primitiveTypeFilters.flatMap((filter) => filter.category ? [[filter.category, filter.label]] : []),
)

export const primitiveCategoryShortLabel: Record<string, string> = {
  dataset: "数据集",
  model: "模型",
  "model-training": "模型训练",
  "model-inference": "模型推理",
  "model-component": "模型组件",
  "data-processing": "数据处理",
  evaluation: "评估指标",
  app: "应用",
  "code-asset": "代码资产",
}

export const primitivePage = {
  eyebrow: "AI Primitives",
  title: "AI原语",
  count: "内置原语随 onecode 发布物固化，可检索/管理的列表由服务端原语库与 catalog 提供",
  search: "搜索名称、描述、标签",
  filters: primitiveTypeFilters.map((filter) => filter.label),
  // Built-in rows live in the onecode seed / server catalog; keep an empty items
  // array so resourcePages stays structurally uniform for ResourcePage typing.
  items: [] as const,
}
