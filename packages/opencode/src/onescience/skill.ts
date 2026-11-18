import { Database, type TxOrDb } from "@/storage/db"
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm"
import { Schema } from "effect"
import { AIPrimitiveTable } from "./primitive.sql"
import { OneScienceResourceTable } from "./resource.sql"
import { OneSciencePrimitiveResourceTable, OneScienceSkillPrimitiveTable, OneScienceSkillTable } from "./skill.sql"

export const Skill = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  copy: Schema.String,
  layer: Schema.String,
  tags: Schema.Array(Schema.String),
  provider: Schema.String,
  size: Schema.String,
  format: Schema.String,
  href: Schema.optional(Schema.String),
  sortOrder: Schema.Number,
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
}).annotate({ identifier: "OneScienceSkill" })
export type Skill = typeof Skill.Type

export const SkillPrimitive = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  primitiveType: Schema.String,
  primitiveCategory: Schema.optional(Schema.String),
  bindingRole: Schema.String,
  sortOrder: Schema.Number,
}).annotate({ identifier: "OneScienceSkillPrimitive" })
export type SkillPrimitive = typeof SkillPrimitive.Type

export const SkillWithPrimitives = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  copy: Schema.String,
  layer: Schema.String,
  tags: Schema.Array(Schema.String),
  provider: Schema.String,
  size: Schema.String,
  format: Schema.String,
  href: Schema.optional(Schema.String),
  sortOrder: Schema.Number,
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
  primitives: Schema.Array(SkillPrimitive),
}).annotate({ identifier: "OneScienceSkillWithPrimitives" })
export type SkillWithPrimitives = typeof SkillWithPrimitives.Type

export function list(input?: { layer?: string; limit?: number; offset?: number; accountId?: string }) {
  const limit = Math.max(1, Math.min(input?.limit ?? 50, 100))
  const offset = Math.max(0, input?.offset ?? 0)
  return Database.use((db) => {
    const rows = db
      .select()
      .from(OneScienceSkillTable)
      .where(and(input?.layer ? eq(OneScienceSkillTable.layer, input.layer) : undefined, isNull(OneScienceSkillTable.time_deleted)))
      .orderBy(asc(OneScienceSkillTable.sort_order), asc(OneScienceSkillTable.id))
      .all()
    const visible = rows.filter((row) => isSkillVisibleToAccount(row, input?.accountId))
    const page = visible.slice(offset, offset + limit + 1)
    return { items: page.slice(0, limit).map(fromRow), nextOffset: page.length > limit ? offset + limit : undefined }
  })
}

function isSkillVisibleToAccount(row: typeof OneScienceSkillTable.$inferSelect, accountId?: string) {
  if (!accountId) return true
  const isUserSkill = row.size === "用户技能" || row.id.startsWith("custom-skill-") || row.tags.includes("user-skill")
  if (!isUserSkill) return true
  if (row.tags.includes(`owner:${accountId}`)) return true
  if (row.id.startsWith(`custom-skill-${accountId}-`)) return true
  // Legacy unscoped custom skills are hidden when platform accounts are active.
  return false
}

export function listWithPrimitives(input?: { layer?: string; limit?: number; offset?: number; accountId?: string }) {
  const result = list(input)
  return Database.use((db) => {
    const skillIds = result.items.map((item) => item.id)
    const bindings = skillIds.length === 0
      ? []
      : db
        .select()
        .from(OneScienceSkillPrimitiveTable)
        .where(and(inArray(OneScienceSkillPrimitiveTable.skill_id, skillIds), isNull(OneScienceSkillPrimitiveTable.time_deleted)))
        .orderBy(asc(OneScienceSkillPrimitiveTable.sort_order), asc(OneScienceSkillPrimitiveTable.primitive_id))
        .all()
    const primitiveIds = [...new Set(bindings.map((item) => item.primitive_id))]
    const primitives = primitiveIds.length === 0
      ? []
      : db
        .select()
        .from(AIPrimitiveTable)
        .where(and(inArray(AIPrimitiveTable.id, primitiveIds), isNull(AIPrimitiveTable.time_deleted), eq(AIPrimitiveTable.status, "callable")))
        .all()
    return {
      ...result,
      items: result.items.map((skill) => ({
        ...skill,
        primitives: bindings
          .filter((binding) => binding.skill_id === skill.id)
          .map((binding) => {
            const primitive = primitives.find((item) => item.id === binding.primitive_id)
            if (!primitive) return
            const primitiveCategory = primitive.contract_json?.primitiveCategory
            return {
              id: primitive.id,
              title: primitive.title,
              primitiveType: primitive.primitive_type,
              ...(typeof primitiveCategory === "string" ? { primitiveCategory } : {}),
              bindingRole: binding.binding_role,
              sortOrder: binding.sort_order,
            }
          })
          .filter((item): item is SkillPrimitive => !!item),
      })),
    }
  })
}

