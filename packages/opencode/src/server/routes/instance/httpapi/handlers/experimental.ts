import { Account } from "@/account/account"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { ConfigSSH } from "@/config/ssh"
import { InstanceState } from "@/effect/instance-state"
import { MCP } from "@/mcp"
import { OneScienceDataProject } from "@/onescience/data-project"
import { CatalogError, DataCatalog } from "@/onescience/data-catalog"
import { Flag } from "@opencode-ai/core/flag/flag"
import { AIPrimitive } from "@/onescience/primitive"
import { OneScienceModelScopeDownload } from "@/onescience/modelscope-download"
import { OneScienceReadme } from "@/onescience/readme"
import { OneScienceResource } from "@/onescience/resource"
import { OneScienceScenario } from "@/onescience/scenario"
import { OneScienceSkill } from "@/onescience/skill"
import { OneScienceSkillManagement } from "@/onescience/skill-management"
import { migrateStaticPrimitives } from "@/onescience/primitive-migration"
import { OneScienceTaskProfile } from "@/onescience/task-profile"
import { probeExecutionCapability } from "@/onescience/execution-capability"
import { Catalog } from "@/catalog/index"
import { OneSkills } from "@/oneskills/index"
import { GlobalBus } from "@/bus/global"
import * as PlatformAuth from "@/platform-auth/platform-auth"
import { SessionSeed } from "@/session/session-seed"
import { Database } from "@/storage/db"
import { Project } from "@/project/project"
import { Session } from "@/session/session"
import { Skill } from "@/skill"
import { ToolJsonSchema } from "@/tool/json-schema"
import { ToolRegistry } from "@/tool/registry"
import { Worktree } from "@/worktree"
import { Effect, Cause, Option } from "effect"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { HttpServerRequest } from "effect/unstable/http"
import { InstanceHttpApi } from "../api"
import { AIPrimitiveByResourcesQuery, AIPrimitiveListQuery, CatalogAlreadyListQuery, CatalogAlreadyPatchPayload, CatalogAlreadyPrimitivePayload, CatalogAlreadyPreviewQuery, CatalogChipsPayload, CatalogConflictError, CatalogDbConnectionPayload, CatalogForbiddenError, CatalogFsPathPayload, CatalogGoneError, CatalogIngestPayload, CatalogObjectStoreKeyPayload, CatalogProbePayload, CatalogRawCreatePayload, CatalogRawListQuery, CatalogRawPatchPayload, CatalogTrainingPayload, CatalogUnprocessableError, CatalogBadGatewayError, CatalogUnavailableError, ConsoleSwitchPayload, OneScienceCaseRestorePayload, OneScienceDataProjectArtifactPayload, OneScienceDataProjectListQuery, OneScienceDataProjectTrainingPayload, OneScienceModelScopeDownloadCancelPayload, OneScienceModelScopeDownloadCondaEnvsQuery, OneScienceModelScopeDownloadDiskQuery, OneScienceModelScopeDownloadError, OneScienceModelScopeDownloadInfoQuery, OneScienceModelScopeDownloadStartPayload, OneScienceModelScopeDownloadQuery, OneScienceModelScopeDownloadRemoveQuery, OneScienceReadmeQuery, OneScienceResourceListQuery, OneScienceScenarioListQuery, OneScienceSkillDeleteQuery, OneScienceSkillListQuery, OneScienceSkillRepoListQuery, SessionListQuery, SkillManagementApiError, ToolListQuery, WorktreeApiError } from "../groups/experimental"
import { WorkspaceRoutingQuery } from "../middleware/workspace-routing"

const projectDir = Effect.fn("ExperimentalHttpApi.projectDir")(function* (query: typeof WorkspaceRoutingQuery.Type) {
  if (query.directory) return query.directory
  const request = yield* HttpServerRequest.HttpServerRequest
  return request.headers["x-opencode-directory"] ?? process.cwd()
})

function skillManagementErrorMessage(error: unknown) {
  if (Cause.isUnknownError(error)) {
    const cause = error.cause
    if (cause instanceof Error && cause.message) return cause.message
    if (typeof cause === "string" && cause) return cause
  }
  if (error instanceof Error && error.message) return error.message
  return "技能仓库配置失败"
}

function mapSkillManagementError<A, R>(self: Effect.Effect<A, unknown, R>) {
  return self.pipe(
    Effect.catch((error) =>
      Effect.fail(
        new SkillManagementApiError({
          message: skillManagementErrorMessage(error),
        }),
      ),
    ),
  )
}

function skillManagementPromise<A>(promise: () => Promise<A>) {
  return mapSkillManagementError(
    Effect.tryPromise({
      try: promise,
      catch: (error) => error,
    }),
  )
}

function refreshSkillState(directory: string) {
  return Effect.gen(function* () {
    yield* skillManagementPromise(() => OneScienceSkillManagement.syncConfiguredSkillRepos(directory))
    const config = yield* Config.Service
    const skill = yield* Skill.Service
    yield* config.invalidate()
    yield* skill.refresh()
  })
}

function presentModelScopeDownloadRecord(record: OneScienceModelScopeDownload.ModelScopeDownloadRecord) {
  const environment = record.environment
  return {
    resourceId: record.resource_id,
    kind: record.kind,
    status: record.status,
    startedAt: record.started_at,
    ...(record.finished_at !== undefined ? { finishedAt: record.finished_at } : {}),
    ...(record.error ? { error: record.error } : {}),
    // Never echo the persisted ssh config snapshot back to the client.
    ...(environment
      ? {
          environment:
            environment.kind === "ssh"
              ? { kind: "ssh" as const, targetName: environment.target_name, remotePath: environment.remote_path }
              : { kind: "local" as const },
        }
      : {}),
    ...(record.downloaded_bytes !== undefined ? { downloadedBytes: record.downloaded_bytes } : {}),
    ...(record.total_bytes !== undefined ? { totalBytes: record.total_bytes } : {}),
    ...(record.progress_total_bytes !== undefined ? { progressTotalBytes: record.progress_total_bytes } : {}),
    ...(record.estimated_total_bytes !== undefined ? { estimatedTotalBytes: record.estimated_total_bytes } : {}),
    ...(record.current_file ? { currentFile: record.current_file } : {}),
    ...(record.current_file_bytes !== undefined ? { currentFileBytes: record.current_file_bytes } : {}),
    ...(record.current_file_total_bytes !== undefined ? { currentFileTotalBytes: record.current_file_total_bytes } : {}),
    ...(record.cache_paths && record.cache_paths.length > 0 ? { cachePaths: record.cache_paths } : {}),
  }
}

type DownloadEnvironmentInput = {
  kind: "local" | "ssh"
  targetName?: string
  remotePath?: string
  condaEnv?: string
  /** Ignored: the server resolves SSH connection details from its own config by targetName. */
  ssh?: OneScienceModelScopeDownload.ModelScopeDownloadSshConfig
}

function resolveSshConfig(
  targetName: string,
  sshTargets: Record<string, ConfigSSH.Info | { enabled?: boolean }> | undefined,
) {
  const target = sshTargets?.[targetName]
  if (!target || !("host" in target) || typeof target.host !== "string" || !target.host || target.enabled === false) {
    throw new HttpApiError.BadRequest()
  }
  const ssh: OneScienceModelScopeDownload.ModelScopeDownloadSshConfig = {
    host: target.host,
    ...(target.hostName ? { hostName: target.hostName } : {}),
    ...(target.port ? { port: target.port } : {}),
    ...(target.username ? { username: target.username } : {}),
    ...(target.options ? { options: target.options } : {}),
    ...(target.auth
      ? {
          auth: {
            type: target.auth.type,
            keyPath: target.auth.keyPath,
            ...(target.auth.type === "password" && target.auth.password ? { password: target.auth.password } : {}),
          },
        }
      : {}),
  }
  return ssh
}

