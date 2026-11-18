import { For, Show, createEffect, createMemo, createSignal, onMount, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { A, useLocation, useNavigate } from "@solidjs/router"
import { codeWorkspaceRecentProjects } from "@/app-routes"
import { useGlobalSync } from "@/context/global-sync"
import { useLayout } from "@/context/layout"
import { useServer } from "@/context/server"
import { storedPlatformAuthSession } from "@/utils/platform-auth"
import { fuzzyMatchParts } from "@/utils/fuzzy-match"
import {
  capabilityCategories,
  type CapabilityCategory,
  type CapabilityCategoryId,
  type CapabilityDomain,
  type CapabilityResource,
} from "./catalog"
import { CapabilityResourceUploadDialog } from "./capability-upload-dialog"
import { startCapabilityInstall } from "./install"
import { isCapabilityResourceAvailable, isCapabilityResourceInstallable } from "./model-resources"
import { CapabilityOnedataPanel } from "./onedata-panel"
import { CapabilitySubmissionPanel } from "./submission-panel"
import "./submission-panel.css"
import { CapabilityOneSkillsPanel } from "./oneskills-panel"
import { paginate, CAPABILITY_PAGE_SIZE_RESOURCE, CAPABILITY_PAGE_SIZE_SCENARIO } from "./pagination"
import { CapabilityPager } from "./pager"
import { listPrivateModels } from "./private-assets"
import { fetchScenarioCatalog } from "./scenario-api"
import {
  domainLabel,
  getUserScenario,
  scenarioLookupKey,
  scenarioProblemText,
  searchDomainScenarios,
  type UserScenario,
} from "./scenario-catalog"
import { ScenarioWizardOverlay } from "./scenario-wizard-overlay"
import {
  selectionFromCapabilityLocation,
  writeStoredCapabilitySelection,
  type CapabilityDomainSelection,
} from "./selection"
import { startCapabilityPromptTask, startCapabilityScenarioRunTask, startCapabilityWizardTask } from "./wizard"
import { consumePendingAction } from "@/workbench/pending-action"
import {
  workspaceCapabilitiesCategoryHref,
  workspaceCapabilityHref,
  workspaceCapabilityWizardHref,
  workspaceRoutes,
} from "@/workbench/routes"

const domainTabs: Array<{ id: CapabilityDomainSelection; label: string }> = [
  { id: "all", label: "全部" },
  { id: "materials", label: "材料" },
  { id: "weather", label: "气象" },
  { id: "fluid", label: "流体" },
  { id: "bio", label: "生信" },
]

const filterTabs: Array<{ id: CapabilityCategoryId; label: string; title: string }> = [
  { id: "scenario", label: "场景", title: "场景库" },
  { id: "onemodel", label: "onemodel", title: "模型库" },
  { id: "hpc", label: "HPC 软件", title: "软件库" },
  { id: "onedata", label: "onedata", title: "数据集" },
  { id: "oneskills", label: "oneskills", title: "技能库" },
  { id: "submission", label: "智能投稿", title: "论文投稿" },
]

const capabilityViewModes = [
  { id: "cards" as const, label: "卡片" },
  { id: "list" as const, label: "列表" },
]
type CapabilityViewMode = (typeof capabilityViewModes)[number]["id"]
const capabilityViewModeKey = "os-capability-view-mode"

function normalizeDomain(domainId: CapabilityDomainSelection): CapabilityDomainSelection {
  if (domainId === "all" || domainId === "materials" || domainId === "weather" || domainId === "fluid" || domainId === "bio") {
    return domainId
  }
  return "all"
}

function uploadDomain(domainId: CapabilityDomainSelection): CapabilityDomain {
  if (domainId === "materials" || domainId === "weather" || domainId === "fluid" || domainId === "bio") return domainId
  return "materials"
}

/** Nested intro/wizard must not overwrite the user's domain tab unless domain= is explicit. */
function preserveDomainOnNestedCapability(pathname: string, search: string) {
  const pathOnly = pathname.split("?")[0] ?? pathname
  if (!new RegExp(`^${workspaceRoutes.capabilities}/[^/]+`).test(pathOnly)) return false
  return !new URLSearchParams(search).has("domain")
}

export function CapabilityCenterPage(props: ParentProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const initial = selectionFromCapabilityLocation(location.pathname, location.search)
  const [state, setState] = createStore({
    domainId: normalizeDomain(initial.domainId),
    categoryId: initial.categoryId,
    scenarioQuery: "",
    activeScenarioId: "",
    uploadPage: null as null | "models",
    scenarioCatalogTick: 0,
  })
  const sync = useGlobalSync()
  const layout = useLayout()
  const server = useServer()

  onMount(() => {
    const serverUrl = server.current?.http.url
    if (!serverUrl) return
    void fetchScenarioCatalog(serverUrl)
      .then(() => setState("scenarioCatalogTick", (tick) => tick + 1))
      .catch(() => undefined)
  })

  const persistCatalogSelection = (input: {
    domainId: CapabilityDomainSelection
    categoryId: CapabilityCategoryId
  }) => {
    writeStoredCapabilitySelection({
      categoryId: input.categoryId,
      domainId: normalizeDomain(input.domainId),
    })
  }

  const syncCapabilityQuery = (input: {
    domainId: CapabilityDomainSelection
    categoryId: CapabilityCategoryId
  }) => {
    persistCatalogSelection(input)
    navigate(workspaceCapabilitiesCategoryHref(input.categoryId, input.domainId), { replace: true })
  }

  createEffect(() => {
    const pathname = location.pathname
    const search = location.search
    const next = selectionFromCapabilityLocation(pathname, search)
    // Opening intro/wizard must not steal the domain tab (e.g. 全部 → 气象).
    if (preserveDomainOnNestedCapability(pathname, search)) {
      setState("categoryId", next.categoryId)
      return
    }
    const domainId = normalizeDomain(next.domainId)
    const categoryId = next.categoryId
    setState({ domainId, categoryId })
    persistCatalogSelection({ domainId, categoryId })

    const pathOnly = pathname.split("?")[0] ?? pathname
    const isCatalogIndex =
      pathOnly === workspaceRoutes.capabilities || pathOnly === `${workspaceRoutes.capabilities}/`
    const params = new URLSearchParams(search)
    if (isCatalogIndex && !params.get("category") && !params.get("domain")) {
      syncCapabilityQuery({ domainId, categoryId })
    }
  })

  const categoriesForDomain = createMemo(() => {
    listPrivateModels()
    return state.domainId === "all" ? capabilityCategories() : capabilityCategories(state.domainId)
  })

  const activeCategory = createMemo(
    () => categoriesForDomain().find((category) => category.id === state.categoryId) ?? categoriesForDomain()[0],
  )

  const scenarios = createMemo(() => {
    state.scenarioCatalogTick
    return searchDomainScenarios(state.domainId, state.scenarioQuery)
  })

  const [scenarioPage, setScenarioPage] = createSignal(1)
  createEffect(() => {
    state.domainId
    state.scenarioQuery
    setScenarioPage(1)
  })
  const scenarioPaged = createMemo(() => paginate(scenarios(), scenarioPage(), CAPABILITY_PAGE_SIZE_SCENARIO))
  createEffect(() => {
    const safe = scenarioPaged().page
    if (safe !== scenarioPage()) setScenarioPage(safe)
  })

  const activeScenario = createMemo(() => {
    state.scenarioCatalogTick
    if (!state.activeScenarioId) return undefined
    return getUserScenario(state.activeScenarioId)
  })

  const setCategory = (categoryId: CapabilityCategoryId) => {
    setState({ categoryId, activeScenarioId: "", scenarioQuery: "" })
    syncCapabilityQuery({ domainId: state.domainId, categoryId })
  }

  const closeScenario = () => setState("activeScenarioId", "")

  const resumeInput = () => ({
    navigate,
    isLoggedIn: !!storedPlatformAuthSession(),
    path: sync.data.path,
    recent: codeWorkspaceRecentProjects(sync.data.project),
    lastCodeWorkspace: server.projects.lastCode(),
    openProject: (directory: string) => layout.projects.open(directory),
    touchCode: (directory: string) => server.projects.touchCode(directory),
  })

  onMount(() => {
    const action = consumePendingAction()
    if (!action) return
    try {
      if (action.type === "install") {
        if (action.resourceId === "oneskills") {
          setState("categoryId", "oneskills")
          syncCapabilityQuery({ domainId: state.domainId, categoryId: "oneskills" })
          return
        }
        if (action.resourceId.startsWith("__")) return
        startCapabilityInstall({ resourceId: action.resourceId, ...resumeInput() })
        return
      }
      if (action.type === "prompt" && action.prompt.trim()) {
        startCapabilityPromptTask({
          prompt: action.prompt,
          title: action.title || "能力中心任务",
          workflow: action.workflow,
          ...resumeInput(),
        })
        return
      }
      if (action.type === "scenario-run") {
        const scenario = getUserScenario(action.scenarioId)
        if (!scenario) return
        startCapabilityScenarioRunTask({
          scenario,
          values: action.values,
          ...resumeInput(),
        })
        return
      }
      if (action.type === "wizard") {
        startCapabilityWizardTask({
          resourceId: action.resourceId,
          scenarioId: action.scenarioId,
          values: action.values,
          prompt: action.prompt,
          ...resumeInput(),
        })
      }
    } catch {
      // Ignore stale pending actions.
    }
  })

  const submitScenario = (scenario: UserScenario, input: { values: Record<string, string> }) => {
    startCapabilityScenarioRunTask({
      scenario,
      values: input.values,
      ...resumeInput(),
    })
  }

  return (
    <div class="os-client-capability-page">
      <section class="os-client-capability-selector" aria-label="能力中心筛选">
        <div class="os-client-capability-current-domain">
          <Show
            when={state.categoryId === "oneskills" || state.categoryId === "submission"}
            fallback={
              <>
                <span>当前领域：</span>
                <strong>{domainLabel(state.domainId)}</strong>
                <small>
                  {state.categoryId === "scenario"
                    ? "切换领域后，下方场景同步刷新"
                    : "切换领域后，下方模型、HPC 软件与数据集内容同步刷新"}
                </small>
              </>
            }
          >
            <span>当前范围：</span>
            <strong>全领域</strong>
            <small>{state.categoryId === "submission" ? "上传论文后识别研究方向，完成选刊、评分与投稿判断" : "OneSkills 原语跨领域通用，不区分材料 / 气象 / 流体 / 生信"}</small>
          </Show>
        </div>

        <Show when={state.categoryId !== "oneskills" && state.categoryId !== "submission"}>
          <div class="os-client-capability-domain-row" role="tablist" aria-label="能力中心领域">
            <For each={domainTabs}>
              {(domain) => (
                <button
                  type="button"
                  classList={{ "is-active": domain.id === state.domainId }}
                  aria-pressed={domain.id === state.domainId}
                  onClick={() => {
                    setState({
                      domainId: domain.id,
                      activeScenarioId: "",
                      scenarioQuery: "",
                    })
                    syncCapabilityQuery({ domainId: domain.id, categoryId: state.categoryId })
                  }}
                >
                  {domain.label}
                </button>
              )}
            </For>
          </div>
        </Show>

        <div class="os-client-capability-filter-tabs" aria-label="能力类型">
          <For each={filterTabs}>
            {(tab) => (
              <button
                type="button"
                class="os-client-capability-filter-tab"
                classList={{ "is-active": state.categoryId === tab.id }}
                role="tab"
                aria-selected={state.categoryId === tab.id}
                onClick={() => setCategory(tab.id)}
              >
                <div class="os-client-capability-filter-tab-text">
                  <strong>{tab.label}</strong>
                  <small>{tab.title}</small>
                </div>
              </button>
            )}
          </For>
        </div>
      </section>

      <div class="os-client-capability-page-body">
        {/* Warm the workspace once; tab changes must not reload its iframe. */}
        <div hidden={state.categoryId !== "submission"}>
          <CapabilitySubmissionPanel />
        </div>
        <Show when={state.categoryId === "oneskills"}>
          <CapabilityOneSkillsPanel />
        </Show>
        <Show when={state.categoryId === "scenario"}>
          <section class="os-client-capability-scenario-panel">
            <div class="os-client-capability-scenario-toolbar">
              <span>场景卡片</span>
              <strong>{scenarios().length}</strong>
              <small>{domainLabel(state.domainId)} · 点击卡片打开场景弹窗</small>
              <label class="os-client-capability-scenario-search">
                <input
                  type="search"
                  value={state.scenarioQuery}
                  placeholder="搜索场景名称、ID、模型、HPC…"
                  aria-label="搜索场景"
                  onInput={(event) => setState("scenarioQuery", event.currentTarget.value)}
                />
              </label>
            </div>
            <Show
              when={scenarios().length > 0}
              fallback={
                <p class="os-client-capability-hint">
                  {state.scenarioQuery.trim()
                    ? `未找到匹配「${state.scenarioQuery.trim()}」的场景。`
                    : `当前「${domainLabel(state.domainId)}」领域暂无场景卡片。`}
                </p>
              }
            >
              <div class="os-client-capability-scenario-grid">
                <For each={scenarioPaged().pageItems}>
                  {(scenario) => (
                    <button
                      type="button"
                      class="os-client-capability-scenario-card"
                      onClick={() => setState("activeScenarioId", scenarioLookupKey(scenario))}
                    >
                      <div class="os-client-capability-scenario-card-head">
                        <h4>{scenario.name}</h4>
                        <span>{scenario.scenario_id}</span>
                      </div>
                      <p>{scenarioProblemText(scenario.problem_and_applicability)}</p>
                      <div class="os-client-capability-scenario-card-meta">
                        <Show when={scenario.type?.trim()}>
                          <span>{scenario.type}</span>
                        </Show>
                        <Show when={scenario.model?.trim()}>
                          <span>{scenario.model}</span>
                        </Show>
                        <Show when={scenario.HPC?.trim()}>
                          <span>{scenario.HPC}</span>
                        </Show>
                        <span>{(scenario.workflow_steps?.length || scenario.workflow.length)} 步工作流</span>
                        <span>{scenario.user_input.length} 个字段</span>
                      </div>
                      <div class="os-client-capability-scenario-card-action">
                        <span aria-hidden="true">
                          <span class="os-wb-cap-chip-label">使用</span>
                        </span>
                      </div>
                    </button>
                  )}
                </For>
              </div>
              <CapabilityPager
                page={scenarioPaged().page}
                totalPages={scenarioPaged().totalPages}
                total={scenarioPaged().total}
                onPageChange={setScenarioPage}
              />
            </Show>
          </section>
        </Show>
        <Show when={state.categoryId === "onemodel" || state.categoryId === "hpc"}>
          <CapabilityResourcePanel
            category={activeCategory()}
            domainId={state.domainId}
            domainLabel={domainLabel(state.domainId)}
            onUpload={
              state.categoryId === "onemodel"
                ? () => setState("uploadPage", "models")
                : undefined
            }
          />
        </Show>
        <Show when={state.categoryId === "onedata"}>
          <CapabilityOnedataPanel
            domain={state.domainId}
            domainLabel={domainLabel(state.domainId)}
            copy={activeCategory().copy}
          />
        </Show>
      </div>

      <Show when={activeScenario()}>
        {(scenario) => (
          <ScenarioWizardOverlay
            scenario={scenario()}
            onClose={closeScenario}
            onSubmit={(input) => {
              submitScenario(scenario(), input)
              closeScenario()
            }}
          />
        )}
      </Show>

      <CapabilityResourceUploadDialog
        open={state.uploadPage !== null}
        page="models"
        domain={uploadDomain(state.domainId)}
        onClose={() => setState("uploadPage", null)}
        onSaved={() => {
          setState({ categoryId: "onemodel", uploadPage: null, activeScenarioId: "" })
          syncCapabilityQuery({ domainId: state.domainId, categoryId: "onemodel" })
        }}
      />

      {props.children}
    </div>
  )
}

function CapabilityResourcePanel(props: {
  category: CapabilityCategory
  domainId: CapabilityDomainSelection
  domainLabel: string
  onUpload?: () => void
}) {
  const [query, setQuery] = createSignal("")
  const [page, setPage] = createSignal(1)
  const [viewMode, setViewMode] = createSignal<CapabilityViewMode>(readCapabilityViewMode())
  const catalog = () => ({ category: props.category.id, domain: props.domainId })
  const visibleItems = createMemo(() => {
    const needle = query().trim()
    if (!needle) return props.category.items
    return props.category.items.filter((item) => fuzzyMatchParts([item.name, item.blurb, ...item.tags], needle))
  })
  // onemodel / hpc share this panel instance — clear search when the catalog scope changes.
  createEffect(() => {
    props.category.id
    props.domainId
    setQuery("")
    setPage(1)
  })
  createEffect(() => {
    query()
    setPage(1)
  })
  const pagedItems = createMemo(() => paginate(visibleItems(), page(), CAPABILITY_PAGE_SIZE_RESOURCE))
  createEffect(() => {
    const safe = pagedItems().page
    if (safe !== page()) setPage(safe)
  })
  const selectViewMode = (mode: CapabilityViewMode) => {
    setViewMode(mode)
    writeCapabilityViewMode(mode)
  }

  return (
    <section class="os-client-capability-resource-panel">
      <header class="os-client-capability-page-section-head os-client-capability-page-section-head-active">
        <p>{props.category.copy.replace(/[。.]$/, "")}</p>
        <Show when={props.onUpload}>
          <button type="button" class="os-client-capability-upload-trigger" onClick={props.onUpload}>
            <span aria-hidden="true">+</span>
            上传私有模型
          </button>
        </Show>
      </header>
      <Show
        when={props.category.items.length > 0}
        fallback={
          <p class="os-client-capability-empty">
            当前「{props.domainLabel}」领域暂无
            {props.category.id === "hpc" ? " HPC 软件" : "模型"}卡片。
          </p>
        }
      >
        <div class="os-client-capability-catalog-toolbar">
          <Show when={props.category.items.length >= 6}>
            <label class="os-client-capability-catalog-search">
              <span>搜索</span>
              <input
                type="search"
                placeholder="按名称、简介或标签筛选"
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
          </Show>
          <div class="os-client-capability-catalog-toolbar-side">
            <span class="os-client-capability-catalog-count">
              {visibleItems().length === props.category.items.length
                ? `共 ${props.category.items.length} 项`
                : `${visibleItems().length} / ${props.category.items.length} 项`}
            </span>
            <div class="os-client-capability-view-switch" role="tablist" aria-label="展示方式">
              <For each={capabilityViewModes}>
                {(mode) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={viewMode() === mode.id}
                    classList={{ "is-active": viewMode() === mode.id }}
                    onClick={() => selectViewMode(mode.id)}
                  >
                    {mode.label}
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>
        <Show
          when={visibleItems().length > 0}
          fallback={<p class="os-client-capability-empty">没有匹配的结果，试试换个关键词。</p>}
        >
          <Show when={viewMode() === "list"}>
            <CapabilityCatalogList items={pagedItems().pageItems} catalog={catalog()} />
          </Show>
          <Show when={viewMode() === "cards"}>
            <CapabilityCardGrid items={pagedItems().pageItems} catalog={catalog()} />
          </Show>
          <CapabilityPager
            page={pagedItems().page}
            totalPages={pagedItems().totalPages}
            total={pagedItems().total}
            onPageChange={setPage}
          />
        </Show>
      </Show>
    </section>
  )
}

function CapabilityCatalogList(props: {
  items: CapabilityResource[]
  catalog: { category: CapabilityCategoryId; domain: CapabilityDomainSelection }
}) {
  return (
    <div class="os-client-capability-catalog" role="list">
      <For each={props.items}>
        {(item) => {
          const available = () => isCapabilityResourceAvailable(item)
          return (
            <article
              class="os-client-capability-catalog-row"
              classList={{
                "is-private": item.ownership === "private",
                "is-unavailable": !available(),
              }}
              role="listitem"
              aria-disabled={!available() ? true : undefined}
              title={!available() ? "暂无 OneScience 源码或魔搭映射，暂不可用" : undefined}
            >
              <CapabilityResourceCopy item={item} />
              <Show when={available()} fallback={<CapabilityUnavailableHint />}>
                <CapabilityResourceActions item={item} catalog={props.catalog} />
              </Show>
            </article>
          )
        }}
      </For>
    </div>
  )
}

function CapabilityCardGrid(props: {
  items: CapabilityResource[]
  catalog: { category: CapabilityCategoryId; domain: CapabilityDomainSelection }
}) {
  return (
    <div class="os-client-capability-page-grid">
      <For each={props.items}>
        {(item) => {
          const available = () => isCapabilityResourceAvailable(item)
          return (
            <article
              class="os-client-capability-card"
              classList={{
                "is-private": item.ownership === "private",
                "is-unavailable": !available(),
              }}
              aria-disabled={!available() ? true : undefined}
              title={!available() ? "暂无 OneScience 源码或魔搭映射，暂不可用" : undefined}
            >
              <div class="os-client-capability-card-body">
                <div class="os-client-capability-card-head">
                  <div class="os-client-capability-card-title">
                    <h4>{item.name}</h4>
                    <Show when={item.ownership === "private"}>
                      <span class="os-client-capability-private-badge">私有资产</span>
                    </Show>
                    <Show when={!available()}>
                      <span class="os-client-capability-unavailable-badge">暂不可用</span>
                    </Show>
                  </div>
                  <Show when={item.tags.length > 0}>
                    <div class="os-client-capability-meta">
                      <For each={item.tags}>{(tag) => <span>{tag}</span>}</For>
                    </div>
                  </Show>
                </div>
                <p>{item.blurb}</p>
              </div>
              <Show when={available()} fallback={<CapabilityUnavailableHint variant="card" />}>
                <CapabilityResourceActions item={item} variant="card" catalog={props.catalog} />
              </Show>
            </article>
          )
        }}
      </For>
    </div>
  )
}

function CapabilityUnavailableHint(props: { variant?: "card" | "list" }) {
  return (
    <p
      classList={{
        "os-client-capability-unavailable-hint": true,
        "os-client-capability-unavailable-hint-card": props.variant === "card",
      }}
    >
      暂无 OneScience 源码或魔搭映射
    </p>
  )
}

function CapabilityResourceCopy(props: { item: CapabilityResource }) {
  return (
    <div class="os-client-capability-catalog-copy">
      <div class="os-client-capability-card-title">
        <h4>{props.item.name}</h4>
        <Show when={props.item.ownership === "private"}>
          <span class="os-client-capability-private-badge">私有资产</span>
        </Show>
        <Show when={!isCapabilityResourceAvailable(props.item)}>
          <span class="os-client-capability-unavailable-badge">暂不可用</span>
        </Show>
      </div>
      <p>{props.item.blurb}</p>
      <Show when={props.item.tags.length > 0}>
        <div class="os-client-capability-catalog-tags">
          <For each={props.item.tags}>{(tag) => <span>{tag}</span>}</For>
        </div>
      </Show>
    </div>
  )
}

function CapabilityResourceActions(props: {
  item: CapabilityResource
  variant?: "card" | "list"
  catalog?: { category: CapabilityCategoryId; domain: CapabilityDomainSelection }
}) {
  const selection = () =>
    props.catalog
      ? { category: props.catalog.category, domain: props.catalog.domain }
      : undefined
  return (
    <div
      classList={{
        "os-client-capability-catalog-actions": props.variant !== "card",
        "os-client-capability-actions": props.variant === "card",
      }}
    >
      <A href={workspaceCapabilityHref(props.item.id, selection())}>
        <span class="os-wb-cap-chip-label">详情</span>
      </A>
      <CapabilityInstallButton item={props.item} />
      <A href={workspaceCapabilityWizardHref(props.item.id, undefined, selection())} data-primary="true">
        <span class="os-wb-cap-chip-label">使用</span>
      </A>
    </div>
  )
}

function CapabilityInstallButton(props: { item: CapabilityResource }) {
  const navigate = useNavigate()
  const sync = useGlobalSync()
  const layout = useLayout()
  const server = useServer()
  const installable = () => isCapabilityResourceInstallable(props.item)

  return (
    <button
      type="button"
      disabled={!installable()}
      title={installable() ? undefined : "暂无魔搭安装包"}
      onClick={() => {
        if (!installable()) return
        startCapabilityInstall({
          resourceId: props.item.id,
          navigate,
          isLoggedIn: !!storedPlatformAuthSession(),
          path: sync.data.path,
          recent: codeWorkspaceRecentProjects(sync.data.project),
          lastCodeWorkspace: server.projects.lastCode(),
          openProject: (directory) => layout.projects.open(directory),
          touchCode: (directory) => server.projects.touchCode(directory),
        })
      }}
    >
      <span class="os-wb-cap-chip-label">安装</span>
    </button>
  )
}

function readCapabilityViewMode(): CapabilityViewMode {
  if (typeof localStorage === "undefined") return "cards"
  const value = localStorage.getItem(capabilityViewModeKey)
  if (value === "cards" || value === "list") return value
  return "cards"
}

function writeCapabilityViewMode(mode: CapabilityViewMode) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(capabilityViewModeKey, mode)
}
