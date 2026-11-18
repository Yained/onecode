import { Database } from "@/storage/db"
import { AIPrimitive } from "@/onescience/primitive"
import { OneSkills } from "@/oneskills/index"
import { OneSkillsManifest } from "@/oneskills/manifest"
import { shouldOverrideSkill, type SkillOverrideContext } from "@/skill/override-rank"
import { CatalogBlobStore } from "@/catalog/blob-store"
import {
  CatalogDomain,
  domainsEquivalent,
  loadPrimitiveCompanions,
} from "@/onescience/oneskills-primitive-ingest"
export { CatalogDomain }
import { CatalogEmbedding } from "@/catalog/embedding"
import { CatalogEmbeddingModel } from "@/catalog/embedding-model"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import * as Log from "@opencode-ai/core/util/log"
import { eq, inArray } from "drizzle-orm"
import { Schema } from "effect"
import { CatalogEntryTable } from "./index.sql"
import { createHash } from "crypto"
import path from "path"
import { existsSync, readFileSync } from "fs"
import { Glob } from "@opencode-ai/core/util/glob"
import { Global } from "@opencode-ai/core/global"
import { Flag } from "@opencode-ai/core/flag/flag"
import { parseMatter } from "@/util/frontmatter"
import * as PlatformAuth from "@/platform-auth/platform-auth"

export const Kind = Schema.Union([Schema.Literal("skill"), Schema.Literal("primitive")])
export type Kind = typeof Kind.Type

export const ResolvePart = Schema.Union([
  Schema.Literal("summary"),
  Schema.Literal("location"),
  Schema.Literal("contract"),
  Schema.Literal("body"),
  Schema.Literal("assets"),
])
export type ResolvePart = typeof ResolvePart.Type

export const EntrySummary = Schema.Struct({
  id: Schema.String,
  kind: Kind,
  name: Schema.String,
  title: Schema.String,
  description: Schema.String,
  category: Schema.optional(Schema.String),
  tags: Schema.Array(Schema.String),
  source: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  score: Schema.optional(Schema.Number),
}).annotate({ identifier: "CatalogEntrySummary" })
export type EntrySummary = typeof EntrySummary.Type

export const SearchInput = Schema.Struct({
  kind: Kind,
  q: Schema.optional(Schema.String),
  category: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  source: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  domain: Schema.optional(CatalogDomain),
  k: Schema.optional(Schema.Number),
  officialOnly: Schema.optional(Schema.Boolean),
  accountId: Schema.optional(Schema.String),
}).annotate({ identifier: "CatalogSearchInput" })
export type SearchInput = typeof SearchInput.Type

export const SearchResponse = Schema.Struct({
  items: Schema.Array(EntrySummary),
  total: Schema.Number,
}).annotate({ identifier: "CatalogSearchResponse" })
export type SearchResponse = typeof SearchResponse.Type

export type SkillInput = {
  name: string
  description?: string
  location: string
  skillType?: string
  layer?: string
  tags?: string[]
  source?: string
}

export const Event = {
  IndexUpdated: BusEvent.define(
    "catalog.index.updated",
    Schema.Struct({
      kind: Schema.optional(Kind),
      count: Schema.Number,
    }),
  ),
}

const SKILL_PATTERNS = ["oneskills/skills/*/SKILL.md", "{skill,skills}/*/SKILL.md"] as const
const RRF_K = 60
const log = Log.create({ service: "catalog" })
const EMBED_DEBOUNCE_MS = 300

let autoSyncReady = false
let embedQueue = new Set<string>()
let embedTimer: ReturnType<typeof setTimeout> | undefined
let embedRunning = false

type TxOrDb = Parameters<Parameters<typeof Database.use>[0]>[0]

function skillId(name: string, accountId?: string) {
  return accountId ? `skill:${accountId}:${name}` : `skill:${name}`
}

