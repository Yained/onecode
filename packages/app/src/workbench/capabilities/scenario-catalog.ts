import seedFile from "../../../../opencode/src/onescience/scenario-seed.json"
import { fuzzyMatchText } from "@/utils/fuzzy-match"
import { formatScenarioModelLabel, resolveScenarioModelIds } from "./scenario-model-ids"
import type { CapabilityDomain } from "./catalog"

export type ScenarioUserInput = {
  var: string
  hint?: string
  label?: string
  required?: boolean
  /** Seed may keep native JSON types (int/float/object/list); forms stringify for editing. */
  default?: unknown
  input_type?: string
}

export type ScenarioPaper = {
  paper_id: string
  title: string
  url: string
  relation?: string
}

export type ScenarioWorkflowStep = {
  step_id: string
  name: string
  purpose?: string
  depend_step_id?: string[]
  input_variables?: string[]
  /** Per-step fields authored in seed; preferred over filtering global user_input. */
  step_input?: ScenarioUserInput[]
  prompt?: string
  outputs?: string[]
  quality_gate?: string
  status?: string
  source_artifacts?: string[]
  result_subfolder?: string
}

export type ScenarioAutoDetectionField = {
  key: string
  name: string
  detection: string
}

export type UserScenario = {
  /** Unique catalog row / seed id; prefer this over scenario_id when looking up. */
  id?: string
  scenario_id: string
  type: string
  name: string
  model: string
  model_ids?: string[]
  domain?: CapabilityDomain
  HPC?: string
  is_onemodel?: boolean
  is_oneHPC?: boolean
  problem_and_applicability: string | Record<string, unknown>
  user_input: ScenarioUserInput[]
  workflow: string[]
  workflow_steps?: ScenarioWorkflowStep[]
  outputs: string
  ai_prompt?: {
    template?: string
    input_binding?: string
    output_contract?: string[]
  }
  related_papers?: ScenarioPaper[]
  system_auto_detection?: {
    fields?: ScenarioAutoDetectionField[]
    failure_policy?: string
  }
  workflow_definition?: string
  results_folder?: string
}

export type ScenarioCatalog = {
  domain: CapabilityDomain
  model: string
  scenarios: UserScenario[]
}

type SeedScenario = {
  id?: string
  schema_number?: string
  scenario_id?: string
  domain?: string
  model_ids?: string[]
  type: string
  name: string
  model: string[]
  HPC?: string
  hpc?: string | string[]
  is_onemodel: boolean[]
  is_oneHPC?: boolean
  is_one_hpc?: boolean | boolean[]
  problem_and_applicability: string | Record<string, unknown>
  user_input?: ScenarioUserInput[]
  workflow?: string[] | Array<Record<string, unknown>>
  workflow_steps?: Array<Record<string, unknown>>
  workfolw?: Array<Record<string, unknown>>
  outputs?: string
  ai_prompt?: UserScenario["ai_prompt"]
  related_papers?: ScenarioPaper[]
  system_auto_detection?: UserScenario["system_auto_detection"]
  workflow_definition?: string
  results_folder?: string
}

function mapSeedDomain(domain: string | undefined): CapabilityDomain {
  const value = domain?.trim().toLowerCase() ?? ""
  if (value === "matchem" || value === "material" || value === "materials chemistry" || value === "materials") return "materials"
  if (value === "meteorology" || value === "earth" || value === "earth-system" || value === "weather") return "weather"
  if (value === "biosciences" || value === "biology" || value === "life" || value === "bio") return "bio"
  if (value === "fluid" || value === "cfd" || value === "computational_fluid_dynamics") return "fluid"
  return "materials"
}

function isWorkflowStepArray(value: unknown): value is Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length === 0) return false
  const first = value[0]
  return typeof first === "object" && first != null && ("step_id" in first || "step_name" in first || "step_input" in first)
}

function normalizeHpcFields(item: SeedScenario) {
  const hpcRaw = item.hpc ?? item.HPC
  const HPC = Array.isArray(hpcRaw)
    ? hpcRaw.map(String).map((part) => part.trim()).filter(Boolean).join(", ")
    : typeof hpcRaw === "string"
      ? hpcRaw.trim()
      : ""
  const oneRaw = item.is_one_hpc ?? item.is_oneHPC
  const is_oneHPC = Array.isArray(oneRaw) ? oneRaw.some(Boolean) : oneRaw != null ? Boolean(oneRaw) : undefined
  return {
    ...(HPC ? { HPC } : {}),
    ...(is_oneHPC != null ? { is_oneHPC } : {}),
  }
}

