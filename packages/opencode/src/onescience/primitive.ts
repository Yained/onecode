import { removePrimitiveFromCatalog, syncPrimitiveFromRecord } from "@/catalog/index"
import { Database } from "@/storage/db"
import { and, count as sqlCount, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { Schema } from "effect"
import { assertAlreadyDatasetRefs } from "./data-catalog"
import { AIPrimitiveTable } from "./primitive.sql"
import { OneScienceResourceTable } from "./resource.sql"
import { OneSciencePrimitiveResourceTable } from "./skill.sql"
import { OneScienceTaxonomy, type CapabilityFamilyID, type ExecutionSkillID, type PrimitiveType as TargetPrimitiveType } from "./taxonomy"

export const PrimitiveType = Schema.Union([
  Schema.Literal("data.load"),
  Schema.Literal("data.transform"),
  Schema.Literal("model"),
  Schema.Literal("model.run"),
  Schema.Literal("model.train"),
  Schema.Literal("model.evaluate"),
  Schema.Literal("app.launch"),
  Schema.Literal("operator.apply"),
  Schema.Literal("code.generate"),
  Schema.Literal("workflow.compose"),
  Schema.Literal("runtime.submit"),
])
export type PrimitiveType = typeof PrimitiveType.Type

export const PrimitiveStatus = Schema.Union([
  Schema.Literal("draft"),
  Schema.Literal("callable"),
])
export type PrimitiveStatus = typeof PrimitiveStatus.Type

export const RESOURCE_PRIMITIVE_SLOTS: Record<string, readonly string[]> = {
  datasets: ["dataset", "data-processing"],
  models: ["model", "model-inference", "model-training"],
  apps: ["app"],
  frameworks: ["code-asset"],
}

export const AdapterMode = Schema.Union([
  Schema.Literal("documentation"),
  Schema.Literal("code_reference"),
  Schema.Literal("script"),
  Schema.Literal("http"),
  Schema.Literal("mcp"),
  Schema.Literal("workflow"),
])
export type AdapterMode = typeof AdapterMode.Type

export const PrimitiveResource = Schema.Struct({
  id: Schema.String,
  page: Schema.String,
  title: Schema.String,
  relationType: Schema.String,
}).annotate({ identifier: "AIPrimitiveResource" })
export type PrimitiveResource = typeof PrimitiveResource.Type

export const Primitive = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  title: Schema.String,
  description: Schema.String,
  domain: Schema.String,
  primitiveType: PrimitiveType,
  targetPrimitiveType: Schema.optional(Schema.String),
  capabilityFamilies: Schema.Array(Schema.String),
  taskProfiles: Schema.Array(Schema.String),
  executionSkills: Schema.Array(Schema.String),
  intentTags: Schema.Array(Schema.String),
  sourceResourceIds: Schema.optional(Schema.Array(Schema.String)),
  status: PrimitiveStatus,
  contractJson: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  adapterJson: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  validationJson: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  qualityScore: Schema.optional(Schema.Number),
  owner: Schema.optional(Schema.String),
  resources: Schema.optional(Schema.Array(PrimitiveResource)),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
}).annotate({ identifier: "AIPrimitive" })
export type Primitive = typeof Primitive.Type

export const CreatePrimitive = Schema.Struct({
  title: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
  domain: Schema.NonEmptyString,
  primitiveType: PrimitiveType,
  intentTags: Schema.Array(Schema.String),
  sourceResourceIds: Schema.optional(Schema.Array(Schema.String)),
  contractJson: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  adapterJson: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "CreateAIPrimitive" })
export type CreatePrimitive = typeof CreatePrimitive.Type

export const UpdatePrimitive = Schema.Struct({
  title: Schema.optional(Schema.NonEmptyString),
  description: Schema.optional(Schema.NonEmptyString),
  domain: Schema.optional(Schema.NonEmptyString),
  primitiveType: Schema.optional(PrimitiveType),
  intentTags: Schema.optional(Schema.Array(Schema.String)),
  status: Schema.optional(PrimitiveStatus),
  contractJson: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  adapterJson: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  validationJson: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  qualityScore: Schema.optional(Schema.Number),
  owner: Schema.optional(Schema.String),
}).annotate({ identifier: "UpdateAIPrimitive" })
export type UpdatePrimitive = typeof UpdatePrimitive.Type

export const PublishPrimitive = Schema.Struct({
  title: Schema.optional(Schema.NonEmptyString),
  description: Schema.optional(Schema.NonEmptyString),
  domain: Schema.optional(Schema.NonEmptyString),
  primitiveType: Schema.optional(PrimitiveType),
  intentTags: Schema.optional(Schema.Array(Schema.String)),
  contractJson: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  adapterJson: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  validationJson: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "PublishAIPrimitive" })
export type PublishPrimitive = typeof PublishPrimitive.Type

