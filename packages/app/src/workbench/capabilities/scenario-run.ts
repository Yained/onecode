import { createSignal } from "solid-js"
import { getCapabilityResource } from "./catalog"
import {
  getUserScenario,
  renderScenarioPrompt,
  buildScenarioParamNormalizeHint,
  normalizeScenarioValues,
  scenarioFieldKey,
  scenarioFieldsForStep,
  scenarioWorkflowSteps,
  type ScenarioUserInput,
  type UserScenario,
} from "./scenario-catalog"

export type ScenarioRunStepStatus = "pending" | "in_progress" | "completed" | "failed"

export type ScenarioConfirmMode = "unset" | "auto" | "per_step"

export type ScenarioRunStep = {
  step_id: string
  name: string
  promptTemplate: string
  inputKeys: string[]
  status: ScenarioRunStepStatus
}

export type ScenarioRun = {
  title: string
  scenarioId: string
  values: Record<string, string>
  steps: ScenarioRunStep[]
  currentIndex: number
  phase:
    | "draft"
    | "running"
    | "awaiting_params"
    | "awaiting_confirm"
    | "awaiting_runtime"
    | "installing_runtime"
    | "stopped"
    | "done"
  confirmMode: ScenarioConfirmMode
  openOnSubmit: boolean
  sessionID?: string
  /** True after scenario.name was written to the session title once. */
  titleSeeded?: boolean
  lastHandledAssistantID?: string
  stopReason?: string
  missingKeys?: string[]
  runtimeResourceIds?: string[]
  runtimeInstallQueue?: string[]
}

export type StepVerdict = "pass" | "partial" | "reject" | "blocked" | "unknown"

const runs = new Map<string, ScenarioRun>()
const [revision, setRevision] = createSignal(0)

export const scenarioRunRevision = () => revision()

function touch() {
  setRevision((value) => value + 1)
}

export function buildScenarioRunSteps(scenario: UserScenario): ScenarioRunStep[] {
  return scenarioWorkflowSteps(scenario).map((step) => ({
    step_id: step.step_id,
    name: step.name,
    promptTemplate: step.prompt || scenario.ai_prompt?.template || "",
    inputKeys: (step.input_variables ?? []).map((item) => String(item).replace(/^\{|\}$/g, "")),
    status: "pending",
  }))
}

export function renderRunStepPrompt(
  step: ScenarioRunStep,
  values: Record<string, string>,
  fields: ScenarioUserInput[] = [],
) {
  const body = renderScenarioPrompt(step.promptTemplate, values)
  const hint = buildScenarioParamNormalizeHint(fields, values)
  return hint ? `${body}${hint}` : body
}

function renderPromptForRun(run: ScenarioRun, stepIndex = run.currentIndex, values = run.values) {
  const step = run.steps[stepIndex]
  if (!step) return ""
  const fields = scenarioRunFieldsForStepIndex(run, stepIndex)
  const normalized = normalizeScenarioValues(fields.length ? fields : scenarioRunFieldDefs(run), values)
  return renderRunStepPrompt(step, normalized, fields)
}

export function startScenarioRun(
  key: string,
  input: {
    title: string
    scenarioId: string
    values: Record<string, string>
    steps: ScenarioRunStep[]
  },
) {
  const steps = input.steps.map((step, index) => ({
    ...step,
    status: (index === 0 ? "pending" : "pending") as ScenarioRunStepStatus,
  }))
  runs.set(key, {
    title: input.title.trim() || "场景工作流",
    scenarioId: input.scenarioId,
    values: { ...input.values },
    steps,
    currentIndex: 0,
    phase: "draft",
    confirmMode: "unset",
    openOnSubmit: true,
  })
  touch()
}

export function getScenarioRun(key: string) {
  revision()
  return runs.get(key)
}

/** Prefer directory key; fall back to a run bound to this session (e.g. after path slug drift). */
export function resolveScenarioRun(key: string, sessionID?: string) {
  revision()
  const byKey = runs.get(key)
  if (byKey) return byKey
  if (!sessionID) return
  for (const run of runs.values()) {
    if (run.sessionID === sessionID) return run
  }
}