export function seedDefaults() {
  const now = Date.now()
  return Database.transaction((db) => {
    db.update(OneScienceResourceTable).set({ time_deleted: now, time_updated: now }).where(eq(OneScienceResourceTable.page, "skills")).run()
    return { seeded: 0, updated: 0 }
  })
}

export function seedPrimitiveRelations() {
  const now = Date.now()
  return Database.transaction((db) => {
    let resourceBindings = 0
    db.update(OneScienceSkillPrimitiveTable).set({ time_deleted: now, time_updated: now }).where(isNull(OneScienceSkillPrimitiveTable.time_deleted)).run()
    const primitives = db.select().from(AIPrimitiveTable).where(isNull(AIPrimitiveTable.time_deleted)).orderBy(desc(AIPrimitiveTable.time_created), desc(AIPrimitiveTable.id)).all()
    for (const [index, primitive] of primitives.entries()) {
      const resourcePage = typeof primitive.adapter_json?.page === "string" ? primitive.adapter_json.page : undefined
      const sourceIds = primitive.source_resource_ids ?? []
      for (const sourceId of sourceIds) {
        if (primitive.id.startsWith("primitive-data-")) continue
        const resource = resolveResource(db, resourcePage, sourceId)
        if (!resource) continue
        const id = `${primitive.id}:${resource.id}:derived_from`
        const row = { id, primitive_id: primitive.id, resource_id: resource.id, resource_page: resource.page, relation_type: "derived_from", sort_order: index, time_created: now - index, time_updated: now, time_deleted: null }
        const existing = db.select({ id: OneSciencePrimitiveResourceTable.id }).from(OneSciencePrimitiveResourceTable).where(eq(OneSciencePrimitiveResourceTable.id, id)).get()
        if (existing) db.update(OneSciencePrimitiveResourceTable).set({ resource_page: row.resource_page, sort_order: row.sort_order, time_updated: row.time_updated, time_deleted: null }).where(eq(OneSciencePrimitiveResourceTable.id, id)).run()
        else db.insert(OneSciencePrimitiveResourceTable).values(row).run()
        resourceBindings++
      }
    }
    return { skillBindings: 0, resourceBindings }
  })
}

function resolveResource(db: TxOrDb, page: string | undefined, sourceId: string) {
  const candidates = [sourceId, ...(page ? [`seed-${page}-${sourceId}`] : []), `seed-datasets-${sourceId}`, `seed-models-${sourceId}`, `seed-apps-${sourceId}`]
  return db
    .select({ id: OneScienceResourceTable.id, page: OneScienceResourceTable.page })
    .from(OneScienceResourceTable)
    .where(and(inArray(OneScienceResourceTable.id, candidates), isNull(OneScienceResourceTable.time_deleted)))
    .get()
}

function fromRow(row: typeof OneScienceSkillTable.$inferSelect): Skill {
  return {
    id: row.id,
    title: row.title,
    copy: row.copy,
    layer: row.layer,
    tags: row.tags,
    provider: row.provider,
    size: row.size,
    format: row.format,
    ...(row.href ? { href: row.href } : {}),
    sortOrder: row.sort_order,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

export function removeUser(id: string) {
  const now = Date.now()
  return Database.transaction((db) => {
    const existing = db.select({ id: OneScienceSkillTable.id }).from(OneScienceSkillTable).where(eq(OneScienceSkillTable.id, id)).get()
    if (!existing) return false
    db.update(OneScienceSkillTable).set({ time_deleted: now, time_updated: now }).where(eq(OneScienceSkillTable.id, id)).run()
    return true
  })
}

export function upsertUser(input: {
  id: string
  title: string
  copy: string
  layer: string
  tags: string[]
  provider?: string
  href?: string
}) {
  const now = Date.now()
  return Database.transaction((db) => {
    const existing = db.select().from(OneScienceSkillTable).where(eq(OneScienceSkillTable.id, input.id)).get()
    const row = {
      id: input.id,
      title: input.title,
      copy: input.copy,
      layer: input.layer,
      tags: [...input.tags],
      provider: input.provider ?? input.id,
      size: "用户技能",
      format: "SKILL.md",
      href: input.href?.trim() || null,
      sort_order: existing?.sort_order ?? 9000 + (now % 1000),
      time_created: existing?.time_created ?? now,
      time_updated: now,
      time_deleted: null,
    }
    if (existing) db.update(OneScienceSkillTable).set(row).where(eq(OneScienceSkillTable.id, input.id)).run()
    else db.insert(OneScienceSkillTable).values(row).run()
    return fromRow(row)
  })
}

export * as OneScienceSkill from "./skill"