export const PrimitiveCategoryLink = Schema.Struct({
  callable: Schema.optional(Primitive),
  draft: Schema.optional(Primitive),
}).annotate({ identifier: "AIPrimitiveCategoryLink" })
export type PrimitiveCategoryLink = typeof PrimitiveCategoryLink.Type

export const PrimitiveSourceLookup = Schema.Struct({
  callable: Schema.optional(Primitive),
  draft: Schema.optional(Primitive),
  model: Schema.optional(PrimitiveCategoryLink),
  inference: Schema.optional(PrimitiveCategoryLink),
  training: Schema.optional(PrimitiveCategoryLink),
  slots: Schema.optional(Schema.Record(Schema.String, PrimitiveCategoryLink)),
}).annotate({ identifier: "AIPrimitiveSourceLookup" })
export type PrimitiveSourceLookup = typeof PrimitiveSourceLookup.Type

export const OWNER_SYSTEM = "system"
export const OWNER_PLATFORM = "platform"

export type AccountScope = {
  accountId?: string
}

export function isSharedOwner(owner: string | null | undefined) {
  return !owner || owner === OWNER_SYSTEM || owner === OWNER_PLATFORM || owner === "local"
}

export function isVisibleToAccount(
  owner: string | null | undefined,
  accountId: string | undefined,
  id?: string,
) {
  // Empty string = guest / anonymous: presets only (not other users' or communal residue).
  if (accountId === "") {
    if (id) return isPresetPrimitive({ id, owner })
    return owner === OWNER_SYSTEM || owner === OWNER_PLATFORM || owner === "local"
  }
  if (!accountId) return true
  if (isSharedOwner(owner)) return true
  return owner === accountId
}

export function isBuiltinStaticPrimitive(row: { id: string; owner?: string | null }) {
  return row.owner === OWNER_SYSTEM
}

export function isPlatformTemplate(row: { owner?: string | null }) {
  return row.owner === OWNER_PLATFORM || row.owner === "local"
}

/** User-created draft/callable ids (`primitive-<uuid>`), not resource-derived `primitive-resource-*`. */
export function isUserCreatedPrimitiveId(id: string) {
  return /^primitive-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}

/** Seed OneHub templates: `primitive-resource-seed-…` — presets, never user-deletable. */
export function isSeedResourcePrimitiveId(id: string) {
  return id.startsWith("primitive-resource-seed-")
}

/** User-uploaded resource drafts: `primitive-resource-custom-…`. */
export function isCustomResourcePrimitiveId(id: string) {
  return id.startsWith("primitive-resource-custom-")
}

/** Protected presets: system oneskills + seed resource-derived platform templates. */
export function isPresetPrimitive(row: { id: string; owner?: string | null }) {
  if (row.owner === OWNER_SYSTEM) return true
  if (!(row.owner === OWNER_PLATFORM || row.owner === "local")) return false
  if (isSeedResourcePrimitiveId(row.id)) return true
  // Legacy resource-derived ids that are not custom uploads.
  if (row.id.startsWith("primitive-resource-") && !isCustomResourcePrimitiveId(row.id)) return true
  return false
}

/** Pre-auth / communal residue any signed-in user may delete. */
export function isCommunalPrimitive(row: { id: string; owner?: string | null }) {
  if (isPresetPrimitive(row)) return false
  if (!row.owner) return true
  if ((row.owner === OWNER_PLATFORM || row.owner === "local") && isUserCreatedPrimitiveId(row.id)) return true
  if ((row.owner === OWNER_PLATFORM || row.owner === "local") && isCustomResourcePrimitiveId(row.id)) return true
  // User-created UUID drafts from before account binding — treat as communal.
  if (isUserCreatedPrimitiveId(row.id) && (row.owner === OWNER_PLATFORM || row.owner === "local" || !row.owner)) return true
  return false
}

function ownerVisibilitySql(accountId: string | undefined) {
  if (accountId === undefined) return undefined
  if (accountId === "") {
    // Guests: system builtins + seed/platform resource templates only.
    return sql`(
      ${AIPrimitiveTable.owner} = ${OWNER_SYSTEM}
      OR (
        ${AIPrimitiveTable.owner} IN (${OWNER_PLATFORM}, 'local')
        AND ${AIPrimitiveTable.id} LIKE 'primitive-resource-%'
        AND ${AIPrimitiveTable.id} NOT LIKE 'primitive-resource-custom-%'
      )
    )`
  }
  return sql`(
    ${AIPrimitiveTable.owner} IS NULL
    OR ${AIPrimitiveTable.owner} IN ('system', 'platform', 'local')
    OR ${AIPrimitiveTable.owner} = ${accountId}
  )`
}

function summaryContract(contractJson: Record<string, unknown> | null | undefined) {
  if (!contractJson || typeof contractJson.primitiveCategory !== "string") return undefined
  return { primitiveCategory: contractJson.primitiveCategory }
}

