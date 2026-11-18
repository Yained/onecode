import { AccountID, OrgID } from "@/account/schema"
import { ConfigSSH } from "@/config/ssh"
import { MCP } from "@/mcp"
import { OneScienceDataProject } from "@/onescience/data-project"
import { AIPrimitive } from "@/onescience/primitive"
import { OneScienceResource } from "@/onescience/resource"
import { OneScienceScenario } from "@/onescience/scenario"
import { OneScienceSkill } from "@/onescience/skill"
import { OneScienceSkillManagement } from "@/onescience/skill-management"
import { OneScienceTaskProfile } from "@/onescience/task-profile"
import { ProviderID, ModelID } from "@/provider/schema"
import { Session } from "@/session/session"
import { Worktree } from "@/worktree"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "../middleware/workspace-routing"
import { described } from "./metadata"
import { QueryBoolean } from "./query"

const ConsoleStateResponse = Schema.Struct({
  consoleManagedProviders: Schema.mutable(Schema.Array(Schema.String)),
  activeOrgName: Schema.optionalKey(Schema.String),
  switchableOrgCount: NonNegativeInt,
}).annotate({ identifier: "ConsoleState" })

const ConsoleOrgOption = Schema.Struct({
  accountID: Schema.String,
  accountEmail: Schema.String,
  accountUrl: Schema.String,
  orgID: Schema.String,
  orgName: Schema.String,
  active: Schema.Boolean,
})

const ConsoleOrgList = Schema.Struct({
  orgs: Schema.Array(ConsoleOrgOption),
})

export const ConsoleSwitchPayload = Schema.Struct({
  accountID: AccountID,
  orgID: OrgID,
})

const ToolIDs = Schema.Array(Schema.String).annotate({ identifier: "ToolIDs" })
const ToolListItem = Schema.Struct({
  id: Schema.String,
  description: Schema.String,
  parameters: Schema.Unknown,
}).annotate({ identifier: "ToolListItem" })
const ToolList = Schema.Array(ToolListItem).annotate({ identifier: "ToolList" })
export const ToolListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  provider: ProviderID,
  model: ModelID,
})

const WorktreeList = Schema.Array(Schema.String)
const WorktreeErrorName = Schema.Union([
  Schema.Literal("WorktreeNotGitError"),
  Schema.Literal("WorktreeNameGenerationFailedError"),
  Schema.Literal("WorktreeCreateFailedError"),
  Schema.Literal("WorktreeStartCommandFailedError"),
  Schema.Literal("WorktreeRemoveFailedError"),
  Schema.Literal("WorktreeResetFailedError"),
  Schema.Literal("WorktreeListFailedError"),
])
export class WorktreeApiError extends Schema.ErrorClass<WorktreeApiError>("WorktreeError")(
  {
    name: WorktreeErrorName,
    data: Schema.Struct({ message: Schema.String }),
  },
  { httpApiStatus: 400 },
) {}

export class SkillManagementApiError extends Schema.ErrorClass<SkillManagementApiError>("SkillManagementError")(
  {
    message: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

export class CatalogGoneError extends Schema.ErrorClass<CatalogGoneError>("CatalogGoneError")(
  {
    error: Schema.optional(Schema.String),
  },
  { httpApiStatus: 410 },
) {}

export class CatalogConflictError extends Schema.ErrorClass<CatalogConflictError>("CatalogConflictError")(
  {
    error: Schema.optional(Schema.String),
    message: Schema.String,
  },
  { httpApiStatus: 409 },
) {}

export class CatalogForbiddenError extends Schema.ErrorClass<CatalogForbiddenError>("CatalogForbiddenError")(
  {
    error: Schema.optional(Schema.String),
    message: Schema.String,
  },
  { httpApiStatus: 403 },
) {}

export class CatalogUnprocessableError extends Schema.ErrorClass<CatalogUnprocessableError>("CatalogUnprocessableError")(
  {
    error: Schema.optional(Schema.String),
    message: Schema.String,
  },
  { httpApiStatus: 422 },
) {}

export class CatalogBadGatewayError extends Schema.ErrorClass<CatalogBadGatewayError>("CatalogBadGatewayError")(
  {
    error: Schema.optional(Schema.String),
    message: Schema.String,
  },
  { httpApiStatus: 502 },
) {}

export class CatalogUnavailableError extends Schema.ErrorClass<CatalogUnavailableError>("CatalogUnavailableError")(
  {
    error: Schema.optional(Schema.String),
    message: Schema.String,
  },
  { httpApiStatus: 503 },
) {}

export class OneScienceModelScopeDownloadError extends Schema.ErrorClass<OneScienceModelScopeDownloadError>(
  "ModelScopeDownloadError",
)(
  {
    message: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

export const OneScienceOneskillsUpgradeResponse = Schema.Struct({
  version: Schema.optional(Schema.String),
  skillCount: Schema.Number,
  skillsDir: Schema.String,
  releaseUrl: Schema.String,
  seedSource: Schema.optional(Schema.Literals(["disk", "bundled", "explicit"])),
  seedVersion: Schema.optional(Schema.String),
  seedFallbackReason: Schema.optional(Schema.String),
})
export const SessionListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  roots: Schema.optional(QueryBoolean),
  start: Schema.optional(Schema.NumberFromString),
  cursor: Schema.optional(Schema.NumberFromString),
  search: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
  archived: Schema.optional(QueryBoolean),
})

export const OneScienceResourceListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  page: OneScienceResource.ResourcePage,
  domain: Schema.optional(Schema.String),
  q: Schema.optional(Schema.String),
  customOnly: Schema.optional(QueryBoolean),
  limit: Schema.optional(Schema.NumberFromString),
  offset: Schema.optional(Schema.NumberFromString),
})

const OneScienceResourceListResponse = Schema.Struct({
  items: Schema.Array(OneScienceResource.Resource),
  nextOffset: Schema.optional(Schema.Number),
})

export const OneScienceScenarioListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  domain: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  modelId: Schema.optional(Schema.String),
  q: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
  offset: Schema.optional(Schema.NumberFromString),
})

const OneScienceScenarioListResponse = Schema.Struct({
  items: Schema.Array(OneScienceScenario.Scenario),
  nextOffset: Schema.optional(Schema.Number),
})

const OneScienceResourceDomainCounts = Schema.Record(Schema.String, Schema.Number)