function requireDownloadEnvironment(
  input: DownloadEnvironmentInput | undefined,
  sshTargets: Record<string, ConfigSSH.Info | { enabled?: boolean }> | undefined,
) {
  if (!input || input.kind === "local") {
    const condaEnv = input?.condaEnv?.trim()
    return { kind: "local" as const, ...(condaEnv ? { condaEnv } : {}) }
  }
  if (!input.targetName || !input.remotePath?.trim()) {
    throw new HttpApiError.BadRequest()
  }
  return {
    kind: "ssh" as const,
    targetName: input.targetName,
    remotePath: input.remotePath.trim(),
    ssh: resolveSshConfig(input.targetName, sshTargets),
    ...(input.condaEnv?.trim() ? { condaEnv: input.condaEnv.trim() } : {}),
  }
}

function requireSshTarget(
  input: DownloadEnvironmentInput | undefined,
  sshTargets: Record<string, ConfigSSH.Info | { enabled?: boolean }> | undefined,
) {
  if (!input || input.kind !== "ssh" || !input.targetName) {
    throw new HttpApiError.BadRequest()
  }
  return {
    kind: "ssh" as const,
    targetName: input.targetName,
    ssh: resolveSshConfig(input.targetName, sshTargets),
  }
}

function locateDownloadEnvironment(input: DownloadEnvironmentInput | undefined) {
  if (!input || input.kind === "local") return undefined
  return { kind: "ssh" as const, targetName: input.targetName ?? "" }
}

function parseDownloadEnvironmentQuery(raw: string | undefined): DownloadEnvironmentInput | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as DownloadEnvironmentInput
    if (parsed?.kind !== "local" && parsed?.kind !== "ssh") return undefined
    return parsed
  } catch {
    return undefined
  }
}

function mapWorktreeError<A, R>(self: Effect.Effect<A, Worktree.Error, R>) {
  return self.pipe(
    Effect.mapError((error) => new WorktreeApiError({ name: error._tag, data: { message: error.message } })),
  )
}

function mapPrimitiveError<A>(fn: () => A) {
  return Effect.try({
    try: fn,
    catch: (error) => {
      if (Database.NotFoundError.isInstance(error)) return new HttpApiError.NotFound({})
      return new HttpApiError.BadRequest({})
    },
  })
}

function currentAccountId(current: PlatformAuth.CurrentSessionInfo) {
  const accountId = current.session?.account.id
  if (accountId) return accountId
  // Unauthenticated: always guest-scoped (presets only). Server admin stays unscoped.
  if (current.serverAdmin) return undefined
  return ""
}

const requireAccountId = Effect.fn("ExperimentalHttpApi.requireAccountId")(function* (current: PlatformAuth.CurrentSessionInfo) {
  const accountId = currentAccountId(current)
  if (accountId) return accountId
  if (PlatformAuth.authRequired() && !current.serverAdmin) {
    return yield* Effect.fail(new HttpApiError.Unauthorized({}))
  }
  return undefined as string | undefined
})

const requireCatalogAccount = Effect.fn("ExperimentalHttpApi.requireCatalogAccount")(function* () {
  if (Flag.OPENCODE_WORKSPACE_ID) return yield* Effect.fail(new HttpApiError.Forbidden({}))
  const current = yield* PlatformAuth.CurrentSession
  const accountId = current.session?.account.id
  if (!accountId) return yield* Effect.fail(new HttpApiError.Unauthorized({}))
  return { accountId, session: current.session }
})

const requireCatalogIngestAuth = Effect.fn("ExperimentalHttpApi.requireCatalogIngestAuth")(function* () {
  if (Flag.OPENCODE_WORKSPACE_ID) return yield* Effect.fail(new HttpApiError.Forbidden({}))
  const current = yield* PlatformAuth.CurrentSession
  if (current.catalogToken) {
    return {
      accountId: current.catalogToken.accountId,
      session: undefined as PlatformAuth.AuthSession | undefined,
      viaToken: true as const,
      tokenWorkspaceId: current.catalogToken.workspaceId,
    }
  }
  const accountId = current.session?.account.id
  if (!accountId) return yield* Effect.fail(new HttpApiError.Unauthorized({}))
  return { accountId, session: current.session, viaToken: false as const, tokenWorkspaceId: undefined as string | undefined }
})

function mapCatalogError(error: unknown) {
  if (error instanceof CatalogError) {
    if (error.status === 401) return new HttpApiError.Unauthorized({})
    if (error.status === 403) return new CatalogForbiddenError({ error: error.error, message: error.message })
    if (error.status === 404) return new HttpApiError.NotFound({})
    if (error.status === 409) return new CatalogConflictError({ error: error.error, message: error.message })
    if (error.status === 410) return new CatalogGoneError({ error: error.error })
    if (error.status === 422) return new CatalogUnprocessableError({ error: error.error, message: error.message })
    if (error.status === 502) return new CatalogBadGatewayError({ error: error.error, message: error.message })
    if (error.status === 503) return new CatalogUnavailableError({ error: error.error, message: error.message })
    return new HttpApiError.BadRequest({})
  }
  if (Database.NotFoundError.isInstance(error)) return new HttpApiError.NotFound({})
  return new HttpApiError.BadRequest({})
}

function catalogTry<A>(fn: () => A | Promise<A>) {
  return Effect.tryPromise({
    try: async () => await fn(),
    catch: (error) => mapCatalogError(error),
  })
}

const catalogGone = Effect.fail(new CatalogGoneError({ error: "gone" }))

