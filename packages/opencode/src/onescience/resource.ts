import { Database } from "@/storage/db"
import { and, count, desc, eq, inArray, isNull, like, sql } from "drizzle-orm"
import { Schema } from "effect"
import { OneScienceResourceTable } from "./resource.sql"
import seedResources from "./resource-seed.json"

export function isCustomResourceId(id: string) {
  return id.startsWith("custom-")
}

export const ResourcePage = Schema.Union([
  Schema.Literal("datasets"),
  Schema.Literal("models"),
  Schema.Literal("apps"),
  Schema.Literal("frameworks"),
])
export type ResourcePage = typeof ResourcePage.Type

export const Source = Schema.Union([
  Schema.Literal("onescience"),
  Schema.Literal("third-party"),
  Schema.Literal("paper"),
  Schema.Literal("local"),
])
export type Source = typeof Source.Type

/** Keep create/update limits aligned with the OneHub upload form (card-calibrated). */
export const resourceFieldLimits = {
  title: 64,
  copy: 120,
  size: 48,
  format: 48,
  tag: 36,
  tags: 8,
  href: 512,
  domain: 40,
  provider: 48,
} as const

const ResourceTitle = Schema.NonEmptyString.check(Schema.isMaxLength(resourceFieldLimits.title))
const ResourceCopy = Schema.NonEmptyString.check(Schema.isMaxLength(resourceFieldLimits.copy))
const ResourceMetaText = Schema.NonEmptyString.check(Schema.isMaxLength(resourceFieldLimits.size))
const ResourceFormat = Schema.NonEmptyString.check(Schema.isMaxLength(resourceFieldLimits.format))
const ResourceDomain = Schema.NonEmptyString.check(Schema.isMaxLength(resourceFieldLimits.domain))
const ResourceProvider = Schema.NonEmptyString.check(Schema.isMaxLength(resourceFieldLimits.provider))
const ResourceTag = Schema.String.check(Schema.isMaxLength(resourceFieldLimits.tag))
const ResourceHref = Schema.String.check(Schema.isMaxLength(resourceFieldLimits.href))
const ResourceTags = Schema.Array(ResourceTag).check(
  Schema.makeFilter((tags) => tags.length <= resourceFieldLimits.tags),
)

export const Resource = Schema.Struct({
  id: Schema.String,
  page: ResourcePage,
  title: Schema.String,
  copy: Schema.String,
  domain: Schema.String,
  tags: Schema.Array(Schema.String),
  provider: Schema.String,
  size: Schema.String,
  format: Schema.String,
  href: Schema.optional(Schema.String),
  source: Source,
  metricLabel: Schema.String,
  action: Schema.String,
  /** Account id for user uploads; omitted for presets / legacy rows. */
  owner: Schema.optional(Schema.String),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
}).annotate({ identifier: "OneScienceResource" })
export type Resource = typeof Resource.Type

export const CreateResource = Schema.Struct({
  page: ResourcePage,
  title: ResourceTitle,
  copy: ResourceCopy,
  domain: ResourceDomain,
  tags: ResourceTags,
  provider: ResourceProvider,
  size: ResourceMetaText,
  format: ResourceFormat,
  href: Schema.optional(ResourceHref),
  source: Source,
}).annotate({ identifier: "CreateOneScienceResource" })
export type CreateResource = typeof CreateResource.Type

export const UpdateResource = Schema.Struct({
  title: Schema.optional(ResourceTitle),
  copy: Schema.optional(ResourceCopy),
  domain: Schema.optional(ResourceDomain),
  tags: Schema.optional(ResourceTags),
  provider: Schema.optional(ResourceProvider),
  size: Schema.optional(ResourceMetaText),
  format: Schema.optional(ResourceFormat),
  href: Schema.optional(ResourceHref),
  source: Schema.optional(Source),
}).annotate({ identifier: "UpdateOneScienceResource" })
export type UpdateResource = typeof UpdateResource.Type

type SeedResource = {
  id: string
  page: ResourcePage | "skills"
  title: string
  copy: string
  domain?: string
  tags: string[]
  provider: string
  size: string
  format: string
  href?: string
  source: Source
  metricLabel: string
  action: string
}

export function ensureSeededIfEmpty() {
  const empty = Database.use((db) => !db.select({ id: OneScienceResourceTable.id }).from(OneScienceResourceTable).limit(1).get())
  if (empty) seedDefaults()
}

