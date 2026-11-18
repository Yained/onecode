import { bioOnemodels } from "./onemodels/bio"
import { fluidOnemodels } from "./onemodels/fluid"
import { materialsOnemodels } from "./onemodels/materials"
import { weatherOnemodels } from "./onemodels/weather"
import {
  buildModelCapabilityCatalog,
  getModelCapabilityResource,
  listModelCapabilityResources,
} from "./model-resources"
import { getPrivateModelResource, listPrivateModelResources } from "./private-assets"

/** Hand-authored detail/scenarios overlaid onto OneHub model resources by title. */
const modelEnrichments = [
  ...materialsOnemodels,
  ...weatherOnemodels,
  ...fluidOnemodels,
  ...bioOnemodels,
]

export type CapabilityDomain = "materials" | "weather" | "fluid" | "bio"

export type CapabilityScenario = {
  id: string
  title: string
  summary: string
  fields: Array<{ id: string; label: string; placeholder?: string; multiline?: boolean; default?: string }>
  capabilitySummary: { current: string; keyConfig: string; resources: string; deliverables: string }
  requiredData?: string[]
  expectedOutputs: string
  promptTemplate: string
}

export type CapabilityResource = {
  id: string
  name: string
  category: "onemodel" | "hpc"
  domain: CapabilityDomain
  tags: string[]
  blurb: string
  /** Private uploads shown in the capability center; catalog items omit this. */
  ownership?: "private" | "catalog"
  /**
   * Interactive (not gray): has OneScience source docs and/or ModelScope install mapping.
   * Omitted/true = interactive. Private + HPC default interactive.
   */
  available?: boolean
  /** Install button: only when ModelScope has a curated download mapping. */
  installable?: boolean
  /** OneHub resource id (`seed-models-…`) when sourced from resource-seed. */
  resourceId?: string
  /** Prefer OneScience source docs; otherwise ModelScope model page. */
  docsHref: string
  intro: {
    title: string
    subtitle: string
    suited: string[]
    notFor: string[]
    prepare: string[]
    obtain: string[]
    steps: string[]
  }
  install: {
    banner: string
    prompt: string
  }
  scenarios: CapabilityScenario[]
}

export type CapabilityCategoryId = "scenario" | "onemodel" | "hpc" | "onedata" | "oneskills" | "submission"

export type CapabilityCategory = {
  id: CapabilityCategoryId
  label: string
  title: string
  copy: string
  items: CapabilityResource[]
}

const scenarioFields = [
  {
    id: "system",
    label: "研究对象 / 材料体系",
    placeholder: "例如：CuO、水体系、界面结构",
    default: "Cu(111)/水界面小体系（冒烟）",
  },
  {
    id: "inputData",
    label: "输入数据",
    placeholder: "例如：AIMD 轨迹、POSCAR、in.lammps",
    multiline: true,
    default: "./data/poscar_or_trajectory；配套输入按软件文档准备",
  },
  {
    id: "goal",
    label: "任务目标",
    placeholder: "希望得到什么结果",
    multiline: true,
    default: "跑通最小验证并给出日志、结果路径与下一步建议",
  },
  {
    id: "environment",
    label: "运行环境",
    placeholder: "例如：远程 GPU / HPC 队列",
    default: "远程 GPU 或 HPC 队列冒烟",
  },
]

const maceFields = [
  {
    id: "system",
    label: "研究对象 / 材料体系",
    placeholder: "例如：CuO、水体系、界面结构",
    default: "CO2/Cu(111)/水界面或 CuO 小体系（冒烟）",
  },
  {
    id: "inputData",
    label: "输入数据",
    placeholder: "例如：aimd_dataset.extxyz、XDATCAR/OUTCAR 转换结果",
    multiline: true,
    default: "./data/aimd_dataset.extxyz；energy_key=TolEnergy，forces_key=force",
  },
  {
    id: "goal",
    label: "任务目标",
    placeholder: "例如：训练可用于材料模拟的 MACE 势函数",
    multiline: true,
    default: "短训冒烟：跑通 forward/loss/checkpoint，得到可评估的势函数",
  },
  {
    id: "environment",
    label: "运行环境",
    placeholder: "例如：远程 GPU / 单卡冒烟 / HPC 队列",
    default: "远程单卡 GPU 冒烟（可扩多卡）",
  },
]

