import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Logo } from "@opencode-ai/ui/logo"
import { useLayout } from "@/context/layout"
import { useLocation, useNavigate } from "@solidjs/router"
import { Icon } from "@opencode-ai/ui/icon"
import { usePlatform } from "@/context/platform"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogCreateProjectFolder } from "@/components/dialog-create-project-folder"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { useServer } from "@/context/server"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { codeSessionHref, codeEntryWorkspaceDirectory, codeWorkspaceRecentProjects } from "@/app-routes"
import { ProductNavMobileMenu } from "@/components/product-nav-mobile-menu"
import { getRelativeTimeFromMillis } from "@/utils/time"
import { storedPlatformAuthSession } from "@/utils/platform-auth"
import { shouldUseNativeProjectPicker } from "@/utils/project-picker"

const oneScienceGithubHref = "https://github.com/onescience-ai/"

const platformCatalog = () => [
    {
      label: "OneInfra",
      eyebrow: "AI4Science Infra",
      copy: "训练、推理、HPC 与科学算子的基础设施能力。",
      items: [
        { title: "训推框架", copy: "PyTorch、JAX、vLLM、ONNX 运行栈", icon: "TF", href: "#catalog-oneinfra-train" },
        { title: "并行框架", copy: "Megatron、DeepSpeed 大规模并行训练", icon: "PF", href: "#catalog-oneinfra-parallel" },
        { title: "推理框架", copy: "vLLM、SGLang 大模型推理服务", icon: "IF", href: "#catalog-oneinfra-inference" },
        { title: "科学算子", copy: "面向科学计算的高性能算子集合", icon: "SO", href: "#catalog-oneinfra-science-ops" },
        { title: "基础算子", copy: "通用张量与编译基础能力", icon: "BO", href: "#catalog-oneinfra-base-ops" },
        { title: "通信算子", copy: "NCCL、MPI 跨节点通信优化算子", icon: "CO", href: "#catalog-oneinfra-comm-ops" },
      ],
    },
    {
      label: "OneData",
      eyebrow: "Scientific Data",
      copy: "多领域科研数据、处理工具和示例代码。",
      items: [
        { title: "生信数据", copy: "基因组、蛋白结构与生命科学数据资产", icon: "BI", href: "#catalog-onedata-bio" },
        { title: "气象数据（ERA5）", copy: "再分析数据、气象场与预测样本", icon: "WE", href: "#catalog-onedata-era5" },
        { title: "流体数据", copy: "CFD、湍流、边界条件与流场数据", icon: "CF", href: "#catalog-onedata-fluid" },
        { title: "材料数据", copy: "晶体、分子、性质预测与材料图谱", icon: "MA", href: "#catalog-onedata-materials" },
        { title: "Protein（AF3）", copy: "蛋白折叠、复合物与 AlphaFold 3 相关数据", icon: "PR", href: "#catalog-onedata-protein" },
        { title: "数据处理工具", copy: "清洗、转换、标注和 Pipeline 工具", icon: "DT", href: "#catalog-onedata-tools" },
        { title: "数据组件", copy: "Dataset Loader、缓存、索引与版本管理", icon: "DC", href: "#catalog-onedata-components" },
        { title: "示例代码", copy: "科研数据读取、训练和评估样例", icon: "EX", href: "#catalog-onedata-examples" },
      ],
    },
    {
      label: "OneHub",
      eyebrow: "Model Hub",
      copy: "领域模型、科学软件与可复现实验资源中心。",
      items: [
        { title: "Top 领域模型", copy: "气象、生信、材料和流体方向代表模型", icon: "TM", href: "#catalog-onehub-models" },
        { title: "HPC 软件库", copy: "科学软件镜像、运行模板和资源索引", icon: "HL", href: "#catalog-onehub-hpc" },
      ],
    },
    {
      label: "OneSkills",
      eyebrow: "Agent Skills",
      copy: "可编排的智能体技能市场与工具调用系统。",
      items: [
        { title: "环境安装", copy: "科研软件、依赖、镜像和运行环境安装", icon: "EI", href: "#catalog-oneskills-install" },
        { title: "数据读取", copy: "面向 Agent 的数据接入和解析技能", icon: "DR", href: "#catalog-oneskills-data" },
        { title: "场景生成", copy: "自动生成仿真、训练和评估任务场景", icon: "SG", href: "#catalog-oneskills-scene" },
        { title: "runtime", copy: "任务执行、沙箱、队列与状态管理", icon: "RT", href: "#catalog-oneskills-runtime" },
        { title: "installer", copy: "工具链安装、检查和恢复流程", icon: "IN", href: "#catalog-oneskills-installer" },
        { title: "debug", copy: "日志分析、错误定位和自动修复建议", icon: "DB", href: "#catalog-oneskills-debug" },
        { title: "workflow", copy: "科研流程编排、复用和版本化", icon: "WF", href: "#catalog-oneskills-workflow" },
        { title: "hardware", copy: "GPU、HPC、存储和集群资源适配", icon: "HW", href: "#catalog-oneskills-hardware" },
        { title: "code", copy: "代码生成、重构、测试和实验脚本", icon: "CD", href: "#catalog-oneskills-code" },
      ],
    },
    {
      label: "案例",
      eyebrow: "Research Showcase",
      copy: "真实科研场景、合作案例和可视化成果。",
      items: [
        { title: "气象模型生成", copy: "ERA5 到气象预测工作流自动生成", icon: "WM", href: "#catalog-cases-weather" },
        { title: "蛋白质折叠", copy: "蛋白结构预测与突变分析案例", icon: "PF", href: "#catalog-cases-protein" },
        { title: "材料生成", copy: "材料搜索、生成和性质评估流程", icon: "MG", href: "#catalog-cases-materials" },
        { title: "合作案例", copy: "科研机构与企业联合项目展示", icon: "CO", href: "#catalog-cases-partners" },
      ],
    },
    {
      label: "文档&下载",
      eyebrow: "Developer Center",
      copy: "用户手册、插件与镜像说明、版本发版记录。",
      items: [
        { title: "用户手册", copy: "平台使用、项目创建和工作流说明", icon: "UM", href: "#catalog-docs-manual" },
        { title: "插件与镜像说明", copy: "OneSkills 插件协议、运行环境镜像和扩展方式", icon: "PL", href: "#catalog-docs-plugins" },
        { title: "Release Notes", copy: "版本更新、兼容性和迁移说明", icon: "RN", href: "#catalog-docs-release" },
      ],
    },
  ]

