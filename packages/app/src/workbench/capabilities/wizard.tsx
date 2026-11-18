import { For, Show, createMemo, createSignal, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { A, useLocation, useNavigate, useParams, useSearchParams } from "@solidjs/router"
import { codeWorkspaceRecentProjects } from "@/app-routes"
import { useGlobalSync } from "@/context/global-sync"
import { useLayout } from "@/context/layout"
import { useServer } from "@/context/server"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { showToast } from "@opencode-ai/ui/toast"
import {
  codeEntryWorkspaceDirectory,
  configuredCodeDefaultDirectory,
} from "@/app-routes"
import { markCodeNewSessionIntent } from "@/code-session-navigation"
import { pushSessionHandoffDraft } from "@/pages/session/handoff"
import { openRightDock } from "@/workbench/right-dock"
import { defaultPlatformProjectDirectory, storedPlatformAuthSession } from "@/utils/platform-auth"
import { requirePersonalSpace } from "@/workbench/require-auth"
import {
  buildScenarioRunSteps,
  renderRunStepPrompt,
  startScenarioRun,
} from "@/workbench/capabilities/scenario-run"
import {
  catalogSelectionFromSearch,
  workspaceCapabilitiesHref,
  workspaceCapabilityHref,
  workspaceCapabilityReturnHref,
  workspaceSessionHref,
} from "@/workbench/routes"
import { getCapabilityResource, type CapabilityScenario } from "./catalog"
import { isCapabilityResourceAvailable } from "./model-resources"
import {
  getUserScenario,
  normalizeScenarioValues,
  scenarioFieldsForStep,
  scenarioLookupKey,
  scenarioProblemText,
  scenarioWorkflowSteps,
  userScenariosForResource,
  type UserScenario,
} from "./scenario-catalog"
import { ScenarioWizardOverlay } from "./scenario-wizard-overlay"
import { renderCapabilityPrompt } from "./prompt"

function introBackLabel(category: "onemodel" | "hpc") {
  if (category === "hpc") return "软件介绍"
  return "模型介绍"
}

function wizardTitle(name: string) {
  return `使用 ${name} 开始科研任务`
}

export type StartCapabilityWizardTaskInput = {
  resourceId: string
  scenarioId: string
  values: Record<string, string>
  prompt: string
  navigate: (href: string) => void
  isLoggedIn: boolean
  path: Parameters<typeof codeEntryWorkspaceDirectory>[0]["path"]
  recent: Parameters<typeof codeEntryWorkspaceDirectory>[0]["recent"]
  lastCodeWorkspace?: string
  openProject?: (directory: string) => void
  touchCode?: (directory: string) => void
}

export function startCapabilityPromptTask(input: {
  prompt: string
  title: string
  workflow?: string[]
  navigate: (href: string) => void
  isLoggedIn: boolean
  path: StartCapabilityWizardTaskInput["path"]
  recent: StartCapabilityWizardTaskInput["recent"]
  lastCodeWorkspace?: string
  openProject?: (directory: string) => void
  touchCode?: (directory: string) => void
}) {
  if (
    !requirePersonalSpace({
      navigate: input.navigate,
      action: {
        type: "prompt",
        prompt: input.prompt,
        title: input.title,
        workflow: input.workflow,
      },
      isLoggedIn: input.isLoggedIn,
    })
  ) {
    return false
  }

  const directory =
    codeEntryWorkspaceDirectory({
      path: input.path,
      recent: input.recent,
      lastCodeWorkspace: input.lastCodeWorkspace,
    }) ||
    defaultPlatformProjectDirectory(storedPlatformAuthSession()) ||
    configuredCodeDefaultDirectory(document, input.path)

  if (!directory) return false

  const slug = base64Encode(directory)
  pushSessionHandoffDraft(slug, input.prompt)
  markCodeNewSessionIntent(slug)
  input.openProject?.(directory)
  input.touchCode?.(directory)
  showToast({ variant: "success", title: `已为你创建「${input.title}」任务` })
  input.navigate(workspaceSessionHref(directory))
  return true
}

export function startCapabilityScenarioRunTask(input: {
  scenario: UserScenario
  values: Record<string, string>
  navigate: (href: string) => void
  isLoggedIn: boolean
  path: StartCapabilityWizardTaskInput["path"]
  recent: StartCapabilityWizardTaskInput["recent"]
  lastCodeWorkspace?: string
  openProject?: (directory: string) => void
  touchCode?: (directory: string) => void
}) {
  const steps = buildScenarioRunSteps(input.scenario)
  const first = steps[0]
  if (!first?.promptTemplate.trim()) return false

  if (
    !requirePersonalSpace({
      navigate: input.navigate,
      action: {
        type: "scenario-run",
        scenarioId: input.scenario.id || input.scenario.scenario_id,
        values: input.values,
      },
      isLoggedIn: input.isLoggedIn,
    })
  ) {
    return false
  }

  const directory =
    codeEntryWorkspaceDirectory({
      path: input.path,
      recent: input.recent,
      lastCodeWorkspace: input.lastCodeWorkspace,
    }) ||
    defaultPlatformProjectDirectory(storedPlatformAuthSession()) ||
    configuredCodeDefaultDirectory(document, input.path)

  if (!directory) return false

  const slug = base64Encode(directory)
  const catalogSteps = scenarioWorkflowSteps(input.scenario)
  const fields = catalogSteps[0]
    ? scenarioFieldsForStep(input.scenario, catalogSteps[0])
    : input.scenario.user_input
  const values = normalizeScenarioValues(input.scenario.user_input, input.values)
  startScenarioRun(slug, {
    title: input.scenario.name,
    scenarioId: scenarioLookupKey(input.scenario),
    values,
    steps,
  })
  openRightDock("todo")
  pushSessionHandoffDraft(slug, renderRunStepPrompt(first, values, fields))
  markCodeNewSessionIntent(slug)
  input.openProject?.(directory)
  input.touchCode?.(directory)
  showToast({
    variant: "success",
    title: `已创建「${input.scenario.name}」`,
    description: `将按 ${steps.length} 步自动依次执行，缺参或失败时暂停`,
  })
  input.navigate(workspaceSessionHref(directory))
  return true
}

export function startCapabilityWizardTask(input: StartCapabilityWizardTaskInput) {
  if (
    !requirePersonalSpace({
      navigate: input.navigate,
      action: {
        type: "wizard",
        resourceId: input.resourceId,
        scenarioId: input.scenarioId,
        values: input.values,
        prompt: input.prompt,
      },
      isLoggedIn: input.isLoggedIn,
    })
  ) {
    return false
  }

  const resource = getCapabilityResource(input.resourceId)
  const scenario = resource?.scenarios.find((entry) => entry.id === input.scenarioId)
  if (!resource || !scenario || !isCapabilityResourceAvailable(resource)) return false

  const directory =
    codeEntryWorkspaceDirectory({
      path: input.path,
      recent: input.recent,
      lastCodeWorkspace: input.lastCodeWorkspace,
    }) ||
    defaultPlatformProjectDirectory(storedPlatformAuthSession()) ||
    configuredCodeDefaultDirectory(document, input.path)

  if (!directory) return false

  const slug = base64Encode(directory)
  pushSessionHandoffDraft(slug, input.prompt)
  markCodeNewSessionIntent(slug)
  input.openProject?.(directory)
  input.touchCode?.(directory)
  showToast({ variant: "success", title: `已为你创建 ${resource.name}「${scenario.title}」任务` })
  input.navigate(workspaceSessionHref(directory))
  return true
}

function promptForScenario(scenario: CapabilityScenario, values: Record<string, string>) {
  return renderCapabilityPrompt(scenario.promptTemplate, values)
}

function emptyValues(scenario: CapabilityScenario) {
  return Object.fromEntries(
    scenario.fields.map((field) => [field.id, fieldDefault(field)]),
  )
}

function fieldDefault(field: { default?: string; placeholder?: string }) {
  if (field.default?.trim()) return field.default
  const fromPlaceholder = field.placeholder?.replace(/^例如[：:]\s*/, "").trim()
  return fromPlaceholder ?? ""
}

export function CapabilityWizardPage() {
  const params = useParams()
  const location = useLocation()
  const [searchParams] = useSearchParams<{ scenario?: string }>()
  const navigate = useNavigate()
  const sync = useGlobalSync()
  const layout = useLayout()
  const server = useServer()
  const resource = () => getCapabilityResource(params.id ?? "")
  const catalog = () => catalogSelectionFromSearch(location.search)
  const returnHref = () =>
    workspaceCapabilityReturnHref(location.search, {
      category: resource()?.category ?? "onemodel",
      domain: resource()?.domain ?? "materials",
    })
  const introHref = () => workspaceCapabilityHref(params.id ?? "", catalog())

  const [state, setState] = createStore({
    scenarioId: "",
    values: {} as Record<string, string>,
    prompt: "",
  })
  const [activeUserScenarioId, setActiveUserScenarioId] = createSignal("")

  const scenario = () => resource()?.scenarios.find((entry) => entry.id === state.scenarioId)
  const catalogUserScenarios = createMemo(() => {
    const item = resource()
    if (!item) return [] as UserScenario[]
    return userScenariosForResource({
      domain: item.domain,
      name: item.name,
      id: item.id,
      category: item.category,
    })
  })
  const activeUserScenario = createMemo(() => {
    const id = activeUserScenarioId()
    if (!id) return undefined
    return getUserScenario(id) ?? catalogUserScenarios().find((entry) => scenarioLookupKey(entry) === id)
  })

  const resumeInput = () => ({
    navigate,
    isLoggedIn: !!storedPlatformAuthSession(),
    path: sync.data.path,
    recent: codeWorkspaceRecentProjects(sync.data.project),
    lastCodeWorkspace: server.projects.lastCode(),
    openProject: (directory: string) => layout.projects.open(directory),
    touchCode: (directory: string) => server.projects.touchCode(directory),
  })

  const syncPromptFromTemplate = () => {
    const current = scenario()
    if (!current) return
    setState("prompt", promptForScenario(current, state.values))
  }

  onMount(() => {
    const item = resource()
    if (!item?.scenarios.length) return
    const queryScenario = searchParams.scenario
    const match = queryScenario ? item.scenarios.find((entry) => entry.id === queryScenario) : undefined
    const selected = match ?? item.scenarios[0]
    const values = emptyValues(selected)
    setState({
      scenarioId: selected.id,
      values,
      prompt: promptForScenario(selected, values),
    })
  })

  const selectScenario = (scenarioId: string) => {
    const item = resource()
    const next = item?.scenarios.find((entry) => entry.id === scenarioId)
    if (!next) return
    setActiveUserScenarioId("")
    const values = emptyValues(next)
    setState({
      scenarioId: next.id,
      values,
      prompt: promptForScenario(next, values),
    })
  }

  const openUserScenario = (scenarioId: string) => {
    setActiveUserScenarioId(scenarioId)
  }

  const setFieldValue = (fieldId: string, value: string) => {
    const current = scenario()
    if (!current) return
    const values = { ...state.values, [fieldId]: value }
    setState({
      values,
      prompt: promptForScenario(current, values),
    })
  }

  const createTask = () => {
    const item = resource()
    const current = scenario()
    if (!item || !current) return
    startCapabilityWizardTask({
      resourceId: item.id,
      scenarioId: current.id,
      values: { ...state.values },
      prompt: state.prompt,
      ...resumeInput(),
    })
  }

  const submitUserScenario = (scenario: UserScenario, input: { values: Record<string, string> }) => {
    startCapabilityScenarioRunTask({
      scenario,
      values: input.values,
      ...resumeInput(),
    })
  }

  return (
    <div class="os-client-capability-wizard-overlay" role="dialog" aria-modal="true" aria-label="能力向导">
      <Show
        when={resource()}
        fallback={
          <>
            <A class="os-client-capability-wizard-backdrop" href={workspaceCapabilitiesHref()} aria-label="关闭向导" />
            <section class="os-client-capability-wizard-dialog">
              <p>未找到该能力。</p>
              <A href={workspaceCapabilitiesHref()}>返回能力中心</A>
            </section>
          </>
        }
      >
        {(item) => (
          <Show
            when={isCapabilityResourceAvailable(item())}
            fallback={
              <>
                <A
                  class="os-client-capability-wizard-backdrop"
                  href={returnHref()}
                  aria-label="关闭向导"
                />
                <section class="os-client-capability-wizard-dialog">
                  <p>「{item().name}」暂无 OneScience 源码或魔搭映射，当前不可使用。</p>
                  <A href={returnHref()}>返回模型库</A>
                </section>
              </>
            }
          >
            <A
              class="os-client-capability-wizard-backdrop"
              href={returnHref()}
              aria-label="关闭向导"
            />
            <section class="os-client-capability-wizard-dialog">
            <header class="os-client-capability-wizard-head">
              <A class="os-client-capability-wizard-intro-back" href={introHref()}>
                {introBackLabel(item().category)}
              </A>
              <div class="os-client-capability-wizard-head-title">
                <h2>{wizardTitle(item().name)}</h2>
              </div>
              <A
                class="os-client-capability-wizard-close"
                href={returnHref()}
                aria-label="关闭"
              >
                ×
              </A>
            </header>
            <div class="os-client-capability-wizard-columns">
              <aside class="os-client-capability-wizard-column" aria-label="你想做什么？">
                <h3>你想做什么？</h3>
                <div class="os-client-capability-wizard-scenarios">
                  <For each={item().scenarios}>
                    {(entry) => (
                      <button
                        type="button"
                        classList={{ "is-active": !activeUserScenarioId() && state.scenarioId === entry.id }}
                        aria-pressed={!activeUserScenarioId() && state.scenarioId === entry.id}
                        onClick={() => selectScenario(entry.id)}
                      >
                        <strong>{entry.title}</strong>
                        <p>{entry.summary}</p>
                      </button>
                    )}
                  </For>
                  <Show when={catalogUserScenarios().length > 0}>
                    <div class="os-client-capability-wizard-scenario-group">
                      <span>完整工作流场景 · {catalogUserScenarios().length}</span>
                      <For each={catalogUserScenarios()}>
                        {(entry) => (
                          <button
                            type="button"
                            classList={{ "is-active": activeUserScenarioId() === scenarioLookupKey(entry) }}
                            aria-pressed={activeUserScenarioId() === scenarioLookupKey(entry)}
                            onClick={() => openUserScenario(scenarioLookupKey(entry))}
                          >
                            <strong>{entry.name}</strong>
                            <p>{scenarioProblemText(entry.problem_and_applicability)}</p>
                            <small>
                              {entry.scenario_id} · {(entry.workflow_steps?.length || entry.workflow.length)} 步
                            </small>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </aside>

              <section class="os-client-capability-wizard-column" aria-label="补充信息">
                <h3>补充信息</h3>
                <Show when={scenario()} keyed fallback={<p class="os-client-capability-wizard-empty">请先选择任务场景。</p>}>
                  {(current) => (
                    <div class="os-client-capability-wizard-middle">
                      <div class="os-client-capability-wizard-fields">
                        <For each={current.fields}>
                          {(field) => (
                            <label class="os-client-capability-wizard-field">
                              <span>{field.label}</span>
                              <Show
                                when={field.multiline}
                                fallback={
                                  <input
                                    type="text"
                                    value={state.values[field.id] ?? ""}
                                    placeholder={field.placeholder}
                                    onInput={(event) => setFieldValue(field.id, event.currentTarget.value)}
                                  />
                                }
                              >
                                <textarea
                                  rows={3}
                                  value={state.values[field.id] ?? ""}
                                  placeholder={field.placeholder}
                                  onInput={(event) => setFieldValue(field.id, event.currentTarget.value)}
                                />
                              </Show>
                            </label>
                          )}
                        </For>
                      </div>

                      <div class="os-client-capability-wizard-summary" aria-label="当前能力配置">
                        <h4>当前能力配置</h4>
                        <dl>
                          <div>
                            <dt>当前能力</dt>
                            <dd>{current.capabilitySummary.current}</dd>
                          </div>
                          <div>
                            <dt>关键配置</dt>
                            <dd>{current.capabilitySummary.keyConfig}</dd>
                          </div>
                          <div>
                            <dt>运行资源</dt>
                            <dd>{current.capabilitySummary.resources}</dd>
                          </div>
                          <div>
                            <dt>交付结果</dt>
                            <dd>{current.capabilitySummary.deliverables}</dd>
                          </div>
                        </dl>
                      </div>

                      <Show when={current.requiredData?.length}>
                        <div class="os-client-capability-wizard-required" aria-label="该能力需要什么数据">
                          <h4>该能力需要什么数据</h4>
                          <ul>
                            <For each={current.requiredData}>{(entry) => <li>{entry}</li>}</For>
                          </ul>
                        </div>
                      </Show>
                    </div>
                  )}
                </Show>
              </section>

              <section class="os-client-capability-wizard-column" aria-label="起始任务">
                <Show when={scenario()} keyed fallback={<p class="os-client-capability-wizard-empty">请先选择任务场景。</p>}>
                  {(current) => (
                    <>
                      <div class="os-client-capability-wizard-right-head">
                        <strong>{current.title}</strong>
                        <p>{current.summary}</p>
                      </div>
                      <div class="os-client-capability-wizard-outputs" aria-label="预计产出">
                        <span>预计产出</span>
                        <p>{current.expectedOutputs}</p>
                      </div>
                    </>
                  )}
                </Show>
                <div class="os-client-capability-wizard-column-head">
                  <h3>起始任务</h3>
                  <button type="button" onClick={syncPromptFromTemplate}>
                    重新生成
                  </button>
                </div>
                <textarea
                  class="os-client-capability-wizard-prompt"
                  rows={14}
                  value={state.prompt}
                  onInput={(event) => setState("prompt", event.currentTarget.value)}
                />
              </section>
            </div>

            <footer class="os-client-capability-wizard-footer">
              <A href={returnHref()}>返回能力中心</A>
              <button type="button" data-primary="true" disabled={!state.prompt.trim()} onClick={createTask}>
                创建任务
              </button>
            </footer>
          </section>

            <Show when={activeUserScenario()}>
              {(scenario) => (
                <ScenarioWizardOverlay
                  scenario={scenario()}
                  onClose={() => setActiveUserScenarioId("")}
                  onSubmit={(input) => submitUserScenario(scenario(), input)}
                />
              )}
            </Show>
          </Show>
        )}
      </Show>
    </div>
  )
}
