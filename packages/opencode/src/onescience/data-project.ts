import { Database } from "@/storage/db"
import { Identifier } from "@/id/id"
import { and, desc, eq, isNull } from "drizzle-orm"
import { Schema } from "effect"
import {
  OneScienceDataAgentRunTable,
  OneScienceDataArtifactTable,
  OneScienceDataProjectTable,
  OneScienceDataQualityReportTable,
  OneScienceDataReleaseTable,
} from "./data-project.sql"
import { OneScienceResource } from "./resource"

export const ProjectStatus = Schema.Union([
  Schema.Literal("draft"),
  Schema.Literal("submitted"),
  Schema.Literal("analyzing"),
  Schema.Literal("plan_ready"),
  Schema.Literal("building"),
  Schema.Literal("ai_ready"),
  Schema.Literal("training_linked"),
  Schema.Literal("publish_pending"),
  Schema.Literal("published"),
  Schema.Literal("failed"),
])
export type ProjectStatus = typeof ProjectStatus.Type

export const RunType = Schema.Union([
  Schema.Literal("profile"),
  Schema.Literal("plan"),
  Schema.Literal("build_ai_ready"),
  Schema.Literal("training_handoff"),
  Schema.Literal("publish_onehub"),
  Schema.Literal("paper_reproduction"),
  Schema.Literal("performance_optimization"),
  Schema.Literal("model_adaptation"),
])
export type RunType = typeof RunType.Type

export const ArtifactType = Schema.Union([
  Schema.Literal("raw_profile"),
  Schema.Literal("cleaning_plan"),
  Schema.Literal("ai_ready_spec"),
  Schema.Literal("ai_ready_dataset"),
  Schema.Literal("training_config"),
  Schema.Literal("onehub_payload"),
  Schema.Literal("dataset_manifest"),
  Schema.Literal("model_config"),
  Schema.Literal("checkpoint"),
  Schema.Literal("inference_result"),
  Schema.Literal("benchmark_report"),
  Schema.Literal("profile_report"),
  Schema.Literal("reproduction_report"),
  Schema.Literal("optimization_report"),
  Schema.Literal("adapter_report"),
])
export type ArtifactType = typeof ArtifactType.Type

export const ReleaseTarget = Schema.Union([Schema.Literal("model_training"), Schema.Literal("onehub")])
export type ReleaseTarget = typeof ReleaseTarget.Type

export type Project = {
  id: string
  slug: string
  title: string
  description: string
  domain: string
  status: ProjectStatus
  rawDataUri: string
  rawDataFormat: string
  rawDataLicense?: string
  rawDataMetadataJson?: Record<string, unknown>
  targetDatasetName: string
  targetDatasetGoal: string
  targetTaskType: string
  owner?: string
  timeCreated: number
  timeUpdated: number
}

export type AgentRun = {
  id: string
  projectId: string
  runType: RunType
  status: string
  inputJson: Record<string, unknown>
  planJson?: Record<string, unknown>
  resultJson?: Record<string, unknown>
  errorMessage?: string
  sessionId?: string
  timeStarted: number
  timeCompleted?: number
  timeCreated: number
  timeUpdated: number
}

export type Artifact = {
  id: string
  projectId: string
  runId?: string
  artifactType: ArtifactType
  title: string
  uri?: string
  format: string
  metadataJson?: Record<string, unknown>
  version?: string
  qualityScore?: number
  timeCreated: number
  timeUpdated: number
}

export type QualityReport = {
  id: string
  projectId: string
  artifactId?: string
  schemaScore?: number
  missingScore?: number
  licenseScore?: number
  trainReadyScore?: number
  checksJson: Record<string, unknown>
  recommendationsJson?: Record<string, unknown>
  timeCreated: number
  timeUpdated: number
}

export type DataRelease = {
  id: string
  projectId: string
  artifactId?: string
  target: ReleaseTarget
  status: string
  resourceId?: string
  trainingConfigJson?: Record<string, unknown>
  publishPayloadJson?: Record<string, unknown>
  timeCreated: number
  timeUpdated: number
}