function fromRow(row: typeof AIPrimitiveTable.$inferSelect): Primitive {
  const targetPrimitiveType = resolveTargetPrimitiveType(row.primitive_type, row.contract_json)
  const capabilityFamilies = resolveCapabilityFamilies(targetPrimitiveType)
  const taskProfiles = resolveTaskProfiles(targetPrimitiveType, capabilityFamilies)
  const executionSkills = resolveExecutionSkills(taskProfiles, row.contract_json)
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    domain: row.domain,
    primitiveType: row.primitive_type as PrimitiveType,
    ...(targetPrimitiveType ? { targetPrimitiveType } : {}),
    capabilityFamilies,
    taskProfiles,
    executionSkills,
    intentTags: row.intent_tags,
    sourceResourceIds: row.source_resource_ids ?? undefined,
    status: row.status as PrimitiveStatus,
    contractJson: row.contract_json ?? undefined,
    adapterJson: row.adapter_json ?? undefined,
    validationJson: row.validation_json ?? undefined,
    qualityScore: row.quality_score ?? undefined,
    owner: row.owner ?? undefined,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

function fromRowSummary(row: typeof AIPrimitiveTable.$inferSelect): Primitive {
  const full = fromRow(row)
  return {
    ...full,
    contractJson: summaryContract(row.contract_json ?? undefined),
    adapterJson: undefined,
    validationJson: undefined,
  }
}

function resolveTargetPrimitiveType(primitiveType: string, contractJson: Record<string, unknown> | null) {
  if (typeof contractJson?.targetPrimitiveType === "string") return OneScienceTaxonomy.normalizePrimitiveType(contractJson.targetPrimitiveType)
  return OneScienceTaxonomy.normalizePrimitiveType(primitiveType)
}

function resolveCapabilityFamilies(targetPrimitiveType: TargetPrimitiveType | undefined) {
  if (!targetPrimitiveType) return []
  return OneScienceTaxonomy.capabilityFamilies
    .filter((item) => item.primitiveTypes.some((primitiveType) => primitiveType === targetPrimitiveType))
    .map((item) => item.id)
}

function resolveTaskProfiles(targetPrimitiveType: TargetPrimitiveType | undefined, capabilityFamilies: CapabilityFamilyID[]) {
  if (!targetPrimitiveType) return []
  return OneScienceTaxonomy.taskProfiles
    .filter((item) => item.requiredPrimitiveTypes.some((primitiveType) => primitiveType === targetPrimitiveType) || item.optionalPrimitiveTypes.some((primitiveType) => primitiveType === targetPrimitiveType))
    .filter((item) => item.capabilityFamilies.some((capability) => capabilityFamilies.includes(capability)))
    .map((item) => item.id)
}

function resolveExecutionSkills(taskProfileIds: string[], contractJson: Record<string, unknown> | null) {
  const fromProfiles = [...new Set(taskProfileIds.flatMap((id) => OneScienceTaxonomy.getTaskProfile(id)?.executionSkills ?? []))]
  const skills = fromProfiles.filter((item): item is ExecutionSkillID => typeof item === "string" && OneScienceTaxonomy.executionSkills.some((skill) => skill === item))
  if (skills.length > 0) return skills
  if (!Array.isArray(contractJson?.boundSkills)) return []
  return contractJson.boundSkills.filter((item): item is ExecutionSkillID => typeof item === "string" && OneScienceTaxonomy.executionSkills.some((skill) => skill === item))
}

export function list(input?: {
  status?: PrimitiveStatus
  domain?: string
  primitiveType?: PrimitiveType
  limit?: number
  offset?: number
  summary?: boolean
  accountId?: string
}) {
  const limit = Math.max(1, Math.min(input?.limit ?? 24, 100))
  const offset = Math.max(0, input?.offset ?? 0)
  const toItem = input?.summary ? fromRowSummary : fromRow

  return Database.use((db) => {
    const rows = db
      .select()
      .from(AIPrimitiveTable)
      .where(
        and(
          input?.status ? eq(AIPrimitiveTable.status, input.status) : undefined,
          input?.domain ? eq(AIPrimitiveTable.domain, input.domain) : undefined,
          input?.primitiveType ? eq(AIPrimitiveTable.primitive_type, input.primitiveType) : undefined,
          isNull(AIPrimitiveTable.time_deleted),
          ownerVisibilitySql(input?.accountId),
        ),
      )
      .orderBy(desc(AIPrimitiveTable.time_created), desc(AIPrimitiveTable.id))
      .limit(limit + 1)
      .offset(offset)
      .all()

    return {
      items: rows.slice(0, limit).map(toItem),
      nextOffset: rows.length > limit ? offset + limit : undefined,
    }
  })
}

export function count(input?: { status?: PrimitiveStatus; domain?: string; primitiveType?: PrimitiveType; accountId?: string }) {
  return Database.use((db) => {
    const row = db
      .select({ total: sqlCount() })
      .from(AIPrimitiveTable)
      .where(
        and(
          input?.status ? eq(AIPrimitiveTable.status, input.status) : undefined,
          input?.domain ? eq(AIPrimitiveTable.domain, input.domain) : undefined,
          input?.primitiveType ? eq(AIPrimitiveTable.primitive_type, input.primitiveType) : undefined,
          isNull(AIPrimitiveTable.time_deleted),
          ownerVisibilitySql(input?.accountId),
        ),
      )
      .get()
    return Number(row?.total ?? 0)
  })
}


export function listWithResources(input?: {
  status?: PrimitiveStatus
  domain?: string
  primitiveType?: PrimitiveType
  limit?: number
  offset?: number
  summary?: boolean
  accountId?: string
}) {
  const result = list(input)
  if (input?.summary) return result
  return Database.use((db) => {
    const primitiveIds = result.items.map((item) => item.id)
    const relations = primitiveIds.length === 0
      ? []
      : db
        .select()
        .from(OneSciencePrimitiveResourceTable)
        .where(and(inArray(OneSciencePrimitiveResourceTable.primitive_id, primitiveIds), isNull(OneSciencePrimitiveResourceTable.time_deleted)))
        .all()
    const resourceIds = [...new Set(relations.map((item) => item.resource_id))]
    const resources = resourceIds.length === 0
      ? []
      : db
        .select()
        .from(OneScienceResourceTable)
        .where(and(inArray(OneScienceResourceTable.id, resourceIds), isNull(OneScienceResourceTable.time_deleted)))
        .all()
    return {
      ...result,
      items: result.items.map((primitive) => ({
        ...primitive,
        resources: relations
          .filter((relation) => relation.primitive_id === primitive.id)
          .map((relation) => {
            const resource = resources.find((item) => item.id === relation.resource_id)
            if (!resource) return
            return {
              id: resource.id,
              page: resource.page,
              title: resource.title,
              relationType: relation.relation_type,
            }
          })
          .filter((item): item is PrimitiveResource => !!item),
      })),
    }
  })
}

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 100)
}