const mace: CapabilityResource = {
  id: "mace",
  name: "MACE",
  category: "onemodel",
  domain: "materials",
  tags: ["材料化学", "mlff", "equivariant"],
  blurb: "高阶等变消息传递机器学习势函数，用 AIMD/DFT 轨迹训练后可接入大规模分子动力学。",
  docsHref: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem/mace",
  intro: {
    title: "30 秒看懂模型",
    subtitle: "用 AIMD/DFT 轨迹数据训练原子间势函数，用于更快地做大规模分子动力学模拟",
    suited: ["训练力场", "结构弛豫", "分子动力学", "能量预测"],
    notFor: ["没有训练数据", "体系差异过大", "只想做电子结构"],
    prepare: ["AIMD 轨迹", "DFT 结构", "能量和力数据"],
    obtain: ["训练好的势函数", "预测结果", "MD 轨迹"],
    steps: ["整理 AIMD/DFT 数据", "检查字段与单位", "训练或微调 MACE", "评估误差", "接入 LAMMPS/ASE"],
  },
  install: {
    banner: "已为你创建 MACE 环境配置任务",
    prompt: [
      "请为 MACE 创建一个可以直接跑通的环境配置任务。",
      "模型定位：E(3)-等变高阶消息传递机器学习势函数。",
      "适合任务：整理 AIMD 训练数据、训练/微调势函数、评估能量/力误差、ASE/LAMMPS 部署与 MD。",
      "典型输入：extxyz/xyz 构型、energy_key/forces_key、可选 stress/virial、元素表与 E0s。",
      "典型输出：checkpoint、误差表、导出模型、LAMMPS/ASE 验证结果。",
      "要求：",
      "1. 先检查当前项目、Python/框架版本、CPU/GPU/DCU、远程环境和项目目录权限。",
      "2. 优先核对 OneScience MACE demo（examples/matchem/mace/demo）与数据路径是否可用。",
      "3. 如果需要模型权重、训练数据或插件，请列出来源、版本和下载/挂载方式。",
      "4. 如果需要安装依赖、加载模块或执行远程命令，请先向我请求批准。",
      "5. 安装/配置完成后，请给出最小验证命令，并说明下一步可以进入：整理 AIMD 训练数据、训练机器学习势、评估势函数精度、准备 LAMMPS 分子动力学。",
    ].join("\n"),
  },
  scenarios: [
    {
      id: "mace-train",
      title: "训练机器学习势",
      summary: "用 AIMD 或 DFT 轨迹训练 MACE 势函数",
      fields: maceFields,
      capabilitySummary: {
        current: "训练 MACE 机器学习势",
        keyConfig: "r_max/cutoff、batch size、epoch、energy_weight/forces_weight、E0s、可选 foundation_model",
        resources: "建议远程 GPU/DCU；小样本可先单卡冒烟，多卡用 demo YAML + dry-run",
        deliverables: "checkpoint、训练曲线、能量/力 MAE 和部署说明",
      },
      requiredData: [
        "含能量/力标签的 .xyz / .extxyz（train，推荐 valid/test）",
        "energy_key / forces_key（示例 TolEnergy / force），单位与 E0s 约定",
        "元素表；微调时还需 foundation checkpoint 与兼容 r_max",
      ],
      expectedOutputs: "checkpoint、训练曲线、能量/力 MAE 和部署说明",
      promptTemplate: [
        "请基于 {{system}} 体系完成 MACE「训练机器学习势」任务。",
        "输入数据：{{inputData}}",
        "任务目标：{{goal}}",
        "运行环境：{{environment}}",
        "",
        "请按 OneScience MACE 流程执行：",
        "1. 检查 extxyz/xyz 字段是否覆盖结构、能量、力、晶胞；确认 energy_key、forces_key、可选 stress_key/virials_key。",
        "2. 明确元素表、能量/力单位与 E0s（isolated / average / foundation / 显式字典）。",
        "3. 选择路线：数据少或接近预训练覆盖则 foundation_model 微调；数据充足或体系差异大则从头训练。",
        "4. 先用 demo YAML/`run.sh --dry-run` 核对命令与路径，再做短训练 smoke test，确认 forward、loss、checkpoint 正常。",
        "5. 正式训练后输出能量/力 MAE、异常帧、checkpoint 路径，并说明下一步可做评估或 LAMMPS/ASE 部署。",
        "如需安装依赖、加载模块或提交远程命令，请先向我请求批准。",
      ].join("\n"),
    },
    {
      id: "mace-evaluate",
      title: "评估势函数精度",
      summary: "比较 MACE 预测与 DFT 标签的误差和稳定性",
      fields: [
        {
          id: "system",
          label: "研究对象 / 材料体系",
          placeholder: "例如：CuO、水体系、界面结构",
          default: "水体系或 CuO 小测试集（与训练同元素表）",
        },
        {
          id: "inputData",
          label: "模型与测试数据",
          placeholder: "例如：checkpoints/*.model + water_test.xyz",
          multiline: true,
          default: "./results/mace/final.model + ./data/water_test.extxyz",
        },
        {
          id: "goal",
          label: "评估目标",
          placeholder: "例如：判断能否替代 DFT 采样进入 MD",
          multiline: true,
          default: "报告能量/力 MAE，并判断能否进入短时程 MD",
        },
        {
          id: "environment",
          label: "运行环境",
          placeholder: "例如：本地 CPU / 远程 GPU",
          default: "本地 CPU 或远程单卡 GPU",
        },
      ],
      capabilitySummary: {
        current: "评估现有 MACE 势函数",
        keyConfig: "能量/力 MAE、RMSE、PerAtomMAE、异常帧筛选、可选 stress/virial 检查",
        resources: "小规模 CPU 即可；大数据集或含应力评估建议 GPU",
        deliverables: "误差表、异常结构列表和是否可用于 MD 的结论",
      },
      requiredData: [
        "待评估 checkpoint / .model",
        "独立测试集 extxyz（字段与训练一致）",
        "训练时使用的 energy_key、forces_key、元素表与单位约定",
      ],
      expectedOutputs: "误差表、异常结构列表和是否可用于 MD 的结论",
      promptTemplate: [
        "请基于 {{system}} 体系评估 MACE 势函数精度。",
        "模型与测试数据：{{inputData}}",
        "评估目标：{{goal}}",
        "运行环境：{{environment}}",
        "",
        "请在独立测试集上计算能量和力的 MAE / RMSE（必要时按 PerAtomMAE），定位最大误差帧与异常近邻构型，",
        "检查单位、E0s 与字段映射是否与训练一致，并给出能否进入 ASE/LAMMPS MD 或结构弛豫的明确结论。",
        "如果发现字段不匹配或单位错配，请先暂停并给出最小修复方案。",
      ].join("\n"),
    },
    {
      id: "mace-lammps",
      title: "准备 LAMMPS 分子动力学",
      summary: "把训练好的 MACE 势函数用于 LAMMPS",
      fields: [
        {
          id: "system",
          label: "研究对象 / 材料体系",
          placeholder: "例如：CuO、水体系、界面结构",
          default: "界面或体相小超胞（冒烟 MD）",
        },
        {
          id: "inputData",
          label: "模型与初始结构",
          placeholder: "例如：trained.model + data.lammps / POSCAR 转换结果",
          multiline: true,
          default: "./results/mace/final.model + ./data/data.lammps",
        },
        {
          id: "goal",
          label: "MD 目标",
          placeholder: "例如：300K NVT 短时程 smoke test 后拉长采样",
          multiline: true,
          default: "300K NVT 约 10 ps smoke test，确认温度/能量/dump 正常",
        },
        {
          id: "environment",
          label: "运行环境",
          placeholder: "例如：HPC GPU/CPU 队列",
          default: "HPC GPU 或 CPU 队列冒烟",
        },
      ],
      capabilitySummary: {
        current: "把 MACE 模型接入 LAMMPS",
        keyConfig: "pair_style mace、温度压力、步数、dump/restart、导出模型与元素顺序",
        resources: "GPU 或 CPU 队列；先做约 10 ps smoke test 再拉长",
        deliverables: "LAMMPS 输入文件、作业脚本、轨迹与能量输出",
      },
      requiredData: [
        "已训练/导出的 MACE 模型",
        "初始结构（LAMMPS data 或可转换结构）",
        "温度/压力/系综与输出需求（dump、thermo、restart）",
      ],
      expectedOutputs: "LAMMPS 输入文件、作业脚本、轨迹与能量输出",
      promptTemplate: [
        "请基于 {{system}} 体系，把 MACE 势函数接入 LAMMPS 做分子动力学。",
        "模型与初始结构：{{inputData}}",
        "MD 目标：{{goal}}",
        "运行环境：{{environment}}",
        "",
        "请先完成短时程 smoke test：确认模型加载、元素顺序、单位、周期边界、温度/能量、dump 和 restart 正常；",
        "再与 ASE/原训练模型在同一构型上做一致性抽查，最后给出更长时程 MD 计划与后处理入口。",
        "如需提交远程作业或安装 LAMMPS/MACE 插件，请先向我请求批准。",
      ].join("\n"),
    },
    {
      id: "mace-prepare-data",
      title: "整理 AIMD 训练数据",
      summary: "从 VASP 或 AIMD 输出生成训练数据集",
      fields: [
        {
          id: "system",
          label: "研究对象 / 材料体系",
          placeholder: "例如：CuO、水体系、界面结构",
          default: "CO2/Cu(111)/水或 CuO AIMD 轨迹体系",
        },
        {
          id: "inputData",
          label: "原始轨迹 / 计算输出",
          placeholder: "例如：XDATCAR、OUTCAR、vasprun.xml、已有 xyz 片段",
          multiline: true,
          default: "./results/aimd/{XDATCAR,OUTCAR} 或已有 xyz 片段",
        },
        {
          id: "goal",
          label: "整理目标",
          placeholder: "例如：生成带 TolEnergy/force 的 train/valid/test.extxyz",
          multiline: true,
          default: "生成带 TolEnergy/force 的 train/valid/test.extxyz（80/10/10）",
        },
        {
          id: "environment",
          label: "运行环境",
          placeholder: "例如：本地或登录节点",
          default: "本地或登录节点即可",
        },
      ],
      capabilitySummary: {
        current: "整理 MACE 训练所需 AIMD/DFT 数据",
        keyConfig: "energy_key/forces_key、单位、E0s、元素表、train/valid/test 划分",
        resources: "本地或登录节点即可；大数据优先远程盘原地整理",
        deliverables: "extxyz 数据集、数据卡、字段/单位检查报告",
      },
      requiredData: [
        "VASP/AIMD 输出或中间轨迹（XDATCAR/OUTCAR/vasprun 等）",
        "DFT 设置与能量/力单位说明",
        "目标字段名（如 TolEnergy、force）和划分比例",
      ],
      expectedOutputs: "extxyz 训练集、验证/测试划分、字段检查报告和数据卡",
      promptTemplate: [
        "请为 {{system}} 体系整理可用于 MACE 训练的 AIMD/DFT 数据集。",
        "原始轨迹 / 计算输出：{{inputData}}",
        "整理目标：{{goal}}",
        "运行环境：{{environment}}",
        "",
        "请完成：",
        "1. 从 VASP/AIMD 输出提取结构、能量、力、晶胞，必要时做清洗与异常帧过滤。",
        "2. 写出 .xyz/.extxyz，明确 energy_key、forces_key，以及可选 stress_key/virials_key。",
        "3. 核对单位、元素表、周期边界与参考能策略，形成简短数据卡。",
        "4. 按约定划分 train/valid/test，并给出下一步可直接用于 MACE 训练的命令入口。",
      ].join("\n"),
    },
  ],
}