const OneScienceResourceCustomCountsResponse = Schema.Struct({
  datasets: Schema.Number,
  models: Schema.Number,
  apps: Schema.Number,
  frameworks: Schema.Number,
  byDomain: Schema.Struct({
    datasets: OneScienceResourceDomainCounts,
    models: OneScienceResourceDomainCounts,
    apps: OneScienceResourceDomainCounts,
    frameworks: OneScienceResourceDomainCounts,
  }),
})

const OneScienceCatalogMetricsResponse = Schema.Struct({
  datasets: Schema.Number,
  models: Schema.Number,
  apps: Schema.Number,
  frameworks: Schema.Number,
  callablePrimitives: Schema.Number,
  byDomain: Schema.Struct({
    datasets: OneScienceResourceDomainCounts,
    models: OneScienceResourceDomainCounts,
    apps: OneScienceResourceDomainCounts,
    frameworks: OneScienceResourceDomainCounts,
  }),
})

export const OneScienceSkillListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  layer: Schema.optional(Schema.String),
  includePrimitives: Schema.optional(QueryBoolean),
  limit: Schema.optional(Schema.NumberFromString),
  offset: Schema.optional(Schema.NumberFromString),
})

const OneScienceSkillListResponse = Schema.Struct({
  items: Schema.Array(OneScienceSkill.SkillWithPrimitives),
  nextOffset: Schema.optional(Schema.Number),
})

export const OneScienceSkillRepoListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  sync: Schema.optional(QueryBoolean),
})

const OneScienceSkillRepoListResponse = Schema.Struct({
  items: Schema.Array(OneScienceSkillManagement.SkillRepoConfig),
})

export const OneScienceSkillRepoCreatePayload = OneScienceSkillManagement.CreateSkillRepo
export const OneScienceSkillUploadPayload = OneScienceSkillManagement.UploadSkill
export const OneScienceSkillDeleteQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  scope: OneScienceSkillManagement.SkillScope,
})

const OneScienceTaskProfileListResponse = Schema.Struct({
  items: Schema.Array(Schema.Struct({
    id: Schema.String,
    title: Schema.String,
    description: Schema.String,
    category: Schema.String,
    capabilityFamilies: Schema.Array(Schema.String),
    requiredPrimitiveTypes: Schema.Array(Schema.String),
    optionalPrimitiveTypes: Schema.Array(Schema.String),
    executionSkills: Schema.Array(Schema.String),
    primitiveCount: Schema.Number,
    resourceCount: Schema.Number,
    expectedArtifacts: Schema.Array(Schema.String),
    maturity: Schema.String,
  })),
})

const OneScienceExecutionCapabilityResponse = Schema.Struct({
  slurm: Schema.Struct({
    available: Schema.Boolean,
    sbatchVersion: Schema.optional(Schema.String),
    sinfoAvailable: Schema.optional(Schema.Boolean),
    partitions: Schema.optional(Schema.Array(Schema.String)),
    detail: Schema.String,
  }),
})

export const OneScienceReadmeQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  url: Schema.String,
})

const OneScienceReadmeResponse = Schema.Struct({
  content: Schema.String,
  sourceUrl: Schema.String,
})

export const OneScienceModelScopeDownloadQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  directory: Schema.String,
})

export const OneScienceModelScopeDownloadEnvironmentInput = Schema.Struct({
  kind: Schema.Literals(["local", "ssh"]),
  targetName: Schema.optional(Schema.String),
  remotePath: Schema.optional(Schema.String),
  ssh: Schema.optional(ConfigSSH.Info),
  condaEnv: Schema.optional(Schema.String),
})

export const OneScienceModelScopeDownloadStartPayload = Schema.Struct({
  directory: Schema.String,
  resourceId: Schema.String,
  environment: Schema.optional(OneScienceModelScopeDownloadEnvironmentInput),
})

export const OneScienceModelScopeDownloadCancelPayload = OneScienceModelScopeDownloadStartPayload

export const OneScienceCaseRestorePayload = Schema.Struct({
  sessionId: Schema.String,
  /** When true (default for logged-in accounts), copy into the personal workspace. When false, restore into the shared cases root. */
  fork: Schema.optional(Schema.Boolean),
})

const OneScienceCaseRestoreResponse = Schema.Struct({
  restored: Schema.Boolean,
  sessionId: Schema.String,
  directory: Schema.String,
  filesCopied: Schema.optional(Schema.Number),
})

export const OneScienceModelScopeDownloadRemoveQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  directory: Schema.String,
  resourceId: Schema.String,
  /** JSON-encoded { kind, targetName? } locating the environment-scoped record. */
  environment: Schema.optional(Schema.String),
})

const OneScienceModelScopeDownloadRecordEnvironment = Schema.Struct({
  kind: Schema.Literals(["local", "ssh"]),
  targetName: Schema.optional(Schema.String),
  remotePath: Schema.optional(Schema.String),
})

const OneScienceModelScopeDownloadRecord = Schema.Struct({
  resourceId: Schema.String,
  kind: Schema.Literals(["dataset", "model"]),
  status: Schema.Literals(["downloading", "completed", "failed", "partial"]),
  startedAt: Schema.Number,
  finishedAt: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
  environment: Schema.optional(OneScienceModelScopeDownloadRecordEnvironment),
  downloadedBytes: Schema.optional(Schema.Number),
  totalBytes: Schema.optional(Schema.Number),
  progressTotalBytes: Schema.optional(Schema.Number),
  estimatedTotalBytes: Schema.optional(Schema.Number),
  currentFile: Schema.optional(Schema.String),
  currentFileBytes: Schema.optional(Schema.Number),
  currentFileTotalBytes: Schema.optional(Schema.Number),
  cachePaths: Schema.optional(Schema.Array(Schema.String)),
})

const OneScienceModelScopeDownloadListResponse = Schema.Struct({
  items: Schema.Array(OneScienceModelScopeDownloadRecord),
})

export const OneScienceModelScopeDownloadInfoQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  directory: Schema.String,
  resourceId: Schema.String,
})

export const OneScienceModelScopeDownloadDiskQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  directory: Schema.String,
  /** JSON-encoded environment ({ kind: "ssh", remotePath, ssh }) for remote disk probes. */
  environment: Schema.optional(Schema.String),
})

export const OneScienceModelScopeDownloadCondaEnvsQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  directory: Schema.String,
  /** JSON-encoded { kind: "local" } or { kind: "ssh", targetName }. Omit or local to list conda on the server host. */
  environment: Schema.optional(Schema.String),
})

const OneScienceModelScopeDownloadDiskResponse = Schema.Struct({
  availableBytes: Schema.optional(Schema.Number),
})