export function publishReadinessErrors(row: typeof AIPrimitiveTable.$inferSelect) {
  const errors: string[] = []
  if (!row.title.trim()) errors.push("title is required")
  if (!row.description.trim()) errors.push("description is required")
  if (!row.domain.trim()) errors.push("domain is required")
  if (!row.intent_tags.length) errors.push("intentTags is required")
  const contract = row.contract_json
  if (!contract || typeof contract !== "object") {
    errors.push("contractJson is required")
  } else {
    if (typeof contract.primitiveCategory !== "string" || !contract.primitiveCategory.trim()) {
      errors.push("contractJson.primitiveCategory is required")
    }
    if (row.source_resource_ids?.length) {
      const agentContract = contract.agentContract
      const resourceContract =
        agentContract && typeof agentContract === "object"
          ? (agentContract as Record<string, unknown>).resourceContract
          : undefined
      const requiredInputs =
        resourceContract && typeof resourceContract === "object" && Array.isArray((resourceContract as Record<string, unknown>).requiredInputs)
          ? (resourceContract as { requiredInputs: unknown[] }).requiredInputs.filter((item): item is string => typeof item === "string")
          : []
      if (!requiredInputs.length) errors.push("contractJson.agentContract.resourceContract.requiredInputs is required")
    }
  }
  const adapter = row.adapter_json
  if (!adapter || typeof adapter !== "object" || typeof adapter.mode !== "string" || !adapter.mode.trim()) {
    errors.push("adapterJson.mode is required")
  }
  return errors
}

function primitiveUiCategory(primitive: Primitive) {
  const category = primitive.contractJson?.primitiveCategory
  return typeof category === "string" ? category : undefined
}

function inferResourcePage(resourceId: string, explicitPage?: string) {
  if (explicitPage) return explicitPage
  if (resourceId.startsWith("seed-datasets-")) return "datasets"
  if (resourceId.startsWith("seed-models-")) return "models"
  if (resourceId.startsWith("seed-apps-")) return "apps"
  return undefined
}

function resourceLookupAliases(db: Parameters<Parameters<typeof Database.use>[0]>[0], resourceId: string) {
  const aliases = new Set<string>([resourceId])
  const candidates = new Set<string>([
    resourceId,
    `seed-datasets-${resourceId}`,
    `seed-models-${resourceId}`,
    `seed-apps-${resourceId}`,
  ])
  if (resourceId.startsWith("seed-datasets-")) candidates.add(resourceId.slice("seed-datasets-".length))
  if (resourceId.startsWith("seed-models-")) candidates.add(resourceId.slice("seed-models-".length))
  if (resourceId.startsWith("seed-apps-")) candidates.add(resourceId.slice("seed-apps-".length))

  const rows = db
    .select({ id: OneScienceResourceTable.id })
    .from(OneScienceResourceTable)
    .where(and(inArray(OneScienceResourceTable.id, [...candidates]), isNull(OneScienceResourceTable.time_deleted)))
    .all()

  for (const row of rows) {
    aliases.add(row.id)
    if (row.id.startsWith("seed-datasets-")) aliases.add(row.id.slice("seed-datasets-".length))
    if (row.id.startsWith("seed-models-")) aliases.add(row.id.slice("seed-models-".length))
    if (row.id.startsWith("seed-apps-")) aliases.add(row.id.slice("seed-apps-".length))
  }
  return [...aliases]
}

