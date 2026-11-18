import { Database } from "@/storage/db"
import { and, desc, eq, isNull, like } from "drizzle-orm"
import { Schema } from "effect"
import { OneScienceScenarioTable, type ScenarioDocument } from "./scenario.sql"
import { formatScenarioModelLabel, resolveScenarioModelIds } from "./scenario-model-ids"
import seedFile from "./scenario-seed.json"

export const ScenarioDomain = Schema.Union([
  Schema.Literal("materials"),
  Schema.Literal("weather"),
  Schema.Literal("fluid"),
  Schema.Literal("bio"),
])
export type ScenarioDomain = typeof ScenarioDomain.Type

export const Scenario = Schema.Struct({
  id: Schema.String,
  scenario_id: Schema.String,
  domain: ScenarioDomain,
  model: Schema.String,
  model_ids: Schema.Array(Schema.String),
  type: Schema.String,
  name: Schema.String,
  HPC: Schema.optional(Schema.String),
  is_onemodel: Schema.optional(Schema.Boolean),
  is_oneHPC: Schema.optional(Schema.Boolean),
  problem_and_applicability: Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.Unknown)]),
  user_input: Schema.Unknown,
  workflow: Schema.Array(Schema.String),
  workflow_steps: Schema.optional(Schema.Unknown),
  outputs: Schema.String,
  ai_prompt: Schema.optional(Schema.Unknown),
  related_papers: Schema.optional(Schema.Unknown),
  system_auto_detection: Schema.optional(Schema.Unknown),
  workflow_definition: Schema.optional(Schema.String),
  results_folder: Schema.optional(Schema.String),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
}).annotate({ identifier: "OneScienceScenario" })
export type Scenario = typeof Scenario.Type

type AuthorSeedScenario = {
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
  user_input?: ScenarioDocument["user_input"]
  workflow?: string[] | Array<Record<string, unknown>>
  workflow_steps?: Array<Record<string, unknown>>
  workfolw?: Array<Record<string, unknown>>
  outputs?: string
  ai_prompt?: Record<string, unknown>
  related_papers?: Array<Record<string, unknown>>
  system_auto_detection?: Record<string, unknown>
  workflow_definition?: string
  results_folder?: string
}

const seedScenarios = (seedFile as { scenarios: AuthorSeedScenario[] }).scenarios

function mapSeedDomain(domain: string | undefined): ScenarioDomain {
  const value = domain?.trim().toLowerCase() ?? ""
  if (value === "matchem" || value === "material" || value === "materials chemistry" || value === "materials") return "materials"
  if (value === "meteorology" || value === "earth" || value === "earth-system" || value === "weather") return "weather"
  if (value === "biosciences" || value === "biology" || value === "life" || value === "bio") return "bio"
  if (value === "fluid" || value === "cfd" || value === "computational_fluid_dynamics") return "fluid"
  return "materials"
}

/** Flatten author PA (string or structured brief) for SQLite search / text columns. */
function problemSearchText(value: string | Record<string, unknown> | undefined) {
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

function isWorkflowStepArray(value: unknown): value is Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length === 0) return false
  const first = value[0]
  return typeof first === "object" && first != null && ("step_id" in first || "step_name" in first || "step_input" in first)
}