const OneScienceModelScopeDownloadCondaEnv = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  active: Schema.optional(Schema.Boolean),
})

const OneScienceModelScopeDownloadCondaEnvsResponse = Schema.Struct({
  items: Schema.Array(OneScienceModelScopeDownloadCondaEnv),
  available: Schema.optional(Schema.Boolean),
})

const OneScienceModelScopeDownloadInfoResponse = Schema.Struct({
  resourceId: Schema.String,
  availableBytes: Schema.optional(Schema.Number),
  datasetBytes: Schema.optional(Schema.Number),
})

export const AIPrimitiveListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  domain: Schema.optional(Schema.String),
  primitiveType: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  summary: Schema.optional(QueryBoolean),
  limit: Schema.optional(Schema.NumberFromString),
  offset: Schema.optional(Schema.NumberFromString),
})

const AIPrimitiveListResponse = Schema.Struct({
  items: Schema.Array(AIPrimitive.Primitive),
  nextOffset: Schema.optional(Schema.Number),
})

export const AIPrimitiveByResourcesQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  resourceIds: Schema.String,
})

const AIPrimitiveByResourcesResponse = Schema.Struct({
  items: Schema.Array(Schema.Struct({
    resourceId: Schema.String,
    callable: Schema.optional(AIPrimitive.Primitive),
    draft: Schema.optional(AIPrimitive.Primitive),
    inference: Schema.optional(AIPrimitive.PrimitiveCategoryLink),
    training: Schema.optional(AIPrimitive.PrimitiveCategoryLink),
  })),
})

export const OneScienceDataProjectListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  status: Schema.optional(OneScienceDataProject.ProjectStatus),
  domain: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
  offset: Schema.optional(Schema.NumberFromString),
})

const OneScienceDataProjectListResponse = Schema.Unknown
const OneScienceDataProjectDetailResponse = Schema.Unknown
export const OneScienceDataProjectArtifactPayload = Schema.Struct({
  artifactId: Schema.String,
})
export const OneScienceDataProjectTrainingPayload = Schema.Struct({
  artifactId: Schema.String,
  trainingConfigJson: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})

export const CatalogProbePayload = Schema.Struct({
  connector: Schema.Literals(["local_fs", "http_dataset", "object_store", "database", "onedata_ref", "remote_workspace"]),
  uri: Schema.String,
  workspace_id: Schema.optional(Schema.String),
})

export const CatalogRawCreatePayload = Schema.Struct({
  title: Schema.NonEmptyString,
  description: Schema.optional(Schema.String),
  domain: Schema.optional(Schema.String),
  uri: Schema.NonEmptyString,
  connector: Schema.Literals(["local_fs", "http_dataset", "object_store", "database", "onedata_ref", "remote_workspace"]),
  workspace_id: Schema.optional(Schema.String),
})

export const CatalogRawPatchPayload = Schema.Struct({
  uri: Schema.NonEmptyString,
})

export const CatalogRawListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  domain: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
  offset: Schema.optional(Schema.NumberFromString),
})

export const CatalogAlreadyListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  scope: Schema.optional(Schema.Literals(["mine", "public"])),
  domain: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
  offset: Schema.optional(Schema.NumberFromString),
})

export const CatalogChipsPayload = Schema.Struct({
  raw_ids: Schema.Array(Schema.String),
})

export const CatalogFsPathPayload = Schema.Struct({
  path: Schema.NonEmptyString,
})

export const CatalogIngestPayload = Schema.Struct({
  session_id: Schema.optional(Schema.String),
  workspace_id: Schema.optional(Schema.String),
  raw_ids: Schema.optional(Schema.Array(Schema.String)),
  report: Schema.Struct({
    name: Schema.NonEmptyString,
    artifact_uri: Schema.NonEmptyString,
    format: Schema.optional(Schema.String),
    size_bytes: Schema.optional(Schema.Number),
    record_count: Schema.optional(Schema.Number),
    notes: Schema.optional(Schema.String),
  }),
})

export const CatalogAlreadyPatchPayload = Schema.Struct({
  source_raw_ids: Schema.Array(Schema.String),
})

export const CatalogAlreadyPrimitivePayload = Schema.Struct({
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  data_schema: Schema.optional(Schema.String),
  usage_notes: Schema.optional(Schema.String),
})

export const CatalogTrainingPayload = Schema.Struct({
  target: Schema.Literals(["local", "workspace", "shared_root"]),
  workspace_id: Schema.optional(Schema.String),
  trainingConfigJson: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})

export const CatalogAlreadyPreviewQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  viewer_workspace_id: Schema.optional(Schema.String),
})

export const CatalogObjectStoreKeyPayload = Schema.Struct({
  provider: Schema.Literals(["s3", "oss", "cos"]),
  access_key_id: Schema.NonEmptyString,
  secret: Schema.NonEmptyString,
  endpoint: Schema.optional(Schema.String),
  region: Schema.optional(Schema.String),
  label: Schema.optional(Schema.String),
})

export const CatalogDbConnectionPayload = Schema.Struct({
  engine: Schema.Literals(["postgres", "mysql"]),
  host: Schema.NonEmptyString,
  port: Schema.Number,
  database: Schema.NonEmptyString,
  username: Schema.NonEmptyString,
  password: Schema.NonEmptyString,
  label: Schema.optional(Schema.String),
  ssl_mode: Schema.optional(Schema.String),
  id: Schema.optional(Schema.String), // upsert by id when present
})

const CatalogJson = Schema.Unknown
const catalogWriteErrors = [
  HttpApiError.BadRequest,
  HttpApiError.Unauthorized,
  HttpApiError.Forbidden,
  CatalogForbiddenError,
  HttpApiError.NotFound,
  CatalogGoneError,
  CatalogConflictError,
  CatalogUnprocessableError,
  CatalogBadGatewayError,
  CatalogUnavailableError,
] as const