function accountIdFromSkillLocation(location: string | null | undefined) {
  if (!location) return undefined
  const match = location.replaceAll("\\", "/").match(/\/accounts\/([^/]+)\/skills\//)
  return match?.[1]
}

function catalogEntryOwner(row: typeof CatalogEntryTable.$inferSelect) {
  const fromPayload = row.payload_json?.owner
  if (typeof fromPayload === "string" && fromPayload.trim()) return fromPayload.trim()
  if (row.kind === "skill") return accountIdFromSkillLocation(row.location)
}

function readSkillBody(location: string | null) {
  if (!location) return { location: undefined, error: "built-in skill body is unavailable" }
  if (!existsSync(location)) return { location, error: "skill file not found" }
  const parsed = parseMatter(readFileSync(location, "utf8"))
  return {
    location,
    content: parsed.content.trim(),
    frontmatter: parsed.data,
  }
}

function inferSkillSource(location: string) {
  const normalized = location.replaceAll("\\", "/")
  if (normalized.includes("/accounts/") && normalized.includes("/skills/")) return "local"
  if (normalized.includes("/vendor/oneskills/")) return "official"
  if (normalized.includes("/.opencode/skills/") || normalized.includes("/.opencode/oneskills/skills/")) return "official"
  if (normalized.includes(Global.Path.repos.replaceAll("\\", "/"))) return "repo"
  if (normalized.includes("/.opencode/")) return "opencode-config"
  return "local"
}

const legacyLayerToSkillType = {
  "入口层": "orchestrator",
  "协作与路由层": "expert",
  "执行层": "executor",
  "保障层": "executor",
  "其它": "other",
} as const

const officialSkillTypeByName = {
  "onescience-orchestrator": "orchestrator",
  "scnet-chat": "executor",
} as const

function inferSkillCategory(input: SkillInput) {
  const byName = officialSkillTypeByName[input.name as keyof typeof officialSkillTypeByName]
  if (byName) return byName
  if (input.skillType) return input.skillType
  if (input.layer && input.layer in legacyLayerToSkillType) return legacyLayerToSkillType[input.layer as keyof typeof legacyLayerToSkillType]
  if (input.layer === "workflow") return "orchestrator"
  if (input.layer === "role") return "expert"
  if (input.layer === "resource") return "resource"
  if (input.layer && ["orchestrator", "resource", "expert", "executor", "other"].includes(input.layer)) return input.layer
  if (input.source === "local" || input.source === "opencode-config") return "other"
  if (input.source === "repo") return "other"
  return "other"
}

function stablePathId(location: string) {
  return `path:${createHash("sha256").update(location).digest("hex").slice(0, 16)}`
}

function upsertEntry(db: TxOrDb, entry: typeof CatalogEntryTable.$inferInsert) {
  db.insert(CatalogEntryTable)
    .values(entry)
    .onConflictDoUpdate({
      target: CatalogEntryTable.id,
      set: {
        kind: entry.kind,
        name: entry.name,
        title: entry.title,
        description: entry.description,
        category: entry.category,
        tags: entry.tags,
        source: entry.source,
        status: entry.status,
        location: entry.location,
        payload_json: entry.payload_json,
        time_updated: entry.time_updated,
        ...(entry.embedding_json !== undefined ? { embedding_json: entry.embedding_json } : {}),
        ...(entry.embedding_model !== undefined ? { embedding_model: entry.embedding_model } : {}),
        ...(entry.embedding_source_hash !== undefined ? { embedding_source_hash: entry.embedding_source_hash } : {}),
      },
    })
    .run()
}

export function removeEntry(id: string) {
  Database.use((db) => {
    db.delete(CatalogEntryTable).where(eq(CatalogEntryTable.id, id)).run()
  })
}

export function upsertSkill(input: SkillInput) {
  const now = Date.now()
  const location = input.location === "<built-in>" ? undefined : input.location
  const accountId = accountIdFromSkillLocation(location)
  const entry = {
    id: skillId(input.name, accountId),
    kind: "skill" as const,
    name: input.name,
    title: input.name,
    description: input.description ?? "",
    category: inferSkillCategory(input) ?? null,
    tags: input.tags ?? [],
    source: input.source ?? (location ? inferSkillSource(location) : "local"),
    status: "callable" as const,
    location: location ?? null,
    payload_json: {
      ...(location ? { pathId: stablePathId(location) } : {}),
      ...(accountId ? { owner: accountId } : {}),
    },
    time_updated: now,
  }
  Database.use((db) => upsertEntry(db, entry))
  scheduleCatalogEmbed([entry.id])
}

function scheduleCatalogEmbed(ids: readonly string[]) {
  const model = CatalogEmbedding.resolveEmbedModel()
  if (!model) return
  if (model.mode === "model" && !CatalogEmbeddingModel.transformersModuleAvailable()) {
    log.warn("catalog model embed skipped; transformers runtime unavailable")
    return
  }
  const pending = pendingEmbedIds(model, ids)
  if (pending.length === 0) return
  if (model.mode === "local") {
    embedLocalEntries(pending)
    return
  }
  for (const id of pending) embedQueue.add(id)
  if (embedTimer !== undefined) clearTimeout(embedTimer)
  embedTimer = setTimeout(() => {
    embedTimer = undefined
    void flushCatalogEmbedQueue()
  }, EMBED_DEBOUNCE_MS)
}

async function flushCatalogEmbedQueue() {
  if (embedQueue.size === 0) return
  const ids = [...embedQueue]
  embedQueue.clear()
  try {
    await embedCatalogEntriesAsync(ids)
  } catch (error) {
    log.error("catalog embed queue failed", { error, count: ids.length })
  }
}

function pendingEmbedIds(model: CatalogEmbedding.EmbedModel, ids?: readonly string[]) {
  const filter = ids?.length ? new Set(ids) : undefined
  return Database.use((db) => {
    const rows = db.select().from(CatalogEntryTable).all()
    return rows
      .filter((row) => !filter || filter.has(row.id))
      .filter((row) => CatalogEmbedding.needsEmbedding(row, CatalogEmbedding.entryEmbedText(row), model))
      .map((row) => row.id)
  })
}

export function schedulePendingEmbeds() {
  const model = CatalogEmbedding.resolveEmbedModel()
  if (!model) return
  if (model.mode === "model" && !CatalogEmbeddingModel.transformersModuleAvailable()) {
    log.warn("catalog pending embed skipped; transformers runtime unavailable")
    return
  }
  const pending = pendingEmbedIds(model)
  if (pending.length === 0) return
  if (model.mode === "local") {
    embedLocalEntries()
    return
  }
  for (const id of pending) embedQueue.add(id)
  if (embedTimer !== undefined) clearTimeout(embedTimer)
  embedTimer = setTimeout(() => {
    embedTimer = undefined
    void flushCatalogEmbedQueue()
  }, EMBED_DEBOUNCE_MS)
}

function embedLocalEntries(ids?: readonly string[]) {
  const model = CatalogEmbedding.resolveEmbedModel("local")
  if (!model) return 0
  const filter = ids?.length ? new Set(ids) : undefined
  let count = 0
  Database.use((db) => {
    const rows = db.select().from(CatalogEntryTable).all()
    for (const row of rows) {
      if (filter && !filter.has(row.id)) continue
      const text = CatalogEmbedding.entryEmbedText(row)
      if (!CatalogEmbedding.needsEmbedding(row, text, model)) continue
      db.update(CatalogEntryTable)
        .set({
          embedding_json: CatalogEmbedding.embedText(text, model),
          embedding_model: model.id,
          embedding_source_hash: CatalogEmbedding.embedSourceHash(text),
        })
        .where(eq(CatalogEntryTable.id, row.id))
        .run()
      count++
    }
  })
  return count
}

function publishIndexUpdated(kind: Kind | undefined, count: number) {
  GlobalBus.emit("event", {
    payload: {
      type: Event.IndexUpdated.type,
      properties: { kind, count },
    },
  })
}

function primitiveBlobPayload(primitive: AIPrimitive.Primitive) {
  return {
    id: primitive.id,
    title: primitive.title,
    description: primitive.description,
    contractJson: primitive.contractJson,
    adapterJson: primitive.adapterJson,
    validationJson: primitive.validationJson,
    primitiveType: primitive.primitiveType,
    domain: primitive.domain,
  }
}

export function explicitPrimitiveLocation(primitive: AIPrimitive.Primitive) {
  const adapter = primitive.adapterJson ?? {}
  const contract = primitive.contractJson ?? {}
  if (typeof adapter.location === "object" && adapter.location !== null) return adapter.location
  if (typeof contract.location === "object" && contract.location !== null) return contract.location
  if (typeof adapter.href === "string") return { type: "href", href: adapter.href }
  if (typeof contract.href === "string") return { type: "href", href: contract.href }
  if (primitive.sourceResourceIds?.length) {
    return { type: "resource", resourceIds: primitive.sourceResourceIds, page: adapter.page }
  }
}

export function inferPrimitiveSource(primitive: AIPrimitive.Primitive) {
  const location = explicitPrimitiveLocation(primitive)
  if (location && typeof location === "object" && "type" in location) {
    const serialized = JSON.stringify(location)
    if (serialized.includes("/.opencode/")) return "opencode-config"
  }
  const owner = primitive.owner?.trim()
  if (!owner || owner === "system" || owner === "official" || owner === "platform" || owner === "local") return "official"
  return "local"
}

export function primitiveLocation(primitive: AIPrimitive.Primitive) {
  const explicit = explicitPrimitiveLocation(primitive)
  if (explicit) return explicit
  return CatalogBlobStore.blobLocationRef(primitive.id)
}

/** @deprecated use primitiveLocation */
export const mockPrimitiveLocation = primitiveLocation

export function removePrimitiveFromCatalog(id: string) {
  removeEntry(id)
  publishIndexUpdated("primitive", 0)
}

function embedCatalogEntry(id: string) {
  scheduleCatalogEmbed([id])
}

export function syncPrimitiveFromRecord(primitive: AIPrimitive.Primitive) {
  if (primitive.status !== "callable") {
    removePrimitiveFromCatalog(primitive.id)
    return
  }

  if (!explicitPrimitiveLocation(primitive)) {
    CatalogBlobStore.writePrimitiveBlob(primitive.id, primitiveBlobPayload(primitive))
  }
  upsertPrimitive(primitive)
  embedCatalogEntry(primitive.id)
  publishIndexUpdated("primitive", 1)
}

export function upsertPrimitive(primitive: AIPrimitive.Primitive) {
  if (primitive.status !== "callable") {
    removeEntry(primitive.id)
    return
  }

  const location = primitiveLocation(primitive)
  const now = primitive.timeUpdated
  const entry = {
    id: primitive.id,
    kind: "primitive" as const,
    name: primitive.slug,
    title: primitive.title,
    description: primitive.description,
    category: primitive.primitiveType,
    tags: [...primitive.intentTags],
    source: inferPrimitiveSource(primitive),
    status: primitive.status as string,
    location: JSON.stringify(location),
    payload_json: {
      primitiveType: primitive.primitiveType,
      domain: primitive.domain,
      capabilityFamilies: [...primitive.capabilityFamilies],
      executionSkills: [...primitive.executionSkills],
      ...(primitive.owner ? { owner: primitive.owner } : {}),
    },
    time_updated: now,
  }
  Database.use((db) => upsertEntry(db, entry))
}

export function syncSkills(skills: SkillInput[]) {
  Database.use((db) => {
    for (const skill of skills) upsertEntry(db, buildSkillEntry(skill))
  })
}

function buildSkillEntry(input: SkillInput): typeof CatalogEntryTable.$inferInsert {
  const now = Date.now()
  const location = input.location === "<built-in>" ? undefined : input.location
  const accountId = accountIdFromSkillLocation(location)
  return {
    id: skillId(input.name, accountId),
    kind: "skill",
    name: input.name,
    title: input.name,
    description: input.description ?? "",
    category: inferSkillCategory(input) ?? null,
    tags: input.tags ?? [],
    source: input.source ?? (location ? inferSkillSource(location) : "local"),
    status: "callable",
    location: location ?? null,
    payload_json: {
      ...(location ? { pathId: stablePathId(location) } : {}),
      ...(accountId ? { owner: accountId } : {}),
    },
    time_updated: now,
  }
}

export function syncPrimitives(input?: { status?: AIPrimitive.PrimitiveStatus }) {
  const status = input?.status ?? "callable"
  const indexed = new Set<string>()
  let offset = 0
  const pageSize = 100
  while (true) {
    const page = AIPrimitive.listWithResources({ status, limit: pageSize, offset })
    for (const primitive of page.items) {
      upsertPrimitive(primitive)
      indexed.add(primitive.id)
    }
    if (typeof page.nextOffset !== "number") break
    offset = page.nextOffset
  }

  Database.use((db) => {
    const rows = db
      .select({ id: CatalogEntryTable.id })
      .from(CatalogEntryTable)
      .where(eq(CatalogEntryTable.kind, "primitive"))
      .all()
    for (const row of rows) {
      if (!indexed.has(row.id)) removeEntry(row.id)
    }
  })
  scheduleCatalogEmbed([...indexed])
  return indexed.size
}

function fromRow(row: typeof CatalogEntryTable.$inferSelect, score?: number): EntrySummary {
  return {
    id: row.id,
    kind: row.kind as Kind,
    name: row.name,
    title: row.title,
    description: row.description,
    ...(row.category ? { category: row.category } : {}),
    tags: row.tags,
    ...(row.source ? { source: row.source } : {}),
    ...(row.status ? { status: row.status } : {}),
    ...(score !== undefined ? { score } : {}),
  }
}

function primitiveDomain(row: typeof CatalogEntryTable.$inferSelect) {
  const domain = row.payload_json?.domain
  return typeof domain === "string" ? domain : undefined
}

function matchesFilters(
  row: typeof CatalogEntryTable.$inferSelect,
  input: SearchInput,
) {
  if (row.kind !== input.kind) return false
  if (input.category && row.category !== input.category) return false
  if (input.source && row.source !== input.source) return false
  if (input.status && row.status !== input.status) return false
  if (input.domain && !domainsEquivalent(primitiveDomain(row), input.domain)) return false
  if (input.tags?.length && !input.tags.every((tag) => row.tags.includes(tag))) return false
  if (input.officialOnly && row.kind === "skill" && !isOfficialOneSkillsEntry(row)) return false
  if (input.accountId !== undefined) {
    const owner = catalogEntryOwner(row)
    if (input.accountId === "") {
      // Guest: presets / official only — hide other users and communal residue.
      if (row.kind === "primitive") {
        if (!owner || (owner !== "system" && owner !== "platform" && owner !== "local" && owner !== "official")) return false
        if (owner === "platform" || owner === "local") {
          if (row.id.startsWith("primitive-resource-custom-")) return false
          if (/^primitive-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id)) return false
          if (!row.id.startsWith("primitive-resource-")) return false
        }
      } else if (row.kind === "skill") {
        if (owner && owner !== "system" && owner !== "platform" && owner !== "local" && owner !== "official") return false
        if (row.source === "local" && owner) return false
      }
    } else {
      if (owner && owner !== "system" && owner !== "platform" && owner !== "local" && owner !== "official" && owner !== input.accountId) {
        return false
      }
      if (row.kind === "skill" && row.source === "local" && owner && owner !== input.accountId) return false
    }
  }
  return true
}