export function clearScenarioRun(key: string) {
  if (!runs.delete(key)) return
  touch()
}

/** Move an in-progress scenario run when the user switches workspace directory. */
export function moveScenarioRun(fromKey: string, toKey: string) {
  const from = fromKey.trim()
  const to = toKey.trim()
  if (!from || !to || from === to) return false
  const run = runs.get(from)
  if (!run) return false
  if (run.phase === "done" || run.phase === "stopped") return false
  runs.delete(from)
  // New workspace starts a fresh session; keep workflow state and reopen on land.
  runs.set(to, {
    ...run,
    sessionID: undefined,
    lastHandledAssistantID: undefined,
    titleSeeded: false,
    openOnSubmit: true,
  })
  touch()
  return true
}

export function consumeScenarioRunOpenOnSubmit(key: string) {
  const run = runs.get(key)
  if (!run?.openOnSubmit) return false
  runs.set(key, { ...run, openOnSubmit: false })
  touch()
  return true
}

export function bindScenarioRunSession(key: string, sessionID: string) {
  const run = runs.get(key)
  if (!run || run.sessionID === sessionID) return
  runs.set(key, { ...run, sessionID })
  touch()
}

/** Write scenario.name onto the session before prompt fallback can steal the title. */
export function seedScenarioSessionTitle(
  key: string,
  sessionID: string,
  setTitle: (title: string) => Promise<unknown>,
) {
  const run = runs.get(key)
  if (!run || run.titleSeeded) return false
  const title = run.title.trim()
  if (!title) return false
  runs.set(key, { ...run, sessionID, titleSeeded: true })
  touch()
  void setTitle(title).catch(() => {
    const latest = runs.get(key)
    if (!latest) return
    runs.set(key, { ...latest, titleSeeded: false })
    touch()
  })
  return true
}

export function markScenarioRunStarted(key: string) {
  const run = runs.get(key)
  if (!run || run.phase === "running" || run.phase === "done") return
  const steps = run.steps.map((step, index) => ({
    ...step,
    status: (index === run.currentIndex ? "in_progress" : step.status) as ScenarioRunStepStatus,
  }))
  runs.set(key, { ...run, phase: "running", steps, openOnSubmit: false })
  touch()
}

export function updateScenarioRunValues(key: string, patch: Record<string, string>) {
  const run = runs.get(key)
  if (!run) return
  runs.set(key, {
    ...run,
    values: { ...run.values, ...patch },
    missingKeys: undefined,
    phase: run.phase === "awaiting_params" ? "running" : run.phase,
  })
  touch()
}

export function currentScenarioRunPrompt(key: string) {
  const run = runs.get(key)
  if (!run) return ""
  return renderPromptForRun(run)
}

export function scenarioRunFieldDefs(run: ScenarioRun): ScenarioUserInput[] {
  return getUserScenario(run.scenarioId)?.user_input ?? []
}

export function scenarioRunFieldsForStepIndex(run: ScenarioRun, stepIndex: number): ScenarioUserInput[] {
  const scenario = getUserScenario(run.scenarioId)
  if (!scenario) return []
  const catalogSteps = scenarioWorkflowSteps(scenario)
  const catalogStep = catalogSteps[stepIndex]
  if (catalogStep) return scenarioFieldsForStep(scenario, catalogStep)
  const keys = new Set(run.steps[stepIndex]?.inputKeys ?? [])
  if (keys.size === 0) return scenario.user_input
  return scenario.user_input.filter((field) => keys.has(scenarioFieldKey(field)))
}

export function parseScenarioStepVerdict(text: string): StepVerdict {
  const match =
    text.match(/结论[^\nA-Z]{0,40}(PASS|PARTIAL|REJECT|BLOCKED)/i) ??
    text.match(/\b(PASS|PARTIAL|REJECT|BLOCKED)\b(?![\s\S]*\b(?:PASS|PARTIAL|REJECT|BLOCKED)\b)/i)
  const token = (match?.[1] ?? "").toUpperCase()
  if (token === "PASS") return "pass"
  if (token === "PARTIAL") return "partial"
  if (token === "REJECT") return "reject"
  if (token === "BLOCKED") return "blocked"
  return "unknown"
}