export const ExperimentalPaths = {
  console: "/experimental/console",
  consoleOrgs: "/experimental/console/orgs",
  consoleSwitch: "/experimental/console/switch",
  tool: "/experimental/tool",
  toolIDs: "/experimental/tool/ids",
  worktree: "/experimental/worktree",
  worktreeReset: "/experimental/worktree/reset",
  session: "/experimental/session",
  resource: "/experimental/resource",
  oneScienceResource: "/experimental/onescience/resource",
  oneScienceResourceCustomCounts: "/experimental/onescience/resource/custom-counts",
  oneScienceCatalogMetrics: "/experimental/onescience/catalog-metrics",
  oneScienceResourceItem: "/experimental/onescience/resource/:id",
  oneScienceScenario: "/experimental/onescience/scenario",
  oneScienceScenarioItem: "/experimental/onescience/scenario/:id",
  oneScienceSkill: "/experimental/onescience/skill",
  oneScienceSkillRepo: "/experimental/onescience/skill/repo",
  oneScienceSkillRepoItem: "/experimental/onescience/skill/repo/:id",
  oneScienceSkillUpload: "/experimental/onescience/skill/upload",
  oneScienceSkillItem: "/experimental/onescience/skill/:name",
  oneScienceOneskillsUpgrade: "/experimental/onescience/oneskills/upgrade",
  oneScienceTaskProfile: "/experimental/onescience/task-profile",
  oneScienceExecutionCapability: "/experimental/onescience/execution-capability",
  oneScienceReadme: "/experimental/onescience/readme",
  oneScienceModelScopeDownload: "/experimental/onescience/modelscope/download",
  oneScienceModelScopeDownloadInfo: "/experimental/onescience/modelscope/download/info",
  oneScienceModelScopeDownloadDiskSpace: "/experimental/onescience/modelscope/download/disk-space",
  oneScienceModelScopeDownloadCondaEnvs: "/experimental/onescience/modelscope/download/conda-envs",
  oneScienceModelScopeDownloadCancel: "/experimental/onescience/modelscope/download/cancel",
  oneScienceCaseRestore: "/experimental/onescience/case/restore",
  aiPrimitive: "/experimental/onescience/primitive",
  aiPrimitiveItem: "/experimental/onescience/primitive/:id",
  aiPrimitivePublish: "/experimental/onescience/primitive/:id/publish",
  aiPrimitiveByResource: "/experimental/onescience/primitive/by-resource/:resourceId",
  aiPrimitiveByResources: "/experimental/onescience/primitive/by-resources",
  agentRegistry: "/experimental/onescience/agent-registry",
  dataProject: "/experimental/onescience/data-project",
  dataProjectItem: "/experimental/onescience/data-project/:id",
  dataProjectAnalyze: "/experimental/onescience/data-project/:id/analyze",
  dataProjectAIReady: "/experimental/onescience/data-project/:id/ai-ready",
  dataProjectTraining: "/experimental/onescience/data-project/:id/training",
  dataProjectPublish: "/experimental/onescience/data-project/:id/publish",
  catalogProbe: "/experimental/onescience/probe",
  catalogRawSource: "/experimental/onescience/raw-source",
  catalogRawSourceItem: "/experimental/onescience/raw-source/:id",
  catalogRawSourcePreview: "/experimental/onescience/raw-source/:id/preview",
  catalogRawSourceConvert: "/experimental/onescience/raw-source/:id/convert",
  catalogAlready: "/experimental/onescience/already",
  catalogAlreadyItem: "/experimental/onescience/already/:id",
  catalogAlreadyPreview: "/experimental/onescience/already/:id/preview",
  catalogAlreadyPublish: "/experimental/onescience/already/:id/publish",
  catalogAlreadyUnpublish: "/experimental/onescience/already/:id/unpublish",
  catalogAlreadyReingest: "/experimental/onescience/already/:id/reingest",
  catalogAlreadyTraining: "/experimental/onescience/already/:id/training",
  catalogAlreadyPrimitive: "/experimental/onescience/already/:id/primitive",
  catalogSessionChips: "/experimental/onescience/session/:sessionId/chips",
  catalogFsStat: "/experimental/onescience/fs-stat",
  catalogFsSample: "/experimental/onescience/fs-sample",
  catalogObjectStoreKey: "/experimental/onescience/object-store-key",
  catalogObjectStoreKeyItem: "/experimental/onescience/object-store-key/:provider",
  catalogDbConnection: "/experimental/onescience/db-connection",
  catalogDbConnectionItem: "/experimental/onescience/db-connection/:id",
  catalogDbConnectionTables: "/experimental/onescience/db-connection/:id/tables",
} as const