function normalizeQualityGate(value: unknown) {
  if (typeof value === "string") {
    const text = value.trim()
    return text || undefined
  }
  if (!Array.isArray(value)) return undefined
  const parts = value.map(String).map((part) => part.trim()).filter(Boolean)
  return parts.length ? parts.join("；") : undefined
}

export function formatScenarioFieldDefault(value: unknown) {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") return String(value)
  return JSON.stringify(value, null, 2)
}

function normalizeStepInput(input: ScenarioUserInput | Record<string, unknown>): ScenarioUserInput {
  const raw = input as Record<string, unknown>
  const label =
    typeof raw.label === "string"
      ? raw.label
      : typeof raw.var_name === "string"
        ? raw.var_name
        : typeof raw.sub_name === "string"
          ? raw.sub_name
          : typeof raw.name === "string"
            ? raw.name
            : undefined
  return {
    var: String(raw.var ?? ""),
    ...(raw.hint != null ? { hint: String(raw.hint) } : {}),
    ...(label ? { label } : {}),
    ...(raw.required != null ? { required: Boolean(raw.required) } : {}),
    ...(raw.default !== undefined ? { default: raw.default } : {}),
    ...(raw.input_type != null ? { input_type: String(raw.input_type) } : {}),
  }
}

function collectUserInputFromSteps(steps: ScenarioWorkflowStep[]) {
  const seen = new Set<string>()
  const fields: ScenarioUserInput[] = []
  for (const step of steps) {
    for (const input of step.step_input ?? []) {
      const key = String(input.var || "").replace(/^\{|\}$/g, "")
      if (!key || seen.has(key)) continue
      seen.add(key)
      fields.push(input)
    }
  }
  return fields
}

function normalizeWorkflowSteps(steps: Array<Record<string, unknown>> | undefined) {
  return (steps ?? []).map((step) => {
    const stepInput = ((step.step_input as Array<Record<string, unknown>> | undefined) ?? []).map((input) =>
      normalizeStepInput(input),
    )
    const inputVariables = Array.isArray(step.input_variables)
      ? step.input_variables.map(String)
      : stepInput.map((input) => input.var).filter(Boolean)
    const name = String(step.name ?? step.step_name ?? step.step_id ?? "")
    const purpose =
      typeof step.purpose === "string"
        ? step.purpose
        : typeof step.step_desc === "string"
          ? step.step_desc
          : typeof step.step_sub === "string"
            ? step.step_sub
            : undefined
    const qualityGate = normalizeQualityGate(step.quality_gate)
    const dependStepId = Array.isArray(step.depend_step_id) ? step.depend_step_id.map(String) : undefined
    return {
      step_id: String(step.step_id ?? ""),
      name,
      ...(purpose ? { purpose } : {}),
      ...(dependStepId?.length ? { depend_step_id: dependStepId } : {}),
      ...(inputVariables.length ? { input_variables: inputVariables } : {}),
      ...(stepInput.length ? { step_input: stepInput } : {}),
      ...(typeof step.prompt === "string" ? { prompt: step.prompt } : {}),
      ...(Array.isArray(step.outputs) ? { outputs: step.outputs.map(String) } : {}),
      ...(qualityGate ? { quality_gate: qualityGate } : {}),
      ...(typeof step.status === "string" ? { status: step.status } : {}),
      ...(Array.isArray(step.source_artifacts) ? { source_artifacts: step.source_artifacts.map(String) } : {}),
      ...(typeof step.result_subfolder === "string" ? { result_subfolder: step.result_subfolder } : {}),
    } satisfies ScenarioWorkflowStep
  })
}

function summarizeOutputs(steps: ScenarioWorkflowStep[], fallback?: string) {
  if (fallback?.trim()) return fallback
  const seen: string[] = []
  for (const step of steps) {
    for (const item of step.outputs ?? []) {
      if (!seen.includes(item)) seen.push(item)
    }
  }
  return seen.slice(0, 20).join("；")
}

function deriveModelIds(item: SeedScenario) {
  return resolveScenarioModelIds({
    model: item.model ?? [],
    is_onemodel: item.is_onemodel ?? [],
    model_ids: item.model_ids,
    name: item.name,
  })
}