/** Official OneSkills installs live under oneskills/skills; the name allowlist is a fallback for older rows. */
function isOfficialOneSkillsEntry(row: typeof CatalogEntryTable.$inferSelect) {
  if ((OneSkills.OFFICIAL_SKILL_NAMES as readonly string[]).includes(row.name)) return true
  const location = (row.location ?? "").replaceAll("\\", "/")
  return location.includes("/oneskills/skills/")
}

function bm25Field(text: string, terms: readonly string[], avgLen: number, weight: number) {
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean)
  const docLen = tokens.length
  const k1 = 1.2
  const b = 0.75
  return terms.reduce((total, term) => {
    const tf = tokens.filter((token) => token.includes(term)).length
    if (tf === 0) return total
    const norm = tf * (k1 + 1)
    const denom = tf + k1 * (1 - b + (b * docLen) / Math.max(avgLen, 1))
    return total + weight * (norm / denom)
  }, 0)
}

function bm25Score(row: typeof CatalogEntryTable.$inferSelect, terms: readonly string[], avgLen: number) {
  if (terms.length === 0) return 0
  const title = row.title
  const description = row.description
  const tags = row.tags.join(" ")
  return (
    bm25Field(title, terms, avgLen, 3) +
    bm25Field(tags, terms, avgLen, 2.5) +
    bm25Field(description, terms, avgLen, 1.5) +
    bm25Field(`${title} ${description} ${tags}`, terms, avgLen, 0.5)
  )
}