function resolveResourceContext(db: Parameters<Parameters<typeof Database.use>[0]>[0], resourceId: string) {
  const aliases = resourceLookupAliases(db, resourceId)
  const resource = db
    .select({ id: OneScienceResourceTable.id, page: OneScienceResourceTable.page })
    .from(OneScienceResourceTable)
    .where(and(inArray(OneScienceResourceTable.id, aliases), isNull(OneScienceResourceTable.time_deleted)))
    .get()
  const canonical = resource?.id ?? aliases.find((item) => item.startsWith("seed-datasets-") || item.startsWith("seed-models-") || item.startsWith("seed-apps-")) ?? resourceId
  return {
    aliases,
    canonical,
    page: inferResourcePage(canonical, resource?.page),
  }
}

function resourceCardPrimitiveCategories(resourcePage: string | undefined) {
  if (!resourcePage) return undefined
  return RESOURCE_PRIMITIVE_SLOTS[resourcePage]
}

function countsForResourceCard(primitive: Primitive, resourcePage: string | undefined, kind: "callable" | "draft") {
  if (primitive.id.startsWith("primitive-data-")) return false
  const category = primitiveUiCategory(primitive)
  if (kind === "draft" && !category) return true
  if (!category) return false
  const allowed = resourceCardPrimitiveCategories(resourcePage)
  if (!allowed) return category !== "data-processing"
  return allowed.includes(category)
}

function slotLink(items: Primitive[], category: string, resourcePage: string | undefined, kind: "callable" | "draft") {
  const matched = items.filter((item) => {
    if (primitiveUiCategory(item) !== category) return false
    return countsForResourceCard(item, resourcePage, kind)
  })
  if (kind === "callable") return matched.find((item) => item.status === "callable")
  return matched.find((item) => item.status === "draft")
}

function sourceLookupFromItems(items: Primitive[], resourcePage?: string, accountId?: string) {
  const visible = items.filter((item) => isVisibleToAccount(item.owner, accountId, item.id))
  const slotCategories = resourcePage ? RESOURCE_PRIMITIVE_SLOTS[resourcePage] : undefined
  const slots: Record<string, PrimitiveCategoryLink> = {}

  if (slotCategories) {
    for (const category of slotCategories) {
      const callable = slotLink(visible, category, resourcePage, "callable")
      const draft = callable ? undefined : slotLink(visible, category, resourcePage, "draft")
      if (callable || draft) slots[category] = { callable, draft }
    }
  }

  const callableItems = Object.values(slots).flatMap((link) => (link.callable ? [link.callable] : []))
  const draftItems = Object.values(slots).flatMap((link) => (link.draft ? [link.draft] : []))

  if (slotCategories) {
    const callable = callableItems[0] ?? visible.find((item) => item.status === "callable" && countsForResourceCard(item, resourcePage, "callable"))
    const draft = draftItems[0] ?? (callable ? undefined : visible.find((item) => item.status === "draft" && countsForResourceCard(item, resourcePage, "draft")))
    return {
      callable,
      draft,
      model: slots["model"],
      inference: slots["model-inference"],
      training: slots["model-training"],
      slots,
    } satisfies PrimitiveSourceLookup
  }

  const callable = visible.find((item) => item.status === "callable" && countsForResourceCard(item, resourcePage, "callable"))
  const draft = callable
    ? undefined
    : visible.find((item) => item.status === "draft" && countsForResourceCard(item, resourcePage, "draft"))
  return {
    callable,
    draft,
    slots: Object.keys(slots).length ? slots : undefined,
  } satisfies PrimitiveSourceLookup
}

function primitiveMatchesResourceAliases(
  primitive: Primitive,
  relationRows: { resource_id: string; primitive_id: string }[],
  aliases: string[],
) {
  const aliasSet = new Set(aliases)
  const sources = primitive.sourceResourceIds ?? []
  if (sources.some((resourceId) => aliasSet.has(resourceId))) return true
  return relationRows.some((relation) => {
    if (relation.primitive_id !== primitive.id) return false
    if (!aliasSet.has(relation.resource_id)) return false
    if (sources.length === 0) return true
    return sources.includes(relation.resource_id)
  })
}

