import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"

export const OneScienceResourceTable = sqliteTable("onescience_resource", {
  id: text().primaryKey(),
  page: text().notNull(),
  title: text().notNull(),
  copy: text().notNull(),
  domain: text().notNull().default("其它"),
  tags: text({ mode: "json" }).notNull().$type<string[]>(),
  provider: text().notNull(),
  size: text().notNull(),
  format: text().notNull(),
  href: text(),
  source: text().notNull(),
  metric_label: text().notNull(),
  action: text().notNull(),
  // 新增字段
  resource_type: text(),
  trust_level: text().default("user"),
  license: text(),
  version: text(),
  owner: text(),
  metadata: text({ mode: "json" }).$type<Record<string, any>>(),
  verification_state: text().default("draft"),
  verified_at: integer(),
  verified_by: text(),
  ...Timestamps,
  time_deleted: integer(),
})
