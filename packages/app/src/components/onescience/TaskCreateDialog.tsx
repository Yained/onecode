import { Component, createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { authenticatedFetch } from "@/utils/authenticated-fetch"
import { DialogSelectSsh } from "@/components/dialog-select-ssh"
import { useGlobalSync } from "@/context/global-sync"
import { useSync } from "@/context/sync"
import {
  listRegisteredSshTargets,
  resolveExecutionLocationAvailability,
  resolveScnetMcpAvailability,
  summarizeConnectableSshTargets,
  sshTargetPromptFields,
  type ExecutionLocationId,
  type LocalSlurmCapability,
  type SshTargetOption,
} from "@/components/onescience/execution-location"
import { AlreadyDatasetRefsField } from "@/components/onescience/AlreadyDatasetRefsField"
import { useRegisteredSshConnectivity } from "@/components/onescience/use-registered-ssh-connectivity"

type TaskProfileItem = {
  id: string
  title: string
  description: string
  category: string
  capabilityFamilies: string[]
  requiredPrimitiveTypes: string[]
  optionalPrimitiveTypes: string[]
  executionSkills: string[]
  primitiveCount: number
  resourceCount: number
  expectedArtifacts: string[]
  maturity: string
}

type TaskCreateDialogProps = {
  open: boolean
  serverUrl?: string
  profile?: TaskProfileItem
  onClose: () => void
  onStart: (prompt: string) => void
}

type PrimitiveCandidate = {
  id: string
  title: string
  description: string
  primitiveType: string
  targetPrimitiveType?: string
  taskProfiles?: string[]
}

type PrimitiveCandidatePage = {
  items?: PrimitiveCandidate[]
  nextOffset?: number
}

type PromptField = readonly [string, string, string, string]
type PromptIntake = {
  goal: readonly [string, string, string]
  resources: PromptField
  approach: PromptField
  primitive: PromptField
  evaluation: PromptField
}
type QuickOption = readonly [string, string]
type QuickOptions = {
  goals: readonly QuickOption[]
  resources: readonly QuickOption[]
  architecture: readonly QuickOption[]
  topModelReference: readonly QuickOption[]
  evaluation: readonly QuickOption[]
}
type FieldPriority = "required" | "recommended" | "optional"
type OperatorOption = { id: string; label: string; copy?: string }

const operatorEndToEndGoalOptions = [
  { id: "end-to-end-performance", label: "端到端性能" },
  { id: "benchmark-time", label: "Benchmark耗时" },
  { id: "throughput", label: "吞吐量提升" },
] satisfies readonly OperatorOption[]

const operatorCodeSourceOptions = [
  { id: "git", label: "Git仓库", copy: "https://xxx/project" },
  { id: "kernel-file", label: "Kernel文件", copy: "attention.cu / attention.triton" },
  { id: "benchmark", label: "Benchmark程序", copy: "benchmark.py" },
  { id: "profile-report", label: "Profiling报告", copy: "ncu / nsys / rocprof 报告" },
  { id: "code-dir", label: "代码目录", copy: "src/kernels" },
] satisfies readonly OperatorOption[]

const operatorScopeOptions = [
  { id: "compile", label: "编译优化", copy: "CUDA / Triton 编译参数" },
  { id: "kernel", label: "Kernel优化", copy: "CUDA Kernel / Triton Kernel" },
  { id: "tensorcore", label: "TensorCore优化", copy: "矩阵核心利用率与数据布局" },
  { id: "fusion", label: "Kernel Fusion", copy: "融合中间 Kernel，减少 launch 与中间张量" },
  { id: "tiling", label: "Tiling / Pipeline", copy: "分块、流水与访存复用" },
  { id: "mixed-precision", label: "Mixed Precision", copy: "混合精度与数值误差控制" },
  { id: "communication", label: "通信优化", copy: "NCCL / AllReduce / AllGather" },
] satisfies readonly OperatorOption[]

const operatorStrategyOptions = [
  { id: "conservative", label: "保守优化", copy: "优先保证稳定性" },
  { id: "balanced", label: "平衡优化", copy: "性能与稳定性平衡" },
  { id: "aggressive", label: "激进优化", copy: "优先追求性能极限" },
] satisfies readonly OperatorOption[]

const operatorOutputOptions = [
  { id: "profiling", label: "Profiling分析" },
  { id: "bottleneck", label: "瓶颈分析" },
  { id: "plan", label: "优化方案" },
  { id: "triton", label: "Triton实现" },
  { id: "cuda", label: "CUDA实现" },
  { id: "benchmark", label: "Benchmark脚本" },
  { id: "report", label: "性能评估报告" },
] satisfies readonly OperatorOption[]

function operatorOptionLabel(options: readonly OperatorOption[], id: string) {
  return options.find((item) => item.id === id)?.label ?? id
}

function operatorOptionLabels(options: readonly OperatorOption[], ids: readonly string[]) {
  return ids.map((id) => operatorOptionLabel(options, id))
}

const modelDevelopmentQuickOptions = {
  goals: [
    ["", "手动填写或按科研问题自定义"],
    ["基于 GraphCast 构建全球天气预测任务，生成数据接入、图神经网络模型骨架、推理脚本和验证说明。", "GraphCast 天气预测"],
    ["基于 FourCastNet 构建中期天气预测任务，生成 AFNO/Transformer 模型骨架、样例数据适配和 smoke test。", "FourCastNet 天气预测"],
    ["基于 FNO 构建流场预测任务，生成流体数据读取、神经算子模型、训练配置和评估脚本。", "FNO 流场预测"],
    ["基于 DeepONet 构建科学代理模型任务，生成分支/主干网络结构、样例输入格式和误差评估方案。", "DeepONet 代理建模"],
    ["基于 PINNs 构建 PDE 求解任务，生成方程残差、边界条件、采样策略和训练验证脚本。", "PINN 求解 PDE"],
    ["基于 UNet 构建遥感分割任务，生成影像数据适配、分割模型骨架和指标评估流程。", "UNet 遥感分割"],
    ["基于 S1-Agent 构建科学智能体任务，生成工具调用、MCP 接入、任务编排和执行记录方案。", "Science Agent"],
  ],
  resources: [
    ["", "从可训练数据或 OneData 选择，也可手动填写 alr_"],
  ] satisfies readonly QuickOption[],
  architecture: [
    ["", "手动填写或让系统推荐"],
    ["Graph Neural Network / GNN", "图神经网络：天气、地球物理、材料图学习"],
    ["AFNO / Transformer", "AFNO / Transformer：中期天气与工程过程预测"],
    ["FNO / Neural Operator", "FNO / Neural Operator：流场、PDE 与科学场预测"],
    ["DeepONet", "DeepONet：算子学习与代理模型"],
    ["PINN", "PINN：PDE 求解与参数反演"],
    ["UNet", "UNet：遥感分割、流场重建与传感器建模"],
    ["Agent Framework / MCP", "Agent Framework / MCP：科学智能体与工具调用"],
  ],
  topModelReference: [
    ["", "不指定 TOP 模型，交给系统推荐"],
    ["GraphCast", "GraphCast：全球天气预测"],
    ["FourCastNet", "FourCastNet：中期天气预测"],
    ["FNO", "FNO：流场预测与科学场建模"],
    ["DeepONet", "DeepONet：科学代理模型"],
    ["PINNs", "PINNs：PDE 求解与参数反演"],
    ["UNet", "UNet：遥感分割与重建"],
    ["ScienceOne Base", "ScienceOne Base：科学推理基础模型"],
    ["S1-Agent", "S1-Agent：科学智能体"],
  ],
  evaluation: [
    ["", "手动填写或稍后补全"],
    ["model_config + data_adapter + inference_smoke_test + reproducibility_report", "模型配置 + 数据适配 + 推理验证"],
    ["training_config + metric_report + artifact_manifest", "训练配置 + 指标报告 + 产物清单"],
    ["baseline_comparison + error_analysis + visualization_report", "基线对比 + 误差分析 + 可视化报告"],
    ["agent_plan + tool_trace + execution_summary", "智能体计划 + 工具调用记录 + 执行摘要"],
  ],
} satisfies QuickOptions

const operatorPerformanceQuickOptions = {
  resources: [
    ["", "自定义芯片"],
    ["vendor:NVIDIA，chip:H100，arch:Hopper，toolchain:CUDA 12.4 + Nsight Compute，kernel:fused-attention", "NVIDIA H100"],
    ["vendor:AMD，chip:MI300X，arch:CDNA3，toolchain:ROCm + rocprof，kernel:matmul/attention", "AMD MI300X"],
    ["vendor:寒武纪，chip:MLU370，toolchain:CNToolkit + CNPerf，kernel:conv/matmul", "寒武纪 MLU370"],
    ["vendor:华为昇腾，chip:Ascend 910B，toolchain:CANN + msprof，kernel:attention/matmul", "昇腾 910B"],
    ["vendor:海光，chip:DCU，toolchain:DTK + rocprof/hip profiler，kernel:matmul/attention", "海光 DCU"],
  ],
  architecture: [
    ["", "自定义方法"],
    ["访存优化：合并访存、减少 HBM 访问、优化 shared/local memory 复用", "访存优化"],
    ["并行度优化：调整 block/grid、wavefront/warp、occupancy 和寄存器使用", "并行度优化"],
    ["Kernel Fusion：融合 elementwise/reduction/attention 子步骤，减少 kernel launch 和中间张量", "Kernel Fusion"],
    ["数据布局优化：调整 NCHW/NHWC、tiling、vectorization 和对齐策略", "数据布局优化"],
  ],
} satisfies Pick<QuickOptions, "resources" | "architecture">

const quickOptionsByResearchDomain: Partial<Record<string, QuickOptions>> = {
  "气象与气候科学": {
    goals: [
      ["", "手动填写或按气象预报问题自定义"],
      ["构建全球天气预测模型，参考 GraphCast 任务形态，生成数据接入、GNN 模型骨架、滚动推理和误差评估。", "全球天气预测"],
      ["构建中期天气预测模型，参考 FourCastNet，生成 AFNO/Transformer 架构、样例数据适配和 smoke test。", "中期天气预测"],
      ["构建降水预测模型，使用 AFNO 或 UNet 处理多变量气象输入并输出降水场预测与评估报告。", "降水预测"],
      ["构建气候模拟模型，使用 Transformer 或 Neural Operator 生成长期气候变量建模与验证方案。", "气候模拟"],
    ],
    resources: [
      ["", "手动填写或稍后补全"],
      ["domain:weather_climate / task:global_weather_forecast", "全球天气预测"],
      ["domain:weather_climate / task:medium_range_forecast", "中期天气预测"],
      ["domain:weather_climate / task:precipitation_forecast", "降水预测"],
      ["domain:weather_climate / task:climate_modeling", "气候模拟"],
    ],
    architecture: [
      ["", "手动填写或让系统推荐"],
      ["Graph Neural Network", "Graph Neural Network：全球天气预测"],
      ["AFNO", "AFNO：中期天气与降水预测"],
      ["Transformer", "Transformer：中期天气与气候模拟"],
      ["UNet", "UNet：降水预测"],
      ["Neural Operator", "Neural Operator：气候模拟"],
    ],
    topModelReference: [
      ["", "不指定 TOP 模型，交给系统推荐"],
      ["GraphCast", "GraphCast：全球天气预测"],
      ["FourCastNet", "FourCastNet：中期天气与降水预测"],
    ],
    evaluation: [
      ["", "手动填写或稍后补全"],
      ["单批次天气场推理 + RMSE/ACC + lead-time smoke test", "RMSE/ACC + lead-time：天气预报验证闭环"],
      ["多步滚动预测 + 变量级误差表 + forecast artifact manifest", "多步滚动预测：变量级误差与产物清单"],
      ["区域裁剪推理 + 可视化天气图 + reproducibility_report", "区域预报图：可视化与复现实验报告"],
    ],
  },
  "流体力学与CFD": {
    goals: [
      ["", "手动填写或按流体仿真问题自定义"],
      ["构建流场预测模型，使用 FNO 学习输入条件到速度场/压力场的映射，并生成训练与评估脚本。", "流场预测"],
      ["构建湍流建模任务，使用 FNO 或 DeepONet 学习湍流统计量和关键流动结构。", "湍流建模"],
      ["构建 CFD 替代模型，使用 FNO/DeepONet 替代高成本仿真并输出误差对比。", "CFD 替代模型"],
      ["构建流场重建模型，使用 UNet 或 FNO 从稀疏观测恢复完整流场。", "流场重建"],
    ],
    resources: [
      ["", "手动填写或稍后补全"],
      ["domain:fluid_dynamics / task:flow_prediction", "流场预测"],
      ["domain:fluid_dynamics / task:turbulence_modeling", "湍流建模"],
      ["domain:fluid_dynamics / task:cfd_surrogate", "CFD 替代模型"],
      ["domain:fluid_dynamics / task:flow_reconstruction", "流场重建"],
    ],
    architecture: [
      ["", "手动填写或让系统推荐"],
      ["FNO", "FNO：流场预测、湍流建模与 CFD 替代模型"],
      ["DeepONet", "DeepONet：湍流建模与 CFD 替代模型"],
      ["UNet", "UNet：流场重建"],
    ],
    topModelReference: [
      ["", "不指定 TOP 模型，交给系统推荐"],
      ["FNO", "FNO：流场预测与 CFD 替代模型"],
      ["DeepONet", "DeepONet：代理建模与算子学习"],
    ],
    evaluation: [
      ["", "手动填写或稍后补全"],
      ["field_rmse + boundary_check + rollout_smoke_test", "场误差 + 边界检查 + 滚动验证"],
      ["cfd_baseline_comparison + latency_report + artifact_manifest", "CFD 基线对比 + 延迟报告"],
      ["reconstruction_error + visualization_report", "重建误差 + 可视化报告"],
    ],
  },
  "PDE与科学计算": {
    goals: [
      ["", "手动填写或按 PDE 问题自定义"],
      ["构建 PDE 求解任务，使用 PINN 生成方程残差、边界条件、采样策略和训练脚本。", "PDE 求解"],
      ["构建参数反演任务，使用 PINN 从观测数据反推方程参数并输出置信分析。", "参数反演"],
      ["构建 Poisson 方程求解任务，生成 PINN 模型、边界条件配置和误差验证。", "Poisson 方程求解"],
      ["构建 Burgers 方程求解任务，使用 PINN 或 FNO 对比不同求解路线。", "Burgers 方程求解"],
      ["构建 Navier-Stokes 求解任务，使用 PINN 或 FNO 生成可复现实验。", "Navier-Stokes 求解"],
    ],
    resources: [
      ["", "手动填写或稍后补全"],
      ["domain:pde_science / task:pde_solver", "PDE 求解"],
      ["domain:pde_science / task:inverse_problem", "参数反演"],
      ["domain:pde_science / task:poisson_equation", "Poisson 方程求解"],
      ["domain:pde_science / task:burgers_equation", "Burgers 方程求解"],
      ["domain:pde_science / task:navier_stokes", "Navier-Stokes 求解"],
    ],
    architecture: [
      ["", "手动填写或让系统推荐"],
      ["PINN", "PINN：PDE 求解、参数反演、Poisson 方程"],
      ["FNO", "FNO：Burgers 与 Navier-Stokes 对比路线"],
    ],
    topModelReference: [
      ["", "不指定 TOP 模型，交给系统推荐"],
      ["PINNs", "PINNs：PDE 求解与参数反演"],
      ["FNO", "FNO：神经算子 PDE 求解"],
    ],
    evaluation: [
      ["", "手动填写或稍后补全"],
      ["residual_loss + boundary_error + validation_grid_error", "残差 + 边界误差 + 网格验证"],
      ["parameter_error + inverse_problem_report", "参数误差 + 反演报告"],
      ["solver_comparison + convergence_curve + reproducibility_report", "求解器对比 + 收敛曲线"],
    ],
  },
  "Neural Operator研究": {
    goals: [
      ["", "手动填写或按算子学习问题自定义"],
      ["构建算子学习任务，使用 FNO 或 DeepONet 学习函数到函数映射并输出泛化评估。", "算子学习"],
      ["构建科学代理模型，使用 FNO/DeepONet 替代仿真流程并生成基线对比。", "科学代理模型"],
      ["构建科学场预测任务，使用 Neural Operator 预测时空场演化并输出误差分析。", "科学场预测"],
    ],
    resources: [
      ["", "手动填写或稍后补全"],
      ["domain:neural_operator / task:operator_learning", "算子学习"],
      ["domain:neural_operator / task:surrogate_modeling", "科学代理模型"],
      ["domain:neural_operator / task:scientific_prediction", "科学场预测"],
    ],
    architecture: [
      ["", "手动填写或让系统推荐"],
      ["FNO", "FNO：频域神经算子"],
      ["DeepONet", "DeepONet：分支/主干网络算子学习"],
      ["Neural Operator", "Neural Operator：科学场预测"],
    ],
    topModelReference: [
      ["", "不指定 TOP 模型，交给系统推荐"],
      ["FNO", "FNO：算子学习"],
      ["DeepONet", "DeepONet：代理建模"],
    ],
    evaluation: [
      ["", "手动填写或稍后补全"],
      ["operator_generalization_test + resolution_extrapolation", "算子泛化 + 分辨率外推"],
      ["surrogate_error_report + baseline_comparison", "代理误差 + 基线对比"],
      ["field_rollout_error + visualization_report", "场预测滚动误差 + 可视化"],
    ],
  },
  "地球科学与遥感": {
    goals: [
      ["", "手动填写或按遥感/地球物理问题自定义"],
      ["构建遥感分割模型，使用 UNet 生成影像读取、标签适配、训练和 IoU 评估流程。", "遥感分割"],
      ["构建遥感分类模型，使用 Transformer 或 UNet 完成影像分类与可解释性输出。", "遥感分类"],
      ["构建地球物理预测模型，使用 GNN 或 FNO 学习空间场关系并输出预测评估。", "地球物理预测"],
    ],
    resources: [
      ["", "手动填写或稍后补全"],
      ["domain:earth_science / task:remote_sensing_segmentation", "遥感分割"],
      ["domain:earth_science / task:remote_sensing_classification", "遥感分类"],
      ["domain:earth_science / task:geophysical_prediction", "地球物理预测"],
    ],
    architecture: [
      ["", "手动填写或让系统推荐"],
      ["UNet", "UNet：遥感分割与分类"],
      ["Transformer", "Transformer：遥感分类"],
      ["GNN", "GNN：地球物理预测"],
      ["FNO", "FNO：地球物理场预测"],
    ],
    topModelReference: [
      ["", "不指定 TOP 模型，交给系统推荐"],
      ["UNet", "UNet：遥感分割"],
      ["GNN", "GNN：地球物理预测"],
      ["FNO", "FNO：科学场预测"],
    ],
    evaluation: [
      ["", "手动填写或稍后补全"],
      ["segmentation_iou + pixel_accuracy + visualization_report", "IoU + 像素精度 + 可视化"],
      ["classification_accuracy + confusion_matrix + explainability_report", "分类准确率 + 混淆矩阵"],
      ["geophysical_rmse + spatial_error_map + artifact_manifest", "地球物理误差 + 空间误差图"],
    ],
  },
  "材料科学": {
    goals: [
      ["", "手动填写或按材料问题自定义"],
      ["构建材料性质预测模型，使用 GNN 从材料结构预测性质并输出误差评估。", "材料性质预测"],
      ["构建晶体图学习模型，使用 Graph Neural Network 表征晶体结构并生成训练流程。", "晶体图学习"],
      ["构建材料仿真代理模型，使用 FNO 或 DeepONet 替代高成本材料仿真。", "材料仿真代理模型"],
    ],
    resources: [
      ["", "手动填写或稍后补全"],
      ["domain:materials_science / task:material_property_prediction", "材料性质预测"],
      ["domain:materials_science / task:crystal_graph_learning", "晶体图学习"],
      ["domain:materials_science / task:surrogate_simulation", "材料仿真代理模型"],
    ],
    architecture: [
      ["", "手动填写或让系统推荐"],
      ["GNN", "GNN：材料性质预测"],
      ["Graph Neural Network", "Graph Neural Network：晶体图学习"],
      ["FNO", "FNO：材料仿真代理模型"],
      ["DeepONet", "DeepONet：材料仿真代理模型"],
    ],
    topModelReference: [
      ["", "不指定 TOP 模型，交给系统推荐"],
      ["GNN", "GNN：材料图学习"],
      ["FNO", "FNO：仿真代理模型"],
      ["DeepONet", "DeepONet：仿真代理模型"],
    ],
    evaluation: [
      ["", "手动填写或稍后补全"],
      ["property_mae + structure_split_report + benchmark_table", "性质 MAE + 结构划分报告"],
      ["crystal_graph_embedding + validation_curve + artifact_manifest", "晶体图表征 + 验证曲线"],
      ["surrogate_simulation_error + speedup_report", "代理误差 + 加速比报告"],
    ],
  },
  "工程智能计算": {
    goals: [
      ["", "手动填写或按工程任务自定义"],
      ["构建工业过程预测模型，使用 Transformer 对时序过程变量进行预测并输出指标报告。", "工业过程预测"],
      ["构建传感器建模任务，使用 Transformer 或 UNet 完成传感器数据映射和异常样本检查。", "传感器建模"],
      ["构建工程异常检测模型，使用 Transformer 或 AutoEncoder 输出异常分数和诊断报告。", "工程异常检测"],
    ],
    resources: [
      ["", "手动填写或稍后补全"],
      ["domain:engineering_ai / task:industrial_forecasting", "工业过程预测"],
      ["domain:engineering_ai / task:sensor_modeling", "传感器建模"],
      ["domain:engineering_ai / task:anomaly_detection", "工程异常检测"],
    ],
    architecture: [
      ["", "手动填写或让系统推荐"],
      ["Transformer", "Transformer：工业过程预测与异常检测"],
      ["UNet", "UNet：传感器建模"],
      ["AutoEncoder", "AutoEncoder：工程异常检测"],
    ],
    topModelReference: [
      ["", "不指定 TOP 模型，交给系统推荐"],
      ["Transformer", "Transformer：时序建模"],
      ["UNet", "UNet：传感器数据映射"],
      ["AutoEncoder", "AutoEncoder：异常检测"],
    ],
    evaluation: [
      ["", "手动填写或稍后补全"],
      ["forecast_mae + time_split_validation + dashboard_spec", "预测 MAE + 时间切分验证"],
      ["sensor_mapping_error + anomaly_sample_check", "传感器映射误差 + 异常样本检查"],
      ["anomaly_auc + threshold_report + diagnosis_summary", "异常 AUC + 阈值报告"],
    ],
  },
  "科学基础模型": {
    goals: [
      ["", "手动填写或按科学基础模型任务自定义"],
      ["构建科学推理任务，使用 Transformer 或 ScienceOne Base 生成推理流程、样例问题和评估说明。", "科学推理"],
      ["构建科学智能体任务，使用 Agent Framework 和 MCP 组织工具调用、计划生成和执行摘要。", "科学智能体"],
      ["构建科学文献理解任务，使用 Transformer 与 RAG 生成文献解析、检索增强和摘要报告。", "科学文献理解"],
      ["构建科学工具调用任务，使用 Agent 与 MCP 接入外部工具并记录调用链路。", "科学工具调用"],
    ],
    resources: [
      ["", "手动填写或稍后补全"],
      ["domain:scientific_foundation_model / task:scientific_reasoning", "科学推理"],
      ["domain:scientific_foundation_model / task:scientific_agent", "科学智能体"],
      ["domain:scientific_foundation_model / task:literature_understanding", "科学文献理解"],
      ["domain:scientific_foundation_model / task:tool_using_agent", "科学工具调用"],
    ],
    architecture: [
      ["", "手动填写或让系统推荐"],
      ["Transformer", "Transformer：科学推理与文献理解"],
      ["Agent Framework", "Agent Framework：科学智能体"],
      ["MCP", "MCP：科学工具调用"],
      ["RAG", "RAG：科学文献理解"],
      ["Agent", "Agent：工具调用"],
    ],
    topModelReference: [
      ["", "不指定 TOP 模型，交给系统推荐"],
      ["ScienceOne Base", "ScienceOne Base：科学推理"],
      ["S1-Agent", "S1-Agent：科学智能体"],
    ],
    evaluation: [
      ["", "手动填写或稍后补全"],
      ["reasoning_case_set + answer_quality_report", "推理样例集 + 回答质量报告"],
      ["agent_plan + mcp_tool_trace + execution_summary", "智能体计划 + MCP 调用记录"],
      ["literature_digest + retrieval_evidence + citation_check", "文献摘要 + 检索证据"],
      ["tool_call_manifest + failure_recovery_report", "工具调用清单 + 失败恢复报告"],
    ],
  },
}

const fieldPriorityLabels = {
  required: "必填",
  recommended: "推荐",
  optional: "可选",
} satisfies Record<FieldPriority, string>

const researchDomains = [
  "通用科学研究",
  "气象与气候科学",
  "流体力学与CFD",
  "PDE与科学计算",
  "Neural Operator研究",
  "地球科学与遥感",
  "材料科学",
  "工程智能计算",
  "科学基础模型",
] as const

const executionLocations = [
  { id: "generate-only" as const, label: "只生成不运行", copy: "仅生成代码、配置和执行脚本，不启动本地运行或远程提交。" },
  { id: "local" as const, label: "本地运行", copy: "Coding 环境与运行环境在同一环境，直接生成并运行。" },
  { id: "slurm" as const, label: "Slurm 集群提交运行", copy: "在当前环境生成 Slurm 脚本并提交到集群队列。" },
  { id: "ssh-slurm" as const, label: "SSH 远程 Slurm 提交运行", copy: "通过 SSH 连接远程登录节点，再提交 Slurm 任务。" },
  { id: "mcp" as const, label: "MCP 提交运行", copy: "通过已配置的 MCP 工具或服务提交运行任务。" },
]

const taskPromptIntakes = {
  "model-development": {
    goal: ["总体目标", "用于限定模型要解决的科学问题和验收标准。", "例如：开发一个面向 ERA5 样例的中期天气预测模型，并完成推理 smoke test"],
    resources: ["可训练数据 / OneData", "用于定位训练、验证或推理数据；优先选择就绪的可训练数据或已公开 OneData。", "例如：alr_…、onedata 公开数据，或本机/对象存储路径", "Resource"],
    approach: ["草稿模型或参考架构", "用于指定起步方案，可填写草稿模型、论文架构或希望沿用的基线。", "例如：GraphCast、FourCastNet、UNet/Transformer 混合架构，或让系统推荐", "Model Draft"],
    primitive: ["模型原语与组件", "用于约束可复用能力边界；可选择必需原语、候选原语或补充组件 ID。", "可填写已选原语 ID；留空时系统会在执行计划中标记缺失项", "Model Primitive"],
    evaluation: ["评估与产物", "用于说明最小验证方式、指标、运行约束和希望生成的文件。", "例如：单批次推理、RMSE/MAE、model_config、adapter_spec、inference_smoke_test", "Evaluation"],
  },
  "dataset-building": {
    goal: ["数据集构建目标", "用于说明要生成的数据集形态、覆盖范围和质量验收标准。", "例如：将原始 CFD 仿真结果整理成 AI-ready 训练集，并生成 manifest 与质量报告"],
    resources: ["原始数据或数据源", "用于定位原始数据、实验记录、仿真输出或已有 dataset 原语。", "例如：/data/raw/cfd、resource:lab-measurements 或 primitive:dataset/raw-cases", "Data Source"],
    approach: ["处理流程或格式规范", "用于指定清洗、切分、转换、标注和目标格式要求。", "例如：NetCDF 转 Zarr，按时间切分 train/val/test，并保留变量单位", "Data Process"],
    primitive: ["数据集与处理原语", "用于选择 dataset、data.process、app.run、benchmark 或 report 原语。", "例如：primitive:dataset/era5、primitive:data.process/normalize、primitive:report/data-quality", "Data Primitive"],
    evaluation: ["质量检查与产物", "用于说明完整性、缺失值、统计分布、样本数量和输出文件。", "例如：dataset_manifest、data_quality_report、dataset_adapter，检查缺失率和变量范围", "Quality Gate"],
  },
  "data-analysis": {
    goal: ["分析目标", "用于说明要回答的科研问题、假设或分析结论形式。", "例如：分析蛋白质结构数据中突变位点与稳定性指标的相关性"],
    resources: ["分析数据与样本范围", "用于定位数据集、样本筛选条件、时间/空间范围或对照组。", "例如：resource:protein-structures，筛选 resolution < 3Å 的样本", "Analysis Data"],
    approach: ["统计方法或可视化方向", "用于指定统计检验、特征工程、图表类型或 notebook 结构。", "例如：PCA + 聚类热图，输出关键变量相关性和异常样本列表", "Analysis Method"],
    primitive: ["分析原语与报告原语", "用于选择 dataset、data.process、app.run、benchmark、workflow.compose 或 report 原语。", "例如：primitive:data.process/feature-extract、primitive:report/analysis-summary", "Analysis Primitive"],
    evaluation: ["结论与产物", "用于说明希望生成的分析计划、Notebook、图表规格和报告。", "例如：analysis_plan、analysis_notebook、data_summary_report、visualization_spec", "Analysis Output"],
  },
  "model-training": {
    goal: ["训练目标", "用于说明训练任务、目标指标、收敛要求和交付 checkpoint。", "例如：训练一个气候预测模型，在验证集上达到指定 RMSE 并保存 checkpoint"],
    resources: ["训练数据与模型架构", "用于定位 dataset 原语、训练样本、模型结构或初始权重。", "例如：primitive:dataset/era5-mini + primitive:model.architecture/graphcast-lite", "Training Resource"],
    approach: ["训练策略或资源配置", "用于指定 batch size、epoch、优化器、硬件、分布式或安装需求。", "例如：AdamW，batch=4，单机 8 GPU，先跑 1 epoch smoke training", "Training Strategy"],
    primitive: ["训练原语与 Benchmark", "用于选择 model.train、dataset、model.architecture、benchmark、profile 或 report 原语。", "例如：primitive:model.train/pytorch-ddp、primitive:benchmark/rmse-weather", "Training Primitive"],
    evaluation: ["指标与训练产物", "用于说明日志、checkpoint、指标报告和失败诊断要求。", "例如：training_config、training_log、checkpoint、metric_report", "Training Output"],
  },
  "model-inference-testing": {
    goal: ["推理测试目标", "用于说明要验证的模型行为、输入样本和通过标准。", "例如：验证已有 checkpoint 在 ERA5 样例上可完成单批次预测并输出指标"],
    resources: ["模型、checkpoint 或推理入口", "用于定位模型文件、checkpoint、推理脚本、服务地址或 app.run 原语。", "例如：checkpoint:/models/graphcast.ckpt、repo:xxx/infer.py 或 primitive:model.infer/weather", "Inference Entry"],
    approach: ["测试数据与 Benchmark", "用于指定推理数据、Benchmark、对照指标和运行模式。", "例如：primitive:benchmark/weather-rmse，使用 10 个样本做 batch inference", "Benchmark Setup"],
    primitive: ["推理与评估原语", "用于选择 model.infer、benchmark、dataset、app.run、profile 或 report 原语。", "例如：primitive:model.infer/onnx-runtime、primitive:benchmark/rmse", "Inference Primitive"],
    evaluation: ["结果与验证摘要", "用于说明预测结果、Benchmark 报告、性能记录和验收摘要。", "例如：inference_result、benchmark_report、validation_summary", "Inference Output"],
  },
  "research-workflow-building": {
    goal: ["工作流目标", "用于说明端到端科研流程的输入、输出和自动化边界。", "例如：构建从数据预处理、模型推理到报告生成的气候预测工作流"],
    resources: ["工作流输入资源", "用于定位数据集、科学软件、模型服务、应用入口或运行环境。", "例如：dataset:era5-mini、app:wps、model-infer:weather-forecast", "Workflow Resource"],
    approach: ["流程节点或编排原语", "用于指定步骤顺序、依赖关系、人工检查点和 workflow.compose 方式。", "例如：data.process → model.infer → benchmark → report，失败时保留中间产物", "Workflow Compose"],
    primitive: ["应用、推理与工作流原语", "用于选择 app.run、model.infer、workflow.compose、data.process、dataset 或 benchmark 原语。", "例如：primitive:workflow.compose/pipeline、primitive:app.run/simulation", "Workflow Primitive"],
    evaluation: ["执行计划与产物", "用于说明 workflow_spec、execution_plan、运行报告和复现记录。", "例如：workflow_spec、execution_plan、workflow_run_report", "Workflow Output"],
  },
  "paper-reproduction": {
    goal: ["复现目标", "用于说明论文实验、目标表格/图、指标和复现成功标准。", "例如：复现 GraphCast 论文的核心推理指标，并输出复现差异分析"],
    resources: ["论文、代码与复现资源", "用于定位论文、代码仓库、数据集、checkpoint、指标定义或补充材料。", "例如：paper:arXiv、repo:github.com/...、primitive:dataset/era5、checkpoint:url", "Reproduction Resource"],
    approach: ["复现路线或参考实现", "用于指定先复现推理、训练、Benchmark 或按论文步骤完整复现。", "例如：先跑官方 checkpoint 推理，再补训练配置与 benchmark 对齐", "Reproduction Route"],
    primitive: ["数据、训练、推理与报告原语", "用于选择 dataset、model.architecture、model.train、model.infer、benchmark、report 或 adapter 原语。", "例如：primitive:model.train/paper-config、primitive:model.infer/baseline、primitive:report/reproduction", "Reproduction Primitive"],
    evaluation: ["复现结果与报告", "用于说明要生成的计划、配置、checkpoint、Benchmark 和复现报告。", "例如：reproduction_plan、training_config、benchmark_report、reproduction_report", "Reproduction Output"],
  },
  "model-performance-analysis": {
    goal: ["模型性能分析目标", "用于说明要分析的训练/推理模型、吞吐/延迟/显存目标和瓶颈假设。", "例如：分析天气预测模型推理延迟、显存占用和 batch scaling，输出瓶颈定位报告"],
    resources: ["模型、输入与运行环境", "用于定位模型代码、checkpoint、输入样本、硬件、日志和运行配置。", "例如：model:/models/base.ckpt，input:/data/sample，GPU A100，batch=8，logs:/runs/baseline", "Model Baseline"],
    approach: ["模型 Profiling 或 Benchmark 原语", "用于指定模型级 profiling 方法、Benchmark、对照组和分析维度。", "例如：primitive:profile/torch-profiler + primitive:benchmark/latency-throughput，分析显存、吞吐和热点模块", "Model Profiling Plan"],
    primitive: ["模型性能原语", "用于选择 profile、benchmark、model.infer、model.train、dataset 或 report 原语。", "例如：primitive:profile/torch-profiler、primitive:benchmark/throughput", "Model Performance Primitive"],
    evaluation: ["模型分析报告与建议", "用于说明 model_benchmark_report、profile_report、瓶颈分析和优化建议。", "例如：model_benchmark_report、model_profile_report、bottleneck_analysis、performance_recommendations", "Model Performance Output"],
  },
  "operator-performance-optimization": {
    goal: ["Kernel性能优化目标", "用于说明要优化的热点 Kernel、Kernel链、组件实现和目标提升幅度。", "例如：优化 fused attention Kernel，将单步 latency 降低 20% 并保持数值误差在阈值内"],
    resources: ["芯片厂商、型号与 Kernel 基线", "用于定位芯片厂商和芯片型号、硬件架构、编译栈、Kernel 源码、输入 shape、profile 日志和基线 Benchmark。", "例如：vendor:NVIDIA，chip:H100，arch:Hopper，CUDA 12.4，kernel:fused-attention，shape=[8,16,1024,64]，baseline:/logs/kernel.json", "Hardware Baseline"],
    approach: ["Kernel Profiling 或 Benchmark 原语", "用于指定 kernel profiling、微基准、对照实现、优化方法和复测优先级。", "例如：NVIDIA H100 用 Nsight Compute 分析 occupancy/shared memory；AMD MI300X 用 rocprof；寒武纪 MLU370 用 CNPerf，优先优化访存、并行度和融合策略", "Kernel Optimization Method"],
    primitive: ["Kernel 与组件原语", "用于选择 profile、benchmark、component、adapter、model.infer、model.train 或 report 原语。", "例如：primitive:component/fused-attention、primitive:profile/nsys、primitive:benchmark/kernel", "Kernel Performance Primitive"],
    evaluation: ["Kernel 优化补丁与复测结果", "用于说明 kernel_profile_report、kernel_benchmark_report、optimization_patch 和复测报告。", "例如：kernel_profile_report、kernel_benchmark_report、kernel_optimization_patch、optimized_kernel_report", "Kernel Optimization Output"],
  },
  "model-optimization": {
    goal: ["模型优化目标", "用于说明要提升的模型指标、损失、泛化能力或推理质量。", "例如：降低验证集 RMSE，同时保持推理耗时不超过基线 110%"],
    resources: ["待优化模型与数据", "用于定位模型架构、训练数据、baseline 配置、checkpoint 或指标报告。", "例如：primitive:model.architecture/unet、primitive:dataset/era5、checkpoint:baseline.ckpt", "Optimization Resource"],
    approach: ["优化方向或消融方案", "用于指定结构改动、损失函数、训练策略、adapter 或 ablation 计划。", "例如：增加残差组件，对学习率和归一化策略做 3 组消融", "Optimization Plan"],
    primitive: ["模型、训练与 Benchmark 原语", "用于选择 model.architecture、model.train、benchmark、adapter、profile、model.infer 或 dataset 原语。", "例如：primitive:model.train/ablation、primitive:benchmark/metric-compare", "Model Optimization Primitive"],
    evaluation: ["消融与指标产物", "用于说明优化计划、配置 patch、训练消融报告和最终指标报告。", "例如：optimization_plan、model_config_patch、training_ablation_report、optimized_metric_report", "Model Optimization Output"],
  },
  "model-adaptation": {
    goal: ["模型适配目标", "用于说明源模型要适配到的新数据协议、框架、硬件或任务。", "例如：将 PyTorch checkpoint 适配到 OneScience 推理接口并完成验证"],
    resources: ["源模型、checkpoint 与目标环境", "用于定位源模型代码、权重、输入输出协议和目标运行环境。", "例如：repo:source-model、checkpoint:model.pt、target:onecode runtime / DCU", "Adaptation Resource"],
    approach: ["适配器或组件原语", "用于指定 adapter、component、model.architecture 或接口转换策略。", "例如：primitive:adapter/io-schema、primitive:component/encoder-wrapper", "Adapter Plan"],
    primitive: ["适配与组件原语", "用于选择 adapter、model.architecture、component、dataset、model.infer、model.train 或 benchmark 原语。", "例如：primitive:adapter/checkpoint-convert、primitive:model.infer/validation", "Adaptation Primitive"],
    evaluation: ["适配验证与产物", "用于说明 adapter_spec、适配后源码、推理验证报告和兼容性检查。", "例如：adapter_spec、adapted_model_source、inference_validation_report", "Adaptation Output"],
  },
} satisfies Record<string, PromptIntake>

const defaultPromptIntake = taskPromptIntakes["model-development"]
const taskPromptIntakesByID: Record<string, PromptIntake> = taskPromptIntakes

export const TaskCreateDialog: Component<TaskCreateDialogProps> = (props) => {
  const globalSync = useGlobalSync()
  const sync = useSync()
  const [primitiveCandidates, setPrimitiveCandidates] = createSignal<PrimitiveCandidate[]>([])
  const [slurmCapability, setSlurmCapability] = createSignal<LocalSlurmCapability>()
  const [slurmProbeLoading, setSlurmProbeLoading] = createSignal(false)
  const [sshDialogOpen, setSshDialogOpen] = createSignal(false)
  const [state, setState] = createStore({
    researchDomain: "通用科学研究",
    goal: "",
    resources: "",
    modelDraft: "",
    topModelReference: "",
    primitiveNotes: "",
    evaluation: "",
    operatorObject: "FlashAttention链路",
    operatorEndToEndGoals: ["end-to-end-performance", "benchmark-time"],
    operatorEndToEndTarget: "端到端耗时降低 30%",
    operatorCodeSources: ["git", "benchmark", "profile-report"],
    operatorCodeSourceDetail: "",
    operatorScopes: ["kernel", "tensorcore", "fusion"],
    operatorStrategy: "balanced",
    operatorOutputs: ["profiling", "bottleneck", "plan", "benchmark", "report"],
    executionLocation: "generate-only" as ExecutionLocationId,
    sshTargetName: "",
    sshHost: "",
    sshUser: "",
    sshPort: "22",
    sshKeyPath: "",
  })

  createEffect(() => {
    const profile = props.profile
    if (!props.open || !profile || !props.serverUrl) return
    void fetchPrimitiveCandidates(props.serverUrl, profile).then(setPrimitiveCandidates)
  })

  createEffect(() => {
    if (!props.open || !props.serverUrl) return
    let cancelled = false
    setSlurmProbeLoading(true)
    void fetchLocalSlurmCapability(props.serverUrl).then((result) => {
      if (cancelled) return
      setSlurmCapability(result)
      setSlurmProbeLoading(false)
    })
    onCleanup(() => {
      cancelled = true
    })
  })

  const sshConnectivity = useRegisteredSshConnectivity({ auto: () => props.open })
  const registeredSshTargets = createMemo(() => {
    const probed = sshConnectivity.targets()
    if (probed.length > 0 || sshConnectivity.loading()) return probed
    return listRegisteredSshTargets(globalSync.data.config.ssh as Record<string, SshTargetOption> | undefined).map((item) => ({
      ...item,
      connectivity: "idle" as const,
    }))
  })
  const connectableSshTargets = createMemo(() => sshConnectivity.connectable())
  const mcpAvailability = createMemo(() => resolveScnetMcpAvailability(sync.data.mcp))
  const locationAvailability = createMemo(() => resolveExecutionLocationAvailability({
    slurm: slurmCapability() ?? (slurmProbeLoading()
      ? { available: false, detail: "正在探测当前环境的 Slurm..." }
      : { available: false, detail: "当前环境未检测到可用的 Slurm（sbatch）" }),
    registeredSshTargets: registeredSshTargets(),
    sshProbeLoading: sshConnectivity.loading(),
    sshProbeProgress: sshConnectivity.progress(),
    mcp: mcpAvailability(),
  }))
  const locationAvailabilityById = createMemo(() => Object.fromEntries(locationAvailability().map((item) => [item.id, item])))
  const selectedSshTarget = createMemo(() => connectableSshTargets().find((item) => item.name === state.sshTargetName))

  const applySshTarget = (target: SshTargetOption | undefined) => {
    if (!target) {
      setState({
        sshTargetName: "",
        sshHost: "",
        sshUser: "",
        sshPort: "22",
        sshKeyPath: "",
      })
      return
    }
    setState({
      sshTargetName: target.name,
      sshHost: target.host,
      sshUser: target.username ?? "",
      sshPort: target.port ? String(target.port) : "22",
      sshKeyPath: target.auth?.keyPath ?? "",
    })
  }

  const selectExecutionLocation = (id: ExecutionLocationId) => {
    const availability = locationAvailabilityById()[id]
    if (availability && !availability.enabled) return
    setState("executionLocation", id)
  }

  createEffect(() => {
    if (!props.open) setSshDialogOpen(false)
  })

  createEffect(() => {
    const current = locationAvailabilityById()[state.executionLocation]
    if (current && !current.enabled) setState("executionLocation", "generate-only")
  })

  createEffect(() => {
    if (state.executionLocation !== "ssh-slurm") return
    const targets = connectableSshTargets()
    if (targets.length === 0) return
    if (targets.some((item) => item.name === state.sshTargetName)) return
    applySshTarget(targets[0])
  })

  const selectedPrimitiveIds = createMemo(() =>
    state.primitiveNotes
      .split(/\s*,\s*/)
      .map((item) => item.trim())
      .filter(Boolean),
  )
  const missingRequirements = createMemo(() => props.profile?.requiredPrimitiveTypes.filter((item) => !state.primitiveNotes.includes(item)) ?? [])
  const promptIntake = createMemo(() => props.profile ? taskPromptIntakesByID[props.profile.id] ?? defaultPromptIntake : defaultPromptIntake)
  const isModelDevelopment = createMemo(() => props.profile?.id === "model-development")
  const isOperatorPerformanceOptimization = createMemo(() => props.profile?.id === "operator-performance-optimization")
  const operatorStrategyLabel = createMemo(() => operatorOptionLabel(operatorStrategyOptions, state.operatorStrategy))
  const operatorEndToEndGoalLabels = createMemo(() => operatorOptionLabels(operatorEndToEndGoalOptions, state.operatorEndToEndGoals))
  const operatorCodeSourceLabels = createMemo(() => operatorOptionLabels(operatorCodeSourceOptions, state.operatorCodeSources))
  const operatorScopeLabels = createMemo(() => operatorOptionLabels(operatorScopeOptions, state.operatorScopes))
  const operatorOutputLabels = createMemo(() => operatorOptionLabels(operatorOutputOptions, state.operatorOutputs))
  const showResearchDomain = createMemo(() => !isOperatorPerformanceOptimization())
  const showTopModelReference = createMemo(() => !isOperatorPerformanceOptimization())
  const domainQuickOptions = createMemo(() => quickOptionsByResearchDomain[state.researchDomain] ?? modelDevelopmentQuickOptions)
  const primitiveQuickOptions = createMemo(() => [["", "从原语库选择"] as const, ...primitiveCandidates().map(primitiveCandidateOption)])
  const resourceQuickOptions = createMemo(() => {
    if (isOperatorPerformanceOptimization()) return operatorPerformanceQuickOptions.resources
    if (isModelDevelopment()) return modelDevelopmentQuickOptions.resources
    return domainQuickOptions().resources
  })
  const approachQuickOptions = createMemo(() => isOperatorPerformanceOptimization() ? operatorPerformanceQuickOptions.architecture : domainQuickOptions().architecture)
  const executionLocation = createMemo(() => executionLocations.find((item) => item.id === state.executionLocation) ?? executionLocations[0])
  const toggleOperatorSelection = (key: "operatorEndToEndGoals" | "operatorCodeSources" | "operatorScopes" | "operatorOutputs", id: string) => {
    setState(key, (items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id])
  }
  const requiredFields = createMemo(() => {
    if (isOperatorPerformanceOptimization()) return [state.operatorObject.trim() ? undefined : "优化 Kernel"].filter((item): item is string => !!item)
    return [state.goal.trim() ? undefined : promptIntake().goal[0]].filter((item): item is string => !!item)
  })
  const recommendedFields = createMemo(() => [
    ...(isOperatorPerformanceOptimization() ? [
      state.operatorEndToEndGoals.length > 0 ? undefined : "性能目标",
      state.operatorScopes.length > 0 ? undefined : "允许优化范围",
      state.operatorOutputs.length > 0 ? undefined : "输出内容",
    ] : [
    state.resources.trim() ? undefined : promptIntake().resources[0],
    state.modelDraft.trim() ? undefined : promptIntake().approach[0],
    state.evaluation.trim() ? undefined : promptIntake().evaluation[0],
    ]),
  ].filter((item): item is string => !!item))
  const handoff = createMemo(() => {
    const profile = props.profile
    if (!profile) return ""
    if (isOperatorPerformanceOptimization()) {
      return [
        "请作为 GPU / AI 加速 Kernel性能优化专家，基于 OneScience Kernel性能优化任务体系生成并执行优化任务。",
        "",
        `Task Profile: ${profile.id} / ${profile.title}`,
        ...(state.operatorObject.trim() ? [`优化 Kernel: ${state.operatorObject.trim()}`] : []),
        `性能目标: ${operatorEndToEndGoalLabels().join("、") || "待补全"}`,
        ...(state.operatorEndToEndTarget.trim() ? [`目标值: ${state.operatorEndToEndTarget.trim()}`] : []),
        `代码来源: ${operatorCodeSourceLabels().join("、") || "待补全"}`,
        ...(state.operatorCodeSourceDetail.trim() ? [`代码来源补充: ${state.operatorCodeSourceDetail.trim()}`] : []),
        `允许优化范围: ${operatorScopeLabels().join("、") || "待补全"}`,
        `优化策略偏好: ${operatorStrategyLabel()}`,
        `期望输出: ${operatorOutputLabels().join("、") || "待补全"}`,
        `Execution Location: ${executionLocation().label}`,
        ...(state.executionLocation === "generate-only" ? ["Run Policy: only generate code, configs, scripts, and documentation; do not execute commands, start local runs, or submit remote jobs."] : []),
        ...(state.executionLocation === "ssh-slurm" ? sshTargetPromptFields(selectedSshTarget()) : []),
        `Execution Skill: ${profile.executionSkills.join(" -> ")}`,
        `Expected Artifacts: ${profile.expectedArtifacts.join(", ")}`,
        `Missing Requirements: ${missingRequirements().join(", ") || "none"}`,
        `requiredFields: ${requiredFields().join(", ") || "none"}`,
        `recommendedFields: ${recommendedFields().join(", ") || "none"}`,
        "",
        "请自动检测并补充硬件环境与软件环境，包括 GPU 厂商、GPU 型号、GPU 架构、CUDA/Driver/Triton/PyTorch 版本等信息。",
        "请完成 Profiling 分析、热点 Kernel 识别、Bottleneck 分析、优化方案设计、优化代码实现、Benchmark 验证和性能提升评估。",
        "请在保证计算结果正确性的前提下输出优化方案、优化补丁、Benchmark 结果和性能分析报告。",
      ].join("\n")
    }
    return [
      "请使用 OneScience 科研任务体系创建并执行任务。",
      "",
      `Task Profile: ${profile.id} / ${profile.title}`,
      ...(showResearchDomain() ? [`Research Domain: ${state.researchDomain}`] : []),
      ...(state.goal.trim() ? [`Task Goal: ${state.goal.trim()}`] : []),
      `Capability: ${profile.capabilityFamilies.join(" -> ")}`,
      `Primitive: required=${profile.requiredPrimitiveTypes.join(", ")}; optional=${profile.optionalPrimitiveTypes.join(", ")}`,
      `selectedPrimitiveIds: ${selectedPrimitiveIds().join(", ") || "none"}`,
      `Execution Location: ${executionLocation().label}`,
      ...(state.executionLocation === "generate-only" ? ["Run Policy: only generate code, configs, scripts, and documentation; do not execute commands, start local runs, or submit remote jobs."] : []),
      ...(state.executionLocation === "ssh-slurm" ? sshTargetPromptFields(selectedSshTarget()) : []),
      ...(state.resources.trim() ? [`${promptIntake().resources[3]}: ${state.resources.trim()}`] : []),
      ...(state.modelDraft.trim() ? [`${promptIntake().approach[3]}: ${state.modelDraft.trim()}`] : []),
      ...(showTopModelReference() && state.topModelReference.trim() ? [`Top Model Reference: ${state.topModelReference.trim()}`] : []),
      ...(state.primitiveNotes.trim() ? [`${promptIntake().primitive[3]}: ${state.primitiveNotes.trim()}`] : []),
      ...(state.evaluation.trim() ? [`${promptIntake().evaluation[3]}: ${state.evaluation.trim()}`] : []),
      `Execution Skill: ${profile.executionSkills.join(" -> ")}`,
      `Expected Artifacts: ${profile.expectedArtifacts.join(", ")}`,
      `Missing Requirements: ${missingRequirements().join(", ") || "none"}`,
      `requiredFields: ${requiredFields().join(", ") || "none"}`,
      `recommendedFields: ${recommendedFields().join(", ") || "none"}`,
      "",
      "请先输出结构化执行计划；字段越完整，OneScience 生成的执行计划成功率越高，缺失的推荐项可由系统先给出合理假设。",
    ].join("\n")
  })

  const applyResearchDomain = (researchDomain: string) => {
    setState("researchDomain", researchDomain)
    setState("goal", "")
    setState("resources", "")
    setState("modelDraft", "")
    setState("topModelReference", "")
    setState("evaluation", "")
  }

  const addPrimitiveNote = (primitiveID: string) => {
    const id = primitiveID.trim()
    if (!id || state.primitiveNotes.split(/\s*,\s*/).includes(id)) return
    setState("primitiveNotes", state.primitiveNotes.trim() ? `${state.primitiveNotes.trim()}, ${id}` : id)
  }

  const start = () => props.onStart(handoff())

  return (
    <Portal>
      <Show when={props.open && props.profile}>
        {(profile) => (
          <div class="os-modal-backdrop" role="presentation" onClick={props.onClose}>
            <form class="os-upload-dialog os-task-create-dialog" onSubmit={(event) => { event.preventDefault(); start() }} onClick={(event) => event.stopPropagation()}>
            <div class="os-upload-head">
              <div>
                <div class="os-eyebrow">科研任务创建</div>
                <h2>{profile().title}</h2>
                <p>{profile().description}</p>
              </div>
              <button type="button" class="os-button os-button-secondary os-button-square" onClick={props.onClose}>×</button>
            </div>

            <div class="os-task-dialog-body">
              <div class="os-task-dialog-main">
                <Show when={showResearchDomain()}>
                  <section class="os-primitive-dialog-section">
                    <h3>研究领域 <FieldPriorityBadge fieldPriority="recommended" /> <FieldHelpButton /></h3>
                    <p class="os-task-field-hint">选择科学研究的细分领域，用于收敛任务背景、数据语义、模型假设和评估指标。</p>
                    <label class="os-task-quick-select">
                      <span>领域快速选择</span>
                      <select value={state.researchDomain} onInput={(event) => applyResearchDomain(event.currentTarget.value)}>
                        <For each={researchDomains}>{(item) => <option value={item}>{item}</option>}</For>
                      </select>
                    </label>
                  </section>
                </Show>

                <Show
                  when={isOperatorPerformanceOptimization()}
                  fallback={
                    <>
                <section class="os-primitive-dialog-section os-task-dialog-section-primary">
                  <h3>{promptIntake().goal[0]} <FieldPriorityBadge fieldPriority="required" /> <FieldHelpButton /></h3>
                  <p class="os-task-field-hint">{promptIntake().goal[1]}</p>
                  <label class="os-task-quick-select">
                    <span>目标快速选择</span>
                    <select value={state.goal} onInput={(event) => setState("goal", event.currentTarget.value)}>
                      <For each={domainQuickOptions().goals}>
                        {(item) => <option value={item[0]}>{item[1]}</option>}
                      </For>
                    </select>
                  </label>
                  <textarea rows={4} value={state.goal} onInput={(event) => setState("goal", event.currentTarget.value)} placeholder={promptIntake().goal[2]} />
                </section>

                <div class="os-task-dialog-field-grid">
                  <section class="os-primitive-dialog-section">
                    <h3>{promptIntake().resources[0]} <FieldPriorityBadge fieldPriority="recommended" /> <FieldHelpButton /></h3>
                    <p class="os-task-field-hint">{promptIntake().resources[1]}</p>
                    <Show
                      when={isModelDevelopment()}
                      fallback={
                        <>
                          <label class="os-task-quick-select">
                            <span>{isOperatorPerformanceOptimization() ? "芯片快速选择" : "资源快速选择"}</span>
                            <select value={state.resources} onInput={(event) => setState("resources", event.currentTarget.value)}>
                              <For each={resourceQuickOptions()}>
                                {(item) => <option value={item[0]}>{item[1]}</option>}
                              </For>
                            </select>
                          </label>
                          <input value={state.resources} onInput={(event) => setState("resources", event.currentTarget.value)} placeholder={promptIntake().resources[2]} />
                        </>
                      }
                    >
                      <AlreadyDatasetRefsField
                        value={state.resources}
                        onChange={(value) => setState("resources", value)}
                        hint="仅可选择本人就绪的可训练数据，或已公开的 OneData。"
                      />
                    </Show>
                  </section>

                  <section class="os-primitive-dialog-section">
                    <h3>{promptIntake().approach[0]} <FieldPriorityBadge fieldPriority="recommended" /> <FieldHelpButton /></h3>
                    <p class="os-task-field-hint">{promptIntake().approach[1]}</p>
                    <label class="os-task-quick-select">
                      <span>{isOperatorPerformanceOptimization() ? "优化方法快速选择" : "架构快速选择"}</span>
                      <select value={state.modelDraft} onInput={(event) => setState("modelDraft", event.currentTarget.value)}>
                        <For each={approachQuickOptions()}>
                          {(item) => <option value={item[0]}>{item[1]}</option>}
                        </For>
                      </select>
                    </label>
                    <input value={state.modelDraft} onInput={(event) => setState("modelDraft", event.currentTarget.value)} placeholder={promptIntake().approach[2]} />
                  </section>
                </div>

                <div class="os-task-dialog-field-grid">
                  <Show when={showTopModelReference()}>
                    <section class="os-primitive-dialog-section">
                      <h3>TOP 模型参考 <FieldPriorityBadge fieldPriority="optional" /> <FieldHelpButton /></h3>
                      <p class="os-task-field-hint">选择一个相关领域的高水平模型作为实现风格、能力边界或评估目标参考。</p>
                      <label class="os-task-quick-select">
                        <span>TOP 模型参考</span>
                        <select value={state.topModelReference} onInput={(event) => setState("topModelReference", event.currentTarget.value)}>
                          <For each={domainQuickOptions().topModelReference}>
                            {(item) => <option value={item[0]}>{item[1]}</option>}
                          </For>
                        </select>
                      </label>
                    </section>
                  </Show>

                  <section class="os-primitive-dialog-section">
                    <h3>{promptIntake().evaluation[0]} <FieldPriorityBadge fieldPriority="recommended" /> <FieldHelpButton /></h3>
                    <p class="os-task-field-hint">{promptIntake().evaluation[1]}</p>
                    <label class="os-task-quick-select">
                      <span>评估产物快速选择</span>
                      <select value={state.evaluation} onInput={(event) => setState("evaluation", event.currentTarget.value)}>
                        <For each={domainQuickOptions().evaluation}>
                          {(item) => <option value={item[0]}>{item[1]}</option>}
                        </For>
                      </select>
                    </label>
                    <input value={state.evaluation} onInput={(event) => setState("evaluation", event.currentTarget.value)} placeholder={promptIntake().evaluation[2]} />
                  </section>
                </div>

                <section class="os-primitive-dialog-section">
                  <h3>{promptIntake().primitive[0]} <FieldPriorityBadge fieldPriority="optional" /> <FieldHelpButton /></h3>
                  <p class="os-task-field-hint">{promptIntake().primitive[1]}</p>
                  <div class="os-task-chip-row">
                    <For each={profile().requiredPrimitiveTypes}>{(item) => <span data-required="true">{item}</span>}</For>
                    <For each={profile().optionalPrimitiveTypes}>{(item) => <span>{item}</span>}</For>
                  </div>
                  <label class="os-task-quick-select">
                    <span>原语快速选择</span>
                    <select value="" onInput={(event) => addPrimitiveNote(event.currentTarget.value)}>
                      <For each={primitiveQuickOptions()}>
                        {(item) => <option value={item[0]}>{item[1]}</option>}
                      </For>
                    </select>
                  </label>
                  <textarea rows={2} value={state.primitiveNotes} onInput={(event) => setState("primitiveNotes", event.currentTarget.value)} placeholder={promptIntake().primitive[2]} />
                </section>
                    </>
                  }
                >
                  <section class="os-primitive-dialog-section os-task-dialog-section-primary os-operator-task-section">
                    <h3>优化 Kernel <FieldPriorityBadge fieldPriority="required" /> <FieldHelpButton /></h3>
                    <p class="os-task-field-hint">填写要优化的 Kernel、Kernel链、模块或端到端推理链路。</p>
                    <input value={state.operatorObject} onInput={(event) => setState("operatorObject", event.currentTarget.value)} placeholder="例如：FlashAttention、Attention Block、MoE Router、FNO Kernel链、GraphCast推理链路" />
                  </section>

                  <section class="os-primitive-dialog-section os-operator-task-section">
                      <h3>性能目标 <FieldPriorityBadge fieldPriority="recommended" /> <FieldHelpButton /></h3>
                      <p class="os-task-field-hint">填写目标指标和期望提升幅度。</p>
                      <div class="os-task-checkbox-grid">
                        <For each={operatorEndToEndGoalOptions}>
                          {(item) => (
                            <label>
                              <input type="checkbox" checked={state.operatorEndToEndGoals.includes(item.id)} onInput={() => toggleOperatorSelection("operatorEndToEndGoals", item.id)} />
                              <span>{item.label}</span>
                            </label>
                          )}
                        </For>
                      </div>
                      <textarea rows={2} value={state.operatorEndToEndTarget} onInput={(event) => setState("operatorEndToEndTarget", event.currentTarget.value)} placeholder="例如：端到端耗时降低 30%，吞吐量提升 50%" />
                  </section>

                  <section class="os-primitive-dialog-section os-operator-task-section">
                    <h3>代码来源 <FieldPriorityBadge fieldPriority="recommended" /> <FieldHelpButton /></h3>
                    <div class="os-task-checkbox-grid os-task-checkbox-grid-wide">
                      <For each={operatorCodeSourceOptions}>
                        {(item) => (
                          <label>
                            <input type="checkbox" checked={state.operatorCodeSources.includes(item.id)} onInput={() => toggleOperatorSelection("operatorCodeSources", item.id)} />
                            <span><strong>{item.label}</strong><small>{item.copy}</small></span>
                          </label>
                        )}
                      </For>
                    </div>
                    <textarea rows={2} value={state.operatorCodeSourceDetail} onInput={(event) => setState("operatorCodeSourceDetail", event.currentTarget.value)} placeholder="补充 Git 仓库、Kernel 文件、Benchmark 程序、Profiling 报告或代码目录路径..." />
                  </section>

                  <section class="os-primitive-dialog-section os-operator-task-section">
                    <h3>允许优化范围 <FieldPriorityBadge fieldPriority="recommended" /> <FieldHelpButton /></h3>
                    <div class="os-task-checkbox-grid os-task-checkbox-grid-wide">
                      <For each={operatorScopeOptions}>
                        {(item) => (
                          <label>
                            <input type="checkbox" checked={state.operatorScopes.includes(item.id)} onInput={() => toggleOperatorSelection("operatorScopes", item.id)} />
                            <span><strong>{item.label}</strong><small>{item.copy}</small></span>
                          </label>
                        )}
                      </For>
                    </div>
                  </section>

                  <div class="os-task-dialog-field-grid">
                    <section class="os-primitive-dialog-section os-operator-task-section">
                      <h3>优化策略 <FieldPriorityBadge fieldPriority="optional" /> <FieldHelpButton /></h3>
                      <div class="os-task-radio-grid os-task-radio-grid-compact">
                        <For each={operatorStrategyOptions}>
                          {(item) => (
                            <label data-selected={state.operatorStrategy === item.id}>
                              <input type="radio" name="operatorStrategy" value={item.id} checked={state.operatorStrategy === item.id} onInput={(event) => setState("operatorStrategy", event.currentTarget.value)} />
                              <span><strong>{item.label}</strong><small>{item.copy}</small></span>
                            </label>
                          )}
                        </For>
                      </div>
                    </section>

                    <section class="os-primitive-dialog-section os-operator-task-section">
                      <h3>输出内容 <FieldPriorityBadge fieldPriority="recommended" /> <FieldHelpButton /></h3>
                      <div class="os-task-checkbox-grid">
                        <For each={operatorOutputOptions}>
                          {(item) => (
                            <label>
                              <input type="checkbox" checked={state.operatorOutputs.includes(item.id)} onInput={() => toggleOperatorSelection("operatorOutputs", item.id)} />
                              <span>{item.label}</span>
                            </label>
                          )}
                        </For>
                      </div>
                    </section>
                  </div>
                </Show>

              </div>

              <aside class="os-task-dialog-side">
                <div class="os-task-dialog-sticky">
                  <section class="os-primitive-dialog-section">
                    <h3>执行位置 <FieldPriorityBadge fieldPriority="optional" /> <FieldHelpButton /></h3>
                    <p class="os-task-field-hint">选择本次科研开发任务是只生成不运行、本地运行、Slurm 集群提交、SSH 远程 Slurm 提交，还是通过 MCP 提交。不具备条件的选项会置灰。</p>
                    <div class="os-task-execution-options">
                      <For each={executionLocations}>
                        {(item) => {
                          const availability = () => locationAvailabilityById()[item.id]
                          const enabled = () => availability()?.enabled !== false
                          return (
                            <label data-selected={state.executionLocation === item.id} data-disabled={!enabled()}>
                              <input
                                type="radio"
                                name="executionLocation"
                                value={item.id}
                                checked={state.executionLocation === item.id}
                                disabled={!enabled()}
                                onInput={() => selectExecutionLocation(item.id)}
                              />
                              <span>
                                <strong>{item.label}</strong>
                                <small>{item.copy}</small>
                                <Show when={enabled() && availability()?.detail}>
                                  <small class="os-task-execution-detail">{availability()?.detail}</small>
                                </Show>
                                <Show when={!enabled()}>
                                  <small class="os-task-execution-reason">{availability()?.reason || "当前不可用"}</small>
                                </Show>
                              </span>
                            </label>
                          )
                        }}
                      </For>
                    </div>
                  </section>

                  <section class="os-primitive-dialog-section os-task-ssh-manage">
                    <button
                      type="button"
                      class="os-button os-button-secondary os-task-ssh-open-button"
                      onClick={() => setSshDialogOpen(true)}
                    >
                      查看 SSH 配置和连接状态
                    </button>
                    <p class="os-task-field-hint">
                      {sshConnectivity.loading()
                        ? (sshConnectivity.progressLabel() || "正在检测 SSH 连通性...")
                        : registeredSshTargets().length > 0
                          ? `${summarizeConnectableSshTargets(registeredSshTargets())}，点击按钮查看详情。`
                          : "未注册 SSH 配置，点击按钮添加或管理。"}
                    </p>
                  </section>

                  <Show when={state.executionLocation === "ssh-slurm" && selectedSshTarget()}>
                    <section class="os-primitive-dialog-section os-task-ssh-config">
                      <h3>已选远端环境</h3>
                      <div class="os-task-ssh-summary">
                        <div><strong>SSH Target</strong><span>{selectedSshTarget()?.name}</span></div>
                        <div><strong>Remote Path</strong><span>{selectedSshTarget()?.remotePath}</span></div>
                        <Show when={selectedSshTarget()?.username}>
                          <div><strong>User</strong><span>{selectedSshTarget()?.username}</span></div>
                        </Show>
                      </div>
                    </section>
                  </Show>

                  <section class="os-primitive-dialog-section">
                    <h3>候选原语</h3>
                    <div class="os-task-candidate-list">
                      <For each={primitiveCandidates().slice(0, 8)}>
                        {(item) => (
                          <button type="button" onClick={() => addPrimitiveNote(item.id)}>
                            <strong>{item.title}</strong>
                            <span>{item.targetPrimitiveType ?? item.primitiveType}</span>
                          </button>
                        )}
                      </For>
                    </div>
                  </section>

                  <section class="os-primitive-dialog-section">
                    <h3>执行计划</h3>
                    <div class="os-task-plan-preview">
                      <div><strong>Task Profile</strong><span>{profile().id}</span></div>
                      <Show when={showResearchDomain()}>
                        <div><strong>Research Domain</strong><span>{state.researchDomain}</span></div>
                      </Show>
                      <div><strong>Capability</strong><span>{profile().capabilityFamilies.join(" → ")}</span></div>
                      <div><strong>Primitive</strong><span>{profile().requiredPrimitiveTypes.join(" / ")}</span></div>
                      <div><strong>Execution Location</strong><span>{executionLocation().label}</span></div>
                      <Show when={state.executionLocation === "ssh-slurm"}>
                        <div><strong>SSH Target</strong><span>{selectedSshTarget()?.name || "待选择"}</span></div>
                        <div><strong>SSH User</strong><span>{selectedSshTarget()?.username || state.sshUser || "待填写"}</span></div>
                      </Show>
                      <Show
                        when={isOperatorPerformanceOptimization()}
                        fallback={
                          <>
                            <div><strong>{promptIntake().resources[3]}</strong><span>{state.resources || "待检索"}</span></div>
                            <div><strong>{promptIntake().approach[3]}</strong><span>{state.modelDraft || "待推荐"}</span></div>
                            <Show when={showTopModelReference()}>
                              <div><strong>Top Model Reference</strong><span>{state.topModelReference || "待推荐"}</span></div>
                            </Show>
                            <div><strong>{promptIntake().evaluation[3]}</strong><span>{state.evaluation || "待补全"}</span></div>
                          </>
                        }
                      >
                        <div><strong>优化 Kernel</strong><span>{state.operatorObject || "待填写"}</span></div>
                        <div><strong>性能目标</strong><span>{operatorEndToEndGoalLabels().join(" / ") || "待补全"}</span></div>
                        <div><strong>优化范围</strong><span>{operatorScopeLabels().join(" / ") || "待补全"}</span></div>
                        <div><strong>输出内容</strong><span>{operatorOutputLabels().join(" / ") || "待补全"}</span></div>
                      </Show>
                      <div><strong>Execution Skill</strong><span>{profile().executionSkills.join(" → ")}</span></div>
                    </div>
                    <Show when={missingRequirements().length > 0}>
                      <p class="os-task-missing">missingRequirements: {missingRequirements().join(", ")}</p>
                    </Show>
                    <Show when={requiredFields().length > 0 || recommendedFields().length > 0}>
                      <p class="os-task-missing">requiredFields: {requiredFields().join(", ") || "none"}; recommendedFields: {recommendedFields().join(", ") || "none"}</p>
                    </Show>
                  </section>
                </div>
              </aside>
            </div>

            <div class="os-upload-actions">
              <button type="button" class="os-button os-button-secondary" onClick={props.onClose}>取消</button>
              <button type="submit" class="os-button os-button-primary">开始任务</button>
            </div>
            </form>
          </div>
        )}
      </Show>
      <Show when={sshDialogOpen()}>
        <Kobalte
          modal
          open={sshDialogOpen()}
          onOpenChange={(open) => {
            if (!open) setSshDialogOpen(false)
          }}
        >
          <Kobalte.Portal>
            <Kobalte.Overlay
              data-component="dialog-overlay"
              class="os-ssh-dialog-overlay"
              onClick={() => setSshDialogOpen(false)}
            />
            <div class="os-ssh-dialog-stack">
              <DialogSelectSsh onClose={() => setSshDialogOpen(false)} />
            </div>
          </Kobalte.Portal>
        </Kobalte>
      </Show>
    </Portal>
  )
}

function FieldPriorityBadge(props: { fieldPriority: FieldPriority }) {
  return <span class="os-task-field-priority" data-priority={props.fieldPriority}>{fieldPriorityLabels[props.fieldPriority]}</span>
}

function FieldHelpButton() {
  return <button type="button" class="os-task-field-help" aria-label="显示说明">?</button>
}

async function fetchPrimitiveCandidates(serverUrl: string, profile: TaskProfileItem) {
  const loadPage = async (offset: number): Promise<PrimitiveCandidatePage> => {
    const response = await authenticatedFetch(`${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/primitive?summary=true&limit=100&offset=${offset}`)
    if (!response.ok) return {}
    return await response.json() as PrimitiveCandidatePage
  }

  try {
    const loadAll = async (offset: number, items: PrimitiveCandidate[]): Promise<PrimitiveCandidate[]> => {
      const page = await loadPage(offset)
      const nextItems = [...items, ...(page.items ?? [])]
      if (typeof page.nextOffset !== "number" || page.nextOffset <= offset || nextItems.length >= 500) return filterPrimitiveCandidates(nextItems, profile)
      return loadAll(page.nextOffset, nextItems)
    }
    return loadAll(0, [])
  } catch {
    return []
  }
}

function filterPrimitiveCandidates(items: PrimitiveCandidate[], profile: TaskProfileItem) {
  return items.filter((item) => item.taskProfiles?.includes(profile.id) || profile.requiredPrimitiveTypes.includes(item.targetPrimitiveType ?? "") || profile.optionalPrimitiveTypes.includes(item.targetPrimitiveType ?? ""))
}

function primitiveCandidateType(item: PrimitiveCandidate) {
  return item.targetPrimitiveType ?? item.primitiveType
}

function primitiveCandidateOption(item: PrimitiveCandidate): QuickOption {
  return [item.id, `${item.title}：${primitiveCandidateType(item)}`]
}

async function fetchLocalSlurmCapability(serverUrl: string): Promise<LocalSlurmCapability> {
  try {
    const response = await authenticatedFetch(`${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/execution-capability`)
    if (!response.ok) {
      return { available: false, detail: "无法探测当前环境的 Slurm 能力" }
    }
    const result = await response.json() as { slurm?: LocalSlurmCapability }
    if (!result.slurm) return { available: false, detail: "无法探测当前环境的 Slurm 能力" }
    return result.slurm
  } catch {
    return { available: false, detail: "无法探测当前环境的 Slurm 能力" }
  }
}

function oneScienceApiBaseUrl(serverUrl: string) {
  return serverUrl.replace(/\/$/, "")
}