export function parseMissingParamKeys(text: string, knownKeys: string[]) {
  const found: string[] = []
  for (const key of knownKeys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const patterns = [
      new RegExp(`\\{${escaped}\\}[^\\n]{0,80}MISSING`, "i"),
      new RegExp(`${escaped}[^\\n]{0,80}MISSING`, "i"),
      new RegExp(`MISSING[^\\n]{0,80}\\{${escaped}\\}`, "i"),
      new RegExp(`MISSING[^\\n]{0,80}${escaped}`, "i"),
    ]
    if (patterns.some((pattern) => pattern.test(text))) found.push(key)
  }
  return found
}

const RUNTIME_CHECKS: Array<{ id: string; patterns: RegExp[] }> = [
  {
    id: "vasp",
    patterns: [
      /VASP_RUNTIME/i,
      /VASP[^。\n]{0,60}(未找到|无法识别|不可用|缺失|未安装|识别失败|无.*许可|找不到)/i,
      /(未找到|无法识别|不可用|缺失|未安装|识别失败)[^。\n]{0,60}VASP/i,
      /POTCAR[^。\n]{0,40}(未找到|无法|缺失|不可用|识别失败)/i,
      /(未找到|无法|缺失|不可用)[^。\n]{0,40}POTCAR/i,
    ],
  },
  {
    id: "lammps",
    patterns: [
      /LAMMPS_RUNTIME/i,
      /LAMMPS[^。\n]{0,60}(未找到|无法识别|不可用|缺失|未安装|识别失败|pair_style)/i,
      /(未找到|无法识别|不可用|缺失|未安装|识别失败)[^。\n]{0,60}LAMMPS/i,
    ],
  },
  {
    id: "mace",
    patterns: [
      /MACE_RUNTIME/i,
      /MACE[^。\n]{0,60}(未找到|无法识别|不可用|缺失|未安装|识别失败|环境)/i,
      /(未找到|无法识别|不可用|缺失|未安装|识别失败)[^。\n]{0,60}MACE/i,
    ],
  },
]

export function parseMissingRuntimes(text: string) {
  return RUNTIME_CHECKS.filter((entry) => entry.patterns.some((pattern) => pattern.test(text))).map((entry) => entry.id)
}

export type ScenarioIdleResult =
  | { action: "ignore" }
  | { action: "next"; prompt: string; stepName: string }
  | {
      action: "confirm_next"
      stepIndex: number
      stepName: string
      fields: ScenarioUserInput[]
      values: Record<string, string>
      firstDecision: boolean
    }
  | { action: "done" }
  | { action: "stop"; reason: string }
  | { action: "need_params"; keys: string[]; reason: string }
  | { action: "need_runtime"; resourceIds: string[]; reason: string }
  | { action: "install_runtime"; resourceId: string; prompt: string; label: string }
  | { action: "retry_step"; prompt: string; stepName: string }

function runtimeLabel(resourceId: string) {
  if (resourceId === "vasp") return "VASP"
  if (resourceId === "lammps") return "LAMMPS"
  if (resourceId === "mace") return "MACE"
  return resourceId
}

export function buildScenarioRuntimeInstallPrompt(resourceId: string) {
  const resource = getCapabilityResource(resourceId)
  if (!resource) return undefined
  return [
    `场景工作流因缺少 ${resource.name} 运行环境已暂停。请先完成下列安装/配置，完成后再自动重试当前步骤。`,
    "",
    resource.install.prompt,
    "",
    "安装完成后请明确给出结论：PASS（环境可用）或 BLOCKED（仍不可用），并附上验证命令与证据。",
  ].join("\n")
}