function normalizeRelatedPapers(papers: ScenarioPaper[] | Array<Record<string, unknown>> | undefined) {
  return (papers ?? [])
    .map((paper) => {
      const raw = paper as Record<string, unknown>
      const url = String(raw.url ?? "").trim()
      if (!url) return undefined
      const title = String(raw.title ?? "").trim() || String(raw.paper_id ?? "").trim() || url
      return {
        paper_id: String(raw.paper_id ?? "").trim() || title,
        title,
        url,
        ...(typeof raw.relation === "string" && raw.relation.trim() ? { relation: raw.relation.trim() } : {}),
      } satisfies ScenarioPaper
    })
    .filter((paper): paper is ScenarioPaper => paper != null)
}

function normalizeSeedScenario(item: SeedScenario): UserScenario {
  const rawSteps = item.workfolw ?? item.workflow_steps ?? (isWorkflowStepArray(item.workflow) ? item.workflow : undefined)
  const workflowSteps = normalizeWorkflowSteps(rawSteps)
  const userInput =
    item.user_input?.length
      ? item.user_input.map((input) => normalizeStepInput(input))
      : collectUserInputFromSteps(workflowSteps)
  const scenarioId = String(item.scenario_id ?? item.schema_number ?? item.id ?? "").trim()
  const model = formatScenarioModelLabel(item.model ?? [])
  const isOnemodel = (item.is_onemodel ?? []).some(Boolean)
  const hpcFields = normalizeHpcFields(item)
  const workflowNames =
    Array.isArray(item.workflow) && item.workflow.every((entry) => typeof entry === "string")
      ? (item.workflow as string[])
      : workflowSteps.map((step) => step.name)
  const relatedPapers = normalizeRelatedPapers(item.related_papers)
  const uniqueId = String(item.id ?? "").trim()
  return {
    ...(uniqueId ? { id: uniqueId } : {}),
    scenario_id: scenarioId,
    type: item.type,
    name: item.name,
    model,
    model_ids: deriveModelIds(item),
    domain: mapSeedDomain(item.domain),
    ...hpcFields,
    ...(item.is_onemodel ? { is_onemodel: isOnemodel } : {}),
    problem_and_applicability: item.problem_and_applicability,
    user_input: userInput,
    workflow: workflowNames,
    ...(workflowSteps.length ? { workflow_steps: workflowSteps } : {}),
    outputs: summarizeOutputs(workflowSteps, item.outputs),
    ...(item.ai_prompt ? { ai_prompt: item.ai_prompt } : {}),
    ...(relatedPapers.length ? { related_papers: relatedPapers } : {}),
    ...(item.system_auto_detection ? { system_auto_detection: item.system_auto_detection } : {}),
    ...(item.workflow_definition ? { workflow_definition: item.workflow_definition } : {}),
    ...(item.results_folder ? { results_folder: item.results_folder } : {}),
  }
}

const FIELD_LABELS: Record<string, string> = {
  SYSTEM_DESCRIPTION: "体系描述",
  INITIAL_POSCAR: "初始 POSCAR",
  FIXED_CU_COUNT: "固定 Cu 数量",
  DFT_FUNCTIONAL: "DFT 泛函",
  DFT_DISPERSION: "色散修正",
  ENCUT: "截断能 ENCUT",
  KPOINTS_GRID: "K 点网格",
  DFT_EDIFFG: "力收敛阈值",
  AIMD_TEMPERATURE: "AIMD 温度",
  AIMD_TIMESTEP_FS: "AIMD 时间步",
  AIMD_STEPS: "AIMD 总步数",
  TARGET_MU: "目标电子化学势",
  AIMD_ENSEMBLE: "AIMD 系综",
  AIMD_RAW_DIR: "AIMD 原始目录",
  DATASET_SOURCE: "数据集来源",
  TRAIN_VALID_TEST_SPLIT: "训练划分",
  MACE_CONFIG: "MACE 配置",
  MACE_EPOCHS: "训练 Epochs",
  MACE_MODEL: "MACE 模型路径",
  TEST_DATASET: "测试集路径",
  MD_STRUCTURE: "MD 初始结构",
  MD_ENGINE: "MD 引擎",
  MD_SUPERCELL: "扩胞倍数",
  MD_TIMESTEP_FS: "MD 时间步",
  MD_TEMPERATURE: "MD 温度",
  MD_STEPS: "MD 测试步数",
  FIXED_IDS: "固定原子 ID",
  ELEMENT_ORDER: "元素顺序",
  MD_PROPERTIES: "统计性质",
  PRODUCTION_TIME_PS: "生产 MD 时长",
  RESTART_POLICY: "续跑策略",
  CONDA_ENV: "Conda 环境",
  CHECKPOINT: "模型权重",
  DEVICE: "计算设备",
  DTYPE: "数据类型",
  TEST_STRUCTURE: "测试结构",
  STRUCTURE: "输入结构",
  HEAD: "模型 Head",
  UNITS: "物理单位",
  FORCE_THRESHOLD: "异常力阈值",
  ATOMS_OR_CELL: "优化对象",
  CONSTRAINTS: "约束条件",
  OPTIMIZER: "优化器",
  FMAX: "力收敛阈值",
  MAX_STEPS: "最大步数",
}

