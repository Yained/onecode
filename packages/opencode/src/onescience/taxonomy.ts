export const resourceCategories = [
  "dataset",
  "model",
  "app",
  "framework",
  "paper",
  "code",
  "checkpoint",
  "benchmark",
  "document",
  "case",
] as const
export type ResourceCategory = typeof resourceCategories[number]

export const primitiveTypes = [
  "component",
  "dataset",
  "data.process",
  "model.architecture",
  "model.train",
  "model.infer",
  "app.run",
  "benchmark",
  "profile",
  "adapter",
  "report",
  "workflow.compose",
] as const
export type PrimitiveType = typeof primitiveTypes[number]

export const capabilityFamilies = [
  { id: "resource.discovery", title: "资源理解与检索", primitiveTypes: ["dataset", "model.architecture", "app.run", "benchmark", "report"] },
  { id: "data.building", title: "数据与样本构建", primitiveTypes: ["dataset", "data.process", "app.run", "report"] },
  { id: "model.building", title: "模型构建与适配", primitiveTypes: ["component", "model.architecture", "adapter", "model.infer"] },
  { id: "training", title: "训练与调参", primitiveTypes: ["model.train", "dataset", "model.architecture", "benchmark"] },
  { id: "inference.evaluation", title: "推理、评估与 Benchmark", primitiveTypes: ["model.infer", "benchmark", "dataset", "profile", "report"] },
  { id: "performance.optimization", title: "性能优化与工程化", primitiveTypes: ["profile", "benchmark", "component", "adapter"] },
  { id: "runtime.deployment", title: "运行环境与部署", primitiveTypes: ["app.run", "model.train", "model.infer", "workflow.compose"] },
  { id: "report.reproducibility", title: "科研报告与复现归档", primitiveTypes: ["report", "benchmark", "workflow.compose"] },
] as const satisfies readonly CapabilityFamily[]
export type CapabilityFamilyID = typeof capabilityFamilies[number]["id"]

export const executionSkills = [
  "onescience-workflow",
  "onescience-role",
  "onescience-skill",
  "onescience-resources",
  "onescience-coder",
  "onescience-runtime",
  "onescience-installer",
] as const
export type ExecutionSkillID = typeof executionSkills[number]

type CapabilityFamily = {
  id: string
  title: string
  primitiveTypes: readonly PrimitiveType[]
}

export type TaskProfile = {
  id: string
  title: string
  description: string
  category: "build" | "run" | "optimize" | "reproduce" | "release"
  capabilityFamilies: readonly CapabilityFamilyID[]
  requiredPrimitiveTypes: readonly PrimitiveType[]
  optionalPrimitiveTypes: readonly PrimitiveType[]
  executionSkills: readonly ExecutionSkillID[]
  expectedArtifacts: readonly string[]
  maturity: "draft" | "beta" | "stable"
}

