import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const CatalogEntryTable = sqliteTable("catalog_entry", {
  id: text().primaryKey(),
  kind: text().notNull(),
  name: text().notNull(),
  title: text().notNull(),
  description: text().notNull(),
  category: text(),
  tags: text({ mode: "json" }).notNull().$type<string[]>(),
  source: text(),
  status: text(),
  location: text(),
  payload_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
  embedding_json: text({ mode: "json" }).$type<number[]>(),
  embedding_model: text(),
  embedding_source_hash: text(),
  time_updated: integer().notNull(),
})
