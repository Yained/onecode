import type { CapabilityResource } from "../catalog"

export type OnemodelResource = CapabilityResource

export const materialsFields = [
  {
    id: "system",
    label: "研究对象 / 材料体系",
    placeholder: "例如：CuO、水体系、界面结构",
    default: "Cu(111)/水界面小体系（冒烟）",
  },
  {
    id: "inputData",
    label: "输入数据",
    placeholder: "例如：AIMD 轨迹、POSCAR、能量力标签、checkpoint",
    multiline: true,
    default: "./data/poscar_or_extxyz；预训练权重优先 ONESCIENCE_MODELS_DIR",
  },
  {
    id: "goal",
    label: "任务目标",
    placeholder: "希望得到什么结果",
    multiline: true,
    default: "跑通最小验证：可加载结构 → 推理/训练一步 → 产出日志与结果路径",
  },
  {
    id: "environment",
    label: "运行环境",
    placeholder: "例如：远程 GPU / 单卡冒烟 / HPC 队列",
    default: "远程单卡 GPU 冒烟（不足时回退 CPU）",
  },
]

export const weatherFields = [
  {
    id: "system",
    label: "预报对象 / 区域",
    placeholder: "例如：全球大气、区域降水、海洋涡旋",
    default: "全球大气 0.25° 短时预报冒烟样例",
  },
  {
    id: "inputData",
    label: "输入数据",
    placeholder: "例如：ERA5 场、雷达序列、归一化统计量、预训练权重",
    multiline: true,
    default: "./data/era5_sample.nc；归一化统计与预训练权重按模型文档挂载",
  },
  {
    id: "goal",
    label: "任务目标",
    placeholder: "希望得到什么结果",
    multiline: true,
    default: "完成最小推理：读入初始场 → 前向一步/短时效 → 输出预报场与校验指标",
  },
  {
    id: "environment",
    label: "运行环境",
    placeholder: "例如：远程 GPU / 多卡推理",
    default: "远程 GPU 单卡推理冒烟（可扩多卡）",
  },
]

export const fluidFields = [
  {
    id: "system",
    label: "研究对象 / 流场场景",
    placeholder: "例如：翼型、汽车外流、管道、Darcy",
    default: "二维翼型 / 管道层流冒烟算例",
  },
  {
    id: "inputData",
    label: "输入数据",
    placeholder: "例如：网格场、点云、图结构、CFD Benchmark 配置",
    multiline: true,
    default: "./data/mesh_or_points；CFD Benchmark 配置与预训练权重按文档准备",
  },
  {
    id: "goal",
    label: "任务目标",
    placeholder: "希望得到什么结果",
    multiline: true,
    default: "跑通最小前向/求解：输入几何与边界 → 输出流场与残差/误差指标",
  },
  {
    id: "environment",
    label: "运行环境",
    placeholder: "例如：远程 GPU / CFD Benchmark",
    default: "远程 GPU 冒烟（或 CFD Benchmark 约定环境）",
  },
]

export const bioFields = [
  {
    id: "system",
    label: "研究对象 / 生物体系",
    placeholder: "例如：蛋白序列、复合物、配体口袋",
    default: "短肽 / 小蛋白单体冒烟序列（示例 FASTA）",
  },
  {
    id: "inputData",
    label: "输入数据",
    placeholder: "例如：FASTA、PDB、MSA、配体文件、模型权重",
    multiline: true,
    default: "./data/sample.fasta；MSA/权重按模型文档挂载（ONESCIENCE_MODELS_DIR）",
  },
  {
    id: "goal",
    label: "任务目标",
    placeholder: "希望得到什么结果",
    multiline: true,
    default: "完成最小推理：输入序列/结构 → 输出结构或亲和力分数与日志",
  },
  {
    id: "environment",
    label: "运行环境",
    placeholder: "例如：远程 GPU / 生物信息流水线",
    default: "远程 GPU 冒烟（MSA/数据库可用时走完整流水线）",
  },
]