function lookupBySourceResourceRows(db: Parameters<Parameters<typeof Database.use>[0]>[0], aliases: string[]) {
  const resourceIds = [...new Set(aliases)]
  const sourceCandidates = db
    .select()
    .from(AIPrimitiveTable)
    .where(and(isNull(AIPrimitiveTable.time_deleted), sql`${AIPrimitiveTable.source_resource_ids} IS NOT NULL`))
    .all()

  const linkedRows = db
    .select({ primitive_id: OneSciencePrimitiveResourceTable.primitive_id, resource_id: OneSciencePrimitiveResourceTable.resource_id })
    .from(OneSciencePrimitiveResourceTable)
    .where(and(inArray(OneSciencePrimitiveResourceTable.resource_id, resourceIds), isNull(OneSciencePrimitiveResourceTable.time_deleted)))
    .all()

  const linkedIds = linkedRows
    .filter((row) => {
      const sourceRow = sourceCandidates.find((item) => item.id === row.primitive_id)
      if (!sourceRow) return true
      const sources = sourceRow.source_resource_ids ?? []
      if (sources.length === 0) return true
      return sources.includes(row.resource_id)
    })
    .map((row) => row.primitive_id)

  const sourceIds = sourceCandidates
    .filter((row) => (row.source_resource_ids ?? []).some((item) => resourceIds.includes(item)))
    .map((row) => row.id)

  const primitiveIds = [...new Set([...linkedIds, ...sourceIds])]
  if (primitiveIds.length === 0) return []

  return db
    .select()
    .from(AIPrimitiveTable)
    .where(and(inArray(AIPrimitiveTable.id, primitiveIds), isNull(AIPrimitiveTable.time_deleted)))
    .all()
    .map(fromRow)
}

function primitivesForResourceAliases(primitives: Primitive[], relationRows: { resource_id: string; primitive_id: string }[], aliases: string[]) {
  return [...new Map(
    primitives
      .filter((primitive) => primitiveMatchesResourceAliases(primitive, relationRows, aliases))
      .map((item) => [item.id, item]),
  ).values()]
}

export function lookupBySourceResource(resourceId: string, accountId?: string) {
  return Database.use((db) => {
    const context = resolveResourceContext(db, resourceId)
    return sourceLookupFromItems(lookupBySourceResourceRows(db, context.aliases), context.page, accountId)
  })
}

export function lookupBySourceResources(resourceIds: string[], accountId?: string) {
  const ids = [...new Set(resourceIds.filter(Boolean))]
  if (ids.length === 0) return {} as Record<string, PrimitiveSourceLookup>

  return Database.use((db) => {
    const contexts = Object.fromEntries(ids.map((resourceId) => [resourceId, resolveResourceContext(db, resourceId)]))
    const allAliases = [...new Set(ids.flatMap((resourceId) => contexts[resourceId].aliases))]

    const relationRows = db
      .select({
        resource_id: OneSciencePrimitiveResourceTable.resource_id,
        primitive_id: OneSciencePrimitiveResourceTable.primitive_id,
      })
      .from(OneSciencePrimitiveResourceTable)
      .where(and(inArray(OneSciencePrimitiveResourceTable.resource_id, allAliases), isNull(OneSciencePrimitiveResourceTable.time_deleted)))
      .all()

    const sourceCandidates = db
      .select()
      .from(AIPrimitiveTable)
      .where(and(isNull(AIPrimitiveTable.time_deleted), sql`${AIPrimitiveTable.source_resource_ids} IS NOT NULL`))
      .all()

    const primitiveIds = new Set(relationRows.map((row) => row.primitive_id))
    for (const row of sourceCandidates) {
      for (const resourceId of row.source_resource_ids ?? []) {
        if (allAliases.includes(resourceId)) primitiveIds.add(row.id)
      }
    }

    const primitives = primitiveIds.size === 0
      ? []
      : db
        .select()
        .from(AIPrimitiveTable)
        .where(and(inArray(AIPrimitiveTable.id, [...primitiveIds]), isNull(AIPrimitiveTable.time_deleted)))
        .all()
        .map(fromRow)

    return Object.fromEntries(ids.map((resourceId) => [
      resourceId,
      sourceLookupFromItems(
        primitivesForResourceAliases(primitives, relationRows, contexts[resourceId].aliases),
        contexts[resourceId].page,
        accountId,
      ),
    ]))
  })
}

export function get(id: string, accountId?: string) {
  return Database.use((db) => {
    const row = db
      .select()
      .from(AIPrimitiveTable)
      .where(and(eq(AIPrimitiveTable.id, id), isNull(AIPrimitiveTable.time_deleted)))
      .get()

    if (!row) {
      throw new Database.NotFoundError({ message: `AI Primitive not found: ${id}` })
    }
    if (!isVisibleToAccount(row.owner, accountId, row.id)) {
      throw new Database.NotFoundError({ message: `AI Primitive not found: ${id}` })
    }

    return fromRow(row)
  })
}