const deepmd: CapabilityResource = {
  id: "deepmd",
  name: "DeePMD",
  category: "onemodel",
  domain: "materials",
  tags: ["材料化学", "mlff", "deepmd"],
  blurb: "深度学习势能函数，用 DFT 标注的能量、力和晶胞数据训练后可接入 LAMMPS。",
  docsHref: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem/dp",
  intro: {
    title: "30 秒看懂模型",
    subtitle: "用 DFT 标注的能量、力和晶胞数据训练 Deep Potential 力场，并可接入 LAMMPS 做大规模分子动力学",
    suited: ["Deep Potential 训练", "AIMD 数据学习", "LAMMPS 推理", "主动学习闭环"],
    notFor: ["没有能量/力标签", "数据格式无法转为 deepmd/npy", "只需要单点电子结构结果"],
    prepare: ["VASP/CP2K 输出", "deepmd/npy 数据目录", "结构、能量、力和 virial"],
    obtain: ["frozen_model.pb / saved_model", "训练曲线", "测试误差", "LAMMPS pair_style 配置"],
    steps: ["转换训练数据", "配置 input.json", "训练 Deep Potential", "冻结模型", "接入 LAMMPS 验证"],
  },
  install: {
    banner: "已为你创建 DeePMD 环境配置任务",
    prompt: [
      "请为 DeePMD 创建一个可以直接跑通的环境配置任务。",
      "模型定位：深度势能分子动力学模型。",
      "适合任务：Deep Potential 训练、AIMD 数据学习、LAMMPS 推理、主动学习闭环。",
      "典型输入：VASP/CP2K 输出 / deepmd/npy 数据目录 / 结构、能量、力和 virial。",
      "典型输出：frozen_model.pb / 训练曲线 / 测试误差 / LAMMPS pair_style 配置。",
      "要求：",
      "1. 先检查当前项目、Python/框架版本、CPU/GPU、远程环境和项目目录权限。",
      "2. 如果需要模型权重、训练数据或插件，请列出来源、版本和下载/挂载方式。",
      "3. 如果需要安装依赖、加载模块或执行远程命令，请先向我请求批准。",
      "4. 安装/配置完成后，请给出最小验证命令，并说明下一步可以进入：转换 DeepMD 数据、训练 Deep Potential、部署到 LAMMPS。",
    ].join("\n"),
  },
  scenarios: [
    {
      id: "deepmd-convert",
      title: "转换 DeepMD 数据",
      summary: "把 VASP/CP2K/XYZ 数据转成 deepmd/npy 训练目录",
      fields: scenarioFields,
      capabilitySummary: {
        current: "准备 DeePMD 训练数据",
        keyConfig: "coord、box、energy、force，可选 virial",
        resources: "本地或远程均可；大数据优先远程盘引用",
        deliverables: "可被 dp train 直接读取的 deepmd/npy 数据目录",
      },
      expectedOutputs: "deepmd/npy 目录、type_map、数据检查报告",
      promptTemplate: [
        "请把 {{system}} 体系的数据转换成 DeePMD 训练所需的 deepmd/npy 结构。",
        "输入数据：{{inputData}}",
        "任务目标：{{goal}}",
        "运行环境：{{environment}}",
        "请检查能量、力和晶胞信息是否齐全，并保证 type.raw / type_map.raw 一致。",
      ].join("\n"),
    },
    {
      id: "deepmd-train",
      title: "训练 Deep Potential",
      summary: "基于 input.json 训练 DeepMD 力场",
      fields: scenarioFields,
      capabilitySummary: {
        current: "训练 DeePMD 势函数",
        keyConfig: "descriptor、fitting_net、learning_rate、batch_size、loss 权重",
        resources: "通常建议远程 GPU；小样本可先用 CPU/GPU 单卡验证",
        deliverables: "checkpoint、训练曲线、lcurve.out 和模型可用性判断",
      },
      expectedOutputs: "训练日志、模型 checkpoint、能量/力误差和验证建议",
      promptTemplate: [
        "请基于 {{system}} 体系训练 DeePMD Deep Potential。",
        "输入数据：{{inputData}}",
        "任务目标：{{goal}}",
        "运行环境：{{environment}}",
        "请生成 input.json、启动训练，并输出误差曲线和模型文件。",
      ].join("\n"),
    },
    {
      id: "deepmd-lammps",
      title: "部署到 LAMMPS",
      summary: "冻结模型并生成 LAMMPS 调用脚本",
      fields: scenarioFields,
      capabilitySummary: {
        current: "把 DeePMD 模型接入 LAMMPS",
        keyConfig: "pair_style deepmd、温度压力、步数、dump/restart",
        resources: "GPU 或 CPU 队列；先做短时程 smoke test",
        deliverables: "frozen_model、LAMMPS 输入文件、作业脚本与轨迹输出",
      },
      expectedOutputs: "frozen_model.pb、LAMMPS 输入、作业脚本、轨迹与能量输出",
      promptTemplate: [
        "请基于 {{system}} 体系，把 DeePMD 势函数冻结并接入 LAMMPS。",
        "输入数据：{{inputData}}",
        "任务目标：{{goal}}",
        "运行环境：{{environment}}",
        "请完成模型冻结、生成 LAMMPS 调用脚本，并先做短时程 smoke test 确认 pair_style deepmd、能量和 dump 正常。",
      ].join("\n"),
    },
  ],
}

