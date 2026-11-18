import { Timestamps } from "@/storage/schema.sql"
import { integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { OneScienceResourceTable } from "./resource.sql"

export const OneScienceDataProjectTable = sqliteTable(
  "onescience_data_project",
  {
    id: text().primaryKey(),
    slug: text().notNull().unique(),
    title: text().notNull(),
    description: text().notNull(),
    domain: text().notNull(),
    status: text().notNull(),
    raw_data_uri: text().notNull(),
    raw_data_format: text().notNull(),
    raw_data_license: text(),
    raw_data_metadata_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
    target_dataset_name: text().notNull(),
    target_dataset_goal: text().notNull(),
    target_task_type: text().notNull(),
    owner: text(),
    public_id: text(),
    workspace_id: text().notNull().default(""),
    connector: text().notNull().default("local_fs"),
    ingest_method: text().notNull().default("onescience"),
    lineage_public_id: text(),
    ...Timestamps,
    time_deleted: integer(),
  },
  (table) => [uniqueIndex("onescience_data_project_public_id_unique").on(table.public_id)],
)

export const OneScienceDataAgentRunTable = sqliteTable("onescience_data_agent_run", {
  id: text().primaryKey(),
  project_id: text().notNull().references(() => OneScienceDataProjectTable.id, { onDelete: "cascade" }),
  run_type: text().notNull(),
  status: text().notNull(),
  input_json: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
  plan_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
  result_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
  error_message: text(),
  session_id: text(),
  time_started: integer().notNull(),
  time_completed: integer(),
  ...Timestamps,
  time_deleted: integer(),
})

export const OneScienceDataArtifactTable = sqliteTable(
  "onescience_data_artifact",
  {
    id: text().primaryKey(),
    project_id: text().notNull().references(() => OneScienceDataProjectTable.id, { onDelete: "cascade" }),
    run_id: text().references(() => OneScienceDataAgentRunTable.id, { onDelete: "set null" }),
    artifact_type: text().notNull(),
    title: text().notNull(),
    uri: text(),
    format: text().notNull(),
    metadata_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
    version: text(),
    quality_score: real(),
    public_id: text(),
    owner: text(),
    visibility: text().notNull().default("private"),
    workspace_id: text().notNull().default(""),
    source_raw_ids: text({ mode: "json" }).notNull().$type<string[]>().default([]),
    status: text().notNull().default("draft"),
    build_method: text().notNull().default("direct"),
    connector: text().notNull().default("local_fs"),
    logical_bytes: integer(),
    record_count: integer(),
    entry_count: integer(),
    ...Timestamps,
    time_deleted: integer(),
  },
  (table) => [uniqueIndex("onescience_data_artifact_public_id_unique").on(table.public_id)],
)

export const OneScienceDataQualityReportTable = sqliteTable("onescience_data_quality_report", {
  id: text().primaryKey(),
  project_id: text().notNull().references(() => OneScienceDataProjectTable.id, { onDelete: "cascade" }),
  artifact_id: text().references(() => OneScienceDataArtifactTable.id, { onDelete: "set null" }),
  schema_score: real(),
  missing_score: real(),
  license_score: real(),
  train_ready_score: real(),
  checks_json: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
  recommendations_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
  ...Timestamps,
  time_deleted: integer(),
})

export const OneScienceDataReleaseTable = sqliteTable("onescience_data_release", {
  id: text().primaryKey(),
  project_id: text().notNull().references(() => OneScienceDataProjectTable.id, { onDelete: "cascade" }),
  artifact_id: text().references(() => OneScienceDataArtifactTable.id, { onDelete: "set null" }),
  target: text().notNull(),
  status: text().notNull(),
  resource_id: text().references(() => OneScienceResourceTable.id, { onDelete: "set null" }),
  training_config_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
  publish_payload_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
  ...Timestamps,
  time_deleted: integer(),
})

export const OneScienceDataSessionChipTable = sqliteTable(
  "onescience_data_session_chip",
  {
    session_id: text().notNull(),
    raw_id: text().notNull(),
    owner: text().notNull(),
    ...Timestamps,
  },
  (table) => [primaryKey({ columns: [table.session_id, table.raw_id] })],
)

export const OneScienceDataSessionMetaTable = sqliteTable("onescience_data_session_meta", {
  session_id: text().primaryKey(),
  owner: text().notNull(),
  last_already_json_hash: text(),
  last_ingest_at: integer(),
  ...Timestamps,
})

export const OneScienceCatalogTokenTable = sqliteTable("onescience_catalog_token", {
  token_hash: text().primaryKey(),
  account_id: text().notNull(),
  workspace_id: text().notNull(),
  expires_at: integer().notNull(),
  superseded_at: integer(),
  time_created: integer()
    .notNull()
    .$default(() => Date.now()),
})

export const OneScienceObjectStoreKeyTable = sqliteTable("onescience_object_store_key", {
  id: text().primaryKey(),
  account_id: text().notNull(),
  provider: text().notNull(),
  endpoint: text(),
  region: text(),
  label: text(),
  access_key_id: text().notNull(),
  secret_ciphertext: text().notNull(),
  ...Timestamps,
  time_deleted: integer(),
})

export const OneScienceDbConnectionTable = sqliteTable("onescience_db_connection", {
  id: text().primaryKey(),
  account_id: text().notNull(),
  engine: text().notNull(),
  host: text().notNull(),
  port: integer().notNull(),
  database: text().notNull(),
  username: text().notNull(),
  password_ciphertext: text().notNull(),
  label: text(),
  ssl_mode: text(),
  ...Timestamps,
  time_deleted: integer(),
})