export function create(input: CreatePrimitive, accountId?: string) {
  assertAlreadyDatasetRefs(input.contractJson, accountId)
  assertAlreadyDatasetRefs(input.adapterJson, accountId)
  const now = Date.now()
  const baseSlug = generateSlug(input.title)
  const slug = `${baseSlug}-${crypto.randomUUID().substring(0, 8)}`

  const row = {
    id: `primitive-${crypto.randomUUID()}`,
    slug,
    title: input.title,
    description: input.description,
    domain: input.domain,
    primitive_type: input.primitiveType,
    intent_tags: [...input.intentTags],
    source_resource_ids: input.sourceResourceIds ? [...input.sourceResourceIds] : null,
    status: "draft" as const,
    contract_json: input.contractJson ?? null,
    adapter_json: input.adapterJson ?? null,
    validation_json: null,
    quality_score: null,
    owner: accountId ?? null,
    time_created: now,
    time_updated: now,
    time_deleted: null,
  }

  Database.use((db) => db.insert(AIPrimitiveTable).values(row).run())
  const created = fromRow(row)
  syncCatalog(created)
  return created
}

export function update(id: string, input: UpdatePrimitive, accountId?: string) {
  assertAlreadyDatasetRefs(input.contractJson, accountId)
  assertAlreadyDatasetRefs(input.adapterJson, accountId)
  const updated = Database.transaction((db) => {
    const existing = db
      .select()
      .from(AIPrimitiveTable)
      .where(and(eq(AIPrimitiveTable.id, id), isNull(AIPrimitiveTable.time_deleted)))
      .get()

    if (!existing) {
      throw new Database.NotFoundError({ message: `AI Primitive not found: ${id}` })
    }
    if (!isVisibleToAccount(existing.owner, accountId, existing.id)) {
      throw new Database.NotFoundError({ message: `AI Primitive not found: ${id}` })
    }
    if (accountId && (isBuiltinStaticPrimitive(existing) || isPlatformTemplate(existing) || existing.owner !== accountId)) {
      throw new Error("Only the owning account can update this primitive")
    }

    db.update(AIPrimitiveTable)
      .set({
        title: input.title ?? existing.title,
        description: input.description ?? existing.description,
        domain: input.domain ?? existing.domain,
        primitive_type: input.primitiveType ?? existing.primitive_type,
        intent_tags: input.intentTags ? [...input.intentTags] : existing.intent_tags,
        status: input.status ?? existing.status,
        contract_json: input.contractJson !== undefined ? input.contractJson : existing.contract_json,
        adapter_json: input.adapterJson !== undefined ? input.adapterJson : existing.adapter_json,
        validation_json: input.validationJson !== undefined ? input.validationJson : existing.validation_json,
        quality_score: input.qualityScore !== undefined ? input.qualityScore : existing.quality_score,
        // Account-scoped updates keep owner fixed; unscoped (admin/tests) may set owner.
        owner: accountId
          ? existing.owner
          : input.owner !== undefined
            ? input.owner.trim() || null
            : existing.owner,
        time_updated: Date.now(),
      })
      .where(eq(AIPrimitiveTable.id, id))
      .run()

    const row = db.select().from(AIPrimitiveTable).where(eq(AIPrimitiveTable.id, id)).get()
    if (!row) throw new Database.NotFoundError({ message: `AI Primitive not found: ${id}` })
    return fromRow(row)
  })
  syncCatalog(updated)
  return updated
}

export function remove(id: string, accountId?: string) {
  return Database.transaction((db) => {
    const existing = db
      .select({ id: AIPrimitiveTable.id, owner: AIPrimitiveTable.owner, status: AIPrimitiveTable.status })
      .from(AIPrimitiveTable)
      .where(and(eq(AIPrimitiveTable.id, id), isNull(AIPrimitiveTable.time_deleted)))
      .get()

    if (!existing) return false

    if (isPresetPrimitive(existing) || isBuiltinStaticPrimitive(existing)) {
      throw new Error("Built-in AI primitives cannot be deleted")
    }

    // Communal residue (no owner / user-uuid / custom-resource platform stamps): any signed-in user.
    // accountId undefined = unscoped/admin (tests); "" = guest.
    if (isCommunalPrimitive(existing)) {
      if (accountId === "") throw new Error("Login required to delete this primitive")
    } else if (isPlatformTemplate(existing)) {
      throw new Error("Built-in AI primitives cannot be deleted")
    } else if (accountId && existing.owner !== accountId) {
      throw new Error("Only the owning account can delete this primitive")
    }

    db.update(AIPrimitiveTable)
      .set({ time_deleted: Date.now(), time_updated: Date.now() })
      .where(eq(AIPrimitiveTable.id, id))
      .run()

    dropCatalog(id)
    return true
  })
}

function publishConflictSlot(row: {
  primitive_type: string
  contract_json?: Record<string, unknown> | null
}) {
  const category = row.contract_json?.primitiveCategory
  if (typeof category === "string") return category
  return row.primitive_type
}