export const CreateProject = Schema.Struct({
  title: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
  domain: Schema.NonEmptyString,
  rawDataUri: Schema.NonEmptyString,
  rawDataFormat: Schema.NonEmptyString,
  rawDataLicense: Schema.optional(Schema.String),
  rawDataMetadataJson: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  targetDatasetName: Schema.NonEmptyString,
  targetDatasetGoal: Schema.NonEmptyString,
  targetTaskType: Schema.NonEmptyString,
  owner: Schema.optional(Schema.String),
}).annotate({ identifier: "CreateOneScienceDataProject" })
export type CreateProject = typeof CreateProject.Type

export const UpdateProject = Schema.Struct({
  title: Schema.optional(Schema.NonEmptyString),
  description: Schema.optional(Schema.NonEmptyString),
  domain: Schema.optional(Schema.NonEmptyString),
  status: Schema.optional(ProjectStatus),
  rawDataUri: Schema.optional(Schema.NonEmptyString),
  rawDataFormat: Schema.optional(Schema.NonEmptyString),
  rawDataLicense: Schema.optional(Schema.String),
  rawDataMetadataJson: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  targetDatasetName: Schema.optional(Schema.NonEmptyString),
  targetDatasetGoal: Schema.optional(Schema.NonEmptyString),
  targetTaskType: Schema.optional(Schema.NonEmptyString),
  owner: Schema.optional(Schema.String),
}).annotate({ identifier: "UpdateOneScienceDataProject" })
export type UpdateProject = typeof UpdateProject.Type

export const CreateAgentRun = Schema.Struct({
  runType: RunType,
  inputJson: Schema.Record(Schema.String, Schema.Unknown),
  planJson: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  sessionId: Schema.optional(Schema.String),
}).annotate({ identifier: "CreateOneScienceDataAgentRun" })
export type CreateAgentRun = typeof CreateAgentRun.Type

export const CompleteAgentRun = Schema.Struct({
  status: Schema.String,
  planJson: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  resultJson: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  errorMessage: Schema.optional(Schema.String),
}).annotate({ identifier: "CompleteOneScienceDataAgentRun" })
export type CompleteAgentRun = typeof CompleteAgentRun.Type

export const CreateArtifact = Schema.Struct({
  runId: Schema.optional(Schema.String),
  artifactType: ArtifactType,
  title: Schema.NonEmptyString,
  uri: Schema.optional(Schema.String),
  format: Schema.NonEmptyString,
  metadataJson: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  version: Schema.optional(Schema.String),
  qualityScore: Schema.optional(Schema.Number),
}).annotate({ identifier: "CreateOneScienceDataArtifact" })
export type CreateArtifact = typeof CreateArtifact.Type

export const CreateQualityReport = Schema.Struct({
  artifactId: Schema.optional(Schema.String),
  schemaScore: Schema.optional(Schema.Number),
  missingScore: Schema.optional(Schema.Number),
  licenseScore: Schema.optional(Schema.Number),
  trainReadyScore: Schema.optional(Schema.Number),
  checksJson: Schema.Record(Schema.String, Schema.Unknown),
  recommendationsJson: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}).annotate({ identifier: "CreateOneScienceDataQualityReport" })
export type CreateQualityReport = typeof CreateQualityReport.Type

function generateSlug(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 100)
}

