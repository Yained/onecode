import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"

export type ScenarioDocument = {
  scenario_id: string
  type: string
  name: string
  model: string
  model_ids: string[]
  HPC?: string
  is_onemodel?: boolean
  is_oneHPC?: boolean
  /** Author text summary, or full structured brief from paper scenarios. */
  problem_and_applicability: string | Record<string, unknown>
  user_input: Array<{
    var: string
    hint?: string
    label?: string
    required?: boolean
    default?: unknown
    input_type?: string
  }>
  workflow: string[]
  workflow_steps?: Array<Record<string, unknown> & {
    step_input?: Array<{
      var: string
      hint?: string
      label?: string
      sub_name?: string
      required?: boolean
      default?: unknown
      input_type?: string
    }>
    input_variables?: string[]
  }>
  outputs: string
  ai_prompt?: Record<string, unknown>
  related_papers?: Array<Record<string, unknown>>
  system_auto_detection?: Record<string, unknown>
  workflow_definition?: string
  results_folder?: string
}

export const OneScienceScenarioTable = sqliteTable("onescience_scenario", {
  id: text().primaryKey(),
  scenario_id: text().notNull(),
  domain: text().notNull(),
  model: text().notNull(),
  model_ids: text({ mode: "json" }).notNull().$type<string[]>(),
  type: text().notNull(),
  name: text().notNull(),
  hpc: text(),
  problem: text().notNull(),
  document: text({ mode: "json" }).notNull().$type<ScenarioDocument>(),
  ...Timestamps,
  time_deleted: integer(),
})