function handleInstallingRuntimeIdle(
  key: string,
  run: ScenarioRun,
  input: { assistantMessageID: string; assistantText: string },
): ScenarioIdleResult {
  const verdict = parseScenarioStepVerdict(input.assistantText)
  if (verdict === "reject" || verdict === "blocked") {
    const stillMissing = parseMissingRuntimes(input.assistantText)
    const resourceIds = stillMissing.length ? stillMissing : (run.runtimeInstallQueue ?? run.runtimeResourceIds ?? [])
    runs.set(key, {
      ...run,
      phase: "awaiting_runtime",
      lastHandledAssistantID: input.assistantMessageID,
      runtimeResourceIds: resourceIds,
      runtimeInstallQueue: undefined,
      stopReason: "运行环境仍不可用，请安装配置后继续",
    })
    touch()
    return {
      action: "need_runtime",
      resourceIds,
      reason: "运行环境仍不可用，请安装配置后继续",
    }
  }

  const queue = run.runtimeInstallQueue ?? []
  const remaining = queue.slice(1)
  if (remaining.length > 0) {
    const nextId = remaining[0]
    const prompt = buildScenarioRuntimeInstallPrompt(nextId)
    if (!prompt) {
      runs.set(key, {
        ...run,
        phase: "stopped",
        lastHandledAssistantID: input.assistantMessageID,
        stopReason: `未找到 ${nextId} 的安装配置`,
      })
      touch()
      return { action: "stop", reason: `未找到 ${nextId} 的安装配置` }
    }
    runs.set(key, {
      ...run,
      phase: "installing_runtime",
      runtimeInstallQueue: remaining,
      lastHandledAssistantID: input.assistantMessageID,
      stopReason: `正在安装配置 ${runtimeLabel(nextId)}`,
    })
    touch()
    return {
      action: "install_runtime",
      resourceId: nextId,
      prompt,
      label: runtimeLabel(nextId),
    }
  }

  const step = run.steps[run.currentIndex]
  if (!step) {
    runs.set(key, {
      ...run,
      phase: "stopped",
      lastHandledAssistantID: input.assistantMessageID,
      stopReason: "当前步骤丢失，已停止",
    })
    touch()
    return { action: "stop", reason: "当前步骤丢失，已停止" }
  }

  const steps = run.steps.map((entry, index) =>
    index === run.currentIndex ? { ...entry, status: "in_progress" as const } : entry,
  )
  const prompt = renderPromptForRun(run)
  runs.set(key, {
    ...run,
    steps,
    phase: "running",
    runtimeInstallQueue: undefined,
    runtimeResourceIds: undefined,
    lastHandledAssistantID: input.assistantMessageID,
    stopReason: undefined,
  })
  touch()
  return { action: "retry_step", prompt, stepName: step.name }
}

