import { For, Show, batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack, type JSX } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { Portal } from "solid-js/web"
import { A, Navigate, useLocation, useNavigate } from "@solidjs/router"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast, Toast } from "@opencode-ai/ui/toast"
import {
  codeEntryWorkspaceDirectory,
  codePromptHref,
  codeSessionHref,
  codeSkillManagerHref,
  configuredCodeDefaultDirectory,
  codeWorkspaceDirectory,
  codeWorkspaceRecentProjects,
  oneScienceResourceWorkspaceDirectory,
  workspaceCapabilitiesCategoryHref,
  workspaceCapabilitiesHref,
  workspaceCaseDomainHref,
  workspaceDevelopmentEntryHref,
  workspaceDocsHref,
  workspaceHomeHref,
  workspaceSessionHref,
} from "@/app-routes"
import { DialogSettings } from "@/components/dialog-settings"
import { DatasetDownloadDialog, DatasetDownloadCancelDialog, DatasetDownloadDeleteDialog } from "@/components/onescience/DatasetDownloadDialog"
import { ModelDevelopDialog } from "@/components/onescience/ModelDevelopDialog"
import { ProductNavMobileMenu } from "@/components/product-nav-mobile-menu"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useScrollContainerRestoration } from "@/hooks/use-scroll-container-restoration"
import { authenticatedFetch } from "@/utils/authenticated-fetch"
import { fuzzyMatchParts } from "@/utils/fuzzy-match"
import { requirePersonalSpace } from "@/workbench/require-auth"
import { CapabilityPager } from "@/workbench/capabilities/pager"
import { CAPABILITY_PAGE_SIZE_RESOURCE, paginate } from "@/workbench/capabilities/pagination"
import {
  platformAuthLoggingOutEvent,
  platformAuthSessionUpdatedEvent,
  platformWorkspaceCacheClearedEvent,
  clearPlatformAuthSession,
  defaultPlatformProjectDirectory,
  filterPlatformAccountProjects,
  isPlatformAuthRejection,
  platformAuthUrl,
  resolvePlatformAuthSession,
  sharedCasesRoot,
  storePlatformAuthSession,
  storedPlatformAuthSession,
  storedPlatformAuthToken,
  type PlatformAuthSession,
} from "@/utils/platform-auth"
import { docsItems } from "./onescience-docs"
import { forkPresetCase, presetCaseSessionAvailable, restoreSharedPresetCase } from "@/pages/onescience-case-api"
import { PrimitiveUseDialog } from "./onescience-primitive-use-dialog"
import { primitiveCategoryLabel, primitivePage, primitiveTypeFilters } from "./onescience-primitives"
import { PrimitiveCreateDialog, type PrimitiveResourcePage, type PrimitiveSourceHint } from "@/components/onescience/PrimitiveCreateDialog"
import { TaskCreateDialog } from "@/components/onescience/TaskCreateDialog"
import { appInstallPrompt, appInstallPromptTemplate } from "./app-install"
import { skillDevelopHandoff } from "./skill-develop"
import { SkillDetailDialog } from "./onescience-skill-detail-dialog"
import { formatOneSkillsUpgradeError, upgradeOneSkills } from "./onescience-skill-management"
import {
  datasetDownloadPrompt,
  datasetDownloadPromptTemplate,
  getScientificResearchModel,
  modelDevelopPrompt,
  modelDevelopPromptTemplate,
  prepareModelScopeSession,
  scientificResearchPrompt,
  scientificResearchScenarioGroups,
  type ModelDevelopType,
} from "./model-develop"
import {
  resolveRuntimeEnvironmentSnapshot,
  runtimeEnvironmentRevision,
  sessionCondaEnvFor,
  type RuntimeEnvironment,
} from "@/components/onescience/runtime-environment"
import { RuntimeEnvironmentSelect } from "@/components/onescience/RuntimeEnvironmentSelect"
import { useOpenSshTargetMap } from "@/components/onescience/use-registered-ssh-connectivity"
import { listRegisteredSshTargets, type SshTargetOption } from "@/components/onescience/execution-location"
import { pathKey } from "@/utils/path-key"
import { useQueryClient } from "@tanstack/solid-query"
import { modelScopeDatasetId, modelScopeDatasetPageUrl, modelScopeDatasetRelativePath, modelScopeDatasetDownloadMethod, modelScopeModelDownloadMethod, modelScopeModelId } from "./modelscope-catalog"
import {
  cancelModelScopeDatasetDownload,
  deleteModelScopeDatasetDownload,
  downloadRecordKey,
  downloadRecordKeyOf,
  fetchModelScopeDownloadDiskSpace,
  fetchModelScopeDownloadPreflight,
  formatDownloadBytes,
  listDatasetDownloadCopies,
  datasetDownloadCopyPaths,
  listModelScopeDownloads,
  selectDatasetProgressRecord,
  startModelScopeDatasetDownload,
  type ModelScopeDownloadEnvironment,
  type ModelScopeDownloadPreflight,
  type ModelScopeDownloadRecord,
  type ModelScopeDownloadStartEnvironment,
} from "./modelscope-download-client"
import type { AIPrimitiveItem, AIPrimitivePageResult, AIPrimitiveStatus } from "./onescience-primitives-types"
import {
  createAIPrimitive,
  fetchCallablePrimitiveTotal,
  filterAIPrimitiveItems,
  searchPrimitivesViaCatalog,
  listAIPrimitivesExperimental,
  loadAllAIPrimitives,
  listAIPrimitivesFromDatabase,
  lookupPrimitiveByResource,
  lookupPrimitivesByResources,
  readCachedPrimitiveResourceLookups,
  invalidatePrimitiveResourceLookupCacheEntry,
  invalidatePrimitiveResourceLookupCache,
  invalidatePrimitiveCatalogCaches,
  mapPrimitiveResourceLink,
  enrichPrimitiveItemFromCatalog,
  fetchUserUploadedResourceIds,
  filterPrimitivesByCatalogScope,
  isUserCreatedPrimitiveId,
  isPresetCatalogPrimitive,
  mergePublishedPrimitiveLink,
  resourcePrimitivePublishAction,
  resourcePrimitiveSlotsPublished,
  listCatalogSkills,
  skillSystemGroups,
  skillGroupIdFromTitle,
  type PrimitivePublishSlot,
  primitiveCatalogHref,
  primitiveCatalogScopeFilters,
  primitiveCategoryFilterOptions,
  shouldShowPrimitiveCategoryBar,
  readCallableCatalogCache,
  writeCallableCatalogCache,
  primitiveCategoryFromItem,
  updateAIPrimitive,
  type PrimitiveCatalogScope,
  type PrimitiveResourceLink,
} from "./onescience-catalog"
import { factoryDraftResourcePage, factoryStageHint, isFactoryQueueItemVisible, publishSlotFromPrimitiveType, resourceCardIdFromResourceId } from "./onescience-primitive-prefill"
import {
  fetchCatalogMetrics,
  fetchResourceCustomCounts,
  invalidateCatalogMetricsCache,
  readCatalogMetricsCache,
  storeCatalogMetricsCache,
  type CatalogMetrics,
  type ResourceCustomCounts,
} from "./catalog-metrics-client"

export type { AIPrimitiveItem, AIPrimitivePageResult, AIPrimitiveStatus } from "./onescience-primitives-types"
export {
  fetchCatalogMetrics,
  fetchResourceCustomCounts,
  invalidateCatalogMetricsCache,
  readCatalogMetricsCache,
} from "./catalog-metrics-client"
export type { CatalogMetrics, ResourceCustomCounts } from "./catalog-metrics-client"
export { createAIPrimitive, fetchCallablePrimitiveTotal, fetchUserUploadedResourceIds, filterAIPrimitiveItems, filterPrimitivesByCatalogScope, invalidatePrimitiveCatalogCaches, listAIPrimitivesExperimental, loadAllAIPrimitives, listAIPrimitivesFromDatabase, listCatalogSkills, lookupPrimitiveByResource, lookupPrimitivesByResources, primitiveCatalogHref, publishAIPrimitive, readCallableCatalogCache, resolveCatalogEntry, searchCatalogEntries, searchPrimitivesViaCatalog, updateAIPrimitive, writeCallableCatalogCache } from "./onescience-catalog"

type WorkspaceIconName =
  | "home"
  | "code"
  | "tasks"
  | "data-management"
  | "skills"
  | "primitives"
  | "database"
  | "model"
  | "apps"
  | "framework"
  | "operator"
  | "cases"
  | "docs"
  | "settings"
  | "users"

type WorkspaceNavLeaf = { label: string; href: string; icon: WorkspaceIconName }
type WorkspaceNavItem = WorkspaceNavLeaf | { label: string; icon: WorkspaceIconName; items: readonly WorkspaceNavLeaf[] }

function WorkspaceNavIcon(props: { name: WorkspaceIconName }) {
  return (
    <svg class="os-sidebar-icon" viewBox="0 0 24 24" aria-hidden="true">
      <Show when={props.name === "home"}>
        <path d="M4.5 11.5 12 5l7.5 6.5" />
        <path d="M6.5 10.5V19h11v-8.5" />
        <path d="M10 19v-5h4v5" />
      </Show>
      <Show when={props.name === "code"}>
        <path d="m8.5 8-4 4 4 4" />
        <path d="m15.5 8 4 4-4 4" />
        <path d="m13.5 6-3 12" />
      </Show>
      <Show when={props.name === "tasks"}>
        <path d="M6 5.5h12" />
        <path d="M6 12h12" />
        <path d="M6 18.5h12" />
        <path d="M4 5.5h.01" />
        <path d="M4 12h.01" />
        <path d="M4 18.5h.01" />
      </Show>
      <Show when={props.name === "data-management"}>
        <path d="M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3Z" />
        <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
        <path d="M8 18.5h8" />
        <path d="M12 15v3.5" />
      </Show>
      <Show when={props.name === "skills"}>
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.5-3.5a5.8 5.8 0 0 1-7.6 7.6l-6.8 6.8a2.1 2.1 0 0 1-3-3l6.8-6.8a5.8 5.8 0 0 1 7.6-7.6z" />
      </Show>
      <Show when={props.name === "primitives"}>
        <path d="M6.5 6.5h4v4h-4z" />
        <path d="M13.5 6.5h4v4h-4z" />
        <path d="M6.5 13.5h4v4h-4z" />
        <path d="M13.5 13.5h4v4h-4z" />
        <path d="M10.5 8.5h3" />
        <path d="M8.5 10.5v3" />
        <path d="M15.5 10.5v3" />
        <path d="M10.5 15.5h3" />
      </Show>
      <Show when={props.name === "database"}>
        <path d="M5 7c0-2 3.1-3.5 7-3.5S19 5 19 7s-3.1 3.5-7 3.5S5 9 5 7Z" />
        <path d="M5 7v5c0 2 3.1 3.5 7 3.5S19 14 19 12V7" />
        <path d="M5 12v5c0 2 3.1 3.5 7 3.5s7-1.5 7-3.5v-5" />
      </Show>
      <Show when={props.name === "model"}>
        <path d="M7 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
        <path d="M17 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
        <path d="M17 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
        <path d="M7 8.5 17 15.5" />
        <path d="M9.5 6h5" />
      </Show>
      <Show when={props.name === "apps"}>
        <path d="M5 5h5v5H5z" />
        <path d="M14 5h5v5h-5z" />
        <path d="M5 14h5v5H5z" />
        <path d="M14 14h5v5h-5z" />
      </Show>
      <Show when={props.name === "framework"}>
        <path d="M6 7h12" />
        <path d="M8 12h8" />
        <path d="M10 17h4" />
      </Show>
      <Show when={props.name === "operator"}>
        <path d="M5 7h4" />
        <path d="M15 7h4" />
        <path d="M5 17h4" />
        <path d="M15 17h4" />
        <path d="M9 7c3 0 3 10 6 10" />
        <path d="M9 17c3 0 3-10 6-10" />
      </Show>
      <Show when={props.name === "cases"}>
        <path d="M6 4.5h12v15H6z" />
        <path d="M9 4.5v6l3-2 3 2v-6" />
        <path d="M9 14h6" />
        <path d="M9 17h4" />
      </Show>
      <Show when={props.name === "docs"}>
        <path d="M7 4h7l3 3v13H7z" />
        <path d="M14 4v4h4" />
        <path d="M10 12h5" />
        <path d="M10 16h5" />
      </Show>
      <Show when={props.name === "users"}>
        <path d="M8 10.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
        <path d="M16.5 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
        <path d="M3.5 19c.6-3.2 2.2-5 4.5-5s3.9 1.8 4.5 5" />
        <path d="M13.5 18.5c.4-2.4 1.5-3.8 3-3.8 1.7 0 2.8 1.4 3.3 3.8" />
      </Show>
      <Show when={props.name === "settings"}>
        <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
        <path d="M12 3.5v2" />
        <path d="M12 18.5v2" />
        <path d="m5.6 5.6 1.4 1.4" />
        <path d="m17 17 1.4 1.4" />
        <path d="M3.5 12h2" />
        <path d="M18.5 12h2" />
        <path d="m5.6 18.4 1.4-1.4" />
        <path d="m17 7 1.4-1.4" />
      </Show>
    </svg>
  )
}

const productNav = [
  {
    label: "OneModel",
    eyebrow: "Scientific Models",
    copy: "覆盖气象、生信、材料、流体等领域的科研基座模型，安装后可直接进入对话工作台使用。",
    items: [
      { title: "全部模型", copy: "跨领域预训练与科研基座模型总览", href: workspaceCapabilitiesCategoryHref("onemodel") },
      { title: "材料化学", copy: "MACE、DeePMD、MatRIS 等材料与分子模拟模型", href: workspaceCapabilitiesCategoryHref("onemodel", "materials") },
      { title: "地球科学", copy: "FuXi、GraphCast、FourCastNet 等气象预报模型", href: workspaceCapabilitiesCategoryHref("onemodel", "weather") },
      { title: "生命科学", copy: "蛋白结构、序列设计与生信基础模型", href: workspaceCapabilitiesCategoryHref("onemodel", "bio") },
      { title: "流体仿真", copy: "CFD、PDE 神经算子与流场预测模型", href: workspaceCapabilitiesCategoryHref("onemodel", "fluid") },
    ],
  },
  {
    label: "OneData",
    eyebrow: "Scientific Data",
    copy: "沉淀可检索、可下载、可接入的科学数据，将领域数据转化为智能开发的先验知识。",
    items: [
      { title: "全部数据集", copy: "跨领域高质量科学数据集总览", href: workspaceCapabilitiesCategoryHref("onedata") },
      { title: "地球科学", copy: "ERA5、气象、遥感、海洋再分析数据", href: workspaceCapabilitiesCategoryHref("onedata") },
      { title: "材料化学", copy: "晶体、反应、ML 势函数与材料图谱", href: workspaceCapabilitiesCategoryHref("onedata") },
      { title: "生命科学", copy: "基因组、蛋白结构、药物对接与组学数据", href: workspaceCapabilitiesCategoryHref("onedata") },
      { title: "流体仿真", copy: "CFD、湍流、PDE 基准与流场样本", href: workspaceCapabilitiesCategoryHref("onedata") },
    ],
  },
  {
    label: "OneSkills",
    eyebrow: "Agent Skills",
    copy: "将数据、模型、组件、远程运行和评估过程组织成可编排的智能开发技能。",
    items: skillSystemGroups.map((group) => ({
      title: group.title,
      copy: group.copy,
      href: workspaceCapabilitiesCategoryHref("oneskills"),
    })),
  },
  {
    label: "案例",
    eyebrow: "Research Cases",
    copy: "面向真实科研任务的端到端场景化落地范例，覆盖数据准备、模型训练、评测验证与工程改造。",
    items: [
      { title: "全部案例", copy: "跨领域完整科研流程与可复现实践", href: workspaceHomeHref("open") },
      { title: "地球科学", copy: "天气预报模型训练、海气耦合搭建与并行训练改造", href: workspaceCaseDomainHref("earth") },
      { title: "材料化学", copy: "机器学习势函数训练、第一性原理计算与材料性质预测", href: workspaceCaseDomainHref("material") },
      { title: "生命科学", copy: "蛋白序列设计、语言模型微调与结构预测验证", href: workspaceCaseDomainHref("life") },
      { title: "流体仿真", copy: "CFD 基准训练、网格仿真推理与 PDE 神经算子评测", href: workspaceCaseDomainHref("fluid") },
    ],
  },
  {
    label: "文档&下载",
    eyebrow: "Docs and Downloads",
    copy: "用户手册、插件与镜像说明、版本发版记录。",
    items: [
      { title: "用户手册", copy: "平台使用、项目创建和工作流说明", href: workspaceDocsHref("manual") },
      { title: "插件与镜像说明", copy: "OneSkills 插件协议、运行环境镜像和扩展方式", href: workspaceDocsHref("plugins") },
      { title: "版本发版记录", copy: "v0.1.0 -> v0.3.0", href: workspaceDocsHref("release") },
    ],
  },
] as const

const oneScienceCommunityHref = "https://www.modelscope.cn/organization/OneScience"

const caseShowcases = [
  {
    tag: "Earth System",
    title: "海气融合模型小时级调试搭建",
    copy: "从 ERA5、海温场和大气变量出发，自动匹配数据读取、预处理脚本、模型配置和远程运行模板，快速完成可调试的海气耦合实验骨架。",
    result: "小时级形成可运行工作流",
    sessionId: "ses_173de5f78ffemATonCgBtx7ECA",
  },
  {
    tag: "Material Science",
    title: "材料数据快速接入 MACE 训练",
    copy: "将结构数据、标注格式、训练参数和 MACE 示例流程组织成可复用任务，减少材料体系从数据准备到首轮训练的工程成本。",
    result: "数据接入到训练脚本一体化",
    sessionId: "ses_09102687affe6WEyKzrDV0i5tJ",
  },
  {
    tag: "PDE Benchmark",
    title: "PDE 求解算法快速对比",
    copy: "围绕 FNO、DeepONet、PINNs 等算法沉淀统一数据接口、评估指标和运行环境，让同一物理问题可以快速切换模型并横向比较。",
    result: "统一评测口径与结果对比",
    sessionId: "ses_10bffedbbffeAnlewduYPOpjBz",
  },
  {
    tag: "Model Scaling",
    title: "科学模型一键参数扩展",
    copy: "基于已有模型配置、算力约束和训练日志，自动生成参数扩展方案、并行策略和任务提交脚本，支持科学模型从小规模验证走向大规模实验。",
    result: "扩展方案可追踪复用",
    sessionId: "ses_131e650f7ffejnFYPuWmd1TBPr",
  },
] as const

function defaultCodeWorkspaceDirectory() {
  return defaultPlatformProjectDirectory(storedPlatformAuthSession()) ?? configuredCodeDefaultDirectory()
}

function openSharedCaseSession(input: {
  sessionId: string
  navigate: ReturnType<typeof useNavigate>
  /** Prefetch shared-case sessions for the sidebar; must NOT open the shared root as a project. */
  ensureSessions?: (directory: string) => void
  serverUrl?: string
}): Promise<"opened" | "missing"> {
  const root = sharedCasesRoot(storedPlatformAuthSession())
  // Chat-only browse: do not switch the user's current project / workspace.
  input.ensureSessions?.(root)
  const run = async () => {
    if (input.serverUrl) {
      const available = await presetCaseSessionAvailable({
        serverUrl: input.serverUrl,
        sessionId: input.sessionId,
        directory: root,
      })
      if (!available) return "missing" as const
    }
    input.navigate(workspaceSessionHref(root, input.sessionId))
    return "opened" as const
  }
  return run()
}

function CaseShowcaseRow(props: { item: (typeof caseShowcases)[number]; index: number }) {
  // Home `/` is outside LayoutProvider — use Server/GlobalSync only.
  const server = useServer()
  const sync = useGlobalSync()
  const navigate = useNavigate()
  const [opening, setOpening] = createSignal(false)
  const [missingOpen, setMissingOpen] = createSignal(false)
  const openCase = async () => {
    if (opening()) return
    if (!server.current) {
      showToast({ variant: "error", title: "打开失败", description: "请先连接平台服务" })
      return
    }
    setOpening(true)
    try {
      const result = await openSharedCaseSession({
        sessionId: props.item.sessionId,
        serverUrl: server.current.http.url,
        navigate,
        ensureSessions: (directory) => {
          void sync.project.loadSessions(directory)
        },
      })
      if (result === "missing") setMissingOpen(true)
    } catch (cause) {
      showToast({
        variant: "error",
        title: "打开失败",
        description: cause instanceof Error ? cause.message : "案例打开失败",
      })
    } finally {
      setOpening(false)
    }
  }
  const restoreCase = async (sessionId: string) => {
    const current = server.current
    if (!current) throw new Error("恢复失败")
    const result = await restoreSharedPresetCase(current.http.url, sessionId)
    setMissingOpen(false)
    await openSharedCaseSession({
      sessionId: result.sessionId,
      serverUrl: current.http.url,
      navigate,
      ensureSessions: (directory) => {
        void sync.project.loadSessions(directory)
      },
    })
  }

  return (
    <>
      <button type="button" class="os-case-row" disabled={opening()} aria-busy={opening()} onClick={() => void openCase()}>
        <div class="os-case-index">{String(props.index + 1).padStart(2, "0")}</div>
        <div>
          <div class="os-case-tag">{props.item.tag}</div>
          <h3>{props.item.title}</h3>
          <p>{props.item.copy}</p>
        </div>
        <div class="os-case-result">{props.item.result}</div>
      </button>
      <Show when={missingOpen()}>
        <CaseMissingDialog
          title={props.item.title}
          sessionId={props.item.sessionId}
          onClose={() => setMissingOpen(false)}
          onRestore={(id) => restoreCase(id)}
        />
      </Show>
    </>
  )
}

const achievements = [
  {
    title: "多类机构",
    copy: "支持科研院所、高校与产业实验室开展 AI4S 应用建设",
    image: "/assets/onescience/platform-users.png",
  },
  {
    title: "模型构建",
    copy: "支撑科学模型训练、参数扩展、仿真评估与复现实验",
    image: "/assets/onescience/model-building.png",
  },
  {
    title: "智能化科研",
    copy: "推动智能体与大模型在数据接入、任务规划、代码生成和结果分析中的高效利用",
    image: "/assets/onescience/research-scenario.png",
  },
  {
    title: "持续共建",
    copy: "联合领域团队扩展知识资产、Skill 原语和科研工作流",
    image: "/assets/onescience/partner-network.png",
  },
] as const

const highlights = [
  ["降幻觉", "知识体系约束大模型语义", "/assets/onescience/knowledge-archive.png"],
  ["高稳定", "Skills体系规范智能体执行边界", "/assets/onescience/knowledge-flow.png"],
  ["可沉淀", "先验知识、后验知识构建知识体系", "/assets/onescience/agent-orchestrator.png"],
  ["降成本", "Mcp/cli化降低调用消耗", "/assets/onescience/reuse-loop.png"],
] as const

const communityItems = [
  ["科学模型研发构建", "共建 AI4S 模型、训练流程、评测基准与复现实验资产。"],
  ["国产模型生态建设", "沉淀国产模型适配、推理服务、工程组件和应用示例。"],
  ["数据组件技能共建", "共同扩展科研数据、算子组件、Skill 原语与工作流模板。"],
  ["贡献者支持", "对社区贡献者提供算力资源、模型服务和协作支持。"],
] as const

const communityChips = ["科学模型研发", "国产模型生态", "数据组件共建", "Skill 原语", "科研工作流", "算力与模型服务"]

const domainWorkbenches = [
  {
    title: "材料化学",
    copy: "分子模拟、晶体预测、反应计算",
    href: "https://www.scnet.cn/ui/aihub/models/easyscience2024/onescience-matchem-models",
    image: "/assets/onescience/workbench-materials-chemistry.png",
  },
  {
    title: "地球科学",
    copy: "气候模拟、地质分析、环境预测",
    href: "https://www.scnet.cn/ui/aihub/models/easyscience2024/OneScience-Earth-Model",
    image: "/assets/onescience/workbench-earth-science.png",
  },
  {
    title: "流体力学",
    copy: "CFD计算、湍流分析、多相流",
    href: "https://www.scnet.cn/ui/aihub/models/easyscience2024/OneScience-CFD-models",
    image: "/assets/onescience/workbench-fluid-dynamics.png",
  },
  {
    title: "生命科学",
    copy: "基因分析、蛋白预测、药物发现",
    href: "https://www.scnet.cn/ui/aihub/models/easyscience2024/OneScience-Bio-Al4S",
    image: "/assets/onescience/workbench-life-science.png",
  },
] as const

const workspaceHomeHubSections = [
  {
    title: "模型库",
    href: workspaceCapabilitiesCategoryHref("onemodel"),
    page: "models" as const,
    itemTitles: ["FuXi", "MACE", "SimpleFold", "Transolver-Airfoil-Design"],
  },
  {
    title: "数据集",
    href: workspaceCapabilitiesCategoryHref("onedata"),
    page: "datasets" as const,
    itemTitles: ["全球再分析", "Nanotube", "proteinmpnn", "CFDBench数据集"],
  },
  {
    title: "应用库",
    href: workspaceCapabilitiesCategoryHref("hpc"),
    page: "apps" as const,
    itemTitles: ["SPECFEM3D", "ABACUS", "AutoDock-GPU", "nekRS"],
  },
] as const

function findResourceItemByTitle(page: ResourceKey, title: string) {
  return resourcePages[page].items.find((item) => item.title === title)
}

const heroNodes = [
  [7, 74, 1.15],
  [16, 38, 0.78],
  [24, 25, 1],
  [32, 53, 1.28],
  [42, 18, 0.8],
  [51, 42, 1.12],
  [61, 21, 0.92],
  [70, 47, 1.24],
  [82, 31, 0.82],
  [91, 67, 1.1],
] as const

const heroLines = [
  [8, 74, 21, -34],
  [16, 39, 26, -12],
  [24, 27, 20, 36],
  [32, 53, 21, -40],
  [42, 19, 21, 20],
  [51, 43, 21, -32],
  [61, 22, 22, 36],
  [70, 48, 22, -31],
  [17, 38, 33, 22],
  [28, 56, 43, -19],
  [43, 18, 38, 12],
  [56, 46, 36, 25],
] as const

export const oneskillsGithubRepo = "https://github.com/onescience-ai/OneSkills"

export { skillSystemGroups } from "./onescience-catalog"

export const skillCapabilityFamilies = [
  { id: "resource.discovery", title: "资源理解与检索" },
  { id: "data.building", title: "数据与样本构建" },
  { id: "model.building", title: "模型构建与适配" },
  { id: "training", title: "训练与调参" },
  { id: "inference.evaluation", title: "推理评估与 Benchmark" },
  { id: "performance.optimization", title: "性能优化与工程化" },
  { id: "runtime.deployment", title: "运行环境与部署" },
  { id: "report.reproducibility", title: "科研报告与复现归档" },
] as const

const hiddenResourceTags = new Set([
  "地球科学",
  "生命科学",
  "其它",
  "其他",
  "材料科学",
  "材料化学",
  "流体仿真",
  "benchmarking",
  "foundation-model",
  "pretraining",
  "weather",
  "forecasting",
])

const hiddenDocsTags = new Set(["用户手册"])

const bioscienceDatasets = [
  dataset("life-pdb", "PDB结构库", "PDB：蛋白与复合物结构建模的核心公共结构库", ["生命科学", "protein", "structure", "mmcif", "pdb"], "RCSB PDB / wwPDB", "mmCIF/PDB", "mmCIF/PDB", "https://www.rcsb.org/downloads/"),
  dataset("life-uniref90", "UniRef90", "UniRef90：蛋白同源聚类序列库，常用于 MSA 搜索", ["生命科学", "protein", "sequence", "msa"], "UniProt", "FASTA", "FASTA", "https://ftp.uniprot.org/pub/databases/uniprot/uniref/uniref90/"),
  dataset("life-uniprot", "UniProt", "UniProt：通用蛋白知识库，支持多聚体与配对信息构建", ["生命科学", "protein", "sequence", "annotation"], "UniProt", "FASTA", "FASTA", "https://ftp.uniprot.org/pub/databases/uniprot/current_release/knowledgebase/complete/"),
  dataset("life-bfd", "BFD", "BFD：AlphaFold 系列常用的大规模蛋白序列数据库", ["生命科学", "protein", "msa", "sequence"], "MMseqs/Soding Lab", "FASTA", "FASTA", "https://bfd.mmseqs.com/"),
  dataset("life-mgnify", "MGnify", "MGnify：宏基因组蛋白序列资源，常用于 MSA 检索", ["生命科学", "metagenomics", "protein", "msa"], "EMBL-EBI", "FASTA", "FASTA", "https://ftp.ebi.ac.uk/pub/databases/metagenomics/peptide_database/2022_05/"),
  dataset("life-afdb-swissprot", "AFDB-SP", "AFDB SwissProt：AlphaFold DB 的 SwissProt 蒸馏结构子集", ["生命科学", "protein", "structure", "swissprot"], "AlphaFold DB / EMBL-EBI", "mmCIF/CSV", "mmCIF/CSV", "https://ml-site.cdn-apple.com/models/simplefold/swissprot_list.csv"),
  dataset("life-afesm", "AFESM", "AFESM：用于折叠训练的大规模蒸馏蛋白结构集合", ["生命科学", "protein", "structure", "simplefold"], "Foldseek / Apple", "mmCIF/CSV", "mmCIF/CSV", "https://ml-site.cdn-apple.com/models/simplefold/afesm_list.csv"),
  dataset("life-afesme", "AFESM-E", "AFESM-E：AFESM 的扩展聚类版本，用于大规模折叠训练", ["生命科学", "protein", "structure", "clustering"], "Foldseek / Apple", "JSON/mmCIF", "JSON/mmCIF", "https://ml-site.cdn-apple.com/models/simplefold/afesme_dict.json"),
  dataset("life-opengenome2", "OpenGenome2", "OpenGenome2：面向跨物种基因组建模的大规模序列数据集", ["生命科学", "genomics", "dna", "foundation_model"], "Arc Institute", "FASTA/JSON", "FASTA/JSON", "https://modelscope.cn/datasets/arcinstitute/opengenome2"),
  dataset("life-casp14", "CASP14", "CASP14：蛋白质结构预测标准评测集，用于折叠基准测试", ["生命科学", "protein", "structure", "benchmark"], "CASP / Apple", "mmCIF/ZIP", "mmCIF/ZIP", "https://ml-site.cdn-apple.com/models/simplefold/casp14_predictions.zip"),
  dataset("life-cameo22", "CAMEO22", "CAMEO22：持续更新型蛋白折叠评测基准的 2022 样本包", ["生命科学", "protein", "structure", "benchmark"], "CAMEO / Apple", "mmCIF/ZIP", "mmCIF/ZIP", "https://ml-site.cdn-apple.com/models/simplefold/cameo22_predictions.zip"),
  dataset("life-apo", "Apo", "Apo：双态蛋白 Apo 任务数据，用于构象切换评估", ["生命科学", "protein", "structure", "benchmark"], "Apple SimpleFold", "PDB/ZIP", "PDB/ZIP", "https://ml-site.cdn-apple.com/models/simplefold/apo_predictions.zip"),
  dataset("life-codnas", "CoDNaS", "CoDNaS：蛋白构象多样性数据，用于 fold-switch 评估", ["生命科学", "protein", "structure", "fold_switch"], "CoDNaS / Apple", "PDB/ZIP", "PDB/ZIP", "https://ml-site.cdn-apple.com/models/simplefold/codnas_predictions.zip"),
  dataset("life-protenix-release-data", "Protenix包", "Protenix Release Data：Protenix 训练与推理所需的预处理结构数据包", ["生命科学", "protein", "structure", "ligand"], "ByteDance AML AI4Science", "tar.gz/mmCIF", "tar.gz/mmCIF", "https://af3-dev.tos-cn-beijing.volces.com/release_data.tar.gz"),
  dataset("life-hg38-mm10-reference", "hg38/mm10", "hg38 / mm10 Reference Genome：AlphaGenome 推理与微调使用的人类和小鼠参考基因组", ["生命科学", "genomics", "dna", "reference_genome"], "Genome reference providers", "FASTA/FAI", "FASTA/FAI", "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/alphagenome/README.md"),
  dataset("life-ur50d-2021-04", "UR50D", "UR50/D 2021_04：ESM README 中使用的 UniRef 派生蛋白预训练语料划分", ["生命科学", "protein", "sequence", "language_model"], "Meta AI / UniProt", "FASTA", "FASTA", "https://github.com/facebookresearch/esm"),
  dataset("life-esm-structural-split", "ESM结构集", "ESMStructuralSplitDataset：ESM 系列用于结构预测评测与教程演示的结构划分数据集", ["生命科学", "protein", "structure", "esm"], "Meta AI", "Structure splits", "Structure splits", "https://github.com/facebookresearch/esm"),
  dataset("life-esm-metagenomic-atlas", "ESM Atlas", "ESM Metagenomic Atlas：包含数亿条预测蛋白结构与嵌入的宏基因组结构图谱", ["生命科学", "protein", "metagenomics", "atlas"], "Meta AI", "PDB/embeddings", "PDB/API", "https://esmatlas.com/"),
  dataset("life-tahoe-100m", "Tahoe-100M", "Tahoe-100M：1 亿细胞规模单细胞扰动数据集，用于虚拟细胞建模", ["生命科学", "single_cell", "perturbation", "transcriptomics"], "Tahoe / Arc Institute", "h5ad/AnnData", "h5ad/AnnData", "https://huggingface.co/datasets/tahoebio/Tahoe-100M"),
  dataset("life-scbasecount", "scBaseCount", "scBaseCount：Arc 统一处理的超大规模单细胞 RNA 测序基础数据仓", ["生命科学", "single_cell", "transcriptomics", "atlas"], "Arc Institute", "h5ad/AnnData", "h5ad/AnnData", "https://arcinstitute.org/news/news/arc-virtual-cell-atlas-launch"),
  dataset("life-replogle-nadig-perturbseq", "Replogle集", "Replogle-Nadig Perturb-seq：STATE 常用的单细胞基因扰动响应训练与评测数据集合", ["生命科学", "single_cell", "perturbation", "crispr"], "Perturb-seq community", "h5ad/count matrix", "h5ad/count matrix", "https://figshare.com/articles/dataset/_Mapping_information-rich_genotype-phenotype_landscapes_with_genome-scale_Perturb-seq_Replogle_et_al_2022_-_commonly_requested_supplemental_files/21632564"),
  dataset("life-virtual-cell-challenge-dataset", "VCell挑战", "Virtual Cell Challenge Dataset：Arc 虚拟细胞挑战赛的标准扰动响应评测数据集", ["生命科学", "virtual_cell", "challenge", "single_cell"], "Arc Institute", "h5ad/splits", "h5ad/splits", "https://zenodo.org/records/17342530"),
  dataset("life-pdbbind", "PDBbind", "PDBbind：蛋白-配体复合物与实验亲和力标注的经典对接数据集", ["生命科学", "protein_ligand", "docking", "affinity"], "PDBbind", "PDB/SDF", "PDB/SDF", "https://www.pdbbind-plus.org.cn/"),
  dataset("life-bindingmoad", "BindingMOAD", "BindingMOAD：高质量蛋白-配体复合物资源，DiffDock 等模型常用其处理版", ["生命科学", "protein_ligand", "docking", "structure"], "Binding MOAD", "PDB/complexes", "PDB/complexes", "https://github.com/gcorso/DiffDock"),
  dataset("life-dockgen", "DockGen", "DockGen：检验对接模型跨口袋泛化能力的蛋白-配体基准", ["生命科学", "protein_ligand", "docking", "generalization"], "DiffDock-L authors", "complexes", "complexes", "https://github.com/gcorso/DiffDock"),
  dataset("life-posebusters-benchmark", "PoseBusters", "PoseBusters Benchmark：面向生成与对接结果几何合理性的蛋白-配体评测集", ["生命科学", "protein_ligand", "docking", "geometry"], "PoseBusters authors", "complexes", "complexes", "https://github.com/maabuu/posebusters"),
  dataset("life-crossdocked2020", "CrossDocked", "CrossDocked2020：结构基药物设计常用的 cross-docking 训练数据集", ["生命科学", "protein_ligand", "cross_docking", "sbdd"], "CrossDocked2020 authors", "PDB/SDF/LMDB", "PDB/SDF/LMDB", "https://bits.csb.pitt.edu/files/crossdock2020/v1.1/"),
  dataset("life-casf-2016", "CASF-2016", "CASF-2016：蛋白-配体评分、排序与对接能力的经典评测基准", ["生命科学", "protein_ligand", "scoring", "ranking"], "PDBbind / CASF", "benchmark set", "benchmark set", "https://www.pdbbind-plus.org.cn/"),
  dataset("life-dekois2-dude-docking-poses", "DEKOIS+DUD", "DEKOIS2.0 and DUD-E Docking Poses：用于虚拟筛选与 pose 排序研究的对接姿态集合", ["生命科学", "protein_ligand", "virtual_screening", "docking"], "GenScore benchmark", "docking poses", "docking poses", "https://zenodo.org/records/6859325"),
  dataset("life-csar-nrc-hiq", "CSAR HiQ", "CSAR NRC-HiQ：面向高质量复合物评分与筛选的结构生物信息 benchmark", ["生命科学", "protein_ligand", "scoring", "affinity"], "CSAR", "benchmark set", "benchmark set", "http://www.csardock.org/"),
  dataset("life-merck-fep-benchmark", "Merck FEP", "Merck FEP Benchmark：面向亲和力建模与排序的药化自由能评测基准", ["生命科学", "affinity", "scoring", "medicinal_chemistry"], "Merck", "benchmark set", "benchmark set", "https://github.com/sc8668/GenScore"),
  dataset("life-pdbbind-crossdocked-core", "PDBbind-XD", "PDBbind-CrossDocked-Core：结合 PDBbind 与 cross-docking 场景的核心评测集", ["生命科学", "protein_ligand", "cross_docking", "scoring"], "GenScore benchmark", "benchmark set", "benchmark set", "https://zenodo.org/records/5525936"),
  dataset("life-mimic-cxr", "MIMIC-CXR", "MIMIC-CXR：大规模胸部 X 光影像与报告数据集，常用于医学多模态建模", ["生命科学", "xray", "radiology", "multimodal"], "PhysioNet / MIT", "DICOM/reports", "DICOM/reports", "https://physionet.org/content/mimic-cxr/2.1.0/"),
  dataset("life-slake-vqa", "SLAKE", "SLAKE：医学图像问答数据集，用于视觉问答与多模态推理", ["生命科学", "medical_vqa", "multimodal", "image"], "PolyU", "image/QA pairs", "image/QA pairs", "https://www.med-vqa.com/"),
  dataset("life-pad-ufes-20", "PAD-UFES", "PAD-UFES-20：皮肤病灶图像与临床信息数据集，适合皮肤科医学 AI", ["生命科学", "dermatology", "image", "classification"], "UFES", "image/metadata", "image/metadata", "https://developers.google.com/health-ai-developer-foundations/medgemma/model-card"),
  dataset("life-tcga", "TCGA", "TCGA：癌症基因组图谱资源，支持多组学与病理任务", ["生命科学", "oncology", "genomics", "pathology"], "NCI / NHGRI", "genomics/pathology", "clinical data", "https://portal.gdc.cancer.gov/"),
  dataset("life-camelyon", "CAMELYON", "CAMELYON：淋巴结病理切片转移检测标准数据集", ["生命科学", "pathology", "histopathology", "cancer"], "CAMELYON", "whole-slide images", "WSI", "https://camelyon17.grand-challenge.org/"),
  dataset("life-pmc-oa", "PMC-OA", "PMC-OA：PubMed Central 开放子集，包含大量生物医学文图内容", ["生命科学", "biomedical_literature", "multimodal", "documents"], "NLM / NCBI", "XML/PDF/images", "XML/PDF", "https://catalog.data.gov/dataset/pubmed-central-open-access-subset"),
]

export const resourcePages = {
  primitives: primitivePage,
  datasets: {
    eyebrow: "OneData",
    title: "公开数据集",
    count: "共 150 个高质量数据集：地球科学 50，材料化学 20，生命科学 47，流体仿真 33",
    search: "搜索数据集名称、描述或标签...",
    filters: ["全部", "地球科学", "材料化学", "生命科学", "流体仿真", "其它"],
    items: [
      dataset("earth-era5", "全球再分析", "ERA5：ECMWF 全球大气陆面再分析数据集", ["地球科学", "weather", "climate", "reanalysis", "global"], "ECMWF/C3S", "GRIB/NetCDF", "GRIB/NetCDF", "https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels"),
      dataset("earth-cmems", "海洋多层数据", "Copernicus Marine Service Global Ocean Physics：Copernicus 全球海洋多层物理再分析数据集", ["地球科学", "ocean", "reanalysis", "forecast", "global"], "CMEMS", "NetCDF/Zarr", "NetCDF/Zarr", "https://data.marine.copernicus.eu/product-detail/GLOBAL_MULTIYEAR_PHY_001_030"),
      dataset("earth-merra2", "NASA再分析", "MERRA-2：NASA 全球大气再分析数据集", ["地球科学", "weather", "climate", "reanalysis", "global"], "NASA", "NetCDF", "NetCDF", "https://gmao.gsfc.nasa.gov/gmao-products/merra-2/data-access_merra-2/"),
      dataset("earth-jra3q", "长期再分析", "JRA-3Q：JMA 全球长期大气再分析数据集", ["地球科学", "weather", "climate", "reanalysis", "global"], "JMA", "GRIB", "GRIB", "https://search.diasjp.net/en/dataset/JRA3Q"),
      dataset("earth-jra55", "日系再分析", "JRA-55：JMA 55 年全球大气再分析数据集", ["地球科学", "weather", "climate", "reanalysis", "global"], "JMA", "GRIB", "GRIB", "https://search.diasjp.net/en/dataset/JRA55"),
      dataset("earth-ncep-ncar-r1", "经典再分析", "NCEP/NCAR Reanalysis 1：NOAA 经典全球大气再分析数据集", ["地球科学", "weather", "climate", "reanalysis", "global"], "NOAA PSL", "NetCDF", "NetCDF", "https://psl.noaa.gov/data/gridded/data.ncep.reanalysis.html"),
      dataset("earth-gfs", "全球预报", "Global Forecast System：NOAA 全球业务天气预报数据集", ["地球科学", "weather", "forecast", "global"], "NOAA", "GRIB2", "GRIB2", "https://registry.opendata.aws/noaa-gfs-bdp-pds/"),
      dataset("earth-gefs", "集合预报", "Global Ensemble Forecast System：NOAA 全球集合天气预报数据集", ["地球科学", "weather", "forecast", "global"], "NOAA", "GRIB2", "GRIB2", "https://registry.opendata.aws/noaa-gefs/"),
      dataset("earth-hrrr", "区域高分预报", "High-Resolution Rapid Refresh：NOAA 美国区域高分辨率预报数据集", ["地球科学", "weather", "forecast", "regional"], "NOAA", "GRIB2", "GRIB2", "https://registry.opendata.aws/noaa-hrrr-pds/"),
      dataset("earth-ecmwf-open-data", "欧洲开放预报", "ECMWF Open Data：ECMWF 开放业务预报产品子集", ["地球科学", "weather", "forecast", "global"], "ECMWF", "GRIB2", "GRIB2", "https://data.ecmwf.int/forecasts/"),
      dataset("earth-cmip6", "气候情景", "Coupled Model Intercomparison Project Phase 6：全球气候模式比较计划数据集", ["地球科学", "climate", "projection", "global"], "WCRP", "NetCDF", "NetCDF", "https://esgf-node.llnl.gov/search/cmip6/"),
      dataset("earth-s2s", "次季节预报", "Subseasonal-to-Seasonal Prediction Database：多中心次季节到季节预测数据集", ["地球科学", "climate", "forecast", "global"], "WWRP/WCRP", "GRIB", "GRIB", "https://apps.ecmwf.int/datasets/data/s2s/"),
      dataset("earth-cfsv2", "季节预测", "Climate Forecast System Version 2：NOAA 海气陆耦合季节预测数据集", ["地球科学", "climate", "forecast", "global"], "NOAA", "GRIB2", "GRIB2", "https://nomads.ncep.noaa.gov/pub/data/nccf/com/cfs/prod/"),
      dataset("earth-oisst", "海表温度", "Optimum Interpolation Sea Surface Temperature：NOAA 全球海表温度融合数据集", ["地球科学", "ocean", "observation", "satellite", "global"], "NOAA", "NetCDF", "NetCDF", "https://www.ncei.noaa.gov/data/sea-surface-temperature-optimum-interpolation/"),
      dataset("earth-argo-gdac", "海洋剖面", "Argo GDAC：全球 Argo 海洋剖面观测数据集", ["地球科学", "ocean", "observation", "global"], "Argo", "NetCDF", "NetCDF", "https://data-argo.ifremer.fr/"),
      dataset("earth-wod", "海洋观测库", "World Ocean Database：NOAA 全球海洋原位观测数据库", ["地球科学", "ocean", "observation", "global"], "NOAA", "NetCDF", "NetCDF", "https://www.ncei.noaa.gov/products/world-ocean-database"),
      dataset("earth-hycom-gofs", "海洋预报", "HYCOM Global Ocean Forecast System：HYCOM 全球海洋分析与预报数据集", ["地球科学", "ocean", "forecast", "reanalysis", "global"], "HYCOM", "NetCDF", "NetCDF", "https://tds.hycom.org/thredds/catalog.html"),
      dataset("earth-gpm-imerg", "卫星降水", "Integrated Multi-satellitE Retrievals for GPM：NASA 全球多卫星降水反演数据集", ["地球科学", "precipitation", "satellite", "observation", "global"], "NASA/JAXA", "HDF5/NetCDF", "HDF5/NetCDF", "https://disc.gsfc.nasa.gov/datasets?keywords=IMERG"),
      dataset("earth-chirps", "陆地降水", "Climate Hazards InfraRed Precipitation with Station data：长时序全球陆地降水融合数据集", ["地球科学", "precipitation", "observation", "climate", "global"], "CHC", "GeoTIFF/NetCDF", "GeoTIFF/NetCDF", "https://data.chc.ucsb.edu/products/CHIRPS/v3.0/"),
      dataset("earth-gldas", "陆面同化", "Global Land Data Assimilation System：NASA 全球陆面同化数据集", ["地球科学", "land", "hydrology", "reanalysis", "global"], "NASA", "NetCDF/GeoTIFF/KMZ", "NetCDF/GeoTIFF/KMZ", "https://disc.gsfc.nasa.gov/datasets?keywords=GLDAS"),
      dataset("earth-smap", "土壤湿度", "Soil Moisture Active Passive：NASA 全球土壤湿度卫星观测数据集", ["地球科学", "land", "hydrology", "satellite", "observation"], "NASA/JPL", "HDF5/NetCDF", "HDF5/NetCDF", "https://podaac.jpl.nasa.gov/SMAP"),
      dataset("earth-grace-fo", "陆水储量", "GRACE/GRACE-FO Mascon：全球陆水储量与质量变化数据集", ["地球科学", "hydrology", "satellite", "observation", "global"], "NASA/JPL", "NetCDF", "NetCDF", "https://podaac.jpl.nasa.gov/GRACE-FO"),
      dataset("earth-nexrad-level2", "天气雷达", "NEXRAD Level II：NOAA 美国天气雷达基数据集", ["地球科学", "weather", "radar", "observation", "regional"], "NOAA", "Archive-II", "Archive-II", "https://github.com/awslabs/open-data-docs/tree/main/docs/noaa/noaa-nexrad"),
      dataset("earth-mrms", "雷达融合", "Multi-Radar Multi-Sensor System：NOAA 多雷达多传感器融合数据集", ["地球科学", "precipitation", "radar", "observation", "regional"], "NOAA", "GRIB2", "GRIB2", "https://mrms.ncep.noaa.gov/data/"),
      dataset("earth-goes-abi", "静止卫星", "GOES-R Advanced Baseline Imager：NOAA 静止气象卫星多通道观测数据集", ["地球科学", "weather", "satellite", "remote-sensing", "observation"], "NOAA/NASA", "NetCDF", "NetCDF", "https://registry.opendata.aws/noaa-goes/"),
      dataset("earth-himawari-ahi", "亚太卫星", "Himawari Advanced Himawari Imager：JMA 亚太静止气象卫星观测数据集", ["地球科学", "weather", "satellite", "remote-sensing", "observation"], "JMA", "HSD/NetCDF", "HSD/NetCDF", "https://www.eorc.jaxa.jp/ptree/"),
      dataset("earth-modis", "MODIS 多光谱遥感", "Moderate Resolution Imaging Spectroradiometer：NASA 多光谱地球观测遥感数据集", ["地球科学", "remote-sensing", "satellite", "land", "ocean"], "NASA", "HDF/NetCDF", "HDF/NetCDF", "https://search.earthdata.nasa.gov/search"),
      dataset("earth-landsat-c2", "陆表遥感", "Landsat Collection 2：USGS Landsat 全球陆表遥感数据集", ["地球科学", "remote-sensing", "satellite", "land", "observation"], "USGS/NASA", "GeoTIFF/COG", "GeoTIFF/COG", "https://www.usgs.gov/data/landsat-89-long-term-acquisition-plan-earths-continental-landmasses-and-near-shore-coastal"),
      dataset("earth-noaa-20cr", "百年再分析", "NOAA-CIRES-DOE 20th Century Reanalysis：NOAA 长时段全球大气再分析数据集", ["地球科学", "climate", "reanalysis", "global"], "NOAA", "NetCDF", "NetCDF", "https://psl.noaa.gov/data/gridded/reanalysis/"),
      dataset("earth-cerra", "欧洲区域再分析", "Copernicus European Regional Reanalysis：Copernicus 欧洲高分辨率区域再分析数据集", ["地球科学", "weather", "reanalysis", "regional"], "C3S", "GRIB/NetCDF", "GRIB/NetCDF", "https://cds.climate.copernicus.eu/datasets/reanalysis-cerra-single-levels"),
      dataset("earth-cams-global-atmosphere", "大气成分预报", "CAMS Global Atmospheric Composition Forecasts：Copernicus 全球气溶胶与化学成分预报数据集", ["地球科学", "atmosphere", "forecast", "air-quality", "global"], "ECMWF/CAMS", "GRIB/NetCDF", "GRIB/NetCDF", "https://ads.atmosphere.copernicus.eu/datasets/cams-global-atmospheric-composition-forecasts"),
      dataset("earth-cfsr", "耦合再分析", "Climate Forecast System Reanalysis：NOAA 海气陆冰耦合气候再分析数据集", ["地球科学", "climate", "reanalysis", "forecast", "global"], "NOAA", "GRIB2", "GRIB2", "https://www.ncei.noaa.gov/products/weather-climate-models/climate-forecast-system"),
      dataset("earth-nam", "北美中尺度", "North American Mesoscale Forecast System：NOAA 北美中尺度业务天气预报数据集", ["地球科学", "weather", "forecast", "regional"], "NOAA", "GRIB2", "GRIB2", "https://www.nco.ncep.noaa.gov/pmb/products/nam/"),
      dataset("earth-rap", "快速更新预报", "Rapid Refresh：NOAA 北美逐小时快速更新分析预报数据集", ["地球科学", "weather", "forecast", "regional"], "NOAA", "GRIB2", "GRIB2", "https://www.ncei.noaa.gov/products/weather-climate-models/rapid-refresh-update"),
      dataset("earth-mur-sst", "高分海温", "Multi-scale Ultra-high Resolution Sea Surface Temperature：NASA JPL 全球高分辨率海表温度数据集", ["地球科学", "ocean", "satellite", "observation", "global"], "NASA/JPL", "NetCDF", "NetCDF", "https://podaac.jpl.nasa.gov/dataset/MUR-JPL-L4-GLOB-v4.1"),
      dataset("earth-esa-sst-cci", "海温气候记录", "ESA Sea Surface Temperature CCI：ESA CCI 长时序海表温度气候数据记录", ["地球科学", "ocean", "satellite", "climate", "global"], "ESA CCI", "NetCDF", "NetCDF", "https://climate.esa.int/en/projects/sea-surface-temperature/data/"),
      dataset("earth-hadisst", "历史海冰海温", "Hadley Centre Sea Ice and Sea Surface Temperature：Met Office 全球海冰与海表温度观测数据集", ["地球科学", "ocean", "climate", "observation", "global"], "Met Office", "NetCDF", "NetCDF", "https://www.metoffice.gov.uk/hadobs/hadisst/data/download.html"),
      dataset("earth-sea-ice-cdr", "海冰浓度", "NOAA/NSIDC Passive Microwave Sea Ice Concentration CDR：NOAA NSIDC 被动微波海冰浓度气候记录", ["地球科学", "cryosphere", "satellite", "climate", "global"], "NOAA/NSIDC", "NetCDF", "NetCDF", "https://nsidc.org/data/g02202"),
      dataset("earth-ghcn-daily", "全球站点日值", "Global Historical Climatology Network Daily：NOAA 全球气象站逐日观测数据集", ["地球科学", "climate", "observation", "station", "global"], "NOAA", "CSV/TXT", "CSV/TXT", "https://www.ncei.noaa.gov/pub/data/ghcn/daily/"),
      dataset("earth-hadisd", "全球站点小时值", "HadISD：Met Office 全球质量控制逐小时站点观测数据集", ["地球科学", "climate", "observation", "station", "global"], "Met Office", "NetCDF", "NetCDF", "https://hadobs.metoffice.gov.uk/hadisd/data/download.html"),
      dataset("earth-gistemp", "全球温度指数", "GISS Surface Temperature Analysis：NASA 全球地表温度异常分析数据集", ["地球科学", "climate", "observation", "global"], "NASA", "CSV/NetCDF", "CSV/NetCDF", "https://data.giss.nasa.gov/gistemp/"),
      dataset("earth-berkeley-earth", "地表温度", "Berkeley Earth Surface Temperature：Berkeley Earth 全球地表温度数据集", ["地球科学", "climate", "observation", "global"], "Berkeley Earth", "TXT/NetCDF", "TXT/NetCDF", "https://berkeleyearth.org/data/"),
      dataset("earth-cmorph-cdr", "卫星降水CDR", "CMORPH Climate Data Record：NOAA 全球高分辨率卫星降水气候记录", ["地球科学", "precipitation", "satellite", "climate", "global"], "NOAA", "NetCDF", "NetCDF", "https://www.ncei.noaa.gov/products/climate-data-records/precipitation-cmorph"),
      dataset("earth-gsmap", "全球降水图", "Global Satellite Mapping of Precipitation：JAXA 全球卫星降水估计数据集", ["地球科学", "precipitation", "satellite", "observation", "global"], "JAXA", "NetCDF/Binary", "NetCDF/Binary", "https://sharaku.eorc.jaxa.jp/GSMaP/"),
      dataset("earth-persiann-cdr", "神经网络降水", "PERSIANN-CDR：CHRS NOAA 全球卫星降水气候记录数据集", ["地球科学", "precipitation", "satellite", "climate", "global"], "CHRS/NOAA", "NetCDF", "NetCDF", "https://chrsdata.eng.uci.edu/"),
      dataset("earth-cpc-unified-precip", "雨量站降水", "CPC Global Unified Gauge-Based Analysis of Daily Precipitation：NOAA CPC 全球逐日雨量站融合降水数据集", ["地球科学", "precipitation", "observation", "station", "global"], "NOAA", "NetCDF", "NetCDF", "https://psl.noaa.gov/data/gridded/data.cpc.globalprecip.html"),
      dataset("earth-sentinel1", "雷达遥感", "Sentinel-1：Copernicus C 波段合成孔径雷达观测数据集", ["地球科学", "remote-sensing", "satellite", "radar", "observation"], "ESA", "SAFE/GeoTIFF", "SAFE/GeoTIFF", "https://browser.dataspace.copernicus.eu/"),
      dataset("earth-sentinel2", "Sentinel-2 多光谱遥感", "Sentinel-2：Copernicus 高分辨率多光谱陆表观测数据集", ["地球科学", "remote-sensing", "satellite", "land", "observation"], "ESA", "SAFE/JP2", "SAFE/JP2", "https://browser.dataspace.copernicus.eu/"),
      dataset("earth-sentinel3", "海陆卫星", "Sentinel-3：Copernicus 海洋陆地温度色度高度观测数据集", ["地球科学", "remote-sensing", "satellite", "ocean", "land"], "ESA", "NetCDF/SEN3", "NetCDF/SEN3", "https://browser.dataspace.copernicus.eu/"),
      dataset("earth-sentinel5p", "大气污染卫星", "Sentinel-5P：Copernicus TROPOMI 大气成分遥感数据集", ["地球科学", "atmosphere", "satellite", "remote-sensing", "air-quality"], "ESA", "NetCDF", "NetCDF", "https://browser.dataspace.copernicus.eu/"),
      ...bioscienceDatasets,
      dataset("fluid-pdebench", "PDEBench基准", "涵盖广泛偏微分方程的科学机器学习基准集", ["流体仿真", "pde", "sciml", "benchmark"], "PDEBench Team", "PDEBench", "HDF5", "https://darus.uni-stuttgart.de/dataset.xhtml?persistentId=doi:10.18419/darus-2986"),
      dataset("fluid-cfdbench", "CFDBench数据集", "CFDBench：包含多样化边界条件与几何形状的 CFD 基准", ["流体仿真", "cfd", "incompressible-flow", "surrogate-modeling"], "Tsinghua University", "CFDBench", "Numpy (.npy)", "https://huggingface.co/datasets/chen-yingfa/CFDBench"),
      dataset("fluid-rpb-cno", "RPB 数据集", "面向神经算子与科学机器学习的二维 PDE 基准数据集，涵盖 Poisson、Wave、Navier-Stokes、Darcy、Transport 等多类方程", ["流体仿真", "cfd", "representative-pde-benchmarks", "neural-operators"], "ETH Zurich / CAMLab 等研究机构", "h5", "h5"),
      dataset("fluid-fno", "FNO 数据集", "一组通过高精度数值求解器生成的参数化偏微分方程模拟数据，涵盖 Burgers、Darcy Flow 和 Navier-Stokes 等典型任务", ["流体仿真", "cfd", "neural-operator", "pde"], "加利福尼亚理工学院 (California Institute of Technology)", "mat", "mat"),
      dataset("fluid-pointnet-cfd", "PointNetCFD 数据集", "二维非结构网格 CFD 数据集，用于基于点云直接预测不规则几何绕流场中的速度与压力分布", ["流体仿真", "cfd", "point-cloud", "unstructured-mesh"], "Stanford University", "npy", "npy"),
      dataset("fluid-beno", "BENO数据集", "BENO：求解二维 Poisson/椭圆 PDE 边值问题的仿真数据集", ["流体仿真", "cfd", "2d", "poisson", "elliptic-pde"], "OneScience", "Numpy (.npy)", "Numpy (.npy)"),
      dataset("fluid-deepcfd", "DeepCFD基准", "DeepCFD：二维稳态层流 CFD 数据集", ["流体仿真", "cfd", "2d", "steady-laminar-flow", "navier-stokes"], "OneScience", "Python Pickle (.pkl)", "Python Pickle (.pkl)"),
      dataset("fluid-pdenneval", "PDENNEval数据集", "PDENNEval：多物理场 PDE 基准数据集，覆盖流体、材料、金融和电磁等领域的 19 个 PDE 问题", ["流体仿真", "pde-benchmark", "sciml", "multi-physics"], "OneScience", "HDF5 (.h5)", "HDF5 (.h5)"),
      dataset("fluid-pdearena", "PDEArena代理", "现代且可扩展的PDE代理模型分布式基准", ["流体仿真", "fluid-mechanics", "electrodynamics", "distributed-training"], "Microsoft Research", "PDEArena", "HDF5", "https://huggingface.co/pdearena/datasets"),
      dataset("fluid-blastnet", "BLASTNet库", "高保真可压缩反应流与湍流3D超分数据集", ["流体仿真", "combustion", "turbulence", "3d-super-resolution"], "Stanford University", "BLASTNet", "JSON / Binary", "https://blastnet.github.io/datasets"),
      dataset("fluid-jhtdb", "霍普金斯湍流库", "提供TB级各向同性湍流及通道流DNS查询", ["流体仿真", "turbulence", "dns", "virtual-sensors"], "Johns Hopkins University", "Johns Hopkins Turbulence Databases", "Web-service Queries", "https://turbulence.idies.jhu.edu/home"),
      dataset("fluid-deepmind-l2s", "DeepMind粒子数据集", "DeepMind Learning-to-Simulate：用于 GNN 学习复杂粒子物理与流体动力学", ["流体仿真", "particle-simulation", "gnn", "lagrangian"], "DeepMind", "DeepMind Learning-to-Simulate", "TFRecord / Pickle", "https://github.com/deepmind/deepmind-research/tree/master/learning_to_simulate"),
      dataset("fluid-deepmind-cylinder-flow", "DeepMind圆柱绕流数据集", "DeepMind 圆柱绕流涡脱落网格时序数据集，适用于 MeshGraphNet 等 GNN 训练", ["流体仿真", "cylinder-flow", "gnn", "deepmind", "vortex-shedding"], "OneScience", "TFRecord", "TFRecord"),
      dataset("fluid-meshgraphnets", "MeshGraph", "基于网格的流体与结构物理模拟GNN数据集", ["流体仿真", "mesh-simulation", "cfd", "gnn"], "DeepMind", "MeshGraphNets Datasets", "TFRecord", "https://github.com/wwMark/meshgraphnets/blob/main/meshgraphnets/download_dataset.sh"),
      dataset("fluid-fda-blood-flow", "FDA血液流体力学", "医疗器械中血液流动的非牛顿流体力学基准", ["流体仿真", "hemodynamics", "non-newtonian", "biomedical"], "FDA (CDRH)", "FDA CFD Blood Flow Benchmark", "CFD Simulation", "https://github.com/OSEL-DAM/CFD-and-Blood-Damage-Benchmarks"),
      dataset("fluid-nasa-tmr", "NASA湍流验证", "广泛使用的RANS湍流模型验证与网格收敛库", ["流体仿真", "rans", "turbulence", "verification"], "NASA & AIAA TMBWG", "NASA Turbulence Modeling Resource", "Data (.dat) / Plot3D", "https://github.com/TMBWG/turbmodels"),
      dataset("fluid-spdebench", "SPDEBench", "涵盖常规与奇异随机偏微分方程的统一数据", ["流体仿真", "spde", "stochastic", "mathematical-physics"], "UCL Rough Path and Machine Learning Group", "SPDEBench", "Parquet", "https://huggingface.co/datasets/SSPDEBench/Reuglar_and_Singular_SPDEBench"),
      dataset("fluid-realpdebench", "RealPDE基准", "整合真实物理测量与匹配数值仿真的基准集", ["流体仿真", "sim-to-real", "real-world-data", "fluid-structure"], "AI4Science-WestlakeU", "RealPDEBench", "HDF5", "https://huggingface.co/datasets/AI4Science-WestlakeU/RealPDEBench"),
      dataset("fluid-drivaernet", "汽车气动CFD", "超8150个高保真3D汽车空气动力学仿真集", ["流体仿真", "cfd", "automotive", "3d-geometry"], "Mohamed Elrefaie et al.", "DrivAerNet++", "3D Meshes / CFD arrays", "https://dataverse.harvard.edu/dataverse/DrivAerNet"),
      dataset("fluid-drivaerml", "DrivAerML", "首个包含500个参数化汽车变体的高保真CFD外部空气动力学大型数据集", ["流体仿真", "cfd", "automotive", "high-fidelity"], "Ashton et al.", "DrivAerML", "VTU / VTP / CSV", "https://huggingface.co/datasets/neashton/drivaerml"),
      dataset("fluid-eagle-dataset", "Eagle数据集", "用于学习非恒定湍流动力学的大规模数据集", ["流体仿真", "turbulent-flow", "mesh-transformers", "non-steady"], "INSA Lyon / Naver Labs", "EAGLE", "Mesh / Graph", "https://dataset-dl.liris.cnrs.fr/eagle_dataset/"),
      dataset("fluid-shapenet-car", "Shape-Net Car", "Shape-Net Car：基于 ShapeNet 汽车模型的 3D 空气动力学流场", ["流体仿真", "car-aerodynamics", "3d-geometry", "cfd"], "IST Austria / Autodesk", "ShapeNet-Car CFD", "Zip / Mesh", "http://www.nobuyuki-umetani.com/publication/mlcfd_data.zip"),
      dataset("fluid-airfrans", "AirfRANS", "二维不可压缩稳态RANS翼型空气动力学数据集", ["流体仿真", "airfoil", "rans", "incompressible-flow"], "Sorbonne Universite / Extrality", "AirfRANS", "OpenFOAM / PyVista", "https://data.isir.upmc.fr/extrality/NeurIPS_2022/Dataset.zip"),
      dataset("fluid-geo-fno", "Geo-FNO基准", "评估不规则几何和拓扑变化下的偏微分方程算子", ["流体仿真", "irregular-geometries", "fno", "mesh-deformation"], "Caltech (Zongyi Li et al.)", "Geo-FNO Datasets", "NumPy / Mat", "https://drive.google.com/drive/folders/1YBuaoTdOSr_qzaow-G-iwvbUI7fiUzu8"),
      dataset("fluid-bubbleml", "BubbleML", "包含沸腾过程的多相多物理场流体动力学机器学习数据", ["流体仿真", "boiling", "multiphase-flow", "thermodynamics"], "HPCForge", "BubbleML", "HDF5", "https://doi.org/10.5281/zenodo.8039786"),
      dataset("fluid-rae2822-airfoil", "RAE2822翼型", "RAE2822跨音速翼型的大规模气动高保真模拟", ["流体仿真", "transonic-flow", "airfoil", "cvae"], "Giovanni Catalani et al.", "RAE2822 Airfoil Dataset", "NumPy (.npy)", "https://zenodo.org/records/12700680"),
      dataset("fluid-cfdoneval", "CFDNNEval模型评估集", "22个流体基准问题的综合评估数据集", ["流体仿真", "neural-operator", "benchmark", "darcy-flow", "multiphase"], "中山大学、IJCAI", "CFDNNEval", "HDF5 / NPZ", "https://drive.google.com/drive/folders/1Ao9vfWjy1VTwTa-9N1axZlXlz1s6CjPW"),
      dataset("fluid-kolmogorov-flow-dns", "Kolmogorov流DNS", "三维Kolmogorov流直接数值模拟数据集", ["流体仿真", "dns", "kolmogorov-flow", "nek5000", "ml-ready"], "Nature Scientific Data", "Kolmogorov-Flow-DNS", "VTK / Python", "https://zenodo.org/records/16733422"),
      dataset("fluid-parameterized-u-bend", "U型管道流数据集", "万组U型管流动与换热CFD仿真", ["流体仿真", "heat-transfer", "shape-optimization", "openfoam", "design-parameters"], "卡塞尔大学", "Parameterized-U-Bend", "CSV / OpenFOAM", "https://daks.uni-kassel.de/handle/123456789/50"),
      dataset("fluid-blendednet", "BlendedNet", "包含999个翼身融合飞行器(BWB)的高保真气动数据集", ["流体仿真", "cfd", "blended-wing-body", "surrogate-modeling"], "MIT DeCoDE Lab & Lincoln Lab", "BlendedNet", "RANS CFD / Point Cloud", "https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/VJT9EP"),
      dataset("fluid-naca0012-compressible", "NACA0012可压缩流", "NACA0012翼型可压缩RANS数据集", ["流体仿真", "compressible-flow", "naca0012", "su2", "graph-neural-network"], "Mendeley Data / JCP", "NACA0012-Compressible", "CSV / NPZ", "https://data.mendeley.com/datasets/g3x4phfr3r/2"),
      dataset("material-mptrj", "MPtrj", "Materials Project DFT 弛豫轨迹数据集", ["材料化学", "dft", "relaxation-trajectory", "inorganic", "mlff"], "LBNL / CHGNet team", "MPtrj", "extxyz / json", "https://figshare.com/articles/dataset/Materials_Project_Trjectory_MPtrj_Dataset/23713842"),
      dataset("material-salex", "sAlex", "FAIR 重打包的 Alexandria 子集，PBE 参考", ["材料化学", "dft", "inorganic", "alexandria", "mlff"], "Alexandria DB / Schmidt et al.", "sAlex", "aselmdb", "https://huggingface.co/datasets/facebook/OMAT24"),
      dataset("material-omat24", "OMat24", "Meta FAIR 无机材料大规模 PBE 数据集", ["材料化学", "dft", "inorganic", "foundation-data", "fair-chem"], "Meta FAIR", "OMat24", "aselmdb", "https://huggingface.co/datasets/facebook/OMAT24"),
      dataset("material-omol25", "OMol25", "Meta FAIR 大规模有机分子 ωB97M-V 数据集", ["材料化学", "dft", "molecular", "foundation-data", "fair-chem"], "Meta FAIR", "OMol25", "aselmdb", "https://huggingface.co/datasets/facebook/OMol25"),
      dataset("material-oc20", "OC20", "Open Catalyst 2020，催化吸附构型数据集", ["材料化学", "dft", "catalysis", "adsorption", "fair-chem"], "Meta FAIR / CMU", "OC20", "lmdb / aselmdb", "https://github.com/facebookresearch/fairchem/blob/main/docs/catalysts/datasets/oc20.md"),
      dataset("material-alexandria", "Alexandria", "高通量无机晶体 DFT 数据库", ["材料化学", "dft", "inorganic", "high-throughput", "crystal"], "Schmidt et al. / RUB ICAMS", "Alexandria", "json / cif", "https://alexandria.icams.rub.de/data/pbe/"),
      dataset("material-oc22", "OC22", "Open Catalyst 2022，氧化物催化剂数据集", ["材料化学", "dft", "catalysis", "oxide", "fair-chem"], "Meta FAIR / CMU", "OC22", "lmdb / aselmdb", "https://github.com/facebookresearch/fairchem/blob/main/docs/catalysts/datasets/oc22.md"),
      dataset("material-md22", "MD22", "大分子有机体系 MD 轨迹基准数据集", ["材料化学", "md", "molecular", "benchmark", "mlff"], "sGDML team / Chmiela et al.", "MD22", "npz / xyz", "http://www.quantum-machine.org/gdml/data/"),
      dataset("material-deepmd-water-demo", "DeePMD水", "DeePMD-kit 官方水分子训练示例数据", ["材料化学", "mlff", "water", "demo", "deepmd"], "DeepModeling", "DeePMD water", "deepmd-npy", "https://github.com/deepmodeling/deepmd-kit/tree/master/examples/water"),
      dataset("material-mace-example", "MACE示例", "MACE 官方 tutorial 训练示例数据", ["材料化学", "mlff", "mace", "demo", "tutorial"], "ACEsuit / MACE team", "MACE example", "extxyz", "https://github.com/ACEsuit/mace/tree/main/tests"),
      dataset("material-matpl-example", "MatPL示例", "MatPL NEP 训练示例 (AuAg/Cu/HfO2/LiSiC)", ["材料化学", "mlff", "nep", "demo", "matpl"], "LonxunQuantum", "MatPL example", "extxyz", "https://github.com/LonxunQuantum/MatPL"),
      dataset("material-ms-nanotube", "Nanotube", "OneScience 魔搭 Nanotube 材料机器学习势训练数据集", ["材料化学", "mlff", "modelscope", "nanotube"], "OneScience", "extxyz", "extxyz", "https://modelscope.cn/datasets/OneScience/Nanotube"),
      dataset("material-ms-lisic", "LiSiC", "OneScience 魔搭 LiSiC 材料机器学习势训练数据集", ["材料化学", "mlff", "modelscope", "lisic"], "OneScience", "extxyz", "extxyz", "https://modelscope.cn/datasets/OneScience/LiSiC"),
      dataset("material-ms-liquid-water", "Liquid_water", "OneScience 魔搭 Liquid_water 分子动力学数据集", ["材料化学", "md", "modelscope", "water"], "OneScience", "extxyz", "extxyz", "https://modelscope.cn/datasets/OneScience/Liquid_water"),
      dataset("material-ms-hfo2", "HfO2", "OneScience 魔搭 HfO2 材料机器学习势训练数据集", ["材料化学", "mlff", "modelscope", "hfo2"], "OneScience", "extxyz", "extxyz", "https://modelscope.cn/datasets/OneScience/HfO2"),
      dataset("material-ms-dmc", "DMC", "OneScience 魔搭 DMC 分子数据集", ["材料化学", "md", "modelscope", "dmc"], "OneScience", "extxyz", "extxyz", "https://modelscope.cn/datasets/OneScience/DMC"),
      dataset("material-ms-cu", "Cu", "OneScience 魔搭 Cu 材料机器学习势训练数据集", ["材料化学", "mlff", "modelscope", "cu"], "OneScience", "extxyz", "extxyz", "https://modelscope.cn/datasets/OneScience/Cu"),
      dataset("material-ms-auag", "AuAg", "OneScience 魔搭 AuAg 合金材料机器学习势训练数据集", ["材料化学", "mlff", "modelscope", "auag"], "OneScience", "extxyz", "extxyz", "https://modelscope.cn/datasets/OneScience/AuAg"),
      dataset("material-ms-ani1x", "Ani1x", "OneScience 魔搭 ANI-1x 分子势能数据集", ["材料化学", "mlff", "modelscope", "ani1x"], "OneScience", "extxyz", "extxyz", "https://modelscope.cn/datasets/OneScience/Ani1x"),
      dataset("material-ms-pbe", "pbe_pbesol_phonon", "OneScience 魔搭 MatRIS 训练与评测数据集", ["pbe", "modelscope"], "MDR声子计算数据库", "bz2", "bz2"),
      dataset("fluid-ms-transolver-airfoil", "Transolver-Airfoil-Design", "OneScience 魔搭 Transolver 翼型设计 CFD 数据集", ["流体仿真", "cfd", "modelscope", "airfoil"], "OneScience", "NumPy", "NumPy", "https://modelscope.cn/datasets/OneScience/Transolver-Airfoil-Design"),
      dataset("fluid-ms-transolver-car", "Transolver-Car-Design", "OneScience 魔搭 Transolver 汽车设计 CFD 数据集", ["流体仿真", "cfd", "modelscope", "car-design"], "OneScience", "NumPy", "NumPy", "https://modelscope.cn/datasets/OneScience/Transolver-Car-Design"),
      dataset("life-ms-proteinmpnn", "proteinmpnn", "OneScience 魔搭 ProteinMPNN 训练与评测数据集", ["生命科学", "protein", "modelscope", "inverse_folding"], "OneScience", "PDB", "PDB", "https://modelscope.cn/datasets/OneScience/proteinmpnn"),
      dataset("life-ms-medgemma", "medgemma", "OneScience 魔搭 MedGemma 医学多模态数据集", ["生命科学", "medical_ai", "modelscope", "multimodal"], "OneScience", "image/text", "image/text", "https://modelscope.cn/datasets/OneScience/medgemma"),
      dataset("life-ms-mmseqsdb", "mmseqsDB", "OneScience 魔搭 mmseqsDB 蛋白序列搜索数据库", ["生命科学", "protein", "modelscope", "msa", "sequence"], "OneScience", "FASTA", "FASTA", "https://modelscope.cn/datasets/OneScience/mmseqsDB"),
      dataset("life-ms-alphagenome", "AlphaGenome数据集", "OneScience 魔搭 AlphaGenome 训练与评测数据集", ["生命科学", "genomics", "alphagenome", "modelscope"], "OneScience", "FASTA/FAI/feather/TFRecord", "FASTA/FAI/feather/TFRecord"),
      dataset("life-ms-evo2", "EVO2数据集", "OneScience 魔搭 EVO2 训练与评测数据集", ["生命科学", "genomics", "evo2", "modelscope"], "OneScience", "FASTA", "FASTA"),
      dataset("life-ms-la-proteina", "La-Proteina数据集", "OneScience 魔搭 La-Proteina 训练与评测数据集", ["生命科学", "protein", "la-proteina", "modelscope"], "OneScience", "PDB", "PDB"),
      dataset("life-ms-alphafold3", "AlphaFold3数据集", "OneScience 魔搭 AlphaFold3 训练与评测数据集", ["生命科学", "AlphaFold3", "modelscope", "protein"], "OneScience", "JSON/FASTA/mmCIF/MMseqs DB/sharded FASTA", "JSON/FASTA/mmCIF/MMseqs DB/sharded FASTA"),
      dataset("life-ms-protenix", "Protenix数据集", "OneScience 魔搭 Protenix 训练与评测数据集", ["生命科学", "Protenix", "modelscope", "protein"], "OneScience", "json/cif", "json/cif"),
      dataset("life-ms-esm2", "ESM-2数据集", "OneScience 魔搭 ESM-2 训练与评测数据集", ["生命科学", "ESM-2", "modelscope", "protein"], "OneScience", "pt", "pt"),
    ],
  },
  models: {
    eyebrow: "OneHub",
    title: "公开模型库",
    count: "共 135 个预训练模型：地球科学 59，材料化学 14，生命科学 19，流体仿真 43",
    search: "搜索模型名称、描述或标签...",
    filters: ["全部", "地球科学", "材料化学", "生命科学", "流体仿真", "其它"],
    items: [
      scienceModel("modelhub", "GraphCast", "Google DeepMind 中期全球天气预报模型", ["地球科学", "weather", "forecasting", "graph-model"], "weather", "JAX"),
      scienceModel("modelhub-fourcastnet", "FourCastNet", "NVIDIA 全球高分辨率神经算子天气预报模型", ["地球科学", "weather", "forecasting", "neural-operator"], "weather", "PyTorch"),
      scienceModel("modelhub-fourcastnet-v2", "FourCastNet_v2", "从v1的自适应傅里叶神经算子 (AFNO) 改为球面傅里叶神经算子 (SFNO)", ["地球科学", "weather", "forecasting", "neural-operator", "sfno"], "weather", "PyTorch"),
      scienceModel("modelhub-pangu-weather", "Pangu-weather", "Huawei 三维高分辨率全球天气预报模型", ["地球科学", "weather", "forecasting", "spatiotemporal"], "weather", "PyTorch/ONNX"),
      scienceModel("modelhub-corrdiff", "CorrDiff", "NVIDIA 千米级天气生成式降尺度模型", ["地球科学", "weather", "downscaling", "generative"], "weather", "PyTorch"),
      scienceModel("modelhub-fengwu", "FengWu", "OpenEarthLab 中期全球天气预报模型", ["地球科学", "weather", "forecasting", "spatiotemporal"], "weather", "ONNX"),
      scienceModel("modelhub-fuxi", "FuXi", "级联机器学习全球十五天天气预报模型", ["地球科学", "weather", "forecasting", "spatiotemporal"], "weather", "PyTorch"),
      scienceModel("modelhub-fuxi-v21", "FuXi_v21", "保持均方根误差 (RMSE) 等传统指标不下降的前提下，生成更清晰、细节更丰富的预报场", ["地球科学", "weather", "forecasting", "extreme-weather"], "weather", "PyTorch"),
      scienceModel("modelhub-oneforecast", "OneForecast", "基于图神经网络 (GNN) 的全球-区域嵌套天气预报通用框架", ["地球科学", "weather", "forecasting", "graph-model", "global-forecast"], "weather", "PyTorch/ONNX"),
      scienceModel("modelhub-stormcast", "StormCast", "使用大尺度天气背景约束区域状态演变，并通过生成式扩散方法补充确定性预报难以刻画的细尺度结构", ["地球科学", "weather", "forecasting", "hrrr", "regional", "diffusion"], "weather", "PyTorch/ONNX"),
      scienceModel("modelhub-globalsurgeml", "GlobalSurgeML", "基于气象和海洋环境变量，使用线性回归与随机森林模拟全球沿海每日最大风暴增水。", ["地球科学", "weather", "storm-surge", "random-forest", "coastal-flooding"], "weather", "PyTorch/scikit-learn"),
      scienceModel("modelhub-firecubenet", "FireCubeNet", "基于多源 FireCube 时空数据和 ConvLSTM，综合环境驱动因素预测次日野火危险。", ["地球科学", "weather", "wildfire", "firecube", "convlstm"], "weather", "PyTorch"),
      scienceModel("modelhub-wofs-stormcal", "WoFS-StormCal", "基于 WoFS 集合风暴轨迹特征，校准龙卷风、严重冰雹和严重大风的短时概率预报。", ["地球科学", "weather", "severe-weather", "wofs", "probability-calibration"], "weather", "PyTorch"),
      scienceModel("modelhub-climatebench", "ClimateBench", "使用 CNN-LSTM 学习排放与气候响应之间的关系，快速模拟不同情景下的全球气候变化。", ["地球科学", "climate", "climate-projection", "cnn-lstm"], "climate", "PyTorch"),
      scienceModel("modelhub-causalmodelevaluation", "CausalModelEvaluation", "利用因果网络评价气候模型的过程表示能力，并约束未来全球降水变化。", ["地球科学", "climate", "causal-discovery", "pcmci"], "climate", "PyTorch/scikit-learn"),
      scienceModel("modelhub-xihe", "XiHe", "全球高分辨率海洋涡旋预报模型", ["地球科学", "ocean", "forecasting", "spatiotemporal"], "ocean", "ONNX"),
      scienceModel("modelhub-wenhai", "WenHai", "深度神经网络全球涡旋海洋预报模型", ["地球科学", "ocean", "forecasting", "spatiotemporal"], "ocean", "PyTorch"),
      scienceModel("modelhub-gencast", "GenCast", "Google DeepMind 中期集合天气预报模型", ["地球科学", "weather", "forecasting", "probabilistic", "generative"], "weather", "JAX"),
      scienceModel("modelhub-weathernext-2", "WeatherNext2", "Google DeepMind 全球概率天气预报模型", ["地球科学", "weather", "forecasting", "probabilistic"], "weather", "Google internal"),
      scienceModel("modelhub-artificial-intelligence-forecasting-system", "Artificial Intelligence Forecasting System", "ECMWF 业务化 AI 全球天气预报系统", ["地球科学", "weather", "forecasting", "graph-model"], "weather", "PyTorch"),
      scienceModel("modelhub-aurora", "AURORA", "Microsoft 地球系统基础模型", ["地球科学", "weather", "climate", "foundation-model"], "earth-system", "PyTorch"),
      scienceModel("modelhub-neuralgcm", "NeuralGCM", "Google 混合物理与机器学习大气环流模型", ["地球科学", "climate", "forecasting", "physics-informed"], "climate", "JAX"),
      scienceModel("modelhub-prithvi-wxc", "PrithviWxC", "NASA IBM 天气气候基础模型", ["地球科学", "weather", "climate", "foundation-model"], "weather", "PyTorch"),
      scienceModel("modelhub-climax", "ClimaX", "Microsoft 天气气候通用基础模型", ["地球科学", "weather", "climate", "foundation-model"], "climate", "PyTorch"),
      scienceModel("modelhub-metnet-3", "metnet-3", "Google 短临与区域天气预报神经网络模型", ["地球科学", "weather", "nowcasting", "precipitation"], "weather", "Google internal"),
      scienceModel("modelhub-nowcastnet", "NowcastNet_Earth", "极端降水临近预报生成模型", ["地球科学", "precipitation", "nowcasting", "generative"], "precipitation", "PyTorch"),
      scienceModel("modelhub-deep-generative-model-of-rainfall", "Deep-Generative-Model-of-Rain", "DeepMind 雷达降水概率临近预报模型", ["地球科学", "precipitation", "nowcasting", "probabilistic", "generative"], "precipitation", "TensorFlow"),
      scienceModel("modelhub-earthformer", "Earthformer", "面向地球系统预测的时空 Transformer 模型", ["地球科学", "climate", "forecasting", "spatiotemporal"], "earth-system", "PyTorch"),
      scienceModel("modelhub-spherical-fourier-neural-operator", "Spherical-Fourier-Neural-Operators", "面向球面网格天气气候建模的神经算子", ["地球科学", "weather", "climate", "neural-operator"], "weather", "PyTorch"),
      scienceModel("modelhub-deep-learning-weather-prediction", "deep-learning-weather-prediction", "早期全球数据驱动天气预报模型", ["地球科学", "weather", "forecasting", "spatiotemporal"], "weather", "TensorFlow/Keras"),
      scienceModel("modelhub-stormer", "Stormer", "面向中期天气预报的可扩展 Transformer 模型", ["地球科学", "weather", "forecasting", "spatiotemporal"], "weather", "PyTorch"),
      scienceModel("modelhub-atmorep", "AtmoRep", "大气动力学随机表征学习模型", ["地球科学", "atmosphere", "foundation-model", "pretraining"], "atmosphere", "PyTorch"),
      scienceModel("modelhub-aardvark-weather", "Aardvark-Weather", "端到端观测驱动全球天气预报模型", ["地球科学", "weather", "forecasting", "observation-driven"], "weather", "PyTorch"),
      scienceModel("modelhub-graphdop", "GraphDOP", "ECMWF 直接从观测初始化的图天气预报模型", ["地球科学", "weather", "forecasting", "graph-model", "observation-driven"], "weather", "PyTorch"),
      scienceModel("modelhub-glonet", "GLONET", "Mercator 全球神经海洋预报模型", ["地球科学", "ocean", "forecasting", "spatiotemporal"], "ocean", "PyTorch"),
      scienceModel("modelhub-ai2-climate-emulator", "Ai2_Climate_Emulator", "Ai2 全球天气气候机器学习模拟器", ["地球科学", "climate", "emulator", "forecasting"], "climate", "PyTorch"),
      scienceModel("modelhub-samudra", "Samudra", "M2LInES 全球海洋气候模拟器", ["地球科学", "ocean", "climate", "emulator"], "ocean", "PyTorch"),
      scienceModel("modelhub-fuxi-s2s", "FuXi-S2S", "面向全球次季节预测的 FuXi 系列模型", ["地球科学", "climate", "forecasting", "probabilistic"], "climate", "PyTorch"),
      scienceModel("modelhub-fengwu-w2s", "FengWu-W2S", "面向天气到次季节无缝预报的 FengWu 模型", ["地球科学", "weather", "climate", "forecasting"], "weather", "PyTorch"),
      scienceModel("modelhub-seeds", "SEEDS", "Google Research 天气集合预报扩散生成模型", ["地球科学", "weather", "probabilistic", "generative"], "weather", "TensorFlow/JAX"),
      scienceModel("modelhub-climode", "ClimODE", "物理约束神经 ODE 天气气候预报模型", ["地球科学", "weather", "climate", "physics-informed"], "weather", "PyTorch"),
      scienceModel("modelhub-spherical-dyffusion", "Spherical DYffusion", "面向全球气候模拟的球面扩散模拟器", ["地球科学", "climate", "emulator", "generative"], "climate", "PyTorch"),
      scienceModel("modelhub-w-mae", "W-MAE", "多变量天气预报掩码自编码预训练模型", ["地球科学", "weather", "forecasting", "pretraining"], "weather", "PyTorch"),
      scienceModel("modelhub-rainnet", "RainNet", "基于卷积神经网络的雷达降水临近预报模型", ["地球科学", "precipitation", "nowcasting", "spatiotemporal"], "precipitation", "Keras"),
      scienceModel("modelhub-convolutional-lstm-nowcasting", "ConvLSTM", "面向对流降水临近预报的经典 ConvLSTM 模型", ["地球科学", "precipitation", "nowcasting", "spatiotemporal"], "precipitation", "Theano"),
      scienceModel("modelhub-smaat-unet", "SmaAt-UNet", "小型注意力 UNet 降水临近预报模型", ["地球科学", "precipitation", "nowcasting", "spatiotemporal"], "precipitation", "PyTorch"),
      scienceModel("modelhub-prithvi-eo", "Prithvi-EO", "NASA IBM 地球观测多时相基础模型", ["地球科学", "remote-sensing", "foundation-model", "pretraining"], "remote-sensing", "PyTorch"),
      scienceModel("modelhub-terramind", "TerraMind", "IBM ESA 地球观测任意模态生成基础模型", ["地球科学", "remote-sensing", "foundation-model", "multimodal", "generative"], "remote-sensing", "PyTorch"),
      scienceModel("modelhub-clay-foundation-model", "Clay-Foundation-Model", "面向地球观测嵌入与下游任务的开源基础模型", ["地球科学", "remote-sensing", "foundation-model", "pretraining"], "remote-sensing", "PyTorch"),
      scienceModel("modelhub-alphaearth-foundations", "AlphaEarthFoundations", "Google DeepMind 全球地球观测嵌入基础模型", ["地球科学", "remote-sensing", "foundation-model", "pretraining"], "remote-sensing", "Google internal"),
      scienceModel("modelhub-surya", "Surya", "NASA IBM 太阳物理与空间天气基础模型", ["地球科学", "heliophysics", "foundation-model", "forecasting"], "heliophysics", "PyTorch"),
      scienceModel("modelhub-satmae", "SatMAE", "面向多光谱时序卫星影像的 MAE 预训练模型", ["地球科学", "remote-sensing", "foundation-model", "pretraining"], "remote-sensing", "PyTorch"),
      scienceModel("modelhub-satmae-2", "SatMAE-PP", "面向多尺度多光谱卫星影像的预训练模型", ["地球科学", "remote-sensing", "foundation-model", "pretraining"], "remote-sensing", "PyTorch"),
      scienceModel("modelhub-scale-mae", "Scale-MAE", "面向多尺度地理空间表征学习的 MAE 模型", ["地球科学", "remote-sensing", "foundation-model", "pretraining"], "remote-sensing", "PyTorch"),
      scienceModel("modelhub-dofa", "DOFA", "面向多模态地球观测的动态一体化基础模型", ["地球科学", "remote-sensing", "foundation-model", "multimodal"], "remote-sensing", "PyTorch"),
      scienceModel("modelhub-remoteclip", "RemoteCLIP", "面向遥感图文检索与理解的视觉语言基础模型", ["地球科学", "remote-sensing", "foundation-model", "vision-language"], "remote-sensing", "PyTorch"),
      scienceModel("modelhub-skysense", "SkySense", "面向地球观测通用解译的多模态遥感基础模型", ["地球科学", "remote-sensing", "foundation-model", "multimodal"], "remote-sensing", "PyTorch"),
      scienceModel("modelhub-spectralgpt", "SpectralGPT", "面向光谱遥感影像理解的生成式预训练模型", ["地球科学", "remote-sensing", "foundation-model", "pretraining"], "remote-sensing", "PyTorch"),
      scienceModel("modelhub-satlaspretrain", "SatlasPretrain", "AI2 大规模遥感理解预训练模型", ["地球科学", "remote-sensing", "foundation-model", "pretraining"], "remote-sensing", "PyTorch"),
      scienceModel("life", "AlphaFold", "DeepMind 蛋白质结构预测模型，支持单体与多聚体推理", ["生命科学", "protein", "structure", "folding", "monomer", "multimer"], "biology", "JAX"),
      scienceModel("life-openfold", "OpenFold", "AlphaFold 2 的 PyTorch 重实现，适合训练与工程集成", ["生命科学", "protein", "structure", "folding", "alphafold", "pytorch"], "biology", "PyTorch"),
      scienceModel("life-alphafold3", "AlphaFold3", "面向蛋白、核酸与配体复合物的多模态结构预测模型", ["生命科学", "protein", "complex", "ligand", "nucleic_acid", "structure"], "biology", "JAX"),
      scienceModel("life-protenix", "protenix", "开源可训练的 AF3 风格生物大分子复合物结构预测模型", ["生命科学", "protein", "complex", "ligand", "structure", "finetuning"], "biology", "PyTorch"),
      scienceModel("life-rfdiffusion", "RFdiffusion", "扩散式蛋白骨架设计模型，支持 motif、binder 与对称设计", ["生命科学", "protein_design", "backbone", "diffusion", "binder", "scaffolding"], "biology", "PyTorch"),
      scienceModel("life-proteinmpnn", "ProteinMPNN", "从蛋白骨架反向生成序列的高效设计模型", ["生命科学", "protein_design", "inverse_folding", "sequence_design", "backbone"], "biology", "PyTorch"),
      scienceModel("life-pt-dit", "PT-DiT", "基于 ProToken 的蛋白序列与结构联合扩散生成模型", ["生命科学", "protein_design", "diffusion", "latent_space", "protoken", "co_design"], "biology", "JAX/Flax"),
      scienceModel("life-simplefold", "SimpleFold", "仅依赖通用 Transformer 的流匹配蛋白折叠模型", ["生命科学", "protein", "folding", "transformer", "flow_matching", "validation"], "biology", "PyTorch/MLX"),
      scienceModel("life-evo2", "evo2", "面向超长 DNA 序列建模与设计的基因组基础模型", ["生命科学", "genomics", "dna", "long_context", "foundation_model", "design"], "genomics", "PyTorch/NeMo"),
      scienceModel("life-alphagenome", "alphagenome", "统一 DNA 序列模型，可预测多种基因组功能信号", ["生命科学", "genomics", "dna", "multiomics", "variant_scoring", "track_prediction"], "genomics", "JAX/Haiku"),
      scienceModel("life-molsculptor", "MolSculptor", "面向多靶点抑制剂设计的扩散加进化小分子生成框架", ["生命科学", "small_molecule", "drug_discovery", "diffusion", "docking", "optimization"], "drug_discovery", "JAX/Flax"),
      scienceModel("life-esm-2", "ESM", "Meta 通用蛋白语言模型，支持序列表征、结构与功能相关任务", ["生命科学", "protein", "language_model", "transformer", "embeddings", "variant_effect", "structure"], "biology", "PyTorch"),
      scienceModel("life-foldseek", "Foldseek", "高速蛋白结构搜索与聚类工具，支持 PDB、AFDB 与 ESM Atlas", ["生命科学", "structure_search", "alignment", "clustering", "protein", "3di"], "bioinformatics", "C++/CUDA"),
      scienceModel("life-state", "STATE", "面向虚拟细胞的扰动响应预测模型，覆盖多细胞环境与上下文", ["生命科学", "virtual_cell", "perturbation", "single_cell", "transcriptomics", "foundation_model"], "systems_biology", "PyTorch"),
      scienceModel("life-la-proteina", "La-Proteina", "联合生成蛋白序列与全原子结构的部分潜变量流匹配模型", ["生命科学", "protein_design", "atomistic", "flow_matching", "co_design", "motif_scaffolding"], "biology", "PyTorch"),
      scienceModel("life-diffdock", "DiffDock", "基于 3D 扩散的蛋白-小分子对接模型，输出 pose 与置信度排序", ["生命科学", "docking", "protein_ligand", "diffusion", "pose_prediction", "confidence"], "drug_discovery", "PyTorch"),
      scienceModel("life-targetdiff", "TargetDiff", "在蛋白口袋条件下联合生成 3D 分子并预测亲和力的扩散模型", ["生命科学", "molecule_generation", "protein_pocket", "diffusion", "affinity_prediction", "3d"], "drug_discovery", "PyTorch/PyG"),
      scienceModel("life-genscore", "GenScore", "面向评分、排序、对接和筛选平衡优化的蛋白-配体评分框架", ["生命科学", "scoring", "protein_ligand", "affinity", "docking", "virtual_screening"], "drug_discovery", "PyTorch/PyG"),
      scienceModel("life-medgemma", "Medgemma", "Google 医疗多模态模型集合，支持医学文本与影像理解", ["生命科学", "medical_ai", "multimodal", "llm", "vision_encoder", "radiology"], "medical_ai", "PyTorch/Transformers"),
      scienceModel("fluid", "FNO", "频域神经算子，学习 PDE 解空间映射的经典基础模型", ["流体仿真", "pde-solver", "neural-operator", "spectral"], "fluid-dynamics", "PyTorch"),
      scienceModel("fluid-gfno", "GFNO", "基于群等变傅里叶神经算子，在 FNO 的频域计算中引入旋转、反射等几何对称性，用于二维 Navier-Stokes 流场的时序预测与 CFD 代理建模。", ["流体仿真", "neural-operator", "equivariant", "cfd", "navier-stokes"], "fluid-dynamics", "PyTorch"),
      scienceModel("fluid-deeponet", "DeepONet", "Branch/Trunk 双网络，学习非线性 PDE 算子", ["流体仿真", "operator-network", "pde-solver", "physics-informed"], "mathematics", "TensorFlow/PyTorch"),
      scienceModel("fluid-mgn", "MeshGraphNet", "网格图 GNN 模拟器，预测下一步物理状态", ["流体仿真", "gnn", "mesh-based-simulation", "learned-dynamics"], "fluid-dynamics", "PyTorch/ONNX"),
      scienceModel("fluid-cfdbench-model", "CFDBench", "CFD 泛化评测基准", ["流体仿真", "cfd", "neural-operator", "generalization-benchmark"], "fluid-dynamics", "PyTorch/ONNX"),
      scienceModel("fluid-beno-model", "BENO", "求解椭圆偏微分方程的边界嵌入神经算子", ["流体仿真", "beno", "elliptic-pde", "gnn", "boundary-embedded"], "fluid-dynamics", "PyTorch/ONNX"),
      scienceModel("fluid-deepcfd-model", "DeepCFD", "U-Net 多解码器，从几何标签预测稳态层流场", ["流体仿真", "cfd", "steady-laminar-flow", "u-net", "surrogate-modeling"], "fluid-dynamics", "PyTorch/ONNX"),
      scienceModel("fluid-lagrangian-mgn", "LagrangianMGN", "拉格朗日粒子图网络物理模拟器", ["流体仿真", "gnn", "particle-simulation", "lagrangian-dynamics", "learned-physics-simulator"], "fluid-dynamics", "PyTorch/ONNX"),
      scienceModel("fluid-pdenneval-model", "PDENNEval", "面向 PDE 神经网络求解方法的系统性评测基准", ["流体仿真", "neural-pde-solver", "sciml", "benchmark-evaluation"], "fluid-dynamics", "PyTorch/ONNX"),
      scienceModel("fluid-transolver", "Transolver-Airfoil-Design", "拓扑感知 PDE Transformer", ["流体仿真", "transformer", "pde-solver", "attention"], "fluid-dynamics", "PyTorch"),
      scienceModel("fluid-u-no", "UNO", "U-Net 与神经算子结合，面向多尺度高频频流 PDE", ["流体仿真", "multi-scale", "neural-operator", "cnn"], "fluid-dynamics", "PyTorch"),
      scienceModel("fluid-pinns", "PINNs", "物理定律约束损失，无标注求解正逆 PDE 问题", ["流体仿真", "physics-informed", "inverse-problem", "pde-solver"], "mathematics", "PyTorch/TensorFlow"),
      scienceModel("fluid-geo-fno", "Geo-FNO", "不规则几何 PDE 的 FNO，坐标变换至均匀网格", ["流体仿真", "neural-operator", "geometry-aware", "cfd"], "fluid-dynamics", "PyTorch"),
      scienceModel("fluid-gino", "GINO", "GNN 与 FNO 结合，求解复杂三维工业 CFD", ["流体仿真", "neural-operator", "gnn", "3d-geometry"], "fluid-dynamics", "PyTorch"),
      scienceModel("fluid-mp-pde", "MP_PDE", "消息传递 GNN 自回归求解器，预测流体时序演化", ["流体仿真", "gnn", "message-passing", "time-evolution"], "fluid-dynamics", "PyTorch"),
      scienceModel("fluid-cno", "CNO", "连续卷积构建的无限维 PDE 神经算子", ["流体仿真", "neural-operator", "continuous-convolution", "pde-solver"], "mathematics", "PyTorch"),
      scienceModel("fluid-factformer", "FactFormer", "轴向分解 Transformer，降低三维流体建模内存", ["流体仿真", "factorized-attention", "transformer"], "turbulence-modeling", "PyTorch"),
      scienceModel("fluid-gatr", "GATr", "等变 GNN 与 Transformer，几何代数建模三维物理", ["流体仿真", "transformer", "geometric-algebra", "equivariant"], "mechanics", "PyTorch"),
      scienceModel("fluid-transolver-2", "Transolver-Car-Design", "百万级网格 PDE 求解", ["流体仿真", "transformer", "million-scale", "physics-attention"], "industrial-cfd", "PyTorch"),
      scienceModel("fluid-factorized-fourier-neural-operator", "Factorized Fourier Neural Operator", "谱卷积因子化 FNO 变体，面向多相流建模", ["流体仿真", "fno", "operator-learning"], "fluid-dynamics", "PyTorch"),
      scienceModel("fluid-koopman-neural-operator", "KNO", "Koopman 线性化非线性 PDE 动态的无网格求解器", ["流体仿真", "koopman-theory", "operator-learning"], "dynamic-systems", "PyTorch"),
      scienceModel("fluid-multi-scale-patch-transformer", "Multi-Scale Patch Transformer", "多尺度图像块双层注意力 Transformer", ["流体仿真", "transformer", "patch-attention"], "industrial-cfd", "PyTorch"),
      scienceModel("fluid-universal-physics-transformers", "Universal Physics Transformers", "统一欧拉/拉格朗日域的物理 Transformer", ["流体仿真", "transformer", "unified-model"], "eulerian, lagrangian", "PyTorch"),
      scienceModel("fluid-anchored-branched-universal-physics-transformers", "Anchored-Branched Universal Physics Transformers", "UPT 工业分支，建模三维表面-体积耦合流体", ["流体仿真", "transformer", "industrial-scale"], "industrial-aerodynamics", "PyTorch"),
      scienceModel("fluid-oformer", "OFormer", "交叉注意力算子 Transformer，点云注入边界初值", ["流体仿真", "transformer", "cross-attention"], "operator-learning", "PyTorch"),
      scienceModel("fluid-pointnetcfd", "PointNetCFD", "点云 PointNet 框架，预测不规则域流场", ["流体仿真", "point-cloud", "geometry-learning"], "irregular-cfd", "PyTorch"),
      scienceModel("fluid-orthogonal-attention-neural-operator", "ONO", "正交注意力神经算子，核积分特征分解正则化", ["流体仿真", "orthogonal-attention", "regularization"], "operator-learning", "PyTorch"),
      scienceModel("fluid-poseidon", "Poseidon", "预训练 PDE 基础模型，零/少样本泛化未见方程", ["流体仿真", "foundation-model", "multi-physics"], "pde-foundation-model", "PyTorch"),
      scienceModel("fluid-diffusionpde", "DiffusionPDE", "引导扩散 PDE 求解器，联合前向预测与逆问题", ["流体仿真", "diffusion-model", "inverse-problem"], "inverse-problems, generative", "PyTorch"),
      scienceModel("fluid-diffusion-graph-net", "Diffusion Graph Net", "非结构化网格图扩散模型，采样湍流物理状态", ["流体仿真", "diffusion", "gnn", "turbulence"], "cfd, generative", "PyTorch"),
      scienceModel("fluid-eagle-mesh-transformer", "EagleMeshTransformer", "非稳态流体网格求解器", ["流体仿真", "transformer", "mesh-graph", "fluid-dynamics"], "fluid-dynamics", "PyTorch"),
      scienceModel("fluid-xpinn", "XPINNs", "时空域分解 PINN，子域并行求解复杂几何 PDE", ["流体仿真", "pinn", "domain-decomposition"], "pde-solving", "PyTorch, TensorFlow"),
      scienceModel("fluid-cpinn", "cPINN", "域分解 PINN，子域边界强制通量连续", ["流体仿真", "pinn", "conservation-laws", "domain-decomposition"], "conservation-laws", "PyTorch, TensorFlow"),
      scienceModel("fluid-gpinn", "gPINNs", "梯度增强 PINN，稀疏样本下提高求解精度", ["流体仿真", "pinn", "gradient-enhanced"], "pde-solving", "PyTorch, TensorFlow"),
      scienceModel("fluid-hp-vpinn", "VPINNs", "变分弱形式与域分解结合的 PINN 框架", ["流体仿真", "pinn", "variational-methods"], "pde-solving", "PyTorch, TensorFlow"),
      scienceModel("fluid-bpinn", "BPINNs", "贝叶斯 PINN，预测物理场并量化不确定性", ["流体仿真", "pinn", "bayesian", "inverse-problems"], "uncertainty-quantification", "PyTorch, TensorFlow"),
      scienceModel("fluid-sa-pinn", "SA-PINNs", "软注意力自适应配点权重，缓解刚性 PDE 收敛", ["流体仿真", "pinn", "adaptive-weights", "stiff-pdes"], "stiff-pdes", "PyTorch, TensorFlow, JAX"),
      scienceModel("fluid-fpinn", "FPINNs", "分数阶微积分 PINN，求解非局部 PDE", ["流体仿真", "pinn", "fractional-pdes"], "fractional-pdes", "PyTorch, TensorFlow"),
      scienceModel("fluid-gp-for-to", "GP_for_TO", "基于物理信息高斯过程的无网格拓扑优化方法", ["流体仿真", "stokes-flow", "topology-optimization", "physics-informed-gaussian-processes"], "fluid-dynamics", "PyTorch/ONNX"),
      scienceModel("fluid-pinnsformer", "PINNsformer", "以时序建模和注意力机制提升物理信息神经网络求解复杂 PDE 的精度与鲁棒性。", ["流体仿真", "physics-informed-neural-networks", "transformer", "pde-solvers", "scientific-machine-learning"], "fluid-dynamics", "PyTorch/ONNX"),
      scienceModel("fluid-u-fno", "U-FNO", "U-Net 与 FNO 结合的多相流算子网络", ["流体仿真", "fno", "multiphase-flow", "operator-learning"], "multiphase-flow", "PyTorch"),
      scienceModel("fluid-mwt", "MWT", "多小波变换算子，处理多尺度与高频频变 PDE", ["流体仿真", "operator-learning", "wavelets", "multiwavelets"], "pde-solving", "PyTorch"),
      scienceModel("fluid-galerkin-transformer", "Galerkin Transformer", "线性伽辽金投影的算子 Transformer", ["流体仿真", "transformer", "galerkin-projection"], "operator-learning", "PyTorch"),
      scienceModel("material", "MACE", "高阶等变消息传递机器学习势函数", ["材料化学", "mlff", "equivariant", "mpnn", "dcu"], "matchem", "PyTorch"),
      scienceModel("material-uma", "UMA", "Meta FAIR 跨化学领域通用原子势模型", ["材料化学", "mlff", "foundation-model", "catalysis", "oc20"], "matchem", "PyTorch"),
      scienceModel("material-deepmd", "DeePMD", "深度学习势能函数，支持 PT/TF 双后端", ["材料化学", "mlff", "deepmd", "lammps", "dcu"], "matchem", "PyTorch"),
      scienceModel("material-nep", "NEP", "神经演化势函数，DCU 上由 MatPL 训练", ["材料化学", "mlff", "nep", "matpl", "dcu"], "matchem", "PyTorch"),
      scienceModel("material-matris", "MatRIS", "中科院计算所科学智能预训练大模型", ["材料化学", "mlff", "foundation-model", "pretrained", "dcu"], "matchem", "PyTorch"),
      scienceModel("material-tace", "TACE", "Cartesian 张量原子簇展开势能模型", ["材料化学", "mlff", "equivariant", "ace", "tensor"], "matchem", "PyTorch"),
      scienceModel("material-nequix", "Nequix", "轻量 E(3) 等变材料基础势能模型", ["材料化学", "mlff", "equivariant", "foundation-model", "materials"], "matchem", "JAX"),
      scienceModel("material-mattersim", "Mattersim", "面向多元素温压条件的原子级深度学习模型", ["材料化学", "mlff", "foundation-model", "m3gnet", "materials"], "matchem", "PyTorch"),
      scienceModel("material-grace", "GRACE", "Graph Atomic Cluster Expansion 势能框架", ["材料化学", "mlff", "ace", "graph", "foundation-model"], "matchem", "PyTorch"),
      scienceModel("material-allegro", "Allegro", "严格局域 E(3) 等变高扩展势能模型", ["材料化学", "mlff", "equivariant", "scalable", "nequip"], "matchem", "PyTorch"),
      scienceModel("material-mattergen", "Mattergen", "面向无机晶体材料设计的扩散生成模型。", ["材料化学", "generative", "diffusion", "crystal", "materials"], "matchem", "PyTorch"),
      scienceModel("material-equiformer-v3", "Equiformer_v3", "用于材料结构能量、原子力和应力预测的 SE(3) 等变图注意力势模型。", ["材料化学", "mlff", "equivariant", "graph-attention", "materials"], "matchem", "PyTorch"),
      scienceModel("material-esen", "eSEN", "用于材料结构能量、原子力和应力预测的等变图神经网络势。", ["材料化学", "mlff", "equivariant", "gnn", "materials"], "matchem", "PyTorch"),
      scienceModel("material-nequip", "NequIP", "基于 SE (3) 等变图神经网络，用于原子体系能量、原子力预测的分子 / 材料势能模型", ["材料化学", "mlff", "equivariant", "gnn", "materials"], "matchem", "PyTorch"),
    ],
  },
  skills: {
    eyebrow: "OneSkills",
    title: "OneSkills 技能列表",
    count: "正在加载 OneSkills 技能...",
    search: "搜索 OneSkills 技能名称、描述或标签...",
    filters: ["全部", "编排层", "资源层", "专家层", "执行层"],
    items: [],
  },
  apps: {
    eyebrow: "OneHub",
    title: "应用库",
    count: "共 37 个应用：材料化学 9，生命科学 9，流体仿真 4，其它 15",
    search: "搜索应用、软件库、方向或运行平台...",
    filters: ["全部", "地球科学", "材料化学", "生命科学", "流体仿真", "其它"],
    items: [
      card("abacus", "ABACUS", "基于密度泛函理论的第一性原理电子结构与材料模拟软件", ["材料化学", "DFT", "materials", "quantum"], "Materials Science", "C++", "CPU/GPU/MPI", "https://dos.sourcefind.cn:50275/portal/#/installation?id=fa860bcd-f8d7-11ef-be71-0242ac170002&type=frame"),
      card("adaptivecpp", "AdaptiveCpp", "面向 CPU/GPU 的 SYCL 与 C++ 异构并行编译器和运行时", ["其它", "SYCL", "compiler", "GPU"], "Programming Model", "C++", "CPU/GPU", "https://dos.sourcefind.cn:50275/portal/#/installation?id=38bbdeb3-f965-11ef-be71-0242ac170002&type=frame"),
      card("astra_toolbox", "ASTRA Toolbox", "面向 GPU 加速层析成像与断层重建的高性能工具箱", ["其它", "tomography", "CT", "GPU"], "Imaging", "Python", "GPU", "https://dos.sourcefind.cn:50275/portal/#/installation?id=938690ad-f960-11ef-be71-0242ac170002&type=frame"),
      card("autodock_gpu", "AutoDock-GPU", "面向药物筛选的 GPU 加速分子对接与虚拟筛选软件", ["生命科学", "drug-discovery", "docking", "GPU"], "Drug Discovery", "C++", "GPU/MPI", "https://dos.sourcefind.cn:50275/portal/#/installation?id=2355d55d-f5a3-11ef-bb42-0242ac170002&type=frame"),
      card("beagle", "BEAGLE", "用于系统发育树上序列进化似然计算的高性能生物信息学库", ["生命科学", "phylogenetics", "GPU"], "Bioinformatics", "C++", "CPU/GPU", "https://dos.sourcefind.cn:50275/portal/#/installation?id=5aa1ae8b-3edd-11f1-be71-0242ac170002&type=frame"),
      card("bwa", "BWA", "基于 BWA-MEM 的 GPU 加速基因序列比对工具", ["生命科学", "genomics", "alignment", "GPU"], "Bioinformatics", "C++", "GPU", "https://dos.sourcefind.cn:50275/portal/#/installation?id=112d8f26-3ede-11f1-be71-0242ac170002&type=frame"),
      card("cosma", "COSMA", "面向分布式内存系统的通信优化矩阵乘法库", ["其它", "linear-algebra", "MPI", "HPC"], "Math Libraries", "C++", "CPU/GPU/MPI", "https://dos.sourcefind.cn:50275/portal/#/installation?id=34db8883-f5ad-11ef-bb42-0242ac170002&type=frame"),
      card("cupy", "CuPy", "面向 GPU 的 NumPy 与 SciPy 风格数组计算库", ["其它", "Python", "GPU", "array"], "Scientific Python", "Python", "GPU", "https://dos.sourcefind.cn:50275/portal/#/installation?id=dc131138-f5ad-11ef-bb42-0242ac170002&type=frame"),
      card("eigen3", "Eigen3", "提供矩阵、向量与数值求解器的 C++ 模板线性代数库", ["其它", "linear-algebra", "C++"], "Math Libraries", "C++", "CPU/GPU", "https://dos.sourcefind.cn:50275/portal/#/installation?id=895d2da4-f96a-11ef-be71-0242ac170002&type=frame"),
      card("elpa", "ELPA", "面向大规模对称或厄米矩阵特征值问题的高性能求解库", ["其它", "eigensolver", "MPI", "HPC"], "Math Libraries", "C++", "CPU/GPU/MPI", "https://dos.sourcefind.cn:50275/portal/#/installation?id=ffcb92e8-f3f3-11ef-bb42-0242ac170002&type=frame"),
      card("genomeworks", "GenomeWorks", "面向基因组装与序列分析的 GPU 加速开发工具包", ["生命科学", "genomics", "GPU", "MPI"], "Bioinformatics", "C++", "GPU/MPI", "https://dos.sourcefind.cn:50275/portal/#/installation?id=7f2555a5-f96c-11ef-be71-0242ac170002&type=frame"),
      card("ginkgo", "Ginkgo", "面向稀疏线性代数与迭代求解的高性能数值计算库", ["其它", "sparse", "solver", "GPU"], "Math Libraries", "C++", "CPU/GPU/MPI", "https://dos.sourcefind.cn:50275/portal/#/installation?id=81b84c92-f96d-11ef-be71-0242ac170002&type=frame"),
      card("gpublast", "GPU-Blast", "面向生物序列搜索与比对的 GPU 加速 BLAST 工具", ["生命科学", "BLAST", "genomics", "GPU"], "Bioinformatics", "C++", "GPU", "https://dos.sourcefind.cn:50275/portal/#/installation?id=a682df0a-f96e-11ef-be71-0242ac170002&type=frame"),
      card("gpumd", "GPUMD", "完全基于 GPU 实现的高效率通用分子动力学模拟软件", ["材料化学", "MD", "materials", "GPU"], "Molecular Dynamics", "C++", "GPU", "https://dos.sourcefind.cn:50275/portal/#/installation?id=0e3550e8-3ee0-11f1-be71-0242ac170002&type=frame"),
      card("gromacs", "GROMACS", "面向生物分子与化学体系的高性能分子动力学模拟软件", ["生命科学", "MD", "chemistry", "MPI", "GPU"], "Molecular Dynamics", "C++", "CPU/GPU/MPI", "https://dos.sourcefind.cn:50275/portal/#/installation?id=79f6980f-f3e8-11ef-bb42-0242ac170002&type=frame"),
      card("hashcat", "Hashcat", "面向多种哈希算法的高性能密码恢复与审计工具", ["其它", "security", "GPU"], "Security", "C++", "CPU/GPU", "https://dos.sourcefind.cn:50275/portal/#/installation?id=fb77220b-f5a9-11ef-bb42-0242ac170002&type=frame"),
      card("hoomd_blue", "HOOMD-blue", "面向软物质体系的 GPU 加速分子动力学与蒙特卡罗模拟软件", ["材料化学", "MD", "soft-matter", "GPU"], "Molecular Dynamics", "C++", "CPU/GPU/MPI", "https://dos.sourcefind.cn:50275/portal/#/installation?id=8ab9aebe-f986-11ef-be71-0242ac170002&type=frame"),
      card("hypre", "HYPRE", "提供多重网格方法的并行稀疏线性系统求解与预条件库", ["其它", "multigrid", "solver", "MPI"], "Math Libraries", "C++", "CPU/GPU/MPI", "https://dos.sourcefind.cn:50275/portal/#/installation?id=6eb76d28-f5ae-11ef-bb42-0242ac170002&type=frame"),
      card("kokkos", "Kokkos", "提供并行执行与内存抽象的 C++ 性能可移植编程模型", ["其它", "parallel", "C++", "GPU"], "Programming Model", "C++", "CPU/GPU", "https://dos.sourcefind.cn:50275/portal/#/installation?id=4b124510-f970-11ef-be71-0242ac170002&type=frame"),
      card("lammps", "LAMMPS", "大规模并行经典/MLFF 分子动力学软件", ["材料化学", "MD", "MPI", "Kokkos", "DCU"], "MD", "C++", "CPU/GPU/MPI", "https://gitee.com/onescience-ai/onescience/blob/main/examples/matchem/README.md"),
      card("vasp", "VASP", "商业 DFT 第一性原理材料模拟软件", ["材料化学", "DFT", "first-principles", "MPI", "DCU"], "DFT", "Fortran", "CPU/GPU/MPI", "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem/tools/vasp"),
      card("cp2k", "CP2K", "面向分子与材料体系的并行 DFT/MD 软件", ["材料化学", "DFT", "MD", "MPI", "DCU"], "DFT/MD", "Fortran/C", "CPU/GPU/MPI", "https://gitee.com/onescience-ai/onescience/blob/main/examples/matchem/README.md"),
      card("deepmd-kit", "DeePMD-kit", "深度学习势能函数训练与推理框架", ["材料化学", "MLFF", "deep-learning", "DCU"], "MLFF", "C++/Python", "CPU/GPU/MPI", "https://gitee.com/onescience-ai/onescience/blob/main/examples/matchem/dp/dp_install.sh"),
      card("matpl", "MatPL", "NEP 等机器学习势训练框架，含 DCU 算子", ["材料化学", "MLFF", "NEP", "DCU"], "MLFF", "C++/Python", "GPU/MPI", "https://gitee.com/onescience-ai/onescience/blob/main/examples/matchem/nep/matpl_install.sh"),
      card("magma", "MAGMA", "面向异构 CPU/GPU 平台的高性能稠密线性代数计算库", ["其它", "linear-algebra", "GPU"], "Math Libraries", "C++", "CPU/GPU", "https://dos.sourcefind.cn:50275/portal/#/installation?id=6bfd3815-f41a-11ef-bb42-0242ac170002&type=frame"),
      card("namd", "NAMD", "面向大规模生物分子体系的高性能并行分子动力学模拟软件", ["生命科学", "MD", "biomolecular", "GPU"], "Molecular Dynamics", "C++", "CPU/GPU/MPI", "https://dos.sourcefind.cn:50275/portal/#/installation?id=5f31ffe2-f417-11ef-bb42-0242ac170002&type=frame"),
      card("nekrs", "nekRS", "面向 HPC 应用的快速可扩展谱元 CFD 求解器", ["流体仿真", "CFD", "spectral-element", "MPI"], "CFD", "C++", "CPU/GPU/MPI", "https://dos.sourcefind.cn:50275/portal/#/installation?id=27b19af1-3ee4-11f1-be71-0242ac170002&type=frame"),
      card("nwchem", "NWChem", "面向高性能计算环境的开源量子化学与计算化学软件", ["材料化学", "quantum-chemistry", "DFT", "MPI"], "Computational Chemistry", "C++", "CPU/GPU/MPI", "https://dos.sourcefind.cn:50275/portal/#/installation?id=b4ffe397-f413-11ef-bb42-0242ac170002&type=frame"),
      card("openfoam", "OpenFOAM", "面向流体、多相与传热问题的开源 CFD 仿真平台", ["流体仿真", "CFD", "multiphysics", "MPI"], "CFD", "C++", "CPU/GPU/MPI", "https://dos.sourcefind.cn:50275/portal/#/installation?id=f7bb69bb-f984-11ef-be71-0242ac170002&type=frame"),
      card("openmm", "OpenMM", "兼具库与独立应用形态的高性能分子模拟工具包", ["生命科学", "MD", "simulation", "GPU"], "Molecular Dynamics", "C++", "CPU/GPU/MPI", "https://dos.sourcefind.cn:50275/portal/#/installation?id=36bbb575-f40b-11ef-bb42-0242ac170002&type=frame"),
      card("petsc", "PETSc", "面向偏微分方程与科学计算的并行数值求解工具包", ["其它", "PDE", "solver", "MPI"], "Math Libraries", "C++", "CPU/GPU/MPI", "https://dos.sourcefind.cn:50275/portal/#/installation?id=adfc07e9-3ee5-11f1-be71-0242ac170002&type=frame"),
      card("picongpu", "PIConGPU", "面向激光等离子体研究的性能可移植粒子网格模拟框架", ["其它", "plasma", "particle-in-cell", "GPU"], "Plasma Physics", "C++", "GPU/MPI", "https://dos.sourcefind.cn:50275/portal/#/installation?id=d386d847-f404-11ef-bb42-0242ac170002&type=frame"),
      card("pyfr", "PyFR", "基于通量重构方法的高阶可扩展 CFD 计算框架", ["流体仿真", "CFD", "high-order", "GPU"], "CFD", "Python", "GPU/MPI", "https://dos.sourcefind.cn:50275/portal/#/installation?id=21da2b12-f3f1-11ef-bb42-0242ac170002&type=frame"),
      card("relion", "RELION", "面向冷冻电镜单颗粒分析的图像处理与三维重构软件", ["生命科学", "cryo-EM", "imaging", "GPU"], "Imaging", "C++", "CPU/GPU/MPI", "https://dos.sourcefind.cn:50275/portal/#/installation?id=6162a45f-f3ef-11ef-bb42-0242ac170002&type=frame"),
      card("sparta", "SPARTA", "面向稀薄气体流动的并行 DSMC 粒子模拟软件", ["流体仿真", "DSMC", "rarefied-gas", "MPI"], "CFD", "C++", "CPU/GPU/MPI", "https://dos.sourcefind.cn:50275/portal/#/installation?id=67fc6a44-3ee6-11f1-be71-0242ac170002&type=frame"),
      card("specfem3d", "SPECFEM3D", "用于三维地震波传播的谱元法地球物理模拟软件", ["其它", "geophysics", "seismic", "GPU"], "Geophysics", "C++", "CPU/GPU/MPI", "https://dos.sourcefind.cn:50275/portal/#/installation?id=aa4ba8c2-f3ec-11ef-bb42-0242ac170002&type=frame"),
      card("stdgpu", "stdgpu", "提供 STL 风格接口的高效 GPU 数据结构库", ["其它", "data-structures", "C++", "GPU"], "Programming Model", "C++", "GPU", "https://dos.sourcefind.cn:50275/portal/#/installation?id=d5e12516-3ee6-11f1-be71-0242ac170002&type=frame"),
    ],
  },
  frameworks: {
    eyebrow: "OneInfra",
    title: "AI框架",
    count: "共 9 个 AI 框架：训练框架 5，并行训练 2，推理框架 2",
    search: "搜索框架名称、硬件平台、适配入口或标签...",
    filters: ["全部", "训练框架", "并行训练", "推理框架"],
    items: [
      card("framework-training", "PyTorch深度学习框架", "硬件支持：CPU/GPU；提供 DCU 安装适配入口，适合深度学习训练和动态图研发。", ["deep-learning", "dynamic-graph", "DCU适配"], "PyTorch", "Python/C++/CUDA", "CPU/GPU", "https://das.sourcefind.cn:55011/portal/#/installation?id=04749079-6b33-11ef-b472-005056904552&type=frame", [{ label: "DCU", href: "https://das.sourcefind.cn:55011/portal/#/installation?id=04749079-6b33-11ef-b472-005056904552&type=frame" }]),
      card("framework-training", "JAX高性能数值计算库", "硬件支持：CPU/GPU/TPU；提供 DCU 安装适配入口，适合自动微分、JIT 与函数式数值计算。", ["autograd", "JIT", "DCU适配"], "JAX", "Python/CUDA", "CPU/GPU/TPU", "https://das.sourcefind.cn:55011/portal/#/installation?id=57f974b4-6b39-11ef-b472-005056904552&type=frame", [{ label: "DCU", href: "https://das.sourcefind.cn:55011/portal/#/installation?id=57f974b4-6b39-11ef-b472-005056904552&type=frame" }]),
      card("framework-training", "NVIDIA TransformerEngine", "硬件支持：GPU；提供 DCU 安装入口和 FlagOS 适配仓库，面向 Transformer FP8 训练加速。", ["Transformer", "FP8", "DCU适配", "FlagOS"], "TransformerEngine", "Python/CUDA", "GPU", "https://das.sourcefind.cn:55011/portal/#/installation?id=d091bbbf-fb10-11ef-915b-0242ac160002&type=frame", [{ label: "DCU", href: "https://das.sourcefind.cn:55011/portal/#/installation?id=d091bbbf-fb10-11ef-915b-0242ac160002&type=frame" }, { label: "FlagOS", href: "https://github.com/flagos-ai/TransformerEngine-FL" }]),
      card("framework-training", "verl大语言模型训练框架", "硬件支持：CPU/GPU；提供 FlagOS 适配仓库，专注大模型强化学习与 RLHF 训练。", ["LLM", "RLHF", "FlagOS"], "verl", "Python", "CPU/GPU", "https://github.com/flagos-ai/verl-FL", [{ label: "FlagOS", href: "https://github.com/flagos-ai/verl-FL" }]),
      card("framework-training", "OneScience 科研计算与数据科学平台", "硬件支持：CPU/GPU；提供 OneScience Gitee/GitHub 入口，面向科研工作流、并行计算和科学数据管理。", ["scientific-computing", "workflow-engine", "OneScience"], "OneScience", "Python/C++", "CPU/GPU", "https://gitee.com/onescience-ai/onescience", [{ label: "Gitee/GitHub", href: "https://gitee.com/onescience-ai/onescience" }]),
      card("framework-parallel", "DeepSpeed分布式训练优化库", "硬件支持：CPU/GPU；提供 DCU 安装适配入口，覆盖 ZeRO、混合精度训练和分布式显存优化。", ["ZeRO", "distributed-training", "DCU适配"], "DeepSpeed", "Python/CUDA", "CPU/GPU", "https://das.sourcefind.cn:55011/portal/#/installation?id=e5892d54-6b3b-11ef-b472-005056904552&type=frame", [{ label: "DCU", href: "https://das.sourcefind.cn:55011/portal/#/installation?id=e5892d54-6b3b-11ef-b472-005056904552&type=frame" }]),
      card("framework-parallel", "Megatron-LM大规模模型并行训练框架", "硬件支持：GPU；提供 DCU 安装入口和 FlagOS 适配仓库，支持模型并行、流水线并行和数据并行。", ["model-parallelism", "pipeline-parallelism", "FlagOS"], "Megatron-LM", "Python/CUDA", "GPU", "https://das.sourcefind.cn:55011/portal/#/installation?id=af3d2407-bbba-11f0-98e6-0242ac130002&type=frame", [{ label: "DCU", href: "https://das.sourcefind.cn:55011/portal/#/installation?id=af3d2407-bbba-11f0-98e6-0242ac130002&type=frame" }, { label: "FlagOS", href: "https://github.com/flagos-ai/Megatron-LM-FL" }]),
      card("framework-inference", "vLLM高性能LLM推理引擎", "硬件支持：GPU；提供 DCU 安装入口和 FlagOS 适配仓库，面向高吞吐 LLM 推理服务。", ["llm-inference", "PagedAttention", "FlagOS"], "vLLM", "Python/CUDA", "GPU", "https://das.sourcefind.cn:55011/portal/#/installation?id=9385225c-6b7a-11ef-bf92-005056904552&type=frame", [{ label: "DCU", href: "https://das.sourcefind.cn:55011/portal/#/installation?id=9385225c-6b7a-11ef-bf92-005056904552&type=frame" }, { label: "FlagOS", href: "https://github.com/flagos-ai/vllm-FL" }]),
      card("framework-inference", "SGLang大语言模型服务框架", "硬件支持：GPU；提供 DCU 安装适配入口，支持高效推理、RadixAttention 和结构化生成。", ["llm-inference", "RadixAttention", "DCU适配"], "SGLang", "Python/CUDA", "GPU", "https://das.sourcefind.cn:55011/portal/#/installation?id=95f4fe5b-2cd9-11f1-ac5a-0242ac130002&type=frame", [{ label: "DCU", href: "https://das.sourcefind.cn:55011/portal/#/installation?id=95f4fe5b-2cd9-11f1-ac5a-0242ac130002&type=frame" }]),
    ],
  },
  operators: {
    eyebrow: "OneInfra",
    title: "通用算子",
    count: "基础算子与科学算子",
    search: "搜索算子、领域或性能能力...",
    filters: ["全部", "基础算子", "科学算子", "通信算子"],
    items: [
      card("operator", "张量基础算子", "面向训练和推理的矩阵、归约、变换和调度算子。", ["tensor", "kernel", "compile"], "OneInfra", "120 ops", "CUDA / CPU"),
      card("comm-operator", "通信算子", "AllReduce、Gather、Scatter 和跨节点通信优化。", ["NCCL", "MPI", "通信"], "OneInfra", "24 ops", "GPU Cluster"),
      card("sci-operator", "流体科学算子", "Navier-Stokes、网格插值、边界条件和流场处理算子。", ["CFD", "grid", "solver"], "OneInfra", "32 ops", "CUDA"),
      card("sci-operator", "分子科学算子", "邻域搜索、势能计算、结构变换和分子图操作。", ["MD", "molecule", "graph"], "OneInfra", "28 ops", "CUDA / CPU"),
    ],
  },
  research: {
    eyebrow: "AI4Research",
    title: "创新领域 AI 能力",
    count: "前沿研究工具列表",
    search: "搜索研究方向、工具或能力...",
    filters: ["全部", "物理AI", "具身智能", "自动驾驶", "世界模型"],
    items: [
      card("physical-ai", "物理AI", "物理世界建模、仿真、控制和可微物理工具链。", ["physics", "simulation"], "AI4Research", "toolkit", "beta"),
      card("embodied-ai", "具身智能", "机器人、实验自动化和多模态感知规划能力。", ["robotics", "agent"], "AI4Research", "lab", "beta"),
      card("autonomous-driving", "自动驾驶", "世界模型、场景生成和安全评估工具。", ["driving", "world model"], "AI4Research", "sim", "preview"),
      card("world-model", "世界模型", "面向科学系统的预测、规划和实验代理。", ["planning", "agent"], "AI4Research", "agent", "preview"),
    ],
  },
  cases: {
    eyebrow: "Cases",
    title: "场景化落地范例",
    count: "共 16 个科研场景",
    search: "搜索案例名称、领域或标签...",
    filters: ["全部", "地球科学", "材料化学", "生命科学", "流体仿真", "其它"],
    items: [
      caseCard("case-cfdbench", "CFDBench 训练 smoke 验证", "下载魔搭 CFDBench 流体基准数据，跑通 FNO 神经算子在小样本上的训练冒烟验证。", ["流体仿真", "CFD", "FNO"], "流体仿真", "ses_10346f0acffeC6AHvtobK5pHFs"),
      caseCard("case-esm2", "ESM-2 训练 smoke 验证", "下载魔搭 ESM-2 蛋白语言模型，完成小规模训练冒烟验证，确认序列建模流程可用。", ["生命科学", "ESM-2", "蛋白"], "生命科学", "ses_103137ca7ffeO7q8BnYiPP3L2q"),
      caseCard("case-fourcastnet", "FourCastNet 训练 smoke 验证", "下载 FourCastNet 全球高分辨率神经算子天气预报模型，完成训练配置与小样本冒烟验证。", ["地球科学", "FourCastNet", "天气预报"], "地球科学", "ses_10336b7f1ffeL2BZqW7OT8eNMs"),
      caseCard("case-fuxi", "FuXi 训练 smoke 验证", "下载 FuXi 数据驱动中期预报模型，跑通训练入口配置与小规模冒烟验证。", ["地球科学", "FuXi", "天气预报"], "地球科学", "ses_103251332ffelcaGi7spx1esL9"),
      caseCard("case-mace", "MACE 训练 smoke 验证", "下载魔搭 MACE 机器学习势函数，完成训练配置与小规模冒烟验证，确认势函数训练流程可用。", ["材料化学", "MACE", "MLFF"], "材料化学", "ses_09102687affe6WEyKzrDV0i5tJ"),
      caseCard("case-matris", "MatRIS 下载与推理验证", "下载魔搭 MatRIS 预训练权重并完成样例推理验证，确认推理入口与结果产出可用。", ["材料化学", "MatRIS", "推理"], "材料化学", "ses_090e3ee94ffeOUHq4ZepQ8DKHs"),
      caseCard("case-mace-water-pes", "MACE 水体系势能面训练与验证", "下载 MACE 与水体系数据集，完成势能面小规模训练与验证，确认 checkpoint 与评测交付物可用。", ["材料化学", "MACE", "水体系"], "材料化学", "ses_090bb739bffevzX4Zf7pBxuD16"),
      caseCard("case-meshgraphnet", "MeshGraphNet 训练推理与可视化", "下载 MeshGraphNet 网格图神经网络，完成训练、推理与流场结果可视化全流程。", ["流体仿真", "MeshGraphNet", "CFD"], "流体仿真", "ses_1037cc763ffeMfaaYQ6CQdmbrq"),
      caseCard("case-proteinmpnn", "ProteinMPNN 训练 smoke 验证", "下载 ProteinMPNN 蛋白序列设计模型，完成训练冒烟验证，验证序列生成流程。", ["生命科学", "ProteinMPNN", "蛋白设计"], "生命科学", "ses_1033535eaffeFd2OKFwlyBG9bl"),
      caseCard("case-rae2822-fno", "RAE2822 翼型 FNO 训练流程", "围绕 RAE2822 翼型网格与流场数据，搭建 FNO 神经算子训练流程并完成验证。", ["流体仿真", "RAE2822", "FNO"], "流体仿真", "ses_12c59a12fffe4xD0VPNsTHQ2iO"),
      caseCard("case-aifs-repro", "AIFS 论文复现", "复现 AIFS 全球气象预报模型论文实验，覆盖数据准备、训练与评估关键环节。", ["其它", "AIFS", "论文复现", "AI4S"], "其它", "ses_130857560ffebRRVOorz8TBEXI"),
      caseCard("case-fuxi-forecast-smoke", "FuXi 预报模型训练冒烟验证", "面向 FuXi 预报模型执行训练冒烟验证，快速确认配置与训练入口可用。", ["地球科学", "FuXi", "冒烟验证"], "地球科学", "ses_1109c4216ffe02IxWfmOd93yyu"),
      caseCard("case-fuxi-run-test", "FuXi 模型下载与运行测试", "下载 FuXi 预训练权重并执行运行测试，验证推理流程与结果产出。", ["地球科学", "FuXi", "推理"], "地球科学", "ses_12afd8b95ffeFdtfOOORfsnETp"),
      caseCard("case-ocean-atmo-fusion", "海气融合预测模型搭建", "从 ERA5 与海温场出发，搭建海气融合预测模型可调试骨架与运行模板。", ["地球科学", "海气耦合", "ERA5"], "地球科学", "ses_173de5f78ffemATonCgBtx7ECA"),
      caseCard("case-xihe-parallel", "羲和模型并行训练改造", "对羲和气象模型进行并行训练改造，生成并行策略与任务提交脚本。", ["地球科学", "羲和", "并行训练"], "地球科学", "ses_131e650f7ffejnFYPuWmd1TBPr"),
      caseCard("case-ns-benchmark", "NS 方程多模型对比评测", "围绕 Navier-Stokes 方程，统一 FNO、DeepONet、PINNs 的数据与评估口径，横向对比。", ["流体仿真", "NS 方程", "评测"], "流体仿真", "ses_10bffedbbffeAnlewduYPOpjBz"),
    ],
  },
  docs: {
    eyebrow: "Docs and Downloads",
    title: "文档与下载中心",
    count: "共 18 个文档资源：用户手册 13，插件 4，发版记录 1",
    search: "搜索文档、版本或下载内容...",
    filters: ["全部", "用户手册", "插件", "发版记录"],
    items: docsItems,
  },
} as const

export function buildHomeAssetMetrics(input?: {
  primitiveCount?: number
  modelsCount?: number
  datasetsCount?: number
  appsCount?: number
}) {
  const modelsCount = input?.modelsCount ?? resourcePages.models.items.length
  const datasetsCount = input?.datasetsCount ?? resourcePages.datasets.items.length
  const appsCount = input?.appsCount ?? resourcePages.apps.items.length
  const primitiveCount = input?.primitiveCount ?? 0

  return {
    metrics: [
      {
        value: String(modelsCount),
        title: "领域模型",
        copy: "覆盖地球科学、生命科学、材料化学和流体仿真等方向",
        href: workspaceCapabilitiesCategoryHref("onemodel"),
        image: "/assets/onescience/domain-model.png",
      },
      {
        value: String(datasetsCount),
        title: "科学数据集",
        copy: "沉淀可接入、可追溯、可复用的领域先验知识",
        href: workspaceCapabilitiesCategoryHref("onedata"),
        image: "/assets/onescience/scientific-dataset.png",
      },
      {
        value: String(primitiveCount),
        title: "Skill原语",
        copy: "沉淀可被智能体调用、编排和复用的原语资产",
        href: workspaceCapabilitiesCategoryHref("oneskills"),
        image: "/assets/onescience/skill-primitives.png",
      },
    ],
    metricLinks: [
      {
        value: String(appsCount),
        title: "科研应用库",
        copy: "进入应用库资源界面查看可复用应用与模板",
        href: workspaceCapabilitiesCategoryHref("hpc"),
      },
      {
        value: String(resourcePages.frameworks.items.length),
        title: "多平台框架",
        copy: "进入框架资源界面查看训推与并行框架",
        href: workspaceCapabilitiesHref(),
      },
      {
        value: String(resourcePages.operators.items.length),
        title: "领域算子",
        copy: "进入算子资源界面查看领域与基础算子",
        href: workspaceCapabilitiesHref(),
      },
    ],
  }
}

const homeAssetMetrics = buildHomeAssetMetrics()

function deferIdleWork(work: () => void, delay = 200) {
  if (typeof window.requestIdleCallback === "function") {
    return window.requestIdleCallback(() => work())
  }
  return window.setTimeout(work, delay)
}

function cancelIdleWork(id: number) {
  if (typeof window.cancelIdleCallback === "function") {
    window.cancelIdleCallback(id)
    return
  }
  window.clearTimeout(id)
}

type CatalogCountPage = "datasets" | "models" | "apps" | "frameworks"

export function invalidateResourceCustomCountsCache() {
  invalidateCatalogMetricsCache()
}

export function buildMergedCatalogCounts(custom: ResourceCustomCounts) {
  return {
    datasets: resourcePages.datasets.items.length + custom.datasets,
    models: resourcePages.models.items.length + custom.models,
    apps: resourcePages.apps.items.length + custom.apps,
    frameworks: resourcePages.frameworks.items.length + (custom.frameworks ?? 0),
  }
}

export function countResourceItemsByDomain(pageKey: CatalogCountPage, items: readonly { id?: string; domain?: string; layer?: string; tags: readonly string[] }[]) {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const domain = resourceItemCatalogDomain(pageKey, item)
    counts[domain] = (counts[domain] ?? 0) + 1
  }
  return counts
}

export function mergeResourceDomainCounts(...parts: Array<Record<string, number> | undefined>) {
  const merged: Record<string, number> = {}
  for (const part of parts) {
    if (!part) continue
    for (const [domain, total] of Object.entries(part)) {
      merged[domain] = (merged[domain] ?? 0) + total
    }
  }
  return merged
}

const catalogPageLabels: Record<CatalogCountPage, string> = {
  datasets: "高质量数据集",
  models: "预训练模型",
  apps: "应用",
  frameworks: "AI 框架",
}

export function formatResourceCatalogSummary(pageKey: CatalogCountPage, domainCounts: Record<string, number>) {
  const filters = resourcePages[pageKey].filters.filter((filter) => filter !== "全部")
  const ordered = filters
    .map((filter) => ({ filter, total: domainCounts[filter] ?? 0 }))
    .filter((entry) => entry.total > 0)
  const extras = Object.entries(domainCounts)
    .filter(([domain, total]) => total > 0 && !(filters as readonly string[]).includes(domain))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([domain, total]) => ({ filter: domain, total }))
  const parts = [...ordered, ...extras].map((entry) => `${entry.filter} ${entry.total}`)
  const total = Object.values(domainCounts).reduce((sum, value) => sum + value, 0)
  return parts.length > 0
    ? `共 ${total} 个${catalogPageLabels[pageKey]}：${parts.join("，")}`
    : `共 ${total} 个${catalogPageLabels[pageKey]}`
}

export function formatResourceCatalogTotal(pageKey: ResourceKey, total: number) {
  return resourcePages[pageKey].count.replace(/共 \d+ 个/, `共 ${total} 个`)
}

type ResourceKey = keyof typeof resourcePages
const databaseOnlyResourcePages = new Set<ResourceKey>(["datasets", "models", "apps"])
const catalogSummaryPages = new Set<ResourceKey>(["datasets", "models", "apps", "frameworks"])
type ResourceItem =
  | ReturnType<typeof card>
  | ReturnType<typeof caseCard>
  | ReturnType<typeof dataset>
  | ReturnType<typeof model>
  | ReturnType<typeof scienceModel>
  | (typeof docsItems)[number]
type ResourceSource = { label: string; tone: "onescience" | "third-party" | "paper" | "local" }
type ResourceActionLink = { label: string; href: string }
type UploadableResourceKey = "datasets" | "models" | "apps" | "frameworks" | "skills"
type UploadedResource = {
  id: string
  page: UploadableResourceKey
  title: string
  copy: string
  domain: string
  tags: string[]
  provider: string
  size: string
  format: string
  href?: string
  source: ResourceSource["tone"]
  metricLabel: string
  action: string
  owner?: string
}
type UploadResourcePayload = Omit<UploadedResource, "id" | "metricLabel" | "action">
type UploadedResourcePageResult = { items: UploadedResource[]; nextOffset?: number; loaded?: boolean }
type SkillResourceItem = ReturnType<typeof card> & { layer: string; sortOrder?: number; timeCreated?: number; timeUpdated?: number }
type SkillPageResult = { items: SkillResourceItem[]; nextOffset?: number; loaded?: boolean }
export type TaskProfileItem = {
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
const taskProfileCardDescriptions = {
  "model-development": "构建或改造科学模型。",
  "dataset-building": "生成 AI-ready 数据集。",
  "data-analysis": "完成分析、可视化与报告。",
  "model-training": "生成配置并提交训练。",
  "model-inference-testing": "运行模型并评估结果。",
  "research-workflow-building": "编排端到端科研流程。",
  "paper-reproduction": "复现实验并生成报告。",
  "model-performance-analysis": "定位模型性能瓶颈。",
  "operator-performance-optimization": "优化热点 Kernel 并复测。",
  "model-optimization": "优化结构、指标与训练策略。",
  "model-adaptation": "生成适配器并完成验证。",
} as const
type TaskProfilePageResult = { items: TaskProfileItem[]; loaded?: boolean }
type StoredTaskProfilePageResult = { time: number; value: TaskProfilePageResult }
type AgentContractAsset = { path?: string; kind?: string; name?: string; title?: string; summary?: string; sections?: { title?: string; content?: string }[]; content?: string }
type AgentContract = { assetSkill?: string; purpose?: string; usage?: string[]; matchedAssets?: AgentContractAsset[] }
const uploadedResourceCache = new Map<string, UploadedResourcePageResult>()
const skillPageCache = new Map<string, SkillPageResult>()
const taskProfileCache = new Map<string, TaskProfilePageResult>()
const taskProfileStorageMaxAge = 1000 * 60 * 60
const aiPrimitiveStatusLabels: Record<AIPrimitiveStatus, string> = {
  draft: "草稿",
  callable: "可调用",
}
const primitiveTypeByCategory: Record<string, string> = {
  dataset: "data.load",
  model: "model",
  "model-training": "model.train",
  "model-inference": "model.run",
  "model-component": "code.generate",
  "data-processing": "data.transform",
  evaluation: "model.evaluate",
  app: "app.launch",
  "code-asset": "code.generate",
}
const renderedResourceCache = new Map<string, number>()
const resourceBatchSize = 24
const uploadedResourcePageSize = 24
type ModelLinks = { github?: string; docs?: string; paper?: string }
export const datasetDocLinks: Record<string, string> = {
  "earth-era5": "https://confluence.ecmwf.int/display/CKB/ERA5%3A+data+documentation",
  "earth-cmems": "https://catalogue.marine.copernicus.eu/documents/PUM/CMEMS-GLO-PUM-001-030.pdf",
  "earth-merra2": "https://gmao.gsfc.nasa.gov/pubs/docs/Bosilovich785.pdf",
  "earth-jra3q": "https://www.data.jma.go.jp/jra/html/JRA-3Q/document/JRA-3Q_TL479_format_v1_en.pdf",
  "earth-jra55": "https://www.data.jma.go.jp/jra/html/JRA-55/document/JRA-55_handbook_TL319_v2_en.pdf",
  "earth-ncep-ncar-r1": "https://psl.noaa.gov/data/gridded/data.ncep.reanalysis.html",
  "earth-gfs": "https://www.nco.ncep.noaa.gov/pmb/products/gfs/",
  "earth-gefs": "https://www.nco.ncep.noaa.gov/pmb/products/gens/",
  "earth-hrrr": "https://www.nco.ncep.noaa.gov/pmb/products/hrrr/",
  "earth-ecmwf-open-data": "https://confluence.ecmwf.int/display/DAC/ECMWF+open+data%3A+real-time+forecasts+from+IFS+and+AIFS",
  "earth-cmip6": "https://wcrp-cmip.org/cmip6/",
  "earth-s2s": "https://confluence.ecmwf.int/display/S2S",
  "earth-cfsv2": "https://www.nco.ncep.noaa.gov/pmb/products/cfs/",
  "earth-oisst": "https://www.ncei.noaa.gov/products/optimum-interpolation-sst",
  "earth-argo-gdac": "https://argo.ucsd.edu/data/data-faq/",
  "earth-wod": "https://www.ncei.noaa.gov/products/world-ocean-database",
  "earth-hycom-gofs": "https://www.hycom.org/dataserver",
  "earth-gpm-imerg": "https://gpm.nasa.gov/data/directory",
  "earth-chirps": "https://www.chc.ucsb.edu/data/chirps3",
  "earth-gldas": "https://ldas.gsfc.nasa.gov/gldas",
  "earth-smap": "https://nsidc.org/data/smap",
  "earth-grace-fo": "https://grace.jpl.nasa.gov/data/get-data/",
  "earth-nexrad-level2": "https://github.com/awslabs/open-data-docs/tree/main/docs/noaa/noaa-nexrad",
  "earth-mrms": "https://vlab.noaa.gov/web/wdtd/mrms-products-guide",
  "earth-goes-abi": "https://www.goes-r.gov/products/baseline-cloud-moisture-imagery.html",
  "earth-himawari-ahi": "https://www.data.jma.go.jp/mscweb/en/himawari89/space_segment/hsd_sample/HS_D_users_guide_en.pdf",
  "earth-modis": "https://modis.gsfc.nasa.gov/data/dataprod/",
  "earth-landsat-c2": "https://www.usgs.gov/landsat-missions/landsat-collection-2-level-2-science-products",
  "earth-noaa-20cr": "https://psl.noaa.gov/data/20thC_Rean/",
  "earth-cerra": "https://confluence.ecmwf.int/display/CKB/Copernicus+European+Regional+ReAnalysis+%28CERRA%29%3A+product+user+guide",
  "earth-cams-global-atmosphere": "https://confluence.ecmwf.int/display/CKB/CAMS%3A+Global+atmospheric+composition+forecast+data+documentation",
  "earth-cfsr": "https://www.nco.ncep.noaa.gov/pmb/products/cfs/",
  "earth-nam": "https://www.emc.ncep.noaa.gov/emc/pages/numerical_forecast_systems/nam.php",
  "earth-rap": "https://rapidrefresh.noaa.gov/",
  "earth-mur-sst": "https://podaac.github.io/tutorials/quarto_text/GHRSST.html",
  "earth-esa-sst-cci": "https://climate.esa.int/en/projects/sea-surface-temperature/",
  "earth-hadisst": "https://www.metoffice.gov.uk/hadobs/hadisst/",
  "earth-sea-ice-cdr": "https://www.ncei.noaa.gov/pub/data/sds/cdr/CDRs/Sea_Ice_Concentration/UserGuide_01B-11.pdf",
  "earth-ghcn-daily": "https://www.ncei.noaa.gov/pub/data/ghcn/daily/readme.txt",
  "earth-hadisd": "https://hadobs.metoffice.gov.uk/hadisd/",
  "earth-gistemp": "https://data.giss.nasa.gov/gistemp/faq/",
  "earth-berkeley-earth": "https://berkeleyearth.org/data/",
  "earth-cmorph-cdr": "https://www.ncei.noaa.gov/pub/data/sds/cdr/CDRs/Precipitation-CMORPH/",
  "earth-gsmap": "https://www.eorc.jaxa.jp/GPM/doc/data_utilization/GSMaP_Guidelines_E.pdf",
  "earth-persiann-cdr": "https://www.ncei.noaa.gov/products/climate-data-records/precipitation-persiann",
  "earth-cpc-unified-precip": "https://www.drought.gov/data-maps-tools/global-cpc-unified-daily-precipitation",
  "earth-sentinel1": "https://documentation.dataspace.copernicus.eu/Data/SentinelMissions/Sentinel1.html",
  "earth-sentinel2": "https://documentation.dataspace.copernicus.eu/Data/SentinelMissions/Sentinel2.html",
  "earth-sentinel3": "https://documentation.dataspace.copernicus.eu/Data/SentinelMissions/Sentinel3.html",
  "earth-sentinel5p": "https://documentation.dataspace.copernicus.eu/Data/SentinelMissions/Sentinel5P.html",
  "fluid-pdebench": "https://github.com/pdebench/PDEBench/tree/main/pdebench/data_download",
  "fluid-cfdbench": "https://arxiv.org/abs/2310.05963",
  "fluid-rpb-cno": "https://modelscope.cn/datasets/OneScience/RPB_CNO",
  "fluid-fno": "https://modelscope.cn/datasets/OneScience/FNO",
  "fluid-pointnet-cfd": "https://modelscope.cn/datasets/OneScience/pointnet_cfd",
  "fluid-pdearena": "https://pdearena.github.io/pdearena/",
  "fluid-blastnet": "https://arxiv.org/abs/2309.13457",
  "fluid-jhtdb": "https://turbulence.idies.jhu.edu/datasets",
  "fluid-deepmind-l2s": "https://arxiv.org/abs/2002.09405",
  "fluid-meshgraphnets": "https://arxiv.org/abs/2010.03409",
  "fluid-fda-blood-flow": "https://pubmed.ncbi.nlm.nih.gov/21428676/",
  "fluid-nasa-tmr": "https://tmbwg.github.io/turbmodels/",
  "fluid-spdebench": "https://arxiv.org/abs/2505.18511",
  "fluid-realpdebench": "https://github.com/AI4Science-WestlakeU/RealPDEBench",
  "fluid-drivaernet": "https://github.com/Mohamedelrefaie/DrivAerNet",
  "fluid-drivaerml": "https://arxiv.org/abs/2408.11969",
  "fluid-eagle-dataset": "https://arxiv.org/abs/2302.10803",
  "fluid-shapenet-car": "https://dl.acm.org/doi/10.1145/3197517.3201325",
  "fluid-airfrans": "https://airfrans.readthedocs.io/en/latest/",
  "fluid-geo-fno": "https://arxiv.org/abs/2207.05209",
  "fluid-bubbleml": "https://github.com/HPCForge/BubbleML",
  "fluid-rae2822-airfoil": "https://github.com/giovannicatalani/Aerodynamic-VAE",
  "fluid-cfdoneval": "https://github.com/Sysuzqs/CFDNNEval",
  "fluid-kolmogorov-flow-dns": "https://github.com/KovacsKA00/Nek5000-interpolation",
  "fluid-parameterized-u-bend": "https://zenodo.org/badge/latestdoi/612247257",
  "fluid-blendednet": "https://arxiv.org/abs/2509.07209",
  "fluid-naca0012-compressible": "https://data.mendeley.com/datasets/g3x4phfr3r/2",
  "life-pdb": "https://www.rcsb.org/docs/",
  "life-uniref90": "https://www.uniprot.org/help/uniref",
  "life-uniprot": "https://www.uniprot.org/help/uniprotkb",
  "life-bfd": "https://bfd.mmseqs.com/",
  "life-mgnify": "https://www.ebi.ac.uk/metagenomics/",
  "life-afdb-swissprot": "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/simplefold/README.md",
  "life-afesm": "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/simplefold/README.md",
  "life-afesme": "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/simplefold/README.md",
  "life-opengenome2": "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/evo2/README.md",
  "life-casp14": "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/simplefold/README.md",
  "life-cameo22": "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/simplefold/README.md",
  "life-apo": "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/simplefold/README.md",
  "life-codnas": "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/simplefold/README.md",
  "life-protenix-release-data": "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/protenix/README.md",
  "life-hg38-mm10-reference": "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/alphagenome/README.md",
  "life-ur50d-2021-04": "https://github.com/facebookresearch/esm",
  "life-esm-structural-split": "https://github.com/facebookresearch/esm",
  "life-esm-metagenomic-atlas": "https://github.com/facebookresearch/esm",
  "life-tahoe-100m": "https://arcinstitute.org/news/news/arc-virtual-cell-atlas-launch",
  "life-scbasecount": "https://arcinstitute.org/news/news/arc-virtual-cell-atlas-launch",
  "life-replogle-nadig-perturbseq": "https://github.com/ArcInstitute/state",
  "life-virtual-cell-challenge-dataset": "https://virtualcellchallenge.org/",
  "life-pdbbind": "https://www.pdbbind-plus.org.cn/",
  "life-bindingmoad": "https://github.com/gcorso/DiffDock",
  "life-dockgen": "https://github.com/gcorso/DiffDock",
  "life-posebusters-benchmark": "https://github.com/maabuu/posebusters",
  "life-crossdocked2020": "https://github.com/guanjq/targetdiff",
  "life-casf-2016": "https://github.com/sc8668/GenScore",
  "life-dekois2-dude-docking-poses": "https://github.com/sc8668/GenScore",
  "life-csar-nrc-hiq": "https://github.com/sc8668/GenScore",
  "life-merck-fep-benchmark": "https://github.com/sc8668/GenScore",
  "life-pdbbind-crossdocked-core": "https://github.com/sc8668/GenScore",
  "life-mimic-cxr": "https://developers.google.com/health-ai-developer-foundations/medgemma/model-card",
  "life-slake-vqa": "https://developers.google.com/health-ai-developer-foundations/medgemma/model-card",
  "life-pad-ufes-20": "https://developers.google.com/health-ai-developer-foundations/medgemma/model-card",
  "life-tcga": "https://developers.google.com/health-ai-developer-foundations/medgemma/model-card",
  "life-camelyon": "https://developers.google.com/health-ai-developer-foundations/medgemma/model-card",
  "life-pmc-oa": "https://developers.google.com/health-ai-developer-foundations/medgemma/model-card",
  "material-mptrj": "https://chgnet.lbl.gov/",
  "material-salex": "https://alexandria.icams.rub.de/",
  "material-omat24": "https://github.com/facebookresearch/fairchem/blob/main/docs/inorganic_materials/datasets/omat24.md",
  "material-omol25": "https://github.com/facebookresearch/fairchem/blob/main/docs/molecules/datasets/omol25.md",
  "material-oc20": "https://github.com/facebookresearch/fairchem/blob/main/docs/catalysts/datasets/oc20.md",
  "material-alexandria": "https://alexandria.icams.rub.de/",
  "material-oc22": "https://github.com/facebookresearch/fairchem/blob/main/docs/catalysts/datasets/oc22.md",
  "material-md22": "http://www.sgdml.org/",
  "material-deepmd-water-demo": "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem/dp",
  "material-mace-example": "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem/mace",
  "material-matpl-example": "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem/nep",
}

export const modelLinks: Record<string, ModelLinks> = {
  "GraphCast": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/earth/graphcast", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/earth/graphcast", paper: "https://www.science.org/doi/10.1126/science.adi2336" },
  "FourCastNet": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/earth/fourcastnet", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/earth/fourcastnet", paper: "https://arxiv.org/abs/2202.11214" },
  "FourCastNet_v2": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/earth/fourcastnet", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/earth/fourcastnet", paper: "https://arxiv.org/abs/2306.03838" },
  "OneForecast": { docs: "https://modelscope.cn/models/OneScience/OneForecast", paper: "https://arxiv.org/abs/2502.00338" },
  "StormCast": { docs: "https://modelscope.cn/models/OneScience/StormCast", paper: "https://arxiv.org/abs/2408.10958" },
  "GlobalSurgeML": { docs: "https://modelscope.cn/models/OneScience/GlobalSurgeML" },
  "FireCubeNet": { docs: "https://modelscope.cn/models/OneScience/FireCubeNet" },
  "WoFS-StormCal": { docs: "https://modelscope.cn/models/OneScience/WoFS-StormCal" },
  "ClimateBench": { docs: "https://modelscope.cn/models/OneScience/ClimateBench" },
  "CausalModelEvaluation": { docs: "https://modelscope.cn/models/OneScience/CausalModelEvaluation" },
  "Pangu-weather": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/earth/pangu_weather", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/earth/pangu_weather", paper: "https://www.nature.com/articles/s41586-023-06185-3" },
  "CorrDiff": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/earth/corrdiff", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/earth/corrdiff", paper: "https://arxiv.org/abs/2309.15214" },
  "FengWu": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/earth/fengwu", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/earth/fengwu", paper: "https://arxiv.org/abs/2304.02948" },
  "FuXi": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/earth/fuxi", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/earth/fuxi", paper: "https://www.nature.com/articles/s41612-023-00512-1" },
  "FuXi_v21": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/earth/fuxi", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/earth/fuxi", paper: "https://www.nature.com/articles/s41612-023-00512-1" },
  "XiHe": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/earth/xihe", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/earth/xihe", paper: "https://arxiv.org/abs/2402.02995" },
  "WenHai": { github: "https://github.com/Cuiyingzhe/WenHai", docs: "https://github.com/Cuiyingzhe/WenHai", paper: "https://www.nature.com/articles/s41467-025-57389-2" },
  "GenCast": { github: "https://github.com/google-deepmind/graphcast", docs: "https://deepmind.google/research/publications/gencast-learning-skillful-ensemble-forecasting-of-medium-range-weather/", paper: "https://www.nature.com/articles/s41586-024-08252-9" },
  "WeatherNext2": { docs: "https://deepmind.google/en/science/weathernext/", paper: "https://arxiv.org/abs/2506.10772" },
  "Artificial Intelligence Forecasting System": { github: "https://github.com/ecmwf/anemoi-core", docs: "https://anemoi.readthedocs.io/", paper: "https://arxiv.org/abs/2406.01465" },
  "AURORA": { github: "https://github.com/microsoft/aurora", docs: "https://microsoft.github.io/aurora/", paper: "https://www.nature.com/articles/s41586-025-09005-y" },
  "NeuralGCM": { github: "https://github.com/neuralgcm/neuralgcm", docs: "https://neuralgcm.readthedocs.io/", paper: "https://www.nature.com/articles/s41586-024-07744-y" },
  "PrithviWxC": { github: "https://github.com/NASA-IMPACT/Prithvi-WxC", docs: "https://www.earthdata.nasa.gov/news/blog/nasa-ibm-research-apply-ai-weather-climate", paper: "https://arxiv.org/abs/2409.13598" },
  "ClimaX": { github: "https://github.com/microsoft/ClimaX", docs: "https://microsoft.github.io/ClimaX/", paper: "https://arxiv.org/abs/2301.10343" },
  "metnet-3": { docs: "https://research.google/blog/metnet-3-a-state-of-the-art-neural-weather-model-available-in-google-products/", paper: "https://arxiv.org/abs/2306.06079" },
  "NowcastNet_Earth": { docs: "https://www.nature.com/articles/s41586-023-06184-4", paper: "https://www.nature.com/articles/s41586-023-06184-4" },
  "Deep-Generative-Model-of-Rain": { github: "https://github.com/deepmind/deepmind-research/tree/master/nowcasting", docs: "https://deepmind.google/discover/blog/nowcasting-the-next-hour-of-rain/", paper: "https://www.nature.com/articles/s41586-021-03854-z" },
  "Earthformer": { github: "https://github.com/amazon-science/earth-forecasting-transformer", docs: "https://gaozhihan.github.io/Earthformer/", paper: "https://arxiv.org/abs/2207.05833" },
  "Spherical-Fourier-Neural-Operators": { github: "https://github.com/NVIDIA/torch-harmonics", docs: "https://developer.nvidia.com/blog/modeling-earths-atmosphere-with-spherical-fourier-neural-operators/", paper: "https://proceedings.mlr.press/v202/bonev23a.html" },
  "deep-learning-weather-prediction": { github: "https://github.com/jweyn/DLWP", docs: "https://docs.nvidia.com/deeplearning/modulus/modulus-core-v040/examples/weather/dlwp/README.html", paper: "https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2020MS002109" },
  "Stormer": { github: "https://github.com/tung-nd/stormer", docs: "https://arxiv.org/abs/2312.03876", paper: "https://arxiv.org/abs/2312.03876" },
  "AtmoRep": { github: "https://github.com/clessig/atmorep", docs: "https://www.atmorep.org/", paper: "https://arxiv.org/abs/2308.13280" },
  "Aardvark-Weather": { github: "https://github.com/annavaughan/aardvark-weather-public", docs: "https://www.nature.com/articles/s41586-025-08897-0", paper: "https://www.nature.com/articles/s41586-025-08897-0" },
  "GraphDOP": { docs: "https://arxiv.org/abs/2412.15687", paper: "https://arxiv.org/abs/2412.15687" },
  "GLONET": { docs: "https://huggingface.co/mercator-ocean/GLONET", paper: "https://arxiv.org/abs/2412.05454" },
  "Ai2_Climate_Emulator": { github: "https://github.com/ai2cm/ace", docs: "https://allenai.org/blog/ai2-climate-emulator", paper: "https://arxiv.org/abs/2310.02074" },
  "Samudra": { github: "https://github.com/m2lines/Samudra", docs: "https://m2lines.github.io/code/", paper: "https://arxiv.org/abs/2412.03795" },
  "FuXi-S2S": { github: "https://github.com/tpys/FuXi-S2S", docs: "https://github.com/tpys/FuXi-S2S", paper: "https://www.nature.com/articles/s41467-024-50714-1" },
  "FengWu-W2S": { docs: "https://arxiv.org/abs/2411.10191", paper: "https://arxiv.org/abs/2411.10191" },
  "SEEDS": { docs: "https://research.google/pubs/seeds-emulation-of-weather-forecast-ensembles-with-diffusion-models/", paper: "https://arxiv.org/abs/2306.14066" },
  "ClimODE": { github: "https://github.com/Aalto-QuML/ClimODE", docs: "https://openreview.net/forum?id=xuY33XhEGR", paper: "https://arxiv.org/abs/2404.10024" },
  "Spherical DYffusion": { github: "https://github.com/Rose-STL-Lab/spherical-dyffusion", docs: "https://github.com/Rose-STL-Lab/spherical-dyffusion", paper: "https://arxiv.org/abs/2406.14798" },
  "W-MAE": { github: "https://github.com/Gufrannn/W-MAE", docs: "https://arxiv.org/abs/2304.08754", paper: "https://arxiv.org/abs/2304.08754" },
  "RainNet": { github: "https://github.com/hydrogo/rainnet", docs: "https://github.com/hydrogo/rainnet", paper: "https://gmd.copernicus.org/articles/13/2631/2020/" },
  "ConvLSTM": { docs: "https://papers.nips.cc/paper/5955-convolutional-lstm-network-a-machine-learning-approach-for-precipitation-nowcasting", paper: "https://papers.nips.cc/paper/5955-convolutional-lstm-network-a-machine-learning-approach-for-precipitation-nowcasting" },
  "SmaAt-UNet": { github: "https://github.com/HansBambel/SmaAt-UNet", docs: "https://github.com/HansBambel/SmaAt-UNet", paper: "https://arxiv.org/abs/2007.04417" },
  "Prithvi-EO": { github: "https://github.com/NASA-IMPACT/hls-foundation-os", docs: "https://huggingface.co/ibm-nasa-geospatial", paper: "https://arxiv.org/abs/2412.02732" },
  "TerraMind": { github: "https://github.com/IBM/terramind", docs: "https://github.com/IBM/terramind", paper: "https://arxiv.org/abs/2504.11171" },
  "Clay-Foundation-Model": { github: "https://github.com/Clay-foundation/model", docs: "https://clay-foundation.github.io/model/" },
  "AlphaEarthFoundations": { docs: "https://deepmind.google/blog/alphaearth-foundations-helps-map-our-planet-in-unprecedented-detail/", paper: "https://arxiv.org/abs/2507.22291" },
  "Surya": { github: "https://github.com/NASA-IMPACT/Surya", docs: "https://www.heliofm.org/", paper: "https://ntrs.nasa.gov/citations/20250008498" },
  "SatMAE": { github: "https://github.com/sustainlab-group/SatMAE", docs: "https://sustainlab-group.github.io/SatMAE/", paper: "https://arxiv.org/abs/2207.08051" },
  "SatMAE-PP": { github: "https://github.com/techmn/satmae_pp", docs: "https://github.com/techmn/satmae_pp", paper: "https://arxiv.org/abs/2403.05419" },
  "Scale-MAE": { docs: "https://openaccess.thecvf.com/content/ICCV2023/papers/Reed_Scale-MAE_A_Scale-Aware_Masked_Autoencoder_for_Multiscale_Geospatial_Representation_Learning_ICCV_2023_paper.pdf", paper: "https://arxiv.org/abs/2212.14532" },
  "DOFA": { github: "https://github.com/zhu-xlab/DOFA", docs: "https://huggingface.co/earthflow/DOFA", paper: "https://arxiv.org/abs/2403.15356" },
  "RemoteCLIP": { github: "https://github.com/ChenDelong1999/RemoteCLIP", docs: "https://github.com/ChenDelong1999/RemoteCLIP", paper: "https://arxiv.org/abs/2306.11029" },
  "SkySense": { github: "https://github.com/Jack-bo1220/SkySense", docs: "https://github.com/Jack-bo1220/SkySense", paper: "https://arxiv.org/abs/2312.10115" },
  "SpectralGPT": { github: "https://github.com/danfenghong/IEEE_TPAMI_SpectralGPT", docs: "https://github.com/danfenghong/IEEE_TPAMI_SpectralGPT", paper: "https://arxiv.org/abs/2311.07113" },
  "SatlasPretrain": { github: "https://github.com/allenai/satlaspretrain_models", docs: "https://satlas-pretrain.allen.ai/", paper: "https://openaccess.thecvf.com/content/ICCV2023/papers/Bastani_SatlasPretrain_A_Large-Scale_Dataset_for_Remote_Sensing_Image_Understanding_ICCV_2023_paper.pdf" },
  "AlphaFold": { github: "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/alphafold/README.md", docs: "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/alphafold/README.md", paper: "https://doi.org/10.1038/s41586-021-03819-2" },
  "OpenFold": { github: "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/openfold/monomer/inference.sh", docs: "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/openfold/monomer/inference.sh" },
  "AlphaFold3": { github: "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/alphafold3/README.md", docs: "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/alphafold3/README.md", paper: "https://www.nature.com/articles/s41586-024-07487-w" },
  "protenix": { github: "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/protenix/README.md", docs: "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/protenix/README.md", paper: "https://github.com/bytedance/Protenix/blob/main/Protenix_Technical_Report.pdf" },
  "RFdiffusion": { github: "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/RFdiffusion/RFdiffusion_README.md", docs: "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/RFdiffusion/RFdiffusion_README.md", paper: "https://www.nature.com/articles/s41586-023-06415-8" },
  "ProteinMPNN": { github: "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/ProteinMPNN/README.md", docs: "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/ProteinMPNN/README.md", paper: "https://www.biorxiv.org/content/10.1101/2022.06.03.494563v1" },
  "PT-DiT": { github: "https://gitee.com/onescience-ai/onescience/blob/main/src/onescience/flax_models/Pt_DiT/README.md", docs: "https://gitee.com/onescience-ai/onescience/blob/main/src/onescience/flax_models/Pt_DiT/README.md", paper: "https://doi.org/10.1101/2023.11.27.568722" },
  "SimpleFold": { github: "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/simplefold/README.md", docs: "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/simplefold/README.md", paper: "https://arxiv.org/abs/2509.18480" },
  "evo2": { github: "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/evo2/README.md", docs: "https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/evo2/README.md", paper: "https://www.biorxiv.org/content/10.1101/2025.02.18.638918v1" },
  "alphagenome": { github: "https://github.com/google-deepmind/alphagenome", docs: "https://www.alphagenomedocs.com/" },
  "MolSculptor": { github: "https://github.com/egg5154/MolSculptor", docs: "https://github.com/egg5154/MolSculptor", paper: "https://doi.org/10.26434/chemrxiv-2025-v4758" },
  "ESM": { github: "https://github.com/facebookresearch/esm", docs: "https://github.com/facebookresearch/esm", paper: "https://www.science.org/doi/abs/10.1126/science.ade2574" },
  "Foldseek": { github: "https://github.com/steineggerlab/foldseek", docs: "https://github.com/steineggerlab/foldseek/wiki", paper: "https://www.nature.com/articles/s41587-023-01773-0" },
  "STATE": { github: "https://github.com/ArcInstitute/state", docs: "https://github.com/ArcInstitute/state", paper: "https://www.biorxiv.org/content/10.1101/2025.06.26.661135v2" },
  "La-Proteina": { github: "https://github.com/NVIDIA-Digital-Bio/la-proteina", docs: "https://github.com/NVIDIA-Digital-Bio/la-proteina", paper: "https://arxiv.org/abs/2507.09466" },
  "DiffDock": { github: "https://github.com/gcorso/DiffDock", docs: "https://github.com/gcorso/DiffDock", paper: "https://arxiv.org/abs/2210.01776" },
  "TargetDiff": { github: "https://github.com/guanjq/targetdiff", docs: "https://github.com/guanjq/targetdiff", paper: "https://openreview.net/pdf?id=kJqXEPXMsE0" },
  "GenScore": { github: "https://github.com/sc8668/GenScore", docs: "https://github.com/sc8668/GenScore", paper: "https://doi.org/10.1039/D3SC02044D" },
  "Medgemma": { github: "https://github.com/Google-Health/medgemma", docs: "https://developers.google.com/health-ai-developer-foundations/medgemma/model-card", paper: "https://arxiv.org/abs/2604.05081" },
  "FNO": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/CFD_Benchmark", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/CFD_Benchmark", paper: "https://arxiv.org/abs/2010.08895" },
  "GFNO": { github: "https://gitee.com/onescience-ai/onescience/tree/main/src/onescience/models/cfd_benchmark/GFNO.py", docs: "https://gitee.com/onescience-ai/onescience/tree/main/src/onescience/models/cfd_benchmark/GFNO.py" },
  "DeepONet": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/PDENNEval", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/PDENNEval", paper: "https://arxiv.org/abs/1910.03193" },
  "MeshGraphNet": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/Vortex_shedding_mgn", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/Vortex_shedding_mgn", paper: "https://arxiv.org/abs/2010.03409" },
  "Transolver-Airfoil-Design": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/Transolver-Airfoil-Design", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/Transolver-Airfoil-Design", paper: "https://arxiv.org/abs/2402.02366" },
  "UNO": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/CFD_Benchmark", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/CFD_Benchmark", paper: "https://arxiv.org/abs/2204.11127" },
  "PINNs": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/PDENNEval", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/PDENNEval", paper: "https://arxiv.org/abs/1711.10561" },
  "Geo-FNO": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/CFD_Benchmark", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/CFD_Benchmark", paper: "https://arxiv.org/abs/2207.05209" },
  "GINO": { github: "https://github.com/neuraloperator/gino", paper: "https://arxiv.org/abs/2302.14376" },
  "MP_PDE": { github: "https://github.com/brandstetter-johannes/MP-Neural-PDE-Solvers", paper: "https://arxiv.org/abs/2202.03376" },
  "CNO": { github: "https://github.com/camlab-ethz/ConvolutionalNeuralOperator", paper: "https://arxiv.org/abs/2302.01178" },
  "FactFormer": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/CFD_Benchmark", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/CFD_Benchmark", paper: "https://arxiv.org/abs/2305.17560" },
  "GATr": { github: "https://github.com/Qualcomm-AI-research/geometric-algebra-transformer", paper: "https://arxiv.org/abs/2305.18415" },
  "Transolver-Car-Design": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/Transolver-Car-Design", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/Transolver-Car-Design", paper: "https://arxiv.org/abs/2511.06294" },
  "Factorized Fourier Neural Operator": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/CFD_Benchmark", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/CFD_Benchmark", paper: "https://arxiv.org/abs/2111.13802" },
  "KNO": { github: "https://github.com/Koopman-Laboratory/KoopmanLab", paper: "https://arxiv.org/abs/2301.10022" },
  "Multi-Scale Patch Transformer": { github: "https://github.com/pedrocurvo/mspt", paper: "https://arxiv.org/abs/2512.01738" },
  "Universal Physics Transformers": { github: "https://github.com/ml-jku/UPT", paper: "https://arxiv.org/abs/2402.12365" },
  "Anchored-Branched Universal Physics Transformers": { github: "https://github.com/Emmi-AI/anchored-branched-universal-physics-transformers", paper: "https://arxiv.org/abs/2502.09692" },
  "OFormer": { github: "https://github.com/BaratiLab/OFormer", paper: "https://openreview.net/forum?id=EPPqt3uERT" },
  "PointNetCFD": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/CFD_Benchmark", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/CFD_Benchmark" },
  "ONO": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/CFD_Benchmark", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/CFD_Benchmark", paper: "https://arxiv.org/abs/2310.12487" },
  "Poseidon": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/CFD_Benchmark", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/CFD_Benchmark", paper: "https://arxiv.org/abs/2405.19101" },
  "DiffusionPDE": { github: "https://github.com/jhhuangchloe/DiffusionPDE", paper: "https://arxiv.org/abs/2406.17763" },
  "Diffusion Graph Net": { github: "https://github.com/tum-pbs/dgn4cfd", paper: "https://arxiv.org/abs/2504.02843" },
  "EagleMeshTransformer": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/EagleMeshTransformer", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/EagleMeshTransformer", paper: "https://arxiv.org/abs/2302.10803" },
  "XPINNs": { github: "https://github.com/AmeyaJagtap/XPINNs", paper: "https://www.global-sci.com/cicp/article/view/6911" },
  "cPINN": { github: "https://github.com/AmeyaJagtap/Conservative_PINNs", paper: "https://doi.org/10.1016/j.cma.2020.113028" },
  "gPINNs": { github: "https://github.com/lu-group/gpinn", paper: "https://doi.org/10.1016/j.cma.2022.114823" },
  "VPINNs": { github: "https://github.com/cmgcds/fastvpinns", paper: "https://arxiv.org/abs/2404.12063" },
  "BPINNs": { github: "https://github.com/jjdabr/BPINN-Wildfire", paper: "https://arxiv.org/abs/2212.00970" },
  "SA-PINNs": { github: "https://github.com/levimcclenny/SA-PINNs", paper: "https://arxiv.org/abs/2009.04544" },
  "FPINNs": { github: "https://github.com/lululxvi/deepxde", paper: "https://arxiv.org/abs/1811.08967" },
  "GP_for_TO": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/GP_for_TO", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/GP_for_TO" },
  "PINNsformer": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/PINNsformer", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/PINNsformer" },
  "U-FNO": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/PINNsformer", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/PINNsformer", paper: "https://arxiv.org/abs/2109.03697" },
  "MWT": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/CFD_Benchmark", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/CFD_Benchmark", paper: "https://arxiv.org/abs/2109.13459" },
  "Galerkin Transformer": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/CFD_Benchmark", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/CFD_Benchmark", paper: "https://arxiv.org/abs/2105.14995" },
  "MACE": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem" },
  "UMA": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem" },
  "DeePMD": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem", paper: "https://arxiv.org/abs/1707.09571" },
  "NEP": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem", paper: "https://arxiv.org/abs/2205.10046" },
  "MatRIS": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem", paper: "https://arxiv.org/abs/2603.02002" },
  "TACE": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem", paper: "https://arxiv.org/abs/2509.14961" },
  "Nequix": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem", paper: "https://arxiv.org/abs/2508.16067" },
  "Mattersim": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem", paper: "https://arxiv.org/abs/2405.04967" },
  "GRACE": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem", paper: "https://arxiv.org/abs/2508.17936" },
  "Allegro": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem", paper: "https://www.nature.com/articles/s41467-023-36329-y" },
  "Mattergen": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem/mattergen", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem/mattergen" },
  "Equiformer_v3": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem/equiformer_v3", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem/equiformer_v3", paper: "https://arxiv.org/abs/2604.09130" },
  "eSEN": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem/esen", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem/esen" },
  "NequIP": { github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem/nequip", docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem/nequip", paper: "https://www.nature.com/articles/s41467-022-29939-5" },
}

export function getResourceSource(item: ResourceItem): ResourceSource {
  if (isUploadedResource(item)) {
    if (item.source === "onescience") return { label: "OneScience", tone: "onescience" }
    if (item.source === "paper") return { label: "论文资料", tone: "paper" }
    if (item.source === "local") return { label: "本地入口", tone: "local" }
    if (item.page === "datasets") return { label: "第三方数据", tone: "third-party" }
    return { label: "第三方资源", tone: "third-party" }
  }
  const itemHref = "href" in item && typeof item.href === "string" ? item.href : undefined
  if ("id" in item) {
    const modelScopeDataset = modelScopeDatasetId(item.id)
    if (modelScopeDataset?.startsWith("OneScience/")) {
      return { label: "OneScience", tone: "onescience" }
    }
  }
  if ("title" in item) {
    const modelScopeModel = modelScopeModelId(item.title)
    if (modelScopeModel?.startsWith("OneScience/")) {
      return { label: "OneScience", tone: "onescience" }
    }
  }
  if (itemHref?.includes("modelscope.cn/datasets/OneScience/")) {
    return { label: "OneScience", tone: "onescience" }
  }
  const links = modelLinks[item.title]
  const href = links?.docs ?? links?.paper ?? ("id" in item ? datasetDocLinks[item.id] ?? itemHref : itemHref)
  if (!href) return { label: "本地入口", tone: "local" }
  if (href.includes("gitee.com/onescience-ai") || href.includes("github.com/onescience-ai") || href.includes("dos.sourcefind.cn") || href.includes("das.sourcefind.cn")) {
    return { label: "OneScience", tone: "onescience" }
  }
  if (href.includes("modelscope.cn/datasets/OneScience/")) {
    return { label: "OneScience", tone: "onescience" }
  }
  if (href.includes("arxiv.org") || href.includes("nature.com") || href.includes("science.org") || href.includes("openreview.net")) {
    return { label: "论文资料", tone: "paper" }
  }
  if ("id" in item && (item.id.startsWith("earth-") || item.id.startsWith("fluid-") || item.id.startsWith("life-") || item.id.startsWith("material-"))) {
    return { label: "第三方数据", tone: "third-party" }
  }
  return { label: "第三方资源", tone: "third-party" }
}

function isUploadedResource(item: ResourceItem): item is UploadedResource {
  return "source" in item && "page" in item
}

function isUserUploadedResource(item: ResourceItem): item is UploadedResource {
  return isUploadedResource(item) && item.id.startsWith("custom-")
}

function currentResourceAccountId() {
  return storedPlatformAuthSession()?.account.id
}

function isOwnUploadedResource(item: ResourceItem) {
  if (!isUserUploadedResource(item)) return false
  const accountId = currentResourceAccountId()
  return Boolean(accountId && item.owner === accountId)
}

/** Pre-auth legacy uploads with no owner — visible and deletable by any signed-in user. */
function isOrphanUploadedResource(item: ResourceItem) {
  return isUserUploadedResource(item) && !item.owner
}

function canDeleteUploadedResource(item: ResourceItem) {
  if (!currentResourceAccountId()) return false
  return isOwnUploadedResource(item) || isOrphanUploadedResource(item)
}

/** Logged-in users can edit presets, their own uploads, and orphan uploads; guests cannot. */
function canEditResource(item: ResourceItem) {
  if (!currentResourceAccountId()) return false
  if (isUserUploadedResource(item)) return isOwnUploadedResource(item) || isOrphanUploadedResource(item)
  return true
}

function card(id: string, title: string, copy: string, tags: string[], provider: string, size: string, format: string, href?: string, links?: readonly ResourceActionLink[]) {
  return { id, title, copy, tags, provider, size, format, href, ...(links && links.length > 0 ? { links } : {}), metricLabel: "规模", action: href ? "安装" : "导入" }
}

function caseCard(id: string, title: string, copy: string, tags: string[], domain: string, sessionId: string) {
  return { id, title, copy, tags, provider: "OneScience", size: domain, format: "可复现", domain, sessionId, metricLabel: "领域", action: "基于此开发" as const }
}

function dataset(id: string, title: string, copy: string, tags: string[], provider: string, size: string, format: string, href?: string) {
  return {
    id,
    title,
    copy,
    tags,
    provider,
    size,
    format,
    href,
    metricLabel: "数据源",
    action: href || modelScopeDatasetId(id) ? "下载" : "导入",
  }
}

function scienceModel(id: string, title: string, copy: string, tags: string[], domain: string, framework: string) {
  return {
    id,
    title,
    copy,
    tags: tags.filter((tag) => !hiddenResourceTags.has(tag)),
    provider: domain,
    size: framework,
    format: "预训练模型",
    metricLabel: "框架",
    action: "开发",
  }
}

function model(id: string, title: string, copy: string, tags: string[], provider: string, framework: string, params: string, score: string) {
  return { id, title, copy, tags, provider, size: params, format: framework, metricLabel: "参数量", score, action: "开发" }
}

function ResourceCopy(props: { copy: string; plain?: boolean }) {
  // Only treat short "Label：" prefixes as titles (e.g. datasets). Mid-sentence
  // colons in skill/primitive overviews must stay plain so card copy color stays uniform.
  const splitIndex = () => {
    if (props.plain) return -1
    const index = props.copy.indexOf("：")
    if (index <= 0 || index > 40) return -1
    return index
  }
  return (
    <p class="os-resource-card-copy">
      <Show when={splitIndex() > 0} fallback={props.copy}>
        <strong>{props.copy.slice(0, splitIndex())}</strong>
        {props.copy.slice(splitIndex())}
      </Show>
    </p>
  )
}

const resourceFilterIds: Partial<Record<ResourceKey, Record<string, readonly string[]>>> = {
  datasets: {
    地球科学: ["earth"],
    生命科学: ["life"],
    材料化学: ["material"],
    流体仿真: ["fluid"],
    其它: ["tools"],
  },
  models: {
    地球科学: ["modelhub"],
    生命科学: ["life"],
    材料化学: ["material"],
    流体仿真: ["fluid"],
    其它: ["tools"],
  },
  frameworks: {
    训练框架: ["framework-training"],
    并行训练: ["framework-parallel"],
    推理框架: ["framework-inference"],
  },
  operators: {
    基础算子: ["operator"],
    科学算子: ["sci-operator"],
    通信算子: ["comm-operator"],
  },
  research: {
    物理AI: ["physical-ai"],
    具身智能: ["embodied-ai"],
    自动驾驶: ["autonomous-driving"],
    世界模型: ["world-model"],
  },
  docs: {
    用户手册: ["用户手册"],
    插件: ["插件"],
    发版记录: ["发版记录"],
  },
}

const resourceHashToFilter: Partial<Record<ResourceKey, Record<string, string>>> = {
  datasets: {
    life: "生命科学",
    drug: "生命科学",
    earth: "地球科学",
    material: "材料化学",
    fluid: "流体仿真",
    general: "其它",
    tools: "其它",
    components: "其它",
  },
  models: {
    modelhub: "地球科学",
    life: "生命科学",
    material: "材料化学",
    fluid: "流体仿真",
    tools: "其它",
  },
  frameworks: {
    aiframe: "训练框架",
    scaleframe: "并行训练",
    inferframe: "推理框架",
  },
  operators: {
    operator: "基础算子",
    "sci-operator": "科学算子",
    "comm-operator": "通信算子",
  },
  research: {
    "physical-ai": "物理AI",
    "embodied-ai": "具身智能",
    "autonomous-driving": "自动驾驶",
    "world-model": "世界模型",
  },
  cases: {
    earth: "地球科学",
    material: "材料化学",
    life: "生命科学",
    fluid: "流体仿真",
    other: "其它",
    "case-cfdbench": "流体仿真",
    "case-esm2": "生命科学",
    "case-fourcastnet": "地球科学",
    "case-fuxi": "地球科学",
    "case-mace": "材料化学",
    "case-matris": "材料化学",
    "case-mace-water-pes": "材料化学",
    "case-meshgraphnet": "流体仿真",
    "case-proteinmpnn": "生命科学",
    "case-rae2822-fno": "流体仿真",
    "case-aifs-repro": "其它",
    "case-fuxi-forecast-smoke": "地球科学",
    "case-fuxi-run-test": "地球科学",
    "case-ocean-atmo-fusion": "地球科学",
    "case-xihe-parallel": "地球科学",
    "case-ns-benchmark": "流体仿真",
  },
  docs: {
    manual: "用户手册",
    plugins: "插件",
    release: "发版记录",
  },
}

export function resourceFilterFromHash(pageKey: ResourceKey, hash: string, filters: readonly string[]) {
  const raw = hash.replace(/^#/, "").trim().toLowerCase()
  if (!raw) return undefined
  let fragment = raw
  try {
    fragment = decodeURIComponent(raw)
  } catch {
    fragment = raw
  }
  const mapping = resourceHashToFilter[pageKey]
  const mapped = mapping?.[fragment] ?? mapping?.[raw]
  if (mapped && filters.includes(mapped)) return mapped
  const direct = filters.find((filter) => {
    const lower = filter.toLowerCase()
    return lower === fragment || lower === raw
  })
  if (direct) return direct
  return undefined
}

export function resourceHashFromFilter(pageKey: ResourceKey, filter: string) {
  if (filter === "全部") return ""
  const mapping = resourceHashToFilter[pageKey]
  if (!mapping) return filter
  for (const [hash, mappedFilter] of Object.entries(mapping)) {
    if (mappedFilter === filter) return hash
  }
  return filter
}

export function itemMatchesResourceFilter(
  pageKey: ResourceKey,
  filter: string,
  item: { id?: string; domain?: string; layer?: string; tags: readonly string[] },
) {
  if (filter === "全部") return true
  const filterLower = filter.toLowerCase()
  const ids = resourceFilterIds[pageKey]?.[filter]
  const itemId = item.id

  if (itemId && ids?.some((id) => itemId === id || itemId.startsWith(`${id}-`))) return true
  if (item.layer === filter) return true
  if (item.domain === filter) return true
  return item.tags.some((tag) => tag.toLowerCase() === filterLower || tag.toLowerCase().includes(filterLower))

}

export function resourceCatalogFilters(pageKey: ResourceKey) {
  return resourcePages[pageKey].filters.filter((filter) => filter !== "全部")
}

export function resourceItemCatalogDomain(
  pageKey: ResourceKey,
  item: { id?: string; domain?: string; layer?: string; tags: readonly string[] },
) {
  const filters = resourceCatalogFilters(pageKey)
  const preferred = filters.filter((filter) => filter !== "其它")
  for (const filter of preferred) {
    if (itemMatchesResourceFilter(pageKey, filter, item)) return filter
  }
  if (filters.includes("其它")) return "其它"
  for (const filter of filters) {
    if (itemMatchesResourceFilter(pageKey, filter, item)) return filter
  }
  return filters[0] ?? "其它"
}

export function filterResourceItems(pageKey: ResourceKey, filter: string, items: readonly ResourceItem[]) {
  if (filter === "全部") return items
  if (filter === "其它" && resourceCatalogFilters(pageKey).includes("其它")) {
    const preferred = resourceCatalogFilters(pageKey).filter((entry) => entry !== "其它")
    return items.filter((item) => {
      if (preferred.some((entry) => itemMatchesResourceFilter(pageKey, entry, item))) return false
      return true
    })
  }
  return items.filter((item) => itemMatchesResourceFilter(pageKey, filter, item))
}

const builtInCatalogDomainCounts = {
  datasets: countResourceItemsByDomain("datasets", resourcePages.datasets.items),
  models: countResourceItemsByDomain("models", resourcePages.models.items),
  apps: countResourceItemsByDomain("apps", resourcePages.apps.items),
  frameworks: countResourceItemsByDomain("frameworks", resourcePages.frameworks.items),
} as const

export function formatResourceCatalogCount(pageKey: ResourceKey, total: number) {
  return formatResourceCatalogTotal(pageKey, total)
}

const emptyStateResourcePages = new Set<ResourceKey>(["datasets", "models", "apps", "cases"])

export function resourceListEmptyMessage(page: ResourceKey, filter: string, query: string) {
  const resourceLabel =
    page === "datasets" ? "数据集"
    : page === "models" ? "模型"
    : page === "apps" ? "应用"
    : page === "cases" ? "案例"
    : "资源"
  const trimmedQuery = query.trim()
  if (trimmedQuery) return `未找到与「${trimmedQuery}」匹配的${resourceLabel}，请调整搜索词或切换标签。`
  if (filter === "全部") return `暂无可展示的${resourceLabel}。`
  if (page === "cases") {
    if (filter === "其它") {
      return `当前「其它」标签下暂无案例，可切换到「全部」查看已有内容。`
    }
    return `当前「${filter}」标签下暂无案例，可切换到「全部」查看或尝试其他标签。`
  }
  if (filter === "其它") {
    return `当前「其它」标签下暂无${resourceLabel}，可切换到「全部」查看已有内容，或通过上传补充。`
  }
  return `当前「${filter}」标签下暂无${resourceLabel}，可切换到「全部」查看或尝试其他标签。`
}

export function searchResourceItems(query: string, items: readonly ResourceItem[]) {
  const q = query.trim()
  if (!q) return items
  return items.filter((item) =>
    fuzzyMatchParts(
      [
        item.title,
        item.copy,
        item.provider,
        item.format,
        "id" in item ? item.id : "",
        "domain" in item && typeof item.domain === "string" ? item.domain : "",
        ...item.tags,
      ],
      q,
    ),
  )
}

export function isModelScopeResourceAvailable(page: ResourceKey, item: ResourceItem) {
  if (isUserUploadedResource(item)) return true
  if (page === "models") return !!modelScopeModelId(item.title)
  if (page === "datasets" && "id" in item) return !!modelScopeDatasetId(item.id)
  return true
}

export function sortResourceItemsByModelScopeAvailability(page: ResourceKey, items: readonly ResourceItem[]) {
  if (page !== "models" && page !== "datasets") return items
  const available: ResourceItem[] = []
  const unavailable: ResourceItem[] = []
  for (const item of items) {
    if (isModelScopeResourceAvailable(page, item)) available.push(item)
    else unavailable.push(item)
  }
  return [...available, ...unavailable]
}

function useHomeAuthSession() {
  const [epoch, setEpoch] = createSignal(0)
  const session = createMemo(() => {
    epoch()
    return storedPlatformAuthSession()
  })
  onMount(() => {
    const bump = () => setEpoch((value) => value + 1)
    window.addEventListener(platformAuthLoggingOutEvent, bump)
    window.addEventListener(platformAuthSessionUpdatedEvent, bump)
    window.addEventListener(platformWorkspaceCacheClearedEvent, bump)
    window.addEventListener("storage", bump)
    onCleanup(() => {
      window.removeEventListener(platformAuthLoggingOutEvent, bump)
      window.removeEventListener(platformAuthSessionUpdatedEvent, bump)
      window.removeEventListener(platformWorkspaceCacheClearedEvent, bump)
      window.removeEventListener("storage", bump)
    })
  })
  return session
}

function ProductHeader() {
  const navigate = useNavigate()
  const session = useHomeAuthSession()
  return (
    <header class="os-topbar os-product-topbar sticky top-0 z-50">
      <div class="os-container flex min-h-16 min-w-0 items-center justify-between gap-4">
        <A href="/" class="os-brand shrink-0">
          <span class="os-brand-mark">✣</span>
          <span class="os-brand-copy">
            <span class="os-brand-name">OneScience</span>
            <span class="os-brand-subtitle">智能科研平台</span>
          </span>
        </A>
        <nav class="hidden min-w-0 flex-1 items-center justify-center gap-1 overflow-visible xl:flex">
          <For each={productNav}>
            {(item) => (
              <div class="group relative">
                <button class="os-nav-button">{item.label}</button>
                <div class="invisible absolute left-1/2 top-full w-[36rem] -translate-x-1/2 translate-y-2 pt-3 opacity-0 transition group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100">
                  <div class="os-menu">
                    <div class="os-menu-head">
                      <p>{item.copy}</p>
                    </div>
                    <div class="grid grid-cols-2 gap-1 p-2">
                      <For each={item.items}>
                        {(entry) => (
                          <A href={entry.href} class="os-menu-item">
                            <span>{entry.title}</span>
                            <small>{entry.copy}</small>
                          </A>
                        )}
                      </For>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </For>
        </nav>
        <div class="flex shrink-0 items-center gap-2">
          <ProductNavMobileMenu nav={productNav} variant="light" />
          <Show
            when={session()}
            fallback={
              <>
                <A
                  href={platformAuthUrl({ pathname: "/workspace", search: "", hash: "" })}
                  class="os-button os-button-primary"
                >
                  登录
                </A>
                <button class="os-button os-button-secondary" onClick={() => navigate("/workspace")}>
                  进入工作台
                </button>
              </>
            }
          >
            <button class="os-button os-button-primary" onClick={() => navigate("/workspace")}>
              进入工作台
            </button>
          </Show>
        </div>
      </div>
    </header>
  )
}

function ProductFooter() {
  return (
    <footer id="contact" class="os-footer">
      <div class="os-container grid gap-8 lg:grid-cols-[1fr_1fr_1fr]">
        <div>
          <div class="os-footer-title">OneScience</div>
          <p class="mt-2 text-13-regular leading-6 text-slate-500">知识驱动的智能科研平台</p>
        </div>
        <div>
          <div class="os-footer-heading">联系方式</div>
          <div class="os-footer-links">
            <a href="https://github.com/onescience-ai">GitHub：onescience-ai</a>
            <a href="https://gitee.com/onescience-ai">Gitee：onescience-ai</a>
          </div>
        </div>
        <div>
          <div class="os-footer-heading">社区共建</div>
          <div class="mt-3 flex flex-wrap gap-2">
            <For each={communityChips}>{(item) => <span class="os-chip">{item}</span>}</For>
          </div>
        </div>
      </div>
    </footer>
  )
}

export default function OneScienceHome() {
  const platform = usePlatform()
  // Desktop skips the marketing landing page and opens the workbench.
  // Keep this as a thin wrapper so Solid hooks in the landing page stay unconditional.
  return (
    <Show when={platform.platform !== "desktop"} fallback={<Navigate href="/workspace" />}>
      <OneScienceHomeLanding />
    </Show>
  )
}

function OneScienceHomeLanding() {
  const navigate = useNavigate()
  const server = useServer()
  const sync = useGlobalSync()
  const [prompt, setPrompt] = createSignal("")
  const [showScrollCue, setShowScrollCue] = createSignal(true)
  const [callablePrimitiveCount, setCallablePrimitiveCount] = createSignal<number | undefined>()
  const [resourceCatalogCounts, setResourceCatalogCounts] = createSignal<Partial<ReturnType<typeof buildMergedCatalogCounts>>>()
  let homeMetricsRequest = 0
  let mainRef: HTMLElement | undefined

  const applyHomeMetrics = (metrics: CatalogMetrics) => {
    setResourceCatalogCounts(buildMergedCatalogCounts(metrics))
    setCallablePrimitiveCount(metrics.callablePrimitives)
  }

  const refreshHomeMetrics = (serverUrl: string) => {
    const cached = readCatalogMetricsCache(serverUrl)
    if (cached) applyHomeMetrics(cached)
    const requestId = ++homeMetricsRequest
    void Promise.all([
      fetchCatalogMetrics(serverUrl, { refresh: true }),
      fetchCallablePrimitiveTotal(serverUrl, { refresh: true }),
    ]).then(([metrics, callableTotal]) => {
      if (requestId !== homeMetricsRequest) return
      const resourceCounts = metrics ?? cached
      if (!resourceCounts && callableTotal === undefined) return
      const merged: CatalogMetrics = {
        datasets: resourceCounts?.datasets ?? cached?.datasets ?? 0,
        models: resourceCounts?.models ?? cached?.models ?? 0,

        apps: resourceCounts?.apps ?? cached?.apps ?? 0,
        frameworks: resourceCounts?.frameworks ?? cached?.frameworks ?? 0,
        byDomain: resourceCounts?.byDomain ?? cached?.byDomain ?? { datasets: {}, models: {}, apps: {}, frameworks: {} },

        callablePrimitives: callableTotal ?? resourceCounts?.callablePrimitives ?? cached?.callablePrimitives ?? 0,
      }
      if (callableTotal !== undefined || metrics) storeCatalogMetricsCache(serverUrl, merged)
      applyHomeMetrics(merged)
    })
  }

  createEffect(on(
    () => server.current?.http.url,
    (serverUrl) => {
      if (!serverUrl) return
      refreshHomeMetrics(serverUrl)
    },
  ))

  onMount(() => {
    const onInvalidate = () => {
      const serverUrl = server.current?.http.url
      if (serverUrl) refreshHomeMetrics(serverUrl)
    }
    window.addEventListener("onescience:catalog-metrics-invalidated", onInvalidate)
    onCleanup(() => window.removeEventListener("onescience:catalog-metrics-invalidated", onInvalidate))
  })

  const homeAssetMetricsView = createMemo(() =>
    buildHomeAssetMetrics({
      ...(callablePrimitiveCount() !== undefined ? { primitiveCount: callablePrimitiveCount() } : {}),
      ...(resourceCatalogCounts()?.models !== undefined ? { modelsCount: resourceCatalogCounts()?.models } : {}),
      ...(resourceCatalogCounts()?.datasets !== undefined ? { datasetsCount: resourceCatalogCounts()?.datasets } : {}),
      ...(resourceCatalogCounts()?.apps !== undefined ? { appsCount: resourceCatalogCounts()?.apps } : {}),
    }),
  )

  const updateScrollCue = () => {
    const root = mainRef
    if (!root) return
    const atBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - 12
    setShowScrollCue(!atBottom)
  }

  useScrollContainerRestoration("/", () => mainRef)

  onMount(() => {
    updateScrollCue()
    mainRef?.addEventListener("scroll", updateScrollCue, { passive: true })
    window.addEventListener("resize", updateScrollCue, { passive: true })
    onCleanup(() => {
      mainRef?.removeEventListener("scroll", updateScrollCue)
      window.removeEventListener("resize", updateScrollCue)
    })
  })

  const scrollDownPage = () => {
    const root = mainRef
    if (!root) return
    const productContent = root.querySelector("#product-content")
    if (productContent) {
      const rootTop = root.getBoundingClientRect().top
      const contentTop = productContent.getBoundingClientRect().top - rootTop + root.scrollTop
      if (root.scrollTop < contentTop - 12) {
        productContent.scrollIntoView({ behavior: "smooth", block: "start" })
        return
      }
    }
    root.scrollBy({ top: root.clientHeight * 0.85, behavior: "smooth" })
  }

  const submitPrompt = () => {
    const text = prompt().trim()
    if (!text) return

    navigate(codePromptHref(defaultCodeWorkspaceDirectory(), text))

  }

  return (
    <main ref={mainRef} class="onescience-page os-page min-h-full overflow-y-auto">
      <ProductHeader />
      <section class="os-hero-section os-product-hero">
        <div class="os-hero-network" aria-hidden="true">
          <For each={heroLines}>
            {(line) => (
              <span
                class="os-hero-line"
                style={{ left: `${line[0]}%`, top: `${line[1]}%`, width: `${line[2]}rem`, transform: `rotate(${line[3]}deg)` }}
              />
            )}
          </For>
          <For each={heroNodes}>
            {(node) => <span class="os-hero-node" style={{ left: `${node[0]}%`, top: `${node[1]}%`, transform: `scale(${node[2]})` }} />}
          </For>
        </div>
        <div class="os-container os-hero-center">
          <h1 class="os-hero-title">
            OneScience
            <span>智能科研平台</span>
          </h1>
          <p class="os-hero-copy">
            <strong>革新科研开发流程，</strong>
            <strong>以知识为核心，实现智能化代码开发、科研任务编排和结果复现。</strong>
          </p>
          <div class="os-hero-actions">
            <A href="/workspace" class="os-button os-button-primary os-button-large">立即体验</A>
            <A href={workspaceCapabilitiesCategoryHref("onemodel")} class="os-button os-button-secondary os-button-large">查看知识资产矩阵</A>
            <span class="os-button os-button-ghost os-button-large os-hero-repo-links">
              <a href="https://github.com/onescience-ai" target="_blank" rel="noreferrer">GitHub</a>
              <span aria-hidden="true">/</span>
              <a href="https://gitee.com/onescience-ai" target="_blank" rel="noreferrer">Gitee</a>
            </span>
          </div>
        </div>
      </section>

      <Show when={showScrollCue()}>
        <button type="button" class="os-hero-scroll-cue" aria-label="向下滚动查看更多内容" onClick={scrollDownPage}>
          <Icon name="chevron-down" size="large" class="os-hero-scroll-cue-icon" />
        </button>
      </Show>

      <section id="product-content" class="os-section os-section-white">
        <div class="os-container grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div class="os-video-panel">
            <div class="os-video-inner os-video-embed">
              <iframe
                title="OneScience Demo"
                src="https://player.bilibili.com/player.html?bvid=BV187V96qEF1&page=1"
                scrolling="no"
                frameborder="0"
                allowfullscreen
              />
            </div>
          </div>
          <div class="self-start">
            <h2 class="os-section-title mt-3">从一个科研目标进入智能开发</h2>
            <p class="os-section-copy">开发者可以先选择数据集、模型、组件、算力环境和评估指标，再通过 OneSkills 把这些先验知识与工程资产编排成可运行、可追踪、可复用的科研工作流。</p>
            <div class="mt-7 flex flex-wrap gap-3 text-14-bold">
              <A href="/workspace" class="os-button os-button-primary">进入开发工作台</A>
              <A href={workspaceCapabilitiesCategoryHref("oneskills")} class="os-button os-button-secondary">查看 OneSkills</A>
            </div>
          </div>
        </div>
      </section>

      <Section title="用知识驱动科研智能化开发">
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <For each={highlights}>{(item) => <InfoCard title={item[0]} copy={item[1]} image={item[2]} />}</For>
        </div>
      </Section>

      <Section title="可复用的先验知识与工程资产">
        <div class="grid gap-4 md:grid-cols-3">
          <For each={homeAssetMetricsView().metrics}>
            {(item) => (
              <A href={item.href} class="os-metric-card">
                <img class="os-metric-card-bg" src={item.image} alt="" loading="lazy" />
                <span class="os-metric-card-arrow">查看资源</span>
                <div class="os-metric-card-value">{item.value}</div>
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
              </A>
            )}
          </For>
        </div>
        <div class="mt-4 grid gap-4 md:grid-cols-3">
          <For each={homeAssetMetricsView().metricLinks}>
            {(item) => (
              <A href={item.href} class="os-metric-card os-metric-card-plain">
                <span class="os-metric-card-arrow">查看资源</span>
                <div class="os-metric-card-value">{item.value}</div>
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
              </A>
            )}
          </For>
        </div>
      </Section>

      <section class="os-section os-case-section">
        <div class="os-container os-case-layout">
          <div>
            <h2 class="os-section-title mt-3">典型科研智能化案例</h2>
            <p class="os-section-copy mt-4">围绕气象、材料、PDE 和科学模型扩展等高频科研开发场景，将知识资产、工程流程和智能体执行沉淀为可复用案例。</p>
          </div>
          <div class="os-case-list">
            <For each={caseShowcases}>
              {(item, index) => <CaseShowcaseRow item={item} index={index()} />}
            </For>
          </div>
        </div>
      </section>

      <Section title="平台支持">
        <div class="grid gap-4 md:grid-cols-4">
          <For each={achievements}>
            {(item) => (
              <article class="os-achievement-card">
                <img src={item.image} alt="" loading="lazy" />
                <div class="os-achievement-card-body">
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                </div>
              </article>
            )}
          </For>
        </div>
      </Section>

      <section class="os-section">
        <a
          href={oneScienceCommunityHref}
          target="_blank"
          rel="noreferrer"
          class="os-container os-join-panel os-join-panel-link"
          aria-label="加入 OneScience 社区，前往魔搭社区主页"
        >
          <div>
            <h2 class="os-section-title mt-3">加入OneScience社区</h2>
            <p class="os-section-copy os-join-copy">
              围绕科学模型研发构建、国产模型生态建设，开放欢迎科研团队、开发者、模型作者、数据贡献者和工程伙伴一起沉淀模型、数据、组件和技能，构建面向科学发现的先验知识生态。
              对社区贡献者提供算力和模型服务支持。
            </p>
          </div>
          <div class="grid gap-3 md:grid-cols-2">
            <For each={communityItems}>
              {(item) => (
                <article class="os-community-card">
                  <h3>{item[0]}</h3>
                  <p>{item[1]}</p>
                </article>
              )}
            </For>
          </div>
        </a>
      </section>
      <ProductFooter />
    </main>
  )
}

function Section(props: { eyebrow?: string; title: string; children: JSX.Element; id?: string }) {
  return (
    <section id={props.id} class="os-section">
      <div class="os-container">
        <div class="os-section-head">
          {props.eyebrow && <div class="os-eyebrow">{props.eyebrow}</div>}
          <h2 class="os-section-title">{props.title}</h2>
        </div>
        {props.children}
      </div>
    </section>
  )
}

function InfoCard(props: { title: string; copy: string; image: string }) {
  return (
    <article class="os-info-card">
      <div class="os-info-card-media">
        <img src={props.image} alt="" loading="lazy" />
      </div>
      <div class="os-info-card-content">
        <h3>{props.title}</h3>
        <p>{props.copy}</p>
      </div>
    </article>
  )
}

function WorkspaceAccountStatus(props: { collapsed: () => boolean }) {
  const platform = usePlatform()
  const navigate = useNavigate()
  const location = useLocation()
  const [state, setState] = createStore<{
    session?: PlatformAuthSession
    loading: boolean
    error: string
  }>({
    loading: true,
    error: "",
  })
  const [open, setOpen] = createSignal(false)

  onMount(() => {
    const cached = storedPlatformAuthSession()
    if (cached) setState({ session: cached, loading: false, error: "" })

    const token = storedPlatformAuthToken()
    if (!token) {
      setState({ loading: false, error: "" })
      return
    }

    void resolvePlatformAuthSession(token)
      .then(async (session) => {
        await storePlatformAuthSession(session, platform.storage)
        setState({ session, loading: false, error: "" })
      })
      .catch((error) => {
        // Keep the cached session on transport failures; only surface auth rejection.
        if (cached && !isPlatformAuthRejection(error)) {
          setState({ session: cached, loading: false, error: "" })
          return
        }
        setState({ loading: false, error: error instanceof Error ? error.message : "会话已失效" })
      })
  })

  const logout = () => {
    setOpen(false)
    void clearPlatformAuthSession(platform.storage).finally(() => {
      if (platform.platform === "desktop") {
        navigate("/login", { replace: true })
        return
      }
      window.location.assign("/login")
    })
  }

  return (
    <div class="os-sidebar-account" data-collapsed={props.collapsed() ? "true" : undefined}>
      <Show
        when={state.session}
        fallback={
          <A
            href={platformAuthUrl({
              pathname: location.pathname || "/",
              search: location.search || "",
              hash: location.hash || "",
            })}
            class="os-sidebar-link os-sidebar-link-fold os-sidebar-account-trigger"
            title={props.collapsed() ? "登录账号" : undefined}
          >
            <span class="os-sidebar-account-avatar" aria-hidden="true">
              <WorkspaceNavIcon name="users" />
            </span>
            <span class="os-sidebar-label">
              <strong>{state.loading ? "检查登录状态" : "未登录"}</strong>
              <span>{state.error || "登录后使用个人工作区"}</span>
            </span>
          </A>
        }
      >
        {(session) => (
          <DropdownMenu open={open()} onOpenChange={(value) => setOpen(value)} placement="right-end" gutter={8}>
            <DropdownMenu.Trigger
              as="button"
              type="button"
              class="os-sidebar-link os-sidebar-link-fold os-sidebar-account-trigger"
              aria-label={`账号管理 · ${accountTitle(session())}`}
              title={accountTriggerTitle(session())}
            >
              <span class="os-sidebar-account-avatar" aria-hidden="true">
                {accountInitials(session())}
              </span>
              <span class="os-sidebar-label">
                <strong>{session().account.name}</strong>
                <span>账号管理</span>
              </span>
              <Icon name={open() ? "chevron-left" : "chevron-right"} size="small" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content class="os-sidebar-account-menu">
                <div class="os-sidebar-account-menu-summary">
                  <span>账号管理</span>
                  <strong>{session().account.name}</strong>
                  <p>{session().account.email}</p>
                  <Show when={accountWorkspaceShortLabel(session())}>
                    {(label) => <p class="os-sidebar-account-menu-workspace">{label()}</p>}
                  </Show>
                </div>
                <DropdownMenu.Item
                  class="os-sidebar-account-menu-item"
                  onSelect={() => {
                    setOpen(false)
                    window.location.assign("/account")
                  }}
                >
                  <span class="os-sidebar-account-menu-icon" aria-hidden="true">
                    <WorkspaceNavIcon name="users" />
                  </span>
                  <DropdownMenu.ItemLabel>账号中心</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item class="os-sidebar-account-menu-item os-sidebar-account-menu-logout" onSelect={logout}>
                  <span class="os-sidebar-account-menu-icon" aria-hidden="true">
                    <Icon name="arrow-left" size="small" />
                  </span>
                  <DropdownMenu.ItemLabel>退出登录</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>
        )}
      </Show>
    </div>
  )
}

function accountInitials(session: PlatformAuthSession) {
  return (session.account.name.trim() || session.account.email.trim() || "OS").slice(0, 2).toUpperCase()
}

function accountTitle(session: PlatformAuthSession) {
  return `${session.account.name} · ${session.account.email}`
}

function accountWorkspaceShortLabel(session: PlatformAuthSession) {
  const workspace =
    session.workspaces.find((item) => item.role === "admin") ?? session.workspaces[0]
  if (!workspace) return
  const name = workspace.name.trim()
  if (name) return name
  const slug = workspace.slug.trim()
  if (slug) return slug
  const path = workspace.defaultEnvPath.trim().replaceAll("\\", "/")
  const segment = path.split("/").filter(Boolean).at(-1)
  return segment || undefined
}

function accountTriggerTitle(session: PlatformAuthSession) {
  const workspace = accountWorkspaceShortLabel(session)
  const path = defaultPlatformProjectDirectory(session)
  const parts = ["账号管理", accountTitle(session)]
  if (workspace) parts.push(workspace)
  if (path && path !== workspace) parts.push(path)
  return parts.join(" · ")
}

export function WorkspaceShell(props: { children: JSX.Element }) {
  const platform = usePlatform()
  const navGroups = () => (platform.platform === "desktop" ? desktopWorkbenchNavGroups : workspaceNavGroups)

  const location = useLocation()
  const sync = useGlobalSync()
  const layout = useLayout()
  const server = useServer()
  const globalSDK = useGlobalSDK()
  const dialog = useDialog()
  const onCodeRoute = createMemo(() => location.pathname.startsWith("/code"))
  const [userCollapsed, setUserCollapsed] = createSignal(false)
  const collapsed = createMemo(() => onCodeRoute() || userCollapsed())
  const [openNavGroups, setOpenNavGroups] = createSignal(["OneHub"])
  let preloadedCodeSignature = ""
  const recent = createMemo(() =>
    codeWorkspaceRecentProjects(
      filterPlatformAccountProjects(
        [
          ...sync.data.project
            .reduce((projects, project) => {
              projects.set(project.worktree, {
                expanded: true,
                ...layout.projects.list().find((item) => item.worktree === project.worktree),
                ...project,
              })
              return projects
            }, new Map(layout.projects.list().map((project) => [project.worktree, project])))
            .values(),
        ],
        storedPlatformAuthSession(),
      ),
    ),
  )
  const developmentEntryHref = createMemo(() =>
    workspaceDevelopmentEntryHref({
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
      path: sync.data.path,
      recent: recent(),
      defaultDirectory: configuredCodeDefaultDirectory(document, sync.data.path),
      lastCodeWorkspace: server.projects.lastCode(),
    }),
  )
  const preloadCodeWorkspace = () => {
    if (!sync.bootstrapped || !server.ready()) return
    const directory = codeEntryWorkspaceDirectory({
      path: sync.data.path,
      recent: recent(),
      lastCodeWorkspace: server.projects.lastCode(),
    })
    const signature = `${directory}\0${server.projects.lastCode() ?? ""}`
    if (preloadedCodeSignature === signature) return
    preloadedCodeSignature = signature
    layout.projects.open(directory)
    void globalSDK.client.project.current({ directory }).catch(() => undefined)
  }

  createEffect(() => {
    if (!sync.bootstrapped || !server.ready()) return
    server.projects.lastCode()
    preloadCodeWorkspace()
  })

  createEffect(() => {
    const activeGroup = navGroups()
      .flatMap((group) => group)
      .find((item) => "items" in item && item.items.some((child) => location.pathname === child.href || location.pathname.startsWith(child.href)))
    if (!activeGroup || untrack(() => openNavGroups().includes(activeGroup.label))) return
    setOpenNavGroups((groups) => [...groups, activeGroup.label])
  })

  const isGroupOpen = (item: WorkspaceNavItem) => "items" in item && openNavGroups().includes(item.label)

  const toggleNavGroup = (label: string) => {
    setOpenNavGroups((groups) => (groups.includes(label) ? groups.filter((group) => group !== label) : [...groups, label]))
  }

  const activateNavGroup = (label: string) => {
    if (onCodeRoute()) {
      toggleNavGroup(label)
      return
    }
    if (collapsed()) {
      setUserCollapsed(false)
      setOpenNavGroups((groups) => (groups.includes(label) ? groups : [...groups, label]))
      return
    }
    toggleNavGroup(label)
  }

  const openWorkspaceSettings = () => {
    // Eager import: avoids a second hashed chunk fetch (stale deploys used to fail silently here).
    dialog.show(() => <DialogSettings />)
  }

  return (
    <main
      classList={{
        "onescience-workspace os-workspace min-h-full": true,
        "os-workspace-collapsed": collapsed(),
        "os-workspace-code": onCodeRoute(),
        "os-desktop-shell": platform.platform === "desktop",
      }}
    >
      <aside class="os-sidebar">
        <div
          class="os-sidebar-brand"
          {...(platform.platform === "desktop" ? { "data-tauri-drag-region": true } : {})}
        >
          <A href={platform.platform === "desktop" ? "/workspace" : "/"} class="os-sidebar-brand-link">
            <span class="os-brand-mark os-brand-mark-large">✣</span>
            <span class="os-sidebar-label">{platform.platform === "desktop" ? "OneCode" : "OneScience"}</span>
          </A>
          <button
            type="button"
            class="os-sidebar-toggle"
            onClick={() => {
              if (onCodeRoute()) return
              setUserCollapsed((value) => !value)
            }}
            aria-label={collapsed() ? "展开导航" : "收起导航"}
            disabled={onCodeRoute() ? true : undefined}
          >
            <Icon name={collapsed() ? "chevron-right" : "chevron-left"} size="small" />
          </button>
        </div>
        <nav class="os-sidebar-nav">
          <For each={navGroups()}>
            {(group) => (
              <div class="os-sidebar-group">
                <For each={group}>
                  {(item) => {
                    const active = () =>
                      "items" in item
                        ? item.items.some((child) => location.pathname === child.href || location.pathname.startsWith(child.href))
                        : item.icon === "code"
                          ? location.pathname.startsWith("/workspace/") && location.pathname.includes("/session")
                          : item.href === "/workspace"
                            ? location.pathname === "/workspace" || location.pathname.startsWith("/workspace/capabilities")
                            : location.pathname === item.href || location.pathname.startsWith(item.href)
                    const href = () =>
                      "items" in item ? item.items[0].href : item.icon === "code" ? developmentEntryHref() : item.href
                    if ("items" in item)
                      return (
                        <div classList={{ "os-sidebar-fold": true, "is-open": isGroupOpen(item) }}>
                          <button
                            type="button"
                            classList={{ "os-sidebar-link": true, "os-sidebar-link-fold": true }}
                            title={collapsed() ? item.label : undefined}
                            aria-expanded={isGroupOpen(item)}
                            onClick={() => activateNavGroup(item.label)}
                          >
                            <WorkspaceNavIcon name={item.icon} />
                            <span class="os-sidebar-label">{item.label}</span>
                            <Icon name={isGroupOpen(item) ? "chevron-down" : "chevron-right"} size="small" />
                          </button>
                          <div class="os-sidebar-subnav">
                            <For each={item.items}>
                              {(child) => (
                                <A
                                  href={child.href}
                                  classList={{
                                    "os-sidebar-link": true,
                                    "os-sidebar-link-sub": true,
                                    "is-active": location.pathname === child.href || location.pathname.startsWith(child.href),
                                  }}
                                  title={collapsed() ? child.label : undefined}
                                >
                                  <WorkspaceNavIcon name={child.icon} />
                                  <span class="os-sidebar-label">{child.label}</span>
                                </A>
                              )}
                            </For>
                          </div>
                        </div>
                      )
                    return (
                      <A
                        href={href()}
                        classList={{ "os-sidebar-link": true, "is-active": active() }}
                        title={collapsed() ? item.label : undefined}
                        onPointerEnter={item.icon === "code" ? preloadCodeWorkspace : undefined}
                        onFocus={item.icon === "code" ? preloadCodeWorkspace : undefined}
                      >
                        <WorkspaceNavIcon name={item.icon} />
                        <span class="os-sidebar-label">{item.label}</span>
                      </A>
                    )
                  }}
                </For>
              </div>
            )}
          </For>
        </nav>
        <div class="os-sidebar-footer">
          <WorkspaceAccountStatus collapsed={collapsed} />
          <button
            type="button"
            class="os-sidebar-link os-sidebar-action"
            title={collapsed() ? "设置" : undefined}
            data-action="workspace-settings"
            onClick={openWorkspaceSettings}
          >
            <WorkspaceNavIcon name="settings" />
            <span class="os-sidebar-label">设置</span>
          </button>
        </div>
      </aside>
      <section class="os-workspace-main">
        <Show when={platform.platform === "desktop" && !location.pathname.startsWith("/code")}>
          <div class="os-desktop-main-drag" data-tauri-drag-region aria-hidden="true" />
        </Show>
        {props.children}
      </section>
      {/* Toast.Region for OneHub pages; /code keeps its own region inside Layout to avoid duplicates. */}
      <Show when={!location.pathname.startsWith("/code")}>
        <Toast.Region />
      </Show>
    </main>
  )
}

function useCodePromptHref() {
  const server = useServer()
  const sync = useGlobalSync()
  const layout = useLayout()
  const recent = createMemo(() =>
    codeWorkspaceRecentProjects(
      filterPlatformAccountProjects(
        [
          ...sync.data.project
            .reduce((projects, project) => {
              projects.set(project.worktree, {
                expanded: true,
                ...layout.projects.list().find((item) => item.worktree === project.worktree),
                ...project,
              })
              return projects
            }, new Map(layout.projects.list().map((project) => [project.worktree, project])))
            .values(),
        ],
        storedPlatformAuthSession(),
      ),
    ),
  )
  return (text: string) => {
    const directory = codeEntryWorkspaceDirectory({
      path: sync.data.path,
      recent: recent(),
      lastCodeWorkspace: server.projects.lastCode(),
    })
    layout.projects.open(directory)
    server.projects.touchCode(directory)
    return codePromptHref(directory, text)
  }
}

function useWorkspaceDirectory() {
  const server = useServer()
  const sync = useGlobalSync()
  const layout = useLayout()
  const recent = createMemo(() =>
    codeWorkspaceRecentProjects(
      filterPlatformAccountProjects(
        [
          ...sync.data.project
            .reduce((projects, project) => {
              projects.set(project.worktree, {
                expanded: true,
                ...layout.projects.list().find((item) => item.worktree === project.worktree),
                ...project,
              })
              return projects
            }, new Map(layout.projects.list().map((project) => [project.worktree, project])))
            .values(),
        ],
        storedPlatformAuthSession(),
      ),
    ),
  )
  const directory = createMemo(() =>
    oneScienceResourceWorkspaceDirectory(
      sync.data.path,
      recent(),
      configuredCodeDefaultDirectory(document, sync.data.path),
      server.projects.last(),
    ),
  )
  return directory
}

function useModelScopeDownloadRecords(directory: () => string) {
  const server = useServer()
  const sync = useGlobalSync()
  const [records, setRecords] = createSignal<Record<string, ModelScopeDownloadRecord>>({})
  const [pinnedDirectory, setPinnedDirectory] = createSignal<string | undefined>()
  let pollTimer: number | undefined

  const activeDirectory = createMemo(() => pinnedDirectory() ?? directory())

  const refresh = async () => {
    const current = server.current
    const path = activeDirectory()
    if (!current || !path) return
    const items = await listModelScopeDownloads(current.http.url, path).catch(() => undefined)
    if (!items) return
    setRecords(Object.fromEntries(items.map((item) => [downloadRecordKeyOf(item), item])))
  }

  const ensurePoll = () => {
    if (pollTimer !== undefined) return
    pollTimer = window.setInterval(() => {
      void refresh()
    }, 2_000)
  }

  createEffect(() => {
    if (Object.values(records()).some((item) => item.status === "downloading")) {
      ensurePoll()
      return
    }
    if (pollTimer !== undefined) {
      window.clearInterval(pollTimer)
      pollTimer = undefined
    }
  })

  onMount(() => {
    void refresh()
    onCleanup(() => {
      if (pollTimer !== undefined) window.clearInterval(pollTimer)
    })
  })

  createEffect(() => {
    sync.data.path.directory
    sync.data.path.worktree
    sync.data.path.home
    activeDirectory()
    server.projects.last()
    if (!server.ready() || !server.current) return
    void refresh()
  })

  createEffect(() => {
    if (Object.values(records()).some((item) => item.status === "downloading")) return
    setPinnedDirectory(undefined)
  })

  const applyRecord = (record: ModelScopeDownloadRecord) => {
    setRecords((current) => ({ ...current, [downloadRecordKeyOf(record)]: record }))
  }

  return {
    records,
    refresh,
    start: async (resourceId: string, environment?: ModelScopeDownloadStartEnvironment) => {
      const current = server.current
      const path = directory()
      if (!current || !path) return
      setPinnedDirectory(path)
      applyRecord(await startModelScopeDatasetDownload(current.http.url, path, resourceId, environment))
      ensurePoll()
      void refresh()
    },
    cancel: async (resourceId: string, environment?: ModelScopeDownloadEnvironment) => {
      const current = server.current
      const path = activeDirectory()
      if (!current || !path) return
      const key = downloadRecordKey(environment, resourceId)
      let record: ModelScopeDownloadRecord | undefined
      try {
        record = await cancelModelScopeDatasetDownload(current.http.url, path, resourceId, environment)
      } catch {
        record = {
          resource_id: resourceId,
          kind: "dataset",
          status: "failed",
          started_at: records()[key]?.started_at ?? Date.now(),
          finished_at: Date.now(),
          error: "cancelled",
          ...(environment ? { environment } : {}),
        }
      }
      applyRecord(record)
      await refresh()
      if (records()[key]) return
      if (record.status !== "partial") return
      applyRecord(record)
    },
    remove: async (resourceId: string, environment?: ModelScopeDownloadEnvironment) => {
      const current = server.current
      const path = activeDirectory()
      if (!current || !path) return
      const key = downloadRecordKey(environment, resourceId)
      setRecords((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
      await deleteModelScopeDatasetDownload(current.http.url, path, resourceId, environment)
      await refresh()
    },
  }
}

function useModelScopeSessionNavigate() {
  const server = useServer()
  const sync = useGlobalSync()
  const layout = useLayout()
  const navigate = useNavigate()
  const directory = useWorkspaceDirectory()
  return (prompt: string, options?: Parameters<typeof prepareModelScopeSession>[2]) => {
    const path = directory()
    layout.projects.open(path)
    server.projects.touch(path)
    navigate(prepareModelScopeSession(path, prompt, options))
  }
}

export function WorkspaceHomeHubSections() {
  const workspaceDirectory = useWorkspaceDirectory()
  const modelScopeDownloads = useModelScopeDownloadRecords(workspaceDirectory)

  return (
    <For each={workspaceHomeHubSections}>
      {(section) => (
        <section class="os-home-hub-section">
          <div class="os-home-hub-head">
            <h2 class="os-block-title">{section.title}</h2>
            <A class="os-home-hub-more" href={section.href}>
              <span>查看全部</span>
              <Icon name="chevron-right" size="small" />
            </A>
          </div>
          <div class="os-resource-grid os-home-hub-grid">
            <For each={section.itemTitles}>
              {(title) => {
                const item = () => findResourceItemByTitle(section.page, title)
                return (
                  <Show when={item()}>
                    {(resolved) => (
                      <ResourceCard
                        page={section.page}
                        item={resolved()}
                        workspaceDirectory={section.page === "datasets" ? workspaceDirectory() : undefined}
                        modelScopeDownloads={section.page === "datasets" ? modelScopeDownloads : undefined}
                        onDatasetDownloadStart={section.page === "datasets" ? modelScopeDownloads.start : undefined}
                        onDatasetDownloadCancel={section.page === "datasets" ? modelScopeDownloads.cancel : undefined}
                        onDatasetDownloadDelete={section.page === "datasets" ? modelScopeDownloads.remove : undefined}
                      />
                    )}
                  </Show>
                )
              }}
            </For>
          </div>
        </section>
      )}
    </For>
  )
}

export function WorkspaceHomePage() {
  const navigate = useNavigate()
  const codePrompt = useCodePromptHref()
  const [draft, setDraft] = createSignal("")
  const submitDraft = () => {
    const text = draft().trim()
    if (!text) return
    navigate(codePrompt(text))
  }

  return (
    <div class="os-workspace-content">
      <div class="os-workspace-container">
        <div class="os-workspace-hero">
          <h1>
            <span>OneScience</span>智能科研工作台
          </h1>
          <p>定义结构，智能生成，可验证运行</p>
        </div>
        <form
          class="os-prompt-panel"
          onSubmit={(e) => {
            e.preventDefault()
            submitDraft()
          }}
        >
          <textarea
            id="onescience-ai-prompt"
            class="os-prompt-input"
            aria-label="AI 输入框"
            rows={4}
            value={draft()}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.shiftKey) return
              e.preventDefault()
              submitDraft()
            }}
            onInput={(e) => setDraft((e.currentTarget as HTMLTextAreaElement).value)}
            placeholder="描述你想开发的科学模型，例如：创建一个基于 Transformer 的气候预测模型..."
          />
          <div class="os-prompt-actions">
            <span class="os-prompt-hint">按 Enter 发送，Shift + Enter 换行</span>
            <button class="os-button os-button-primary os-prompt-submit" type="submit" disabled={!draft().trim()}>发送</button>
          </div>
        </form>
        <WorkspaceHomeHubSections />
        <h2 class="os-block-title os-home-domain-title">领域工作台</h2>
        <div class="os-domain-grid">
          <For each={domainWorkbenches}>
            {(item) => (
              <a href={item.href} class="os-domain-card">
                <img class="os-domain-card-bg" src={item.image} alt="" loading="lazy" />
                <div class="os-domain-card-content">
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                </div>
              </a>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}

function skillLayerIdFromHash(hash: string) {
  const raw = hash.replace(/^#/, "").trim().toLowerCase()
  if (!raw) return undefined
  let fragment = raw
  try {
    fragment = decodeURIComponent(raw)
  } catch {
    fragment = raw
  }
  return skillSystemGroups.find((group) => group.id === fragment || group.title === fragment)?.id
}

function SkillsDynamicPage() {
  const page = resourcePages.skills
  const location = useLocation()
  const server = useServer()
  const globalSDK = useGlobalSDK()
  const workspaceDirectory = useWorkspaceDirectory()
  const [selectedFilter, setSelectedFilter] = createSignal<string>(page.filters[0])
  const [searchQuery, setSearchQuery] = createSignal("")
  const [items, setItems] = createSignal<readonly SkillResourceItem[]>([])
  const [loaded, setLoaded] = createSignal(false)
  const [updating, setUpdating] = createSignal(false)
  const [updateError, setUpdateError] = createSignal<string>()
  const [highlightedLayer, setHighlightedLayer] = createSignal<string>()
  const uploadSkillHref = createMemo(() => codeSkillManagerHref(workspaceDirectory(), "upload"))
  const canManageSkills = createMemo(() => Boolean(storedPlatformAuthSession()?.account.id))
  const visibleItems = createMemo(() =>
    searchResourceItems(
      searchQuery().trim(),
      filterResourceItems("skills", selectedFilter(), items()),
    ),
  )
  const reloadSkills = async () => {
    const current = server.current
    if (!current) {
      setItems([])
      setLoaded(true)
      return
    }
    resetUploadedResourceCache()
    const result = await listOneScienceSkills(current.http.url, { limit: 100 })
    setItems(result.items)
    setLoaded(true)
  }
  onMount(async () => {
    await reloadSkills()
    const off = globalSDK.event.listen((event) => {
      if (event.name !== "global") return
      if (String(event.details.type) !== "oneskills.upgraded") return
      void reloadSkills()
    })
    onCleanup(off)
  })
  createEffect(on(
    () => [location.hash, loaded()] as const,
    ([hash, isLoaded]) => {
      if (!isLoaded) return
      const layerId = skillLayerIdFromHash(hash)
      if (!layerId) return
      setHighlightedLayer(undefined)
      let frame = 0
      frame = window.requestAnimationFrame(() => {
        setHighlightedLayer(layerId)
        document.getElementById(layerId)?.scrollIntoView({ behavior: "smooth", block: "center" })
      })
      const timer = window.setTimeout(() => setHighlightedLayer(undefined), 2400)
      onCleanup(() => {
        if (frame) window.cancelAnimationFrame(frame)
        window.clearTimeout(timer)
      })
    },
  ))
  const handleUpgrade = async () => {
    if (!canManageSkills()) return
    const current = server.current
    if (!current) {
      const message = formatOneSkillsUpgradeError("更新 OneSkills 失败：请先连接平台服务")
      setUpdateError(message)
      showToast({ variant: "error", title: "更新失败", description: message })
      return
    }
    setUpdating(true)
    setUpdateError(undefined)
    try {
      const result = await upgradeOneSkills(current.http.url)
      await reloadSkills()
      const skillSummary = result.version
        ? `版本 ${result.version} · ${result.skillCount} 个技能`
        : `${result.skillCount} 个技能`
      const seedSummary =
        result.seedSource === "bundled" && result.seedFallbackReason
          ? "原语已回退内置 seed"
          : result.seedSource === "disk"
            ? "原语已同步磁盘 oneskills"
            : undefined
      showToast({
        variant: "success",
        title: "OneSkills 已更新",
        description: seedSummary ? `${skillSummary} · ${seedSummary}` : skillSummary,
      })
    } catch (error) {
      const message = formatOneSkillsUpgradeError(
        error instanceof Error ? error.message : "更新 OneSkills 失败",
      )
      setUpdateError(message)
      showToast({ variant: "error", title: "更新失败", description: message })
    } finally {
      setUpdating(false)
    }
  }
  return (
    <div class="os-workspace-content">
      <div class="os-workspace-container">
        <div class="os-resource-head">
          <div>
            <div class="os-eyebrow">{page.eyebrow}</div>
            <h1>{page.title}</h1>
            <Show when={updateError()}>
              <p class="os-data-empty">{updateError()}</p>
            </Show>
          </div>
        </div>
        <div class="os-resource-toolbar">
          <label class="os-search-box">
            <span class="os-search-box-icon" aria-hidden="true">⌕</span>
            <input
              type="search"
              placeholder={page.search}
              value={searchQuery()}
              onInput={(event) => setSearchQuery(event.currentTarget.value)}
            />
          </label>
          <div class="os-resource-head-actions">
            <span
              class="inline-flex"
              title={canManageSkills() ? undefined : "登录后使用"}
            >
              <button
                type="button"
                class="os-button os-button-secondary"
                disabled={!canManageSkills() || updating()}
                onClick={() => void handleUpgrade()}
              >
                {updating() ? "更新中..." : "更新 OneSkills"}
              </button>
            </span>
            <Show
              when={canManageSkills()}
              fallback={
                <span class="inline-flex" title="登录后使用">
                  <button type="button" class="os-button os-button-secondary" disabled>
                    上传技能
                  </button>
                </span>
              }
            >
              <A class="os-button os-button-secondary" href={uploadSkillHref()}>
                上传技能
              </A>
            </Show>
          </div>
        </div>
        <div class="os-filter-tabs">
          <For each={page.filters}>
            {(item) => <button type="button" data-active={selectedFilter() === item} onClick={() => setSelectedFilter(item)}>{item}</button>}
          </For>
        </div>
        <Show when={loaded()} fallback={<ResourceLoadingGrid />}>
          <Show when={visibleItems().length > 0} fallback={<p class="os-data-empty">暂无可展示的 OneSkills 技能，请先安装或上传技能。</p>}>
            <SkillsSystemOverview
              page="skills"
              items={visibleItems()}
              layerFilter={selectedFilter()}
              highlightedLayer={highlightedLayer()}
            />
          </Show>
        </Show>
      </div>
    </div>
  )
}

function resourceHighlightMatches(itemId: string, highlight: string) {
  if (itemId === highlight) return true
  return resourceCardIdFromResourceId(itemId) === resourceCardIdFromResourceId(highlight)
}

function ResourcePage(props: { page: ResourceKey }) {
  const page = resourcePages[props.page]
  const location = useLocation()
  const navigate = useNavigate()
  const resourceSearchParams = createMemo(() => new URLSearchParams(location.search))
  const highlightId = createMemo(() => resourceSearchParams().get("highlight") ?? undefined)
  const publishRequested = createMemo(() => resourceSearchParams().get("publish") === "1")
  const draftIdFromQuery = createMemo(() => resourceSearchParams().get("draftId") ?? undefined)
  const primitiveTypeFromQuery = createMemo(() => resourceSearchParams().get("primitiveType") ?? undefined)
  const [highlightedId, setHighlightedId] = createSignal<string>()
  const server = useServer()
  const workspaceDirectory = useWorkspaceDirectory()
  const modelScopeDownloads = useModelScopeDownloadRecords(workspaceDirectory)
  let openedPublishQueryKey: string | undefined
  const [selectedFilter, setSelectedFilter] = createSignal<string>(
    resourceFilterFromHash(props.page, location.hash, page.filters) ?? page.filters[0],
  )
  const [searchQuery, setSearchQuery] = createSignal("")
  createEffect(on(
    () => location.hash,
    (hash) => {
      setSelectedFilter(resourceFilterFromHash(props.page, hash, page.filters) ?? page.filters[0])
    },
  ))
  const selectFilter = (filter: string) => {
    setSelectedFilter(filter)
    const hash = resourceHashFromFilter(props.page, filter)
    const nextHash = hash ? `#${hash}` : ""
    if (location.hash !== nextHash) {
      navigate(`${location.pathname}${location.search}${nextHash}`, { replace: true })
    }
  }
  const [uploadOpen, setUploadOpen] = createSignal(false)
  const [editOpen, setEditOpen] = createSignal(false)
  const [editingResource, setEditingResource] = createSignal<UploadedResource>()
  const pageSupportsUpload = createMemo(() => isUploadableResourcePage(props.page))
  const canUpload = createMemo(() => pageSupportsUpload() && Boolean(currentResourceAccountId()))
  const [pageItems, setPageItems] = createSignal<readonly ResourceItem[]>([])
  const [uploaded, setUploaded] = createSignal<readonly UploadedResource[]>([])
  const [uploadedNextOffset, setUploadedNextOffset] = createSignal<number | undefined>()
  const [uploadedLoading, setUploadedLoading] = createSignal(false)
  const [uploadedLoaded, setUploadedLoaded] = createSignal(false)
  const [resourceCustomCounts, setResourceCustomCounts] = createSignal<ResourceCustomCounts>()
  const [resourceReady, setResourceReady] = createSignal(false)
  createEffect(() => {
    if (props.page !== "datasets") return
    resourceReady()
    workspaceDirectory()
    const idleId = deferIdleWork(() => {
      void modelScopeDownloads.refresh()
    }, 300)
    onCleanup(() => cancelIdleWork(idleId))
  })
  const databaseOnly = createMemo(() => databaseOnlyResourcePages.has(props.page))
  let disposed = false
  let uploadedRequestId = 0
  const loadUploaded = async (offset = 0) => {
    const current = server.current
    if (!pageSupportsUpload() || !current || uploadedLoading()) return
    const requestId = ++uploadedRequestId
    const requestedDomain = selectedFilter() === "全部" ? undefined : selectedFilter()
    const requestedQuery = searchQuery().trim() || undefined
    setUploadedLoading(true)
    const result = await listUploadedResources(current.http.url, props.page as UploadableResourceKey, {
      domain: requestedDomain,
      q: requestedQuery,
      // Catalog pages overlay DB seeds + own uploads on static cards; frameworks stay custom-only.
      customOnly: props.page === "frameworks" ? true : undefined,
      limit: databaseOnly() ? 100 : uploadedResourcePageSize,
      offset,
    })
    if (requestId !== uploadedRequestId) return
    if (disposed) {
      setUploadedLoading(false)
      return
    }
    let items = result.items
    let nextOffset = typeof result.nextOffset === "number" ? result.nextOffset : undefined
    // Pull remaining seed/custom pages so preset edits from SQLite win over static cards.
    if (offset === 0 && databaseOnly() && result.loaded === true) {
      while (typeof nextOffset === "number" && requestId === uploadedRequestId && !disposed) {
        const more = await listUploadedResources(current.http.url, props.page as UploadableResourceKey, {
          domain: requestedDomain,
          q: requestedQuery,
          limit: 100,
          offset: nextOffset,
        })
        if (more.loaded !== true) break
        items = appendUniqueResourceItems(items, more.items)
        nextOffset = typeof more.nextOffset === "number" ? more.nextOffset : undefined
      }
    }
    if (requestId !== uploadedRequestId || disposed) {
      setUploadedLoading(false)
      return
    }
    batch(() => {
      setUploaded((current) => (offset === 0 ? items : appendUniqueResourceItems(current, items)))
      setUploadedNextOffset(databaseOnly() ? undefined : nextOffset)
      setUploadedLoaded(result.loaded === true)
      setUploadedLoading(false)
    })
  }
  const refreshResourceCustomCounts = async () => {
    const current = server.current
    if (!current || !catalogSummaryPages.has(props.page)) return
    invalidateResourceCustomCountsCache()
    const custom = await fetchResourceCustomCounts(current.http.url)
    if (custom) setResourceCustomCounts(custom)
  }
  const refetchUploaded = () => {
    batch(() => {
      setUploaded([])
      setUploadedNextOffset(undefined)
      setUploadedLoaded(false)
      setUploadedLoading(false)
    })
    void loadUploaded()
    if (catalogSummaryPages.has(props.page)) void refreshResourceCustomCounts()
  }
  const openEditResource = (item: UploadedResource) => {
    setEditingResource(item)
    setEditOpen(true)
  }
  onMount(() => {
    batch(() => {
      setPageItems(page.items)
      setResourceReady(true)
    })
    const deferBackgroundLoads = () => {
      if (disposed) return
      void loadUploaded()
      const current = server.current
      if (catalogSummaryPages.has(props.page) && current) {
        void fetchResourceCustomCounts(current.http.url).then((custom) => {
          if (custom) setResourceCustomCounts(custom)
        })
      }
    }
    const idleId = deferIdleWork(deferBackgroundLoads)
    onCleanup(() => {
      disposed = true
      cancelIdleWork(idleId)
    })
  })
  const items = createMemo<readonly ResourceItem[]>(() => {
    const customItems = uploaded() ?? []
    const builtIn = pageItems()
    if (props.page === "frameworks" && uploadedLoaded()) return mergeResourcePageItems(builtIn, customItems.filter((item) => item.id.startsWith("custom-")))
    if (databaseOnly() && uploadedLoaded()) return mergeResourcePageItems(builtIn, customItems)
    if (pageSupportsUpload() && uploadedLoaded() && customItems.length > 0) return customItems
    return builtIn
  })
  const catalogCount = createMemo(() => {
    if (props.page === "cases") return formatResourceCatalogTotal(props.page, page.items.length)
    if (!catalogSummaryPages.has(props.page)) return page.count
    const pageKey = props.page as CatalogCountPage
    const customDomains = resourceCustomCounts()?.byDomain?.[pageKey]
    const merged = mergeResourceDomainCounts(builtInCatalogDomainCounts[pageKey], customDomains)
    return formatResourceCatalogSummary(pageKey, merged)
  })
  const [visibleItems, setVisibleItems] = createSignal<readonly ResourceItem[]>([])
  const cacheKey = createMemo(() => `${props.page}:${selectedFilter()}:${searchQuery().trim().toLowerCase()}`)
  const [visibleCount, setVisibleCount] = createSignal(0)
  const renderedItems = createMemo(() => visibleItems().slice(0, visibleCount()))
  const hasMoreItems = createMemo(() => visibleCount() < visibleItems().length)
  const primitiveLinkResourceIds = createMemo(() =>
    renderedItems().flatMap((item) => {
      if (!("id" in item)) return []
      if (props.page === "datasets" || props.page === "models" || props.page === "apps") return [item.id]
      if (getResourceSource(item).tone === "onescience") return [item.id]
      return []
    }),
  )
  const [primitiveLinks, setPrimitiveLinks] = createSignal<Record<string, PrimitiveResourceLink>>({})
  const [loadingPrimitiveLinkIds, setLoadingPrimitiveLinkIds] = createSignal<ReadonlySet<string>>(new Set())
  const primitiveLinkReadyFor = (resourceId: string) => !loadingPrimitiveLinkIds().has(resourceId)
  const updatePrimitiveLink = (resourceId: string, link: PrimitiveResourceLink) => {
    const url = server.current?.http.url
    if (url) invalidatePrimitiveResourceLookupCacheEntry(url, resourceId)
    setPrimitiveLinks((current) => ({ ...current, [resourceId]: link }))
  }
  const [primitivePublishTarget, setPrimitivePublishTarget] = createSignal<{
    resourceId: string
    resourcePage?: PrimitiveResourcePage
    draftId?: string
    initialPrimitiveType?: string
    publishSlot?: PrimitivePublishSlot
    sourceHint: PrimitiveSourceHint
  }>()
  createEffect(on(
    () => server.current?.http.url,
    (serverUrl) => {
      setPrimitiveLinks({})
      setLoadingPrimitiveLinkIds(new Set<string>())
    },
  ))
  createEffect(() => {
    const current = server.current
    const serverUrl = current?.http.url
    const ids = [...new Set(primitiveLinkResourceIds())]
    if (!serverUrl || ids.length === 0) {
      setLoadingPrimitiveLinkIds(new Set<string>())
      return
    }
    const cached = readCachedPrimitiveResourceLookups(serverUrl, ids)
    if (Object.keys(cached.items).length > 0) {
      setPrimitiveLinks((current) => ({
        ...current,
        ...Object.fromEntries(
          Object.entries(cached.items).map(([id, entry]) => [id, mapPrimitiveResourceLink(entry)]),
        ),
      }))
    }
    if (cached.missing.length === 0) {
      setLoadingPrimitiveLinkIds(new Set<string>())
      return
    }
    setLoadingPrimitiveLinkIds(new Set<string>(cached.missing))
    let active = true
    void lookupPrimitivesByResources(serverUrl, ids).then((result) => {
      if (!active || server.current?.http.url !== serverUrl) return
      setLoadingPrimitiveLinkIds(new Set<string>())
      if (!result.loaded) return
      setPrimitiveLinks((current) => ({
        ...current,
        ...Object.fromEntries(
          Object.entries(result.items).map(([id, entry]) => [id, mapPrimitiveResourceLink(entry)]),
        ),
      }))
    })
    onCleanup(() => {
      active = false
    })
  })
  const hasMoreUploadedItems = createMemo(() => pageSupportsUpload() && typeof uploadedNextOffset() === "number")
  const loadMoreStatus = createMemo(() => {
    if (hasMoreItems()) return "继续加载中..."
    if (uploadedLoading()) return "正在从数据库加载..."
    if (hasMoreUploadedItems()) return "继续加载更多内容"
    return "已经到底啦"
  })
  const isInitialLoading = createMemo(() => !resourceReady())
  const [loadMoreRef, setLoadMoreRef] = createSignal<HTMLDivElement>()
  const [loadMoreVisible, setLoadMoreVisible] = createSignal(false)
  const advanceResourceList = () => {
    if (hasMoreItems()) {
      setVisibleCount((count) => {
        const next = Math.min(count + resourceBatchSize, visibleItems().length)
        renderedResourceCache.set(cacheKey(), next)
        return next
      })
      return
    }
    const offset = uploadedNextOffset()
    if (hasMoreUploadedItems() && !uploadedLoading() && typeof offset === "number") void loadUploaded(offset)
  }
  createEffect(on(
    () => [cacheKey(), items(), selectedFilter(), searchQuery()] as const,
    ([key, sourceItems, filter, query]) => {
      const filtered = sortResourceItemsByModelScopeAvailability(
        props.page,
        searchResourceItems(query, filterResourceItems(props.page, filter, sourceItems)),
      )
      const cached = renderedResourceCache.get(key)
      const next = Math.min(cached ?? resourceBatchSize, filtered.length)
      batch(() => {
        setVisibleItems(filtered)
        setVisibleCount(next)
      })
      if (next > 0) renderedResourceCache.set(key, next)
    },
  ))
  createEffect(() => {
    const count = visibleCount()
    if (count > 0) renderedResourceCache.set(cacheKey(), count)
  })
  createEffect(on(selectedFilter, () => {
    if (resourceReady()) void refetchUploaded()
  }, { defer: true }))
  createEffect(on(searchQuery, () => {
    if (!resourceReady() || databaseOnly()) return
    const timer = window.setTimeout(() => {
      void refetchUploaded()
    }, 250)
    onCleanup(() => window.clearTimeout(timer))
  }, { defer: true }))
  createEffect(() => {
    const target = loadMoreRef()
    if (!target) return
    const root = target.closest(".os-workspace-main")
    const observer = new IntersectionObserver((entries) => {
      setLoadMoreVisible(entries.some((entry) => entry.isIntersecting))
      if (entries.some((entry) => entry.isIntersecting)) advanceResourceList()
    }, { root, rootMargin: "640px 0px" })
    observer.observe(target)
    onCleanup(() => observer.disconnect())
  })
  createEffect(on(() => highlightId(), () => {
    const id = highlightId()
    openedPublishQueryKey = undefined
    if (!id) return
    setHighlightedId(undefined)
  }))
  createEffect(() => {
    const id = highlightId()
    if (!id || isInitialLoading()) return
    const index = visibleItems().findIndex((item) => resourceHighlightMatches(item.id, id))
    if (index < 0) return
    setVisibleCount((count) => Math.max(count, index + 1))
    const matched = visibleItems()[index]?.id
    if (!matched) return
    setHighlightedId(matched)
    let frame = 0
    frame = window.requestAnimationFrame(() => {
      document.getElementById(matched)?.scrollIntoView({ behavior: "smooth", block: "center" })
    })
    const timer = window.setTimeout(() => setHighlightedId(undefined), 2400)
    onCleanup(() => {
      if (frame) window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    })
  })
  createEffect(() => {
    if (!publishRequested() || isInitialLoading() || primitivePublishTarget()) return
    const highlight = highlightId()
    if (!highlight) return
    const index = visibleItems().findIndex((item) => resourceHighlightMatches(item.id, highlight))
    if (index < 0) return
    const item = visibleItems()[index]
    if (!item || !("id" in item)) return
    setVisibleCount((count) => Math.max(count, index + 1))
    const draftId = draftIdFromQuery()
    const primitiveType = primitiveTypeFromQuery()
    const queryKey = `${item.id}:${draftId ?? ""}:${primitiveType ?? ""}`
    if (openedPublishQueryKey === queryKey) return
    // draftId already tells us which draft to continue — don't block on link lookup / rendered batch.
    if (!draftId && loadingPrimitiveLinkIds().has(item.id)) return
    const link = primitiveLinks()[item.id] ?? {}
    const action = resourcePrimitivePublishAction(props.page, link)
    const resolvedDraftId = draftId ?? action.draftId
    if (!resolvedDraftId && action.disabled) return
    const resourcePage = props.page === "datasets" || props.page === "models" || props.page === "apps" || props.page === "frameworks"
      ? props.page
      : undefined
    const initialPrimitiveType = primitiveType ?? action.initialPrimitiveType
    openedPublishQueryKey = queryKey
    setPrimitivePublishTarget({
      resourceId: item.id,
      resourcePage,
      draftId: resolvedDraftId,
      initialPrimitiveType,
      publishSlot: action.publishSlot ?? publishSlotFromPrimitiveType(initialPrimitiveType),
      sourceHint: {
        title: item.title,
        copy: item.copy,
        provider: item.provider,
        tags: [...item.tags],
        domain: ("domain" in item && typeof item.domain === "string")
          ? item.domain
          : item.tags.find((tag) => resourceCardDomainTags.has(tag)),
        format: item.format,
        size: item.size,
        href: "href" in item && typeof item.href === "string" ? item.href : undefined,
        page: resourcePage,
        datasetDownloadMethod: props.page === "datasets" ? modelScopeDatasetDownloadMethod(item.id) : undefined,
        modelDownloadMethod: props.page === "models" ? modelScopeModelDownloadMethod(item.title) : undefined,
      },
    })
    // Keep publish query params while the dialog is open so a search rewrite cannot close it.
  })

  const clearPublishQueryParams = () => {
    const params = new URLSearchParams(location.search)
    if (params.get("publish") !== "1" && !params.get("draftId") && !params.get("primitiveType")) return
    params.delete("publish")
    params.delete("draftId")
    params.delete("primitiveType")
    const query = params.toString()
    navigate(`${location.pathname}${query ? `?${query}` : ""}${location.hash}`, { replace: true })
  }
  createEffect(() => {
    const visible = loadMoreVisible()
    const loading = uploadedLoading()
    const moreItems = hasMoreItems()
    const moreUploadedItems = hasMoreUploadedItems()
    const offset = uploadedNextOffset()
    const count = visibleCount()
    const total = visibleItems().length
    if (!visible) return
    if (!moreItems && (!moreUploadedItems || loading)) return
    let frame = 0
    frame = window.requestAnimationFrame(() => {
      if (loadMoreVisible() && offset === uploadedNextOffset() && count === visibleCount() && total === visibleItems().length) {
        advanceResourceList()
      }
    })
    onCleanup(() => {
      if (frame) window.cancelAnimationFrame(frame)
    })
  })
  return (
    <div class="os-workspace-content">
      <div class="os-workspace-container">
        <div class="os-resource-head">
          <div>
            <div class="os-eyebrow">{page.eyebrow}</div>
            <h1>{page.title}</h1>
          </div>
          <div class="os-resource-head-actions">
            <span>{catalogCount()}</span>
            <Show when={pageSupportsUpload()}>
              <span class="inline-flex" title={canUpload() ? undefined : "登录后使用"}>
                <button
                  class="os-button os-button-secondary"
                  type="button"
                  disabled={!canUpload()}
                  onClick={() => {
                    if (!canUpload()) return
                    setUploadOpen(true)
                  }}
                >
                  上传
                </button>
              </span>
            </Show>
          </div>
        </div>
        <div class="os-resource-toolbar">
          <label class="os-search-box">
            <span class="os-search-box-icon" aria-hidden="true">⌕</span>
            <input
              type="search"
              placeholder={page.search}
              value={searchQuery()}
              onInput={(event) => setSearchQuery(event.currentTarget.value)}
            />
          </label>
        </div>
        <div class="os-filter-tabs">
          <For each={page.filters}>
            {(item) => (
              <button type="button" data-active={selectedFilter() === item} onClick={() => selectFilter(item)}>
                {item}
              </button>
            )}
          </For>
        </div>
        <Show
          when={props.page === "skills"}
          fallback={
            <Show when={!isInitialLoading()} fallback={<ResourceLoadingGrid />}>
              <Show
                when={renderedItems().length > 0 || !emptyStateResourcePages.has(props.page)}
                fallback={
                  <Show
                    when={!uploadedLoading()}
                    fallback={<p class="os-data-empty">正在加载...</p>}
                  >
                    <p class="os-data-empty">{resourceListEmptyMessage(props.page, selectedFilter(), searchQuery())}</p>
                  </Show>
                }
              >
                <div class="os-resource-grid">
                  <For each={renderedItems()}>{(item) => (
                    <ResourceCard
                      page={props.page}
                      item={item}
                      highlighted={highlightedId() === item.id}
                      onChanged={refetchUploaded}
                      onEdit={openEditResource}
                      primitiveLink={primitiveLinks()[item.id]}
                      primitiveLinkReady={primitiveLinkReadyFor(item.id)}
                      onPrimitiveLinkChange={updatePrimitiveLink}
                      onPublishPrimitive={setPrimitivePublishTarget}
                      workspaceDirectory={props.page === "datasets" ? workspaceDirectory() : undefined}
                      modelScopeDownloads={props.page === "datasets" ? modelScopeDownloads : undefined}
                      onDatasetDownloadStart={props.page === "datasets" ? modelScopeDownloads.start : undefined}
                      onDatasetDownloadCancel={props.page === "datasets" ? modelScopeDownloads.cancel : undefined}
                      onDatasetDownloadDelete={props.page === "datasets" ? modelScopeDownloads.remove : undefined}
                    />
                  )}</For>
                </div>
              </Show>
            </Show>
          }
        >
          <Show when={!isInitialLoading()} fallback={<ResourceLoadingGrid />}>
            <SkillsSystemOverview page={props.page} items={renderedItems()} onChanged={refetchUploaded} onEdit={openEditResource} />
          </Show>
        </Show>
        <Show when={resourceReady() && renderedItems().length > 0}>
          <div ref={setLoadMoreRef} class="os-load-more-sentinel">
            {loadMoreStatus()}
          </div>
        </Show>
        <Show when={pageSupportsUpload()}>
          <ResourceUploadDialog
            open={uploadOpen()}
            page={props.page as UploadableResourceKey}
            domain={selectedFilter() === "全部" ? undefined : selectedFilter()}
            onClose={() => setUploadOpen(false)}
            onCreated={() => {
              setUploadOpen(false)
              void refetchUploaded()
            }}
          />
          <Show when={editingResource()}>
            {(item) => (
              <ResourceUploadDialog
                open={editOpen()}
                page={item().page}
                initial={editingResource()}
                onClose={() => {
                  setEditOpen(false)
                  setEditingResource(undefined)
                }}
                onCreated={() => {
                  setEditOpen(false)
                  setEditingResource(undefined)
                  void refetchUploaded()
                }}
              />
            )}
          </Show>
        </Show>
        <PrimitiveCreateDialog
          resourceId={primitivePublishTarget()?.resourceId}
          resourcePage={primitivePublishTarget()?.resourcePage}
          draftId={primitivePublishTarget()?.draftId}
          initialPrimitiveType={primitivePublishTarget()?.initialPrimitiveType}
          sourceHint={primitivePublishTarget()?.sourceHint}
          serverUrl={server.current?.http.url ?? window.location.origin}
          open={primitivePublishTarget() !== undefined}
          onClose={() => {
            setPrimitivePublishTarget(undefined)
            clearPublishQueryParams()
          }}
          onSuccess={(item) => {
            const target = primitivePublishTarget()
            if (target) {
              void lookupPrimitiveByResource(server.current!.http.url, target.resourceId).then((result) => {
                if (!result.loaded) return
                updatePrimitiveLink(target.resourceId, mapPrimitiveResourceLink({
                  callable: result.callable,
                  draft: result.draft,
                  inference: result.inference,
                  training: result.training,
                  slots: result.slots,
                }))
              })
            }
            setPrimitivePublishTarget(undefined)
            clearPublishQueryParams()
            finishPrimitivePublish(navigate, item, server.current?.http.url)
          }}
        />
      </div>
    </div>
  )
}

function skillBelongsToGroup(item: SkillResourceItem, group: (typeof skillSystemGroups)[number]) {
  return item.layer === group.title || item.tags.includes(group.title) || item.tags.includes(group.id)
}

function skillLayerId(item: ResourceItem | SkillResourceItem) {
  if (!("layer" in item) || typeof item.layer !== "string") return undefined
  return skillGroupIdFromTitle(item.layer)
}

const SKILL_LAYER_PREVIEW_COUNT = 4
/** Orchestrator / resource layers are fixed at one skill each; never treat as growing grids. */
const FIXED_SINGLE_SKILL_LAYER_IDS = new Set(["orchestrator", "resource"])

function SkillLayerSection(props: {
  group: (typeof skillSystemGroups)[number]
  items: readonly (ResourceItem | SkillResourceItem)[]
  highlighted?: boolean
  onChanged?: () => void
  onEdit?: (item: UploadedResource) => void
}) {
  const [expanded, setExpanded] = createSignal(false)
  const total = () => props.items.length
  const hiddenCount = () => Math.max(0, total() - SKILL_LAYER_PREVIEW_COUNT)
  const visibleItems = () =>
    expanded() || hiddenCount() === 0 ? props.items : props.items.slice(0, SKILL_LAYER_PREVIEW_COUNT)
  const isFixedSingleLayer = () => FIXED_SINGLE_SKILL_LAYER_IDS.has(props.group.id)
  return (
    <section
      id={props.group.id}
      class="os-skill-group scroll-mt-24"
      classList={{ "os-skill-group-highlighted": !!props.highlighted }}
      data-layer={props.group.id}
      data-highlighted={props.highlighted ? "true" : undefined}
      data-fixed-single={isFixedSingleLayer() ? "true" : undefined}
    >
      <div class="os-skill-group-head">
        <div class="os-skill-group-title-row">
          <h2>{props.group.title}</h2>
          <Show when={total() > 0}>
            <span class="os-skill-group-count">{total()}</span>
          </Show>
        </div>
        <p>{props.group.copy}</p>
      </div>
      <Show when={total() > 0} fallback={<div class="os-dashboard-card">当前分类暂无技能卡片。</div>}>
        <div class={isFixedSingleLayer() ? "os-skill-card-grid-1" : "os-skill-card-grid-2"}>
          <For each={visibleItems()}>
            {(item) => (
              <ResourceCard page="skills" item={item} onChanged={props.onChanged} onEdit={props.onEdit} />
            )}
          </For>
        </div>
        <Show when={!isFixedSingleLayer() && hiddenCount() > 0}>
          <button
            type="button"
            class="os-skill-layer-expand"
            aria-expanded={expanded()}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded() ? "收起" : `展开其余 ${hiddenCount()} 个`}
          </button>
        </Show>
      </Show>
    </section>
  )
}

function SkillsSystemOverview(props: {
  page: ResourceKey
  items: readonly (ResourceItem | SkillResourceItem)[]
  layerFilter?: string
  highlightedLayer?: string
  onChanged?: () => void
  onEdit?: (item: UploadedResource) => void
}) {
  const visibleGroups = () =>
    props.page === "skills" && props.layerFilter && props.layerFilter !== "全部"
      ? skillSystemGroups.filter((group) => group.title === props.layerFilter)
      : skillSystemGroups
  const groupItemsFor = (group: (typeof skillSystemGroups)[number]) =>
    props.page === "skills"
      ? props.items.filter((item) => skillBelongsToGroup(item as SkillResourceItem, group))
      : props.items.filter((item) => group.title === ("layer" in item ? item.layer : undefined))
  if (props.page !== "skills") {
    return (
      <div class="os-skill-group-grid">
        <For each={visibleGroups()}>
          {(group) => {
            const groupItems = () => groupItemsFor(group)
            return (
              <section class="os-skill-group">
                <div class="os-skill-group-head">
                  <h2>{group.title}</h2>
                  <p>{group.copy}</p>
                </div>
                <Show when={groupItems().length > 0} fallback={<div class="os-dashboard-card">当前分类暂无技能卡片。</div>}>
                  <div class="os-resource-grid os-skill-card-grid">
                    <For each={groupItems()}>
                      {(item) => (
                        <ResourceCard page={props.page} item={item} onChanged={props.onChanged} onEdit={props.onEdit} />
                      )}
                    </For>
                  </div>
                </Show>
              </section>
            )
          }}
        </For>
      </div>
    )
  }
  const skillsGroups = () => {
    const groups = visibleGroups()
    if (props.layerFilter && props.layerFilter !== "全部") return groups
    return groups.filter((group) => groupItemsFor(group).length > 0)
  }
  const skillsLayout = () => {
    const groups = skillsGroups()
    if (props.layerFilter && props.layerFilter !== "全部") {
      return { pair: [] as typeof groups, rest: groups }
    }
    const pair = groups.filter((group) => FIXED_SINGLE_SKILL_LAYER_IDS.has(group.id))
    const rest = groups.filter((group) => !FIXED_SINGLE_SKILL_LAYER_IDS.has(group.id))
    return { pair, rest }
  }
  const renderSection = (group: (typeof skillSystemGroups)[number]) => (
    <SkillLayerSection
      group={group}
      items={groupItemsFor(group)}
      highlighted={props.highlightedLayer === group.id}
      onChanged={props.onChanged}
      onEdit={props.onEdit}
    />
  )
  return (
    <div class="os-skill-group-grid os-skills-overview os-skills-card-overview">
      <Show when={skillsLayout().pair.length > 0}>
        <div class="os-skills-fixed-row" data-cols={String(skillsLayout().pair.length)}>
          <For each={skillsLayout().pair}>{(group) => renderSection(group)}</For>
        </div>
      </Show>
      <For each={skillsLayout().rest}>{(group) => renderSection(group)}</For>
    </div>
  )
}

export function SkillTaskProfileGrid(props: { profiles: readonly TaskProfileItem[]; onStart?: (profile: TaskProfileItem) => void }) {
  return (
    <div class="os-skill-task-grid">
      <For each={props.profiles}>
        {(item) => (
          <button type="button" class="os-skill-task-card" onClick={() => props.onStart?.(item)}>
            <span class="os-skill-task-card-head">
              <strong>{item.title}</strong>
              <svg class="os-skill-task-arrow" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" />
              </svg>
            </span>
            <span class="os-skill-task-description">{taskProfileCardDescriptions[item.id as keyof typeof taskProfileCardDescriptions] ?? item.description}</span>
          </button>
        )}
      </For>
    </div>
  )
}

function ResourceLoadingGrid() {
  return (
    <div class="os-resource-grid" aria-busy="true">
      <For each={Array.from({ length: 4 })}>
        {() => (
          <div class="os-resource-card os-resource-skeleton">
            <div class="os-skeleton-line os-skeleton-badge" />
            <div class="os-skeleton-line os-skeleton-title" />
            <div class="os-skeleton-line" />
            <div class="os-skeleton-line os-skeleton-short" />
            <div class="os-skeleton-meta">
              <span />
              <span />
            </div>
          </div>
        )}
      </For>
    </div>
  )
}

export const resourceProviderOptions = [
  { value: "onescience", label: "OneScience" },
  { value: "third-party", label: "第三方" },
  { value: "paper", label: "论文资料" },
  { value: "local", label: "本地入口" },
] as const satisfies ReadonlyArray<{ value: ResourceSource["tone"]; label: string }>

export function resourceProviderLabel(kind: ResourceSource["tone"]) {
  return resourceProviderOptions.find((option) => option.value === kind)?.label ?? "第三方"
}

/** Limits calibrated against existing OneHub card content (seed p95/max + small headroom). */
export const resourceFieldLimits = {
  title: 64,
  copy: 120,
  size: 48,
  format: 48,
  tags: 100,
  tagItem: 36,
  href: 512,
} as const

export function clampResourceFieldValue(value: string, limit: number) {
  return value.length > limit ? value.slice(0, limit) : value
}

export function resourceFieldLengthError(input: {
  title: string
  copy: string
  size: string
  format: string
  tags: string
  href: string
}) {
  const overs: string[] = []
  if (input.title.trim().length > resourceFieldLimits.title) overs.push(`名称最多 ${resourceFieldLimits.title} 字`)
  if (input.copy.trim().length > resourceFieldLimits.copy) overs.push(`描述最多 ${resourceFieldLimits.copy} 字`)
  if (input.size.trim().length > resourceFieldLimits.size) overs.push(`元信息最多 ${resourceFieldLimits.size} 字`)
  if (input.format.trim().length > resourceFieldLimits.format) overs.push(`格式最多 ${resourceFieldLimits.format} 字`)
  if (input.tags.length > resourceFieldLimits.tags) overs.push(`标签最多 ${resourceFieldLimits.tags} 字`)
  if (input.href.trim().length > resourceFieldLimits.href) overs.push(`链接最多 ${resourceFieldLimits.href} 字`)
  return overs.length ? `${overs.join("；")}，请缩短后再保存` : ""
}

function applyResourceFieldPaste(
  event: ClipboardEvent,
  current: string,
  limit: number,
  setValue: (value: string) => void,
  fieldLabel: string,
  setError: (message: string) => void,
) {
  const pasted = event.clipboardData?.getData("text") ?? ""
  if (!pasted) return
  const target = event.currentTarget as HTMLInputElement | HTMLTextAreaElement
  const start = target.selectionStart ?? current.length
  const end = target.selectionEnd ?? current.length
  const next = `${current.slice(0, start)}${pasted}${current.slice(end)}`
  if (next.length <= limit) return
  event.preventDefault()
  setValue(clampResourceFieldValue(next, limit))
  setError(`${fieldLabel}超过 ${limit} 字上限，粘贴内容已截断`)
}

export function parseResourceTags(value: string) {
  return value
    .split(/[，,\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => tag.slice(0, resourceFieldLimits.tagItem))
    .slice(0, 8)
}

export function resourceProviderKindFromInitial(initial?: Pick<UploadedResource, "source" | "provider">) {
  if (initial?.source) return initial.source
  const matched = resourceProviderOptions.find((option) => option.label === initial?.provider)
  return matched?.value ?? "third-party"
}

export function resourceUploadProfile(page: UploadableResourceKey) {
  switch (page) {
    case "datasets":
      return {
        eyebrow: "OneHub · 数据集",
        title: "新增数据集资源",
        editTitle: "修改数据集资源",
        description: "填写数据覆盖范围、访问方式与存储格式。保存后可发布为数据加载或数据处理原语。",
        typeLabel: "数据形态",
        typeHint: "显示在卡片元数据，便于 Agent 识别数据来源类型",
        typePlaceholder: "再分析 / 观测 / benchmark 等",
        formatLabel: "存储格式",
        formatHint: "发布原语时写入 schema 与 access 契约",
        formatPlaceholder: "GRIB / NetCDF / Zarr 等",
        hrefPlaceholder: "https://... 或 modelscope 数据集页",
        validationError: "请填写名称、描述、提供方、数据形态和存储格式",
      }
    case "models":
      return {
        eyebrow: "OneHub · 模型",
        title: "新增模型资源",
        editTitle: "修改模型资源",
        description: "填写推理框架、权重格式与获取方式。保存后可发布为模型推理或训练原语。",
        typeLabel: "推理框架",
        typeHint: "发布原语时预填 framework 字段",
        typePlaceholder: "PyTorch / JAX / ONNX 等",
        formatLabel: "权重格式",
        formatHint: "Checkpoint、ONNX 或预训练产物形态",
        formatPlaceholder: "Checkpoint / ONNX 等",
        hrefPlaceholder: "https://... 或 modelscope 模型页",
        validationError: "请填写名称、描述、提供方、推理框架和权重格式",
      }
    case "apps":
      return {
        eyebrow: "OneHub · 应用",
        title: "新增应用资源",
        editTitle: "修改应用资源",
        description: "填写实现语言、运行环境与安装入口。保存后可发布为应用启动原语。",
        typeLabel: "实现语言",
        typeHint: "软件主要实现语言或发行形态",
        typePlaceholder: "Python / C++ / Web 等",
        formatLabel: "运行环境",
        formatHint: "发布原语时预填 runtime 字段",
        formatPlaceholder: "CPU / GPU / MPI / Docker 等",
        hrefPlaceholder: "安装门户或 workflow 入口链接",
        validationError: "请填写名称、描述、提供方、实现语言和运行环境",
      }
    case "frameworks":
      return {
        eyebrow: "OneHub · AI 框架",
        title: "新增框架资源",
        editTitle: "修改框架资源",
        description: "填写框架语言、硬件支持与安装入口。",
        typeLabel: "语言或发行形态",
        typeHint: "框架主要语言或发行形态",
        typePlaceholder: "Python / C++ 等",
        formatLabel: "硬件或运行栈",
        formatHint: "支持的硬件与并行运行栈",
        formatPlaceholder: "CPU+GPU / MPI 等",
        hrefPlaceholder: "https://...",
        validationError: "请填写名称、描述、提供方、语言和运行栈",
      }
    case "skills":
      return {
        eyebrow: "OneSkills",
        title: "新增技能资源",
        editTitle: "修改技能资源",
        description: "填写技能类型、运行环境与依赖说明。",
        typeLabel: "技能类型或角色",
        typeHint: "技能在 OneSkills 分层中的类型",
        typePlaceholder: "Expert / Executor / Resource 等",
        formatLabel: "运行环境或依赖",
        formatHint: "技能运行所需环境与依赖",
        formatPlaceholder: "Python / Shell 等",
        hrefPlaceholder: "https://...",
        validationError: "请填写名称、描述、提供方、类型和运行环境",
      }
  }
}

export function resourceUploadFieldHints(page: UploadableResourceKey) {
  const profile = resourceUploadProfile(page)
  return {
    typeHint: profile.typeHint,
    typePlaceholder: profile.typePlaceholder,
    formatHint: profile.formatHint,
    formatPlaceholder: profile.formatPlaceholder,
  }
}

function ResourceUploadDialog(props: {
  open: boolean
  page: UploadableResourceKey
  domain?: string
  initial?: UploadedResource
  onClose: () => void
  onCreated: () => void
}) {
  const server = useServer()
  const [title, setTitle] = createSignal(props.initial?.title ?? "")
  const [copy, setCopy] = createSignal(props.initial?.copy ?? "")
  const [tags, setTags] = createSignal(props.initial?.tags.join(", ") ?? "")
  const [domain, setDomain] = createSignal(props.initial?.domain ?? props.domain ?? resourcePages[props.page].filters.find((filter) => filter !== "全部") ?? "其它")
  const [providerKind, setProviderKind] = createSignal<ResourceSource["tone"]>(resourceProviderKindFromInitial(props.initial))
  const [size, setSize] = createSignal(props.initial?.size ?? "")
  const [format, setFormat] = createSignal(props.initial?.format ?? "")
  const [href, setHref] = createSignal(props.initial?.href ?? "")
  const [error, setError] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const profile = createMemo(() => resourceUploadProfile(props.page))
  const resetForm = () => {
    setTitle(props.initial?.title ?? "")
    setCopy(props.initial?.copy ?? "")
    setTags(props.initial?.tags.join(", ") ?? "")
    setDomain(props.initial?.domain ?? props.domain ?? resourcePages[props.page].filters.find((filter) => filter !== "全部") ?? "其它")
    setProviderKind(resourceProviderKindFromInitial(props.initial))
    setSize(props.initial?.size ?? "")
    setFormat(props.initial?.format ?? "")
    setHref(props.initial?.href ?? "")
    setError("")
  }
  createEffect(on(() => [props.open, props.initial?.id, props.domain, props.page] as const, () => {
    resetForm()
  }))
  const submit = async (event: Event) => {
    event.preventDefault()
    const current = server.current
    if (!current) {
      setError("当前没有可用服务")
      return
    }
    if (!title().trim() || !copy().trim() || !size().trim() || !format().trim()) {
      setError(profile().validationError)

      return
    }
    const lengthError = resourceFieldLengthError({
      title: title(),
      copy: copy(),
      size: size(),
      format: format(),
      tags: tags(),
      href: href(),
    })
    if (lengthError) {
      setError(lengthError)

      return
    }
    setSaving(true)
    setError("")
    try {
      const payload = {
        title: title().trim(),
        copy: copy().trim(),
        domain: domain(),
        tags: parseResourceTags(tags()),
        provider: resourceProviderLabel(providerKind()),
        size: size().trim(),
        format: format().trim(),
        ...(href().trim() ? { href: href().trim() } : {}),
        source: providerKind(),
      }
      if (props.initial) await updateUploadedResource(current.http.url, props.page, props.initial.id, payload)
      else await createUploadedResource(current.http.url, { page: props.page, ...payload })
      resetForm()
      props.onCreated()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "上传失败")
    } finally {
      setSaving(false)
    }
  }
  return (
    <Show when={props.open}>
      <Portal>
        <div class="os-modal-backdrop" role="presentation">
          <form class="os-upload-dialog os-resource-upload-dialog" data-page={props.page} onSubmit={submit} onClick={(event) => event.stopPropagation()}>
            <div class="os-upload-head">
              <div>
                <div class="os-eyebrow">{profile().eyebrow}</div>
                <h2>{props.initial ? profile().editTitle : profile().title}</h2>
                <p class="os-upload-intro">{profile().description}</p>
              </div>
              <button type="button" class="os-button os-button-secondary os-button-square" onClick={props.onClose}>×</button>
            </div>
            <label>
              <span class="os-field-label-row">
                <span class="os-field-label">名称<span class="os-field-required" aria-hidden="true"> *</span></span>
                <span class="os-field-count" data-over={title().length > resourceFieldLimits.title ? "true" : undefined}>{title().length}/{resourceFieldLimits.title}</span>
              </span>
              <input
                value={title()}
                maxLength={resourceFieldLimits.title}
                onInput={(event) => {
                  setTitle(event.currentTarget.value)
                  setError("")
                }}
                onPaste={(event) => applyResourceFieldPaste(event, title(), resourceFieldLimits.title, setTitle, "名称", setError)}
              />
            </label>
            <label>
              <span class="os-field-label-row">
                <span class="os-field-label">描述<span class="os-field-required" aria-hidden="true"> *</span></span>
                <span class="os-field-count" data-over={copy().length > resourceFieldLimits.copy ? "true" : undefined}>{copy().length}/{resourceFieldLimits.copy}</span>
              </span>
              <textarea
                value={copy()}
                maxLength={resourceFieldLimits.copy}
                onInput={(event) => {
                  setCopy(event.currentTarget.value)
                  setError("")
                }}
                onPaste={(event) => applyResourceFieldPaste(event, copy(), resourceFieldLimits.copy, setCopy, "描述", setError)}
              />
            </label>
            <div class="os-upload-grid">
              <label>
                <span class="os-field-label">提供方<span class="os-field-required" aria-hidden="true"> *</span></span>
                <span class="os-upload-field-hint">资源归属，决定卡片角标</span>
                <select value={providerKind()} onInput={(event) => setProviderKind(event.currentTarget.value as ResourceSource["tone"])}>
                  <For each={resourceProviderOptions}>
                    {(option) => <option value={option.value}>{option.label}</option>}
                  </For>
                </select>
              </label>
              <label>

                <span class="os-field-label-row">
                  <span class="os-field-label">{profile().typeLabel}<span class="os-field-required" aria-hidden="true"> *</span></span>
                  <span class="os-field-count" data-over={size().length > resourceFieldLimits.size ? "true" : undefined}>{size().length}/{resourceFieldLimits.size}</span>
                </span>
                <span class="os-upload-field-hint">{profile().typeHint}</span>
                <input
                  value={size()}
                  maxLength={resourceFieldLimits.size}
                  placeholder={profile().typePlaceholder}
                  onInput={(event) => {
                    setSize(event.currentTarget.value)
                    setError("")
                  }}
                  onPaste={(event) => applyResourceFieldPaste(event, size(), resourceFieldLimits.size, setSize, profile().typeLabel, setError)}
                />
              </label>
              <label>
                <span class="os-field-label-row">
                  <span class="os-field-label">{profile().formatLabel}<span class="os-field-required" aria-hidden="true"> *</span></span>
                  <span class="os-field-count" data-over={format().length > resourceFieldLimits.format ? "true" : undefined}>{format().length}/{resourceFieldLimits.format}</span>
                </span>
                <span class="os-upload-field-hint">{profile().formatHint}</span>
                <input
                  value={format()}
                  maxLength={resourceFieldLimits.format}
                  placeholder={profile().formatPlaceholder}
                  onInput={(event) => {
                    setFormat(event.currentTarget.value)
                    setError("")
                  }}
                  onPaste={(event) => applyResourceFieldPaste(event, format(), resourceFieldLimits.format, setFormat, profile().formatLabel, setError)}

                />
              </label>
            </div>
            <label>
              <span class="os-field-label-row">
                <span class="os-field-label">标签</span>
                <span class="os-field-count" data-over={tags().length > resourceFieldLimits.tags ? "true" : undefined}>{tags().length}/{resourceFieldLimits.tags}</span>
              </span>
              <input
                value={tags()}
                maxLength={resourceFieldLimits.tags}
                placeholder="多个标签用逗号或空格分隔"
                onInput={(event) => {
                  setTags(event.currentTarget.value)
                  setError("")
                }}
                onPaste={(event) => applyResourceFieldPaste(event, tags(), resourceFieldLimits.tags, setTags, "标签", setError)}
              />
            </label>
            <label>
              领域
              <select value={domain()} onInput={(event) => setDomain(event.currentTarget.value)}>
                <For each={resourcePages[props.page].filters.filter((filter) => filter !== "全部")}>
                  {(filter) => <option value={filter}>{filter}</option>}
                </For>
              </select>
            </label>

            <label>
              <span class="os-field-label-row">
                <span class="os-field-label">链接</span>
                <span class="os-field-count" data-over={href().length > resourceFieldLimits.href ? "true" : undefined}>{href().length}/{resourceFieldLimits.href}</span>
              </span>
              <input
                value={href()}
                maxLength={resourceFieldLimits.href}
                placeholder={profile().hrefPlaceholder}
                onInput={(event) => {
                  setHref(event.currentTarget.value)
                  setError("")
                }}
                onPaste={(event) => applyResourceFieldPaste(event, href(), resourceFieldLimits.href, setHref, "链接", setError)}
              />
            </label>

            <Show when={error()}>{(message) => <div class="os-upload-error">{message()}</div>}</Show>
            <div class="os-upload-actions">
              <button type="button" class="os-button os-button-secondary" onClick={props.onClose}>取消</button>
              <button class="os-button os-button-primary" type="submit" disabled={saving()}>{saving() ? "保存中..." : props.initial ? "保存修改" : "保存"}</button>
            </div>
          </form>
        </div>
      </Portal>
    </Show>
  )
}

function isUploadableResourcePage(page: ResourceKey): page is UploadableResourceKey {
  return page === "datasets" || page === "models" || page === "apps" || page === "frameworks"
}

export async function listUploadedResources(serverUrl: string, page: UploadableResourceKey, input?: { domain?: string; q?: string; limit?: number; offset?: number; customOnly?: boolean }) {
  const limit = input?.limit ?? uploadedResourcePageSize
  const offset = input?.offset ?? 0
  const domain = input?.domain?.trim()
  const q = input?.q?.trim()
  const customOnly = input?.customOnly === true
  const accountKey = currentResourceAccountId() ?? "guest"
  const cacheKey = `${oneScienceApiBaseUrl(serverUrl)}:${page}:${accountKey}:${domain ?? ""}:${q ?? ""}:${customOnly}:${limit}:${offset}`
  const cached = uploadedResourceCache.get(cacheKey)
  if (cached) return cached
  try {
    const query = new URLSearchParams({ page, limit: String(limit), offset: String(offset) })
    if (domain) query.set("domain", domain)
    if (q) query.set("q", q)
    if (customOnly) query.set("customOnly", "true")
    const response = await authenticatedFetch(`${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/resource?${query}`)
    if (!response.ok) return { items: [], loaded: false }
    const result = await response.json() as UploadedResource[] | UploadedResourcePageResult
    const normalized: UploadedResourcePageResult = Array.isArray(result)
      ? { items: result, loaded: true }
      : {
          items: Array.isArray(result.items) ? result.items : [],
          loaded: true,
          ...(typeof result.nextOffset === "number" ? { nextOffset: result.nextOffset } : {}),
        }
    uploadedResourceCache.set(cacheKey, normalized)
    return normalized
  } catch {
    return { items: [], loaded: false }
  }
}

export async function listOneScienceSkills(serverUrl: string, input?: { layer?: string; limit?: number; offset?: number; q?: string }) {
  const cacheKey = `${oneScienceApiBaseUrl(serverUrl)}:skills:catalog:${input?.layer ?? ""}:${input?.q ?? ""}:${input?.limit ?? 50}`
  const cached = skillPageCache.get(cacheKey)
  if (cached) return cached
  try {
    const result = await listCatalogSkills(serverUrl, {
      layer: input?.layer,
      q: input?.q,
      limit: input?.limit ?? 50,
    })
    if (result.loaded !== true) return { items: [], loaded: false }
    const normalized = {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        sortOrder: item.sortOrder ?? 0,
      })),
      loaded: true as const,
    }
    skillPageCache.set(cacheKey, normalized)
    return normalized
  } catch {
    return { items: [], loaded: false }
  }
}

export async function listOneScienceTaskProfiles(serverUrl: string) {
  const cacheKey = `${oneScienceApiBaseUrl(serverUrl)}:task-profiles:v2`
  const cached = taskProfileCache.get(cacheKey)
  if (cached) return cached
  const stored = readTaskProfileStorage(cacheKey)
  if (stored) {
    taskProfileCache.set(cacheKey, stored)
    return stored
  }
  try {
    const response = await authenticatedFetch(`${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/task-profile`)
    if (!response.ok) return { items: [], loaded: false }
    const result = await response.json() as { items: TaskProfileItem[] }
    const normalized = {
      items: result.items.map((item) => item.id === "operator-performance-optimization" ? {
        ...item,
        title: "Kernel性能优化",
        description: "优化热点 Kernel 并复测。",
        expectedArtifacts: ["kernel_profile_report", "kernel_benchmark_report", "kernel_optimization_patch", "optimized_kernel_report"],
      } : item),
      loaded: true,
    }
    taskProfileCache.set(cacheKey, normalized)
    writeTaskProfileStorage(cacheKey, normalized)
    return normalized
  } catch {
    return { items: [], loaded: false }
  }
}

function readTaskProfileStorage(cacheKey: string) {
  if (typeof window === "undefined") return
  try {
    const text = window.localStorage.getItem(`onescience:${cacheKey}`)
    if (!text) return
    const parsed = JSON.parse(text) as Partial<StoredTaskProfilePageResult>
    if (typeof parsed.time !== "number" || Date.now() - parsed.time > taskProfileStorageMaxAge) return
    if (!parsed.value || !Array.isArray(parsed.value.items)) return
    return parsed.value
  } catch {
    return
  }
}

function writeTaskProfileStorage(cacheKey: string, value: TaskProfilePageResult) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(`onescience:${cacheKey}`, JSON.stringify({ time: Date.now(), value } satisfies StoredTaskProfilePageResult))
  } catch {
    return
  }
}

export async function listAIPrimitives(serverUrl: string, input?: { q?: string; domain?: string; primitiveType?: string; status?: string; limit?: number; offset?: number; category?: string }) {
  return listAIPrimitivesFromDatabase(serverUrl, input)
}

export async function listAgentRegistryPrimitives(serverUrl: string, input?: { domain?: string; primitiveType?: string; status?: string; limit?: number; offset?: number }) {
  const query = new URLSearchParams({ status: input?.status ?? "callable" })
  if (input?.domain) query.set("domain", input.domain)
  if (input?.primitiveType) query.set("primitiveType", input.primitiveType)
  query.set("limit", String(input?.limit ?? 50))
  query.set("offset", String(input?.offset ?? 0))
  const response = await authenticatedFetch(`${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/agent-registry?${query}`)
  if (!response.ok) return { items: [], loaded: false }
  const result = await response.json() as AIPrimitivePageResult
  return { ...result, loaded: true }
}

export function resetUploadedResourceCache() {
  uploadedResourceCache.clear()
  skillPageCache.clear()
  invalidateResourceCustomCountsCache()
}

export function appendUniqueResourceItems<T extends { id: string }>(current: readonly T[], next: readonly T[]) {
  const ids = new Set(current.map((item) => item.id))
  return [...current, ...next.filter((item) => {
    if (ids.has(item.id)) return false
    ids.add(item.id)
    return true
  })]
}

function resourceMergeKey(item: { id: string; title: string }) {
  return item.title
}

const resourceCardDomainTags = new Set(["地球科学", "生命科学", "材料化学", "流体仿真", "其它"])

export function mergeResourcePageItems(builtIn: readonly ResourceItem[], custom: readonly UploadedResource[]) {
  const merged = new Map<string, ResourceItem>()
  for (const item of builtIn) merged.set(resourceMergeKey(item), item)
  for (const item of custom) merged.set(resourceMergeKey(item), item)
  return [...merged.values()]
}

function clearUploadedResourceCache(serverUrl: string, page: UploadableResourceKey) {
  const prefix = `${oneScienceApiBaseUrl(serverUrl)}:${page}:`
  for (const key of uploadedResourceCache.keys()) {
    if (key.startsWith(prefix)) uploadedResourceCache.delete(key)
  }
  invalidateResourceCustomCountsCache()
}

async function createUploadedResource(serverUrl: string, payload: UploadResourcePayload) {
  const response = await authenticatedFetch(`${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/resource`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error("保存失败")
  clearUploadedResourceCache(serverUrl, payload.page)
  return (await response.json()) as UploadedResource
}

export async function updateUploadedResource(serverUrl: string, page: UploadableResourceKey, id: string, payload: Omit<UploadResourcePayload, "page">) {
  const response = await authenticatedFetch(`${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/resource/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error("保存失败")
  clearUploadedResourceCache(serverUrl, page)
  return (await response.json()) as UploadedResource
}

export async function deleteUploadedResource(serverUrl: string, page: UploadableResourceKey, id: string) {
  const response = await authenticatedFetch(`${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/resource/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
  if (!response.ok) throw new Error("删除失败")
  clearUploadedResourceCache(serverUrl, page)
  return (await response.json()) as boolean
}

export async function deleteAIPrimitive(serverUrl: string, id: string) {
  const response = await authenticatedFetch(`${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/primitive/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
  if (!response.ok) throw new Error("删除失败")
  invalidatePrimitiveResourceLookupCache(serverUrl)
  invalidatePrimitiveCatalogCaches()
  return (await response.json()) as boolean
}


export { forkPresetCase, restoreSharedPresetCase }
/** @deprecated Prefer forkPresetCase — restore copies the shared case into the personal workspace. */
export { forkPresetCase as restorePresetCase }

function oneScienceApiBaseUrl(serverUrl: string) {
  try {
    return new URL(serverUrl).toString().replace(/\/$/, "")
  } catch {
    return serverUrl.replace(/\/$/, "")
  }
}

function CaseMissingDialog(props: {
  title: string
  sessionId?: string
  onClose: () => void
  onRestore?: (sessionId: string) => void | Promise<void>
}) {
  const [restoring, setRestoring] = createSignal(false)
  const [restoreError, setRestoreError] = createSignal("")
  const canRestore = () => !!props.sessionId && !!props.onRestore
  const handleRestore = () => {
    const sessionId = props.sessionId
    if (!sessionId || !props.onRestore || restoring()) return
    setRestoring(true)
    setRestoreError("")
    try {
      const result = props.onRestore(sessionId)
      if (result instanceof Promise) {
        result.catch((cause) => {
          setRestoreError(cause instanceof Error ? cause.message : "恢复失败")
        }).finally(() => setRestoring(false))
      } else {
        setRestoring(false)
      }
    } catch (cause) {
      setRestoring(false)
      setRestoreError(cause instanceof Error ? cause.message : "恢复失败")
    }
  }
  return (
    <Portal>
      <div class="os-modal-backdrop" role="presentation" onClick={props.onClose}>
        <div class="os-upload-dialog" onClick={(event) => event.stopPropagation()}>
          <div class="os-upload-head">
            <div>
              <div class="os-eyebrow">跳转失败</div>
              <h2>预置案例已被删除</h2>
            </div>
            <button type="button" class="os-button os-button-secondary os-button-square" onClick={props.onClose}>×</button>
          </div>
          <p class="os-section-copy">
            案例 <strong>{props.title}</strong> 对应的预置会话已被删除，无法跳转到科研开发。
          </p>
          <p class="os-section-copy">
            {canRestore()
              ? "可点击右下角「恢复案例」直接还原该预置会话，或在科研开发中重新创建该案例。"
              : "可以在科研开发中重新创建该案例，或返回案例页选择其它预置案例。"}
          </p>
          <Show when={restoreError()}>
            <div class="os-upload-error">{restoreError()}</div>
          </Show>
          <div class="os-upload-actions">
            <button type="button" class="os-button os-button-secondary" onClick={props.onClose}>关闭</button>
            <Show when={canRestore()}>
              <button
                type="button"
                class="os-button os-button-primary"
                disabled={restoring()}
                onClick={handleRestore}
              >
                {restoring() ? "恢复中..." : "恢复案例"}
              </button>
            </Show>
          </div>
        </div>
      </div>
    </Portal>
  )
}

function ResourceCard(props: {
  page: ResourceKey
  item: ResourceItem
  highlighted?: boolean
  onChanged?: () => void
  onEdit?: (item: UploadedResource) => void
  primitiveLink?: PrimitiveResourceLink
  primitiveLinkReady?: boolean
  onPrimitiveLinkChange?: (resourceId: string, link: PrimitiveResourceLink) => void
  onPublishPrimitive?: (target: {
    resourceId: string
    resourcePage?: PrimitiveResourcePage
    draftId?: string
    initialPrimitiveType?: string
    publishSlot?: PrimitivePublishSlot
    sourceHint: PrimitiveSourceHint
  }) => void
  workspaceDirectory?: string
  modelScopeDownloads?: ReturnType<typeof useModelScopeDownloadRecords>
  onDatasetDownloadStart?: (resourceId: string, environment?: ModelScopeDownloadStartEnvironment) => Promise<void>
  onDatasetDownloadCancel?: (resourceId: string, environment?: ModelScopeDownloadEnvironment) => Promise<void>
  onDatasetDownloadDelete?: (resourceId: string, environment?: ModelScopeDownloadEnvironment) => Promise<void>
  downloadOnly?: boolean
}) {
  const navigate = useNavigate()
  const server = useServer()
  const layout = useLayout()
  const globalSync = useGlobalSync()
  const dialog = useDialog()
  const queryClient = useQueryClient()
  const openSshMap = useOpenSshTargetMap()
  const workspaceDirectory = useWorkspaceDirectory()
  const openModelScopeSession = useModelScopeSessionNavigate()
  const scientificResearchScenarios = createMemo(() => {
    const model = getScientificResearchModel(props.item.title)
    return model ? scientificResearchScenarioGroups[model] : undefined
  })
  const links = () => modelLinks[props.item.title]
  const actionHref = () => props.item.action === "使用" ? undefined : links()?.github ?? ("href" in props.item ? props.item.href : undefined)
  const cardHref = () => {
    if (props.page === "skills") return undefined
    const linked = links()?.docs ?? links()?.paper ?? ("href" in props.item ? datasetDocLinks[props.item.id] ?? props.item.href : undefined)
    if (linked) return linked
    if (props.page === "datasets") {
      const datasetId = modelScopeDataset()
      if (datasetId) return modelScopeDatasetPageUrl(datasetId)
    }
    return undefined
  }
  const paperHref = () => links()?.paper
  const actionLinks = () => ("links" in props.item && props.item.links ? props.item.links : []).filter((link) => link.href)
  const showFrameworkLinkActions = () => props.page === "frameworks" && actionLinks().length > 0
  const showSourceBadge = () => props.page !== "frameworks" && props.page !== "skills"
  const source = () => getResourceSource(props.item)
  const showPrimaryAction = () => !showFrameworkLinkActions() && !(props.page === "skills" && props.item.action === "安装")
  const canCreatePrimitive = () =>
    !props.downloadOnly &&
    (props.page === "datasets" || props.page === "models" || props.page === "apps" || (props.page !== "skills" && source().tone === "onescience"))
  const modelScopeModel = () => props.page === "models" ? modelScopeModelId(props.item.title) : undefined
  const modelScopeDataset = () => props.page === "datasets" && "id" in props.item ? modelScopeDatasetId(props.item.id) : undefined
  const showDatasetDownload = () => props.page === "datasets" && props.item.action === "下载"
  const modelScopeAvailable = () => isModelScopeResourceAvailable(props.page, props.item)
  const showModelScopeAvailability = () =>
    (props.page === "models" || props.page === "datasets") && !isUserUploadedResource(props.item)
  const operatorImportDisabled = () => props.page === "operators" && props.item.action === "导入"
  const resourceId = () => ("id" in props.item ? props.item.id : undefined)
  const [primitiveLink, setPrimitiveLink] = createSignal<PrimitiveResourceLink>({})
  const [primitiveLinkReady, setPrimitiveLinkReady] = createSignal(false)
  const [useDialogOpen, setUseDialogOpen] = createSignal(false)
  const [primitiveDialogOpen, setPrimitiveDialogOpen] = createSignal(false)
  const [publishSlot, setPublishSlot] = createSignal<PrimitivePublishSlot>("default")
  const [publishDraftId, setPublishDraftId] = createSignal<string | undefined>()
  const [publishInitialPrimitiveType, setPublishInitialPrimitiveType] = createSignal<string | undefined>()
  const resolvedPrimitiveLink = () => props.primitiveLinkReady !== undefined ? (props.primitiveLink ?? {}) : primitiveLink()
  const resolvedPrimitiveLinkReady = () => props.primitiveLinkReady ?? primitiveLinkReady()
  const primitivePublishAction = () => resourcePrimitivePublishAction(props.page, resolvedPrimitiveLink())
  const canPublishPrimitive = () => Boolean(currentResourceAccountId())
  const primitivePublishDisabled = () => primitivePublishAction().disabled || !canPublishPrimitive()
  const primitivePublishLabel = () => primitivePublishAction().label
  const primitivePublishTitle = () => {
    if (!canPublishPrimitive()) return "请先登录"
    if (primitivePublishAction().disabled) return "该资源已发布可调用原语"
    return undefined
  }
  const canDownloadDataset = () => Boolean(currentResourceAccountId())
  const datasetDownloadDisabled = () => !modelScopeDataset() || downloadDeleting() || !canDownloadDataset()
  const datasetDownloadTitle = () => {
    if (!canDownloadDataset()) return "请先登录"
    return undefined
  }
  const showPrimitiveViewAction = () => resourcePrimitiveSlotsPublished(props.page, resolvedPrimitiveLink())
  const primitiveViewCallableId = () => {
    const link = resolvedPrimitiveLink()
    if (props.page === "models") return link.inferenceCallableId ?? link.trainingCallableId ?? link.callableId
    if (props.page === "datasets") return link.datasetCallableId ?? link.dataProcessingCallableId ?? link.callableId
    return link.callableId
  }
  const primitiveResourcePage = () =>
    props.page === "datasets" || props.page === "models" || props.page === "apps" || props.page === "frameworks" ? props.page : undefined
  const primitiveSourceHint = (): PrimitiveSourceHint => ({
    title: props.item.title,
    copy: props.item.copy,
    provider: props.item.provider,
    tags: [...props.item.tags],
    domain: ("domain" in props.item && typeof props.item.domain === "string") ? props.item.domain : props.item.tags.find((tag) => resourceCardDomainTags.has(tag)),
    format: props.item.format,
    size: props.item.size,
    href: "href" in props.item && typeof props.item.href === "string" ? props.item.href : undefined,
    page: primitiveResourcePage(),
    datasetDownloadMethod: props.page === "datasets" && "id" in props.item ? modelScopeDatasetDownloadMethod(props.item.id) : undefined,
    modelDownloadMethod: props.page === "models" ? modelScopeModelDownloadMethod(props.item.title) : undefined,
  })
  const openPrimitivePublish = () => {
    const id = resourceId()
    if (!id) return
    const action = primitivePublishAction()
    const target = {
      resourceId: id,
      resourcePage: primitiveResourcePage(),
      draftId: action.draftId,
      initialPrimitiveType: action.initialPrimitiveType,
      publishSlot: action.publishSlot ?? "default",
      sourceHint: primitiveSourceHint(),
    }
    if (props.onPublishPrimitive) {
      props.onPublishPrimitive(target)
      return
    }
    setPublishSlot(action.publishSlot ?? "default")
    setPublishDraftId(action.draftId)
    setPublishInitialPrimitiveType(action.initialPrimitiveType)
    setPrimitiveDialogOpen(true)
  }
  createEffect(() => {
    if (props.primitiveLinkReady !== undefined) return
    const id = resourceId()
    const current = server.current
    if (!id || !current || !canCreatePrimitive()) {
      setPrimitiveLink({})
      setPrimitiveLinkReady(true)
      return
    }
    setPrimitiveLinkReady(false)
    let active = true
    void lookupPrimitiveByResource(current.http.url, id).then((result) => {
      if (!active) return
      if (!result.loaded) {
        setPrimitiveLink({})
        setPrimitiveLinkReady(true)
        return
      }
      setPrimitiveLink(mapPrimitiveResourceLink({
        callable: result.callable,
        draft: result.draft,
        inference: result.inference,
        training: result.training,
        slots: result.slots,
      }))
      setPrimitiveLinkReady(true)
    })
    onCleanup(() => {
      active = false
    })
  })
  const [developDialogOpen, setDevelopDialogOpen] = createSignal(false)
  const [downloadDialogOpen, setDownloadDialogOpen] = createSignal(false)
  const [downloadCancelDialogOpen, setDownloadCancelDialogOpen] = createSignal(false)
  const [downloadDeleteDialogOpen, setDownloadDeleteDialogOpen] = createSignal(false)
  const [downloadDeleteKeys, setDownloadDeleteKeys] = createSignal<string[]>([])
  const [downloadStarting, setDownloadStarting] = createSignal(false)
  const [downloadCancelling, setDownloadCancelling] = createSignal(false)
  const [downloadDeleting, setDownloadDeleting] = createSignal(false)
  const [caseChecking, setCaseChecking] = createSignal(false)
  const [skillDetailOpen, setSkillDetailOpen] = createSignal(false)
  const caseSessionId = () => ("sessionId" in props.item ? props.item.sessionId : undefined)
  const isSkillCard = () => props.page === "skills"
  const openSkillDetail = () => setSkillDetailOpen(true)
  const openCaseSession = async () => {
    const sessionId = caseSessionId()
    if (!sessionId || caseChecking()) return
    if (!server.current) {
      showCaseMissingDialog()
      return
    }
    setCaseChecking(true)
    try {
      const result = await openSharedCaseSession({
        sessionId,
        serverUrl: server.current.http.url,
        navigate,
        ensureSessions: (directory) => {
          void globalSync.project.loadSessions(directory)
        },
      })
      if (result === "missing") showCaseMissingDialog()
    } catch {
      showCaseMissingDialog()
    } finally {
      setCaseChecking(false)
    }
  }
  const showCaseMissingDialog = () => {
    const sessionId = caseSessionId()
    dialog.show(() => (
      <CaseMissingDialog
        title={props.item.title}
        sessionId={sessionId}
        onClose={() => dialog.close()}
        onRestore={sessionId ? (id) => restoreCaseSession(id) : undefined}
      />
    ))
  }
  const restoreCaseSession = async (sessionId: string) => {
    const current = server.current
    if (!current) throw new Error("恢复失败")

    const result = await restoreSharedPresetCase(current.http.url, sessionId)
    dialog.close()
    await openSharedCaseSession({
      sessionId: result.sessionId,
      serverUrl: current.http.url,
      navigate,
      ensureSessions: (directory) => {
        void globalSync.project.loadSessions(directory)
      },
    })
  }
  const runtimeSnapshot = createMemo(() => {
    runtimeEnvironmentRevision()
    const directory = props.workspaceDirectory ?? workspaceDirectory()
    return resolveRuntimeEnvironmentSnapshot({
      directory,
      ssh: openSshMap() as Record<string, SshTargetOption> | undefined,
      mcp: queryClient.getQueryData(globalSync.queryOptions.mcp(pathKey(directory)).queryKey),
    })
  })
  const sshTargets = createMemo(() =>
    listRegisteredSshTargets(openSshMap() as Record<string, SshTargetOption> | undefined),
  )
  /** Environment the dataset badge/progress reflects: the global selection (scnet has no server-side records). */
  const downloadRecordEnv = createMemo((): ModelScopeDownloadEnvironment | undefined => {
    const env = runtimeSnapshot().env
    if (env.kind === "scnet") return undefined
    if (env.kind === "ssh") return { kind: "ssh", targetName: env.targetName }
    return { kind: "local" }
  })
  const downloadRecord = createMemo(() => {
    const downloads = props.modelScopeDownloads
    const datasetId = modelScopeDataset()
    if (!downloads || !datasetId) return undefined
    return selectDatasetProgressRecord(downloads.records(), datasetId, downloadRecordEnv())
  })
  /** Environment used to act on the current record (cancel/delete) — from the record itself, not the global selection. */
  const downloadRecordActionEnv = createMemo((): ModelScopeDownloadEnvironment | undefined => {
    const env = downloadRecord()?.environment
    if (!env) return downloadRecordEnv()
    if (env.kind === "ssh") return { kind: "ssh", targetName: env.targetName }
    return { kind: "local" }
  })
  const datasetDownloading = createMemo(() => downloadRecord()?.status === "downloading")
  const datasetDownloadedBytes = createMemo(() => downloadRecord()?.downloaded_bytes ?? 0)
  const datasetDownloadPreparing = createMemo(() => datasetDownloading() && datasetDownloadedBytes() <= 0)
  const datasetDownloadTotal = createMemo(() => {
    const record = downloadRecord()
    if (!record) return undefined
    if (record.progress_total_bytes && record.progress_total_bytes > 0) {
      return { bytes: record.progress_total_bytes, estimated: false as const }
    }
    if (record.estimated_total_bytes && record.estimated_total_bytes > 0) {
      return { bytes: record.estimated_total_bytes, estimated: true as const }
    }
    return undefined
  })
  const datasetDownloadPercent = createMemo(() => {
    const record = downloadRecord()
    const total = datasetDownloadTotal()
    if (total) {
      const bytes = record?.downloaded_bytes ?? 0
      if (bytes <= 0) return undefined
      if (total.estimated && bytes >= total.bytes) return undefined
      return Math.min(100, Math.round((bytes / total.bytes) * 100))
    }
    const currentTotal = record?.current_file_total_bytes
    if (currentTotal && currentTotal > 0) {
      const currentBytes = record?.current_file_bytes ?? 0
      return Math.min(100, Math.round((currentBytes / currentTotal) * 100))
    }
    return undefined
  })
  const [sshWaitTick, setSshWaitTick] = createSignal(0)
  createEffect(() => {
    if (!datasetDownloadPreparing() || downloadRecord()?.environment?.kind !== "ssh") return
    const timer = setInterval(() => setSshWaitTick((value) => value + 1), 1_000)
    onCleanup(() => clearInterval(timer))
  })
  const sshWaitingLabel = () => {
    sshWaitTick()
    const started = downloadRecord()?.started_at
    if (!started) return "正在等待远端环境完成下载…"
    const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000))
    const mm = String(Math.floor(seconds / 60)).padStart(2, "0")
    const ss = String(seconds % 60).padStart(2, "0")
    return `正在等待远端环境完成下载（已用时 ${mm}:${ss}）…`
  }
  const datasetDownloadLabel = createMemo(() => {
    if (datasetDownloadPreparing()) {
      return downloadRecord()?.environment?.kind === "ssh" ? sshWaitingLabel() : "正在准备..."
    }
    const record = downloadRecord()
    const downloaded = formatDownloadBytes(record?.downloaded_bytes)
    const total = datasetDownloadTotal()
    if (total) {
      const totalLabel = total.estimated
        ? `约 ${formatDownloadBytes(total.bytes)}（预估）`
        : formatDownloadBytes(total.bytes)
      const percent = datasetDownloadPercent()
      if (percent !== undefined) {
        return `正在下载 · ${downloaded} / ${totalLabel} (${percent}%)`
      }
      return `正在下载 · ${downloaded} / ${totalLabel}`
    }
    const currentFile = record?.current_file
    const currentTotal = record?.current_file_total_bytes
    if (currentFile && currentTotal && currentTotal > 0) {
      const shortName = currentFile.split("/").pop() ?? currentFile
      const currentBytes = formatDownloadBytes(record?.current_file_bytes)
      const currentTotalLabel = formatDownloadBytes(currentTotal)
      return `正在下载 · ${shortName} · ${currentBytes} / ${currentTotalLabel}`
    }
    return `已下载 · ${downloaded}`
  })
  const datasetDownloadCopies = createMemo(() => {
    const datasetId = modelScopeDataset()
    const downloads = props.modelScopeDownloads
    if (!datasetId || !downloads) return []
    return listDatasetDownloadCopies(downloads.records(), datasetId, props.workspaceDirectory)
  })
  const datasetDownloaded = createMemo(() => datasetDownloadCopies().some((copy) => !copy.partial))
  const datasetPartial = createMemo(() => downloadRecord()?.status === "partial")
  const datasetRemovable = createMemo(() => datasetDownloadCopies().length > 0)
  const datasetDeleteTitle = () => {
    const copies = datasetDownloadCopies()
    if (copies.length > 1) return "删除已下载的数据集（可选择环境）"
    if (copies[0]?.partial) return "清理未完成的下载文件（下载已取消，磁盘上仍有残留）"
    return "删除已下载的数据集"
  }
  const datasetTargetPath = () =>
    modelScopeDataset() && props.workspaceDirectory
      ? `${props.workspaceDirectory}/${modelScopeDatasetRelativePath(modelScopeDataset()!)}`
      : ""
  const [downloadPreflight, setDownloadPreflight] = createSignal<ModelScopeDownloadPreflight | undefined>()
  const [downloadDiskBytes, setDownloadDiskBytes] = createSignal<number | undefined>()
  const [downloadDiskLoading, setDownloadDiskLoading] = createSignal(false)
  const [downloadSizeLoading, setDownloadSizeLoading] = createSignal(false)
  /** Dialog-local download environment; initialized from the global selection, never writes back. */
  const [downloadEnv, setDownloadEnv] = createSignal<RuntimeEnvironment>({ kind: "local" })
  const [downloadRemotePath, setDownloadRemotePath] = createSignal("")
  const [downloadError, setDownloadError] = createSignal<string>()

  const defaultDownloadRemotePath = (targetName: string) => {
    const target = sshTargets().find((item) => item.name === targetName)
    return target ? `${target.remotePath.replace(/\/+$/, "")}/modelscope/hub/datasets` : ""
  }

  const changeDownloadEnv = (env: RuntimeEnvironment) => {
    setDownloadEnv(env)
    setDownloadError(undefined)
    // Switching targets always resets the path: ssh gets that target's default cache_dir, others clear it.
    if (env.kind === "ssh") {
      setDownloadRemotePath(defaultDownloadRemotePath(env.targetName))
      return
    }
    setDownloadRemotePath("")
  }

  const downloadStartEnvironment = createMemo((): ModelScopeDownloadStartEnvironment | undefined => {
    const env = downloadEnv()
    if (env.kind === "local") return { kind: "local" }
    if (env.kind !== "ssh") return undefined
    const target = sshTargets().find((item) => item.name === env.targetName)
    const remotePath = downloadRemotePath().trim()
    if (!target || !remotePath) return undefined
    return {
      kind: "ssh",
      targetName: target.name,
      remotePath,
      ssh: target,
    }
  })
  /** Record for the environment selected inside the dialog — drives the 下载/更新 label. */
  const downloadDialogRecord = createMemo(() => {
    const downloads = props.modelScopeDownloads
    const datasetId = modelScopeDataset()
    if (!downloads || !datasetId) return undefined
    const env = downloadEnv()
    if (env.kind === "scnet") return undefined
    const key = downloadRecordKey(
      env.kind === "ssh" ? { kind: "ssh" as const, targetName: env.targetName } : { kind: "local" as const },
      datasetId,
    )
    return downloads.records()[key]
  })

  // Dataset size preflight: keyed by dataset only, so editing the remote path does not refetch.
  createEffect(
    on(
      () => {
        if (!downloadDialogOpen()) return undefined
        const datasetId = modelScopeDataset()
        const directory = props.workspaceDirectory
        const current = server.current
        if (!datasetId || !directory || !current) return undefined
        return { url: current.http.url, directory, datasetId }
      },
      (input) => {
        if (!input) {
          setDownloadPreflight(undefined)
          setDownloadSizeLoading(false)
          return
        }

        let cancelled = false
        setDownloadPreflight(undefined)
        setDownloadSizeLoading(true)

        void fetchModelScopeDownloadPreflight(input.url, input.directory, input.datasetId)
          .then((data) => {
            if (!cancelled) setDownloadPreflight(data)
          })
          .catch(() => {
            if (!cancelled) setDownloadPreflight(undefined)
          })
          .finally(() => {
            if (!cancelled) setDownloadSizeLoading(false)
          })

        onCleanup(() => {
          cancelled = true
        })
      },
    ),
  )

  // Disk space preflight: follows the dialog target host/path. Conda is not part of df.
  createEffect(
    on(
      () => {
        if (!downloadDialogOpen()) return undefined
        const directory = props.workspaceDirectory
        const current = server.current
        if (!directory || !current) return undefined
        const env = downloadEnv()
        if (env.kind === "scnet") {
          return { url: current.http.url, directory, scnet: true as const, diskUnavailable: false, diskKey: "scnet" }
        }
        if (env.kind === "ssh") {
          const remotePath = downloadRemotePath().trim()
          const target = sshTargets().find((item) => item.name === env.targetName)
          if (!target || !remotePath) {
            return {
              url: current.http.url,
              directory,
              scnet: false as const,
              diskUnavailable: true,
              diskKey: `ssh-missing:${env.targetName}`,
            }
          }
          return {
            url: current.http.url,
            directory,
            scnet: false as const,
            diskUnavailable: false,
            diskKey: `ssh:${target.name}:${remotePath}`,
            environment: {
              kind: "ssh" as const,
              targetName: target.name,
              remotePath,
              ssh: target,
            },
          }
        }
        return {
          url: current.http.url,
          directory,
          scnet: false as const,
          diskUnavailable: false,
          diskKey: `local:${directory}`,
          environment: { kind: "local" as const },
        }
      },
      (input) => {
        if (!input) {
          setDownloadDiskBytes(undefined)
          setDownloadDiskLoading(false)
          return
        }

        let cancelled = false
        setDownloadDiskBytes(undefined)
        setDownloadDiskLoading(!input.scnet && !input.diskUnavailable)

        const diskTimer = setTimeout(
          () => {
            if (input.scnet || input.diskUnavailable) return
            void fetchModelScopeDownloadDiskSpace(input.url, input.directory, input.environment)
              .then((data) => {
                if (cancelled) return
                setDownloadDiskBytes(data.availableBytes)
              })
              .catch(() => {
                if (!cancelled) setDownloadDiskBytes(undefined)
              })
              .finally(() => {
                if (!cancelled) setDownloadDiskLoading(false)
              })
          },
          input.environment?.kind === "ssh" ? 400 : 0,
        )

        onCleanup(() => {
          cancelled = true
          clearTimeout(diskTimer)
        })
      },
    ),
  )

  const isDoc = () => "href" in props.item && props.item.action === "打开"
  const openUseDialog = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setUseDialogOpen(true)
  }
  const showAppInstallAction = () =>
    props.page === "apps" && props.item.action === "安装" && "href" in props.item && !!props.item.href
  const openDevelop = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!modelScopeModel()) return
    setDevelopDialogOpen(true)
  }
  const openSkillDevelop = (event?: MouseEvent) => {
    event?.preventDefault()
    event?.stopPropagation()
    setSkillDetailOpen(false)
    const handoff = skillDevelopHandoff({
      id: props.item.id,
      title: props.item.title,
      copy: props.item.copy,
      layer: "layer" in props.item && typeof props.item.layer === "string" ? props.item.layer : undefined,
      tags: props.item.tags,
      provider: props.item.provider,
    })
    openModelScopeSession(handoff.prompt, { skill: handoff.skill })
  }
  const confirmDevelop = (developType: ModelDevelopType, scenarioId?: string) => {
    const modelId = modelScopeModel()
    if (!modelId) return
    setDevelopDialogOpen(false)
    if (developType === "scientific-research") {
      const model = getScientificResearchModel(props.item.title)
      if (!model || !scenarioId) return
      openModelScopeSession(scientificResearchPrompt(model, scenarioId))
      return
    }
    const input = {
      modelId,
      developType,
      title: props.item.title,
      copy: props.item.copy,
    }
    const directory = workspaceDirectory()
    const snapshot = resolveRuntimeEnvironmentSnapshot({
      directory,
      ssh: openSshMap() as Record<string, SshTargetOption> | undefined,
      mcp: queryClient.getQueryData(globalSync.queryOptions.mcp(pathKey(directory)).queryKey),
    })
    const condaEnv = sessionCondaEnvFor(directory, snapshot.env)
    openModelScopeSession(modelDevelopPrompt(input, snapshot.env, { ...snapshot, ...(condaEnv ? { condaEnv } : {}) }), {
      template: modelDevelopPromptTemplate(input),
    })
  }
  const openInstall = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!showAppInstallAction() || !("href" in props.item) || !props.item.href) return
    const input = {
      title: props.item.title,
      copy: props.item.copy,
      format: props.item.format,
      href: props.item.href,
    }
    const directory = workspaceDirectory()
    const snapshot = resolveRuntimeEnvironmentSnapshot({
      directory,
      ssh: openSshMap() as Record<string, SshTargetOption> | undefined,
      mcp: queryClient.getQueryData(globalSync.queryOptions.mcp(pathKey(directory)).queryKey),
    })
    const condaEnv = sessionCondaEnvFor(directory, snapshot.env)
    openModelScopeSession(appInstallPrompt(input, snapshot.env, { ...snapshot, ...(condaEnv ? { condaEnv } : {}) }), {
      template: appInstallPromptTemplate(input),
    })
  }
  const openDatasetDownload = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!canDownloadDataset() || !modelScopeDataset() || datasetDownloading() || downloadDeleting()) return
    const env = runtimeSnapshot().env
    batch(() => {
      setDownloadEnv(env)
      setDownloadRemotePath(env.kind === "ssh" ? defaultDownloadRemotePath(env.targetName) : "")
      setDownloadPreflight(undefined)
      setDownloadDiskBytes(undefined)
      setDownloadDiskLoading(true)
      setDownloadSizeLoading(true)
      setDownloadError(undefined)
      setDownloadDialogOpen(true)
    })
  }
  const openDatasetDownloadCancel = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!modelScopeDataset() || !datasetDownloading()) return
    setDownloadCancelDialogOpen(true)
  }
  const openDatasetDownloadDelete = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!modelScopeDataset() || !datasetRemovable() || downloadDeleting()) return
    setDownloadDeleteKeys([])
    setDownloadDeleteDialogOpen(true)
  }
  const confirmDatasetDownload = async () => {
    const datasetId = modelScopeDataset()
    if (!datasetId || downloadStarting() || downloadDeleting()) return
    const env = downloadEnv()
    if (env.kind === "scnet") {
      setDownloadDialogOpen(false)
      const promptInput = {
        datasetId,
        title: props.item.title,
        targetDir: downloadRemotePath().trim() || undefined,
        serverName: env.serverName,
      }
      openModelScopeSession(datasetDownloadPrompt(promptInput, env), {
        template: datasetDownloadPromptTemplate(promptInput),
      })
      return
    }
    if (!props.onDatasetDownloadStart) return
    const environment = downloadStartEnvironment()
    // Local downloads legitimately have no environment payload; only ssh requires one.
    if (env.kind === "ssh" && !environment) return
    setDownloadStarting(true)
    setDownloadError(undefined)
    try {
      await props.onDatasetDownloadStart(datasetId, environment)
      setDownloadDialogOpen(false)
    } catch (error) {
      setDownloadError(error instanceof Error && error.message.trim() ? error.message : "启动下载失败")
    } finally {
      setDownloadStarting(false)
    }
  }
  const confirmDatasetDownloadCancel = async () => {
    const datasetId = modelScopeDataset()
    if (!datasetId || !props.onDatasetDownloadCancel || downloadCancelling()) return
    setDownloadCancelling(true)
    try {
      await props.onDatasetDownloadCancel(datasetId, downloadRecordActionEnv())
    } finally {
      setDownloadCancelling(false)
      setDownloadCancelDialogOpen(false)
    }
  }
  const confirmDatasetDownloadDelete = async () => {
    const datasetId = modelScopeDataset()
    if (!datasetId || !props.onDatasetDownloadDelete || downloadDeleting()) return
    const selected = new Set(downloadDeleteKeys())
    const targets = datasetDownloadCopies().filter((copy) => selected.has(copy.key))
    if (targets.length === 0) return
    setDownloadDeleting(true)
    try {
      for (const copy of targets) {
        await props.onDatasetDownloadDelete(datasetId, copy.environment)
      }
      setDownloadDeleteDialogOpen(false)
    } finally {
      setDownloadDeleting(false)
    }
  }
  const tags = () =>
    props.item.tags
      .filter((tag) => !hiddenResourceTags.has(tag) && (!isDoc() || !hiddenDocsTags.has(tag)))
      .slice(0, 4)
  const skillCardContent = (
    <div class="os-skill-tile">
      <div class="os-skill-tile-head">
        <h2>{props.item.title}</h2>
        <div class="os-skill-tile-badges">
          <span class="os-skill-tile-badge">{props.item.provider}</span>
          <Show when={props.item.size && props.item.size !== props.item.provider}>
            <span class="os-skill-tile-badge" data-tone="muted">{props.item.size}</span>
          </Show>
        </div>
      </div>
      <ResourceCopy copy={props.item.copy} plain />
      <div class="os-skill-tile-footer">
        <div class="os-skill-tile-meta">
          <span class="os-skill-tile-dot" aria-hidden="true" />
          <span>{("layer" in props.item && typeof props.item.layer === "string" && props.item.layer) || "技能"}</span>
        </div>
        <div class="os-skill-tile-actions">
          <Show when={showPrimaryAction() && props.item.action === "开发"}>
            <button
              type="button"
              class="os-button os-button-card os-card-action-link os-skill-tile-action"
              onClick={openSkillDevelop}
            >
              {props.item.action}
            </button>
          </Show>
          <Show when={!props.downloadOnly}>
            <ResourceCardMenu page={props.page} item={props.item} onChanged={props.onChanged} onEdit={props.onEdit} />
          </Show>
        </div>
      </div>
    </div>
  )
  const content = (
    <>
      <div class="os-card-heading-row">
        <h2>
          <Show when={cardHref()} fallback={props.item.title}>
            {(href) => (
              <a class="os-card-title-link" href={href()} target="_blank" rel="noreferrer">
                {props.item.title}
              </a>
            )}
          </Show>
        </h2>
        <div class="os-card-heading-actions">
          <Show when={showSourceBadge()}>
            <div class="os-source-badge" data-source={source().tone}>{source().label}</div>
          </Show>
          <Show when={!props.downloadOnly}>
            <ResourceCardMenu page={props.page} item={props.item} onChanged={props.onChanged} onEdit={props.onEdit} />
          </Show>
        </div>
      </div>
      <div class="os-tag-row">
        <For each={tags()}>{(tag) => <span class="os-tag">{tag}</span>}</For>
      </div>
      <ResourceCopy copy={props.item.copy} plain={isSkillCard()} />
      <div class="os-meta-list">
        <span><span aria-hidden="true">◈</span><span class="os-meta-text">{props.item.provider}</span></span>
        <span><span aria-hidden="true">◒</span><span class="os-meta-text">{props.item.size}</span></span>
        <Show when={"score" in props.item && props.item.action !== "开发"}>
          <span class="text-green-600"><span aria-hidden="true">✓</span><span class="os-meta-text">{(props.item as ReturnType<typeof model>).score}</span></span>
        </Show>
      </div>
      <Show when={!(props.page === "cases" && caseSessionId())}>
        <div class="os-card-footer">
          <div class="os-card-actions os-card-action-row">
          <Show when={showFrameworkLinkActions()}>
            <For each={actionLinks()}>
              {(link) => <a class="os-button os-button-card os-card-action-link" href={link.href} target="_blank" rel="noreferrer">{link.label}</a>}
            </For>
          </Show>
          <Show when={!props.downloadOnly && showPrimaryAction() && props.item.action === "使用"}>
            <button type="button" class="os-button os-button-card os-card-action-link" onClick={openUseDialog}>{props.item.action}</button>
          </Show>
          <Show when={!props.downloadOnly && paperHref()}>
            {(href) => <a class="os-button os-button-card os-card-action-link" href={href()} target="_blank" rel="noreferrer">论文</a>}
          </Show>
          <Show when={showPrimaryAction() && props.item.action !== "使用"}>
            <Show when={!props.downloadOnly && props.item.action === "开发"}>
              <button
                type="button"
                class="os-button os-button-card os-card-action-link"
                disabled={props.page !== "skills" && !modelScopeModel()}
                onClick={props.page === "skills" ? openSkillDevelop : openDevelop}
              >
                {props.item.action}
              </button>
            </Show>
            <Show when={showDatasetDownload()}>
              <Show
                when={datasetDownloading()}
                fallback={
                  <button
                    type="button"
                    class="os-button os-button-card os-card-action-link"
                    disabled={datasetDownloadDisabled()}
                    title={datasetDownloadTitle()}
                    onClick={openDatasetDownload}
                  >
                    {datasetDownloaded() ? "更新" : "下载"}
                  </button>
                }
              >
                <div class="os-dataset-download-status">
                  <button
                    type="button"
                    class="os-button os-button-card os-button-downloading os-card-action-link"
                    onClick={openDatasetDownloadCancel}
                  >
                    {datasetDownloadLabel()}
                  </button>
                  <div
                    class="os-dataset-download-progress"
                    classList={{
                      "is-preparing": datasetDownloadPreparing(),
                      "is-active": !datasetDownloadPreparing() && datasetDownloadedBytes() > 0,
                      "is-determinate": datasetDownloadPercent() !== undefined,
                    }}
                    role="progressbar"
                    aria-busy={datasetDownloadPreparing() || datasetDownloadPercent() === undefined ? "true" : undefined}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={datasetDownloadPercent() ?? 0}
                    aria-label="数据集下载进度"
                  >
                    <div
                      class="os-dataset-download-progress-fill"
                      style={datasetDownloadPercent() !== undefined ? { width: `${datasetDownloadPercent()}%` } : undefined}
                    />
                  </div>
                </div>
              </Show>
              <Show when={datasetDownloaded() && !datasetDownloading()}>
                <A
                  class="os-button os-button-card os-card-action-link"
                  href={(() => {
                    const paths = datasetDownloadCopies().flatMap((copy) => copy.paths ?? []).filter(Boolean)
                    const params = new URLSearchParams({
                      category: "onedata",
                      onedata: "raw",
                      register: "1",
                    })
                    if (paths[0]) params.set("rawUri", paths[0])
                    if (props.item.title) params.set("rawTitle", props.item.title)
                    return `/workspace/capabilities?${params}`
                  })()}
                  title="下载不会自动登记；请到原始数据确认接入"
                >
                  去原始数据登记
                </A>
              </Show>
            </Show>
            <Show when={!props.downloadOnly && props.item.action === "导入" && !showDatasetDownload()}>
              <button type="button" class="os-button os-button-card os-card-action-link" disabled={operatorImportDisabled()}>
                {props.item.action}
              </button>
            </Show>
            <Show when={!props.downloadOnly && showAppInstallAction()}>
              <button type="button" class="os-button os-button-card os-card-action-link" onClick={openInstall}>
                {props.item.action}
              </button>
            </Show>
            <Show when={!props.downloadOnly && props.item.action !== "开发" && props.item.action !== "下载" && props.item.action !== "导入" && props.item.action !== "打开" && props.item.action !== "基于此开发" && !showAppInstallAction()}>
              <Show
                when={actionHref()}
                fallback={<A href="#" class="os-button os-button-card">{props.item.action}</A>}
              >
                {(href) => <a class="os-button os-button-card os-card-action-link" href={href()} target="_blank" rel="noreferrer">{props.item.action}</a>}
              </Show>
            </Show>
          </Show>
          <Show when={!props.downloadOnly && canCreatePrimitive() && resolvedPrimitiveLinkReady()}>
            <Show
              when={showPrimitiveViewAction() ? primitiveViewCallableId() : undefined}
              fallback={
                <button
                  type="button"
                  class="os-button os-button-card os-card-action-link os-primitive-publish-action"
                  disabled={primitivePublishDisabled()}
                  title={primitivePublishTitle()}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || primitivePublishDisabled()) return
                    event.preventDefault()
                    event.stopPropagation()
                    queueMicrotask(openPrimitivePublish)
                  }}
                >
                  {primitivePublishLabel()}
                </button>
              }
            >
              {(callableId) => (
                <button
                  type="button"
                  class="os-button os-button-card os-card-action-link os-primitive-view-action"
                  onPointerDown={(event) => {
                    if (event.button !== 0) return
                    event.preventDefault()
                    event.stopPropagation()
                    navigate(primitiveCatalogHref({
                      id: callableId(),
                      openDetail: true,
                      scope: isUserUploadedResource(props.item) ? "mine" : undefined,
                    }))
                  }}
                >
                  查看原语
                </button>
              )}
            </Show>
          </Show>
          <Show when={props.page === "datasets" && modelScopeDataset() && (datasetRemovable() || downloadDeleting())}>
            <button
              type="button"
              class={`os-button os-button-card os-card-action-link os-card-delete-action${datasetPartial() ? " os-button-delete-partial-dataset" : " os-button-delete-dataset"}`}
              disabled={downloadDeleting()}
              title={datasetDeleteTitle()}
              onClick={openDatasetDownloadDelete}
            >
              {downloadDeleting() ? "删除中..." : "删除"}
            </button>
          </Show>
        </div>
      </div>
      </Show>
    </>
  )
  const isCaseCard = () => props.page === "cases" && !!caseSessionId()
  const isCardClickable = () => isCaseCard() || isSkillCard()
  const handleCardClick = () => {
    if (isCaseCard()) {
      openCaseSession()
      return
    }
    if (isSkillCard()) openSkillDetail()
  }
  return (
    <>
      <article
        id={props.item.id}
        class="os-resource-card scroll-mt-24"
        classList={{
          "os-resource-card-unavailable": showModelScopeAvailability() && !modelScopeAvailable(),
          "os-resource-card-clickable": isCardClickable(),
          "os-resource-card-highlighted": !!props.highlighted,
          "os-skill-tile-card": isSkillCard(),
          "os-onedata-dataset-card": !!props.downloadOnly,
        }}
        data-source={source().tone}
        data-layer={isSkillCard() ? skillLayerId(props.item) : undefined}
        data-modelscope-available={showModelScopeAvailability() ? String(modelScopeAvailable()) : undefined}
        data-highlighted={props.highlighted ? "true" : undefined}
        role={isCardClickable() ? "button" : undefined}
        tabIndex={isCardClickable() ? 0 : undefined}

        aria-label={isCaseCard() ? `基于此开发 ${props.item.title}` : isSkillCard() ? `查看技能 ${props.item.title}` : undefined}

        onClick={isCardClickable() ? handleCardClick : undefined}
        onKeyDown={isCardClickable() ? (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            handleCardClick()
          }
        } : undefined}
      >
        <Show when={cardHref()}>
          {(href) => (
            <a
              class="os-card-link-cover"
              href={href()}
              target="_blank"
              rel="noreferrer"
              aria-label={`打开 ${props.item.title} 外部链接`}
              tabIndex={-1}
            />
          )}
        </Show>
        {isSkillCard() ? skillCardContent : content}
      </article>
      <PrimitiveUseDialog
        item={props.item}
        open={useDialogOpen()}
        onClose={() => setUseDialogOpen(false)}
        onSubmit={(text) => openModelScopeSession(text)}
      />
      <ModelDevelopDialog
        open={developDialogOpen()}
        title={props.item.title}
        scenarios={scientificResearchScenarios()}
        onClose={() => setDevelopDialogOpen(false)}
        onConfirm={confirmDevelop}
      />
      <SkillDetailDialog
        item={isSkillCard() ? {
          id: props.item.id,
          title: props.item.title,
          copy: props.item.copy,
          layer: "layer" in props.item && typeof props.item.layer === "string" ? props.item.layer : undefined,
          tags: props.item.tags,
          provider: props.item.provider,
        } : undefined}
        open={skillDetailOpen()}
        serverUrl={server.current?.http.url}
        onClose={() => setSkillDetailOpen(false)}
        onDevelop={() => openSkillDevelop()}
      />
      <Show when={!props.downloadOnly && !props.onPublishPrimitive}>
        <PrimitiveCreateDialog
          resourceId={resourceId()}
          resourcePage={primitiveResourcePage()}
          draftId={publishDraftId()}
          initialPrimitiveType={publishInitialPrimitiveType()}
          sourceHint={primitiveSourceHint()}
          serverUrl={server.current?.http.url ?? window.location.origin}
          open={primitiveDialogOpen()}
          onClose={() => {
            setPrimitiveDialogOpen(false)
            setPublishSlot("default")
            setPublishDraftId(undefined)
            setPublishInitialPrimitiveType(undefined)
          }}
          onSuccess={(item) => {
            const rid = resourceId()
            const current = server.current
            if ((props.page === "models" || props.page === "datasets") && rid && current) {
              void lookupPrimitiveByResource(current.http.url, rid).then((result) => {
                if (!result.loaded) return
                const next = mapPrimitiveResourceLink({
                  callable: result.callable,
                  draft: result.draft,
                  inference: result.inference,
                  training: result.training,
                  slots: result.slots,
                })
                if (props.primitiveLinkReady !== undefined) props.onPrimitiveLinkChange?.(rid, next)
                else {
                  setPrimitiveLink(next)
                  setPrimitiveLinkReady(true)
                }
              })
            } else {
              const next = mergePublishedPrimitiveLink(
                resolvedPrimitiveLink(),
                item.id,
                publishSlot(),
              )
              if (props.primitiveLinkReady !== undefined) {
                const resource = resourceId()
                if (resource) props.onPrimitiveLinkChange?.(resource, next)
              } else {
                setPrimitiveLink(next)
                setPrimitiveLinkReady(true)
              }
            }
            setPublishSlot("default")
            setPublishDraftId(undefined)
            setPublishInitialPrimitiveType(undefined)
            setPrimitiveDialogOpen(false)
            finishPrimitivePublish(navigate, item, server.current?.http.url)
          }}
        />
      </Show>
      <DatasetDownloadDialog
        open={downloadDialogOpen()}
        title={props.item.title}
        datasetId={modelScopeDataset() ?? ""}
        targetPath={datasetTargetPath()}
        diskLoading={downloadDiskLoading()}
        sizeLoading={downloadSizeLoading()}
        availableBytes={downloadDiskBytes()}
        datasetBytes={downloadPreflight()?.datasetBytes}
        busy={downloadStarting()}
        actionLabel={downloadDialogRecord()?.status === "completed" ? "更新" : "下载"}
        confirmDisabled={downloadEnv().kind === "ssh" && !downloadStartEnvironment()}
        environment={downloadEnv()}
        environmentSelector={
          <RuntimeEnvironmentSelect
            directory={() => props.workspaceDirectory ?? workspaceDirectory()}
            value={downloadEnv}
            onChange={changeDownloadEnv}
            variant="field"
            downloadedCopies={datasetDownloadCopies}
          />
        }
        remotePath={downloadRemotePath()}
        onRemotePathChange={(value) => {
          setDownloadRemotePath(value)
          setDownloadError(undefined)
        }}
        actualPaths={
          (() => {
            const record = downloadDialogRecord()
            if (!record || (record.status !== "completed" && record.status !== "partial")) return undefined
            return datasetDownloadCopyPaths(record, props.workspaceDirectory).paths
          })()
        }
        error={downloadError()}
        onClose={() => {
          setDownloadDialogOpen(false)
          setDownloadPreflight(undefined)
          setDownloadDiskBytes(undefined)
          setDownloadDiskLoading(false)
          setDownloadSizeLoading(false)
        }}
        onConfirm={() => void confirmDatasetDownload()}
      />
      <DatasetDownloadCancelDialog
        open={downloadCancelDialogOpen()}
        title={props.item.title}
        datasetId={modelScopeDataset() ?? ""}
        busy={downloadCancelling()}
        onClose={() => setDownloadCancelDialogOpen(false)}
        onConfirm={() => void confirmDatasetDownloadCancel()}
      />
      <DatasetDownloadDeleteDialog
        open={downloadDeleteDialogOpen()}
        title={props.item.title}
        datasetId={modelScopeDataset() ?? ""}
        copies={datasetDownloadCopies()}
        selectedKeys={downloadDeleteKeys()}
        onSelectedKeysChange={setDownloadDeleteKeys}
        busy={downloadDeleting()}
        onClose={() => setDownloadDeleteDialogOpen(false)}
        onConfirm={() => void confirmDatasetDownloadDelete()}
      />
    </>
  )
}

function editableResourceFromCard(page: ResourceKey, item: ResourceItem): UploadedResource | undefined {
  if (!isUploadableResourcePage(page)) return
  if (isUploadedResource(item)) return item
  const source = getResourceSource(item).tone
  return {
    id: item.id,
    page,
    title: item.title,
    copy: item.copy,
    domain: item.tags.find((tag) => resourcePages[page].filters.some((filter) => filter === tag)) ?? resourcePages[page].filters.find((filter) => filter !== "全部") ?? "其它",
    tags: [...item.tags],
    provider: item.provider,
    size: item.size,
    format: item.format,
    href: "href" in item ? item.href : undefined,
    source,
    metricLabel: item.metricLabel,
    action: item.action,
  }
}

function ResourceCardMenu(props: { page: ResourceKey; item: ResourceItem; onChanged?: () => void; onEdit?: (item: UploadedResource) => void }) {
  const server = useServer()
  const [open, setOpen] = createSignal(false)
  const [deleteOpen, setDeleteOpen] = createSignal(false)
  const [error, setError] = createSignal("")
  const [deleting, setDeleting] = createSignal(false)
  let menuRef: HTMLDivElement | undefined
  const showMenu = () => isUploadableResourcePage(props.page)
  const canEdit = () => canEditResource(props.item)
  const canDelete = () => canDeleteUploadedResource(props.item)
  createEffect(() => {
    if (!open()) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (menuRef?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener("mousedown", closeOnOutsideClick)
    onCleanup(() => document.removeEventListener("mousedown", closeOnOutsideClick))
  })
  const openMenu = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setOpen((value) => !value)
  }
  const openEdit = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!canEdit()) return
    setOpen(false)
    const item = editableResourceFromCard(props.page, props.item)
    if (item) props.onEdit?.(item)
  }
  const openDelete = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!canDelete()) return
    setOpen(false)
    setDeleteOpen(true)
  }
  const remove = async (event: Event) => {
    event.preventDefault()
    const current = server.current
    if (!current || !isUserUploadedResource(props.item) || !canDelete()) return
    setDeleting(true)
    setError("")
    try {
      await deleteUploadedResource(current.http.url, props.item.page, props.item.id)
      setDeleteOpen(false)
      props.onChanged?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败")
    } finally {
      setDeleting(false)
    }
  }
  return (
    <Show when={showMenu()}>
      <div ref={menuRef} class="os-card-menu" onClick={(event) => event.stopPropagation()}>
        <button type="button" class="os-card-menu-trigger" aria-label={`${props.item.title} 编辑菜单`} onClick={openMenu}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 5.25h6M5 8h6M5 10.75h6" stroke="currentColor" stroke-linecap="round" stroke-width="1.75" />
          </svg>
        </button>
        <Show when={open()}>
          <div class="os-card-menu-popover">
            <button
              type="button"
              disabled={!canEdit()}
              title={canEdit() ? undefined : "登录后可修改"}
              onClick={openEdit}
            >
              修改
            </button>
            <Show when={canDelete()}>
              <button type="button" data-danger="true" onClick={openDelete}>删除</button>
            </Show>
          </div>
        </Show>
        <Show when={deleteOpen() && isUserUploadedResource(props.item)}>
          <Portal>
            <div class="os-modal-backdrop" role="presentation">
              <form class="os-upload-dialog os-delete-dialog" onSubmit={remove} onClick={(event) => event.stopPropagation()}>
                <div class="os-upload-head">
                  <div>
                    <div class="os-eyebrow">删除资源</div>
                    <h2>{props.item.title}</h2>
                  </div>
                  <button type="button" class="os-button os-button-secondary os-button-square" onClick={() => setDeleteOpen(false)}>×</button>
                </div>
                <p>删除后该卡片会从当前资源库中移除。</p>
                <Show when={error()}>{(message) => <div class="os-upload-error">{message()}</div>}</Show>
                <div class="os-upload-actions">
                  <button type="button" class="os-button os-button-secondary" onClick={() => setDeleteOpen(false)}>取消</button>
                  <button class="os-button os-button-primary" type="submit" disabled={deleting()}>{deleting() ? "删除中..." : "删除"}</button>
                </div>
              </form>
            </div>
          </Portal>
        </Show>
      </div>
    </Show>
  )
}

export function InfraPage() {
  return <FrameworksPage />
}

const managedTasks = [
  { title: "蛋白质结构预测训练", model: "AlphaFold-v3", status: "训练中", tone: "blue", progress: 65, meta: "Epoch 130/200" },
  { title: "气象预测模型微调", model: "FourCastNet", status: "已完成", tone: "green", progress: 100, meta: "验证集 MAE 0.082" },
  { title: "分子动力学势函数训练", model: "MACE", status: "等待中", tone: "slate", progress: 0, meta: "等待 A100 队列" },
  { title: "CFD湍流模型训练", model: "MeshGraphNet", status: "失败", tone: "red", progress: 38, meta: "数据校验失败" },
] as const

const dataAssets = [
  {
    title: "ERA5 再分析 AI Ready 数据",
    type: "AI Ready",
    copy: "从 GRIB 原始文件完成时空裁剪、变量标准化和 Zarr 分片发布，可直接接入气象基础模型训练。",
    meta: ["2.4 PB", "12 个变量", "发布 v3"],
    tags: ["气象", "再分析", "Zarr", "AI Ready"],
    visits: "访问 156 次",
  },
  {
    title: "AlphaFold 蛋白结构原始数据湖",
    type: "原始数据",
    copy: "保留来源、许可、校验和与下载批次，支持后续结构清洗、聚类和特征生成工作流。",
    meta: ["23 TB", "导入", "2024-01-01"],
    tags: ["蛋白质", "结构", "原始数据"],
    visits: "访问 234 次",
  },
  {
    title: "QM9 分子属性预处理集",
    type: "预处理",
    copy: "完成分子格式统一、异常样本剔除和属性归一化，作为生成数据与模型评测的中间版本。",
    meta: ["500 MB", "130,000 条记录", "质检通过"],
    tags: ["分子", "量子化学", "预处理"],
    visits: "访问 89 次",
  },
  {
    title: "CFD 翼型仿真生成数据",
    type: "生成数据",
    copy: "通过参数化翼型和 OpenFOAM 批量生成流场样本，记录工作流、算子版本和资源消耗。",
    meta: ["8.6 TB", "4,200 样本", "工作流 #42"],
    tags: ["流体", "仿真", "生成数据"],
    visits: "访问 62 次",
  },
] as const

const dataWorkflowStages = [
  { title: "原始数据接入", copy: "采集来源、许可、校验和与批次元数据", status: "5 个来源", progress: 100 },
  { title: "预处理与质检", copy: "清洗、格式转换、缺失值检查和质量评分", status: "3 条运行中", progress: 72 },
  { title: "生成数据构建", copy: "仿真、增强、特征生成与版本追踪", status: "2 条等待", progress: 48 },
  { title: "AI Ready 发布", copy: "切分、索引、权限、评测基线和可复用发布", status: "1 个待发布", progress: 35 },
] as const

export function TasksPage() {
  return (
    <div class="os-management-page">
      <header class="os-management-topbar">
        <div>
          <div class="os-management-title-row">
            <WorkspaceNavIcon name="tasks" />
            <h1>任务管理</h1>
            <span class="os-management-count">训练中 1</span>
            <span class="os-management-count">已完成 1</span>
            <span class="os-management-count os-management-count-danger">失败 1</span>
          </div>
          <p>统一管理科研开发中的训练、处理、生成和发布任务。</p>
        </div>
        <div class="os-management-actions">
          <button class="os-button os-button-secondary" type="button">任务配置</button>
          <button class="os-button os-button-primary" type="button">+ 新建任务</button>
        </div>
      </header>
      <div class="os-management-layout os-management-layout-tasks">
        <aside class="os-management-sidebar">
          <div class="os-search-box">⌕ 搜索训练任务...</div>
          <div class="os-management-list">
            <For each={managedTasks}>
              {(task, index) => (
                <article classList={{ "os-management-list-card": true, "is-active": index() === 0 }}>
                  <div class="os-management-card-head">
                    <h2>{task.title}</h2>
                    <span data-tone={task.tone}>{task.status}</span>
                  </div>
                  <p>{task.model}</p>
                  <div class="os-management-progress-row">
                    <span>{task.meta}</span>
                    <strong>{task.progress}%</strong>
                  </div>
                  <div class="os-progress-track"><div class="os-progress-fill" style={{ width: `${task.progress}%` }} /></div>
                </article>
              )}
            </For>
          </div>
        </aside>
        <section class="os-management-detail">
          <div class="os-management-detail-head">
            <div>
              <h2>蛋白质结构预测训练</h2>
              <p>AlphaFold-v3</p>
            </div>
            <div class="os-management-actions">
              <button class="os-button os-button-secondary" type="button">暂停</button>
              <button class="os-button os-button-ghost" type="button">•••</button>
            </div>
          </div>
          <div class="os-management-metrics">
            <div><span>Loss</span><strong>0.0234</strong></div>
            <div><span>Accuracy</span><strong>94.56%</strong></div>
            <div><span>预计剩余</span><strong>2小时30分</strong></div>
            <div><span>资源</span><strong>4× A100</strong></div>
          </div>
          <section class="os-management-panel">
            <div class="os-management-section-head"><h3>训练进度</h3><strong>65%</strong></div>
            <p>总体进度</p>
            <div class="os-progress-track"><div class="os-progress-fill" style={{ width: "65%" }} /></div>
            <div class="os-management-progress-row"><span>Epoch 130 / 200</span><span>开始时间: 2024-01-15 09:30</span></div>
          </section>
          <section class="os-management-panel">
            <div class="os-management-section-head"><h3>训练日志</h3></div>
            <pre class="os-management-log">[11:33:26] 训练任务已创建
[11:33:26] 分配资源：4× A100
[11:33:26] 开始训练
[11:33:26] Epoch 1/100 - Loss: 0.1234 - Accuracy: 0.5678
[11:33:26] Epoch 2/100 - Loss: 0.0987 - Accuracy: 0.6234
[11:33:26] Epoch 3/100 - Loss: 0.0876 - Accuracy: 0.6789</pre>
          </section>
        </section>
      </div>
    </div>
  )
}

type DataProjectStatus = "draft" | "submitted" | "analyzing" | "plan_ready" | "building" | "ai_ready" | "training_linked" | "publish_pending" | "published" | "failed"

type DataProject = {
  id: string
  title: string
  description: string
  domain: string
  status: DataProjectStatus
  rawDataUri: string
  rawDataFormat: string
  rawDataLicense?: string
  rawDataMetadataJson?: Record<string, unknown>
  targetDatasetName: string
  targetDatasetGoal: string
  targetTaskType: string
  timeCreated: number
  timeUpdated: number
}

type DataProjectArtifact = {
  id: string
  artifactType: string
  title: string
  uri?: string
  format: string
  version?: string
  qualityScore?: number
}

type DataProjectRelease = {
  id: string
  target: "model_training" | "onehub"
  status: string
  resourceId?: string
}

type DataProjectRun = {
  id: string
  runType: string
  status: string
  inputJson: Record<string, unknown>
  planJson?: Record<string, unknown>
  resultJson?: Record<string, unknown>
}

type DataProjectDetail = {
  project: DataProject
  runs: DataProjectRun[]
  artifacts: DataProjectArtifact[]
  qualityReports: Array<{ id: string; trainReadyScore?: number; checksJson: Record<string, unknown> }>
  releases: DataProjectRelease[]
}

type DataProjectCreateInput = {
  title: string
  description: string
  domain: string
  rawDataUri: string
  rawDataFormat: string
  rawDataLicense?: string
  rawDataMetadataJson?: Record<string, unknown>
  targetDatasetName: string
  targetDatasetGoal: string
  targetTaskType: string
}

const dataProjectStatusLabels: Record<DataProjectStatus, string> = {
  draft: "草稿",
  submitted: "已提交",
  analyzing: "智能体分析中",
  plan_ready: "计划就绪",
  building: "AI Ready 构建中",
  ai_ready: "AI Ready",
  training_linked: "已接入训练",
  publish_pending: "发布中",
  published: "已发布 OneHub",
  failed: "失败",
}

const fallbackDataProjectDetails: DataProjectDetail[] = [
  {
    project: {
      id: "sample-era5-ai-ready",
      title: "ERA5 原始气象数据接入",
      description: "用户提供 ERA5 Zarr 原始数据地址，目标是生成可训练的天气预测 AI Ready 数据集。",
      domain: "地球科学",
      status: "ai_ready",
      rawDataUri: "https://example.org/raw/era5.zarr",
      rawDataFormat: "zarr",
      rawDataLicense: "CC-BY-4.0",
      rawDataMetadataJson: { variables: ["t2m", "u10", "v10"], cadence: "hourly" },
      targetDatasetName: "ERA5 AI Ready Forecast Dataset",
      targetDatasetGoal: "用于天气预测模型训练和评估",
      targetTaskType: "forecasting",
      timeCreated: Date.now() - 86_400_000,
      timeUpdated: Date.now(),
    },
    runs: [
      {
        id: "sample-run-era5-plan",
        runType: "plan",
        status: "completed",
        inputJson: { rawDataUri: "https://example.org/raw/era5.zarr", targetDatasetGoal: "用于天气预测模型训练和评估" },
        planJson: { steps: ["读取元数据", "推断变量 schema", "生成切分策略", "输出 AI Ready 规范"] },
        resultJson: { recommendation: "可生成 AI Ready 数据集，并建议接入天气预测模型训练。" },
      },
    ],
    artifacts: [
      { id: "sample-artifact-era5-spec", artifactType: "ai_ready_spec", title: "AI Ready 数据集规范", format: "JSON", qualityScore: 0.92 },
      { id: "sample-artifact-era5-dataset", artifactType: "ai_ready_dataset", title: "ERA5 AI Ready v1", uri: "file:///data/era5-ai-ready", format: "zarr", version: "v1", qualityScore: 0.91 },
    ],
    qualityReports: [{ id: "sample-quality-era5", trainReadyScore: 0.91, checksJson: { schema: "passed", license: "passed", missing: "warning" } }],
    releases: [],
  },
]

async function listDataProjects(serverUrl: string, input?: { status?: string; domain?: string; limit?: number; offset?: number }) {
  const query = new URLSearchParams({ limit: String(input?.limit ?? 24), offset: String(input?.offset ?? 0) })
  if (input?.status) query.set("status", input.status)
  if (input?.domain) query.set("domain", input.domain)
  try {
    const response = await authenticatedFetch(`${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/data-project?${query}`)
    if (!response.ok) return { items: fallbackDataProjectDetails.map((item) => item.project), loaded: false }
    return { ...await response.json() as { items: DataProject[]; nextOffset?: number }, loaded: true }
  } catch {
    return { items: fallbackDataProjectDetails.map((item) => item.project), loaded: false }
  }
}

async function createDataProject(serverUrl: string, input: DataProjectCreateInput) {
  try {
    const response = await authenticatedFetch(`${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/data-project`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
    if (!response.ok) return undefined
    return await response.json() as DataProjectDetail
  } catch {
    return undefined
  }
}

async function getDataProject(serverUrl: string, id: string) {
  try {
    const response = await authenticatedFetch(`${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/data-project/${id}`)
    if (!response.ok) return fallbackDataProjectDetails.find((item) => item.project.id === id)
    return await response.json() as DataProjectDetail
  } catch {
    return fallbackDataProjectDetails.find((item) => item.project.id === id)
  }
}

async function analyzeDataProject(serverUrl: string, id: string) {
  const response = await authenticatedFetch(`${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/data-project/${id}/analyze`, { method: "POST" })
  if (!response.ok) return getDataProject(serverUrl, id)
  return await response.json() as DataProjectDetail
}

async function publishDataProject(serverUrl: string, id: string, artifactId: string) {
  const response = await authenticatedFetch(`${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/data-project/${id}/publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ artifactId }),
  })
  if (!response.ok) return getDataProject(serverUrl, id)
  return await response.json() as DataProjectDetail
}

async function createTrainingHandoff(serverUrl: string, id: string, artifactId: string) {
  const response = await authenticatedFetch(`${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/data-project/${id}/training`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ artifactId, trainingConfigJson: { source: "data-management", mode: "ai-ready" } }),
  })
  if (!response.ok) return getDataProject(serverUrl, id)
  return await response.json() as DataProjectDetail
}

export function DataManagementPage() {
  return (
    <div class="os-management-page os-data-intake-page">
      <header class="os-management-topbar">
        <div>
          <div class="os-management-title-row">
            <WorkspaceNavIcon name="data-management" />
            <h1>数据管理</h1>
          </div>
          <p>数据接入与可训练数据已迁移到能力中心的 OneData。旧版 AI Ready 项目流已停用。</p>
        </div>
        <div class="os-management-actions">
          <A
            href={`${workspaceCapabilitiesCategoryHref("onedata")}&onedata=raw`}
            class="os-button os-button-primary"
          >
            打开 OneData
          </A>
        </div>
      </header>
    </div>
  )
}

export function DatasetsPage() {
  return <ResourcePage page="datasets" />
}

export function OnedataDownloadCatalog(props: {
  filter: string
  domainLabel?: string
  onRegisterOwnData?: () => void
}) {
  const workspaceDirectory = useWorkspaceDirectory()
  const modelScopeDownloads = useModelScopeDownloadRecords(workspaceDirectory)
  const [query, setQuery] = createSignal("")
  const [page, setPage] = createSignal(1)
  createEffect(() => {
    props.filter
    setQuery("")
    setPage(1)
  })
  createEffect(() => {
    query()
    setPage(1)
  })
  createEffect(() => {
    workspaceDirectory()
    const idleId = deferIdleWork(() => {
      void modelScopeDownloads.refresh()
    }, 300)
    onCleanup(() => cancelIdleWork(idleId))
  })
  const items = createMemo(() => {
    const filtered = filterResourceItems("datasets", props.filter, resourcePages.datasets.items)
    return sortResourceItemsByModelScopeAvailability("datasets", searchResourceItems(query(), filtered))
  })
  const total = createMemo(() => filterResourceItems("datasets", props.filter, resourcePages.datasets.items).length)
  const paged = createMemo(() => paginate(items(), page(), CAPABILITY_PAGE_SIZE_RESOURCE))
  createEffect(() => {
    const safe = paged().page
    if (safe !== page()) setPage(safe)
  })

  const registerOwnDataLink = () =>
    props.onRegisterOwnData ? (
      <button type="button" class="os-onedata-stage-link" onClick={() => props.onRegisterOwnData?.()}>
        没有合适的？去登记自己的数据
      </button>
    ) : null

  return (
    <>
      <div class="os-client-capability-catalog-toolbar">
        <label class="os-client-capability-catalog-search">
          <span>搜索</span>
          <input
            type="search"
            placeholder="按名称、简介或标签筛选"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <div class="os-client-capability-catalog-toolbar-side">
          <Show when={!!props.onRegisterOwnData}>{registerOwnDataLink()}</Show>
          <span class="os-client-capability-catalog-count">
            {items().length === total() ? `共 ${total()} 项` : `${items().length} / ${total()} 项`}
          </span>
        </div>
      </div>
      <Show
        when={items().length > 0}
        fallback={
          <p class="os-client-capability-empty">
            {query().trim()
              ? `没有匹配「${query().trim()}」的数据集，试试换个关键词。`
              : `当前「${props.domainLabel ?? props.filter}」领域暂无数据集卡片。`}
          </p>
        }
      >
        <div class="os-resource-grid os-client-capability-onedata-grid">
          <For each={paged().pageItems}>
            {(item) => (
              <ResourceCard
                page="datasets"
                item={item}
                downloadOnly
                workspaceDirectory={workspaceDirectory()}
                modelScopeDownloads={modelScopeDownloads}
                onDatasetDownloadStart={modelScopeDownloads.start}
                onDatasetDownloadCancel={modelScopeDownloads.cancel}
                onDatasetDownloadDelete={modelScopeDownloads.remove}
              />
            )}
          </For>
        </div>
        <CapabilityPager
          page={paged().page}
          totalPages={paged().totalPages}
          total={paged().total}
          onPageChange={setPage}
        />
      </Show>
    </>
  )
}

export function AppHubPage() {
  return <AppsPage />
}

export function SkillsPage() {
  return <SkillsDynamicPage />
}

export function PrimitivesPage() {
  return <PrimitiveWorkspacePage />
}

function finishPrimitivePublish(navigate: ReturnType<typeof useNavigate>, item: AIPrimitiveItem, serverUrl?: string) {
  const published = {
    ...item,
    status: "callable" as const,
    owner: item.owner ?? storedPlatformAuthSession()?.account.id ?? "local",
    timeCreated: item.timeCreated ?? Date.now(),
  }
  if (serverUrl) {
    const cached = readCallableCatalogCache(serverUrl) ?? []
    writeCallableCatalogCache(serverUrl, [published, ...cached.filter((entry) => entry.id !== item.id)])
  }
  // Navigate straight to the catalog result — no success toast.
  navigate(primitiveCatalogHref({ id: published.id, scope: "mine" }), { replace: true })
}

function PrimitiveWorkspacePage() {
  const primitiveWorkspaceTabs = ["tab=catalog", "tab=factory"] as const
  const location = useLocation()
  const navigate = useNavigate()
  const searchParams = createMemo(() => new URLSearchParams(location.search))
  const highlightId = createMemo(() => searchParams().get("highlight") ?? undefined)
  const catalogScope = createMemo((): PrimitiveCatalogScope => {
    const scope = searchParams().get("scope")
    if (scope === "mine" || scope === "recent") return scope
    return "all"
  })
  const openDetail = createMemo(() => searchParams().get("openDetail") === "1")
  const openUse = createMemo(() => searchParams().get("openUse") === "1")
  const activeTab = createMemo(() => {
    const tab = searchParams().get("tab")
    if (tab === "factory") return tab
    return "catalog"
  })
  const selectTab = (tab: "catalog" | "factory") => {
    const params = new URLSearchParams(location.search)
    params.set("tab", tab)
    navigate(`/primitives?${params}`)
  }
  return (
    <div class="os-workspace-content">
      <div class="os-workspace-container">
        <div class="os-resource-head">
          <div>
            <div class="os-eyebrow">Primitive Workspace</div>
            <h1>AI原语</h1>
          </div>
        </div>
        <div class="os-filter-tabs" data-tabs={primitiveWorkspaceTabs.join(",")}>
          <button type="button" data-active={activeTab() === "catalog"} onClick={() => selectTab("catalog")}>原语目录</button>
          <button type="button" data-active={activeTab() === "factory"} onClick={() => selectTab("factory")}>原语工厂</button>
        </div>
        <Show when={activeTab() === "catalog"}>
          <PrimitiveCatalogPanel highlightId={highlightId()} initialScope={catalogScope()} openDetail={openDetail()} openUse={openUse()} />
        </Show>
        <Show when={activeTab() === "factory"}>
          <PrimitiveFactoryPanel />
        </Show>
      </div>
    </div>
  )
}

function PrimitiveCatalogPanel(props: { highlightId?: string; initialScope?: PrimitiveCatalogScope; openDetail?: boolean; openUse?: boolean } = {}) {
  const primitiveBatchSize = 24
  const server = useServer()
  const location = useLocation()
  const navigate = useNavigate()
  const openModelScopeSession = useModelScopeSessionNavigate()
  const [items, setItems] = createSignal<AIPrimitiveItem[]>([])
  const [loaded, setLoaded] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const [catalogScope, setCatalogScope] = createSignal<PrimitiveCatalogScope>(props.initialScope ?? "all")
  const [selectedCategory, setSelectedCategory] = createSignal<string>()
  const [selected, setSelected] = createSignal<AIPrimitiveItem>()
  const [useItem, setUseItem] = createSignal<AIPrimitiveItem>()
  const [highlightedId, setHighlightedId] = createSignal<string>()
  const [userResourceIds, setUserResourceIds] = createSignal<ReadonlySet<string>>(new Set())
  const [visibleCount, setVisibleCount] = createSignal(0)
  const [loadMoreRef, setLoadMoreRef] = createSignal<HTMLDivElement>()
  const [loadMoreVisible, setLoadMoreVisible] = createSignal(false)
  const [searching, setSearching] = createSignal(false)
  const [searchItems, setSearchItems] = createSignal<AIPrimitiveItem[] | undefined>()
  let resolvedHighlightId: string | undefined
  let detailOpenedForHighlight: string | undefined
  let useOpenedForHighlight: string | undefined
  let loadRequestId = 0
  let catalogIdleId: number | undefined

  const syncCallableCatalog = async (requestId: number) => {
    const current = server.current
    if (!current || requestId !== loadRequestId) return
    let offset = 0
    let collected: AIPrimitiveItem[] = []
    while (true) {
      if (requestId !== loadRequestId) return
      const result = await listAIPrimitivesExperimental(current.http.url, { limit: 100, offset, status: "callable" })
      if (result.loaded !== true) break
      collected = offset === 0 ? result.items : [...collected, ...result.items]
      if (typeof result.nextOffset !== "number") break
      offset = result.nextOffset
    }
    if (requestId !== loadRequestId) return
    writeCallableCatalogCache(current.http.url, collected)
    setItems(collected)
    setLoaded(collected.length > 0)
    setLoading(false)
  }

  const loadItems = async () => {
    const current = server.current
    if (!current) {
      setLoaded(false)
      setItems([])
      return
    }
    const requestId = ++loadRequestId
    if (catalogIdleId !== undefined) {
      cancelIdleWork(catalogIdleId)
      catalogIdleId = undefined
    }
    const cached = readCallableCatalogCache(current.http.url)
    const highlight = props.highlightId
    const canShowFromCache = !!cached?.length && (!highlight || cached.some((entry) => entry.id === highlight))
    if (canShowFromCache) {
      setItems(cached!)
      setLoaded(true)
      setLoading(false)
      catalogIdleId = deferIdleWork(() => {
        catalogIdleId = undefined
        void syncCallableCatalog(requestId)
      }, 500)
      return
    }
    if (cached?.length) {
      setItems(cached)
      setLoaded(true)
    } else {
      setLoading(true)
      setItems([])
      setLoaded(false)
    }
    await syncCallableCatalog(requestId)
  }

  createEffect(() => {
    const current = server.current
    if (!server.ready() || !current) return
    void loadItems()
    void fetchUserUploadedResourceIds(current.http.url).then(setUserResourceIds)
  })

  const closeDetail = () => {
    setSelected(undefined)
    const params = new URLSearchParams(location.search)
    if (params.get("openDetail") !== "1") return
    params.delete("openDetail")
    navigate(`/primitives?${params}`, { replace: true })
  }

  const closeUse = () => {
    setUseItem(undefined)
    const params = new URLSearchParams(location.search)
    if (params.get("openUse") !== "1") return
    params.delete("openUse")
    navigate(`/primitives?${params}`, { replace: true })
  }

  onCleanup(() => {
    if (catalogIdleId !== undefined) cancelIdleWork(catalogIdleId)
    loadRequestId += 1
  })

  createEffect(() => {
    const q = query().trim()
    const current = server.current
    if (!q || !current) {
      setSearchItems(undefined)
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = window.setTimeout(() => {
      void searchPrimitivesViaCatalog(current.http.url, {
        q,
        category: selectedCategory(),
        limit: 50,
      }).then((result) => {
        setSearchItems(result.loaded ? result.items : [])
        setSearching(false)
      })
    }, 250)
    onCleanup(() => window.clearTimeout(timer))
  })

  createEffect(on(() => props.initialScope, (scope) => {
    if (!scope) return
    setCatalogScope(scope)
    setSelectedCategory(undefined)
  }))

  const catalogFilterKey = createMemo(() => `${catalogScope()}:${selectedCategory() ?? ""}:${query().trim().toLowerCase()}`)

  const scopeFilteredSource = createMemo(() => {
    const source = items()
    const q = query().trim()

    let result: AIPrimitiveItem[]
    if (q) {
      if (searching() || searchItems() === undefined) result = []
      else {
        const fromCatalog = searchItems()!
        const searched = (fromCatalog.length > 0
          ? fromCatalog
          : filterAIPrimitiveItems(source, { q }).items
        ).map((item) => enrichPrimitiveItemFromCatalog(item, source))
        result = filterPrimitivesByCatalogScope(searched, catalogScope(), userResourceIds(), storedPlatformAuthSession()?.account.id)
      }
    } else {
      result = filterPrimitivesByCatalogScope(source, catalogScope(), userResourceIds(), storedPlatformAuthSession()?.account.id)
    }

    const highlight = props.highlightId
    if (!highlight) return result
    const highlighted = source.find((entry) => entry.id === highlight)
    if (!highlighted || result.some((entry) => entry.id === highlight)) return result
    if (!storedPlatformAuthSession()?.account.id && !isPresetCatalogPrimitive(highlighted)) return result
    return [highlighted, ...result]
  })

  const categoryOptions = createMemo(() => primitiveCategoryFilterOptions(scopeFilteredSource()))
  const showCategoryBar = createMemo(() =>
    shouldShowPrimitiveCategoryBar(catalogScope(), scopeFilteredSource(), categoryOptions()),
  )

  const filteredItems = createMemo(() =>
    filterAIPrimitiveItems(scopeFilteredSource(), { category: selectedCategory() }).items,
  )

  const selectCatalogScope = (scope: PrimitiveCatalogScope) => {
    setCatalogScope(scope)
    setSelectedCategory(undefined)
    const params = new URLSearchParams(location.search)
    params.set("tab", "catalog")
    if (scope === "all") params.delete("scope")
    else params.set("scope", scope)
    navigate(`/primitives?${params}`, { replace: true })
  }

  const toggleCategory = (category: string) => {
    setSelectedCategory(selectedCategory() === category ? undefined : category)
  }

  createEffect(() => {
    if (showCategoryBar()) return
    if (selectedCategory()) setSelectedCategory(undefined)
  })

  createEffect(() => {
    const category = selectedCategory()
    if (!category) return
    if (categoryOptions().some((option) => option.category === category)) return
    setSelectedCategory(undefined)
  })

  const renderedItems = createMemo(() => filteredItems().slice(0, visibleCount()))
  const hasMoreItems = createMemo(() => visibleCount() < filteredItems().length)
  const advancePrimitiveList = () => setVisibleCount((count) => Math.min(count + primitiveBatchSize, filteredItems().length))
  createEffect(on(catalogFilterKey, () => {
    setVisibleCount(Math.min(primitiveBatchSize, filteredItems().length))
  }))
  createEffect(() => {
    const total = filteredItems().length
    if (total === 0) return
    setVisibleCount((count) => count === 0 ? Math.min(primitiveBatchSize, total) : count)
  })
  createEffect(() => {
    const target = loadMoreRef()
    if (!target) return
    const root = target.closest(".os-workspace-main")
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting)
      setLoadMoreVisible(visible)
      if (visible) advancePrimitiveList()
    }, { root, rootMargin: "640px 0px" })
    observer.observe(target)
    onCleanup(() => observer.disconnect())
  })
  createEffect(() => {
    const visible = loadMoreVisible()
    const count = visibleCount()
    const total = filteredItems().length
    if (!visible || count >= total) return
    let frame = 0
    frame = window.requestAnimationFrame(() => {
      if (loadMoreVisible() && count === visibleCount() && total === filteredItems().length) advancePrimitiveList()
    })
    onCleanup(() => {
      if (frame) window.cancelAnimationFrame(frame)
    })
  })
  createEffect(on(() => props.highlightId, (id, prevId) => {
    resolvedHighlightId = undefined
    detailOpenedForHighlight = undefined
    useOpenedForHighlight = undefined
    if (!id || prevId === undefined) return
    void loadItems()
  }))
  createEffect(() => {
    const id = props.highlightId
    if (!id || loading() || !loaded() || resolvedHighlightId === id) return
    const item = items().find((entry) => entry.id === id)
    if (!item) return
    const targetScope = props.initialScope ?? "all"
    const needsScopeReset = catalogScope() !== targetScope
    const needsQueryReset = !!query().trim()
    const needsCategoryReset = !!selectedCategory()
    const needsSearchReset = searchItems() !== undefined
    if (needsQueryReset || needsCategoryReset || needsSearchReset || needsScopeReset) {
      batch(() => {
        if (needsQueryReset) setQuery("")
        if (needsCategoryReset) setSelectedCategory(undefined)
        if (needsSearchReset) setSearchItems(undefined)
        if (needsScopeReset && props.initialScope) setCatalogScope(props.initialScope)
      })
      return
    }
    resolvedHighlightId = id
    const index = filteredItems().findIndex((entry) => entry.id === id)
    if (index >= 0) {
      setVisibleCount((count) => Math.max(count, index + 1))
      setHighlightedId(id)
    }
    if (props.openDetail && detailOpenedForHighlight !== id) {
      detailOpenedForHighlight = id
      setSelected(item)
    }
    if (props.openUse && useOpenedForHighlight !== id && item.status === "callable") {
      useOpenedForHighlight = id
      setUseItem(item)
    }
    if (index < 0) return
    let frame = 0
    frame = window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" })
    })
    const timer = window.setTimeout(() => setHighlightedId(undefined), 2400)
    onCleanup(() => {
      if (frame) window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    })
  })

  return (
    <section class="os-skill-group">
      <div class="os-skill-group-head">
        <h2>原语目录</h2>
        <p>{searching() ? "正在语义检索..." : query().trim() && filteredItems().length === 0 && loaded() ? "未找到匹配原语" : loaded() ? `数据库 ${filteredItems().length} 个原语` : loading() ? "正在加载原语..." : "服务不可用，展示静态目录"}</p>
      </div>
      <div class="os-resource-toolbar os-primitive-catalog-toolbar">
        <label class="os-search-box">
          <span class="os-search-box-icon" aria-hidden="true">⌕</span>
          <input
            type="search"
            placeholder={primitivePage.search}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <button type="button" class="os-button os-button-secondary" disabled={loading()} onClick={() => void loadItems()}>
          {loading() ? "刷新中..." : "刷新列表"}
        </button>
      </div>
      <div class="os-primitive-filter-panel">
        <div class="os-filter-tabs os-primitive-scope-tabs" aria-label="数据范围">
          <For each={primitiveCatalogScopeFilters}>
            {(scope) => (
              <button
                type="button"
                data-active={catalogScope() === scope.id}
                title={scope.hint}
                onClick={() => selectCatalogScope(scope.id)}
              >
                {scope.label}
              </button>
            )}
          </For>
        </div>
        <Show when={showCategoryBar()}>
          <div class="os-primitive-category-bar" aria-label="原语类别">
            <For each={categoryOptions()}>
              {(option) => (
                <button
                  type="button"
                  class="os-primitive-category-chip"
                  data-active={selectedCategory() === option.category}
                  onClick={() => option.category && toggleCategory(option.category)}
                >
                  {`${option.shortLabel} (${option.count})`}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
      <Show when={loading() && items().length === 0}>
        <div class="os-dashboard-card">正在从数据库加载原语...</div>
      </Show>
      <Show when={!loading() || items().length > 0}>
        <Show
          when={filteredItems().length > 0}
          fallback={
            <p class="os-data-empty">
              {searching()
                ? "正在语义检索..."
                : query().trim()
                  ? "未找到匹配原语"
                  : catalogScope() === "mine"
                    ? "暂无我创建的原语"
                    : catalogScope() === "recent"
                      ? "最近 7 天暂无新原语"
                      : "暂无可展示的原语"}
            </p>
          }
        >
          <div class="os-resource-grid">
            <For each={renderedItems()}>
              {(item) => (
                <PrimitiveCard
                  item={item}
                  highlighted={highlightedId() === item.id}
                  deletable={loaded() && aiPrimitiveDeletable(item)}
                  onInspect={() => setSelected(item)}
                  onDelete={loaded() && aiPrimitiveDeletable(item) ? async () => {
                    const current = server.current
                    if (!current) return
                    await deleteAIPrimitive(current.http.url, item.id)
                    setItems((items) => items.filter((entry) => entry.id !== item.id))
                    if (selected()?.id === item.id) setSelected(undefined)
                  } : undefined}
                />
              )}
            </For>
          </div>
        </Show>
      </Show>
      <Show when={filteredItems().length > 0}>
        <div ref={setLoadMoreRef} class="os-load-more-sentinel">
          <Show when={hasMoreItems()} fallback="已经到底啦">继续加载中...</Show>
        </div>
      </Show>
      <PrimitiveContractDialog item={selected()} onClose={closeDetail} />
      <Show when={useItem()}>
        {(item) => (
          <PrimitiveUseDialog
            item={item()}
            open
            onClose={closeUse}
            onSubmit={(text) => {
              closeUse()
              openModelScopeSession(text)
            }}
          />
        )}
      </Show>
    </section>
  )
}

function aiPrimitiveDeletable(item: AIPrimitiveItem) {
  // Seed / system presets are never deletable — including platform draft templates.
  if (item.owner === "system") return false
  if (
    (item.owner === "platform" || item.owner === "local") &&
    item.id.startsWith("primitive-resource-") &&
    !item.id.startsWith("primitive-resource-custom-")
  ) {
    return false
  }
  const accountId = currentResourceAccountId()
  if (!accountId) return false
  // Own rows.
  if (item.owner === accountId) return true
  // Pre-auth residue with no owner.
  if (!item.owner) return true
  // User-created UUID drafts (e.g. test_add_data) — communal even if mis-stamped.
  if (isUserCreatedPrimitiveId(item.id)) return true
  // Custom-resource factory drafts stamped platform/local.
  if (
    (item.owner === "platform" || item.owner === "local") &&
    item.id.startsWith("primitive-resource-custom-")
  ) {
    return true
  }
  return false
}

function factoryPrimitiveDeletable(item: AIPrimitiveItem) {
  return aiPrimitiveDeletable(item)
}

function isFactoryOwnedOrSharedPrimitive(item: AIPrimitiveItem) {
  if (item.owner === "system" || item.owner === "platform" || item.owner === "local" || !item.owner) return true
  const accountId = currentResourceAccountId()
  return Boolean(accountId && item.owner === accountId)
}

function PrimitiveFactoryPanel() {
  const server = useServer()
  const navigate = useNavigate()
  const openModelScopeSession = useModelScopeSessionNavigate()
  const [items, setItems] = createSignal<AIPrimitiveItem[]>([])
  const [loaded, setLoaded] = createSignal(false)
  const [selectedStage, setSelectedStage] = createSignal<AIPrimitiveStatus | "all">("all")
  const [deleteTarget, setDeleteTarget] = createSignal<AIPrimitiveItem>()
  const [deleting, setDeleting] = createSignal(false)
  const [deleteError, setDeleteError] = createSignal("")
  const [useItem, setUseItem] = createSignal<AIPrimitiveItem>()
  const [publishTarget, setPublishTarget] = createSignal<{
    resourceId?: string
    resourcePage?: PrimitiveResourcePage
    draftId: string
    initialPrimitiveType?: string
    sourceHint?: PrimitiveSourceHint
  }>()

  const factoryStages: Array<{ id: AIPrimitiveStatus | "all"; label: string }> = [
    { id: "all", label: "全部" },
    { id: "draft", label: "草稿" },
    { id: "callable", label: "可调用" },
  ]

  const modelTitleByCardId = createMemo(() => {
    const titles = new Map<string, string>()
    for (const entry of resourcePages.models.items) titles.set(entry.id, entry.title)
    return titles
  })

  const loadItems = async () => {
    const current = server.current
    if (!current) return
    const result = await loadAllAIPrimitives(current.http.url)
    setLoaded(result.loaded === true)
    setItems(result.items.filter((item) => item.status === "draft" || item.status === "callable"))
  }

  createEffect(() => {
    if (!server.ready() || !server.current) return
    void loadItems()
  })

  const queueItems = createMemo(() =>
    items().filter(
      (item) =>
        isFactoryOwnedOrSharedPrimitive(item) &&
        isFactoryQueueItemVisible(item, (cardId) => modelTitleByCardId().get(cardId)),
    ),
  )

  const stageItems = createMemo(() => {
    const stage = selectedStage()
    if (stage === "all") return queueItems()
    return queueItems().filter((item) => item.status === stage)
  })

  const stageCount = (status: AIPrimitiveStatus | "all") =>
    status === "all" ? queueItems().length : queueItems().filter((item) => item.status === status).length

  const openFactoryItem = (item: AIPrimitiveItem) => {
    // Stay on the factory tab: open dialogs in-place so closing them does not
    // reveal a surprise background navigation to OneHub / 原语目录.
    if (item.status === "callable") {
      setUseItem(item)
      return
    }
    const resource = item.resources?.[0]
    const resourceId = item.sourceResourceIds?.[0] ?? resource?.id
    const page = factoryDraftResourcePage(item)
    setPublishTarget({
      resourceId,
      resourcePage: page,
      draftId: item.id,
      initialPrimitiveType: item.primitiveType,
      sourceHint: resource
        ? {
            title: resource.title,
            copy: item.description,
            provider: "OneScience",
            tags: [],
            domain: item.domain,
            page,
          }
        : {
            title: item.title,
            copy: item.description,
            provider: "OneScience",
            tags: [],
            domain: item.domain,
            page,
          },
    })
  }

  const remove = async (event: Event) => {
    event.preventDefault()
    const item = deleteTarget()
    const current = server.current
    if (!item || !current || deleting()) return
    setDeleting(true)
    setDeleteError("")
    try {
      await deleteAIPrimitive(current.http.url, item.id)
      setItems((currentItems) => currentItems.filter((entry) => entry.id !== item.id))
      setDeleteTarget(undefined)
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "删除失败")
    } finally {
      setDeleting(false)
    }
  }

  const finishFactoryPublish = (item: AIPrimitiveItem) => {
    setPublishTarget(undefined)
    // Explicit publish: user asked to see the result — jump to 原语目录.
    finishPrimitivePublish(navigate, item, server.current?.http.url)
  }

  return (
    <section class="os-skill-system">
      <div class="os-skill-system-head">
        <div>
          <h2>原语工厂</h2>
          <p>{factoryStageHint(selectedStage())}</p>
        </div>
      </div>
      <div class="os-management-toolbar mt-4">
        <div class="os-filter-tabs">
          <For each={factoryStages}>
            {(stage) => (
              <button type="button" data-active={selectedStage() === stage.id} onClick={() => setSelectedStage(stage.id)}>
                {stage.label} {stageCount(stage.id)}
              </button>
            )}
          </For>
        </div>
        <div class="os-card-actions">
          <A class="os-button os-button-secondary" href="/datasets">数据集资源</A>
          <A class="os-button os-button-secondary" href="/models">模型库资源</A>
          <A class="os-button os-button-secondary" href="/apps">应用库资源</A>
        </div>
      </div>
      <Show when={!loaded() && items().length === 0}>
        <div class="os-dashboard-card">正在加载原语工厂队列...</div>
      </Show>
      <Show when={loaded() && stageItems().length === 0}>
        <div class="os-dashboard-card">当前阶段暂无原语。请从资源卡片「发布原语」补全契约并发布。</div>
      </Show>
      <div class="os-resource-grid mt-4">
        <For each={stageItems()}>
          {(item) => (
            <article
              class="os-resource-card os-primitive-card os-resource-card-clickable"
              data-source="onescience"
              role="button"
              tabIndex={0}
              onClick={() => openFactoryItem(item)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  openFactoryItem(item)
                }
              }}
            >
              <div class="os-card-heading-row">
                <h2>{item.title}</h2>
                <div class="os-source-badge" data-source="onescience">{aiPrimitiveStatusLabels[item.status]}</div>
              </div>
              <ResourceCopy copy={item.description} />
              <div class="os-meta-list">
                <span><span aria-hidden="true">◈</span>{item.domain}</span>
                <span><span aria-hidden="true">◒</span>{primitiveCategoryLabel[primitiveCategoryFromItem(item)] ?? item.primitiveType}</span>
              </div>
              <div class="os-card-footer os-primitive-card-footer">
                <div class="os-card-actions os-card-action-row">
                  <Show when={loaded() && factoryPrimitiveDeletable(item)}>
                    <button
                      type="button"
                      class="os-button os-button-card os-card-action-link os-card-delete-action os-primitive-card-delete"
                      disabled={deleting() && deleteTarget()?.id === item.id}
                      onClick={(event) => {
                        event.stopPropagation()
                        setDeleteError("")
                        setDeleteTarget(item)
                      }}
                    >
                      删除
                    </button>
                  </Show>
                </div>
              </div>
            </article>
          )}
        </For>
      </div>
      <Show when={deleteTarget()}>
        {(item) => (
          <Portal>
            <div class="os-modal-backdrop" role="presentation">
              <form class="os-upload-dialog os-delete-dialog" onSubmit={remove} onClick={(event) => event.stopPropagation()}>
                <div class="os-upload-head">
                  <div>
                    <div class="os-eyebrow">删除原语</div>
                    <h2>{item().title}</h2>
                  </div>
                  <button type="button" class="os-button os-button-secondary os-button-square" onClick={() => setDeleteTarget(undefined)}>×</button>
                </div>
                <p>是否要删除该原语？删除后将从原语工厂队列中移除。</p>
                <Show when={deleteError()}>{(message) => <div class="os-upload-error">{message()}</div>}</Show>
                <div class="os-upload-actions">
                  <button type="button" class="os-button os-button-secondary" onClick={() => setDeleteTarget(undefined)}>取消</button>
                  <button class="os-button os-button-primary" type="submit" disabled={deleting()}>{deleting() ? "删除中..." : "删除"}</button>
                </div>
              </form>
            </div>
          </Portal>
        )}
      </Show>
      <Show when={useItem()}>
        {(item) => (
          <PrimitiveUseDialog
            item={item()}
            open
            onClose={() => setUseItem(undefined)}
            onSubmit={(text) => {
              setUseItem(undefined)
              openModelScopeSession(text)
            }}
          />
        )}
      </Show>
      <PrimitiveCreateDialog
        resourceId={publishTarget()?.resourceId}
        resourcePage={publishTarget()?.resourcePage}
        draftId={publishTarget()?.draftId}
        initialPrimitiveType={publishTarget()?.initialPrimitiveType}
        sourceHint={publishTarget()?.sourceHint}
        serverUrl={server.current?.http.url ?? window.location.origin}
        open={publishTarget() !== undefined}
        onClose={() => setPublishTarget(undefined)}
        onSuccess={(item) => finishFactoryPublish(item)}
      />
    </section>
  )
}

function AgentRegistryPanel(props: { title?: string } = {}) {
  const server = useServer()
  const [items, setItems] = createSignal<AIPrimitiveItem[]>([])
  const [loaded, setLoaded] = createSignal(false)
  const [selected, setSelected] = createSignal<AIPrimitiveItem>()
  onMount(async () => {
    const current = server.current
    if (!current) return
    const result = await listAgentRegistryPrimitives(current.http.url)
    setLoaded(result.loaded === true)
    setItems(result.items)
  })
  return (
    <section class="os-skill-group">
      <div class="os-skill-group-head">
        <h2>{props.title ?? "可使用原语"}</h2>
        <p>展示可被当前 OneSkills 分层和 Agent 路由选择的 callable 原语。</p>
      </div>
      <Show when={items().length > 0} fallback={<div class="os-dashboard-card">暂无可调用原语，请先从原语目录验证并发布能力。</div>}>
        <div class="os-resource-grid">
          <For each={items()}>{(item) => <PrimitiveCard item={item} onInspect={() => setSelected(item)} />}</For>
        </div>
      </Show>
      <Show when={!loaded() && items().length === 0}>
        <div class="os-upload-error">可使用原语暂时不可用。</div>
      </Show>
      <PrimitiveContractDialog item={selected()} onClose={() => setSelected(undefined)} />
    </section>
  )
}

function PrimitiveCard(props: { item: AIPrimitiveItem; onInspect: () => void; highlighted?: boolean; deletable?: boolean; onDelete?: () => Promise<void> | void }) {
  const openModelScopeSession = useModelScopeSessionNavigate()
  const [useDialogOpen, setUseDialogOpen] = createSignal(false)
  const [deleteOpen, setDeleteOpen] = createSignal(false)
  const [deleting, setDeleting] = createSignal(false)
  const [error, setError] = createSignal("")
  const remove = async (event: Event) => {
    event.preventDefault()
    if (!props.onDelete) return
    setDeleting(true)
    setError("")
    try {
      await props.onDelete()
      setDeleteOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败")
    } finally {
      setDeleting(false)
    }
  }
  return (
    <>
    <article id={props.item.id} class="os-resource-card os-primitive-card scroll-mt-24" classList={{ "os-resource-card-highlighted": !!props.highlighted }} data-source="onescience" data-highlighted={props.highlighted ? "true" : undefined}>
      <div class="os-card-heading-row">
        <h2>{props.item.title}</h2>
        <div class="os-source-badge" data-source="onescience">{aiPrimitiveStatusLabels[props.item.status] ?? props.item.status}</div>
      </div>
      <div class="os-tag-row">
        <For each={primitiveVisibleTags(props.item).slice(0, 4)}>{(tag) => <span class="os-tag">{tag}</span>}</For>
      </div>
      <ResourceCopy copy={props.item.description} />
      <div class="os-meta-list">
        <span><span aria-hidden="true">◈</span>{props.item.domain}</span>
        <span><span aria-hidden="true">◒</span>{primitiveCategoryLabel[primitiveCategoryFromItem(props.item)] ?? props.item.primitiveType}</span>
        <span class="os-primitive-slug" title={props.item.slug ?? props.item.id}><span aria-hidden="true">#</span>{props.item.slug ?? props.item.id}</span>
      </div>
      <Show when={props.item.resources && props.item.resources.length > 0}>
        <div class="os-tag-row">
          <For each={props.item.resources?.slice(0, 3) ?? []}>{(resource) => <span class="os-tag">来源：{resource.title}</span>}</For>
        </div>
      </Show>
      <div class="os-card-footer os-primitive-card-footer">
        <div class="os-card-actions os-card-action-row">
          <Show when={props.item.status === "callable"}>
            <button type="button" class="os-button os-button-primary os-button-card os-card-action-link" onClick={() => setUseDialogOpen(true)}>使用原语</button>
          </Show>
          <button type="button" class="os-button os-button-card os-card-action-link" onClick={props.onInspect}>查看契约</button>
          <Show when={props.deletable && props.onDelete}>
            <button type="button" class="os-button os-button-card os-card-action-link os-card-delete-action os-primitive-card-delete" onClick={() => setDeleteOpen(true)}>删除</button>
          </Show>
        </div>
      </div>
      <Show when={deleteOpen()}>
        <Portal>
          <div class="os-modal-backdrop" role="presentation">
            <form class="os-upload-dialog os-delete-dialog" onSubmit={remove} onClick={(event) => event.stopPropagation()}>
              <div class="os-upload-head">
                <div>
                  <div class="os-eyebrow">删除原语</div>
                  <h2>{props.item.title}</h2>
                </div>
                <button type="button" class="os-button os-button-secondary os-button-square" onClick={() => setDeleteOpen(false)}>×</button>
              </div>
              <p>是否要删除该原语？删除后将从原语目录中移除。</p>
              <Show when={error()}>{(message) => <div class="os-upload-error">{message()}</div>}</Show>
              <div class="os-upload-actions">
                <button type="button" class="os-button os-button-secondary" onClick={() => setDeleteOpen(false)}>取消</button>
                <button class="os-button os-button-primary" type="submit" disabled={deleting()}>{deleting() ? "删除中..." : "删除"}</button>
              </div>
            </form>
          </div>
        </Portal>
      </Show>
    </article>
    <PrimitiveUseDialog
      item={props.item}
      open={useDialogOpen()}
      onClose={() => setUseDialogOpen(false)}
      onSubmit={(text) => {
        setUseDialogOpen(false)
        openModelScopeSession(text)
      }}
    />
    </>
  )
}

function PrimitiveContractDialog(props: { item?: AIPrimitiveItem; onClose: () => void }) {
  return (
    <Show when={props.item}>
      {(item) => (
        <Portal>
          <div class="os-modal-backdrop" role="presentation" onClick={props.onClose}>
            <div class="os-upload-dialog" onClick={(event) => event.stopPropagation()}>
              <div class="os-upload-head">
                <div>
                  <div class="os-eyebrow">Primitive Contract</div>
                  <h2>{item().title}</h2>
                </div>
                <button type="button" class="os-button os-button-secondary os-button-square" onClick={props.onClose}>×</button>
              </div>
              <AgentContractView item={item()} />
              <div class="os-contract-section-title">源码契约 JSON</div>
              <pre class="os-primitive-contract-json">{JSON.stringify({
                contract: item().contractJson,
                adapter: item().adapterJson,
                validation: item().validationJson,
                resources: item().resources ?? [],
              }, null, 2)}</pre>
            </div>
          </div>
        </Portal>
      )}
    </Show>
  )
}

function AgentContractView(props: { item: AIPrimitiveItem }) {
  const contract = () => agentContractFrom(props.item.contractJson)
  return (
    <Show when={contract()}>
      {(agentContract) => (
        <section class="os-agent-contract">
          <div class="os-contract-section-title">智能体契约</div>
          <p>{agentContract().purpose ?? "为智能体调用、代码实现和验证提供结构化约束。"}</p>
          <div class="os-contract-usage-list">
            <For each={agentContract().usage ?? []}>{(item) => <span>{item}</span>}</For>
          </div>
          <For each={agentContract().matchedAssets ?? []}>
            {(asset) => (
              <article class="os-agent-contract-asset">
                <div class="os-contract-asset-head">
                  <span>资产契约</span>
                  <strong>{asset.title ?? asset.name ?? asset.path}</strong>
                </div>
                <Show when={asset.path}><code>{asset.path}</code></Show>
                <Show when={asset.summary}><p>{asset.summary}</p></Show>
                <div class="os-contract-section-grid">
                  <For each={(asset.sections ?? []).slice(0, 6)}>
                    {(section) => (
                      <div class="os-contract-mini-section">
                        <strong>{section.title}</strong>
                        <p>{section.content}</p>
                      </div>
                    )}
                  </For>
                </div>
              </article>
            )}
          </For>
        </section>
      )}
    </Show>
  )
}

function agentContractFrom(contractJson?: Record<string, unknown>): AgentContract | undefined {
  const agentContract = contractJson?.agentContract
  if (!agentContract || typeof agentContract !== "object") return undefined
  return agentContract as AgentContract
}

function filterPrimitivesByCategory(items: AIPrimitiveItem[], category?: string) {
  if (!category) return items
  return items.filter((item) => primitiveCategoryFromItem(item) === category)
}

function primitiveVisibleTags(item: AIPrimitiveItem) {
  return item.intentTags.filter((tag) => !isInternalPrimitiveTag(tag) && !resourceCardDomainTags.has(tag))
}

function isInternalPrimitiveTag(tag: string) {
  return tag.startsWith("category:") || tag.startsWith("skill:")
}

export function ResearchPage() {
  return <ResourcePage page="research" />
}

export function CasesPage() {
  return <ResourcePage page="cases" />
}

export function DocsPage() {
  return <ResourcePage page="docs" />
}

export function ModelsPage() {
  return <ResourcePage page="models" />
}

export function AppsPage() {
  return <ResourcePage page="apps" />
}

export function FrameworksPage() {
  return <ResourcePage page="frameworks" />
}

export function OperatorsPage() {
  return <ResourcePage page="operators" />
}
/** Web portal workspace nav (stable; do not change for desktop). */
const workspaceNavGroups: readonly (readonly WorkspaceNavItem[])[] = [
  [
    { label: "首页", href: "/workspace", icon: "home" },
    { label: "科研开发", href: "/workspace", icon: "code" },
  ],
  [
    { label: "OneSkills", href: "/skills", icon: "skills" },
    { label: "AI原语", href: "/primitives", icon: "primitives" },
  ],
  [
    {
      label: "OneHub",
      icon: "apps",
      items: [
        { label: "模型库", href: "/models", icon: "model" },
        { label: "数据集", href: "/datasets", icon: "database" },
        { label: "应用库", href: "/apps", icon: "apps" },
      ],
    },
  ],
  [
    {
      label: "OneInfra",
      icon: "framework",
      items: [
        { label: "AI框架", href: "/frameworks", icon: "framework" },
        { label: "算子", href: "/operators", icon: "operator" },
      ],
    },
  ],
  [
    { label: "案例", href: "/cases", icon: "cases" },
    { label: "文档", href: "/docs", icon: "docs" },
  ],
] as const

/**
 * Desktop WorkbenchShell nav: primary workbench + OneHub as second section.
 * Only used when platform.platform === "desktop".
 */
const desktopWorkbenchNavGroups: readonly (readonly WorkspaceNavItem[])[] = [
  [
    { label: "工作台", href: "/workspace", icon: "home" },
    { label: "科研开发", href: "/workspace", icon: "code" },
  ],
  [
    {
      label: "OneHub",
      icon: "apps",
      items: [
        { label: "模型库", href: "/models", icon: "model" },
        { label: "数据集", href: "/datasets", icon: "database" },
        { label: "应用库", href: "/apps", icon: "apps" },
        { label: "OneSkills", href: "/skills", icon: "skills" },
        { label: "AI原语", href: "/primitives", icon: "primitives" },
        { label: "案例", href: "/cases", icon: "cases" },
        { label: "文档", href: "/docs", icon: "docs" },
      ],
    },
  ],
] as const