function normalizeHpcFields(item: AuthorSeedScenario) {
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

function normalizeSeedInput(input: Record<string, unknown>): ScenarioDocument["user_input"][number] {
  const label =
    typeof input.label === "string"
      ? input.label
      : typeof input.var_name === "string"
        ? input.var_name
        : typeof input.sub_name === "string"
          ? input.sub_name
          : typeof input.name === "string"
            ? input.name
            : undefined
  return {
    var: String(input.var ?? ""),
    ...(input.hint != null ? { hint: String(input.hint) } : {}),
    ...(label ? { label } : {}),
    ...(input.required != null ? { required: Boolean(input.required) } : {}),
    // Keep author JSON types (int/object/list); UI stringifies only for editing.
    ...(input.default !== undefined ? { default: input.default } : {}),
    ...(input.input_type != null ? { input_type: String(input.input_type) } : {}),
  }
}

function flattenUserInputFromSteps(steps: NonNullable<ScenarioDocument["workflow_steps"]>) {
  const seen = new Set<string>()
  const fields: ScenarioDocument["user_input"] = []
  for (const step of steps) {
    for (const input of step.step_input ?? []) {
      const key = String(input.var || "").replace(/^\{|\}$/g, "")
      if (!key || seen.has(key)) continue
      seen.add(key)
      fields.push(normalizeSeedInput(input as Record<string, unknown>))
    }
  }
  return fields
}

function normalizeWorkflowSteps(steps: Array<Record<string, unknown>> | undefined) {
  return (steps ?? []).map((step) => {
    const stepInput = ((step.step_input as Array<Record<string, unknown>> | undefined) ?? []).map((input) =>
      normalizeSeedInput(input),
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
    }
  })
}

function summarizeOutputs(steps: ReturnType<typeof normalizeWorkflowSteps>, fallback?: string) {
  if (fallback?.trim()) return fallback
  const seen: string[] = []
  for (const step of steps) {
    for (const item of (step.outputs as string[] | undefined) ?? []) {
      if (!seen.includes(item)) seen.push(item)
    }
  }
  return seen.slice(0, 20).join("；")
}

function resolveSeedIdentity(item: AuthorSeedScenario) {
  const scenarioId = String(item.scenario_id ?? item.schema_number ?? item.id ?? "").trim()
  const id = String(item.id ?? (scenarioId ? `seed-scenarios-${scenarioId}` : "")).trim()
  return { id, scenarioId }
}

/** Upsert scenario-seed.json into SQLite. Always sync — do not gate on empty table
 * (that left stale rows like V01 after seed updates).
 */
export function ensureSeededIfEmpty() {
  seedDefaults()
}

export function seedDefaults() {
  const now = Date.now()
  return Database.transaction((db) => {
    let seeded = 0
    let updated = 0
    let removed = 0
    const keepIds = new Set<string>()

    for (const [index, item] of seedScenarios.entries()) {
      const { id, scenarioId } = resolveSeedIdentity(item)
      if (!id || !scenarioId) continue
      keepIds.add(id)
      const existing = db
        .select({
          id: OneScienceScenarioTable.id,
          time_deleted: OneScienceScenarioTable.time_deleted,
        })
        .from(OneScienceScenarioTable)
        .where(eq(OneScienceScenarioTable.id, id))
        .get()
      if (existing?.time_deleted) continue

      const document = toDocument(item)
      const row = {
        id,
        scenario_id: document.scenario_id,
        domain: mapSeedDomain(item.domain),
        model: document.model,
        model_ids: [...document.model_ids],
        type: document.type,
        name: document.name,
        hpc: document.HPC?.trim() || null,
        problem: problemSearchText(document.problem_and_applicability),
        document,
        time_created: now - index,
        time_updated: now,
        time_deleted: null,
      }

      if (existing) {
        db.update(OneScienceScenarioTable)
          .set({
            scenario_id: row.scenario_id,
            domain: row.domain,
            model: row.model,
            model_ids: row.model_ids,
            type: row.type,
            name: row.name,
            hpc: row.hpc,
            problem: row.problem,
            document: row.document,
            time_updated: row.time_updated,
          })
          .where(eq(OneScienceScenarioTable.id, id))
          .run()
        updated++
        continue
      }

      db.insert(OneScienceScenarioTable).values(row).run()
      seeded++
    }

    // Drop obsolete bundled seeds (e.g. old V01) that are no longer in scenario-seed.json.
    const bundled = db
      .select({ id: OneScienceScenarioTable.id })
      .from(OneScienceScenarioTable)
      .where(and(like(OneScienceScenarioTable.id, "seed-scenarios-%"), isNull(OneScienceScenarioTable.time_deleted)))
      .all()
    for (const row of bundled) {
      if (keepIds.has(row.id)) continue
      db.update(OneScienceScenarioTable)
        .set({ time_deleted: now, time_updated: now })
        .where(eq(OneScienceScenarioTable.id, row.id))
        .run()
      removed++
    }

    return { seeded, updated, removed }
  })
}

export function get(id: string) {
  ensureSeededIfEmpty()
  return Database.use((db) => {
    const byId = db
      .select()
      .from(OneScienceScenarioTable)
      .where(and(eq(OneScienceScenarioTable.id, id), isNull(OneScienceScenarioTable.time_deleted)))
      .get()
    if (byId) return fromRow(byId)

    const byScenarioId = db
      .select()
      .from(OneScienceScenarioTable)
      .where(and(eq(OneScienceScenarioTable.scenario_id, id), isNull(OneScienceScenarioTable.time_deleted)))
      .get()
    if (!byScenarioId) throw new Database.NotFoundError({ message: `OneScience scenario not found: ${id}` })
    return fromRow(byScenarioId)
  })
}

export function list(input?: {
  domain?: string
  model?: string
  modelId?: string
  q?: string
  limit?: number
  offset?: number
}) {
  ensureSeededIfEmpty()
  const limit = Math.max(1, Math.min(input?.limit ?? 100, 500))
  const offset = Math.max(0, input?.offset ?? 0)
  const domain = input?.domain?.trim()
  const model = input?.model?.trim()
  const modelId = input?.modelId?.trim().toLowerCase()
  const query = input?.q?.trim().toLowerCase()

  return Database.use((db) => {
    const conditions = and(
      domain && domain !== "all" ? eq(OneScienceScenarioTable.domain, domain) : undefined,
      model ? eq(OneScienceScenarioTable.model, model) : undefined,
      isNull(OneScienceScenarioTable.time_deleted),
    )
    const order = [desc(OneScienceScenarioTable.time_created), desc(OneScienceScenarioTable.id)] as const
    let rows = db.select().from(OneScienceScenarioTable).where(conditions).orderBy(...order).all()

    if (modelId) {
      rows = rows.filter((row) => (row.model_ids ?? []).some((id) => id.toLowerCase() === modelId))
    }
    if (query) {
      rows = rows.filter((row) => matchesScenarioQuery(row, query))
    }

    const page = rows.slice(offset, offset + limit + 1)
    return {
      items: page.slice(0, limit).map(fromRow),
      nextOffset: page.length > limit ? offset + limit : undefined,
    }
  })
}

function matchesScenarioQuery(row: typeof OneScienceScenarioTable.$inferSelect, query: string) {
  if (row.name.toLowerCase().includes(query)) return true
  if (row.scenario_id.toLowerCase().includes(query)) return true
  if (row.model.toLowerCase().includes(query)) return true
  if (row.type.toLowerCase().includes(query)) return true
  if (row.problem.toLowerCase().includes(query)) return true
  if (row.hpc?.toLowerCase().includes(query)) return true
  if (row.id.toLowerCase().includes(query)) return true
  return (row.model_ids ?? []).some((id) => id.toLowerCase().includes(query))
}

function deriveModelIds(item: AuthorSeedScenario) {
  return resolveScenarioModelIds({
    model: item.model ?? [],
    is_onemodel: item.is_onemodel ?? [],
    model_ids: item.model_ids,
    name: item.name,
  })
}

function toDocument(item: AuthorSeedScenario): ScenarioDocument {
  const { scenarioId } = resolveSeedIdentity(item)
  const workflowSteps = normalizeWorkflowSteps(
    item.workfolw ?? item.workflow_steps ?? (isWorkflowStepArray(item.workflow) ? item.workflow : undefined),
  )
  const userInput =
    item.user_input?.length
      ? item.user_input.map((input) => normalizeSeedInput(input as Record<string, unknown>))
      : flattenUserInputFromSteps(workflowSteps)
  const model = formatScenarioModelLabel(item.model ?? [])
  const modelIds = deriveModelIds(item)
  const hpcFields = normalizeHpcFields(item)
  const isOnemodel = (item.is_onemodel ?? []).some(Boolean)
  const workflowNames =
    Array.isArray(item.workflow) && item.workflow.every((entry) => typeof entry === "string")
      ? (item.workflow as string[])
      : workflowSteps.map((step) => String(step.name ?? ""))
  return {
    scenario_id: scenarioId,
    type: item.type,
    name: item.name,
    model,
    model_ids: [...modelIds],
    ...hpcFields,
    ...(item.is_onemodel ? { is_onemodel: isOnemodel } : {}),
    problem_and_applicability: item.problem_and_applicability,
    user_input: userInput,
    workflow: workflowNames,
    ...(workflowSteps.length ? { workflow_steps: workflowSteps } : {}),
    outputs: summarizeOutputs(workflowSteps, item.outputs),
    ...(item.ai_prompt ? { ai_prompt: item.ai_prompt } : {}),
    ...(item.related_papers ? { related_papers: item.related_papers } : {}),
    ...(item.system_auto_detection ? { system_auto_detection: item.system_auto_detection } : {}),
    ...(item.workflow_definition ? { workflow_definition: item.workflow_definition } : {}),
    ...(item.results_folder ? { results_folder: item.results_folder } : {}),
  }
}

function fromRow(row: typeof OneScienceScenarioTable.$inferSelect): Scenario {
  const document = toDocument({
    scenario_id: row.document.scenario_id,
    type: row.document.type,
    name: row.document.name,
    model: [],
    is_onemodel: row.document.is_onemodel != null ? [Boolean(row.document.is_onemodel)] : [],
    model_ids: row.document.model_ids?.length ? row.document.model_ids : row.model_ids,
    HPC: row.document.HPC ?? row.hpc ?? undefined,
    problem_and_applicability: row.document.problem_and_applicability,
    user_input: row.document.user_input,
    workflow: row.document.workflow,
    workflow_steps: row.document.workflow_steps as Array<Record<string, unknown>> | undefined,
    outputs: row.document.outputs,
    ai_prompt: row.document.ai_prompt,
    related_papers: row.document.related_papers,
    system_auto_detection: row.document.system_auto_detection,
    workflow_definition: row.document.workflow_definition,
    results_folder: row.document.results_folder,
    id: row.id,
    domain: row.domain,
  })
  return {
    id: row.id,
    scenario_id: document.scenario_id,
    domain: row.domain as ScenarioDomain,
    model: row.document.model,
    model_ids: document.model_ids,
    type: document.type,
    name: document.name,
    ...(document.HPC ? { HPC: document.HPC } : {}),
    ...(row.document.is_onemodel != null ? { is_onemodel: row.document.is_onemodel } : {}),
    ...(document.is_oneHPC != null ? { is_oneHPC: document.is_oneHPC } : {}),
    problem_and_applicability: document.problem_and_applicability,
    user_input: document.user_input,
    workflow: document.workflow,
    ...(document.workflow_steps ? { workflow_steps: document.workflow_steps } : {}),
    outputs: document.outputs,
    ...(document.ai_prompt ? { ai_prompt: document.ai_prompt } : {}),
    ...(document.related_papers ? { related_papers: document.related_papers } : {}),
    ...(document.system_auto_detection ? { system_auto_detection: document.system_auto_detection } : {}),
    ...(document.workflow_definition ? { workflow_definition: document.workflow_definition } : {}),
    ...(document.results_folder ? { results_folder: document.results_folder } : {}),
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

export * as OneScienceScenario from "./scenario"
