import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"

export const AIPrimitiveTable = sqliteTable("ai_primitive", {
  id: text().primaryKey(),
  slug: text().notNull().unique(),
  title: text().notNull(),
  description: text().notNull(),
  domain: text().notNull(),
  primitive_type: text().notNull(),
  intent_tags: text({ mode: "json" }).notNull().$type<string[]>(),
  source_resource_ids: text({ mode: "json" }).$type<string[]>(),
  status: text().notNull().default("draft"),
  contract_json: text({ mode: "json" }).$type<Record<string, any>>(),
  adapter_json: text({ mode: "json" }).$type<Record<string, any>>(),
  validation_json: text({ mode: "json" }).$type<Record<string, any>>(),
  quality_score: real(),
  owner: text(),
  ...Timestamps,
  time_deleted: integer(),
})