const lammps: CapabilityResource = {
  id: "lammps",
  name: "LAMMPS",
  category: "hpc",
  domain: "materials",
  tags: ["HPC", "分子动力学", "mlff"],
  blurb: "大规模分子动力学软件，适合经典力场和机器学习势驱动的长时间、大体系模拟。",
  docsHref: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem/tools/lmp",
  intro: {
    title: "30 秒看懂 HPC 软件",
    subtitle: "用于经典力场和机器学习势驱动的分子动力学模拟，适合大体系和长时间尺度计算",
    suited: ["分子动力学", "MACE/DeePMD 力场调用", "热力学性质", "RDF/MSD 后处理"],
    notFor: ["没有可用力场", "初始结构不稳定", "边界条件和单位体系不明确"],
    prepare: ["data 文件", "in.* 输入脚本", "力场文件", "温度/压力/步数"],
    obtain: ["dump 轨迹", "log.lammps", "thermo 数据", "RDF/MSD 图表"],
    steps: ["选择力场", "生成 LAMMPS 输入", "检查单位和边界", "提交 MD 任务", "分析轨迹和热力学量"],
  },
  install: {
    banner: "已为你创建 LAMMPS 软件环境配置任务",
    prompt: [
      "请检查当前项目和远程 HPC 环境是否可以运行 LAMMPS，并完成软件环境配置方案。",
      "软件定位：大规模分子动力学软件。",
      "版本：lammps-mace",
      "MACE 接口需要 conda 环境。",
      "conda 环境：curl -f -C - -o lammps-mace.tar.gz https://zzefile.scnet.cn:65011/efile/s/d/emhhbmdobDM=/8b21039fd3c245e6",
      "二进制文件链接：curl -f -C - -o lammps-mace-dtk2604.tar.gz https://zzefile.scnet.cn:65011/efile/s/d/emhhbmdobDM=/861d7dea382b0a71",
      "典型输入：data 文件 / in.* 输入脚本 / 力场文件 / 温度压力步数。",
      "典型输出：dump 轨迹 / log.lammps / thermo 数据 / RDF/MSD 图表。",
      "要求：",
      "1. 先检查 module、conda/container、MPI/GPU、许可证/访问权限和项目目录权限。",
      "2. 说明 LAMMPS 适用的运行方式、推荐版本、依赖环境和验证命令。",
      "3. 如果需要安装依赖、加载模块或提交远程命令，请先向我请求批准。",
      "4. 安装/配置完成后，请给出最小验证用例，并说明后续可以做：MACE 力场 MD、经典力场 MD、轨迹后处理。",
    ].join("\n"),
  },
  scenarios: [
    {
      id: "lammps-mace-md",
      title: "MACE 力场 MD",
      summary: "把训练好的 MACE 模型接入 LAMMPS 做分子动力学",
      fields: scenarioFields,
      capabilitySummary: {
        current: "LAMMPS + MACE 分子动力学",
        keyConfig: "pair_style mace、ensemble、温度压力、dump 间隔",
        resources: "HPC CPU/GPU 队列；先短时程验证再拉长",
        deliverables: "in.mace_md、提交脚本、dump 轨迹和 thermo 日志",
      },
      expectedOutputs: "in.mace_md、run_lammps.slurm、dump 轨迹、log 文件和后处理入口",
      promptTemplate: [
        "请为 {{system}} 体系配置 LAMMPS MACE 力场分子动力学。",
        "输入数据：{{inputData}}",
        "任务目标：{{goal}}",
        "运行环境：{{environment}}",
        "请生成输入脚本、检查单位与边界，并给出提交与后处理计划。",
      ].join("\n"),
    },
    {
      id: "lammps-classical-md",
      title: "经典力场 MD",
      summary: "使用 EAM、ReaxFF、LJ 等经典力场配置模拟",
      fields: scenarioFields,
      capabilitySummary: {
        current: "LAMMPS 经典力场分子动力学",
        keyConfig: "pair_style、ensemble、温度压力、单位与边界条件",
        resources: "HPC CPU/GPU 队列；先短时程验证再拉长",
        deliverables: "in.classical_md、提交脚本、dump 轨迹和 thermo 日志",
      },
      expectedOutputs: "in.classical_md、run_lammps.slurm、dump 轨迹、log 文件和后处理入口",
      promptTemplate: [
        "请为 {{system}} 体系配置 LAMMPS 经典力场分子动力学。",
        "输入数据：{{inputData}}",
        "任务目标：{{goal}}",
        "运行环境：{{environment}}",
        "请按 EAM / ReaxFF / LJ 等力场生成输入脚本，检查单位与边界，并给出提交与后处理计划。",
      ].join("\n"),
    },
    {
      id: "lammps-postprocess",
      title: "轨迹后处理",
      summary: "分析 LAMMPS 轨迹、能量、RDF、MSD 等结果",
      fields: scenarioFields,
      capabilitySummary: {
        current: "LAMMPS 输出后处理",
        keyConfig: "RDF、MSD、能量/温度稳定性",
        resources: "本地或登录节点即可处理中等轨迹",
        deliverables: "RDF/MSD 图、能量曲线、统计表和结果说明",
      },
      expectedOutputs: "RDF/MSD 图、能量曲线、统计表和结果说明",
      promptTemplate: [
        "请分析 {{system}} 体系的 LAMMPS 轨迹与热力学输出。",
        "输入数据：{{inputData}}",
        "任务目标：{{goal}}",
        "运行环境：{{environment}}",
        "请生成后处理图表，并给出模拟是否稳定、是否需要继续采样的结论。",
      ].join("\n"),
    },
  ],
}