export function handleScenarioRunIdle(
  key: string,
  input: {
    assistantMessageID: string
    assistantText: string
  },
): ScenarioIdleResult {
  const run = runs.get(key)
  if (!run) return { action: "ignore" }
  if (run.lastHandledAssistantID === input.assistantMessageID) return { action: "ignore" }

  if (run.phase === "installing_runtime") {
    return handleInstallingRuntimeIdle(key, run, input)
  }

  if (run.phase !== "running") return { action: "ignore" }

  const verdict = parseScenarioStepVerdict(input.assistantText)
  const knownKeys = scenarioRunFieldDefs(run).map((field) => scenarioFieldKey(field))
  const missing = parseMissingParamKeys(input.assistantText, knownKeys)
  const runtimes = parseMissingRuntimes(input.assistantText)
  const step = run.steps[run.currentIndex]

  if (verdict === "reject") {
    const steps = run.steps.map((entry, index) =>
      index === run.currentIndex ? { ...entry, status: "failed" as const } : entry,
    )
    runs.set(key, {
      ...run,
      steps,
      phase: "stopped",
      lastHandledAssistantID: input.assistantMessageID,
      stopReason: "步骤结论为 REJECT，已停止自动续步",
    })
    touch()
    return { action: "stop", reason: "步骤结论为 REJECT，已停止自动续步" }
  }

  if (missing.length > 0) {
    runs.set(key, {
      ...run,
      phase: "awaiting_params",
      lastHandledAssistantID: input.assistantMessageID,
      missingKeys: missing,
      stopReason: "缺少必要参数，请补充后继续",
    })
    touch()
    return {
      action: "need_params",
      keys: missing,
      reason: "缺少必要参数，请补充后继续",
    }
  }

  if (verdict === "blocked" && runtimes.length > 0) {
    runs.set(key, {
      ...run,
      phase: "awaiting_runtime",
      lastHandledAssistantID: input.assistantMessageID,
      runtimeResourceIds: runtimes,
      stopReason: `缺少运行环境：${runtimes.map(runtimeLabel).join("、")}`,
    })
    touch()
    return {
      action: "need_runtime",
      resourceIds: runtimes,
      reason: `缺少运行环境：${runtimes.map(runtimeLabel).join("、")}。可先安装配置（含下载链接），完成后再继续当前步骤。`,
    }
  }

  if (verdict === "blocked") {
    const keys = step?.inputKeys.filter((item) => !String(run.values[item] ?? "").trim()) ?? []
    runs.set(key, {
      ...run,
      phase: "awaiting_params",
      lastHandledAssistantID: input.assistantMessageID,
      missingKeys: keys,
      stopReason: "步骤被阻塞，请补充参数或检查环境后继续",
    })
    touch()
    return {
      action: "need_params",
      keys,
      reason: "步骤被阻塞，请补充参数或检查环境后继续",
    }
  }

  const completed = run.steps.map((entry, index) =>
    index === run.currentIndex ? { ...entry, status: "completed" as const } : entry,
  )
  const nextIndex = run.currentIndex + 1
  if (nextIndex >= completed.length) {
    runs.set(key, {
      ...run,
      steps: completed,
      currentIndex: nextIndex,
      phase: "done",
      lastHandledAssistantID: input.assistantMessageID,
      stopReason: undefined,
      missingKeys: undefined,
      runtimeResourceIds: undefined,
    })
    touch()
    return { action: "done" }
  }

  const next = completed[nextIndex]
  if (run.confirmMode === "auto") {
    const nextSteps = completed.map((entry, index) =>
      index === nextIndex ? { ...entry, status: "in_progress" as const } : entry,
    )
    const prompt = renderPromptForRun({ ...run, steps: completed, currentIndex: nextIndex }, nextIndex)
    runs.set(key, {
      ...run,
      steps: nextSteps,
      currentIndex: nextIndex,
      phase: "running",
      lastHandledAssistantID: input.assistantMessageID,
      stopReason: undefined,
      missingKeys: undefined,
      runtimeResourceIds: undefined,
    })
    touch()
    return { action: "next", prompt, stepName: next.name }
  }

  runs.set(key, {
    ...run,
    steps: completed,
    currentIndex: nextIndex,
    phase: "awaiting_confirm",
    lastHandledAssistantID: input.assistantMessageID,
    stopReason: "请确认下一步参数后继续",
    missingKeys: undefined,
    runtimeResourceIds: undefined,
  })
  touch()
  const latest = runs.get(key)!
  return {
    action: "confirm_next",
    stepIndex: nextIndex,
    stepName: next.name,
    fields: scenarioRunFieldsForStepIndex(latest, nextIndex),
    values: { ...latest.values },
    firstDecision: run.confirmMode === "unset",
  }
}

/** After user confirms next-step params (and optionally picks auto vs per-step). */
export function confirmScenarioNextStep(
  key: string,
  input: {
    values: Record<string, string>
    mode: Exclude<ScenarioConfirmMode, "unset">
  },
): { prompt: string; stepName: string } | undefined {
  const run = runs.get(key)
  if (!run || run.phase !== "awaiting_confirm") return
  const step = run.steps[run.currentIndex]
  if (!step) return
  const fields = scenarioRunFieldsForStepIndex(run, run.currentIndex)
  const values = normalizeScenarioValues(fields, { ...run.values, ...input.values })
  const steps = run.steps.map((entry, index) =>
    index === run.currentIndex ? { ...entry, status: "in_progress" as const } : entry,
  )
  const prompt = renderPromptForRun(run, run.currentIndex, values)
  runs.set(key, {
    ...run,
    values,
    steps,
    phase: "running",
    confirmMode: input.mode,
    stopReason: undefined,
    missingKeys: undefined,
    runtimeResourceIds: undefined,
    runtimeInstallQueue: undefined,
    // Keep lastHandledAssistantID so the previous step's reply is not treated as this step's result.
  })
  touch()
  return { prompt, stepName: step.name }
}