const MULTILINE_FIELD = /STRUCTURE|CHECKPOINT|CONSTRAINTS|TEST_STRUCTURE|POSCAR|DIR|DATASET|MODEL|CONFIG|FIXED_IDS|RAW|SOURCE|POLICY|MAPPING|FILTERS|SPEC|CRITERIA|PROPERTIES/i

export const UPLOAD_FILTER_VALUE = "__upload__"

export const datasetFilterOptions = [
  { id: "aimd", label: "AIMD 轨迹" },
  { id: "era5", label: "ERA5" },
] as const

/** In-memory catalog; seeded from scenario-seed.json, replaced when SQLite API hydrate succeeds. */
let scenarioRows: UserScenario[] = ((seedFile as { scenarios: SeedScenario[] }).scenarios ?? []).map(normalizeSeedScenario)

function catalogsFromRows(rows: UserScenario[]): ScenarioCatalog[] {
  const byDomain = new Map<CapabilityDomain, UserScenario[]>()
  for (const scenario of rows) {
    const domain = scenario.domain ?? "materials"
    const list = byDomain.get(domain) ?? []
    list.push(scenario)
    byDomain.set(domain, list)
  }
  return [...byDomain.entries()].map(([domain, scenarios]) => ({
    domain,
    model: scenarios[0]?.model ?? "",
    scenarios,
  }))
}

export function hydrateScenarioCatalog(rows: UserScenario[]) {
  if (!rows.length) return
  // API rows are already normalized (model is display string, model_ids resolved).
  scenarioRows = rows.map((row) => ({
    ...row,
    domain: row.domain ?? "materials",
    model_ids: row.model_ids ?? [],
  }))
}

export function listScenarioCatalogs() {
  return catalogsFromRows(scenarioRows)
}

/** Display / search text from author PA (plain string or structured brief). */
export function scenarioProblemText(value: UserScenario["problem_and_applicability"] | undefined) {
  if (typeof value === "string") return value.trim()
  if (!value || typeof value !== "object") return ""
  const clientRequest = value.client_request
  if (clientRequest && typeof clientRequest === "object") {
    for (const key of ["scientific_context", "request", "desired_outcome", "task_title"] as const) {
      const text = (clientRequest as Record<string, unknown>)[key]
      if (typeof text === "string" && text.trim()) return text.trim()
    }
  }
  for (const key of ["field_purpose", "agent_task_prompt"] as const) {
    const text = value[key]
    if (typeof text === "string" && text.trim()) return text.trim()
  }
  return JSON.stringify(value)
}

export function scenarioFieldKey(input: ScenarioUserInput) {
  return String(input.var || "").replace(/^\{|\}$/g, "")
}

export function scenarioFieldLabel(input: ScenarioUserInput) {
  const key = scenarioFieldKey(input)
  return input.label || FIELD_LABELS[key] || input.hint || key.replaceAll("_", " ")
}

export function scenarioFieldTypeHint(input: ScenarioUserInput) {
  return scenarioFieldTypeLabel(input)
}

/** Human-readable type for placeholders / hints. Empty when the type adds little UX value. */
export function scenarioFieldTypeLabel(input: ScenarioUserInput) {
  const type = String(input.input_type || "")
    .trim()
    .toLowerCase()
  if (!type || type === "str" || type === "text") return ""
  if (type === "doc" || type === "path") return "文件路径"
  if (type === "int" || type === "integer") return "整数"
  if (type === "float" || type === "number" || type === "double") return "数字"
  if (type === "bool" || type === "boolean") return "是/否"
  if (type === "object") return "JSON 对象"
  if (type === "enum") return "可选值之一"
  if (type === "list") return "列表"
  if (type === "list[str]" || type === "list[string]") return "字符串列表"
  if (type === "list[int]" || type === "list[integer]") return "整数列表"
  if (type === "list[float]" || type === "list[number]") return "数字列表"
  if (type.startsWith("list[")) return "列表"
  return type
}