const vasp: CapabilityResource = {
  id: "vasp",
  name: "VASP",
  category: "hpc",
  domain: "materials",
  tags: ["HPC", "DFT", "AIMD"],
  blurb: "第一性原理材料模拟软件，用于结构优化、静态能量、能带/DOS 和 AIMD 数据生成。",
  docsHref: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem/tools/vasp",
  intro: {
    title: "30 秒看懂 HPC 软件",
    subtitle: "用于 DFT 结构优化、静态能量、能带、DOS 和 AIMD 计算，是材料模拟流程中的高精度计算底座",
    suited: ["结构优化", "DFT 静态计算", "AIMD 数据生成", "能带 / DOS"],
    notFor: ["没有 VASP 许可证", "POTCAR 不完整", "体系太大且只需快速筛选"],
    prepare: ["POSCAR", "INCAR", "KPOINTS", "POTCAR", "Slurm 脚本"],
    obtain: ["OUTCAR", "CONTCAR", "XDATCAR", "vasprun.xml", "能量和力数据"],
    steps: ["检查许可证和模块", "检查四件套输入", "生成提交脚本", "提交 VASP 作业", "解析结果并生成后处理任务"],
  },
  install: {
    banner: "已为你创建 VASP 软件环境配置任务",
    prompt: [
      "请检查当前项目和远程 HPC 环境是否可以运行 VASP，并完成软件环境配置方案。",
      "软件定位：第一性原理材料模拟软件。",
      "VASP 版本：intel2021+CPVASP+VASPSol+vtst+固定基矢优化",
      "下载链接：curl -f -C - -o dcu-vasp642-25Aug2026-dtk2604-all.tgz https://zzefile.scnet.cn:65011/efile/s/d/bGl1amllMjg2MA==/ad422d07bc4c758d",
      "典型输入：POSCAR / INCAR / KPOINTS / POTCAR / Slurm 脚本。",
      "典型输出：OUTCAR / CONTCAR / XDATCAR / vasprun.xml / 能量和力数据。",
      "要求：",
      "1. 先检查 module、conda/container、MPI/GPU、许可证/访问权限和项目目录权限。",
      "2. 说明 VASP 适用的运行方式、推荐版本、依赖环境和验证命令。",
      "3. 如果需要安装依赖、加载模块或提交远程命令，请先向我请求批准。",
      "4. 安装/配置完成后，请给出最小验证用例，并说明后续可以做：结构优化计算、AIMD 数据生成、结果检查与后处理。",
    ].join("\n"),
  },
  scenarios: [
    {
      id: "vasp-relax",
      title: "结构优化计算",
      summary: "检查 POSCAR/INCAR/KPOINTS/POTCAR 并提交 relax 任务",
      fields: scenarioFields,
      capabilitySummary: {
        current: "VASP DFT 结构优化",
        keyConfig: "ENCUT、EDIFF、ISIF、KPOINTS、力收敛",
        resources: "HPC MPI 队列；需有效许可证和 POTCAR",
        deliverables: "可运行目录、任务 ID、CONTCAR 和收敛报告",
      },
      expectedOutputs: "可运行 VASP 目录、run_vasp.slurm、任务 ID、CONTCAR 和收敛报告",
      promptTemplate: [
        "请为 {{system}} 体系准备并提交 VASP 结构优化计算。",
        "输入数据：{{inputData}}",
        "任务目标：{{goal}}",
        "运行环境：{{environment}}",
        "请先检查四件套输入和许可证，再生成提交脚本并说明收敛判据。",
      ].join("\n"),
    },
    {
      id: "vasp-aimd",
      title: "AIMD 数据生成",
      summary: "生成 AIMD 输入文件，用于后续 MACE/DeePMD 训练数据",
      fields: scenarioFields,
      capabilitySummary: {
        current: "VASP AIMD 数据生成",
        keyConfig: "IBRION=0、TEBEG/TEEND、POTIM、NSW",
        resources: "HPC 队列；轨迹用于 MACE/DeePMD 训练",
        deliverables: "AIMD INCAR、提交脚本、XDATCAR/OUTCAR 路径和数据整理建议",
      },
      expectedOutputs: "AIMD INCAR、提交脚本、XDATCAR/OUTCAR 路径和数据整理建议",
      promptTemplate: [
        "请为 {{system}} 体系准备 VASP AIMD 计算，用于机器学习势训练数据。",
        "输入数据：{{inputData}}",
        "任务目标：{{goal}}",
        "运行环境：{{environment}}",
        "请给出温度、步长、总步数建议，并说明如何把轨迹转为 MACE/DeePMD 数据集。",
      ].join("\n"),
    },
    {
      id: "vasp-postprocess",
      title: "结果检查与后处理",
      summary: "检查收敛、能量、力和轨迹，并生成后处理摘要",
      fields: scenarioFields,
      capabilitySummary: {
        current: "VASP 结果检查与后处理",
        keyConfig: "收敛判据、能量/力趋势、轨迹完整性",
        resources: "本地或登录节点即可处理中等输出",
        deliverables: "收敛报告、能量/力曲线、轨迹摘要和后续建议",
      },
      expectedOutputs: "收敛报告、能量/力曲线、轨迹摘要和后续建议",
      promptTemplate: [
        "请检查 {{system}} 体系的 VASP 计算结果并做后处理摘要。",
        "输入数据：{{inputData}}",
        "任务目标：{{goal}}",
        "运行环境：{{environment}}",
        "请确认收敛、能量、力和轨迹是否可用，并给出后处理图表与下一步建议。",
      ].join("\n"),
    },
  ],
}