function resourceLookupCandidates(resourceId: string) {
  const candidates = new Set<string>([resourceId])
  candidates.add(`seed-datasets-${resourceId}`)
  candidates.add(`seed-models-${resourceId}`)
  candidates.add(`seed-apps-${resourceId}`)
  if (resourceId.startsWith("seed-datasets-")) candidates.add(resourceId.slice("seed-datasets-".length))
  if (resourceId.startsWith("seed-models-")) candidates.add(resourceId.slice("seed-models-".length))
  if (resourceId.startsWith("seed-apps-")) candidates.add(resourceId.slice("seed-apps-".length))
  return [...candidates]
}

/**
 * Visibility for catalog cards:
 * - presets (non-custom-*): everyone
 * - custom uploads with an owner: only that account
 * - custom uploads with no owner (pre-auth legacy orphans): everyone
 * - accountId undefined: unscoped admin read (no filter)
 */
function isOrphanResourceOwner(owner: string | null | undefined) {
  return !owner
}

function resourceVisibilitySql(accountId: string | undefined) {
  if (accountId === undefined) return undefined
  if (!accountId) {
    return sql`(
      ${OneScienceResourceTable.id} NOT LIKE 'custom-%'
      OR ${OneScienceResourceTable.owner} IS NULL
      OR ${OneScienceResourceTable.owner} = ''
    )`
  }
  return sql`(
    ${OneScienceResourceTable.id} NOT LIKE 'custom-%'
    OR ${OneScienceResourceTable.owner} IS NULL
    OR ${OneScienceResourceTable.owner} = ''
    OR ${OneScienceResourceTable.owner} = ${accountId}
  )`
}

function assertCustomResourceMutable(
  row: { id: string; owner: string | null },
  accountId: string | undefined,
  action: "modify" | "delete",
) {
  if (!isCustomResourceId(row.id)) {
    throw new Error(action === "delete" ? "Preset resources cannot be deleted" : "Preset resources cannot be modified")
  }
  if (!accountId) {
    throw new Error(action === "delete" ? "Login required to delete resources" : "Login required to modify resources")
  }
  // Legacy rows without an owner are communal: any signed-in user may mutate/delete.
  if (isOrphanResourceOwner(row.owner)) return
  if (row.owner !== accountId) {
    throw new Error(
      action === "delete"
        ? "Only the owning account can delete this resource"
        : "Only the owning account can modify this resource",
    )
  }
}

/** Logged-in users may edit presets; user uploads remain owner-only; orphans are communal. */
function assertResourceEditable(row: { id: string; owner: string | null }, accountId: string | undefined) {
  if (!accountId) throw new Error("Login required to modify resources")
  if (!isCustomResourceId(row.id)) return
  if (isOrphanResourceOwner(row.owner)) return
  if (row.owner !== accountId) {
    throw new Error("Only the owning account can modify this resource")
  }
}

function isResourceVisibleToAccount(row: { id: string; owner: string | null }, accountId: string | undefined) {
  if (!isCustomResourceId(row.id)) return true
  if (isOrphanResourceOwner(row.owner)) return true
  if (!accountId) return false
  return row.owner === accountId
}

export function get(id: string, accountId?: string) {
  ensureSeededIfEmpty()
  const candidates = resourceLookupCandidates(id)
  return Database.use((db) => {
    const rows = db
      .select()
      .from(OneScienceResourceTable)
      .where(and(inArray(OneScienceResourceTable.id, candidates), isNull(OneScienceResourceTable.time_deleted)))
      .all()
    const row = rows.find((item) => item.id === id) ?? rows[0]
    if (!row) throw new Database.NotFoundError({ message: `OneScience resource not found: ${id}` })
    // undefined = unscoped internal/admin read; otherwise enforce owner visibility.
    if (accountId !== undefined && !isResourceVisibleToAccount(row, accountId)) {
      throw new Database.NotFoundError({ message: `OneScience resource not found: ${id}` })
    }
    return fromRow(row)
  })
}

export function list(
  page: ResourcePage,
  input?: { domain?: string; q?: string; limit?: number; offset?: number; customOnly?: boolean; accountId?: string },
) {
  ensureSeededIfEmpty()
  const limit = Math.max(1, Math.min(input?.limit ?? 24, 100))
  const offset = Math.max(0, input?.offset ?? 0)
  const domain = input?.domain?.trim()
  const query = input?.q?.trim().toLowerCase()
  // Default guests to presets-only when accountId omitted from HTTP (handler passes "" | id).
  const visibility = resourceVisibilitySql(input?.accountId)
  return Database.use((db) => {
    const conditions = and(
      eq(OneScienceResourceTable.page, page),
      domain ? eq(OneScienceResourceTable.domain, domain) : undefined,
      input?.customOnly ? like(OneScienceResourceTable.id, "custom-%") : undefined,
      visibility,
      isNull(OneScienceResourceTable.time_deleted),
    )
    const order = [desc(OneScienceResourceTable.time_created), desc(OneScienceResourceTable.id)] as const
    if (query) {
      const rows = db
        .select()
        .from(OneScienceResourceTable)
        .where(conditions)
        .orderBy(...order)
        .all()
        .filter((row) => matchesResourceQuery(row, query))
        .slice(offset, offset + limit + 1)
      return {
        items: rows.slice(0, limit).map(fromRow),
        nextOffset: rows.length > limit ? offset + limit : undefined,
      }
    }
    const rows = db
      .select()
      .from(OneScienceResourceTable)
      .where(conditions)
      .orderBy(...order)
      .limit(limit + 1)
      .offset(offset)
      .all()
    return {
      items: rows.slice(0, limit).map(fromRow),
      nextOffset: rows.length > limit ? offset + limit : undefined,
    }
  })
}