export const taskProfiles = [
  {
    id: "model-development",
    title: "开发模型",
    description: "构建或改造科学模型。",
    category: "build",
    capabilityFamilies: ["resource.discovery", "data.building", "model.building", "inference.evaluation"],
    requiredPrimitiveTypes: ["component", "dataset", "model.architecture", "adapter"],
    optionalPrimitiveTypes: ["model.infer", "benchmark", "profile", "report"],
    executionSkills: ["onescience-resources", "onescience-coder", "onescience-runtime"],
    expectedArtifacts: ["model_source", "model_config", "adapter_spec", "inference_smoke_test"],
    maturity: "beta",
  },
  {
    id: "dataset-building",
    title: "构建数据集",
    description: "生成 AI-ready 数据集。",
    category: "build",
    capabilityFamilies: ["resource.discovery", "data.building", "report.reproducibility"],
    requiredPrimitiveTypes: ["dataset", "data.process"],
    optionalPrimitiveTypes: ["app.run", "benchmark", "report"],
    executionSkills: ["onescience-resources", "onescience-coder", "onescience-runtime"],
    expectedArtifacts: ["dataset_manifest", "data_quality_report", "dataset_adapter"],
    maturity: "beta",
  },
  {
    id: "data-analysis",
    title: "数据分析",
    description: "完成分析、可视化与报告。",
    category: "run",
    capabilityFamilies: ["resource.discovery", "data.building", "inference.evaluation", "report.reproducibility"],
    requiredPrimitiveTypes: ["dataset", "data.process", "report"],
    optionalPrimitiveTypes: ["app.run", "benchmark", "profile", "workflow.compose"],
    executionSkills: ["onescience-resources", "onescience-coder", "onescience-runtime"],
    expectedArtifacts: ["analysis_plan", "analysis_notebook", "data_summary_report", "visualization_spec"],
    maturity: "draft",
  },
  {
    id: "model-training",
    title: "训练模型",
    description: "生成配置并提交训练。",
    category: "run",
    capabilityFamilies: ["resource.discovery", "training", "runtime.deployment", "report.reproducibility"],
    requiredPrimitiveTypes: ["model.train", "dataset", "model.architecture"],
    optionalPrimitiveTypes: ["benchmark", "profile", "report"],
    executionSkills: ["onescience-coder", "onescience-runtime", "onescience-installer"],
    expectedArtifacts: ["training_config", "training_log", "checkpoint", "metric_report"],
    maturity: "beta",
  },
  {
    id: "model-inference-testing",
    title: "推理测试",
    description: "运行模型并评估结果。",
    category: "run",
    capabilityFamilies: ["inference.evaluation", "runtime.deployment", "report.reproducibility"],
    requiredPrimitiveTypes: ["model.infer", "benchmark"],
    optionalPrimitiveTypes: ["dataset", "app.run", "profile", "report"],
    executionSkills: ["onescience-runtime", "onescience-coder"],
    expectedArtifacts: ["inference_result", "benchmark_report", "validation_summary"],
    maturity: "beta",
  },
  {
    id: "research-workflow-building",
    title: "构建科研工作流",
    description: "编排端到端科研流程。",
    category: "build",
    capabilityFamilies: ["resource.discovery", "data.building", "inference.evaluation", "runtime.deployment", "report.reproducibility"],
    requiredPrimitiveTypes: ["app.run", "model.infer", "workflow.compose"],
    optionalPrimitiveTypes: ["data.process", "dataset", "benchmark", "report"],
    executionSkills: ["onescience-workflow", "onescience-role", "onescience-skill", "onescience-runtime"],
    expectedArtifacts: ["workflow_spec", "execution_plan", "workflow_run_report"],
    maturity: "beta",
  },
  {
    id: "paper-reproduction",
    title: "论文复现",
    description: "复现实验并生成报告。",
    category: "reproduce",
    capabilityFamilies: ["resource.discovery", "data.building", "model.building", "training", "inference.evaluation", "report.reproducibility"],
    requiredPrimitiveTypes: ["dataset", "model.architecture", "model.train", "model.infer", "benchmark", "report"],
    optionalPrimitiveTypes: ["app.run", "adapter", "profile"],
    executionSkills: ["onescience-workflow", "onescience-resources", "onescience-coder", "onescience-runtime"],
    expectedArtifacts: ["reproduction_plan", "dataset_manifest", "training_config", "checkpoint", "benchmark_report", "reproduction_report"],
    maturity: "draft",
  },
  {
    id: "model-performance-analysis",
    title: "模型性能分析",
    description: "定位模型性能瓶颈。",
    category: "optimize",
    capabilityFamilies: ["model.building", "training", "inference.evaluation", "performance.optimization", "report.reproducibility"],
    requiredPrimitiveTypes: ["profile", "benchmark"],
    optionalPrimitiveTypes: ["model.infer", "model.train", "dataset", "report"],
    executionSkills: ["onescience-runtime", "onescience-coder"],
    expectedArtifacts: ["model_benchmark_report", "model_profile_report", "bottleneck_analysis", "performance_recommendations"],
    maturity: "draft",
  },
  {
    id: "operator-performance-optimization",
    title: "Kernel性能优化",
    description: "优化热点 Kernel 并复测。",
    category: "optimize",
    capabilityFamilies: ["performance.optimization", "runtime.deployment", "report.reproducibility"],
    requiredPrimitiveTypes: ["profile", "benchmark", "component"],
    optionalPrimitiveTypes: ["adapter", "model.infer", "model.train", "report"],
    executionSkills: ["onescience-runtime", "onescience-coder"],
    expectedArtifacts: ["kernel_profile_report", "kernel_benchmark_report", "kernel_optimization_patch", "optimized_kernel_report"],
    maturity: "draft",
  },
  {
    id: "model-optimization",
    title: "模型优化",
    description: "优化结构、指标与训练策略。",
    category: "optimize",
    capabilityFamilies: ["model.building", "training", "inference.evaluation", "performance.optimization", "report.reproducibility"],
    requiredPrimitiveTypes: ["model.architecture", "model.train", "benchmark"],
    optionalPrimitiveTypes: ["adapter", "profile", "model.infer", "dataset", "report"],
    executionSkills: ["onescience-coder", "onescience-runtime"],
    expectedArtifacts: ["optimization_plan", "model_config_patch", "training_ablation_report", "optimized_metric_report"],
    maturity: "draft",
  },
  {
    id: "model-adaptation",
    title: "模型适配",
    description: "生成适配器并完成验证。",
    category: "build",
    capabilityFamilies: ["model.building", "data.building", "inference.evaluation", "runtime.deployment"],
    requiredPrimitiveTypes: ["adapter", "model.architecture", "component"],
    optionalPrimitiveTypes: ["dataset", "model.infer", "model.train", "benchmark"],
    executionSkills: ["onescience-coder", "onescience-runtime"],
    expectedArtifacts: ["adapter_spec", "adapted_model_source", "inference_validation_report"],
    maturity: "draft",
  },
] as const satisfies readonly TaskProfile[]

const primitiveTypeMap = {
  "data.load": "dataset",
  "data.transform": "data.process",
  model: "model.architecture",
  "model.run": "model.infer",
  "model.train": "model.train",
  "model.evaluate": "benchmark",
  "app.launch": "app.run",
  "operator.apply": "component",
  "workflow.compose": "workflow.compose",
} as const satisfies Record<string, PrimitiveType>

export function normalizePrimitiveType(type: string) {
  if (primitiveTypes.some((item) => item === type)) return type as PrimitiveType
  return primitiveTypeMap[type as keyof typeof primitiveTypeMap]
}

export function getTaskProfile(id: string) {
  return taskProfiles.find((item) => item.id === id)
}

export * as OneScienceTaxonomy from "./taxonomy"