function fromProjectRow(row: typeof OneScienceDataProjectTable.$inferSelect): Project {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    domain: row.domain,
    status: row.status as ProjectStatus,
    rawDataUri: row.raw_data_uri,
    rawDataFormat: row.raw_data_format,
    ...(row.raw_data_license ? { rawDataLicense: row.raw_data_license } : {}),
    ...(row.raw_data_metadata_json ? { rawDataMetadataJson: row.raw_data_metadata_json } : {}),
    targetDatasetName: row.target_dataset_name,
    targetDatasetGoal: row.target_dataset_goal,
    targetTaskType: row.target_task_type,
    ...(row.owner ? { owner: row.owner } : {}),
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

function fromAgentRunRow(row: typeof OneScienceDataAgentRunTable.$inferSelect): AgentRun {
  return {
    id: row.id,
    projectId: row.project_id,
    runType: row.run_type as RunType,
    status: row.status,
    inputJson: row.input_json,
    ...(row.plan_json ? { planJson: row.plan_json } : {}),
    ...(row.result_json ? { resultJson: row.result_json } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    timeStarted: row.time_started,
    ...(row.time_completed ? { timeCompleted: row.time_completed } : {}),
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

function fromArtifactRow(row: typeof OneScienceDataArtifactTable.$inferSelect): Artifact {
  return {
    id: row.id,
    projectId: row.project_id,
    ...(row.run_id ? { runId: row.run_id } : {}),
    artifactType: row.artifact_type as ArtifactType,
    title: row.title,
    ...(row.uri ? { uri: row.uri } : {}),
    format: row.format,
    ...(row.metadata_json ? { metadataJson: row.metadata_json } : {}),
    ...(row.version ? { version: row.version } : {}),
    ...(row.quality_score === null ? {} : { qualityScore: row.quality_score }),
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

function fromQualityReportRow(row: typeof OneScienceDataQualityReportTable.$inferSelect): QualityReport {
  return {
    id: row.id,
    projectId: row.project_id,
    ...(row.artifact_id ? { artifactId: row.artifact_id } : {}),
    ...(row.schema_score === null ? {} : { schemaScore: row.schema_score }),
    ...(row.missing_score === null ? {} : { missingScore: row.missing_score }),
    ...(row.license_score === null ? {} : { licenseScore: row.license_score }),
    ...(row.train_ready_score === null ? {} : { trainReadyScore: row.train_ready_score }),
    checksJson: row.checks_json,
    ...(row.recommendations_json ? { recommendationsJson: row.recommendations_json } : {}),
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

function fromReleaseRow(row: typeof OneScienceDataReleaseTable.$inferSelect): DataRelease {
  return {
    id: row.id,
    projectId: row.project_id,
    ...(row.artifact_id ? { artifactId: row.artifact_id } : {}),
    target: row.target as ReleaseTarget,
    status: row.status,
    ...(row.resource_id ? { resourceId: row.resource_id } : {}),
    ...(row.training_config_json ? { trainingConfigJson: row.training_config_json } : {}),
    ...(row.publish_payload_json ? { publishPayloadJson: row.publish_payload_json } : {}),
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

function requireProject(db: Database.TxOrDb, id: string) {
  const row = db.select().from(OneScienceDataProjectTable).where(and(eq(OneScienceDataProjectTable.id, id), isNull(OneScienceDataProjectTable.time_deleted))).get()
  if (!row) throw new Database.NotFoundError({ message: `OneScience data project not found: ${id}` })
  return row
}

function requireArtifact(db: Database.TxOrDb, id: string) {
  const row = db.select().from(OneScienceDataArtifactTable).where(and(eq(OneScienceDataArtifactTable.id, id), isNull(OneScienceDataArtifactTable.time_deleted))).get()
  if (!row) throw new Database.NotFoundError({ message: `OneScience data artifact not found: ${id}` })
  return row
}

export function create(input: CreateProject) {
  const now = Date.now()
  const publicId = Identifier.create("raw", "ascending")
  const http = /^https?:\/\//i.test(input.rawDataUri)
  const row = {
    id: `data-project-${crypto.randomUUID()}`,
    slug: `${generateSlug(input.title)}-${crypto.randomUUID().substring(0, 8)}`,
    title: input.title,
    description: input.description,
    domain: input.domain,
    status: "draft",
    raw_data_uri: input.rawDataUri,
    raw_data_format: input.rawDataFormat,
    raw_data_license: input.rawDataLicense?.trim() || null,
    raw_data_metadata_json: input.rawDataMetadataJson ?? null,
    target_dataset_name: input.targetDatasetName,
    target_dataset_goal: input.targetDatasetGoal,
    target_task_type: input.targetTaskType,
    owner: input.owner?.trim() || null,
    public_id: publicId,
    workspace_id: "",
    connector: http ? "http_dataset" : "local_fs",
    ingest_method: "onescience",
    lineage_public_id: null,
    time_created: now,
    time_updated: now,
    time_deleted: null,
  }
  Database.use((db) => db.insert(OneScienceDataProjectTable).values(row).run())
  return fromProjectRow(row)
}

export function list(input?: { status?: ProjectStatus; domain?: string; limit?: number; offset?: number; owner?: string }) {
  const limit = Math.max(1, Math.min(input?.limit ?? 24, 100))
  const offset = Math.max(0, input?.offset ?? 0)
  return Database.use((db) => {
    const rows = db
      .select()
      .from(OneScienceDataProjectTable)
      .where(
        and(
          input?.status ? eq(OneScienceDataProjectTable.status, input.status) : undefined,
          input?.domain ? eq(OneScienceDataProjectTable.domain, input.domain) : undefined,
          input?.owner ? eq(OneScienceDataProjectTable.owner, input.owner) : undefined,
          isNull(OneScienceDataProjectTable.time_deleted),
        ),
      )
      .orderBy(desc(OneScienceDataProjectTable.time_updated), desc(OneScienceDataProjectTable.id))
      .limit(limit + 1)
      .offset(offset)
      .all()
    return {
      items: rows.slice(0, limit).map(fromProjectRow),
      nextOffset: rows.length > limit ? offset + limit : undefined,
    }
  })
}

export function get(id: string, accountId?: string) {
  return Database.use((db) => {
    const row =
      db.select().from(OneScienceDataProjectTable).where(and(eq(OneScienceDataProjectTable.id, id), isNull(OneScienceDataProjectTable.time_deleted))).get()
      ?? db.select().from(OneScienceDataProjectTable).where(and(eq(OneScienceDataProjectTable.public_id, id), isNull(OneScienceDataProjectTable.time_deleted))).get()
    if (!row) throw new Database.NotFoundError({ message: `OneScience data project not found: ${id}` })
    if (accountId && row.owner !== accountId) throw new Database.NotFoundError({ message: `OneScience data project not found: ${id}` })
    const project = fromProjectRow(row)
    const runs = db.select().from(OneScienceDataAgentRunTable).where(and(eq(OneScienceDataAgentRunTable.project_id, row.id), isNull(OneScienceDataAgentRunTable.time_deleted))).orderBy(desc(OneScienceDataAgentRunTable.time_created)).all().map(fromAgentRunRow)
    const artifacts = db.select().from(OneScienceDataArtifactTable).where(and(eq(OneScienceDataArtifactTable.project_id, row.id), isNull(OneScienceDataArtifactTable.time_deleted))).orderBy(desc(OneScienceDataArtifactTable.time_created)).all().map(fromArtifactRow)
    const qualityReports = db.select().from(OneScienceDataQualityReportTable).where(and(eq(OneScienceDataQualityReportTable.project_id, row.id), isNull(OneScienceDataQualityReportTable.time_deleted))).orderBy(desc(OneScienceDataQualityReportTable.time_created)).all().map(fromQualityReportRow)
    const releases = db.select().from(OneScienceDataReleaseTable).where(and(eq(OneScienceDataReleaseTable.project_id, row.id), isNull(OneScienceDataReleaseTable.time_deleted))).orderBy(desc(OneScienceDataReleaseTable.time_created)).all().map(fromReleaseRow)
    return { project, runs, artifacts, qualityReports, releases }
  })
}

export function update(id: string, input: UpdateProject) {
  return Database.transaction((db) => {
    const existing = requireProject(db, id)
    db.update(OneScienceDataProjectTable)
      .set({
        title: input.title ?? existing.title,
        description: input.description ?? existing.description,
        domain: input.domain ?? existing.domain,
        status: input.status ?? existing.status,
        raw_data_uri: input.rawDataUri ?? existing.raw_data_uri,
        raw_data_format: input.rawDataFormat ?? existing.raw_data_format,
        raw_data_license: input.rawDataLicense === undefined ? existing.raw_data_license : input.rawDataLicense.trim() || null,
        raw_data_metadata_json: input.rawDataMetadataJson === undefined ? existing.raw_data_metadata_json : input.rawDataMetadataJson,
        target_dataset_name: input.targetDatasetName ?? existing.target_dataset_name,
        target_dataset_goal: input.targetDatasetGoal ?? existing.target_dataset_goal,
        target_task_type: input.targetTaskType ?? existing.target_task_type,
        owner: input.owner === undefined ? existing.owner : input.owner.trim() || null,
        time_updated: Date.now(),
      })
      .where(eq(OneScienceDataProjectTable.id, id))
      .run()
    return fromProjectRow(requireProject(db, id))
  })
}

export function createAgentRun(projectID: string, input: CreateAgentRun) {
  return Database.transaction((db) => {
    requireProject(db, projectID)
    const now = Date.now()
    const row = {
      id: `data-run-${crypto.randomUUID()}`,
      project_id: projectID,
      run_type: input.runType,
      status: "running",
      input_json: input.inputJson,
      plan_json: input.planJson ?? null,
      result_json: null,
      error_message: null,
      session_id: input.sessionId?.trim() || null,
      time_started: now,
      time_completed: null,
      time_created: now,
      time_updated: now,
      time_deleted: null,
    }
    db.insert(OneScienceDataAgentRunTable).values(row).run()
    db.update(OneScienceDataProjectTable).set({ status: "analyzing", time_updated: now }).where(eq(OneScienceDataProjectTable.id, projectID)).run()
    return fromAgentRunRow(row)
  })
}

export function completeAgentRun(runID: string, input: CompleteAgentRun) {
  return Database.transaction((db) => {
    const existing = db.select().from(OneScienceDataAgentRunTable).where(and(eq(OneScienceDataAgentRunTable.id, runID), isNull(OneScienceDataAgentRunTable.time_deleted))).get()
    if (!existing) throw new Database.NotFoundError({ message: `OneScience data agent run not found: ${runID}` })
    const now = Date.now()
    db.update(OneScienceDataAgentRunTable)
      .set({
        status: input.status,
        plan_json: input.planJson === undefined ? existing.plan_json : input.planJson,
        result_json: input.resultJson === undefined ? existing.result_json : input.resultJson,
        error_message: input.errorMessage === undefined ? existing.error_message : input.errorMessage,
        time_completed: now,
        time_updated: now,
      })
      .where(eq(OneScienceDataAgentRunTable.id, runID))
      .run()
    return fromAgentRunRow(db.select().from(OneScienceDataAgentRunTable).where(eq(OneScienceDataAgentRunTable.id, runID)).get()!)
  })
}

export function createArtifact(projectID: string, input: CreateArtifact) {
  return Database.transaction((db) => {
    const project = requireProject(db, projectID)
    const now = Date.now()
    const publicId = Identifier.create("alr", "ascending")
    const uri = input.uri?.trim() || null
    const row = {
      id: `data-artifact-${crypto.randomUUID()}`,
      project_id: projectID,
      run_id: input.runId ?? null,
      artifact_type: input.artifactType,
      title: input.title,
      uri,
      format: input.format,
      metadata_json: input.metadataJson ?? null,
      version: input.version?.trim() || null,
      quality_score: input.qualityScore ?? null,
      public_id: publicId,
      owner: project.owner,
      visibility: "private",
      workspace_id: project.workspace_id || "",
      source_raw_ids: project.public_id ? [project.public_id] : [],
      status: "draft",
      build_method: "direct",
      connector: project.connector || "local_fs",
      logical_bytes: null,
      record_count: null,
      entry_count: null,
      time_created: now,
      time_updated: now,
      time_deleted: null,
    }
    db.insert(OneScienceDataArtifactTable).values(row).run()
    if (input.artifactType === "ai_ready_dataset") db.update(OneScienceDataProjectTable).set({ status: "ai_ready", time_updated: now }).where(eq(OneScienceDataProjectTable.id, projectID)).run()
    return fromArtifactRow(row)
  })
}

export function createQualityReport(projectID: string, input: CreateQualityReport) {
  return Database.transaction((db) => {
    requireProject(db, projectID)
    const now = Date.now()
    const row = {
      id: `data-quality-${crypto.randomUUID()}`,
      project_id: projectID,
      artifact_id: input.artifactId ?? null,
      schema_score: input.schemaScore ?? null,
      missing_score: input.missingScore ?? null,
      license_score: input.licenseScore ?? null,
      train_ready_score: input.trainReadyScore ?? null,
      checks_json: input.checksJson,
      recommendations_json: input.recommendationsJson ?? null,
      time_created: now,
      time_updated: now,
      time_deleted: null,
    }
    db.insert(OneScienceDataQualityReportTable).values(row).run()
    return fromQualityReportRow(row)
  })
}

export function createTrainingHandoff(projectID: string, artifactID: string, trainingConfigJson: Record<string, unknown>) {
  return Database.transaction((db) => {
    requireProject(db, projectID)
    requireArtifact(db, artifactID)
    const now = Date.now()
    const row = {
      id: `data-release-${crypto.randomUUID()}`,
      project_id: projectID,
      artifact_id: artifactID,
      target: "model_training",
      status: "ready",
      resource_id: null,
      training_config_json: trainingConfigJson,
      publish_payload_json: null,
      time_created: now,
      time_updated: now,
      time_deleted: null,
    }
    db.insert(OneScienceDataReleaseTable).values(row).run()
    db.update(OneScienceDataProjectTable).set({ status: "training_linked", time_updated: now }).where(eq(OneScienceDataProjectTable.id, projectID)).run()
    return fromReleaseRow(row)
  })
}

export function publishToOneHub(projectID: string, artifactID: string, accountId?: string) {
  return Database.transaction((db) => {
    const project = fromProjectRow(requireProject(db, projectID))
    const artifact = fromArtifactRow(requireArtifact(db, artifactID))
    const ownerId = accountId?.trim() || project.owner?.trim()
    if (!ownerId) throw new Error("Login required to publish resources")
    const resource = OneScienceResource.create(
      {
        page: "datasets",
        title: project.targetDatasetName,
        copy: `${project.targetDatasetGoal}\n\n来源：${project.rawDataUri}`,
        domain: project.domain,
        tags: [project.domain, project.targetTaskType, "AI Ready", "source:data-management"],
        provider: project.owner ?? "OneScience Data Management",
        size: artifact.version ?? artifact.format,
        format: artifact.format,
        href: artifact.uri,
        source: "local",
      },
      ownerId,
    )
    const now = Date.now()
    const row = {
      id: `data-release-${crypto.randomUUID()}`,
      project_id: projectID,
      artifact_id: artifactID,
      target: "onehub",
      status: "published",
      resource_id: resource.id,
      training_config_json: null,
      publish_payload_json: { resourceId: resource.id, title: resource.title, href: resource.href },
      time_created: now,
      time_updated: now,
      time_deleted: null,
    }
    db.insert(OneScienceDataReleaseTable).values(row).run()
    db.update(OneScienceDataProjectTable).set({ status: "published", time_updated: now }).where(eq(OneScienceDataProjectTable.id, projectID)).run()
    return fromReleaseRow(row)
  })
}

export * as OneScienceDataProject from "./data-project"