/** Restart workflow from a completed/failed/in-progress step; later steps reset to pending. */
export function restartScenarioRunFromStep(
  key: string,
  input: {
    stepIndex: number
    values?: Record<string, string>
    mode?: Exclude<ScenarioConfirmMode, "unset">
  },
): { prompt: string; stepName: string } | undefined {
  const run = runs.get(key)
  if (!run) return
  if (input.stepIndex < 0 || input.stepIndex >= run.steps.length) return
  const target = run.steps[input.stepIndex]
  if (target.status !== "completed" && target.status !== "failed" && target.status !== "in_progress") return

  const values = normalizeScenarioValues(scenarioRunFieldsForStepIndex(run, input.stepIndex), {
    ...run.values,
    ...(input.values ?? {}),
  })
  const steps = run.steps.map((entry, index) => {
    if (index < input.stepIndex) return entry
    if (index === input.stepIndex) return { ...entry, status: "in_progress" as const }
    return { ...entry, status: "pending" as const }
  })
  const prompt = renderPromptForRun({ ...run, values, steps, currentIndex: input.stepIndex }, input.stepIndex, values)
  runs.set(key, {
    ...run,
    values,
    steps,
    currentIndex: input.stepIndex,
    phase: "running",
    confirmMode: input.mode ?? (run.confirmMode === "unset" ? "auto" : run.confirmMode),
    stopReason: undefined,
    missingKeys: undefined,
    runtimeResourceIds: undefined,
    runtimeInstallQueue: undefined,
    openOnSubmit: false,
    // Caller/session should acknowledge the latest assistant before send; keep existing id as a baseline.
  })
  touch()
  return { prompt, stepName: target.name }
}

export function acknowledgeScenarioAssistant(key: string, assistantMessageID: string) {
  const run = runs.get(key)
  if (!run || run.lastHandledAssistantID === assistantMessageID) return
  runs.set(key, { ...run, lastHandledAssistantID: assistantMessageID })
  touch()
}

type ScenarioContinueHandler = (input: { directoryKey: string; prompt: string; stepName: string }) => void
let scenarioContinueHandler: ScenarioContinueHandler | undefined

export function registerScenarioContinueHandler(handler: ScenarioContinueHandler) {
  scenarioContinueHandler = handler
  return () => {
    if (scenarioContinueHandler === handler) scenarioContinueHandler = undefined
  }
}

/** Used by todo pane / dialogs outside session to auto-send the next step prompt. */
export function requestScenarioContinue(directoryKey: string, input: { prompt: string; stepName: string }) {
  scenarioContinueHandler?.({ directoryKey, ...input })
}

/** After user fills missing params, retry the current step. */
export function resumeScenarioRunAfterParams(key: string): { prompt: string; stepName: string } | undefined {
  const run = runs.get(key)
  if (!run) return
  const step = run.steps[run.currentIndex]
  if (!step) return
  const steps = run.steps.map((entry, index) =>
    index === run.currentIndex ? { ...entry, status: "in_progress" as const } : entry,
  )
  const prompt = renderPromptForRun(run)
  runs.set(key, {
    ...run,
    steps,
    phase: "running",
    missingKeys: undefined,
    runtimeResourceIds: undefined,
    runtimeInstallQueue: undefined,
    stopReason: undefined,
    // Keep lastHandledAssistantID so the blocked reply is not re-handled as a new verdict.
  })
  touch()
  return { prompt, stepName: step.name }
}

/** Start installing missing runtimes; returns the first install follow-up prompt. */
export function beginScenarioRuntimeInstall(
  key: string,
  resourceIds: string[],
): { resourceId: string; prompt: string; label: string } | undefined {
  const run = runs.get(key)
  if (!run) return
  const queue = resourceIds.filter((id) => !!getCapabilityResource(id))
  if (queue.length === 0) return
  const first = queue[0]
  const prompt = buildScenarioRuntimeInstallPrompt(first)
  if (!prompt) return
  runs.set(key, {
    ...run,
    phase: "installing_runtime",
    runtimeResourceIds: queue,
    runtimeInstallQueue: queue,
    stopReason: `正在安装配置 ${runtimeLabel(first)}`,
    lastHandledAssistantID: undefined,
  })
  touch()
  return { resourceId: first, prompt, label: runtimeLabel(first) }
}