// OneHub model resources are the catalog source of truth; mace/deepmd/onemodels/* enrich details.
const onemodelEnrichments = [mace, deepmd, ...modelEnrichments]
buildModelCapabilityCatalog(onemodelEnrichments)
const hpcResources: CapabilityResource[] = [lammps, vasp]

const categoryMeta: Array<Omit<CapabilityCategory, "items">> = [
  {
    id: "scenario",
    label: "场景",
    title: "场景库",
    copy: "按领域浏览可执行科研场景，搜索后进入分步工作流向导",
  },
  {
    id: "onemodel",
    label: "onemodel",
    title: "模型库",
    copy: "选择科研基座模型，安装后可直接进入对话工作台使用",
  },
  {
    id: "hpc",
    label: "HPC 软件",
    title: "软件库",
    copy: "按领域管理 LAMMPS、VASP 等科研计算软件，连接远程 HPC 运行环境",
  },
  {
    id: "onedata",
    label: "onedata",
    title: "数据资产",
    copy: "浏览公开目录并管理原始数据与可训练数据，支持按领域筛选、下载与发布",
  },
  {
    id: "oneskills",
    label: "oneskills",
    title: "技能编排",
    copy: "按编排层、资源层、专家层与执行层浏览 OneSkills 官方技能，并支持一键更新",
  },
  { id: "submission", label: "智能投稿", title: "论文投稿", copy: "上传论文、发现期刊、检索近期论文并比较评分基线" },
]

export function capabilityCategories(domain?: CapabilityDomain): CapabilityCategory[] {
  const privateModels = listPrivateModelResources(domain)
  const models = listModelCapabilityResources(domain, onemodelEnrichments)
  return categoryMeta.map((category) => ({
    ...category,
    items:
      category.id === "onemodel"
        ? [...models, ...privateModels]
        : category.id === "hpc"
          ? hpcResources.filter((item) => !domain || item.domain === domain)
          : [],
  }))
}

export function getCapabilityResource(id: string) {
  return (
    getModelCapabilityResource(id, onemodelEnrichments) ??
    hpcResources.find((item) => item.id === id) ??
    getPrivateModelResource(id)
  )
}

export function listCapabilityDomains(): CapabilityDomain[] {
  return ["materials", "weather", "fluid", "bio"]
}