function assertNoCallableConflict(
  db: Parameters<Parameters<typeof Database.transaction>[0]>[0],
  resourceIds: string[] | null | undefined,
  excludeId: string,
  slot: string,
  accountId?: string,
) {
  if (!resourceIds?.length) return
  const rows = db
    .select()
    .from(AIPrimitiveTable)
    .where(and(isNull(AIPrimitiveTable.time_deleted), eq(AIPrimitiveTable.status, "callable")))
    .all()
  for (const row of rows) {
    if (row.id === excludeId) continue
    if (accountId && row.owner !== accountId) continue
    if (!accountId && row.owner && !isSharedOwner(row.owner) && row.owner !== "local") continue
    if (publishConflictSlot(row) !== slot) continue
    if (resourceIds.some((resourceId) => row.source_resource_ids?.includes(resourceId))) {
      throw new Error(`A callable primitive already exists for resource: ${resourceIds.find((resourceId) => row.source_resource_ids?.includes(resourceId))}`)
    }
  }
}

export function publish(id: string, input?: PublishPrimitive, accountId?: string) {
  const callable = Database.transaction((db) => {
    const existing = db
      .select()
      .from(AIPrimitiveTable)
      .where(and(eq(AIPrimitiveTable.id, id), isNull(AIPrimitiveTable.time_deleted)))
      .get()

    if (!existing) {
      throw new Database.NotFoundError({ message: `AI Primitive not found: ${id}` })
    }

    if (!isVisibleToAccount(existing.owner, accountId, existing.id)) {
      throw new Database.NotFoundError({ message: `AI Primitive not found: ${id}` })
    }

    if (existing.status === "callable") {
      throw new Error("Primitive is already callable")
    }

    if (accountId && existing.owner && !isSharedOwner(existing.owner) && existing.owner !== accountId) {
      throw new Error("Only the owning account can publish this primitive")
    }

    const merged = {
      ...existing,
      title: input?.title ?? existing.title,
      description: input?.description ?? existing.description,
      domain: input?.domain ?? existing.domain,
      primitive_type: input?.primitiveType ?? existing.primitive_type,
      intent_tags: input?.intentTags ? [...input.intentTags] : existing.intent_tags,
      contract_json: input?.contractJson !== undefined ? input.contractJson : existing.contract_json,
      adapter_json: input?.adapterJson !== undefined ? input.adapterJson : existing.adapter_json,
      validation_json: input?.validationJson !== undefined ? input.validationJson : existing.validation_json,
      time_updated: Date.now(),
    }
    assertAlreadyDatasetRefs(merged.contract_json, accountId)
    assertAlreadyDatasetRefs(merged.adapter_json, accountId)

    const errors = publishReadinessErrors(merged)
    if (errors.length) {
      throw new Error(`Primitive is not ready to publish: ${errors.join(", ")}`)
    }

    const slot = publishConflictSlot(merged)
    assertNoCallableConflict(db, merged.source_resource_ids, id, slot, accountId)

    const copyOnPublish = !!accountId && (isSharedOwner(existing.owner) || existing.owner !== accountId)
    if (copyOnPublish) {
      const copyId = `primitive-${crypto.randomUUID()}`
      const accountSuffix = accountId.replace(/^acct-/, "").slice(0, 8)
      const copySlug = `${existing.slug}-${accountSuffix}-${crypto.randomUUID().substring(0, 6)}`
      const row = {
        id: copyId,
        slug: copySlug,
        title: merged.title,
        description: merged.description,
        domain: merged.domain,
        primitive_type: merged.primitive_type,
        intent_tags: merged.intent_tags,
        source_resource_ids: merged.source_resource_ids,
        status: "callable" as const,
        contract_json: merged.contract_json,
        adapter_json: merged.adapter_json,
        validation_json: merged.validation_json,
        quality_score: existing.quality_score,
        owner: accountId,
        time_created: Date.now(),
        time_updated: merged.time_updated,
        time_deleted: null,
      }
      db.insert(AIPrimitiveTable).values(row).run()
      return fromRow(row)
    }

    db.update(AIPrimitiveTable)
      .set({
        title: merged.title,
        description: merged.description,
        domain: merged.domain,
        primitive_type: merged.primitive_type,
        intent_tags: merged.intent_tags,
        contract_json: merged.contract_json,
        adapter_json: merged.adapter_json,
        validation_json: merged.validation_json,
        status: "callable",
        owner: accountId ?? existing.owner ?? OWNER_PLATFORM,
        time_updated: merged.time_updated,
      })
      .where(eq(AIPrimitiveTable.id, id))
      .run()

    const row = db.select().from(AIPrimitiveTable).where(eq(AIPrimitiveTable.id, id)).get()
    if (!row) throw new Database.NotFoundError({ message: `AI Primitive not found: ${id}` })
    return fromRow(row)
  })
  syncCatalog(callable)
  return callable
}

function syncCatalog(primitive: Primitive) {
  syncPrimitiveFromRecord(primitive)
}

function dropCatalog(id: string) {
  removePrimitiveFromCatalog(id)
}

export * as AIPrimitive from "./primitive"
