import { Database } from "@/storage/db"
import { and, eq, isNull } from "drizzle-orm"
import { create as createPrimitive, update as updatePrimitive } from "./primitive"
import { OneScienceDataArtifactTable } from "./data-project.sql"
import { CatalogError } from "./catalog-error"
import { getAlready } from "./data-catalog"

export type AlreadyPrimitiveFields = {
  title?: string
  description?: string
  data_schema?: string
  usage_notes?: string
}

export type AlreadyPrimitiveBindResult = {
  already_id: string
  primitive_id: string
  primitive_complete: true
}

function notFound(message: string) {
  return new CatalogError(404, "not_found", message)
}

function badRequest(message: string) {
  return new CatalogError(400, "bad_request", message)
}

function findAlreadyRow(db: Database.TxOrDb, id: string) {
  return db
    .select()
    .from(OneScienceDataArtifactTable)
    .where(
      and(
        isNull(OneScienceDataArtifactTable.time_deleted),
        eq(OneScienceDataArtifactTable.artifact_type, "ai_ready_dataset"),
        eq(OneScienceDataArtifactTable.public_id, id),
      ),
    )
    .get()
    ?? db
      .select()
      .from(OneScienceDataArtifactTable)
      .where(
        and(
          isNull(OneScienceDataArtifactTable.time_deleted),
          eq(OneScienceDataArtifactTable.artifact_type, "ai_ready_dataset"),
          eq(OneScienceDataArtifactTable.id, id),
        ),
      )
      .get()
}

function metaOf(row: typeof OneScienceDataArtifactTable.$inferSelect) {
  return (row.metadata_json && typeof row.metadata_json === "object" ? { ...row.metadata_json } : {}) as Record<string, unknown>
}

/** Whether this Already has a bound data.load primitive from our bind flow. */
export function alreadyPrimitiveComplete(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata || typeof metadata !== "object") return false
  return metadata.primitive_complete === true && typeof metadata.primitive_id === "string" && !!metadata.primitive_id
}

export function alreadyPrimitiveId(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata || typeof metadata !== "object") return undefined
  return typeof metadata.primitive_id === "string" && metadata.primitive_id ? metadata.primitive_id : undefined
}

/**
 * Create or update a private data.load primitive bound to this Already (datasetRefs = alr_*).
 * Soft-binding: convert can succeed without this; calling this marks primitive_complete.
 */
export function bindAlreadyPrimitive(input: {
  alreadyId: string
  accountId: string
  fields?: AlreadyPrimitiveFields
}) {
  if (!input.accountId) throw new CatalogError(401, "unauthorized", "Login required")
  const already = getAlready(input.alreadyId, { accountId: input.accountId })
  if (!already) throw notFound("Already dataset not found")
  if (already.owner !== input.accountId) throw new CatalogError(403, "forbidden", "Not the owner of this Already dataset")
  if (already.status !== "ready") throw badRequest("Only ready Already datasets can bind a dataset primitive")

  const title = (input.fields?.title?.trim() || already.title).trim()
  if (!title) throw badRequest("title is required")
  const description =
    input.fields?.description?.trim()
    || input.fields?.usage_notes?.trim()
    || `${title}（可训练数据，供 Agent 加载）`
  const dataSchema = input.fields?.data_schema?.trim() || already.format || ""
  const usageNotes = input.fields?.usage_notes?.trim() || ""

  const contractJson: Record<string, unknown> = {
    primitiveCategory: "dataset",
    primitiveType: "data.load",
    datasetRefs: [already.id],
    ...(dataSchema ? { dataSchema } : {}),
    ...(usageNotes ? { usageNotes } : {}),
  }
  const adapterJson: Record<string, unknown> = {
    mode: "documentation",
    alreadyId: already.id,
    uri: already.uri,
    format: already.format,
  }

  const row = Database.use((db) => findAlreadyRow(db, already.id))
  if (!row) throw notFound("Already dataset not found")
  const meta = metaOf(row)
  const existingId = alreadyPrimitiveId(meta)

  let primitive
  if (existingId) {
    try {
      primitive = updatePrimitive(
        existingId,
        {
          title,
          description,
          domain: "其它",
          intentTags: ["onedata", "already"],
          contractJson,
          adapterJson,
          status: "draft",
        },
        input.accountId,
      )
    } catch {
      primitive = createPrimitive(
        {
          title,
          description,
          domain: "其它",
          primitiveType: "data.load",
          intentTags: ["onedata", "already"],
          contractJson,
          adapterJson,
        },
        input.accountId,
      )
    }
  } else {
    primitive = createPrimitive(
      {
        title,
        description,
        domain: "其它",
        primitiveType: "data.load",
        intentTags: ["onedata", "already"],
        contractJson,
        adapterJson,
      },
      input.accountId,
    )
  }

  const now = Date.now()
  Database.use((db) => {
    db.update(OneScienceDataArtifactTable)
      .set({
        metadata_json: {
          ...meta,
          primitive_id: primitive.id,
          primitive_complete: true,
        },
        time_updated: now,
      })
      .where(eq(OneScienceDataArtifactTable.id, row.id))
      .run()
  })

  return {
    already_id: already.id,
    primitive_id: primitive.id,
    primitive_complete: true as const,
  } satisfies AlreadyPrimitiveBindResult
}

export * as AlreadyPrimitive from "./already-primitive"