export const ExperimentalApi = HttpApi.make("experimental")
  .add(
    HttpApiGroup.make("experimental")
      .add(
        HttpApiEndpoint.get("console", ExperimentalPaths.console, {
          query: WorkspaceRoutingQuery,
          success: described(ConsoleStateResponse, "Active Console provider metadata"),
          error: HttpApiError.InternalServerError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.console.get",
            summary: "Get active Console provider metadata",
            description: "Get the active Console org name and the set of provider IDs managed by that Console org.",
          }),
        ),
        HttpApiEndpoint.get("consoleOrgs", ExperimentalPaths.consoleOrgs, {
          query: WorkspaceRoutingQuery,
          success: described(ConsoleOrgList, "Switchable Console orgs"),
          error: HttpApiError.InternalServerError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.console.listOrgs",
            summary: "List switchable Console orgs",
            description: "Get the available Console orgs across logged-in accounts, including the current active org.",
          }),
        ),
        HttpApiEndpoint.post("consoleSwitch", ExperimentalPaths.consoleSwitch, {
          query: WorkspaceRoutingQuery,
          payload: ConsoleSwitchPayload,
          success: described(Schema.Boolean, "Switch success"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.console.switchOrg",
            summary: "Switch active Console org",
            description: "Persist a new active Console account/org selection for the current local OpenCode state.",
          }),
        ),
        HttpApiEndpoint.get("tool", ExperimentalPaths.tool, {
          query: ToolListQuery,
          success: described(ToolList, "Tools"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tool.list",
            summary: "List tools",
            description:
              "Get a list of available tools with their JSON schema parameters for a specific provider and model combination.",
          }),
        ),
        HttpApiEndpoint.get("toolIDs", ExperimentalPaths.toolIDs, {
          query: WorkspaceRoutingQuery,
          success: described(ToolIDs, "Tool IDs"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tool.ids",
            summary: "List tool IDs",
            description:
              "Get a list of all available tool IDs, including both built-in tools and dynamically registered tools.",
          }),
        ),
        HttpApiEndpoint.get("worktree", ExperimentalPaths.worktree, {
          query: WorkspaceRoutingQuery,
          success: described(WorktreeList, "List of worktree directories"),
          error: WorktreeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "worktree.list",
            summary: "List worktrees",
            description: "List all sandbox worktrees for the current project.",
          }),
        ),
        HttpApiEndpoint.post("worktreeCreate", ExperimentalPaths.worktree, {
          query: WorkspaceRoutingQuery,
          payload: Schema.optional(Worktree.CreateInput),
          success: described(Worktree.Info, "Worktree created"),
          error: WorktreeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "worktree.create",
            summary: "Create worktree",
            description: "Create a new git worktree for the current project and run any configured startup scripts.",
          }),
        ),
        HttpApiEndpoint.delete("worktreeRemove", ExperimentalPaths.worktree, {
          query: WorkspaceRoutingQuery,
          payload: Worktree.RemoveInput,
          success: described(Schema.Boolean, "Worktree removed"),
          error: WorktreeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "worktree.remove",
            summary: "Remove worktree",
            description: "Remove a git worktree and delete its branch.",
          }),
        ),
        HttpApiEndpoint.post("worktreeReset", ExperimentalPaths.worktreeReset, {
          query: WorkspaceRoutingQuery,
          payload: Worktree.ResetInput,
          success: described(Schema.Boolean, "Worktree reset"),
          error: WorktreeApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "worktree.reset",
            summary: "Reset worktree",
            description: "Reset a worktree branch to the primary default branch.",
          }),
        ),
        HttpApiEndpoint.get("session", ExperimentalPaths.session, {
          query: SessionListQuery,
          success: described(Schema.Array(Session.GlobalInfo), "List of sessions"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.list",
            summary: "List sessions",
            description:
              "Get a list of all OpenCode sessions across projects, sorted by most recently updated. Archived sessions are excluded by default.",
          }),
        ),
        HttpApiEndpoint.get("resource", ExperimentalPaths.resource, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Record(Schema.String, MCP.Resource), "MCP resources"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.resource.list",
            summary: "Get MCP resources",
            description: "Get all available MCP resources from connected servers. Optionally filter by name.",
          }),
        ),
        HttpApiEndpoint.get("oneScienceResourceList", ExperimentalPaths.oneScienceResource, {
          query: OneScienceResourceListQuery,
          success: described(OneScienceResourceListResponse, "OneScience resources"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.resource.list",
            summary: "List uploaded OneScience resources",
            description: "List user-uploaded OneScience resources stored in local SQLite.",
          }),
        ),
        HttpApiEndpoint.get("oneScienceResourceCustomCounts", ExperimentalPaths.oneScienceResourceCustomCounts, {
          query: WorkspaceRoutingQuery,
          success: described(OneScienceResourceCustomCountsResponse, "OneScience custom resource counts"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.resource.customCounts",
            summary: "Count user-created OneScience resources",
            description: "Return the number of user-created resources per catalog page without listing items.",
          }),
        ),
        HttpApiEndpoint.get("oneScienceCatalogMetrics", ExperimentalPaths.oneScienceCatalogMetrics, {
          query: WorkspaceRoutingQuery,
          success: described(OneScienceCatalogMetricsResponse, "OneScience homepage catalog metrics"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.catalogMetrics",
            summary: "Get homepage catalog metrics",
            description: "Return custom resource counts and callable primitive count in one lightweight query.",
          }),
        ),
        HttpApiEndpoint.post("oneScienceResourceCreate", ExperimentalPaths.oneScienceResource, {
          query: WorkspaceRoutingQuery,
          payload: OneScienceResource.CreateResource,
          success: described(OneScienceResource.Resource, "OneScience resource created"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.resource.create",
            summary: "Create uploaded OneScience resource",
            description: "Create a user-uploaded OneScience resource in local SQLite.",
          }),
        ),
        HttpApiEndpoint.get("oneScienceResourceGet", ExperimentalPaths.oneScienceResourceItem, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(OneScienceResource.Resource, "OneScience resource"),
          error: [HttpApiError.NotFound, HttpApiError.BadRequest],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.resource.get",
            summary: "Get OneScience resource",
            description: "Get a OneScience resource by id, including seed resource aliases.",
          }),
        ),
        HttpApiEndpoint.patch("oneScienceResourceUpdate", ExperimentalPaths.oneScienceResourceItem, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: OneScienceResource.UpdateResource,
          success: described(OneScienceResource.Resource, "OneScience resource updated"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.resource.update",
            summary: "Update OneScience resource",
            description: "Update a OneScience resource stored in local SQLite.",
          }),
        ),
        HttpApiEndpoint.delete("oneScienceResourceRemove", ExperimentalPaths.oneScienceResourceItem, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "OneScience resource removed"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.resource.remove",
            summary: "Remove OneScience resource",
            description: "Soft delete a OneScience resource stored in local SQLite.",
          }),
        ),
        HttpApiEndpoint.get("oneScienceScenarioList", ExperimentalPaths.oneScienceScenario, {
          query: OneScienceScenarioListQuery,
          success: described(OneScienceScenarioListResponse, "OneScience scenarios"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.scenario.list",
            summary: "List OneScience scenarios",
            description: "List built-in scenarios seeded from scenario-seed.json into local SQLite.",
          }),
        ),
        HttpApiEndpoint.get("oneScienceScenarioGet", ExperimentalPaths.oneScienceScenarioItem, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(OneScienceScenario.Scenario, "OneScience scenario"),
          error: [HttpApiError.NotFound, HttpApiError.BadRequest],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.scenario.get",
            summary: "Get OneScience scenario",
            description: "Get a scenario by seed id or scenario_id from local SQLite.",
          }),
        ),
        HttpApiEndpoint.get("oneScienceSkillList", ExperimentalPaths.oneScienceSkill, {
          query: OneScienceSkillListQuery,
          success: described(OneScienceSkillListResponse, "OneScience skills"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.skill.list",
            summary: "List OneScience skills",
            description: "List OneScience skills and optionally their primitive bindings from local SQLite.",
          }),
        ),
        HttpApiEndpoint.get("oneScienceSkillRepoList", ExperimentalPaths.oneScienceSkillRepo, {
          query: OneScienceSkillRepoListQuery,
          success: described(OneScienceSkillRepoListResponse, "OneScience skill repos"),
          error: SkillManagementApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.skill.repo.list",
            summary: "List configured skill repositories",
            description: "List user-configured open skill repository URLs for global or project scope.",
          }),
        ),
        HttpApiEndpoint.post("oneScienceSkillRepoCreate", ExperimentalPaths.oneScienceSkillRepo, {
          query: WorkspaceRoutingQuery,
          payload: OneScienceSkillRepoCreatePayload,
          success: described(OneScienceSkillManagement.SkillRepoConfig, "OneScience skill repo created"),
          error: SkillManagementApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.skill.repo.create",
            summary: "Add skill repository",
            description: "Register an open skill repository URL and persist it into opencode.json skills.urls.",
          }),
        ),
        HttpApiEndpoint.delete("oneScienceSkillRepoRemove", ExperimentalPaths.oneScienceSkillRepoItem, {
          query: WorkspaceRoutingQuery,
          params: { id: Schema.String },
          success: described(OneScienceSkillManagement.SkillRepoConfig, "OneScience skill repo removed"),
          error: SkillManagementApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.skill.repo.remove",
            summary: "Remove skill repository",
            description: "Remove a configured skill repository and its skills.urls entry.",
          }),
        ),
        HttpApiEndpoint.post("oneScienceSkillUpload", ExperimentalPaths.oneScienceSkillUpload, {
          query: WorkspaceRoutingQuery,
          payload: OneScienceSkillUploadPayload,
          success: described(OneScienceSkillManagement.UploadedSkillResult, "OneScience skill uploaded"),
          error: SkillManagementApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.skill.upload",
            summary: "Upload user skill",
            description: "Install a user skill into global or project skill directories and register it in the catalog.",
          }),
        ),
        HttpApiEndpoint.delete("oneScienceSkillRemove", ExperimentalPaths.oneScienceSkillItem, {
          query: OneScienceSkillDeleteQuery,
          params: { name: Schema.String },
          success: described(OneScienceSkillManagement.DeletedSkillResult, "OneScience skill deleted"),
          error: SkillManagementApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.skill.remove",
            summary: "Delete user skill",
            description: "Remove a user-uploaded skill from global or project skill directories.",
          }),
        ),
        HttpApiEndpoint.post("oneScienceOneskillsUpgrade", ExperimentalPaths.oneScienceOneskillsUpgrade, {
          query: WorkspaceRoutingQuery,
          success: described(OneScienceOneskillsUpgradeResponse, "OneSkills upgraded from release package"),
          error: SkillManagementApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.oneskills.upgrade",
            summary: "Upgrade OneSkills from release package",
            description: "Download the latest OneSkills release into the shared install tree and refresh the catalog.",
          }),
        ),
        HttpApiEndpoint.get("oneScienceTaskProfileList", ExperimentalPaths.oneScienceTaskProfile, {
          query: WorkspaceRoutingQuery,
          success: described(OneScienceTaskProfileListResponse, "OneScience task profiles"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.taskProfile.list",
            summary: "List OneScience task profiles",
            description: "List task-first OneScience profiles with related primitive and resource counts.",
          }),
        ),
        HttpApiEndpoint.get("oneScienceExecutionCapability", ExperimentalPaths.oneScienceExecutionCapability, {
          query: WorkspaceRoutingQuery,
          success: described(OneScienceExecutionCapabilityResponse, "OneScience execution capability probe"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.executionCapability.get",
            summary: "Probe local execution capability",
            description: "Probe whether the current server environment can submit Slurm jobs locally.",
          }),
        ),
        HttpApiEndpoint.get("oneScienceReadme", ExperimentalPaths.oneScienceReadme, {
          query: OneScienceReadmeQuery,
          success: described(OneScienceReadmeResponse, "OneScience model readme"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.readme.get",
            summary: "Fetch model README",
            description: "Fetch README.md content from a Gitee or GitHub repository URL.",
          }),
        ),
        HttpApiEndpoint.get("oneScienceModelScopeDownloadList", ExperimentalPaths.oneScienceModelScopeDownload, {
          query: OneScienceModelScopeDownloadQuery,
          success: described(OneScienceModelScopeDownloadListResponse, "OneScience ModelScope downloads"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.modelscopeDownload.list",
            summary: "List ModelScope downloads",
            description: "List ModelScope download jobs for a workspace directory.",
          }),
        ),
        HttpApiEndpoint.get("oneScienceModelScopeDownloadInfo", ExperimentalPaths.oneScienceModelScopeDownloadInfo, {
          query: OneScienceModelScopeDownloadInfoQuery,
          success: described(OneScienceModelScopeDownloadInfoResponse, "OneScience ModelScope download preflight"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.modelscopeDownload.info",
            summary: "Get ModelScope download preflight info",
            description: "Get estimated dataset size for a ModelScope dataset download.",
          }),
        ),
        HttpApiEndpoint.get("oneScienceModelScopeDownloadDiskSpace", ExperimentalPaths.oneScienceModelScopeDownloadDiskSpace, {
          query: OneScienceModelScopeDownloadDiskQuery,
          success: described(OneScienceModelScopeDownloadDiskResponse, "OneScience ModelScope download disk space"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.modelscopeDownload.diskSpace",
            summary: "Get workspace download disk space",
            description: "Get available disk space for a workspace directory.",
          }),
        ),
        HttpApiEndpoint.get("oneScienceModelScopeDownloadCondaEnvs", ExperimentalPaths.oneScienceModelScopeDownloadCondaEnvs, {
          query: OneScienceModelScopeDownloadCondaEnvsQuery,
          success: described(OneScienceModelScopeDownloadCondaEnvsResponse, "Remote conda environments"),
          error: [HttpApiError.BadRequest, OneScienceModelScopeDownloadError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.modelscopeDownload.condaEnvs",
            summary: "List conda environments",
            description: "Run `conda env list` on the local server host, or on the selected SSH host via a login shell.",
          }),
        ),
        HttpApiEndpoint.post("oneScienceModelScopeDownloadStart", ExperimentalPaths.oneScienceModelScopeDownload, {
          query: WorkspaceRoutingQuery,
          payload: OneScienceModelScopeDownloadStartPayload,
          success: described(OneScienceModelScopeDownloadRecord, "OneScience ModelScope download started"),
          error: [HttpApiError.BadRequest, OneScienceModelScopeDownloadError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.modelscopeDownload.start",
            summary: "Start ModelScope dataset download",
            description: "Download a ModelScope dataset into the current workspace directory.",
          }),
        ),
        HttpApiEndpoint.post("oneScienceModelScopeDownloadCancel", ExperimentalPaths.oneScienceModelScopeDownloadCancel, {
          query: WorkspaceRoutingQuery,
          payload: OneScienceModelScopeDownloadCancelPayload,
          success: described(OneScienceModelScopeDownloadRecord, "OneScience ModelScope download cancelled"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.modelscopeDownload.cancel",
            summary: "Cancel ModelScope dataset download",
            description: "Cancel an in-progress ModelScope dataset download.",
          }),
        ),
        HttpApiEndpoint.post("oneScienceCaseRestore", ExperimentalPaths.oneScienceCaseRestore, {
          query: WorkspaceRoutingQuery,
          payload: OneScienceCaseRestorePayload,
          success: described(OneScienceCaseRestoreResponse, "OneScience preset case restored"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.case.restore",
            summary: "Restore deleted preset case session",
            description:
              "Re-import a previously deleted preset case session from the bundled session seed manifest so the case can be opened again from the cases page.",
          }),
        ),
        HttpApiEndpoint.delete("oneScienceModelScopeDownloadRemove", ExperimentalPaths.oneScienceModelScopeDownload, {
          query: OneScienceModelScopeDownloadRemoveQuery,
          success: described(Schema.Boolean, "OneScience ModelScope download removed"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.modelscopeDownload.remove",
            summary: "Remove downloaded ModelScope dataset",
            description: "Delete a downloaded ModelScope dataset from the workspace directory.",
          }),
        ),
        HttpApiEndpoint.get("aiPrimitiveList", ExperimentalPaths.aiPrimitive, {
          query: AIPrimitiveListQuery,
          success: described(AIPrimitiveListResponse, "AI primitives"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.primitive.list",
            summary: "List AI primitives",
            description: "List AI primitives stored in local SQLite.",
          }),
        ),
        HttpApiEndpoint.post("aiPrimitiveCreate", ExperimentalPaths.aiPrimitive, {
          query: WorkspaceRoutingQuery,
          payload: AIPrimitive.CreatePrimitive,
          success: described(AIPrimitive.Primitive, "AI primitive created"),
          error: [HttpApiError.BadRequest, HttpApiError.Unauthorized, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.primitive.create",
            summary: "Create AI primitive",
            description: "Create an AI primitive in local SQLite.",
          }),
        ),
        HttpApiEndpoint.get("aiPrimitiveGet", ExperimentalPaths.aiPrimitiveItem, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(AIPrimitive.Primitive, "AI primitive"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.primitive.get",
            summary: "Get AI primitive",
            description: "Get an AI primitive by ID.",
          }),
        ),
        HttpApiEndpoint.patch("aiPrimitiveUpdate", ExperimentalPaths.aiPrimitiveItem, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: AIPrimitive.UpdatePrimitive,
          success: described(AIPrimitive.Primitive, "AI primitive updated"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.primitive.update",
            summary: "Update AI primitive",
            description: "Update an AI primitive stored in local SQLite.",
          }),
        ),
        HttpApiEndpoint.delete("aiPrimitiveRemove", ExperimentalPaths.aiPrimitiveItem, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "AI primitive removed"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.primitive.remove",
            summary: "Remove AI primitive",
            description: "Soft delete an AI primitive stored in local SQLite.",
          }),
        ),
        HttpApiEndpoint.post("aiPrimitivePublish", ExperimentalPaths.aiPrimitivePublish, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: Schema.optional(AIPrimitive.PublishPrimitive),
          success: described(AIPrimitive.Primitive, "AI primitive published"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.primitive.publish",
            summary: "Publish AI primitive",
            description: "Validate required primitive fields and promote a draft primitive to callable status.",
          }),
        ),
        HttpApiEndpoint.get("aiPrimitiveByResource", ExperimentalPaths.aiPrimitiveByResource, {
          params: { resourceId: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(AIPrimitive.PrimitiveSourceLookup, "AI primitive source lookup"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.primitive.byResource",
            summary: "Lookup primitives by source resource",
            description: "Find callable or draft primitives linked to a OneScience resource ID.",
          }),
        ),
        HttpApiEndpoint.get("aiPrimitiveByResources", ExperimentalPaths.aiPrimitiveByResources, {
          query: AIPrimitiveByResourcesQuery,
          success: described(AIPrimitiveByResourcesResponse, "AI primitive source lookup batch"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.primitive.byResources",
            summary: "Lookup primitives by source resources",
            description: "Batch lookup callable or draft primitives linked to OneScience resource IDs.",
          }),
        ),

        HttpApiEndpoint.get("dataProjectList", ExperimentalPaths.dataProject, {
          query: OneScienceDataProjectListQuery,
          success: described(OneScienceDataProjectListResponse, "OneScience data projects"),
          error: [HttpApiError.BadRequest, HttpApiError.Unauthorized, HttpApiError.Forbidden],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.dataProject.list",
            summary: "List OneScience data projects",
            description: "List raw data intake projects and AI Ready workflow state from local SQLite.",
          }),
        ),
        HttpApiEndpoint.post("dataProjectCreate", ExperimentalPaths.dataProject, {
          query: WorkspaceRoutingQuery,
          payload: OneScienceDataProject.CreateProject,
          success: described(OneScienceDataProjectDetailResponse, "OneScience data project created"),
          error: [HttpApiError.BadRequest, CatalogGoneError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.dataProject.create",
            summary: "Create OneScience data project",
            description: "Create a raw data intake project for AI Ready dataset generation.",
          }),
        ),
        HttpApiEndpoint.get("dataProjectGet", ExperimentalPaths.dataProjectItem, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(OneScienceDataProjectDetailResponse, "OneScience data project detail"),
          error: catalogWriteErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.dataProject.get",
            summary: "Get OneScience data project",
            description: "Get a data project with runs, artifacts, quality reports, and releases.",
          }),
        ),
        HttpApiEndpoint.patch("dataProjectUpdate", ExperimentalPaths.dataProjectItem, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: OneScienceDataProject.UpdateProject,
          success: described(OneScienceDataProjectDetailResponse, "OneScience data project updated"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound, CatalogGoneError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.dataProject.update",
            summary: "Update OneScience data project",
            description: "Update raw data intake metadata and workflow state.",
          }),
        ),
        HttpApiEndpoint.post("dataProjectAnalyze", ExperimentalPaths.dataProjectAnalyze, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(OneScienceDataProjectDetailResponse, "OneScience data project analysis started"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound, CatalogGoneError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.dataProject.analyze",
            summary: "Analyze raw data project",
            description: "Create an agent run payload for analyzing raw data and planning AI Ready generation.",
          }),
        ),
        HttpApiEndpoint.post("dataProjectAIReady", ExperimentalPaths.dataProjectAIReady, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: OneScienceDataProject.CreateArtifact,
          success: described(OneScienceDataProjectDetailResponse, "OneScience data project AI Ready artifact"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound, CatalogGoneError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.dataProject.aiReady",
            summary: "Create AI Ready data artifact",
            description: "Store an AI Ready artifact produced by the data workflow.",
          }),
        ),
        HttpApiEndpoint.post("dataProjectTraining", ExperimentalPaths.dataProjectTraining, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: OneScienceDataProjectTrainingPayload,
          success: described(OneScienceDataProjectDetailResponse, "OneScience data project training handoff"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound, CatalogGoneError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.dataProject.training",
            summary: "Create data training handoff",
            description: "Create a metadata-only training handoff for an AI Ready artifact.",
          }),
        ),
        HttpApiEndpoint.post("dataProjectPublish", ExperimentalPaths.dataProjectPublish, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: OneScienceDataProjectArtifactPayload,
          success: described(OneScienceDataProjectDetailResponse, "OneScience data project published"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound, CatalogGoneError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.dataProject.publish",
            summary: "Publish AI Ready data to OneHub",
            description: "Publish an AI Ready artifact as a OneHub dataset resource.",
          }),
        ),
        HttpApiEndpoint.post("catalogProbe", ExperimentalPaths.catalogProbe, {
          query: WorkspaceRoutingQuery,
          payload: CatalogProbePayload,
          success: described(CatalogJson, "Catalog probe"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.post("catalogRawCreate", ExperimentalPaths.catalogRawSource, {
          query: WorkspaceRoutingQuery,
          payload: CatalogRawCreatePayload,
          success: described(CatalogJson, "Raw source"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.get("catalogRawList", ExperimentalPaths.catalogRawSource, {
          query: CatalogRawListQuery,
          success: described(CatalogJson, "Raw sources"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.get("catalogRawPreview", ExperimentalPaths.catalogRawSourcePreview, {
          params: { id: Schema.String },
          query: CatalogAlreadyPreviewQuery,
          success: described(CatalogJson, "Raw preview"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.patch("catalogRawPatch", ExperimentalPaths.catalogRawSourceItem, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: CatalogRawPatchPayload,
          success: described(CatalogJson, "Raw source"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.delete("catalogRawDelete", ExperimentalPaths.catalogRawSourceItem, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(CatalogJson, "Raw source deleted"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.post("catalogRawConvert", ExperimentalPaths.catalogRawSourceConvert, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(CatalogJson, "Already dataset"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.get("catalogAlreadyList", ExperimentalPaths.catalogAlready, {
          query: CatalogAlreadyListQuery,
          success: described(CatalogJson, "Already datasets"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.get("catalogAlreadyPreview", ExperimentalPaths.catalogAlreadyPreview, {
          params: { id: Schema.String },
          query: CatalogAlreadyPreviewQuery,
          success: described(CatalogJson, "Already preview"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.post("catalogAlreadyIngest", ExperimentalPaths.catalogAlready, {
          query: WorkspaceRoutingQuery,
          payload: CatalogIngestPayload,
          success: described(CatalogJson, "Already dataset"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.patch("catalogAlreadyPatch", ExperimentalPaths.catalogAlreadyItem, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: CatalogAlreadyPatchPayload,
          success: described(CatalogJson, "Already dataset"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.delete("catalogAlreadyDelete", ExperimentalPaths.catalogAlreadyItem, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(CatalogJson, "Already dataset deleted"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.post("catalogAlreadyPublish", ExperimentalPaths.catalogAlreadyPublish, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(CatalogJson, "Already dataset"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.post("catalogAlreadyUnpublish", ExperimentalPaths.catalogAlreadyUnpublish, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(CatalogJson, "Already dataset"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.post("catalogAlreadyReingest", ExperimentalPaths.catalogAlreadyReingest, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(CatalogJson, "Raw source"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.post("catalogAlreadyTraining", ExperimentalPaths.catalogAlreadyTraining, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: CatalogTrainingPayload,
          success: described(CatalogJson, "Training handoff"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.post("catalogAlreadyPrimitive", ExperimentalPaths.catalogAlreadyPrimitive, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: CatalogAlreadyPrimitivePayload,
          success: described(CatalogJson, "Already dataset primitive"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.post("catalogFsStat", ExperimentalPaths.catalogFsStat, {
          query: WorkspaceRoutingQuery,
          payload: CatalogFsPathPayload,
          success: described(CatalogJson, "Filesystem stat"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.post("catalogFsSample", ExperimentalPaths.catalogFsSample, {
          query: WorkspaceRoutingQuery,
          payload: CatalogFsPathPayload,
          success: described(CatalogJson, "Filesystem sample"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.get("catalogChipsGet", ExperimentalPaths.catalogSessionChips, {
          params: { sessionId: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(CatalogJson, "Session chips"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.put("catalogChipsPut", ExperimentalPaths.catalogSessionChips, {
          params: { sessionId: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: CatalogChipsPayload,
          success: described(CatalogJson, "Session chips"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.put("catalogObjectStoreKeyPut", ExperimentalPaths.catalogObjectStoreKey, {
          query: WorkspaceRoutingQuery,
          payload: CatalogObjectStoreKeyPayload,
          success: described(CatalogJson, "Object store key"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.get("catalogObjectStoreKeyList", ExperimentalPaths.catalogObjectStoreKey, {
          query: WorkspaceRoutingQuery,
          success: described(CatalogJson, "Object store keys"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.delete("catalogObjectStoreKeyDelete", ExperimentalPaths.catalogObjectStoreKeyItem, {
          params: { provider: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(CatalogJson, "Object store key deleted"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.put("catalogDbConnectionPut", ExperimentalPaths.catalogDbConnection, {
          query: WorkspaceRoutingQuery,
          payload: CatalogDbConnectionPayload,
          success: described(CatalogJson, "Database connection"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.get("catalogDbConnectionList", ExperimentalPaths.catalogDbConnection, {
          query: WorkspaceRoutingQuery,
          success: described(CatalogJson, "Database connections"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.delete("catalogDbConnectionDelete", ExperimentalPaths.catalogDbConnectionItem, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(CatalogJson, "Database connection deleted"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.get("catalogDbConnectionTables", ExperimentalPaths.catalogDbConnectionTables, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(CatalogJson, "Database connection tables"),
          error: catalogWriteErrors,
        }),
        HttpApiEndpoint.get("agentRegistry", ExperimentalPaths.agentRegistry, {
          query: AIPrimitiveListQuery,
          success: described(AIPrimitiveListResponse, "Callable AI primitives"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.onescience.agentRegistry.list",
            summary: "List callable AI primitives",
            description: "List callable AI primitives from the agent registry.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "experimental",
          description: "Experimental HttpApi read-only routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