const catalogCountPages = ["datasets", "models", "apps", "frameworks"] as const
export type CatalogCountPage = (typeof catalogCountPages)[number]
export type ResourceDomainCounts = Record<string, number>
export type ResourceCustomCounts = Record<CatalogCountPage, number> & {
  byDomain: Record<CatalogCountPage, ResourceDomainCounts>
}

function emptyDomainCounts(): Record<CatalogCountPage, ResourceDomainCounts> {
  return { datasets: {}, models: {}, apps: {}, frameworks: {} }
}

function normalizeCatalogDomain(domain: string | null | undefined) {
  const value = domain?.trim()
  return value ? value : "其它"
}

export function customCountsByPage(accountId?: string): ResourceCustomCounts {
  return Database.use((db) => {
    const visibility = resourceVisibilitySql(accountId)
    const rows = db
      .select({
        page: OneScienceResourceTable.page,
        domain: OneScienceResourceTable.domain,
        total: count(),
      })
      .from(OneScienceResourceTable)
      .where(and(like(OneScienceResourceTable.id, "custom-%"), visibility, isNull(OneScienceResourceTable.time_deleted)))
      .groupBy(OneScienceResourceTable.page, OneScienceResourceTable.domain)
      .all()
    const result: ResourceCustomCounts = {
      datasets: 0,
      models: 0,
      apps: 0,
      frameworks: 0,
      byDomain: emptyDomainCounts(),
    }
    for (const row of rows) {
      if (row.page !== "datasets" && row.page !== "models" && row.page !== "apps" && row.page !== "frameworks") continue
      const total = Number(row.total)
      const domain = normalizeCatalogDomain(row.domain)
      result[row.page] += total
      result.byDomain[row.page][domain] = (result.byDomain[row.page][domain] ?? 0) + total
    }
    return result
  })
}

function matchesResourceQuery(row: typeof OneScienceResourceTable.$inferSelect, query: string) {
  if (row.title.toLowerCase().includes(query)) return true
  if (row.copy.toLowerCase().includes(query)) return true
  if (row.provider.toLowerCase().includes(query)) return true
  if (row.format.toLowerCase().includes(query)) return true
  if (row.domain.toLowerCase().includes(query)) return true
  if (row.id.toLowerCase().includes(query)) return true
  const tags = row.tags ?? []
  return tags.some((tag) => tag.toLowerCase().includes(query))
}

export function create(input: CreateResource, accountId?: string) {
  if (!accountId) throw new Error("Login required to upload resources")
  const now = Date.now()
  const row = {
    id: `custom-${input.page}-${crypto.randomUUID()}`,
    page: input.page,
    title: input.title,
    copy: input.copy,
    domain: input.domain,
    tags: [...input.tags],
    provider: input.provider,
    size: input.size,
    format: input.format,
    href: input.href?.trim() || null,
    source: input.source,
    metric_label: input.page === "datasets" ? "数据源" : "规模",
    action: input.page === "datasets" ? "下载" : input.page === "models" ? "打开" : "安装",
    resource_type: null,
    trust_level: "user",
    license: null,
    version: null,
    owner: accountId,
    metadata: null,
    verification_state: "draft",
    verified_at: null,
    verified_by: null,
    time_created: now,
    time_updated: now,
    time_deleted: null,
  }
  Database.use((db) => db.insert(OneScienceResourceTable).values(row).run())
  return fromRow(row)
}

