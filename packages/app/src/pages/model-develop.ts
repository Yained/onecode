import { base64Encode } from "@opencode-ai/core/util/encode"
import { codeSessionHref } from "@/app-routes"
import {
  modelScopeCacheFollowup,
  modelScopeDownloadDatasetCommand,
  modelScopeDownloadModelCommand,
  modelScopeDatasetsCacheDir,
  modelScopeModelsCacheDir,
} from "@/pages/modelscope-catalog"
import {
  pushSessionHandoffDraft,
  type HandoffPromptContext,
  type HandoffPromptTemplate,
  type HandoffSkill,
} from "@/pages/session/handoff"
import { markCodeNewSessionIntent } from "@/code-session-navigation"
import type { RuntimeEnvironment } from "@/components/onescience/runtime-environment"

export const modelScopeTaskPromptHeader = "请按照下面的内容，使用OneScience，进行后续工作。\n————————\n"

export const modelDevelopTypes = {
  training: {
    id: "training",
    label: "模型训练",
    description: "准备训练配置并做小规模验证",
  },
  inference: {
    id: "inference",
    label: "推理",
    description: "加载权重并完成推理验证",
  },
  "secondary-development": {
    id: "secondary-development",
    label: "二次开发",
    description: "改结构、做适配或扩展能力",
  },
  "parallel-expansion": {
    id: "parallel-expansion",
    label: "并行扩展",
    description: "改造为分布式或多卡训练",
  },
  "scientific-research": {
    id: "scientific-research",
    label: "科研开发",
    description: "选择论文或 GitHub 案例，复现并验证",
  },
} as const

export type ModelDevelopType = keyof typeof modelDevelopTypes

export const modelDevelopOptionList = Object.values(modelDevelopTypes)

const modelDevelopGoalTemplates: Record<Exclude<ModelDevelopType, "scientific-research">, string> = {
  training: `3）围绕 {title} 完成训练或微调准备与小规模验证：定位训练入口与配置方式，生成 training_config，优先 smoke training（小样本、少步数）。
   能跑则跑通并汇报；不能跑则列出阻塞项与最小补齐方案。
   验收：training_config、training_log、checkpoint（如有）、validation_summary。`,
  inference: `3）围绕 {title} 完成推理验证：定位可用 checkpoint 或预训练权重与推理入口，在样例输入上完成 smoke inference。
   能跑则输出关键结果并汇报；不能跑则列出阻塞项与最小补齐方案。
   验收：inference_result、validation_summary。`,
  "secondary-development": `3）围绕 {title} 在现有实现基础上做二次开发：明确改造边界（如结构改动、数据协议适配、接口扩展、checkpoint 兼容），给出最小改造路径与涉及文件。
   完成后给出可验证的 smoke test 方案；未授权前不提交远程训练。
   验收：改造说明、关键代码或配置变更、smoke test 方案或阻塞项清单。`,
  "parallel-expansion": `3）围绕 {title} 做并行扩展：在单卡可运行基础上，评估并推进多卡或分布式训练改造（如数据并行、模型并行、流水线并行等）。
   若无先例或不适用，直接说明原因与阻塞项，不强行改造。
   验收：并行方案说明、改造后的训练入口或配置、多卡 smoke test 方案或阻塞项清单。`,
}

export type ModelDevelopPromptInput = {
  modelId: string
  developType: Exclude<ModelDevelopType, "scientific-research">
  title: string
  copy: string
}

function runWithOptionalConda(condaEnv: string | undefined, command: string) {
  const name = condaEnv?.trim()
  if (!name) return `执行 ${command}`
  return `先执行 conda activate ${name}，再执行 ${command}`
}