export function scenarioFieldPlaceholder(input: ScenarioUserInput) {
  const type = scenarioFieldTypeLabel(input)
  const typeSuffix = type ? `（${type}）` : ""
  if (input.hint && (input.label || FIELD_LABELS[scenarioFieldKey(input)])) return `${input.hint}${typeSuffix}`
  if (input.hint) return `例如：${input.hint}${typeSuffix}`
  return `填写${scenarioFieldLabel(input)}${typeSuffix}`
}

export function scenarioFieldMultiline(input: ScenarioUserInput) {
  const type = String(input.input_type || "").toLowerCase()
  if (type === "object" || type.startsWith("list")) return true
  return MULTILINE_FIELD.test(scenarioFieldKey(input))
}

export function scenarioFieldRequired(input: ScenarioUserInput) {
  return input.required === true
}

export function emptyScenarioValues(scenario: UserScenario) {
  return Object.fromEntries(
    scenario.user_input.map((input) => {
      const text = formatScenarioFieldDefault(input.default)
      return [scenarioFieldKey(input), text.trim() ? text : ""]
    }),
  )
}

export function scenarioFieldTypeError(input: ScenarioUserInput, raw: string) {
  const value = String(raw ?? "").trim()
  if (!value) return
  const type = String(input.input_type || "str").toLowerCase()
  if (type === "str" || type === "doc" || type === "path" || type === "text") return
  if (type === "int" || type === "integer") {
    if (!/^[-+]?\d+$/.test(value)) return "请输入整数"
    return
  }
  if (type === "float" || type === "number" || type === "double") {
    if (!Number.isFinite(Number(value)) || !/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(value)) {
      return "请输入数字"
    }
    return
  }
  if (type === "bool" || type === "boolean") {
    if (!/^(true|false|0|1)$/i.test(value)) return "请输入 true / false"
    return
  }
  if (type === "object") {
    try {
      const parsed = JSON.parse(value) as unknown
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "请输入 JSON 对象，例如 {\"key\": 1}"
      return
    } catch {
      return "JSON 对象格式不正确"
    }
  }
  if (type === "list" || type.startsWith("list")) {
    try {
      const parsed = JSON.parse(value) as unknown
      if (!Array.isArray(parsed)) return "请输入 JSON 数组，例如 [\"a\", \"b\"]"
      if (type === "list[int]" || type === "list[integer]") {
        if (!parsed.every((item) => typeof item === "number" && Number.isInteger(item))) {
          return "请输入整数数组，例如 [1, 2, 3]"
        }
      }
      if (type === "list[str]" || type === "list[string]") {
        if (!parsed.every((item) => typeof item === "string")) {
          return "请输入字符串数组，例如 [\"a\", \"b\"]"
        }
      }
      if (type === "list[float]" || type === "list[number]") {
        if (!parsed.every((item) => typeof item === "number" && Number.isFinite(item))) {
          return "请输入数字数组，例如 [1.0, 2.5]"
        }
      }
      return
    } catch {
      return "JSON 数组格式不正确"
    }
  }
}

export function scenarioFieldIssue(input: ScenarioUserInput, raw: string) {
  const value = String(raw ?? "").trim()
  if (!value) {
    if (scenarioFieldRequired(input)) return "必填"
    return
  }
  return scenarioFieldTypeError(input, value)
}

export function missingRequiredScenarioFields(scenario: UserScenario, values: Record<string, string>) {
  return scenario.user_input.filter((input) => {
    if (!scenarioFieldRequired(input)) return false
    return !String(values[scenarioFieldKey(input)] ?? "").trim()
  })
}

export function invalidTypedScenarioFields(fields: ScenarioUserInput[], values: Record<string, string>) {
  return fields.filter((input) => Boolean(scenarioFieldTypeError(input, values[scenarioFieldKey(input)] ?? "")))
}