export function update(id: string, input: UpdateResource, accountId?: string) {
  return Database.transaction((db) => {
    const candidates = resourceLookupCandidates(id)
    const rows = db
      .select()
      .from(OneScienceResourceTable)
      .where(and(inArray(OneScienceResourceTable.id, candidates), isNull(OneScienceResourceTable.time_deleted)))
      .all()
    const existing = rows.find((item) => item.id === id) ?? rows[0]
    if (!existing) throw new Database.NotFoundError({ message: `OneScience resource not found: ${id}` })
    assertResourceEditable(existing, accountId)
    db.update(OneScienceResourceTable)
      .set({
        title: input.title ?? existing.title,
        copy: input.copy ?? existing.copy,
        domain: input.domain ?? existing.domain,
        tags: input.tags ? [...input.tags] : existing.tags,
        provider: input.provider ?? existing.provider,
        size: input.size ?? existing.size,
        format: input.format ?? existing.format,
        href: input.href === undefined ? existing.href : input.href.trim() || null,
        source: input.source ?? existing.source,
        time_updated: Date.now(),
      })
      .where(eq(OneScienceResourceTable.id, existing.id))
      .run()
    const row = db.select().from(OneScienceResourceTable).where(eq(OneScienceResourceTable.id, existing.id)).get()
    if (!row) throw new Database.NotFoundError({ message: `OneScience resource not found: ${id}` })
    return fromRow(row)
  })
}

export function remove(id: string, accountId?: string) {
  return Database.transaction((db) => {
    const existing = db
      .select({ id: OneScienceResourceTable.id, owner: OneScienceResourceTable.owner })
      .from(OneScienceResourceTable)
      .where(and(eq(OneScienceResourceTable.id, id), isNull(OneScienceResourceTable.time_deleted)))
      .get()
    if (!existing) return false
    assertCustomResourceMutable(existing, accountId, "delete")
    db.update(OneScienceResourceTable)
      .set({ time_deleted: Date.now(), time_updated: Date.now() })
      .where(eq(OneScienceResourceTable.id, id))
      .run()
    return true
  })
}

export function seedDefaults() {
  const now = Date.now()
  return Database.transaction((db) => {
    let seeded = 0
    let updated = 0
    for (const [index, item] of (seedResources as SeedResource[]).filter((item): item is SeedResource & { page: ResourcePage } => item.page !== "skills").entries()) {
      const existing = db
        .select({
          id: OneScienceResourceTable.id,
          time_deleted: OneScienceResourceTable.time_deleted,
        })
        .from(OneScienceResourceTable)
        .where(eq(OneScienceResourceTable.id, item.id))
        .get()
      if (existing?.time_deleted) continue
      const row = {
        id: item.id,
        page: item.page,
        title: item.title,
        copy: item.copy,
        domain: item.domain ?? inferDomain(item),
        tags: [...item.tags],
        provider: item.provider,
        size: item.size,
        format: item.format,
        href: item.href?.trim() || null,
        source: item.source,
        metric_label: item.metricLabel,
        action: item.action,
        time_created: now - index,
        time_updated: now,
        time_deleted: null,
      }
      if (existing) {
        db.update(OneScienceResourceTable)
          .set({
            title: row.title,
            copy: row.copy,
            domain: row.domain,
            tags: row.tags,
            provider: row.provider,
            size: row.size,
            format: row.format,
            href: row.href,
            source: row.source,
            metric_label: row.metric_label,
            action: row.action,
            time_updated: row.time_updated,
          })
          .where(eq(OneScienceResourceTable.id, item.id))
          .run()
        updated++
        continue
      }
      db.insert(OneScienceResourceTable).values(row).run()
      seeded++
    }
    return { seeded, updated }
  })
}

function fromRow(row: typeof OneScienceResourceTable.$inferSelect): Resource {
  return {
    id: row.id,
    page: row.page as ResourcePage,
    title: row.title,
    copy: row.copy,
    domain: row.domain,
    tags: row.tags,
    provider: row.provider,
    size: row.size,
    format: row.format,
    ...(row.href ? { href: row.href } : {}),
    source: row.source as Source,
    metricLabel: row.metric_label,
    action: row.action,
    ...(row.owner ? { owner: row.owner } : {}),
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

function inferDomain(item: SeedResource) {
  const firstTag = item.tags.find((tag) => knownDomains.has(tag))
  if (firstTag) return firstTag
  if (item.id.includes("earth") || item.id.includes("modelhub") || item.provider === "weather") return "地球科学"
  if (item.id.includes("life") || item.provider === "bio") return "生命科学"
  if (item.id.includes("material") || item.provider === "material") return "材料化学"
  if (item.id.includes("fluid") || item.provider === "fluid") return "流体仿真"
  if (item.id.includes("framework-training")) return "训练框架"
  if (item.id.includes("framework-parallel")) return "并行训练"
  if (item.id.includes("framework-inference")) return "推理框架"
  return "其它"
}

const knownDomains = new Set([
  "地球科学",
  "生命科学",
  "材料化学",
  "流体仿真",
  "训练框架",
  "并行训练",
  "推理框架",
])

export * as OneScienceResource from "./resource"