export function modelDevelopDownloadStep(
  modelId: string,
  env: RuntimeEnvironment,
  ctx?: HandoffPromptContext,
) {
  const command = modelScopeDownloadModelCommand(modelId)
  if (env.kind === "ssh") {
    const target = ctx?.sshTarget
    if (!target) {
      return `1）运行环境为 SSH 远程（${env.targetName}），但该配置当前不可用；请先在运行环境选择框中重新选择环境，再下载模型。`
    }
    const remoteCache = `${target.remotePath}/${modelScopeModelsCacheDir}`
    return `1）在远端 ${target.name} 上通过 ssh ${runWithOptionalConda(ctx?.condaEnv, `modelscope download --model ${modelId} --cache_dir ${remoteCache}`)}。
   ${modelScopeCacheFollowup(remoteCache)}
   后续所有开发、训练与推理命令均在该远端环境执行，不要下载到本地。`
  }
  if (env.kind === "scnet") {
    const server = env.serverName ?? "scnet"
    return `1）SCNet 侧无法直接访问 ModelScope，不要在 SCNet 上执行 modelscope download。在当前项目目录${runWithOptionalConda(ctx?.condaEnv, command)}。
   ${modelScopeCacheFollowup(modelScopeModelsCacheDir)}
   再通过 ${server} MCP 工具把下载得到的模型目录传输到 SCNet 侧工作目录。
   后续所有开发、训练与推理命令均在 SCNet 环境执行。`
  }
  return `1）${runWithOptionalConda(ctx?.condaEnv, command)}。
   ${modelScopeCacheFollowup(modelScopeModelsCacheDir)}`
}

export function modelDevelopPrompt(
  input: ModelDevelopPromptInput,
  env?: RuntimeEnvironment,
  ctx?: HandoffPromptContext,
) {
  const developTypeLabel = modelDevelopTypes[input.developType].label
  const downloadStep = modelDevelopDownloadStep(input.modelId, env ?? { kind: "local" }, ctx)
  const goal = modelDevelopGoalTemplates[input.developType].replaceAll("{title}", input.title)

  return `${modelScopeTaskPromptHeader}模型：${input.title} — ${input.copy}

${downloadStep}
   下载得到的模型目录下的 README.md 为魔搭模型仓库自带说明，仅作依赖、示例命令、数据路径等补充参考，不要复述。

2）开发类型：${developTypeLabel}。
   优先依据 OneSkills 模型卡；未登记时再参考上文 README。

${goal}`
}

export function modelDevelopPromptTemplate(input: ModelDevelopPromptInput): HandoffPromptTemplate {
  return (env, ctx) => modelDevelopPrompt(input, env, ctx)
}

export type DatasetDownloadPromptInput = {
  datasetId: string
  title: string
  /** SCNet-side target directory chosen in the download dialog. */
  targetDir?: string
  serverName?: string
}

export function datasetDownloadPrompt(
  input: DatasetDownloadPromptInput,
  env: RuntimeEnvironment,
  ctx?: HandoffPromptContext,
) {
  if (env.kind === "ssh") {
    const target = ctx?.sshTarget
    if (!target) {
      return `${modelScopeTaskPromptHeader}数据集：${input.title}（${input.datasetId}）— 下载到 SSH 远端 ${env.targetName}

1）运行环境为 SSH 远程（${env.targetName}），但该配置当前不可用；请先在运行环境选择框中重新选择环境，再下载数据集。`
    }
    const remoteCache = `${target.remotePath}/${modelScopeDatasetsCacheDir}`
    return `${modelScopeTaskPromptHeader}数据集：${input.title}（${input.datasetId}）— 下载到 SSH 远端 ${target.name}

1）在远端 ${target.name} 上通过 ssh ${runWithOptionalConda(ctx?.condaEnv, `modelscope download --dataset ${input.datasetId} --cache_dir ${remoteCache}`)}。
   ${modelScopeCacheFollowup(remoteCache)}
   后续使用该数据集的操作均在该远端环境执行，不要下载到本地。

2）下载完成后核对远端文件数量与大小，汇报数据集在远端的实际路径与核验结果。`
  }
  if (env.kind === "scnet") {
    const targetDir = input.targetDir?.trim() || modelScopeDatasetsCacheDir
    const server = env.serverName ?? input.serverName ?? "scnet"
    return `${modelScopeTaskPromptHeader}数据集：${input.title}（${input.datasetId}）— 下载到 SCNet 环境

1）在当前项目目录${runWithOptionalConda(ctx?.condaEnv, modelScopeDownloadDatasetCommand(input.datasetId))}。
   ${modelScopeCacheFollowup(modelScopeDatasetsCacheDir)}

2）通过 ${server} MCP 工具把下载得到的数据集目录传输到 SCNet 侧：${targetDir}。
   SCNet 侧无法直接访问 ModelScope，不要尝试在 SCNet 上直接执行 modelscope download。

3）传输完成后核对 SCNet 侧文件数量与大小，汇报数据集在 SCNet 的实际路径与核验结果。`
  }
  return `${modelScopeTaskPromptHeader}数据集：${input.title}（${input.datasetId}）— 下载到本地

1）在当前项目目录${runWithOptionalConda(ctx?.condaEnv, modelScopeDownloadDatasetCommand(input.datasetId))}。
   ${modelScopeCacheFollowup(modelScopeDatasetsCacheDir)}

2）下载完成后核对文件数量与大小，汇报实际路径与核验结果。`
}

