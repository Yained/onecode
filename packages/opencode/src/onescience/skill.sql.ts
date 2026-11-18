import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"

export const OneScienceSkillTable = sqliteTable("onescience_skill", {
  id: text().primaryKey(),
  title: text().notNull(),
  copy: text().notNull(),
  layer: text().notNull(),
  tags: text({ mode: "json" }).notNull().$type<string[]>(),
  provider: text().notNull(),
  size: text().notNull(),
  format: text().notNull(),
  href: text(),
  sort_order: integer().notNull(),
  ...Timestamps,
  time_deleted: integer(),
})

export const OneScienceSkillPrimitiveTable = sqliteTable("onescience_skill_primitive", {
  id: text().primaryKey(),
  skill_id: text().notNull().references(() => OneScienceSkillTable.id, { onDelete: "cascade" }),
  primitive_id: text().notNull(),
  binding_role: text().notNull(),
  sort_order: integer().notNull(),
  ...Timestamps,
  time_deleted: integer(),
})

export const OneSciencePrimitiveResourceTable = sqliteTable("onescience_primitive_resource", {
  id: text().primaryKey(),
  primitive_id: text().notNull(),
  resource_id: text().notNull(),
  resource_page: text().notNull(),
  relation_type: text().notNull(),
  sort_order: integer().notNull(),
  ...Timestamps,
  time_deleted: integer(),
})