function tagScore(row: typeof CatalogEntryTable.$inferSelect, tags?: readonly string[]) {
  if (!tags?.length) return 0
  return tags.filter((tag) => row.tags.includes(tag)).length
}

function rankMap<T>(items: T[], score: (item: T) => number) {
  const ranked = items
    .map((item) => ({ item, score: score(item) }))
    .filter((entry) => entry.score > 0)
    .toSorted((a, b) => b.score - a.score)
  const ranks = new Map<T, number>()
  ranked.forEach((entry, index) => ranks.set(entry.item, index + 1))
  return ranks
}

function rrfScore(ranks: number[]) {
  return ranks.reduce((sum, rank) => (rank > 0 ? sum + 1 / (RRF_K + rank) : sum), 0)
}

function rowLiteralMatch(row: typeof CatalogEntryTable.$inferSelect, q: string) {
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const haystack = `${row.id} ${row.name} ${row.title} ${row.description} ${row.tags.join(" ")}`.toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

function pruneSearchScores<T extends { score: number }>(items: T[], q: string) {
  if (!q.trim() || items.length <= 1) return items
  const top = items[0]!.score
  if (top <= 0) return items
  const min = top * 0.85
  const kept = items.filter((item) => item.score >= min)
  return kept.length > 0 ? kept : items.slice(0, 1)
}

function vectorScore(row: typeof CatalogEntryTable.$inferSelect, queryVector: readonly number[], modelId: string) {
  if (row.embedding_model !== modelId || !row.embedding_json?.length) return 0
  const score = CatalogEmbedding.cosineSimilarity(queryVector, row.embedding_json)
  return score > 0 ? score : 0
}

function dominantEmbedModel(rows: readonly (typeof CatalogEntryTable.$inferSelect)[]) {
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (!row.embedding_model || !row.embedding_json?.length) continue
    counts.set(row.embedding_model, (counts.get(row.embedding_model) ?? 0) + 1)
  }
  let model: string | undefined
  let count = 0
  for (const [id, value] of counts) {
    if (value <= count) continue
    model = id
    count = value
  }
  return model
}