export function datasetDownloadPromptTemplate(input: DatasetDownloadPromptInput): HandoffPromptTemplate {
  return (env, ctx) => datasetDownloadPrompt(input, env, ctx)
}

export function prepareCodeSessionHandoff(
  directory: string,
  prompt: string,
  options?: {
    skill?: HandoffSkill
    template?: HandoffPromptTemplate
  },
) {
  const slug = base64Encode(directory)
  pushSessionHandoffDraft(slug, prompt, options)
  markCodeNewSessionIntent(slug)
  return codeSessionHref(directory)
}

export function prepareModelScopeSession(
  directory: string,
  prompt: string,
  options?: {
    skill?: HandoffSkill
    template?: HandoffPromptTemplate
  },
) {
  return prepareCodeSessionHandoff(directory, prompt, options)
}

export type ScientificResearchModel = "AlphaFold3" | "Evo2" | "MACE"

export type ScientificResearchScenario = {
  id: string
  label: string
  description: string
  prompt: string
}

export type ScientificResearchScenarioGroup = {
  label: string
  scenarios: ScientificResearchScenario[]
}

const alphaFold3PaperScenarios: ScientificResearchScenario[] = [
  {
    id: "af3-paper-7pzb",
    label: "蛋白-DNA-小分子复合物 7PZB",
    description: "Figure 1a：CRP/FNR 转录调控蛋白、DNA 与 cyclic GMP 复合物",
    prompt:
      "参考本目录下 OneScience 仓库中 `examples/biosciences/alphafold3` 的示例，使用 `bioscience` 虚拟环境，复现 AlphaFold 3 论文 Figure 1a 的 PDB 7PZB 案例。该复合物由 CRP/FNR 家族转录调控蛋白、DNA 和 cyclic GMP 组成。使用 RCSB PDB 的 7PZB 结构准备输入，保留 2 条蛋白、4 条 DNA 和 2 个 PCG 配体。完成结构预测后与实验结构叠合，生成完整复合物的 LDDT、GDT、结构叠合图和指标汇总表。生成的代码、脚本和产物放在单独文件夹中，不要污染原代码仓。",
  },
  {
    id: "af3-paper-7pnm",
    label: "糖基化刺突蛋白-抗体复合物 7PNM",
    description: "Figure 1b：OC43 刺突蛋白三聚体、糖链与中和抗体复合物",
    prompt:
      "参考本目录下 OneScience 仓库中 `examples/biosciences/alphafold3` 的示例，使用 `bioscience` 虚拟环境，复现 AlphaFold 3 论文 Figure 1b 的 PDB 7PNM 案例。该体系为 OC43 刺突蛋白三聚体、糖链和中和抗体复合物。按照 RCSB PDB 的 7PNM 沉积结构保留蛋白链、抗体链及共价糖基，完成预测后生成完整复合物的 LDDT、GDT、结构叠合图和指标汇总表。生成的代码、脚本和产物放在单独文件夹中，不要污染原代码仓。",
  },
  {
    id: "af3-paper-7tql",
    label: "人 40S 翻译起始复合物 7TQL",
    description: "Figure 3a：人 40S 核糖体蛋白、rRNA 与起始因子复合物",
    prompt:
      "参考本目录下 OneScience 仓库中 `examples/biosciences/alphafold3` 的示例，使用 `bioscience` 虚拟环境，复现 AlphaFold 3 论文 Figure 3a 的 PDB 7TQL 案例。输入应包含人 40S 核糖体蛋白、18S rRNA、起始 tRNA、eIF1A、eIF5B 及沉积结构中的必要组分，并核对总实体数为 43。完成预测后与 7TQL 实验结构叠合，生成完整复合物 LDDT、GDT、结构叠合图和指标汇总表。生成的代码、脚本和产物放在单独文件夹中，不要污染原代码仓。",
  },
  {
    id: "af3-paper-protein-ligand",
    label: "四个蛋白-配体结合案例",
    description: "Figure 3：7AU2、7URD、7WUX、7QIE 蛋白-配体复合物",
    prompt:
      "参考本目录下 OneScience 仓库中 `examples/biosciences/alphafold3` 的示例，使用 `bioscience` 虚拟环境，复现 AlphaFold 3 论文 Figure 3 中的四个蛋白-配体案例：7AU2 糖基化 EXTL3 二聚体、7URD PORCN-WNT3A-LGK974、7WUX AziU3/U2-底物复合物和 7QIE PI5P4K gamma-抑制剂复合物。使用相应的 RCSB PDB 结构准备输入，注意保留正确的蛋白链、糖基和目标配体。预测后进行口袋对齐，为每个案例生成配体 RMSD、口袋叠合图和指标汇总表。生成的代码、脚本和产物放在单独文件夹中，不要污染原代码仓。",
  },
  {
    id: "af3-paper-7u8c",
    label: "Mesothelin-抗体复合物 7U8C",
    description: "Figure 3c：mesothelin C 端肽与单克隆抗体 15B6 复合物",
    prompt:
      "参考本目录下 OneScience 仓库中 `examples/biosciences/alphafold3` 的示例，使用 `bioscience` 虚拟环境，复现 AlphaFold 3 论文 Figure 3c 的 PDB 7U8C 案例。该体系为 mesothelin C 端肽与单克隆抗体 15B6 的复合物，共包含 3 条蛋白实体。先用较少种子验证完整流程；算力允许时再按照论文的 1,000 个模型种子进行采样。使用实验结构生成抗原-抗体界面的 DockQ、界面叠合图和不同采样数量下的指标汇总表。生成的代码、脚本和产物放在单独文件夹中，不要污染原代码仓。",
  },
]