/** Best-effort client coerce; leaves ambiguous values for the agent. */
export function normalizeScenarioFieldValue(input: ScenarioUserInput, raw: string) {
  const value = String(raw ?? "").trim()
  if (!value) return ""
  const type = String(input.input_type || "str").toLowerCase()
  if (type === "int" || type === "integer") {
    if (/^[-+]?\d+$/.test(value)) return value
    if (/^[-+]?\d+\.0+$/.test(value)) return String(Math.trunc(Number(value)))
    const n = Number(value)
    if (Number.isFinite(n) && Number.isInteger(n)) return String(n)
    return value
  }
  if (type === "float" || type === "number" || type === "double") {
    const cleaned = value.replace(/,/g, "")
    if (Number.isFinite(Number(cleaned)) && /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(cleaned)) {
      return cleaned
    }
    return value
  }
  if (type === "bool" || type === "boolean") {
    if (/^(true|1|yes|y|是|对)$/i.test(value)) return "true"
    if (/^(false|0|no|n|否|错)$/i.test(value)) return "false"
    return value
  }
  return value
}

export function normalizeScenarioValues(fields: ScenarioUserInput[], values: Record<string, string>) {
  const next = { ...values }
  for (const field of fields) {
    const key = scenarioFieldKey(field)
    next[key] = normalizeScenarioFieldValue(field, values[key] ?? "")
  }
  return next
}

export function buildScenarioParamNormalizeHint(fields: ScenarioUserInput[], values: Record<string, string>) {
  if (fields.length === 0) return ""
  const missing = fields.filter((field) => {
    if (!scenarioFieldRequired(field)) return false
    return !String(values[scenarioFieldKey(field)] ?? "").trim()
  })
  const dubious = fields.filter((field) => {
    const raw = String(values[scenarioFieldKey(field)] ?? "").trim()
    return Boolean(raw && scenarioFieldTypeError(field, raw))
  })
  const lines = [
    "",
    "【参数规范化】请按字段 input_type 自行静默修正用户参数后继续；无法可靠推断时用 `{KEY}: MISSING` 标明并结论 BLOCKED。",
  ]
  if (missing.length > 0) {
    lines.push(
      "以下必填参数尚未提供：请先向用户追问并确认真实取值后再执行，禁止编造路径、配置或业务数值。",
      ...missing.map((field) => {
        const key = scenarioFieldKey(field)
        const type = scenarioFieldTypeHint(field) || "str"
        const label = scenarioFieldLabel(field)
        return `- {${key}} ${label} input_type=${type} status=MISSING`
      }),
    )
  }
  if (dubious.length === 0) return lines.join("\n")
  return [
    ...lines,
    "待核对字段：",
    ...dubious.map((field) => {
      const key = scenarioFieldKey(field)
      const type = scenarioFieldTypeHint(field) || "str"
      const raw = String(values[key] ?? "").trim()
      return `- {${key}} input_type=${type} value=${JSON.stringify(raw)}`
    }),
  ].join("\n")
}

export function renderScenarioPrompt(template: string, values: Record<string, string>) {
  return String(template || "").replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key]
    return value?.trim() ? value.trim() : `{${key}}`
  })
}

export function scenarioHpcTokens(scenario: UserScenario) {
  return String(scenario.HPC || "")
    .split(/[、,，/|]+/)
    .map((token) => token.trim())
    .filter(Boolean)
}

export function matchesScenarioHpc(scenario: UserScenario, selected: string) {
  if (!selected.trim()) return true
  const needle = selected.trim().toLowerCase()
  return scenarioHpcTokens(scenario).some((token) => {
    const value = token.toLowerCase()
    return value === needle || value.includes(needle) || needle.includes(value)
  })
}

export function scenarioWorkflowSteps(scenario: UserScenario): ScenarioWorkflowStep[] {
  if (scenario.workflow_steps?.length) return scenario.workflow_steps
  return scenario.workflow.map((name, index) => ({
    step_id: `W${index + 1}`,
    name,
  }))
}

export function scenarioWorkflowNames(scenario: UserScenario) {
  return scenarioWorkflowSteps(scenario).map((step) => step.name)
}

export function scenarioFieldsForStep(scenario: UserScenario, step: ScenarioWorkflowStep) {
  if (step.step_input?.length) return step.step_input
  const keys = new Set(
    (step.input_variables ?? []).map((item) => String(item).replace(/^\{|\}$/g, "")),
  )
  if (keys.size === 0) return scenario.user_input
  return scenario.user_input.filter((input) => keys.has(scenarioFieldKey(input)))
}