function searchWithQueryVector(input: SearchInput, queryVector: readonly number[] | undefined, modelId?: string) {
  const limit = Math.max(1, Math.min(input.k ?? 8, 50))
  const q = input.q?.trim() ?? ""

  return Database.use((db) => {
    const rows = db.select().from(CatalogEntryTable).all()
    const filtered = rows.filter((row) => matchesFilters(row, input))
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
    const avgLen =
      filtered.reduce((sum, row) => sum + `${row.title} ${row.description} ${row.tags.join(" ")}`.split(/\s+/).length, 0) /
      Math.max(filtered.length, 1)
    const textRanks = rankMap(filtered, (row) => bm25Score(row, terms, avgLen))
    const tagRanks = rankMap(filtered, (row) => tagScore(row, input.tags))
    const vectorRanks =
      queryVector && modelId
        ? rankMap(filtered, (row) => vectorScore(row, queryVector, modelId))
        : new Map<typeof CatalogEntryTable.$inferSelect, number>()
    const sorted = filtered
      .map((row) => {
        const ranks = [textRanks.get(row) ?? 0, tagRanks.get(row) ?? 0]
        if (queryVector && vectorRanks.get(row)) ranks.push(vectorRanks.get(row)!)
        const score = q || input.tags?.length ? rrfScore(ranks) : 1
        return { row, score }
      })
      .filter((item) => (q || input.tags?.length ? item.score > 0 : true))
      .toSorted((a, b) => b.score - a.score || b.row.time_updated - a.row.time_updated)
    const literal = q ? sorted.filter((item) => rowLiteralMatch(item.row, q)) : sorted
    const pool = literal.length > 0 ? literal : sorted
    const scored = pruneSearchScores(pool, q).slice(0, limit)

    return {
      items: scored.map((item) => fromRow(item.row, item.score)),
      total: scored.length,
    } satisfies SearchResponse
  })
}