const evo2GithubScenarios: ScientificResearchScenario[] = [
  {
    id: "evo2-github-brca1-vep",
    label: "BRCA1 zero-shot VEP",
    description: "参考与替代等位基因归一化和变异功能评分",
    prompt:
      "参考本目录下 OneScience 仓库中 `examples/biosciences/evo2` 示例，使用 `bioscience-evo2` 虚拟环境，对 Evo 2 原 GitHub 上的 BRCA1 zero-shot VEP 任务进行复现，包括参考与替代等位基因归一化和变异功能评分。生成的代码、脚本以及产物放在单独的文件夹下，不要污染原代码仓。",
  },
  {
    id: "evo2-github-dna-generation",
    label: "DNA 序列生成与自动补全",
    description: "DNA prompt generation、autocompletion 与条件生成",
    prompt:
      "参考本目录下 OneScience 仓库中 `examples/biosciences/evo2` 示例，使用 `bioscience-evo2` 虚拟环境，对 Evo 2 原 GitHub 上的 generation notebook 进行复现，包括 DNA prompt generation、DNA autocompletion 和使用系统发育物种标签进行条件生成。生成的代码、脚本以及产物放在单独的文件夹下，不要污染原代码仓。\n\n请使用真实参考基因组进行一次 DNA 序列补全测试。测试对象为酿酒酵母 Saccharomyces cerevisiae S288C，参考组装为 R64，选择第 V 号染色体上的一个连续 4096 bp 片段。将该片段的前 2048 bp 作为 Evo2 已知输入，后 2048 bp 作为隐藏的真实答案。请根据前半段序列，预测其后紧接的 2048 bp DNA 序列。预测结果必须保持与输入序列连续，只允许使用 A、C、G、T、N，不要输出蛋白质序列、引物名称、解释文字或其他符号。测试完成后，将预测序列与参考基因组中真实的后 2048 bp 进行比较，统计序列长度、碱基组成和逐位碱基一致率。该测试仅用于评估 Evo2 的基因组序列建模能力，不能直接替代实验验证。",
  },
  {
    id: "evo2-github-exon-classifier",
    label: "外显子分类",
    description: "使用官方外显子分类器完成预测、AUROC 与可视化",
    prompt:
      "参考本目录下 OneScience 仓库中 `examples/biosciences/evo2` 示例，使用 `bioscience-evo2` 虚拟环境，对 Evo 2 原 GitHub 上的 exon classifier notebook 进行复现。使用原 notebook 提供的 `samplePositions.tsv` 和官方外显子分类器，完成外显子预测、AUROC 计算和结果可视化。生成的代码、脚本以及产物放在单独的文件夹下，不要污染原代码仓。",
  },
  {
    id: "evo2-github-sparse-autoencoder",
    label: "稀疏自编码器特征解释",
    description: "在大肠杆菌参考基因组上提取并可视化 SAE 特征激活",
    prompt:
      "参考本目录下 OneScience 仓库中 `examples/biosciences/evo2` 示例，使用 `bioscience-evo2` 虚拟环境，对 Evo 2 原 GitHub 上的 sparse autoencoder notebook 进行复现。使用官方 SAE 模型，在 Escherichia coli K-12 MG1655 参考基因组上提取并可视化特征激活，重现 notebook 中的大肠杆菌示例区段。生成的代码、脚本以及产物放在单独的文件夹下，不要污染原代码仓。",
  },
]