export function domainScenarios(domain?: CapabilityDomain | "all") {
  if (!domain || domain === "all") return scenarioRows
  return scenarioRows.filter((scenario) => (scenario.domain ?? "materials") === domain)
}

export function searchDomainScenarios(domain: CapabilityDomain | "all" | undefined, query: string) {
  const list = domainScenarios(domain)
  const needle = query.trim()
  if (!needle) return list
  return list.filter((scenario) => {
    const haystack = [
      scenario.name,
      scenario.scenario_id,
      scenarioProblemText(scenario.problem_and_applicability),
      scenario.model,
      scenario.type,
      scenario.HPC ?? "",
      ...(scenario.model_ids ?? []),
    ].join(" ")
    return fuzzyMatchText(haystack, needle)
  })
}

/** Match scenarios onto a capability card left rail.
 * - onemodel: non-empty model_ids intersecting the resource id/name
 * - hpc: scenario HPC tokens intersecting the resource id/name
 * Empty model_ids / HPC → scenario library only for that axis.
 */
export function userScenariosForResource(input: {
  domain: CapabilityDomain
  name: string
  id: string
  category?: "onemodel" | "hpc"
}) {
  const aliases = new Set(
    [input.name, input.id]
      .flatMap((value) => {
        const text = value.trim().toLowerCase()
        if (!text) return []
        return [text, text.replace(/[^a-z0-9]+/g, "")]
      })
      .filter(Boolean),
  )
  return domainScenarios(input.domain).filter((scenario) => {
    const modelIds = (scenario.model_ids ?? []).map((id) => id.trim().toLowerCase()).filter(Boolean)
    const modelMatch =
      modelIds.length > 0 &&
      modelIds.some((id) => {
        const compact = id.replace(/[^a-z0-9]+/g, "")
        return aliases.has(id) || (compact.length > 0 && aliases.has(compact))
      })
    const hpcTokens = scenarioHpcTokens(scenario)
    const hpcMatch =
      hpcTokens.length > 0 &&
      hpcTokens.some((token) => {
        const value = token.toLowerCase()
        return [...aliases].some((alias) => value === alias || value.includes(alias) || alias.includes(value))
      })

    if (input.category === "hpc") return hpcMatch
    if (input.category === "onemodel") return modelMatch
    return modelMatch || hpcMatch
  })
}

/** @deprecated Prefer searchDomainScenarios; kept for older filter-combo call sites. */
export function visibleScenarios(input: {
  domain: CapabilityDomain
  model: string
  hpc: string
  dataset: string
  privateModelIds: Set<string>
}) {
  if (!input.model && !input.hpc && !input.dataset) return []
  if (input.model && input.privateModelIds.has(input.model)) return []
  if (input.dataset) return []

  return domainScenarios(input.domain).filter((scenario) => {
    if (input.model && scenario.model !== input.model) return false
    if (input.hpc && !matchesScenarioHpc(scenario, input.hpc)) return false
    return true
  })
}

/** Stable key for selecting/opening a scenario when scenario_id may collide across domains. */
export function scenarioLookupKey(scenario: Pick<UserScenario, "id" | "scenario_id">) {
  return String(scenario.id || scenario.scenario_id || "").trim()
}

export function getUserScenario(idOrScenarioId: string) {
  const key = idOrScenarioId.trim()
  if (!key) return undefined
  return (
    scenarioRows.find((entry) => entry.id === key) ??
    scenarioRows.find((entry) => entry.scenario_id === key)
  )
}

export function catalogHpcNames(domain?: CapabilityDomain) {
  const names = new Set<string>()
  for (const scenario of domainScenarios(domain)) {
    for (const token of scenarioHpcTokens(scenario)) names.add(token)
  }
  return [...names]
}

export function domainLabel(domain: CapabilityDomain | "all") {
  switch (domain) {
    case "all":
      return "全部"
    case "materials":
      return "材料"
    case "weather":
      return "气象"
    case "fluid":
      return "流体"
    case "bio":
      return "生信"
  }
}

export function domainUploadLabel(domain: CapabilityDomain) {
  switch (domain) {
    case "materials":
      return "材料化学"
    case "weather":
      return "地球科学"
    case "fluid":
      return "流体仿真"
    case "bio":
      return "生命科学"
  }
}

export function catalogModelForDomain(domain: CapabilityDomain) {
  return listScenarioCatalogs().find((entry) => entry.domain === domain)?.model
}