export function search(input: SearchInput) {
  const q = input.q?.trim() ?? ""
  if (!q) return searchWithQueryVector(input, undefined, undefined)

  const rows = Database.use((db) => db.select().from(CatalogEntryTable).all())
  const filtered = rows.filter((row) => matchesFilters(row, input))
  const dominant = dominantEmbedModel(filtered)
  if (dominant && dominant !== CatalogEmbedding.LOCAL_MODEL_ID) {
    return searchWithQueryVector(input, undefined, undefined)
  }

  const model = CatalogEmbedding.resolveEmbedModel("local")
  const modelId = dominant === CatalogEmbedding.LOCAL_MODEL_ID ? dominant : model?.id
  const queryVector = model && modelId === model.id ? CatalogEmbedding.embedText(q, model) : undefined
  return searchWithQueryVector(input, queryVector, modelId)
}

export async function searchAsync(input: SearchInput) {
  const q = input.q?.trim() ?? ""
  if (!q) return search(input)

  const rows = Database.use((db) => db.select().from(CatalogEntryTable).all())
  const filtered = rows.filter((row) => matchesFilters(row, input))
  const configured = CatalogEmbedding.resolveEmbedModel()
  const modelId =
    configured && configured.mode !== "local"
      ? configured.id
      : dominantEmbedModel(filtered)
  if (!modelId) return search(input)

  const model =
    CatalogEmbedding.resolveEmbedModelById(modelId) ??
    (modelId === CatalogEmbedding.LOCAL_MODEL_ID ? CatalogEmbedding.resolveEmbedModel("local") : undefined)
  if (!model || model.id !== modelId) return search(input)

  const queryVector = await CatalogEmbedding.embedTextAsync(q, model, { query: true })
  return searchWithQueryVector(input, queryVector, modelId)
}

export function getEntry(id: string) {
  return Database.use((db) => {
    const row = db.select().from(CatalogEntryTable).where(eq(CatalogEntryTable.id, id)).get()
    if (!row) throw new Database.NotFoundError({ message: `Catalog entry not found: ${id}` })
    return fromRow(row)
  })
}

export function resolve(id: string, part: ResolvePart) {
  return Database.use((db) => {
    const row = db.select().from(CatalogEntryTable).where(eq(CatalogEntryTable.id, id)).get()
    if (!row) throw new Database.NotFoundError({ message: `Catalog entry not found: ${id}` })

    if (part === "summary") {
      return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        description: row.description,
        category: row.category,
        tags: row.tags,
        source: row.source,
        status: row.status,
      }
    }

    if (row.kind === "skill") {
      if (part === "location") return { location: row.location, pathId: row.payload_json?.pathId }
      if (part === "body") return readSkillBody(row.location)
      if (part === "contract" || part === "assets") {
        return { location: row.location, assetsRoot: row.location ? path.dirname(row.location) : undefined }
      }
    }

    const primitive = AIPrimitive.get(id)
    if (part === "location") {
      const parsed = row.location ? JSON.parse(row.location) : primitiveLocation(primitive)
      if (parsed?.type === "local_blob" || parsed?.type === "mock_blob") {
        const blobId = primitive.id
        const blob = CatalogBlobStore.readPrimitiveBlob(blobId)
        return { location: parsed, blob }
      }
      return { location: parsed }
    }
    if (part === "contract") {
      return {
        contractJson: primitive.contractJson,
        adapterJson: primitive.adapterJson,
        validationJson: primitive.validationJson,
        primitiveType: primitive.primitiveType,
        domain: primitive.domain,
      }
    }
    if (part === "body") {
      return {
        description: primitive.description,
        contractJson: primitive.contractJson,
        adapterJson: primitive.adapterJson,
        companions: loadPrimitiveCompanions({
          id: primitive.id,
          adapterJson: primitive.adapterJson,
        }),
      }
    }
    if (part === "assets") {
      return {
        resources:
          AIPrimitive.listWithResources({ limit: 500 }).items.find((item) => item.id === id)?.resources ?? [],
        sourceResourceIds: primitive.sourceResourceIds,
      }
    }

    throw new Database.NotFoundError({ message: `Unsupported resolve part: ${part}` })
  })
}

export function skillScanRoots(projectDir?: string) {
  const roots: OneSkills.SkillScanTarget[] = [
    ...OneSkills.globalSkillScanTargets({ includeSharedUserSkills: !PlatformAuth.authRequired() }),
  ]
  if (projectDir) {
    roots.push(
      { root: path.join(projectDir, ".opencode"), patterns: SKILL_PATTERNS },
      { root: path.join(projectDir, ".opencode/oneskills"), patterns: SKILL_PATTERNS },
    )
    const accountId = PlatformAuth.accountIdForDirectory(projectDir)
    if (accountId) {
      roots.push({ root: PlatformAuth.accountSkillsDir(accountId), patterns: ["*/SKILL.md"] })
    }
  }
  return roots
}