const evo2PaperScenarios: ScientificResearchScenario[] = [
  {
    id: "evo2-paper-brca1-saturation",
    label: "BRCA1 饱和突变功能效应预测",
    description: "Figure 3：coding / noncoding SNV 的零样本效应评分",
    prompt:
      "参考本目录下 OneScience 仓库中 `examples/biosciences/evo2` 示例，使用 `bioscience-evo2` 虚拟环境，复现 Evo 2 论文 Figure 3 的 BRCA1 变异效应预测。使用 Evo 2 官方 BRCA1 notebook 中的 GRCh37 chromosome 17 参考序列和 Findlay 等人的 BRCA1 saturation genome editing 数据，分别评价 coding SNV 和 noncoding SNV。生成 loss-of-function 与 functional/intermediate 变异的逐变异零样本分数、AUROC、AUPRC、ROC/PR 曲线和结果汇总表。生成的代码、脚本以及产物放在单独的文件夹下，不要污染原代码仓。",
  },
  {
    id: "evo2-paper-start-codon",
    label: "起始密码子突变扫描",
    description: "Figure 2b：起始密码子上下游 SNV 扫描与序列特征",
    prompt:
      "参考本目录下 OneScience 仓库中 `examples/biosciences/evo2` 示例，使用 `bioscience-evo2` 虚拟环境，复现 Evo 2 论文 Figure 2b 的起始位点突变扫描。使用 Escherichia coli K-12 MG1655 和 Saccharomyces cerevisiae S288C 的参考基因组及 CDS 注释，对蛋白编码基因起始密码子上下游逐位点进行 SNV 扫描。重点展示 E. coli 的 dnaA、rpoB、recA、lacZ 和酵母 ACT1、CYC1、TDH3，观察起始密码子、三碱基周期、Shine-Dalgarno 区和 Kozak 区的似然变化。生成的代码、脚本以及产物放在单独的文件夹下，不要污染原代码仓。",
  },
  {
    id: "evo2-paper-stop-codon",
    label: "不同遗传密码的终止密码子识别",
    description: "Figure 2e：标准遗传密码与 Code 4/6 终止密码子区分",
    prompt:
      "参考本目录下 OneScience 仓库中 `examples/biosciences/evo2` 示例，使用 `bioscience-evo2` 虚拟环境，复现 Evo 2 论文 Figure 2e 的遗传密码识别任务。选择采用标准遗传密码的 Escherichia coli K-12 MG1655、采用 Code 4 的 Mycoplasma pneumoniae 和采用 Code 6 的 Paramecium tetraurelia，分别测试 TAA、TAG 和 TGA 突变引起的似然变化，验证 Evo 2 是否能根据基因组上下文区分不同物种的终止密码子使用方式。生成的代码、脚本以及产物放在单独的文件夹下，不要污染原代码仓。",
  },
]