export const experimentalHandlers = HttpApiBuilder.group(InstanceHttpApi, "experimental", (handlers) =>
  Effect.gen(function* () {
    const account = yield* Account.Service
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const mcp = yield* MCP.Service
    const project = yield* Project.Service
    const registry = yield* ToolRegistry.Service
    const worktreeSvc = yield* Worktree.Service

    const getConsole = Effect.fn("ExperimentalHttpApi.console")(function* () {
      const [state, groups] = yield* Effect.all(
        [
          config.getConsoleState(),
          account.orgsByAccount().pipe(Effect.catch(() => Effect.fail(new HttpApiError.InternalServerError({})))),
        ],
        {
          concurrency: "unbounded",
        },
      )
      return {
        consoleManagedProviders: state.consoleManagedProviders,
        ...(state.activeOrgName ? { activeOrgName: state.activeOrgName } : {}),
        switchableOrgCount: groups.reduce((count, group) => count + group.orgs.length, 0),
      }
    })

    const listConsoleOrgs = Effect.fn("ExperimentalHttpApi.consoleOrgs")(function* () {
      const [groups, active] = yield* Effect.all(
        [
          account.orgsByAccount().pipe(Effect.catch(() => Effect.fail(new HttpApiError.InternalServerError({})))),
          account.active().pipe(Effect.catch(() => Effect.fail(new HttpApiError.InternalServerError({})))),
        ],
        {
          concurrency: "unbounded",
        },
      )
      const info = Option.getOrUndefined(active)
      return {
        orgs: groups.flatMap((group) =>
          group.orgs.map((org) => ({
            accountID: group.account.id,
            accountEmail: group.account.email,
            accountUrl: group.account.url,
            orgID: org.id,
            orgName: org.name,
            active: !!info && info.id === group.account.id && info.active_org_id === org.id,
          })),
        ),
      }
    })

    const switchConsole = Effect.fn("ExperimentalHttpApi.consoleSwitch")(function* (ctx: {
      payload: typeof ConsoleSwitchPayload.Type
    }) {
      yield* account
        .use(ctx.payload.accountID, Option.some(ctx.payload.orgID))
        .pipe(Effect.catch(() => Effect.fail(new HttpApiError.BadRequest({}))))
      return true
    })

    const tool = Effect.fn("ExperimentalHttpApi.tool")(function* (ctx: { query: typeof ToolListQuery.Type }) {
      const list = yield* registry.tools({
        providerID: ctx.query.provider,
        modelID: ctx.query.model,
        agent: yield* agents.defaultInfo(),
      })
      return list.map((item) => ({
        id: item.id,
        description: item.description,
        parameters: ToolJsonSchema.fromTool(item),
      }))
    })

    const toolIDs = Effect.fn("ExperimentalHttpApi.toolIDs")(function* () {
      return yield* registry.ids()
    })

    const worktree = Effect.fn("ExperimentalHttpApi.worktree")(function* () {
      const ctx = yield* InstanceState.context
      return yield* project.sandboxes(ctx.project.id)
    })

    const worktreeCreate = Effect.fn("ExperimentalHttpApi.worktreeCreate")(function* (ctx: {
      payload: Worktree.CreateInput | undefined
    }) {
      return yield* mapWorktreeError(worktreeSvc.create(ctx.payload))
    })

    const worktreeRemove = Effect.fn("ExperimentalHttpApi.worktreeRemove")(function* (input: {
      payload: Worktree.RemoveInput
    }) {
      const ctx = yield* InstanceState.context
      yield* mapWorktreeError(worktreeSvc.remove(input.payload))
      yield* project.removeSandbox(ctx.project.id, input.payload.directory)
      return true
    })

    const worktreeReset = Effect.fn("ExperimentalHttpApi.worktreeReset")(function* (ctx: {
      payload: Worktree.ResetInput
    }) {
      yield* mapWorktreeError(worktreeSvc.reset(ctx.payload))
      return true
    })

    const session = Effect.fn("ExperimentalHttpApi.session")(function* (ctx: { query: typeof SessionListQuery.Type }) {
      const limit = ctx.query.limit ?? 100
      const sessions = Array.from(
        Session.listGlobal({
          directory: ctx.query.directory,
          roots: ctx.query.roots,
          start: ctx.query.start,
          cursor: ctx.query.cursor,
          search: ctx.query.search,
          limit: limit + 1,
          archived: ctx.query.archived,
        }),
      )
      const list = sessions.length > limit ? sessions.slice(0, limit) : sessions
      return HttpServerResponse.jsonUnsafe(list, {
        headers:
          sessions.length > limit && list.length > 0
            ? { "x-next-cursor": String(list[list.length - 1].time.updated) }
            : undefined,
      })
    })

    const resource = Effect.fn("ExperimentalHttpApi.resource")(function* () {
      return yield* mcp.resources()
    })

    const oneScienceResourceList = Effect.fn("ExperimentalHttpApi.oneScienceResourceList")(function* (ctx: {
      query: typeof OneScienceResourceListQuery.Type
    }) {
      const current = yield* PlatformAuth.CurrentSession
      return OneScienceResource.list(ctx.query.page, {
        domain: ctx.query.domain,
        q: ctx.query.q,
        customOnly: ctx.query.customOnly,
        limit: ctx.query.limit,
        offset: ctx.query.offset,
        accountId: currentAccountId(current) ?? "",
      })
    })

    const oneScienceResourceCustomCounts = Effect.fn("ExperimentalHttpApi.oneScienceResourceCustomCounts")(function* () {
      const current = yield* PlatformAuth.CurrentSession
      return OneScienceResource.customCountsByPage(currentAccountId(current) ?? "")
    })

    const oneScienceCatalogMetrics = Effect.fn("ExperimentalHttpApi.oneScienceCatalogMetrics")(function* () {
      const current = yield* PlatformAuth.CurrentSession
      const accountId = currentAccountId(current) ?? ""
      const custom = OneScienceResource.customCountsByPage(accountId)
      return {
        ...custom,
        callablePrimitives: AIPrimitive.count({ status: "callable", accountId }),
      }
    })

    const oneScienceResourceGet = Effect.fn("ExperimentalHttpApi.oneScienceResourceGet")(function* (ctx: {
      params: { id: string }
    }) {
      const current = yield* PlatformAuth.CurrentSession
      return yield* mapPrimitiveError(() => OneScienceResource.get(ctx.params.id, currentAccountId(current) ?? ""))
    })

    const mapResourceMutationError = <A>(fn: () => A) =>
      Effect.try({
        try: fn,
        catch: (error) => {
          if (Database.NotFoundError.isInstance(error)) return new HttpApiError.NotFound({})
          return new HttpApiError.BadRequest({})
        },
      })

    const oneScienceResourceCreate = Effect.fn("ExperimentalHttpApi.oneScienceResourceCreate")(function* (ctx: {
      payload: OneScienceResource.CreateResource
    }) {
      const current = yield* PlatformAuth.CurrentSession
      const accountId = yield* requireAccountId(current)
      if (!accountId) return yield* Effect.fail(new HttpApiError.Unauthorized({}))
      // Create never 404s; keep error channel as BadRequest | Unauthorized only.
      return yield* Effect.try({
        try: () => OneScienceResource.create(ctx.payload, accountId),
        catch: () => new HttpApiError.BadRequest({}),
      })
    })

    const oneScienceResourceUpdate = Effect.fn("ExperimentalHttpApi.oneScienceResourceUpdate")(function* (ctx: {
      params: { id: string }
      payload: OneScienceResource.UpdateResource
    }) {
      const current = yield* PlatformAuth.CurrentSession
      const accountId = yield* requireAccountId(current)
      if (!accountId) return yield* Effect.fail(new HttpApiError.Unauthorized({}))
      return yield* mapResourceMutationError(() => OneScienceResource.update(ctx.params.id, ctx.payload, accountId))
    })

    const oneScienceResourceRemove = Effect.fn("ExperimentalHttpApi.oneScienceResourceRemove")(function* (ctx: {
      params: { id: string }
    }) {
      const current = yield* PlatformAuth.CurrentSession
      const accountId = yield* requireAccountId(current)
      if (!accountId) return yield* Effect.fail(new HttpApiError.Unauthorized({}))
      return yield* mapResourceMutationError(() => OneScienceResource.remove(ctx.params.id, accountId))
    })

    const oneScienceScenarioList = Effect.fn("ExperimentalHttpApi.oneScienceScenarioList")(function* (ctx: {
      query: typeof OneScienceScenarioListQuery.Type
    }) {
      return OneScienceScenario.list({
        domain: ctx.query.domain,
        model: ctx.query.model,
        modelId: ctx.query.modelId,
        q: ctx.query.q,
        limit: ctx.query.limit,
        offset: ctx.query.offset,
      })
    })

    const oneScienceScenarioGet = Effect.fn("ExperimentalHttpApi.oneScienceScenarioGet")(function* (ctx: {
      params: { id: string }
    }) {
      return yield* mapPrimitiveError(() => OneScienceScenario.get(ctx.params.id))
    })

    const oneScienceSkillList = Effect.fn("ExperimentalHttpApi.oneScienceSkillList")(function* (ctx: {
      query: typeof OneScienceSkillListQuery.Type
    }) {
      const current = yield* PlatformAuth.CurrentSession
      const accountId = currentAccountId(current)
      if (ctx.query.includePrimitives === true) {
        return OneScienceSkill.listWithPrimitives({ layer: ctx.query.layer, limit: ctx.query.limit, offset: ctx.query.offset, accountId })
      }
      const result = OneScienceSkill.list({ layer: ctx.query.layer, limit: ctx.query.limit, offset: ctx.query.offset, accountId })
      return { ...result, items: result.items.map((item) => ({ ...item, primitives: [] as const })) }
    })

    const oneScienceSkillRepoList = Effect.fn("ExperimentalHttpApi.oneScienceSkillRepoList")(function* (ctx: {
      query: typeof OneScienceSkillRepoListQuery.Type
    }) {
      const directory = yield* projectDir(ctx.query)
      if (ctx.query.sync === true) {
        yield* refreshSkillState(directory)
      }
      const items = yield* skillManagementPromise(() => OneScienceSkillManagement.listReposFast(directory))
      return { items }
    })

    const oneScienceSkillRepoCreate = Effect.fn("ExperimentalHttpApi.oneScienceSkillRepoCreate")(function* (ctx: {
      query: typeof WorkspaceRoutingQuery.Type
      payload: OneScienceSkillManagement.CreateSkillRepo
    }) {
      const directory = yield* projectDir(ctx.query)
      const row = yield* skillManagementPromise(() => OneScienceSkillManagement.addRepo(directory, ctx.payload))
      yield* refreshSkillState(directory)
      return row
    })

    const oneScienceSkillRepoRemove = Effect.fn("ExperimentalHttpApi.oneScienceSkillRepoRemove")(function* (ctx: {
      query: typeof WorkspaceRoutingQuery.Type
      params: { id: string }
    }) {
      const directory = yield* projectDir(ctx.query)
      const removed = yield* skillManagementPromise(() => OneScienceSkillManagement.removeRepo(directory, ctx.params.id))
      yield* refreshSkillState(directory)
      return removed
    })

    const oneScienceSkillUpload = Effect.fn("ExperimentalHttpApi.oneScienceSkillUpload")(function* (ctx: {
      query: typeof WorkspaceRoutingQuery.Type
      payload: OneScienceSkillManagement.UploadSkill
    }) {
      const directory = yield* projectDir(ctx.query)
      const current = yield* PlatformAuth.CurrentSession
      const accountId = yield* requireAccountId(current)
      const result = yield* skillManagementPromise(() =>
        OneScienceSkillManagement.uploadSkill(directory, ctx.payload, accountId),
      )
      yield* refreshSkillState(directory)
      return result
    })

    const oneScienceSkillRemove = Effect.fn("ExperimentalHttpApi.oneScienceSkillRemove")(function* (ctx: {
      query: typeof OneScienceSkillDeleteQuery.Type
      params: { name: string }
    }) {
      const directory = yield* projectDir(ctx.query)
      const current = yield* PlatformAuth.CurrentSession
      const accountId = yield* requireAccountId(current)
      const result = yield* skillManagementPromise(() =>
        OneScienceSkillManagement.deleteSkill(directory, {
          name: ctx.params.name,
          scope: ctx.query.scope,
        }, accountId),
      )
      yield* refreshSkillState(directory)
      return result
    })

    const oneScienceOneskillsUpgrade = Effect.fn("ExperimentalHttpApi.oneScienceOneskillsUpgrade")(function* () {
      const current = yield* PlatformAuth.CurrentSession
      const accountId = yield* requireAccountId(current)
      if (!accountId) return yield* Effect.fail(new HttpApiError.Unauthorized({}))
      const projectRoot = OneSkills.globalProjectRoot()
      const result = yield* skillManagementPromise(() => OneSkills.upgrade({ projectRoot }))
      yield* skillManagementPromise(async () => {
        PlatformAuth.removeAccountOneskillsInstalls()
      })
      // Post-install work must not fail a successful skills install.
      // Skip syncConfiguredSkillRepos — git fetch/clone of configured repos can hang
      // for minutes and exceed the UI timeout after OneSkills is already updated.
      const primitives = yield* skillManagementPromise(async () => {
        try {
          const migrated = migrateStaticPrimitives({ projectRoot })
          return {
            seedSource: migrated.seedSource,
            seedVersion: migrated.seedVersion as string | undefined,
            ...(migrated.seedFallbackReason ? { seedFallbackReason: migrated.seedFallbackReason } : {}),
          }
        } catch (error) {
          return {
            seedSource: "bundled" as const,
            seedVersion: undefined as string | undefined,
            seedFallbackReason: error instanceof Error ? error.message : "post-upgrade primitive migration failed",
          }
        }
      })
      yield* skillManagementPromise(async () => {
        try {
          Catalog.reconcile({ syncSkills: true })
        } catch {}
      })
      const config = yield* Config.Service
      const skill = yield* Skill.Service
      yield* config.invalidate().pipe(Effect.catch(() => Effect.void))
      yield* skill.refresh().pipe(Effect.catch(() => Effect.void))
      GlobalBus.emit("event", {
        payload: {
          type: OneSkills.UPGRADED_EVENT,
          properties: {
            version: result.version,
            skillCount: result.skillCount,
          },
        },
      })
      return {
        version: result.version,
        skillCount: result.skillCount,
        skillsDir: result.skillsDir,
        releaseUrl: result.releaseUrl,
        seedSource: primitives.seedSource,
        seedVersion: primitives.seedVersion,
        ...(primitives.seedFallbackReason ? { seedFallbackReason: primitives.seedFallbackReason } : {}),
      }
    })

    const oneScienceTaskProfileList = Effect.fn("ExperimentalHttpApi.oneScienceTaskProfileList")(function* () {
      return OneScienceTaskProfile.list()
    })

    const oneScienceExecutionCapability = Effect.fn("ExperimentalHttpApi.oneScienceExecutionCapability")(function* () {
      return yield* Effect.promise(() => probeExecutionCapability())
    })

    const oneScienceReadme = Effect.fn("ExperimentalHttpApi.oneScienceReadme")(function* (ctx: {
      query: typeof OneScienceReadmeQuery.Type
    }) {
      const content = yield* Effect.tryPromise({
        try: () => OneScienceReadme.fetchReadme(ctx.query.url),
        catch: () => new HttpApiError.BadRequest(),
      })
      return { content, sourceUrl: ctx.query.url }
    })

    const oneScienceModelScopeDownloadList = Effect.fn("ExperimentalHttpApi.oneScienceModelScopeDownloadList")(function* (ctx: {
      query: typeof OneScienceModelScopeDownloadQuery.Type
    }) {
      const items = yield* Effect.tryPromise({
        try: () => OneScienceModelScopeDownload.listModelScopeDownloads(ctx.query.directory),
        catch: () => new HttpApiError.BadRequest(),
      })
      return { items: items.map(presentModelScopeDownloadRecord) }
    })

    const oneScienceModelScopeDownloadInfo = Effect.fn("ExperimentalHttpApi.oneScienceModelScopeDownloadInfo")(function* (ctx: {
      query: typeof OneScienceModelScopeDownloadInfoQuery.Type
    }) {
      return yield* Effect.tryPromise({
        try: () => OneScienceModelScopeDownload.getModelScopeDownloadPreflight(ctx.query.directory, ctx.query.resourceId),
        catch: () => new HttpApiError.BadRequest(),
      })
    })

    const oneScienceModelScopeDownloadDiskSpace = Effect.fn("ExperimentalHttpApi.oneScienceModelScopeDownloadDiskSpace")(function* (ctx: {
      query: typeof OneScienceModelScopeDownloadDiskQuery.Type
    }) {
      const config = yield* Config.Service
      const info = yield* config.get()
      return yield* Effect.tryPromise({
        try: () =>
          OneScienceModelScopeDownload.getModelScopeDownloadDiskSpace(
            ctx.query.directory,
            requireDownloadEnvironment(parseDownloadEnvironmentQuery(ctx.query.environment), info.ssh),
          ),
        catch: () => new HttpApiError.BadRequest(),
      })
    })

    const oneScienceModelScopeDownloadCondaEnvs = Effect.fn("ExperimentalHttpApi.oneScienceModelScopeDownloadCondaEnvs")(function* (ctx: {
      query: typeof OneScienceModelScopeDownloadCondaEnvsQuery.Type
    }) {
      const config = yield* Config.Service
      const info = yield* config.get()
      const parsed = parseDownloadEnvironmentQuery(ctx.query.environment)
      const ssh = parsed?.kind === "ssh"
        ? yield* Effect.try({
            try: () => requireSshTarget(parsed, info.ssh).ssh,
            catch: () => new HttpApiError.BadRequest(),
          })
        : undefined
      const result = yield* Effect.tryPromise({
        try: () => OneScienceModelScopeDownload.listModelScopeCondaEnvs(ssh),
        catch: (error) =>
          new OneScienceModelScopeDownloadError({
            message: error instanceof Error && error.message.trim() ? error.message : "failed to list conda environments",
          }),
      })
      return { items: result.items, available: result.available }
    })

    const oneScienceModelScopeDownloadStart = Effect.fn("ExperimentalHttpApi.oneScienceModelScopeDownloadStart")(function* (ctx: {
      payload: typeof OneScienceModelScopeDownloadStartPayload.Type
    }) {
      const config = yield* Config.Service
      const info = yield* config.get()
      const environment = yield* Effect.try({
        try: () => requireDownloadEnvironment(ctx.payload.environment, info.ssh),
        catch: () => new HttpApiError.BadRequest(),
      })
      const record = yield* Effect.tryPromise({
        try: () =>
          OneScienceModelScopeDownload.startModelScopeDatasetDownload(
            ctx.payload.directory,
            ctx.payload.resourceId,
            environment,
          ),
        catch: (error) =>
          new OneScienceModelScopeDownloadError({
            message: error instanceof Error && error.message.trim() ? error.message : "failed to start download",
          }),
      })
      return presentModelScopeDownloadRecord(record)
    })

    const oneScienceModelScopeDownloadCancel = Effect.fn("ExperimentalHttpApi.oneScienceModelScopeDownloadCancel")(function* (ctx: {
      payload: typeof OneScienceModelScopeDownloadCancelPayload.Type
    }) {
      const record = yield* Effect.tryPromise({
        try: () =>
          OneScienceModelScopeDownload.cancelModelScopeDatasetDownload(
            ctx.payload.directory,
            ctx.payload.resourceId,
            locateDownloadEnvironment(ctx.payload.environment),
          ),
        catch: () => new HttpApiError.BadRequest(),
      })
      return presentModelScopeDownloadRecord(record)
    })

    const oneScienceModelScopeDownloadRemove = Effect.fn("ExperimentalHttpApi.oneScienceModelScopeDownloadRemove")(function* (ctx: {
      query: typeof OneScienceModelScopeDownloadRemoveQuery.Type
    }) {
      return yield* Effect.tryPromise({
        try: () =>
          OneScienceModelScopeDownload.deleteModelScopeDatasetDownload(
            ctx.query.directory,
            ctx.query.resourceId,
            locateDownloadEnvironment(parseDownloadEnvironmentQuery(ctx.query.environment)),
          ),
        catch: () => new HttpApiError.BadRequest(),
      })
    })

    const oneScienceCaseRestore = Effect.fn("ExperimentalHttpApi.oneScienceCaseRestore")(function* (ctx: {
      payload: typeof OneScienceCaseRestorePayload.Type
    }) {
      const current = yield* PlatformAuth.CurrentSession
      const fork = ctx.payload.fork !== false && !!current.session
      const directory = fork ? PlatformAuth.defaultWorkspaceCaseDirectory(current.session) : undefined
      try {
        if (fork && !directory) throw new Error("account case workspace not found")
        const result = SessionSeed.restoreSession(
          ctx.payload.sessionId,
          directory
            ? {
                directory,
                idScope: `${current.session?.account.id ?? "workspace"}\0${directory}`,
                copyWorkspaceFrom: PlatformAuth.sharedCasesRoot(),
              }
            : {},
        )
        return {
          restored: result.restored,
          sessionId: result.sessionId,
          directory: result.directory,
          filesCopied: result.filesCopied,
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        return HttpServerResponse.jsonUnsafe({ error: message, message }, { status: 400 })
      }
    })

    const aiPrimitiveList = Effect.fn("ExperimentalHttpApi.aiPrimitiveList")(function* (ctx: {
      query: typeof AIPrimitiveListQuery.Type
    }) {
      const current = yield* PlatformAuth.CurrentSession
      const accountId = currentAccountId(current)
      return AIPrimitive.listWithResources({
        domain: ctx.query.domain,
        primitiveType: ctx.query.primitiveType as AIPrimitive.PrimitiveType | undefined,
        status: ctx.query.status as AIPrimitive.PrimitiveStatus | undefined,
        summary: ctx.query.summary,
        limit: ctx.query.limit,
        offset: ctx.query.offset,
        accountId,
      })
    })

    const aiPrimitiveCreate = Effect.fn("ExperimentalHttpApi.aiPrimitiveCreate")(function* (ctx: {
      payload: typeof AIPrimitive.CreatePrimitive.Type
    }) {
      const current = yield* PlatformAuth.CurrentSession
      const accountId = yield* requireAccountId(current)
      return yield* mapPrimitiveError(() => AIPrimitive.create(ctx.payload, accountId))
    })

    const aiPrimitiveGet = Effect.fn("ExperimentalHttpApi.aiPrimitiveGet")(function* (ctx: {
      params: { id: string }
    }) {
      const current = yield* PlatformAuth.CurrentSession
      const accountId = currentAccountId(current)
      return yield* mapPrimitiveError(() => AIPrimitive.get(ctx.params.id, accountId))
    })

    const aiPrimitiveUpdate = Effect.fn("ExperimentalHttpApi.aiPrimitiveUpdate")(function* (ctx: {
      params: { id: string }
      payload: typeof AIPrimitive.UpdatePrimitive.Type
    }) {
      const current = yield* PlatformAuth.CurrentSession
      const accountId = yield* requireAccountId(current)
      return yield* mapPrimitiveError(() => AIPrimitive.update(ctx.params.id, ctx.payload, accountId))
    })

    const aiPrimitiveRemove = Effect.fn("ExperimentalHttpApi.aiPrimitiveRemove")(function* (ctx: {
      params: { id: string }
    }) {
      const current = yield* PlatformAuth.CurrentSession
      const accountId = yield* requireAccountId(current)
      return yield* mapPrimitiveError(() => AIPrimitive.remove(ctx.params.id, accountId))
    })

    const aiPrimitivePublish = Effect.fn("ExperimentalHttpApi.aiPrimitivePublish")(function* (ctx: {
      params: { id: string }
      payload: typeof AIPrimitive.PublishPrimitive.Type | undefined
    }) {
      const current = yield* PlatformAuth.CurrentSession
      const accountId = yield* requireAccountId(current)
      return yield* mapPrimitiveError(() => AIPrimitive.publish(ctx.params.id, ctx.payload, accountId))
    })

    const aiPrimitiveByResource = Effect.fn("ExperimentalHttpApi.aiPrimitiveByResource")(function* (ctx: {
      params: { resourceId: string }
    }) {
      const current = yield* PlatformAuth.CurrentSession
      const accountId = currentAccountId(current)
      return AIPrimitive.lookupBySourceResource(ctx.params.resourceId, accountId)
    })

    const aiPrimitiveByResources = Effect.fn("ExperimentalHttpApi.aiPrimitiveByResources")(function* (ctx: {
      query: typeof AIPrimitiveByResourcesQuery.Type
    }) {
      const current = yield* PlatformAuth.CurrentSession
      const accountId = currentAccountId(current)
      const resourceIds = ctx.query.resourceIds.split(",").map((item) => item.trim()).filter(Boolean)
      const items = AIPrimitive.lookupBySourceResources(resourceIds, accountId)
      return {
        items: resourceIds.map((resourceId) => ({
          resourceId,
          callable: items[resourceId]?.callable,
          draft: items[resourceId]?.draft,
          inference: items[resourceId]?.inference,
          training: items[resourceId]?.training,
        })),
      }
    })


    const dataProjectResponse = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown

    const dataProjectList = Effect.fn("ExperimentalHttpApi.dataProjectList")(function* (ctx: {
      query: typeof OneScienceDataProjectListQuery.Type
    }) {
      const auth = yield* requireCatalogAccount()
      return dataProjectResponse(OneScienceDataProject.list({
        status: ctx.query.status,
        domain: ctx.query.domain,
        limit: ctx.query.limit,
        offset: ctx.query.offset,
        owner: auth.accountId,
      }))
    })

    const dataProjectCreate = Effect.fn("ExperimentalHttpApi.dataProjectCreate")(function* (_ctx: {
      payload: typeof OneScienceDataProject.CreateProject.Type
    }) {
      return yield* catalogGone
    })

    const dataProjectGet = Effect.fn("ExperimentalHttpApi.dataProjectGet")(function* (ctx: { params: { id: string } }) {
      const auth = yield* requireCatalogAccount()
      return yield* catalogTry(() => OneScienceDataProject.get(ctx.params.id, auth.accountId)).pipe(
        Effect.map((value) => dataProjectResponse(value)),
      )
    })

    const dataProjectUpdate = Effect.fn("ExperimentalHttpApi.dataProjectUpdate")(function* (_ctx: {
      params: { id: string }
      payload: typeof OneScienceDataProject.UpdateProject.Type
    }) {
      return yield* catalogGone
    })

    const dataProjectAnalyze = Effect.fn("ExperimentalHttpApi.dataProjectAnalyze")(function* (_ctx: { params: { id: string } }) {
      return yield* catalogGone
    })

    const dataProjectAIReady = Effect.fn("ExperimentalHttpApi.dataProjectAIReady")(function* (_ctx: {
      params: { id: string }
      payload: typeof OneScienceDataProject.CreateArtifact.Type
    }) {
      return yield* catalogGone
    })

    const dataProjectTraining = Effect.fn("ExperimentalHttpApi.dataProjectTraining")(function* (_ctx: {
      params: { id: string }
      payload: typeof OneScienceDataProjectTrainingPayload.Type
    }) {
      return yield* catalogGone
    })

    const dataProjectPublish = Effect.fn("ExperimentalHttpApi.dataProjectPublish")(function* (_ctx: {
      params: { id: string }
      payload: typeof OneScienceDataProjectArtifactPayload.Type
    }) {
      return yield* catalogGone
    })

    const catalogProbe = Effect.fn("ExperimentalHttpApi.catalogProbe")(function* (ctx: {
      payload: typeof CatalogProbePayload.Type
    }) {
      const auth = yield* requireCatalogAccount()
      return yield* catalogTry(() => DataCatalog.probe({
        connector: ctx.payload.connector,
        uri: ctx.payload.uri,
        workspace_id: ctx.payload.workspace_id,
        session: auth.session,
        accountId: auth.accountId,
      }))
    })

    const catalogRawCreate = Effect.fn("ExperimentalHttpApi.catalogRawCreate")(function* (ctx: {
      payload: typeof CatalogRawCreatePayload.Type
    }) {
      const auth = yield* requireCatalogAccount()
      return yield* catalogTry(() => DataCatalog.registerRaw({
        accountId: auth.accountId,
        session: auth.session,
        title: ctx.payload.title,
        description: ctx.payload.description,
        domain: ctx.payload.domain,
        uri: ctx.payload.uri,
        connector: ctx.payload.connector,
        workspace_id: ctx.payload.workspace_id,
      }))
    })

    const catalogRawList = Effect.fn("ExperimentalHttpApi.catalogRawList")(function* (ctx: {
      query: typeof CatalogRawListQuery.Type
    }) {
      const auth = yield* requireCatalogAccount()
      return yield* catalogTry(() => DataCatalog.listRaw({
        accountId: auth.accountId,
        domain: ctx.query.domain,
        limit: ctx.query.limit,
        offset: ctx.query.offset,
      }))
    })

    const catalogRawPreview = Effect.fn("ExperimentalHttpApi.catalogRawPreview")(function* (ctx: {
      params: { id: string }
      query: typeof CatalogAlreadyPreviewQuery.Type
    }) {
      const auth = yield* requireCatalogAccount()
      return yield* catalogTry(() => DataCatalog.previewRaw(ctx.params.id, auth.accountId, auth.session, ctx.query.viewer_workspace_id))
    })

    const catalogRawPatch = Effect.fn("ExperimentalHttpApi.catalogRawPatch")(function* (ctx: {
      params: { id: string }
      payload: typeof CatalogRawPatchPayload.Type
    }) {
      const auth = yield* requireCatalogAccount()
      return yield* catalogTry(() => DataCatalog.patchRaw({
        id: ctx.params.id,
        accountId: auth.accountId,
        session: auth.session,
        uri: ctx.payload.uri,
      }))
    })

    const catalogRawDelete = Effect.fn("ExperimentalHttpApi.catalogRawDelete")(function* (ctx: { params: { id: string } }) {
      const auth = yield* requireCatalogAccount()
      return yield* catalogTry(() => DataCatalog.deleteRaw(ctx.params.id, auth.accountId))
    })

    const catalogRawConvert = Effect.fn("ExperimentalHttpApi.catalogRawConvert")(function* (ctx: { params: { id: string } }) {
      const auth = yield* requireCatalogAccount()
      return yield* catalogTry(() => DataCatalog.convertRaw({
        id: ctx.params.id,
        accountId: auth.accountId,
        session: auth.session,
      }))
    })

    const catalogAlreadyList = Effect.fn("ExperimentalHttpApi.catalogAlreadyList")(function* (ctx: {
      query: typeof CatalogAlreadyListQuery.Type
    }) {
      const auth = yield* requireCatalogAccount()
      return yield* catalogTry(() => DataCatalog.listAlready({
        accountId: auth.accountId,
        scope: ctx.query.scope === "public" ? "public" : "mine",
        domain: ctx.query.domain,
        limit: ctx.query.limit,
        offset: ctx.query.offset,
      }))
    })

    const catalogAlreadyPreview = Effect.fn("ExperimentalHttpApi.catalogAlreadyPreview")(function* (ctx: {
      params: { id: string }
      query: typeof CatalogAlreadyPreviewQuery.Type
    }) {
      const auth = yield* requireCatalogAccount()
      return yield* catalogTry(() => DataCatalog.previewAlready(ctx.params.id, auth.accountId, auth.session, ctx.query.viewer_workspace_id))
    })

    const catalogChipsGet = Effect.fn("ExperimentalHttpApi.catalogChipsGet")(function* (ctx: { params: { sessionId: string } }) {
      const auth = yield* requireCatalogAccount()
      return yield* catalogTry(() => DataCatalog.getChips(ctx.params.sessionId, auth.accountId, auth.session))
    })

    const catalogChipsPut = Effect.fn("ExperimentalHttpApi.catalogChipsPut")(function* (ctx: {
      params: { sessionId: string }
      payload: typeof CatalogChipsPayload.Type
    }) {
      const auth = yield* requireCatalogAccount()
      return yield* catalogTry(() => DataCatalog.putChips({
        sessionId: ctx.params.sessionId,
        accountId: auth.accountId,
        raw_ids: [...ctx.payload.raw_ids],
        session: auth.session,
      }))
    })

    const catalogObjectStoreKeyPut = Effect.fn("ExperimentalHttpApi.catalogObjectStoreKeyPut")(function* (ctx: {
      payload: typeof CatalogObjectStoreKeyPayload.Type
    }) {
      const auth = yield* requireCatalogAccount()
      return yield* catalogTry(() => DataCatalog.putObjectStoreKey({
        accountId: auth.accountId,
        provider: ctx.payload.provider,
        access_key_id: ctx.payload.access_key_id,
        secret: ctx.payload.secret,
        endpoint: ctx.payload.endpoint,
        region: ctx.payload.region,
        label: ctx.payload.label,
      }))
    })

    const catalogObjectStoreKeyList = Effect.fn("ExperimentalHttpApi.catalogObjectStoreKeyList")(function* () {
      const auth = yield* requireCatalogAccount()
      return yield* catalogTry(() => DataCatalog.listObjectStoreKeys(auth.accountId))
    })

    const catalogObjectStoreKeyDelete = Effect.fn("ExperimentalHttpApi.catalogObjectStoreKeyDelete")(function* (ctx: {
      params: { provider: string }
    }) {
      const auth = yield* requireCatalogAccount()
      return yield* catalogTry(() => DataCatalog.deleteObjectStoreKey(auth.accountId, ctx.params.provider))
    })

    const catalogDbConnectionPut = Effect.fn("ExperimentalHttpApi.catalogDbConnectionPut")(function* (ctx: {
      payload: typeof CatalogDbConnectionPayload.Type
    }) {
      const auth = yield* requireCatalogAccount()
      return yield* catalogTry(() => DataCatalog.putDbConnection({
        accountId: auth.accountId,
        engine: ctx.payload.engine,
        host: ctx.payload.host,
        port: ctx.payload.port,
        database: ctx.payload.database,
        username: ctx.payload.username,
        password: ctx.payload.password,
        label: ctx.payload.label,
        ssl_mode: ctx.payload.ssl_mode,
      }))
    })

    const catalogDbConnectionList = Effect.fn("ExperimentalHttpApi.catalogDbConnectionList")(function* () {
      const auth = yield* requireCatalogAccount()
      return yield* catalogTry(() => DataCatalog.listDbConnections(auth.accountId))
    })

    const catalogDbConnectionDelete = Effect.fn("ExperimentalHttpApi.catalogDbConnectionDelete")(function* (ctx: {
      params: { id: string }
    }) {
      const auth = yield* requireCatalogAccount()
      return yield* catalogTry(() => DataCatalog.deleteDbConnection(auth.accountId, ctx.params.id))
    })

    const catalogDbConnectionTables = Effect.fn("ExperimentalHttpApi.catalogDbConnectionTables")(function* (ctx: {
      params: { id: string }
    }) {
      const auth = yield* requireCatalogAccount()
      return yield* catalogTry(() => DataCatalog.listDbTables(auth.accountId, ctx.params.id))
    })

    const catalogAlreadyIngest = Effect.fn("ExperimentalHttpApi.catalogAlreadyIngest")(function* (ctx: {
      payload: typeof CatalogIngestPayload.Type
    }) {
      const auth = yield* requireCatalogIngestAuth()
      return yield* catalogTry(() => DataCatalog.ingestAlready({
        accountId: auth.accountId,
        session: auth.session,
        sessionId: ctx.payload.session_id,
        workspaceId: ctx.payload.workspace_id,
        rawIds: ctx.payload.raw_ids ? [...ctx.payload.raw_ids] : undefined,
        report: ctx.payload.report,
        viaToken: auth.viaToken,
        tokenWorkspaceId: auth.tokenWorkspaceId,
      }))
    })

    const catalogAlreadyPatch = Effect.fn("ExperimentalHttpApi.catalogAlreadyPatch")(function* (ctx: {
      params: { id: string }
      payload: typeof CatalogAlreadyPatchPayload.Type
    }) {
      const auth = yield* requireCatalogAccount()
      return yield* catalogTry(() => DataCatalog.patchAlready({
        id: ctx.params.id,
        accountId: auth.accountId,
        source_raw_ids: [...ctx.payload.source_raw_ids],
      }))
    })

    const catalogAlreadyDelete = Effect.fn("ExperimentalHttpApi.catalogAlreadyDelete")(function* (ctx: { params: { id: string } }) {
      const auth = yield* requireCatalogAccount()
      return yield* catalogTry(() => DataCatalog.deleteAlready(ctx.params.id, auth.accountId))
    })

    const catalogAlreadyPublish = Effect.fn("ExperimentalHttpApi.catalogAlreadyPublish")(function* (ctx: { params: { id: string } }) {
      const auth = yield* requireCatalogAccount()
      return yield* catalogTry(() => DataCatalog.publishAlready(ctx.params.id, auth.accountId, auth.session))
    })

    const catalogAlreadyUnpublish = Effect.fn("ExperimentalHttpApi.catalogAlreadyUnpublish")(function* (ctx: { params: { id: string } }) {
      const auth = yield* requireCatalogAccount()
      return yield* catalogTry(() => DataCatalog.unpublishAlready(ctx.params.id, auth.accountId))
    })

    const catalogAlreadyReingest = Effect.fn("ExperimentalHttpApi.catalogAlreadyReingest")(function* (ctx: { params: { id: string } }) {
      const auth = yield* requireCatalogAccount()
      return yield* catalogTry(() => DataCatalog.reingestAlready(ctx.params.id, auth.accountId, auth.session))
    })

    const catalogAlreadyTraining = Effect.fn("ExperimentalHttpApi.catalogAlreadyTraining")(function* (ctx: {
      params: { id: string }
      payload: typeof CatalogTrainingPayload.Type
    }) {
      const auth = yield* requireCatalogAccount()
      return yield* catalogTry(() => DataCatalog.startTraining({
        id: ctx.params.id,
        accountId: auth.accountId,
        session: auth.session,
        target: ctx.payload.target,
        workspace_id: ctx.payload.workspace_id,
        trainingConfigJson: ctx.payload.trainingConfigJson,
      }))
    })

    const catalogAlreadyPrimitive = Effect.fn("ExperimentalHttpApi.catalogAlreadyPrimitive")(function* (ctx: {
      params: { id: string }
      payload: typeof CatalogAlreadyPrimitivePayload.Type
    }) {
      const auth = yield* requireCatalogAccount()
      return yield* catalogTry(() => DataCatalog.bindAlreadyPrimitive({
        alreadyId: ctx.params.id,
        accountId: auth.accountId,
        fields: {
          ...(ctx.payload.title?.trim() ? { title: ctx.payload.title.trim() } : {}),
          ...(ctx.payload.description?.trim() ? { description: ctx.payload.description.trim() } : {}),
          ...(ctx.payload.data_schema?.trim() ? { data_schema: ctx.payload.data_schema.trim() } : {}),
          ...(ctx.payload.usage_notes?.trim() ? { usage_notes: ctx.payload.usage_notes.trim() } : {}),
        },
      }))
    })

    const catalogFsStat = Effect.fn("ExperimentalHttpApi.catalogFsStat")(function* (ctx: {
      payload: typeof CatalogFsPathPayload.Type
    }) {
      return yield* catalogTry(() => DataCatalog.leafFsStat(ctx.payload.path))
    })

    const catalogFsSample = Effect.fn("ExperimentalHttpApi.catalogFsSample")(function* (ctx: {
      payload: typeof CatalogFsPathPayload.Type
    }) {
      return yield* catalogTry(() => DataCatalog.leafFsSample(ctx.payload.path))
    })

    const agentRegistry = Effect.fn("ExperimentalHttpApi.agentRegistry")(function* (ctx: {
      query: typeof AIPrimitiveListQuery.Type
    }) {
      const current = yield* PlatformAuth.CurrentSession
      const accountId = currentAccountId(current)
      return AIPrimitive.list({
        domain: ctx.query.domain,
        primitiveType: ctx.query.primitiveType as AIPrimitive.PrimitiveType | undefined,
        status: (ctx.query.status || "callable") as AIPrimitive.PrimitiveStatus,
        limit: ctx.query.limit,
        offset: ctx.query.offset,
        accountId,
      })
    })

    return handlers
      .handle("console", getConsole)
      .handle("consoleOrgs", listConsoleOrgs)
      .handle("consoleSwitch", switchConsole)
      .handle("tool", tool)
      .handle("toolIDs", toolIDs)
      .handle("worktree", worktree)
      .handle("worktreeCreate", worktreeCreate)
      .handle("worktreeRemove", worktreeRemove)
      .handle("worktreeReset", worktreeReset)
      .handle("session", session)
      .handle("resource", resource)
      .handle("oneScienceResourceList", oneScienceResourceList)
      .handle("oneScienceResourceCustomCounts", oneScienceResourceCustomCounts)
      .handle("oneScienceCatalogMetrics", oneScienceCatalogMetrics)
      .handle("oneScienceResourceGet", oneScienceResourceGet)
      .handle("oneScienceResourceCreate", oneScienceResourceCreate)
      .handle("oneScienceResourceUpdate", oneScienceResourceUpdate)
      .handle("oneScienceResourceRemove", oneScienceResourceRemove)
      .handle("oneScienceScenarioList", oneScienceScenarioList)
      .handle("oneScienceScenarioGet", oneScienceScenarioGet)
      .handle("oneScienceSkillList", oneScienceSkillList)
      .handle("oneScienceSkillRepoList", oneScienceSkillRepoList)
      .handle("oneScienceSkillRepoCreate", oneScienceSkillRepoCreate)
      .handle("oneScienceSkillRepoRemove", oneScienceSkillRepoRemove)
      .handle("oneScienceSkillUpload", oneScienceSkillUpload)
      .handle("oneScienceSkillRemove", oneScienceSkillRemove)
      .handle("oneScienceOneskillsUpgrade", oneScienceOneskillsUpgrade)
      .handle("oneScienceTaskProfileList", oneScienceTaskProfileList)
      .handle("oneScienceExecutionCapability", oneScienceExecutionCapability)
      .handle("oneScienceReadme", oneScienceReadme)
      .handle("oneScienceModelScopeDownloadList", oneScienceModelScopeDownloadList)
      .handle("oneScienceModelScopeDownloadInfo", oneScienceModelScopeDownloadInfo)
      .handle("oneScienceModelScopeDownloadDiskSpace", oneScienceModelScopeDownloadDiskSpace)
      .handle("oneScienceModelScopeDownloadCondaEnvs", oneScienceModelScopeDownloadCondaEnvs)
      .handle("oneScienceModelScopeDownloadStart", oneScienceModelScopeDownloadStart)
      .handle("oneScienceModelScopeDownloadCancel", oneScienceModelScopeDownloadCancel)
      .handle("oneScienceModelScopeDownloadRemove", oneScienceModelScopeDownloadRemove)
      .handle("oneScienceCaseRestore", oneScienceCaseRestore)
      .handle("aiPrimitiveList", aiPrimitiveList)
      .handle("aiPrimitiveCreate", aiPrimitiveCreate)
      .handle("aiPrimitiveGet", aiPrimitiveGet)
      .handle("aiPrimitiveUpdate", aiPrimitiveUpdate)
      .handle("aiPrimitiveRemove", aiPrimitiveRemove)
      .handle("aiPrimitivePublish", aiPrimitivePublish)
      .handle("aiPrimitiveByResource", aiPrimitiveByResource)
      .handle("aiPrimitiveByResources", aiPrimitiveByResources)
      .handle("dataProjectList", dataProjectList)
      .handle("dataProjectCreate", dataProjectCreate)
      .handle("dataProjectGet", dataProjectGet)
      .handle("dataProjectUpdate", dataProjectUpdate)
      .handle("dataProjectAnalyze", dataProjectAnalyze)
      .handle("dataProjectAIReady", dataProjectAIReady)
      .handle("dataProjectTraining", dataProjectTraining)
      .handle("dataProjectPublish", dataProjectPublish)
      .handle("catalogProbe", catalogProbe)
      .handle("catalogRawCreate", catalogRawCreate)
      .handle("catalogRawList", catalogRawList)
      .handle("catalogRawPreview", catalogRawPreview)
      .handle("catalogRawPatch", catalogRawPatch)
      .handle("catalogRawDelete", catalogRawDelete)
      .handle("catalogRawConvert", catalogRawConvert)
      .handle("catalogAlreadyList", catalogAlreadyList)
      .handle("catalogAlreadyPreview", catalogAlreadyPreview)
      .handle("catalogAlreadyIngest", catalogAlreadyIngest)
      .handle("catalogAlreadyPatch", catalogAlreadyPatch)
      .handle("catalogAlreadyDelete", catalogAlreadyDelete)
      .handle("catalogAlreadyPublish", catalogAlreadyPublish)
      .handle("catalogAlreadyUnpublish", catalogAlreadyUnpublish)
      .handle("catalogAlreadyReingest", catalogAlreadyReingest)
      .handle("catalogAlreadyTraining", catalogAlreadyTraining)
      .handle("catalogAlreadyPrimitive", catalogAlreadyPrimitive)
      .handle("catalogFsStat", catalogFsStat)
      .handle("catalogFsSample", catalogFsSample)
      .handle("catalogChipsGet", catalogChipsGet)
      .handle("catalogChipsPut", catalogChipsPut)
      .handle("catalogObjectStoreKeyPut", catalogObjectStoreKeyPut)
      .handle("catalogObjectStoreKeyList", catalogObjectStoreKeyList)
      .handle("catalogObjectStoreKeyDelete", catalogObjectStoreKeyDelete)
      .handle("catalogDbConnectionPut", catalogDbConnectionPut)
      .handle("catalogDbConnectionList", catalogDbConnectionList)
      .handle("catalogDbConnectionDelete", catalogDbConnectionDelete)
      .handle("catalogDbConnectionTables", catalogDbConnectionTables)
      .handle("agentRegistry", agentRegistry)
  }),
)