function parseSkillFile(match: string): SkillInput | undefined {
  const parsed = parseMatter(readFileSync(match, "utf8"))
  const name = typeof parsed.data.name === "string" ? parsed.data.name : undefined
  const description = typeof parsed.data.description === "string" ? parsed.data.description : undefined
  const skillType = typeof parsed.data.type === "string" ? parsed.data.type : undefined
  const tags = Array.isArray(parsed.data.tags)
    ? parsed.data.tags.filter((tag): tag is string => typeof tag === "string")
    : undefined
  if (!name || !description) return undefined
  return {
    name,
    description,
    location: match,
    skillType,
    layer: typeof parsed.data.layer === "string" ? parsed.data.layer : undefined,
    tags,
  }
}

export function scanSkillsFromRoots(roots: readonly OneSkills.SkillScanTarget[]) {
  const skills: SkillInput[] = []
  for (const { root, patterns } of roots) {
    if (!existsSync(root)) continue
    for (const pattern of patterns) {
      for (const match of Glob.scanSync(pattern, {
        cwd: root,
        absolute: true,
        symlink: true,
      })) {
        const parsed = parseSkillFile(match)
        if (parsed) skills.push(parsed)
      }
    }
  }
  return skills
}

function loadManifestMetadata(projectDir?: string) {
  const installer = OneSkills.findInstallerScript()
  const paths = [
    OneSkills.manifestFile(),
    projectDir ? OneSkills.manifestFile(projectDir) : undefined,
    installer ? path.join(OneSkills.installerRepoRoot(installer), "catalog/manifest.json") : undefined,
  ].filter((item): item is string => item !== undefined)

  for (const file of paths) {
    if (!existsSync(file)) continue
    return OneSkillsManifest.indexByName(OneSkillsManifest.decodeManifest(JSON.parse(readFileSync(file, "utf8"))))
  }
  return new Map<string, OneSkillsManifest.ManifestSkill>()
}

function enrichSkill(input: SkillInput, manifest: Map<string, OneSkillsManifest.ManifestSkill>): SkillInput {
  const entry = manifest.get(input.name)
  if (!entry) return input
  return {
    ...input,
    description: input.description || entry.description,
    skillType: input.skillType ?? entry.type,
    layer: input.layer ?? entry.layer,
    tags: input.tags?.length ? [...input.tags] : [...entry.tags],
    source: input.source ?? entry.source,
  }
}

export function ingestSkillsFromDirectory(projectDir: string) {
  return ingestSkills({ projectDir })
}

export function ingestSkills(input?: { projectDir?: string; runtime?: SkillInput[] }) {
  const manifest = loadManifestMetadata(input?.projectDir)
  const byName = new Map<string, SkillInput>()
  const rankCtx: SkillOverrideContext = {
    directory: input?.projectDir ?? Global.Path.home,
    worktree: input?.projectDir ?? Global.Path.home,
  }

  for (const skill of scanSkillsFromRoots(skillScanRoots(input?.projectDir))) {
    const enriched = enrichSkill(skill, manifest)
    const existing = byName.get(skill.name)
    if (!existing || shouldOverrideSkill(existing.location, enriched.location, rankCtx)) {
      byName.set(skill.name, enriched)
    }
  }

  for (const skill of input?.runtime ?? []) {
    if (!skill.description) continue
    const merged: SkillInput = { ...byName.get(skill.name), ...skill }
    byName.set(skill.name, enrichSkill(merged, manifest))
  }

  const skills = [...byName.values()]
  syncSkills(skills)
  const accountIds = [...new Set(skills.map((item) => accountIdFromSkillLocation(item.location)).filter(Boolean))] as string[]
  removeMissingSkills(
    skills.map((item) => item.name),
    { accountId: accountIds.length === 1 ? accountIds[0] : undefined, skills },
  )
  scheduleCatalogEmbed(skills.map((item) => skillId(item.name, accountIdFromSkillLocation(item.location))))
  return skills.length
}

export function syncRuntimeSkills(
  runtime: Array<{ name: string; description?: string; location: string }>,
  projectDir?: string,
) {
  return ingestSkills({
    projectDir,
    runtime: runtime.flatMap((item) =>
      item.description ? [{ name: item.name, description: item.description, location: item.location }] : [],
    ),
  })
}

export function embedCatalog(input?: { mode?: CatalogEmbedding.EmbedMode }) {
  const model = CatalogEmbedding.resolveEmbedModel(input?.mode)
  if (!model || model.mode !== "local") return 0
  return embedLocalEntries()
}