const maceScenarios: ScientificResearchScenario[] = [
  {
    id: "mace-vasp-trajectory-training",
    label: "VASP 轨迹训练 MACE 势函数",
    description: "将 12C/13C VASP AIMD 轨迹转换为 MACE 数据集并训练势函数",
    prompt:
      "使用 OneScience 处理 0.9 V 下 Cu(111)-40H2O-K 电化学界面中 bent CO2 的 12C / 13C VASP AIMD 轨迹；体系为 H80 C1 O42 K1 Cu64，共 188 个原子。请将 VASP 输出转换为 MACE 数据集，训练 H/C/O/K/Cu 机器学习势函数，并输出训练脚本、模型文件、数据划分、测试误差和结果摘要。生成的代码、脚本和产物放在单独文件夹中，不要污染原代码仓。",
  },
  {
    id: "mace-accuracy-validation",
    label: "MACE 模型精度验证",
    description: "在独立测试集上验证 MACE 能量和力的精度",
    prompt:
      "使用 OneScience 验证一个用于 0.9 V Cu(111)-40H2O-K bent CO2 界面的 MACE 模型；该模型由 12C / 13C VASP AIMD 轨迹训练得到，元素包含 H/C/O/K/Cu。请在独立测试集上计算能量和力的 MAE / RMSE，定位最大误差帧，生成误差分布图和模型选择依据，说明该 MACE 势函数能否作为 DFT 采样的近似替代。",
  },
  {
    id: "mace-long-time-md",
    label: "MACE-LAMMPS 长时间分子动力学",
    description: "将 MACE 模型转换为 LAMMPS 力场并运行长时程 MD",
    prompt:
      "使用 OneScience 将一个面向 0.9 V Cu(111)-40H2O-K bent CO2 界面的 H/C/O/K/Cu MACE 模型转换为 LAMMPS `pair_style mace` 可加载格式。请先完成 10 ps smoke test，确认模型加载、188 个原子、温度、能量、dump 和 restart 均正常；然后运行 100 ps / 300 ps MACE-LAMMPS 分子动力学，展示 MACE 如何把第一性原理采样扩展到更长时间尺度。",
  },
  {
    id: "mace-interface-evolution",
    label: "LAMMPS 轨迹中的界面结构演化分析",
    description: "分析 MACE-LAMMPS 轨迹中的界面结构演化",
    prompt:
      "使用 OneScience 分析 0.9 V Cu(111)-40H2O-K bent CO2 体系的 MACE-LAMMPS 轨迹；轨迹来自 H/C/O/K/Cu MACE 势函数驱动的长时间分子动力学。请统计 CO2 吸附取向、C-O 键长、O-C-O 角、C-Cu 距离、K+ 耦合、水供氢前驱结构和 CO2 是否脱附，并生成 PNG、CSV 和 Markdown 报告，展示 MACE 如何帮助研究者理解电化学界面结构演化。",
  },
  {
    id: "mace-enhanced-sampling",
    label: "MACE 增强采样与主动学习",
    description: "诊断 1 ns 扩展任务并给出主动学习建议",
    prompt:
      "使用 OneScience 诊断 0.9 V Cu(111)-40H2O-K bent CO2 体系的 1 ns MACE-LAMMPS 扩展任务；该任务使用 H/C/O/K/Cu MACE 势函数，可能出现 lost atoms、K+ 慢变量采样不足或训练域外构型。请比较 10 ps、100 ps、300 ps 与 1 ns 任务的结构和日志差异，定位风险来源，筛选需要回到 DFT 验证的边界帧，并给出下一轮主动学习或稳定性修复建议。",
  },
]

export const scientificResearchScenarioGroups: Record<ScientificResearchModel, ScientificResearchScenarioGroup[]> = {
  AlphaFold3: [{ label: "AlphaFold 3 论文案例", scenarios: alphaFold3PaperScenarios }],
  Evo2: [
    { label: "Evo 2 原 GitHub 案例", scenarios: evo2GithubScenarios },
    { label: "Evo 2 论文案例", scenarios: evo2PaperScenarios },
  ],
  MACE: [{ label: "MACE 材料计算科研案例", scenarios: maceScenarios }],
}

export function getScientificResearchModel(title: string): ScientificResearchModel | undefined {
  if (title === "AlphaFold3") return "AlphaFold3"
  if (title === "Evo2" || title === "evo2") return "Evo2"
  if (title === "MACE") return "MACE"
  return undefined
}

export function scientificResearchPrompt(model: ScientificResearchModel, scenarioId: string): string {
  const groups = scientificResearchScenarioGroups[model]
  const scenario = groups.flatMap((group) => group.scenarios).find((item) => item.id === scenarioId)
  if (!scenario) throw new Error(`未找到 ${model} 的科研开发场景: ${scenarioId}`)
  return scenario.prompt
}