export default function Home() {
  const navigate = useNavigate()
  const nav = platformCatalog().map((section) => ({
    ...section,
    items: section.items.map((entry) => ({ ...entry, href: `/home${entry.href}` })),
  }))
  const prompts = [
    "基于 ERA5 生成气象预测工作流",
    "调用 DeepCFD 完成流场训练",
    "检索蛋白结构先验并生成实验",
    "组合材料模型与数据处理组件",
    "把论文方法转成可运行任务",
  ]
  const knowledgeFlow = [
    ["01", "知识检索", "从数据集、模型库、组件文档、论文方法和历史实验中定位可复用先验。"],
    ["02", "方案生成", "把科研目标转译为数据、模型、算子、环境和评估指标的结构化开发方案。"],
    ["03", "智能编排", "由 OneSkills 调用工具、生成代码、提交远程任务并跟踪运行状态。"],
    ["04", "复现沉淀", "把参数、日志、结果、依赖和知识引用回写为可追溯资产，支持下一次复用。"],
  ]
  const knowledgeAssets = [
    ["Scientific Data", "领域数据与样本协议", "ERA5、蛋白、材料、流体和实验数据"],
    ["Domain Models", "可调用模型与评测基准", "Pangu、DeepCFD、AlphaFold、MACE"],
    ["AI Primitives", "算子、组件和应用库", "DataPipe、Module、Trainer、Evaluator"],
    ["OneSkills", "智能体执行技能", "runtime、installer、workflow、debug、coder"],
  ]
  const modules = [
    {
      name: "OneInfra",
      tag: "AI4Science Infra",
      copy: "把集群、镜像、训练框架和科学软件组织为可被智能体调用的运行知识。",
      skills: ["PyTorch", "JAX", "vLLM", "ONNX", "Megatron", "DeepSpeed", "HPC Libraries"],
    },
    {
      name: "OneData",
      tag: "Scientific Data",
      copy: "统一接入 ERA5、蛋白质、DeepCFD、材料与实验数据，让数据成为开发先验。",
      skills: ["ERA5", "Protein", "DeepCFD", "Materials", "Dataset Pipeline"],
    },
    {
      name: "OneHub",
      tag: "Model Hub",
      copy: "沉淀科学模型、评测基准、复现实验和资源资产，支撑模型优选与迁移。",
      skills: ["Pangu", "AlphaFold", "MACE", "DeepCFD", "Model Registry"],
    },
    {
      name: "OneSkills",
      tag: "Agent Marketplace",
      copy: "把 Runtime、Installer、Workflow、Debug、Role 和硬件适配封装成可编排技能。",
      skills: ["Runtime", "Installer", "Workflow", "Debug", "Role", "Hardware", "Code Generator"],
    },
    {
      name: "AI4Research",
      tag: "Future Lab",
      copy: "面向 Physical AI、Embodied AI、World Model 与 AI Scientist 的知识增强科研平台。",
      skills: ["Physical AI", "Embodied AI", "World Model", "AI Scientist"],
    },
    {
      name: "Workflow System",
      tag: "Automation",
      copy: "从 Dataset 到 Training、Simulation、Evaluation、Deployment 的闭环开发引擎。",
      skills: ["Dataset", "Training", "Simulation", "Evaluation", "Deployment"],
    },
  ]
  const showcase = [
    ["气象预测", "ERA5 reanalysis + AI forecast ensemble", "00D2FF"],
    ["台风路径生成", "Multi-agent trajectory modeling", "7C3AED"],
    ["蛋白质折叠", "Structure prediction and mutation analysis", "22C55E"],
    ["药物发现", "Molecule generation and docking workflow", "F97316"],
    ["材料生成", "Crystal graph model and property search", "38BDF8"],
    ["CFD 仿真", "DeepCFD training and flow field evaluation", "A78BFA"],
  ]
  const updates = [
    "OneSkills v0.1.8 Released",
    "AI4Research Beta",
    "ERA5 Dataset API Online",
    "New Workflow Engine",
  ]
  const partners = ["中国气象局", "大气物理研究所", "昌平实验室", "浦江实验室", "计算所"]
  const jobs = ["AI Infra Engineer", "AI Scientist", "HPC Engineer", "Multi-Agent Engineer"]

  return (
    <main class="onescience-page min-h-full w-full overflow-y-auto scroll-smooth bg-[#050812] text-white">
      <div class="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div class="onescience-grid absolute inset-0 opacity-70" />
        <div class="onescience-neural absolute inset-x-0 top-0 h-[46rem] opacity-80" />
        <For each={Array.from({ length: 18 })}>
          {(_, index) => (
            <span
              class="onescience-particle absolute size-1 rounded-full bg-[#8EEBFF]"
              style={{
                left: `${8 + ((index() * 17) % 86)}%`,
                top: `${8 + ((index() * 29) % 78)}%`,
                "animation-delay": `${index() * 0.45}s`,
              }}
            />
          )}
        </For>
      </div>

      <header class="sticky top-0 z-50 border-b border-[#8EEBFF]/15 bg-[#080D1A]/72 shadow-[0_18px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl">
        <div class="mx-auto flex min-h-16 w-full max-w-7xl items-center justify-between gap-4 px-5 py-3 lg:px-8">
          <a href="/" class="group flex items-center gap-3">
            <div class="relative flex size-9 items-center justify-center overflow-hidden rounded-lg border border-[#00D2FF]/40 bg-[#0B1020] text-13-bold text-white shadow-[0_0_28px_rgba(0,210,255,0.28)]">
              <span class="absolute inset-0 bg-[linear-gradient(135deg,rgba(0,210,255,0.24),rgba(124,58,237,0.24))]" />
              <span class="relative">OS</span>
            </div>
            <div>
              <div class="text-15-bold tracking-[0.08em] text-white">OneScience</div>
              <div class="text-[10px] uppercase tracking-[0.22em] text-[#8EEBFF]">AI for Science</div>
            </div>
          </a>
          <nav class="hidden items-center gap-1 xl:flex">
            <For each={nav}>
              {(item) => (
                <div class="group relative">
                  <button class="rounded-md px-3 py-2 text-13-medium text-slate-300 transition hover:bg-white/8 hover:text-[#8EEBFF] hover:shadow-[0_0_22px_rgba(0,210,255,0.18)] group-focus-within:bg-white/8 group-focus-within:text-[#8EEBFF]">
                    {item.label}
                  </button>
                  <div class="invisible absolute left-1/2 top-full w-[34rem] -translate-x-1/2 translate-y-2 pt-4 opacity-0 transition duration-200 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100">
                    <div class="onescience-nav-popover overflow-hidden rounded-lg border border-[#8EEBFF]/18 bg-[#0B1020]/92 shadow-2xl shadow-[#00D2FF]/12 backdrop-blur-2xl">
                      <div class="border-b border-white/10 bg-[linear-gradient(135deg,rgba(0,210,255,0.10),rgba(124,58,237,0.10))] p-4">
                        <div class="text-11-bold uppercase tracking-[0.22em] text-[#8EEBFF]">{item.eyebrow}</div>
                        <div class="mt-1 text-13-regular leading-5 text-slate-300">{item.copy}</div>
                      </div>
                      <div class="grid grid-cols-2 gap-1 p-2">
                      <For each={item.items}>
                        {(entry) => (
                          <a href={entry.href} class="group/link flex gap-3 rounded-md border border-transparent p-3 transition hover:border-[#00D2FF]/35 hover:bg-[#00D2FF]/10 hover:shadow-[0_0_24px_rgba(0,210,255,0.12)]">
                            <span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-[#8EEBFF]/18 bg-white/[0.045] text-[10px] font-semibold text-[#8EEBFF] transition group-hover/link:border-[#00D2FF]/55 group-hover/link:bg-[#00D2FF]/15">
                              {entry.icon}
                            </span>
                            <span>
                              <span class="block text-13-bold text-white">{entry.title}</span>
                              <span class="mt-1 block text-11-regular leading-4 text-slate-400">{entry.copy}</span>
                            </span>
                          </a>
                        )}
                      </For>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </For>
          </nav>
          <div class="flex items-center gap-2">
            <a href="#developer" class="hidden rounded-md border border-white/12 px-3 py-2 text-13-medium text-slate-300 transition hover:border-[#00D2FF]/60 hover:text-white md:inline-flex">
              Docs
            </a>
            <ProductNavMobileMenu nav={nav} variant="dark" />
            <Show when={!storedPlatformAuthSession()}>
              <a
                href={`/login?redirect=${encodeURIComponent("/workspace")}`}
                class="rounded-md border border-white/12 px-3 py-2 text-13-medium text-slate-300 transition hover:border-[#00D2FF]/60 hover:text-white"
              >
                登录
              </a>
            </Show>
            <button
              class="rounded-md bg-[linear-gradient(135deg,#00D2FF,#7C3AED)] px-4 py-2 text-13-bold text-white shadow-[0_0_28px_rgba(0,210,255,0.28)] transition hover:-translate-y-0.5 hover:shadow-[0_0_38px_rgba(124,58,237,0.42)]"
              onClick={() => navigate("/dev")}
            >
              立即体验
            </button>
          </div>
        </div>
      </header>

      <section class="relative z-10 border-b border-white/10">
        <div class="mx-auto grid min-h-[calc(100dvh-4rem)] w-full max-w-7xl items-center gap-12 px-5 py-16 lg:grid-cols-[0.92fr_1.08fr] lg:px-8">
          <div class="onescience-reveal">
            <div class="inline-flex items-center gap-2 rounded-full border border-[#00D2FF]/30 bg-[#00D2FF]/8 px-3 py-1.5 text-12-medium text-[#8EEBFF]">
              <span class="size-1.5 rounded-full bg-[#00D2FF] shadow-[0_0_18px_rgba(0,210,255,0.8)]" />
              OneScience 智能科研平台
            </div>
            <h1 class="mt-7 max-w-4xl text-[52px] font-semibold leading-none text-white md:text-[84px]">
              知识驱动的
              <span class="block bg-[linear-gradient(90deg,#0284C7,#2563EB,#7C3AED)] bg-clip-text text-transparent">
                智能化开发模式
              </span>
            </h1>
            <p class="mt-6 max-w-2xl text-18-regular leading-8 text-slate-300">
              OneScience 将科学数据、领域模型、算子组件、论文文档、运行环境和 OneSkills 组织为可检索、可调用、可复用的知识体系，让科研开发从问题提出到代码生成、远程运行和结果复现都能被智能体系统化执行。
            </p>
            <div class="mt-9 flex flex-wrap gap-3 text-14-bold">
              <button
                class="rounded-md bg-[linear-gradient(135deg,#00D2FF,#7C3AED)] px-6 py-3 text-white shadow-[0_0_34px_rgba(0,210,255,0.34)] transition hover:-translate-y-0.5"
                onClick={() => navigate("/dev")}
              >
                进入智能科研工作台
              </button>
              <a
                href="#knowledge-driven"
                class="rounded-md border border-white/14 bg-white/5 px-6 py-3 text-white backdrop-blur transition hover:border-[#00D2FF]/60 hover:bg-[#00D2FF]/10"
              >
                查看知识驱动模式
              </a>
              <a
                href={oneScienceGithubHref}
                class="rounded-md border border-white/10 px-6 py-3 text-slate-300 transition hover:border-white/30 hover:text-white"
              >
                GitHub
              </a>
            </div>
            <div class="mt-10 grid max-w-xl grid-cols-3 gap-3">
              <For each={[["6类", "知识资产"], ["4步", "开发闭环"], ["全链路", "可追溯复现"]]}>
                {(item) => (
                  <div class="rounded-lg border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
                    <div class="text-24-bold text-white">{item[0]}</div>
                    <div class="mt-1 text-11-medium uppercase tracking-[0.16em] text-slate-500">{item[1]}</div>
                  </div>
                )}
              </For>
            </div>
          </div>

          <div class="onescience-reveal relative h-[36rem] overflow-hidden rounded-lg border border-white/10 bg-[#0B1020]/70 shadow-2xl shadow-[#00D2FF]/10 backdrop-blur">
            <div class="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(0,210,255,0.22),transparent_34%),linear-gradient(145deg,rgba(124,58,237,0.18),transparent_42%)]" />
            <div class="onescience-flow absolute inset-x-8 top-8 h-px bg-[linear-gradient(90deg,transparent,#00D2FF,transparent)]" />
            <div class="relative grid h-full grid-cols-[1fr_0.78fr] gap-0 p-6">
              <div class="relative overflow-hidden rounded-lg border border-white/10 bg-black/20">
                <div class="absolute inset-0 opacity-80">
                  <For each={Array.from({ length: 11 })}>
                    {(_, index) => (
                      <span
                        class="onescience-molecule absolute size-3 rounded-full border border-[#8EEBFF]/70 bg-[#00D2FF]/20 shadow-[0_0_26px_rgba(0,210,255,0.42)]"
                        style={{
                          left: `${13 + ((index() * 23) % 72)}%`,
                          top: `${12 + ((index() * 31) % 74)}%`,
                          "animation-delay": `${index() * 0.32}s`,
                        }}
                      />
                    )}
                  </For>
                  <For each={Array.from({ length: 8 })}>
                    {(_, index) => (
                      <span
                        class="absolute h-px origin-left bg-gradient-to-r from-[#00D2FF]/70 to-transparent"
                        style={{
                          left: `${14 + ((index() * 19) % 66)}%`,
                          top: `${18 + ((index() * 27) % 62)}%`,
                          width: `${80 + index() * 18}px`,
                          transform: `rotate(${18 + index() * 23}deg)`,
                        }}
                      />
                    )}
                  </For>
                </div>
                <div class="absolute bottom-4 left-4 right-4 rounded-lg border border-white/10 bg-[#0B1020]/80 p-4 backdrop-blur">
                  <div class="flex items-center justify-between">
                    <div class="text-13-bold text-white">Knowledge-Driven Run</div>
                    <div class="text-11-medium text-[#8EEBFF]">HPC Job Active</div>
                  </div>
                  <div class="mt-4 grid grid-cols-5 gap-1">
                    <For each={[68, 46, 84, 58, 92, 74, 51, 88, 61, 79]}>
                      {(height) => (
                        <span class="rounded-sm bg-[linear-gradient(180deg,#00D2FF,#7C3AED)] opacity-80" style={{ height: `${height}px` }} />
                      )}
                    </For>
                  </div>
                </div>
              </div>
              <div class="ml-4 grid content-between gap-4">
                <For each={["知识检索", "方案生成", "组件编排", "运行复现"]}>
                  {(item, index) => (
                    <div class="rounded-lg border border-white/10 bg-white/[0.045] p-4 transition hover:border-[#00D2FF]/40 hover:bg-[#00D2FF]/8">
                      <div class="flex items-center justify-between">
                        <span class="text-13-bold text-white">{item}</span>
                        <span class="text-11-medium text-slate-500">0{index() + 1}</span>
                      </div>
                      <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-white/8">
                        <div class="onescience-flow h-full rounded-full bg-[linear-gradient(90deg,#00D2FF,#7C3AED)]" style={{ width: `${50 + index() * 12}%` }} />
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="relative z-10 border-b border-white/10 px-5 py-20 lg:px-8">
        <div class="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <div class="text-13-bold uppercase tracking-[0.22em] text-[#8EEBFF]">Knowledge-Driven Development</div>
            <h2 class="mt-3 text-40-bold leading-tight text-white md:text-[56px]">让知识成为智能科研开发的第一输入</h2>
            <p class="mt-5 text-16-regular leading-8 text-slate-400">
              OneScience 面向 AI for Science 场景，不只提供单点模型或工具，而是把算力环境、数据资产、领域模型、实验流程和 Agent 技能组织为一套可持续演进的知识底座。
            </p>
          </div>
          <div class="grid gap-4 md:grid-cols-2">
            <For each={[
              ["统一知识入口", "用一个工作台连接 OneInfra、OneData、OneHub、OneSkills 与 AI4Research，减少科研工具链切换成本。"],
              ["先验增强生成", "从自然语言目标出发，自动匹配数据读取、环境安装、模型选择、训练仿真和评估汇报方案。"],
              ["领域资产沉淀", "围绕气象、蛋白、材料、流体、药物等方向沉淀数据、模型、组件、案例和最佳实践。"],
              ["可追溯工程复现", "把实验配置、运行日志、数据版本、镜像环境和工作流步骤固化为可追踪资产。"],
            ]}>
              {(item) => (
                <article class="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                  <h3 class="text-20-bold text-white">{item[0]}</h3>
                  <p class="mt-3 text-14-regular leading-7 text-slate-400">{item[1]}</p>
                </article>
              )}
            </For>
          </div>
        </div>
      </section>

      <section id="knowledge-driven" class="relative z-10 border-b border-white/10 px-5 py-20 lg:px-8">
        <div class="mx-auto max-w-7xl">
          <div class="grid gap-8 lg:grid-cols-[0.92fr_1.08fr]">
            <div>
              <div class="text-13-bold uppercase tracking-[0.22em] text-[#8EEBFF]">Development Loop</div>
              <h2 class="mt-3 text-40-bold leading-tight text-white md:text-[56px]">从科研知识到可运行代码的闭环</h2>
              <p class="mt-5 text-16-regular leading-8 text-slate-400">
                OneScience 把知识资产、智能规划、执行编排和结果沉淀放在同一条产品路径中，平台不只是资源列表，而是知识驱动的开发系统。
              </p>
              <div class="mt-8 grid gap-3 sm:grid-cols-2">
                <For each={knowledgeAssets}>
                  {(asset) => (
                    <article class="rounded-lg border border-white/10 bg-white/[0.04] p-4">
                      <div class="text-12-bold uppercase tracking-[0.18em] text-[#8EEBFF]">{asset[0]}</div>
                      <h3 class="mt-2 text-17-bold text-white">{asset[1]}</h3>
                      <p class="mt-2 text-13-regular leading-6 text-slate-400">{asset[2]}</p>
                    </article>
                  )}
                </For>
              </div>
            </div>
            <div class="grid gap-3">
              <For each={knowledgeFlow}>
                {(step) => (
                  <article class="group grid gap-4 rounded-lg border border-white/10 bg-[#0B1020]/70 p-5 transition hover:-translate-y-1 hover:border-[#00D2FF]/45 hover:shadow-[0_0_34px_rgba(0,210,255,0.12)] sm:grid-cols-[4.5rem_1fr]">
                    <div class="flex size-16 items-center justify-center rounded-lg border border-[#00D2FF]/24 bg-[#00D2FF]/10 text-18-bold text-[#8EEBFF]">{step[0]}</div>
                    <div>
                      <h3 class="text-22-bold text-white">{step[1]}</h3>
                      <p class="mt-2 text-14-regular leading-7 text-slate-400">{step[2]}</p>
                    </div>
                  </article>
                )}
              </For>
            </div>
          </div>
        </div>
      </section>

      <section id="content-list" class="relative z-10 border-b border-white/10 px-5 py-20 lg:px-8">
        <div class="mx-auto max-w-7xl">
          <div class="mb-10 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <div class="text-13-bold uppercase tracking-[0.22em] text-[#8EEBFF]">Knowledge Catalog</div>
              <h2 class="mt-3 text-40-bold leading-tight text-white md:text-[56px]">可复用的科研知识与工程资产</h2>
            </div>
            <p class="max-w-xl text-15-regular leading-7 text-slate-400">
              每个二级菜单都对应一类可接入的知识资产，后续可以继续扩展为详情、文档、下载、案例或工作流启动入口。
            </p>
          </div>
          <div class="grid gap-4 lg:grid-cols-2">
            <For each={nav}>
              {(section) => (
                <article class="rounded-lg border border-white/10 bg-white/[0.04] p-5 backdrop-blur transition hover:border-[#00D2FF]/35 hover:shadow-[0_0_34px_rgba(0,210,255,0.10)]">
                  <div class="text-11-bold uppercase tracking-[0.22em] text-[#8EEBFF]">{section.eyebrow}</div>
                  <h3 class="mt-2 text-22-bold text-white">{section.label}</h3>
                  <p class="mt-2 text-13-regular leading-6 text-slate-400">{section.copy}</p>
                  <div class="mt-4 grid gap-2 sm:grid-cols-2">
                    <For each={section.items}>
                      {(entry) => (
                        <a id={entry.href.split("#")[1]} href={entry.href} class="scroll-mt-24 rounded-md border border-white/10 bg-black/20 p-3 transition hover:-translate-y-0.5 hover:border-[#00D2FF]/45 hover:bg-[#00D2FF]/10 hover:shadow-[0_0_24px_rgba(0,210,255,0.12)]">
                          <span class="flex items-center gap-2">
                            <span class="flex size-7 items-center justify-center rounded-md border border-[#8EEBFF]/20 bg-white/[0.045] text-[10px] font-semibold text-[#8EEBFF]">
                              {entry.icon}
                            </span>
                            <span class="text-14-bold text-white">{entry.title}</span>
                          </span>
                          <span class="mt-2 block text-12-regular leading-5 text-slate-400">{entry.copy}</span>
                        </a>
                      )}
                    </For>
                  </div>
                </article>
              )}
            </For>
          </div>
        </div>
      </section>

      <section class="relative z-10 border-b border-white/10 px-5 py-20 lg:px-8">
        <div class="mx-auto max-w-7xl">
          <div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <div class="text-13-bold uppercase tracking-[0.22em] text-[#8EEBFF]">AI Scientist Workspace</div>
              <h2 class="mt-3 text-40-bold leading-tight text-white md:text-[56px]">从科研问题到可执行工作流</h2>
            </div>
            <p class="max-w-xl text-15-regular leading-7 text-slate-400">
              科研智能体会先检索领域先验，再规划数据、模型、训练、仿真和评估步骤，把自然语言任务变成可运行、可验证的开发流程。
            </p>
          </div>
          <div class="grid gap-4 lg:grid-cols-[0.75fr_1.45fr_0.8fr]">
            <div class="grid gap-3">
              <For each={["Protein Folding", "Weather Forecast", "Material Discovery", "CFD Simulation", "AI Scientist Agent"]}>
                {(item) => (
                  <button class="rounded-lg border border-white/10 bg-white/[0.04] p-4 text-left text-14-bold text-white transition hover:-translate-y-0.5 hover:border-[#00D2FF]/50 hover:bg-[#00D2FF]/10 hover:shadow-[0_0_28px_rgba(0,210,255,0.14)]">
                    {item}
                    <div class="mt-2 text-12-regular text-slate-500">Launch scientific workflow</div>
                  </button>
                )}
              </For>
            </div>
            <div class="overflow-hidden rounded-lg border border-white/10 bg-[#0B1020]/80 shadow-2xl shadow-[#7C3AED]/10 backdrop-blur">
              <div class="flex items-center gap-2 border-b border-white/10 px-5 py-4">
                <span class="size-2 rounded-full bg-[#FF5F57]" />
                <span class="size-2 rounded-full bg-[#FEBC2E]" />
                <span class="size-2 rounded-full bg-[#28C840]" />
                <span class="ml-3 text-12-medium uppercase tracking-[0.18em] text-slate-500">AI Scientist Session</span>
              </div>
              <div class="space-y-4 p-5">
                <div class="max-w-[82%] rounded-lg border border-[#00D2FF]/20 bg-[#00D2FF]/8 p-4">
                  <div class="text-13-bold text-[#8EEBFF]">User</div>
                  <div class="mt-2 text-15-regular text-white">基于 ERA5 和历史台风样本，生成一个可复现实验工作流。</div>
                </div>
                <div class="ml-auto max-w-[88%] rounded-lg border border-white/10 bg-white/[0.045] p-4">
                  <div class="text-13-bold text-white">AI Scientist</div>
                  <div class="mt-3 grid gap-3">
                    <For each={["检索气象数据先验", "匹配 Pangu Weather 模型", "生成多智能体执行流", "准备远程仿真任务"]}>
                      {(step) => (
                        <div class="flex items-center gap-3 text-14-regular text-slate-300">
                          <span class="onescience-pulse size-2 rounded-full bg-[#00D2FF]" />
                          {step}
                        </div>
                      )}
                    </For>
                  </div>
                </div>
                <div class="rounded-lg border border-white/10 bg-black/20 p-3">
                  <div class="flex flex-wrap gap-2">
                    <For each={prompts}>
                      {(prompt) => <span class="rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-12-medium text-slate-300">{prompt}</span>}
                    </For>
                  </div>
                  <div class="mt-4 flex items-center justify-between rounded-md border border-[#00D2FF]/30 bg-[#00D2FF]/8 px-4 py-3">
                    <span class="text-14-regular text-slate-300">让 OneScience 基于知识库生成科研工作流...</span>
                    <span class="rounded-md bg-[#00D2FF] px-3 py-1.5 text-12-bold text-[#06111F]">Run</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="rounded-lg border border-white/10 bg-white/[0.04] p-5">
              <div class="text-14-bold text-white">Agent Workflow</div>
              <div class="mt-5 space-y-4">
                <For each={["理解任务目标", "加载数据知识", "选择模型组件", "生成执行计划", "提交仿真任务"]}>
                  {(item, index) => (
                    <div class="flex gap-3">
                      <span class="mt-1 flex size-5 items-center justify-center rounded-full border border-[#00D2FF]/40 text-[10px] text-[#8EEBFF]">{index() + 1}</span>
                      <div>
                        <div class="text-13-bold text-white">{item}</div>
                        <div class="mt-1 h-1 w-28 overflow-hidden rounded-full bg-white/8">
                          <span class="onescience-flow block h-full rounded-full bg-[#00D2FF]" />
                        </div>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="relative z-10 border-b border-white/10 px-5 py-20 lg:px-8">
        <div class="mx-auto max-w-7xl">
          <div class="max-w-3xl">
            <div class="text-13-bold uppercase tracking-[0.22em] text-[#8EEBFF]">Platform Modules</div>
            <h2 class="mt-3 text-40-bold leading-tight text-white md:text-[56px]">支撑知识驱动开发的六大模块</h2>
          </div>
          <div class="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <For each={modules}>
              {(item) => (
                <article class="group rounded-lg border border-white/10 bg-white/[0.04] p-6 transition hover:-translate-y-1 hover:border-[#00D2FF]/45 hover:bg-[#0B1020]/82 hover:shadow-[0_0_34px_rgba(0,210,255,0.14)]">
                  <div class="flex items-center justify-between">
                    <div class="rounded-md border border-[#00D2FF]/30 bg-[#00D2FF]/10 px-3 py-1 text-12-bold text-[#8EEBFF]">{item.tag}</div>
                    <div class="size-9 rounded-lg border border-white/10 bg-[linear-gradient(135deg,rgba(0,210,255,0.26),rgba(124,58,237,0.22))]" />
                  </div>
                  <h3 class="mt-6 text-24-bold text-white">{item.name}</h3>
                  <p class="mt-3 min-h-14 text-14-regular leading-6 text-slate-400">{item.copy}</p>
                  <div class="mt-6 flex flex-wrap gap-2">
                    <For each={item.skills}>
                      {(skill) => <span class="rounded-md border border-white/10 bg-black/20 px-2.5 py-1 text-11-medium text-slate-300">{skill}</span>}
                    </For>
                  </div>
                  <div class="mt-6 h-16 overflow-hidden rounded-lg border border-white/10 bg-black/20 p-3">
                    <div class="onescience-flow h-full rounded-md bg-[linear-gradient(90deg,rgba(0,210,255,0.18),rgba(124,58,237,0.28),rgba(0,210,255,0.12))]" />
                  </div>
                </article>
              )}
            </For>
          </div>
        </div>
      </section>

      <section class="relative z-10 border-b border-white/10 px-5 py-20 lg:px-8">
        <div class="mx-auto max-w-7xl">
          <div class="mb-10 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <div class="text-13-bold uppercase tracking-[0.22em] text-[#8EEBFF]">Research Showcase</div>
              <h2 class="mt-3 text-40-bold leading-tight text-white md:text-[56px]">科研案例展示</h2>
            </div>
            <a href="#developer" class="text-14-bold text-[#8EEBFF] hover:text-white">View all cases</a>
          </div>
          <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <For each={showcase}>
              {(item) => (
                <article class="group min-h-64 overflow-hidden rounded-lg border border-white/10 bg-[#0B1020]/70 p-5 transition hover:-translate-y-1 hover:border-white/25">
                  <div class="flex items-center justify-between">
                    <h3 class="text-20-bold text-white">{item[0]}</h3>
                    <span class="text-11-medium uppercase tracking-[0.18em] text-slate-500">Simulation</span>
                  </div>
                  <p class="mt-2 text-13-regular text-slate-400">{item[1]}</p>
                  <div class="relative mt-8 h-32 overflow-hidden rounded-lg border border-white/10 bg-black/30">
                    <div class="absolute inset-0" style={{ background: `radial-gradient(circle at 30% 35%, #${item[2]}55, transparent 34%), linear-gradient(135deg, #${item[2]}26, transparent 58%)` }} />
                    <For each={Array.from({ length: 5 })}>
                      {(_, index) => (
                        <span
                          class="absolute h-px bg-white/35"
                          style={{
                            left: `${8 + index() * 13}%`,
                            top: `${22 + index() * 11}%`,
                            width: `${110 - index() * 8}px`,
                            transform: `rotate(${index() * 17 - 18}deg)`,
                          }}
                        />
                      )}
                    </For>
                  </div>
                </article>
              )}
            </For>
          </div>
        </div>
      </section>

      <section class="relative z-10 border-b border-white/10 px-5 py-20 lg:px-8">
        <div class="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div class="rounded-lg border border-white/10 bg-white/[0.04] p-6">
            <div class="text-13-bold uppercase tracking-[0.22em] text-[#8EEBFF]">Platform Updates</div>
            <h2 class="mt-3 text-36-bold text-white">知识资产动态</h2>
            <div class="mt-8 overflow-hidden rounded-lg border border-[#00D2FF]/20 bg-black/40 font-mono">
              <For each={updates}>
                {(item, index) => (
                  <div class="flex items-center gap-3 border-b border-white/8 px-4 py-3 last:border-b-0">
                    <span class="text-[#00D2FF]">[{String(index() + 1).padStart(2, "0")}]</span>
                    <span class="text-slate-300">{item}</span>
                    <span class="ml-auto text-[#22C55E]">ONLINE</span>
                  </div>
                )}
              </For>
            </div>
          </div>
          <div id="developer" class="rounded-lg border border-white/10 bg-[#0B1020]/80 p-6">
            <div class="text-13-bold uppercase tracking-[0.22em] text-[#8EEBFF]">Developer Center</div>
            <h2 class="mt-3 text-36-bold text-white">面向智能开发的接入入口</h2>
            <div class="mt-5 rounded-md border border-white/10 bg-black/30 px-4 py-3 text-14-regular text-slate-500">
              Search Knowledge Docs, SDK, Workflow Docs, Runtime Download...
            </div>
            <div class="mt-5 grid gap-2 md:grid-cols-3">
              <For each={[
                { label: "API Docs", href: "#" },
                { label: "SDK", href: "#" },
                { label: "Workflow Docs", href: "#" },
                { label: "Runtime Download", href: "#" },
                { label: "Docker Images", href: "#" },
                { label: "GitHub", href: oneScienceGithubHref },
                { label: "Gitee", href: oneScienceGithubHref },
              ]}>
                {(item) => <a href={item.href} class="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-13-medium text-slate-300 transition hover:border-[#00D2FF]/50 hover:text-white">{item.label}</a>}
              </For>
            </div>
            <pre class="mt-5 overflow-x-auto rounded-lg border border-white/10 bg-black/50 p-4 text-12-regular leading-6 text-slate-300"><code>{`import { OneScience } from "@onescience/sdk"

const workflow = await OneScience.workflow.create({
  dataset: "ERA5",
  model: "PanguWeather",
  knowledge: ["dataset.schema", "model.best_practice", "hpc.runtime"],
  agents: ["planner", "trainer", "evaluator"],
})`}</code></pre>
          </div>
        </div>
      </section>

      <section class="relative z-10 border-b border-white/10 px-5 py-20 lg:px-8">
        <div class="mx-auto max-w-7xl">
          <div class="text-center">
            <div class="text-13-bold uppercase tracking-[0.22em] text-[#8EEBFF]">Trusted By</div>
            <h2 class="mt-3 text-40-bold text-white">合作机构</h2>
          </div>
          <div class="mt-10 grid gap-3 md:grid-cols-5">
            <For each={partners}>
              {(item) => (
                <div class="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-8 text-center text-15-bold text-slate-400 transition hover:border-[#00D2FF]/40 hover:text-white hover:shadow-[0_0_26px_rgba(0,210,255,0.12)]">
                  {item}
                </div>
              )}
            </For>
          </div>
        </div>
      </section>

      <section class="relative z-10 px-5 py-20 lg:px-8">
        <div class="mx-auto grid max-w-7xl gap-8 rounded-lg border border-white/10 bg-[linear-gradient(135deg,rgba(0,210,255,0.08),rgba(124,58,237,0.08))] p-8 md:grid-cols-[0.85fr_1.15fr]">
          <div>
            <div class="text-13-bold uppercase tracking-[0.22em] text-[#8EEBFF]">Join OneScience</div>
            <h2 class="mt-3 text-40-bold leading-tight text-white">共建知识驱动的智能科研平台</h2>
            <p class="mt-4 text-15-regular leading-7 text-slate-400">
              我们正在构建面向 AI Infra、HPC、多智能体系统和 AI Scientist 的下一代科研知识基础设施。
            </p>
          </div>
          <div>
            <div class="grid gap-3 md:grid-cols-2">
              <For each={jobs}>
                {(item) => <div class="rounded-lg border border-white/10 bg-black/20 p-4 text-15-bold text-white">{item}</div>}
              </For>
            </div>
            <div class="mt-6 flex flex-wrap gap-3 text-13-medium text-slate-300">
              <For each={[
                { label: "GitHub", href: oneScienceGithubHref },
                { label: "Gitee", href: oneScienceGithubHref },
                { label: "小红书", href: "#" },
                { label: "Email", href: "#" },
                { label: "Phone", href: "#" },
              ]}>
                {(item) => <a href={item.href} class="rounded-md border border-white/10 px-3 py-2 transition hover:border-[#00D2FF]/50 hover:text-white">{item.label}</a>}
              </For>
            </div>
          </div>
        </div>
      </section>

      <footer class="relative z-10 border-t border-white/10 bg-[#050812] px-5 py-10 lg:px-8">
        <div class="mx-auto flex max-w-7xl flex-col gap-8 md:flex-row md:items-center md:justify-between">
          <div>
            <div class="text-20-bold text-white">OneScience</div>
            <div class="mt-2 text-13-regular text-slate-500">知识驱动的智能科研平台</div>
          </div>
          <div class="flex flex-wrap gap-4 text-13-medium text-slate-400">
            <For each={["OneInfra", "OneData", "OneHub", "OneSkills", "Developer Center"]}>
              {(item) => <a href="#" class="transition hover:text-white">{item}</a>}
            </For>
          </div>
        </div>
      </footer>
    </main>
  )
}

export function CatalogHome() {
  const catalog = platformCatalog()

  return (
    <main class="onescience-page min-h-full w-full overflow-y-auto scroll-smooth bg-[#050812] text-white">
      <header class="sticky top-0 z-50 border-b border-[#8EEBFF]/15 bg-[#080D1A]/72 shadow-[0_18px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl">
        <div class="mx-auto flex min-h-16 w-full max-w-7xl items-center justify-between gap-4 px-5 py-3 lg:px-8">
          <a href="/" class="group flex items-center gap-3">
            <div class="relative flex size-9 items-center justify-center overflow-hidden rounded-lg border border-[#00D2FF]/40 bg-[#0B1020] text-13-bold text-white shadow-[0_0_28px_rgba(0,210,255,0.28)]">
              <span class="absolute inset-0 bg-[linear-gradient(135deg,rgba(0,210,255,0.24),rgba(124,58,237,0.24))]" />
              <span class="relative">OS</span>
            </div>
            <div>
              <div class="text-15-bold tracking-[0.08em] text-white">OneScience</div>
              <div class="text-[10px] uppercase tracking-[0.22em] text-[#8EEBFF]">Capability Catalog</div>
            </div>
          </a>
          <div class="flex items-center gap-2">
            <a href="/" class="rounded-md border border-white/12 px-3 py-2 text-13-medium text-slate-300 transition hover:border-[#00D2FF]/60 hover:text-white">
              返回首页
            </a>
            <a href="/dev" class="rounded-md bg-[linear-gradient(135deg,#00D2FF,#7C3AED)] px-4 py-2 text-13-bold text-white shadow-[0_0_28px_rgba(0,210,255,0.28)] transition hover:-translate-y-0.5">
              进入工作台
            </a>
          </div>
        </div>
      </header>

      <section class="relative z-10 border-b border-white/10 px-5 py-16 lg:px-8">
        <div class="mx-auto max-w-7xl">
          <div class="max-w-3xl">
            <div class="text-13-bold uppercase tracking-[0.22em] text-[#8EEBFF]">OneScience Catalog</div>
            <h1 class="mt-4 text-[48px] font-semibold leading-none text-white md:text-[76px]">平台能力列表</h1>
            <p class="mt-6 text-17-regular leading-8 text-slate-400">
              这里承接首页顶部导航的所有二级入口。每个能力条目都可以继续扩展为详情、文档、下载、案例或工作流启动入口。
            </p>
          </div>
          <div class="mt-10 flex flex-wrap gap-2">
            <For each={catalog}>
              {(section) => (
                <a href={`#${section.label}`} class="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-13-bold text-slate-300 transition hover:border-[#00D2FF]/50 hover:text-white">
                  {section.label}
                </a>
              )}
            </For>
          </div>
        </div>
      </section>

      <section class="relative z-10 px-5 py-12 lg:px-8">
        <div class="mx-auto grid max-w-7xl gap-5">
          <For each={catalog}>
            {(section) => (
              <article id={section.label} class="scroll-mt-24 rounded-lg border border-white/10 bg-white/[0.04] p-5">
                <div class="grid gap-5 lg:grid-cols-[18rem_1fr]">
                  <div>
                    <div class="text-11-bold uppercase tracking-[0.22em] text-[#8EEBFF]">{section.eyebrow}</div>
                    <h2 class="mt-2 text-28-bold text-white">{section.label}</h2>
                    <p class="mt-3 text-14-regular leading-7 text-slate-400">{section.copy}</p>
                  </div>
                  <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <For each={section.items}>
                      {(entry) => (
                        <a id={entry.href.slice(1)} href="/" class="scroll-mt-24 rounded-md border border-white/10 bg-black/20 p-4 transition hover:-translate-y-0.5 hover:border-[#00D2FF]/45 hover:bg-[#00D2FF]/10">
                          <span class="flex items-center gap-3">
                            <span class="flex size-8 shrink-0 items-center justify-center rounded-md border border-[#8EEBFF]/20 bg-white/[0.045] text-[10px] font-semibold text-[#8EEBFF]">
                              {entry.icon}
                            </span>
                            <span class="text-15-bold text-white">{entry.title}</span>
                          </span>
                          <span class="mt-3 block text-13-regular leading-6 text-slate-400">{entry.copy}</span>
                          <span class="mt-4 inline-flex text-12-bold text-[#8EEBFF]">查看详情</span>
                        </a>
                      )}
                    </For>
                  </div>
                </div>
              </article>
            )}
          </For>
        </div>
      </section>
    </main>
  )
}

export function DevelopmentHome() {
  const sync = useGlobalSync()
  const layout = useLayout()
  const platform = usePlatform()
  const dialog = useDialog()
  const navigate = useNavigate()
  const server = useServer()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const location = useLocation()
  const [autoOpening, setAutoOpening] = createSignal(false)
  const homedir = createMemo(() => sync.data.path.home)
  const recent = createMemo(() => {
    const projects = new Map(layout.projects.list().map((project) => [project.worktree, project]))
    sync.data.project.forEach((project) => {
      projects.set(project.worktree, { expanded: true, ...projects.get(project.worktree), ...project })
    })
    return Array.from(projects.values())
      .slice()
      .sort((a, b) => (b.time?.updated ?? b.time?.created ?? 0) - (a.time?.updated ?? a.time?.created ?? 0))
      .slice(0, 5)
  })

  const serverDotClass = createMemo(() => {
    const healthy = server.healthy()
    if (healthy === true) return "bg-icon-success-base"
    if (healthy === false) return "bg-icon-critical-base"
    return "bg-border-weak-base"
  })

  function openProject(directory: string, shouldNavigate = true) {
    layout.projects.open(directory)
    server.projects.touchCode(directory)
    void globalSDK.client.project.current({ directory }).catch(() => undefined)
    if (shouldNavigate) navigate(`${codeSessionHref(directory)}${location.search}`)
  }

  createEffect(() => {
    if (location.pathname !== "/code") return
    if (autoOpening()) return
    if (!sync.bootstrapped) return
    const directory = codeEntryWorkspaceDirectory({
      path: sync.data.path,
      recent: recent(),
      lastCodeWorkspace: server.projects.lastCode(),
    })
    if (!directory) return
    setAutoOpening(true)
    openProject(directory)
  })

  function createProjectFolder() {
    dialog.show(() => <DialogCreateProjectFolder onCreated={(directory) => openProject(directory)} />)
  }

  async function chooseProject() {
    const nativePicker = platform.openDirectoryPickerDialog
    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        result.forEach((directory, index) => openProject(directory, index === 0))
        return
      }
      if (result) openProject(result)
    }

    if (
      nativePicker &&
      shouldUseNativeProjectPicker({
        hasNativePicker: !!nativePicker,
        isLocalServer: !!server.isLocal(),
        hasPlatformSession: !!storedPlatformAuthSession(),
      })
    ) {
      const result = await nativePicker({
        title: language.t("command.project.open"),
        multiple: true,
      })
      resolve(result)
    } else {
      dialog.show(
        () => (
          <DialogSelectDirectory
            multiple={true}
            onSelect={resolve}
            onCreateFolder={createProjectFolder}
          />
        ),
        () => resolve(null),
      )
    }
  }

  return (
    <div class="os-code-entry mx-auto w-full px-4">
      <div class="os-code-entry-card">
        <div class="os-code-entry-mark">✣</div>
        <div class="os-code-entry-title">OneScience Code</div>
        <div class="os-code-entry-copy">正在连接代码开发工作区，进入 AI 交互界面。</div>
      </div>
      <Logo class="hidden" />
      <Button
        size="large"
        variant="ghost"
        class="mt-4 mx-auto text-14-regular text-text-weak hidden"
        onClick={() => dialog.show(() => <DialogSelectServer />)}
      >
        <div
          classList={{
            "size-2 rounded-full": true,
            [serverDotClass()]: true,
          }}
        />
        {server.name}
      </Button>
      <Switch>
        <Match when={recent().length > 0}>
          <div class="os-code-panel">
            <div class="flex gap-2 items-center justify-between pl-3">
              <div class="os-code-panel-title">{language.t("home.recentProjects")}</div>
              <Button icon="folder-add-left" size="normal" class="pl-2 pr-3 os-code-button" onClick={chooseProject}>
                {language.t("command.project.open")}
              </Button>
            </div>
            <ul class="flex flex-col gap-2">
              <For each={recent()}>
                {(project) => (
                  <Button
                    size="large"
                    variant="ghost"
                    class="os-code-project-button text-left justify-between px-3"
                    onClick={() => openProject(project.worktree)}
                  >
                    {project.worktree.replace(homedir(), "~")}
                    <Show when={project.time}>
                      {(time) => (
                        <div class="text-14-regular text-text-weak">
                          {getRelativeTimeFromMillis(time().updated ?? time().created, language.t)}
                        </div>
                      )}
                    </Show>
                  </Button>
                )}
              </For>
            </ul>
          </div>
        </Match>
        <Match when={!sync.ready}>
          <div class="os-code-empty">
            <div>{language.t("common.loading")}</div>
            <Button class="px-3 os-code-button" onClick={chooseProject}>
              {language.t("command.project.open")}
            </Button>
          </div>
        </Match>
        <Match when={true}>
          <div class="os-code-empty">
            <Icon name="folder-add-left" size="large" />
            <div class="flex flex-col gap-1 items-center justify-center">
              <div class="os-code-empty-title">{language.t("home.empty.title")}</div>
              <div class="os-code-empty-copy">未检测到可用工作目录时，可手动选择项目进入 AI 编程会话。</div>
            </div>
            <Button class="px-3 mt-1 os-code-button" onClick={chooseProject}>
              {language.t("command.project.open")}
            </Button>
          </div>
        </Match>
      </Switch>
    </div>
  )
}