export async function embedCatalogEntriesAsync(
  ids?: readonly string[],
  input?: { mode?: CatalogEmbedding.EmbedMode },
) {
  while (embedRunning) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  embedRunning = true
  try {
    const model = CatalogEmbedding.resolveEmbedModel(input?.mode)
    if (!model) return 0
    if (model.mode === "model" && !CatalogEmbeddingModel.transformersModuleAvailable()) return 0
    if (model.mode === "local") return embedLocalEntries(ids)

    const filter = ids?.length ? new Set(ids) : undefined
    const pending: Array<{ id: string; text: string; hash: string }> = []
    Database.use((db) => {
      const rows = db.select().from(CatalogEntryTable).all()
      for (const row of rows) {
        if (filter && !filter.has(row.id)) continue
        const text = CatalogEmbedding.entryEmbedText(row)
        if (!CatalogEmbedding.needsEmbedding(row, text, model)) continue
        pending.push({ id: row.id, text, hash: CatalogEmbedding.embedSourceHash(text) })
      }
    })
    if (pending.length === 0) return 0

    const vectors = await CatalogEmbedding.embedTextsAsync(
      pending.map((item) => item.text),
      model,
    )
    Database.use((db) => {
      pending.forEach((item, index) => {
        const vector = vectors[index]
        if (!vector) return
        db.update(CatalogEntryTable)
          .set({
            embedding_json: vector,
            embedding_model: model.id,
            embedding_source_hash: item.hash,
          })
          .where(eq(CatalogEntryTable.id, item.id))
          .run()
      })
    })
    return pending.length
  } finally {
    embedRunning = false
  }
}

export async function embedCatalogAsync(input?: { mode?: CatalogEmbedding.EmbedMode }) {
  return embedCatalogEntriesAsync(undefined, input)
}

export function reconcile(input?: { projectDir?: string; syncSkills?: boolean; embed?: boolean }) {
  const primitiveCount = syncPrimitives()
  const skillCount = input?.syncSkills ? ingestSkills({ projectDir: input.projectDir }) : 0
  const embedded = input?.embed ? embedCatalog() : 0
  if (!input?.embed) {
    const model = CatalogEmbedding.resolveEmbedModel()
    if (model && pendingEmbedIds(model).length > 0) schedulePendingEmbeds()
  }
  return { primitiveCount, skillCount, embedded }
}

function syncCatalogFromRuntime(
  directory: string,
  runtime: Array<{ name: string; description?: string; location: string }> | undefined,
) {
  if (runtime) return syncRuntimeSkills(runtime, directory)
  return ingestSkills({ projectDir: directory })
}

export function initAutoSync() {
  if (autoSyncReady) return
  autoSyncReady = true
  GlobalBus.on("event", (evt) => {
    const type = evt.payload?.type
    const directory = evt.directory
    if (!directory) return
    if (type === "skill.updated") {
      const runtime = (evt.payload?.properties as { skills?: SkillInput[] } | undefined)?.skills
      syncCatalogFromRuntime(directory, runtime)
      return
    }
    if (type !== "file.watcher.updated") return
    if (Flag.OPENCODE_HOT_RELOAD) return
    const file = (evt.payload?.properties as { file?: string } | undefined)?.file
    if (!file?.replaceAll("\\", "/").endsWith("SKILL.md")) return
    ingestSkills({ projectDir: directory })
  })
}

export function bootstrap(input?: { projectDir?: string; syncSkills?: boolean }) {
  initAutoSync()
  reconcile({
    projectDir: input?.projectDir,
    syncSkills: input?.syncSkills ?? Boolean(input?.projectDir),
  })
}

export function listEntryIds(kind?: Kind) {
  return Database.use((db) => {
    const rows = db
      .select({ id: CatalogEntryTable.id })
      .from(CatalogEntryTable)
      .where(kind ? eq(CatalogEntryTable.kind, kind) : undefined)
      .all()
    return rows.map((row) => row.id)
  })
}

export function removeMissingSkills(
  activeNames: string[],
  options?: { accountId?: string; skills?: SkillInput[] },
) {
  const active = new Set(
    (options?.skills ?? activeNames.map((name) => ({ name, location: "" }))).map((item) =>
      skillId(item.name, accountIdFromSkillLocation(item.location)),
    ),
  )
  // Also keep legacy unscoped ids for names present in this sync when no account scope.
  for (const name of activeNames) active.add(skillId(name))

  Database.use((db) => {
    const rows = db
      .select()
      .from(CatalogEntryTable)
      .where(eq(CatalogEntryTable.kind, "skill"))
      .all()
    const stale = rows
      .filter((row) => {
        if (active.has(row.id)) return false
        const owner = catalogEntryOwner(row)
        if (owner && options?.accountId && owner !== options.accountId) return false
        if (owner && !options?.accountId && !isOfficialOneSkillsEntry(row)) return false
        return true
      })
      .map((row) => row.id)
    if (stale.length === 0) return
    db.delete(CatalogEntryTable).where(inArray(CatalogEntryTable.id, stale)).run()
  })
}

export * as Catalog from "./index"
