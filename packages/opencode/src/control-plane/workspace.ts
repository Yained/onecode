import { Cause, Context, Effect, FiberMap, Iterable, Layer, Schedule, Schema, Stream } from "effect"
import { FetchHttpClient, HttpBody, HttpClient, HttpClientError, HttpClientRequest } from "effect/unstable/http"
import { Database } from "@/storage/db"
import { asc } from "drizzle-orm"
import { eq } from "drizzle-orm"
import { inArray } from "drizzle-orm"
import { Project } from "@/project/project"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Auth } from "@/auth"
import { Config, tenantCustomProviders } from "@/config/config"
import { SyncEvent } from "@/sync"
import { EventSequenceTable, EventTable } from "@/sync/event.sql"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import * as Log from "@opencode-ai/core/util/log"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProjectID } from "@/project/schema"
import { Slug } from "@opencode-ai/core/util/slug"
import { WorkspaceTable } from "./workspace.sql"
import { getAdapter, registeredAdapters } from "./adapters"
import { mergeCustomProviderEnvAuth } from "./remote-serve-env"
import { workspaceBelongsToDirectory } from "./adapters/ssh-node-path"
import { leafIdentityFromProject, remapSessionReplayEvents } from "./session-replay-remap"
import { type Target, type WorkspaceInfo, WorkspaceInfo as WorkspaceInfoSchema } from "./types"
import { WorkspaceID } from "./schema"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { MessageTable, PartTable, SessionTable } from "@/session/session.sql"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { errorData } from "@/util/error"
import { waitEvent } from "./util"
import { WorkspaceContext } from "./workspace-context"
import { EffectBridge } from "@/effect/bridge"
import { Vcs } from "@/project/vcs"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Bus } from "@/bus"

export const Info = Schema.Struct({
  ...WorkspaceInfoSchema.fields,
  timeUsed: Schema.Number,
}).annotate({ identifier: "Workspace" })
export type Info = WorkspaceInfo & { timeUsed: number }

export const ConnectionStatus = Schema.Struct({
  workspaceID: WorkspaceID,
  status: Schema.Literals(["connected", "connecting", "disconnected", "error"]),
})
export type ConnectionStatus = Schema.Schema.Type<typeof ConnectionStatus>

export const Event = {
  Ready: BusEvent.define(
    "workspace.ready",
    Schema.Struct({
      name: Schema.String,
    }),
  ),
  Failed: BusEvent.define(
    "workspace.failed",
    Schema.Struct({
      message: Schema.String,
    }),
  ),
  Status: BusEvent.define("workspace.status", ConnectionStatus),
}

function fromRow(row: typeof WorkspaceTable.$inferSelect): Info {
  return {
    id: row.id,
    type: row.type,
    branch: row.branch,
    name: row.name,
    directory: row.directory,
    extra: row.extra,
    projectID: row.project_id,
    timeUsed: row.time_used,
  }
}

type DbClient = Parameters<Parameters<typeof Database.use>[0]>[0]

const db = <T>(fn: (d: DbClient) => T) => Effect.sync(() => Database.use(fn))

const log = Log.create({ service: "workspace-sync" })

function isSessionUpdatedSync(type: string | undefined) {
  return typeof type === "string" && (type === "session.updated" || type.startsWith("session.updated."))
}

function remoteSessionTitlePatch(event: SyncEvent.SerializedEvent) {
  if (!isSessionUpdatedSync(event.type)) return
  const data = event.data as { sessionID?: string; info?: { title?: string } } | undefined
  const sessionID = data?.sessionID ?? event.aggregateID
  const title = data?.info?.title
  if (!sessionID || typeof title !== "string" || !title.trim()) return
  if (Session.isDefaultTitle(title)) return
  return { sessionID, title }
}

type RemoteTranscriptItem = {
  info?: {
    id?: string
    sessionID?: string
    time?: { created?: number }
  }
  parts?: Array<{
    id?: string
    messageID?: string
    sessionID?: string
    time?: { created?: number } | number
  }>
}

/** Build the environment variables passed to a remote SSH leaf serve process.
 *  Centralized so initial connect and reconnect both sync the latest auth and custom providers.
 */
export const buildRemoteServeEnv = Effect.fn("Workspace.buildRemoteServeEnv")(function* (
  workspaceID: string,
  configService: Config.Interface,
  auth: Auth.Interface,
) {
  const globalConfig = yield* configService.getGlobal()
  const customProviders = tenantCustomProviders(globalConfig)
  const platformConfigContent = JSON.stringify(
    customProviders && Object.keys(customProviders).length > 0 ? { provider: customProviders } : {},
  )
  const authSnapshot = mergeCustomProviderEnvAuth(yield* auth.storedAll(), customProviders)

  return {
    OPENCODE_AUTH_CONTENT: JSON.stringify(authSnapshot),
    OPENCODE_PLATFORM_CONFIG_CONTENT: platformConfigContent,
    OPENCODE_WORKSPACE_ID: workspaceID,
    OPENCODE_EXPERIMENTAL_WORKSPACES: "true",
    OTEL_EXPORTER_OTLP_HEADERS: process.env.OTEL_EXPORTER_OTLP_HEADERS,
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    OTEL_RESOURCE_ATTRIBUTES: process.env.OTEL_RESOURCE_ATTRIBUTES,
  } satisfies Record<string, string | undefined>
})

/** Leaf GET /session/:id/message may be a raw array or `{ data: [] }`. */
export function remoteTranscriptItems(body: unknown): RemoteTranscriptItem[] {
  if (Array.isArray(body)) return body as RemoteTranscriptItem[]
  if (body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)) {
    return (body as { data: RemoteTranscriptItem[] }).data
  }
  return []
}

function partCreatedAt(part: NonNullable<RemoteTranscriptItem["parts"]>[number]) {
  if (typeof part.time === "number" && Number.isFinite(part.time)) return part.time
  if (part.time && typeof part.time === "object" && typeof part.time.created === "number") return part.time.created
  return Date.now()
}

function upsertRemoteTranscript(client: DbClient, items: RemoteTranscriptItem[]) {
  for (const item of items) {
    const info = item.info
    const id = info?.id
    const sessionID = info?.sessionID
    if (!id || !sessionID) continue
    const time_created = typeof info.time?.created === "number" ? info.time.created : Date.now()
    const { id: _id, sessionID: _sessionID, ...rest } = info as { id: string; sessionID: string } & Record<string, unknown>
    client.insert(MessageTable)
      .values({
        id: id as MessageID,
        session_id: sessionID as SessionID,
        time_created,
        data: rest as (typeof MessageTable.$inferInsert)["data"],
      })
      .onConflictDoUpdate({ target: MessageTable.id, set: { data: rest as (typeof MessageTable.$inferInsert)["data"] } })
      .run()
    for (const part of item.parts ?? []) {
      const partID = part.id
      const messageID = part.messageID || id
      const partSessionID = part.sessionID || sessionID
      if (!partID) continue
      const { id: _partId, messageID: _messageID, sessionID: _partSession, ...partRest } = part as {
        id: string
        messageID?: string
        sessionID?: string
      } & Record<string, unknown>
      client.insert(PartTable)
        .values({
          id: partID as PartID,
          message_id: messageID as MessageID,
          session_id: partSessionID as SessionID,
          time_created: partCreatedAt(part),
          data: partRest as (typeof PartTable.$inferInsert)["data"],
        })
        .onConflictDoUpdate({
          target: PartTable.id,
          set: { data: partRest as (typeof PartTable.$inferInsert)["data"] },
        })
        .run()
    }
  }
}

function emitControlPlaneSessionUpdated(directory: string | undefined, row: typeof SessionTable.$inferSelect) {
  GlobalBus.emit("event", {
    directory: directory ?? row.directory,
    payload: {
      id: Bus.createID(),
      type: "session.updated",
      properties: { info: Session.fromRow(row) },
    },
  })
}

export const CreateInput = Schema.Struct({
  id: Schema.optional(WorkspaceID),
  type: Info.fields.type,
  branch: Info.fields.branch,
  projectID: ProjectID,
  extra: Schema.optional(Info.fields.extra),
})
export type CreateInput = Schema.Schema.Type<typeof CreateInput>

export const SessionWarpInput = Schema.Struct({
  workspaceID: Schema.NullOr(WorkspaceID),
  sessionID: SessionID,
  copyChanges: Schema.optional(Schema.Boolean),
})
export type SessionWarpInput = Schema.Schema.Type<typeof SessionWarpInput>

export class SyncHttpError extends Schema.TaggedErrorClass<SyncHttpError>()("WorkspaceSyncHttpError", {
  message: Schema.String,
  status: Schema.Number,
  body: Schema.optional(Schema.String),
}) {}

export class WorkspaceNotFoundError extends Schema.TaggedErrorClass<WorkspaceNotFoundError>()(
  "WorkspaceNotFoundError",
  {
    message: Schema.String,
    workspaceID: WorkspaceID,
  },
) {}

export class WorkspaceCreateError extends Schema.TaggedErrorClass<WorkspaceCreateError>()("WorkspaceCreateError", {
  message: Schema.String,
}) {}

export class SessionEventsNotFoundError extends Schema.TaggedErrorClass<SessionEventsNotFoundError>()(
  "WorkspaceSessionEventsNotFoundError",
  {
    message: Schema.String,
    sessionID: SessionID,
  },
) {}

export class SessionWarpHttpError extends Schema.TaggedErrorClass<SessionWarpHttpError>()(
  "WorkspaceSessionWarpHttpError",
  {
    message: Schema.String,
    workspaceID: WorkspaceID,
    sessionID: SessionID,
    status: Schema.Number,
    body: Schema.String,
  },
) {}

export class SyncTimeoutError extends Schema.TaggedErrorClass<SyncTimeoutError>()("WorkspaceSyncTimeoutError", {
  message: Schema.String,
  state: Schema.Record(Schema.String, Schema.Number),
}) {}

export class SyncAbortedError extends Schema.TaggedErrorClass<SyncAbortedError>()("WorkspaceSyncAbortedError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

type CreateError = Auth.AuthError | WorkspaceCreateError
type SessionWarpError =
  | WorkspaceNotFoundError
  | SessionEventsNotFoundError
  | SessionWarpHttpError
  | SyncHttpError
  | Vcs.PatchApplyError
  | HttpClientError.HttpClientError
type WaitForSyncError = SyncTimeoutError | SyncAbortedError
type SyncLoopError = SyncHttpError | HttpClientError.HttpClientError

export interface Interface {
  readonly create: (input: CreateInput) => Effect.Effect<Info, CreateError>
  readonly sessionWarp: (input: SessionWarpInput) => Effect.Effect<void, SessionWarpError>
  readonly list: (project: Project.Info, openedDirectory?: string) => Effect.Effect<Info[]>
  readonly syncList: (project: Project.Info) => Effect.Effect<void>
  readonly get: (id: WorkspaceID) => Effect.Effect<Info | undefined>
  readonly remove: (id: WorkspaceID) => Effect.Effect<Info | undefined>
  readonly status: () => Effect.Effect<ConnectionStatus[]>
  readonly isSyncing: (workspaceID: WorkspaceID) => Effect.Effect<boolean>
  readonly waitForSync: (
    workspaceID: WorkspaceID,
    state: Record<string, number>,
    signal?: AbortSignal,
  ) => Effect.Effect<void, WaitForSyncError>
  readonly startWorkspaceSyncing: (projectID: ProjectID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Workspace") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const configService = yield* Config.Service
    const prompt = yield* SessionPrompt.Service
    const http = yield* HttpClient.HttpClient
    const transientHttp = http.pipe(
      HttpClient.retryTransient({
        retryOn: "errors-only",
        times: 4,
        schedule: Schedule.exponential(250),
      }),
    )
    const sync = yield* SyncEvent.Service
    const vcs = yield* Vcs.Service
    const flags = yield* RuntimeFlags.Service
    const fs = yield* AppFileSystem.Service
    const connections = new Map<WorkspaceID, ConnectionStatus>()
    const syncFibers = yield* FiberMap.make<WorkspaceID, void, SyncLoopError>()

    const setStatus = (id: WorkspaceID, status: ConnectionStatus["status"]) => {
      const prev = connections.get(id)
      if (prev?.status === status) return
      const next = { workspaceID: id, status }
      connections.set(id, next)

      GlobalBus.emit("event", {
        directory: "global",
        workspace: id,
        payload: {
          type: Event.Status.type,
          properties: next,
        },
      })
    }

    const connectSSE = Effect.fn("Workspace.connectSSE")(function* (
      url: URL | string,
      headers: HeadersInit | undefined,
    ) {
      const response = yield* http.execute(
        HttpClientRequest.get(route(url, "/global/event"), {
          headers: new Headers(headers),
          accept: "text/event-stream",
        }),
      )
      if (response.status < 200 || response.status >= 300) {
        return yield* new SyncHttpError({
          message: `Workspace sync HTTP failure: ${response.status}`,
          status: response.status,
        })
      }
      return response.stream
    })

    const parseSSE = Effect.fn("Workspace.parseSSE")(function* (
      stream: Stream.Stream<Uint8Array, unknown>,
      onEvent: (event: unknown) => Effect.Effect<void>,
    ) {
      yield* stream.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.mapAccum(
          () => ({ data: [] as string[], id: undefined as string | undefined, retry: 1000 }),
          (state, line) => {
            if (line === "") {
              if (!state.data.length) return [state, []]
              return [{ ...state, data: [] }, [{ data: state.data.join("\n"), id: state.id, retry: state.retry }]]
            }

            const index = line.indexOf(":")
            const field = index === -1 ? line : line.slice(0, index)
            const value = index === -1 ? "" : line.slice(index + (line[index + 1] === " " ? 2 : 1))

            if (field === "data") return [{ ...state, data: [...state.data, value] }, []]
            if (field === "id") return [{ ...state, id: value }, []]
            if (field === "retry") {
              const retry = Number.parseInt(value, 10)
              return [Number.isNaN(retry) ? state : { ...state, retry }, []]
            }
            return [state, []]
          },
          {
            onHalt: (state) =>
              state.data.length ? [{ data: state.data.join("\n"), id: state.id, retry: state.retry }] : [],
          },
        ),
        Stream.map((event) => {
          try {
            return JSON.parse(event.data) as unknown
          } catch {
            return {
              type: "sse.message",
              properties: {
                data: event.data,
                id: event.id || undefined,
                retry: event.retry,
              },
            }
          }
        }),
        Stream.runForEach(onEvent),
      )
    })

    const runInWorkspace = <A, E, R>(input: {
      workspaceID?: WorkspaceID
      local: () => Effect.Effect<A, E, R>
      remote: (input: {
        workspace: Info
        target: Extract<Target, { type: "remote" }>
      }) => HttpClientRequest.HttpClientRequest
      fallback: A
      response?: "json" | "text"
    }) =>
      Effect.gen(function* () {
        if (!input.workspaceID) return yield* input.local()

        const workspace = yield* get(input.workspaceID)
        if (!workspace) return input.fallback

        const adapter = getAdapter(workspace.projectID, workspace.type)
        // reconnect:false — probes must not retunnel a dead leaf (cache-clear freeze).
        const target = yield* EffectBridge.fromPromise(() =>
          adapter.target(workspace, { create: false, reconnect: false }),
        )

        if (target.type === "local") {
          const store = yield* InstanceStore.Service
          return yield* store.provide({ directory: target.directory }, input.local())
        }

        const response = yield* http.execute(input.remote({ workspace, target })).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              log.warn("workspace target request failed", {
                workspaceID: workspace.id,
                error: errorData(error),
              })
            }),
          ),
        )
        if (!response) return input.fallback
        if (response.status < 200 || response.status >= 300) {
          const body = yield* response.text.pipe(Effect.catch(() => Effect.succeed("")))
          log.warn("workspace target request failed", {
            workspaceID: workspace.id,
            status: response.status,
            body,
          })
          return input.fallback
        }

        const body = input.response === "text" ? response.text : response.json
        return yield* body.pipe(
          Effect.map((result) => result as A),
          Effect.catch((error) =>
            Effect.sync(() => {
              log.warn("workspace target response decode failed", {
                workspaceID: workspace.id,
                error: errorData(error),
              })
              return input.fallback
            }),
          ),
        )
      })

    const syncHistory = Effect.fn("Workspace.syncHistory")(function* (
      space: Info,
      url: URL | string,
      headers: HeadersInit | undefined,
    ) {
      const sessionIDs = yield* db((db) =>
        db
          .select({ id: SessionTable.id })
          .from(SessionTable)
          .where(eq(SessionTable.workspace_id, space.id))
          .all()
          .map((row) => row.id),
      )
      const state = sessionIDs.length
        ? Object.fromEntries(
            (yield* db((db) =>
              db.select().from(EventSequenceTable).where(inArray(EventSequenceTable.aggregate_id, sessionIDs)).all(),
            )).map((row) => [row.aggregate_id, row.seq]),
          )
        : {}

      log.info("syncing workspace history", {
        workspaceID: space.id,
        sessions: sessionIDs.length,
        known: Object.keys(state).length,
      })

      const response = yield* http.execute(
        HttpClientRequest.post(route(url, "/sync/history"), {
          headers: new Headers(headers),
          body: HttpBody.jsonUnsafe(state),
        }),
      )

      if (response.status < 200 || response.status >= 300) {
        const body = yield* response.text
        return yield* new SyncHttpError({
          message: `Workspace history HTTP failure: ${response.status} ${body}`,
          status: response.status,
          body,
        })
      }

      const events = (yield* response.json) as HistoryEvent[]

      log.info("workspace history synced", {
        workspaceID: space.id,
        events: events.length,
      })

      yield* Effect.promise(async () => {
        await WorkspaceContext.provide({
          workspaceID: space.id,
          async fn() {
            await Effect.runPromise(
              Effect.forEach(
                events,
                (event) =>
                  sync.replay(
                    {
                      id: event.id,
                      aggregateID: event.aggregate_id,
                      seq: event.seq,
                      type: event.type,
                      data: event.data,
                    },
                    { publish: true, ownerID: space.id },
                  ),
                { discard: true },
              ),
            )
          },
        })
      })
    })

    const importRemoteTranscript = Effect.fn("Workspace.importRemoteTranscript")(function* (
      sessionIDs: SessionID[],
      target: Extract<Target, { type: "remote" }>,
    ) {
      if (sessionIDs.length === 0) return
      for (const sessionID of sessionIDs) {
        const response = yield* transientHttp.execute(
          HttpClientRequest.get(route(target.url, `/session/${sessionID}/message`), {
            headers: new Headers(target.headers),
          }),
        )
        if (response.status === 404) {
          log.warn("workspace transcript missing on leaf", { sessionID })
          continue
        }
        if (response.status < 200 || response.status >= 300) {
          const body = yield* response.text
          return yield* new SyncHttpError({
            message: `Workspace transcript HTTP failure: ${response.status} ${body}`,
            status: response.status,
            body,
          })
        }
        const body = yield* response.json
        const items = remoteTranscriptItems(body)
        log.info("workspace transcript imported", {
          sessionID,
          messages: items.length,
        })
        yield* db((d) => upsertRemoteTranscript(d, items))
      }
    })

    const syncWorkspaceLoop = Effect.fn("Workspace.syncWorkspaceLoop")(function* (space: Info) {
      const adapter = getAdapter(space.projectID, space.type)
      // reconnect:false — startSync already probed; do not retunnel if the tunnel died between.
      const target = yield* EffectBridge.fromPromise(() =>
        adapter.target(space, { create: false, reconnect: false }),
      )

      if (target.type === "local") return

      let attempt = 0

      while (true) {
        log.info("connecting to global sync", { workspace: space.name })
        setStatus(space.id, "connecting")

        const stream = yield* connectSSE(target.url, target.headers).pipe(
          Effect.catch((err) =>
            Effect.sync(() => {
              setStatus(space.id, "error")
              log.info("failed to connect to global sync", {
                workspace: space.name,
                err,
              })
              return null
            }),
          ),
        )

        if (stream) {
          attempt = 0

          log.info("global sync connected", { workspace: space.name })
          setStatus(space.id, "connected")

          yield* syncHistory(space, target.url, target.headers).pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                log.warn("workspace history sync failed", {
                  workspaceID: space.id,
                  error: errorData(Cause.squash(cause)),
                })
              }),
            ),
          )

          let localDirectory: string | undefined
          const resolveLocalDirectory = () =>
            db((db) =>
              db
                .select({ directory: SessionTable.directory })
                .from(SessionTable)
                .where(eq(SessionTable.workspace_id, space.id))
                .get(),
            ).pipe(Effect.map((row) => row?.directory))

          yield* parseSSE(stream, (evt) =>
            Effect.gen(function* () {
              if (!evt || typeof evt !== "object" || !("payload" in evt)) return
              const payload = evt.payload as { type?: string; syncEvent?: SyncEvent.SerializedEvent }
              if (payload.type === "server.heartbeat") return

              if (payload.type === "sync" && payload.syncEvent) {
                const failed = yield* sync.replay(payload.syncEvent, { publish: false, ownerID: space.id }).pipe(
                  Effect.as(false),
                  Effect.catchCause((error) =>
                    Effect.sync(() => {
                      log.info("failed to replay global event", {
                        workspaceID: space.id,
                        error,
                      })
                      return true
                    }),
                  ),
                )
                if (!localDirectory) {
                  localDirectory = yield* resolveLocalDirectory()
                }
                const hint = remoteSessionTitlePatch(payload.syncEvent)
                if (hint) {
                  yield* db((d) => {
                    d.update(SessionTable)
                      .set({ title: hint.title })
                      .where(eq(SessionTable.id, hint.sessionID as SessionID))
                      .run()
                  })
                }
                if (failed && !hint) return
                if (isSessionUpdatedSync(payload.syncEvent.type) || hint) {
                  const sessionID = (hint?.sessionID ?? payload.syncEvent.aggregateID) as SessionID
                  const row = yield* db((d) =>
                    d.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get(),
                  )
                  if (row) emitControlPlaneSessionUpdated(localDirectory, row)
                }
                if (failed) return
              }

              if (!localDirectory) {
                localDirectory = yield* resolveLocalDirectory()
              }

              try {
                const event = evt as { directory?: string; project?: string; payload: unknown }
                GlobalBus.emit("event", {
                  directory: localDirectory ?? event.directory,
                  project: event.project,
                  workspace: space.id,
                  payload: event.payload,
                })
              } catch (error) {
                log.info("failed to replay global event", {
                  workspaceID: space.id,
                  error,
                })
              }
            }),
          )

          log.info("disconnected from global sync: " + space.id)
          setStatus(space.id, "disconnected")
        }

        // Back off reconnect attempts up to 2 minutes while the workspace
        // stays unavailable.
        yield* Effect.sleep(`${Math.min(120_000, 1_000 * 2 ** attempt)} millis`)
        attempt += 1
      }
    })

    const startSync = Effect.fn("Workspace.startSync")(function* (space: Info) {
      if (!flags.experimentalWorkspaces) return

      const adapter = getAdapter(space.projectID, space.type)
      if (yield* FiberMap.has(syncFibers, space.id)) {
        const probe = yield* EffectBridge.fromPromise(() =>
          adapter.target(space, { create: false, reconnect: false }),
        ).pipe(
          Effect.catch(() => Effect.succeed(null as Target | null)),
        )
        if (probe) return
        yield* FiberMap.remove(syncFibers, space.id).pipe(
          Effect.timeout("5 seconds"),
          Effect.catch(() => Effect.void),
        )
        connections.delete(space.id)
      }

      const target = yield* EffectBridge.fromPromise(() =>
        adapter.target(space, { create: false, reconnect: false }),
      ).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            setStatus(space.id, "error")
            log.warn("workspace target failed", {
              workspaceID: space.id,
              error: errorData(error),
            })
            return null
          }),
        ),
      )
      if (!target) return

      if (target.type === "local") {
        setStatus(space.id, (yield* fs.existsSafe(target.directory)) ? "connected" : "error")
        return
      }

      if (yield* FiberMap.has(syncFibers, space.id)) return

      setStatus(space.id, "disconnected")

      yield* FiberMap.run(
        syncFibers,
        space.id,
        // TODO: look into `tapError` to set the status but still
        // allow the fiber to fail and automatically get removed
        syncWorkspaceLoop(space).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              setStatus(space.id, "error")
              log.warn("workspace listener failed", {
                workspaceID: space.id,
                error,
              })
            }),
          ),
        ),
      )
    })

    const stopSync = Effect.fn("Workspace.stopSync")(function* (id: WorkspaceID) {
      yield* FiberMap.remove(syncFibers, id).pipe(
        Effect.timeout("5 seconds"),
        Effect.catch(() =>
          Effect.sync(() => {
            log.warn("workspace sync stop timed out", { workspaceID: id })
          }),
        ),
      )
      connections.delete(id)
    })

    const create = Effect.fn("Workspace.create")(function* (input: CreateInput) {
      const id = WorkspaceID.ascending(input.id)
      const adapter = getAdapter(input.projectID, input.type)
      const failCreate = (cause: Cause.Cause<unknown>) => {
        const squashed = Cause.squash(cause)
        const raw =
          squashed instanceof Error
            ? squashed.message
            : typeof squashed === "string"
              ? squashed
              : ""
        return new WorkspaceCreateError({ message: raw.trim() || "连接远端失败" })
      }
      const config = yield* EffectBridge.fromPromise(() =>
        adapter.configure({
          ...input,
          id,
          name: Slug.create(),
          directory: null,
          extra: input.extra ?? null,
        }),
      ).pipe(Effect.catchCause((cause) => Effect.fail(failCreate(cause))))

      const info: Info = {
        id,
        type: config.type,
        branch: config.branch ?? null,
        name: config.name ?? null,
        directory: config.directory ?? null,
        extra: config.extra ?? null,
        projectID: input.projectID,
        timeUsed: Date.now(),
      }

      yield* db((db) => {
        db.insert(WorkspaceTable)
          .values({
            id: info.id,
            type: info.type,
            branch: info.branch,
            name: info.name,
            directory: info.directory,
            extra: info.extra,
            project_id: info.projectID,
            time_used: info.timeUsed,
          })
          .run()
      })

      const env = yield* buildRemoteServeEnv(config.id, configService, auth)

      const abortCreate = (cause: Cause.Cause<unknown>) =>
        Effect.gen(function* () {
          // Effect.promise rejections are Dies; Effect.catch only handles Fail and would
          // swallow the original create error as "Unexpected server error" after a slow SSH remove.
          yield* stopSync(info.id).pipe(Effect.catchCause(() => Effect.void))
          yield* EffectBridge.fromPromise(() => adapter.remove(config)).pipe(
            Effect.timeout("15 seconds"),
            Effect.catchCause(() => Effect.void),
          )
          yield* db((db) => db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, info.id)).run())
          return yield* Effect.fail(failCreate(cause))
        })

      yield* EffectBridge.fromPromise(() => adapter.create(config, env)).pipe(Effect.catchCause(abortCreate))
      if (config.extra) {
        yield* db((db) =>
          db.update(WorkspaceTable).set({ extra: config.extra }).where(eq(WorkspaceTable.id, info.id)).run(),
        )
      }
      // Adapter create now waits until the leaf can serve files/providers.
      // SSE/history is best-effort after that; do not fail connect if sync stalls.
      yield* startSync(info).pipe(
        Effect.catchCause((cause) => {
          log.warn("workspace create starting sync in background", {
            workspaceID: info.id,
            status: connections.get(info.id)?.status,
            error: errorData(Cause.squash(cause)),
          })
          return Effect.void
        }),
      )

      return info
    })

    const sessionWarp = Effect.fn("Workspace.sessionWarp")(function* (input: SessionWarpInput) {
      return yield* Effect.gen(function* () {
        log.info("session warp requested", {
          workspaceID: input.workspaceID,
          sessionID: input.sessionID,
        })

        const current = yield* db((db) =>
          db
            .select({ workspaceID: SessionTable.workspace_id })
            .from(SessionTable)
            .where(eq(SessionTable.id, input.sessionID))
            .get(),
        )

        if (current?.workspaceID) {
          const previous = yield* get(current.workspaceID)
          if (previous) {
            const adapter = getAdapter(previous.projectID, previous.type)
            // reconnect:false — warp-away must not retunnel/reuse a leaf just to
            // copy transcripts; that raced disconnect and resurrected killed serves.
            const target = yield* EffectBridge.fromPromise(() =>
              adapter.target(previous, { create: false, reconnect: false }),
            ).pipe(Effect.catch(() => Effect.succeed(undefined as Target | undefined)))

            if (target?.type === "remote") {
              // Copy the live leaf transcript onto the control plane before
              // detach/kill. Event replay can miss turns when sequences diverge;
              // GET /message is the copy the UI actually reads after disconnect.
              yield* importRemoteTranscript([input.sessionID], target)
              yield* syncHistory(previous, target.url, target.headers).pipe(
                Effect.catchCause((cause) =>
                  Effect.sync(() => {
                    log.warn("session warp final source sync failed", {
                      workspaceID: previous.id,
                      sessionID: input.sessionID,
                      error: errorData(Cause.squash(cause)),
                    })
                  }),
                ),
              )
            }
            if (input.workspaceID === null || target?.type !== "remote") {
              yield* prompt.cancel(input.sessionID).pipe(Effect.catch(() => Effect.void))
            }

            // "claim" this session so any future events coming from
            // the old workspace are ignored
            yield* sync.claim(input.sessionID, input.workspaceID ?? previous.projectID)
          }
        }

        const sourcePatch =
          input.copyChanges && current?.workspaceID
            ? yield* runInWorkspace({
                workspaceID: current?.workspaceID ?? undefined,
                local: () => vcs.diffRaw(),
                remote: ({ target }) =>
                  HttpClientRequest.get(route(target.url, "/vcs/diff/raw"), {
                    headers: new Headers(target.headers),
                  }),
                fallback: "",
                response: "text",
              }).pipe(Effect.provide(InstanceStore.defaultLayer.pipe(Layer.provide(InstanceBootstrap.defaultLayer))))
            : ""

        if (sourcePatch) {
          // Attempt to apply the file changes to the new workspace.
          // We intentionally do first so if it fails we don't warp
          // the session.
          yield* runInWorkspace({
            workspaceID: input.workspaceID ?? undefined,
            local: () => vcs.apply({ patch: sourcePatch }),
            remote: ({ target }) =>
              HttpClientRequest.post(route(target.url, "/vcs/apply"), {
                headers: new Headers(target.headers),
                body: HttpBody.jsonUnsafe({ patch: sourcePatch }),
              }),
            fallback: { applied: false },
          }).pipe(Effect.provide(InstanceStore.defaultLayer.pipe(Layer.provide(InstanceBootstrap.defaultLayer))))
        }

        if (input.workspaceID === null) {
          yield* sync.run(Session.Event.Updated, {
            sessionID: input.sessionID,
            info: {
              workspaceID: null,
            },
          })

          log.info("session warp complete", {
            workspaceID: input.workspaceID,
            sessionID: input.sessionID,
            target: "local",
          })
          return
        }

        const workspaceID = input.workspaceID
        const space = yield* get(workspaceID)
        if (!space)
          return yield* new WorkspaceNotFoundError({
            message: `Workspace not found: ${workspaceID}`,
            workspaceID,
          })

        const adapter = getAdapter(space.projectID, space.type)
        // reconnect:false — warp must not retunnel; user reconnects explicitly if the leaf is dead.
        const target = yield* EffectBridge.fromPromise(() =>
          adapter.target(space, { create: false, reconnect: false }),
        )

        if (target.type === "local") {
          yield* sync.run(Session.Event.Updated, {
            sessionID: input.sessionID,
            info: {
              workspaceID: input.workspaceID,
            },
          })

          log.info("session warp complete", {
            workspaceID: input.workspaceID,
            sessionID: input.sessionID,
            target: target.directory,
          })
          return
        }

        const rows = yield* db((db) =>
          db
            .select({
              id: EventTable.id,
              aggregateID: EventTable.aggregate_id,
              seq: EventTable.seq,
              type: EventTable.type,
              data: EventTable.data,
            })
            .from(EventTable)
            .where(eq(EventTable.aggregate_id, input.sessionID))
            .orderBy(asc(EventTable.seq))
            .all(),
        )
        if (rows.length === 0) {
          log.warn("session warp has no local events; stealing session without replay", {
            workspaceID: input.workspaceID,
            sessionID: input.sessionID,
          })
        }

        const batches = rows.length === 0 ? [] : Iterable.chunksOf(rows, 10)
        const total = Iterable.size(batches)
        const leafIdentity = yield* transientHttp
          .execute(
            HttpClientRequest.get(route(target.url, "/project/current"), {
              headers: new Headers(target.headers),
            }),
          )
          .pipe(
            Effect.flatMap((response) =>
              response.status >= 200 && response.status < 300
                ? response.json.pipe(
                    Effect.map((body) => leafIdentityFromProject((body ?? {}) as Record<string, unknown>)),
                  )
                : Effect.succeed(undefined),
            ),
            Effect.catch(() => Effect.succeed(undefined)),
          )
        const replayLeaf = {
          projectID: leafIdentity?.projectID || ProjectID.global,
          directory: space.directory?.trim() || leafIdentity?.directory || "",
        }

        log.info("session warp prepared", {
          workspaceID: input.workspaceID,
          sessionID: input.sessionID,
          target: String(route(target.url, "/sync/replay")),
          events: rows.length,
          batches: total,
          first: rows[0]?.seq,
          last: rows.at(-1)?.seq,
          leafProjectID: replayLeaf.projectID,
          leafDirectory: replayLeaf.directory,
        })

        yield* Effect.forEach(
          batches,
          (events, i) =>
            Effect.gen(function* () {
              const response = yield* transientHttp.execute(
                HttpClientRequest.post(route(target.url, "/sync/replay"), {
                  headers: new Headers(target.headers),
                  body: HttpBody.jsonUnsafe({
                    directory: replayLeaf.directory,
                    events: remapSessionReplayEvents(events, replayLeaf),
                  }),
                }),
              )

              if (response.status < 200 || response.status >= 300) {
                const body = yield* response.text
                log.error("session warp batch failed", {
                  workspaceID: input.workspaceID,
                  sessionID: input.sessionID,
                  step: i + 1,
                  total,
                  status: response.status,
                  body,
                })
                return yield* new SessionWarpHttpError({
                  message: `Failed to warp session ${input.sessionID} into workspace ${workspaceID}: HTTP ${response.status} ${body}`,
                  workspaceID,
                  sessionID: input.sessionID,
                  status: response.status,
                  body,
                })
              }

              log.info("session warp batch posted", {
                workspaceID: input.workspaceID,
                sessionID: input.sessionID,
                step: i + 1,
                total,
                status: response.status,
              })
            }),
          { discard: true },
        )

        const response = yield* http.execute(
          HttpClientRequest.post(route(target.url, "/sync/steal"), {
            headers: new Headers(target.headers),
            body: HttpBody.jsonUnsafe({ sessionID: input.sessionID }),
          }),
        )
        if (response.status < 200 || response.status >= 300) {
          const body = yield* response.text
          log.error("session warp steal failed", {
            workspaceID: input.workspaceID,
            sessionID: input.sessionID,
            status: response.status,
            body,
          })
          return yield* new SessionWarpHttpError({
            message: `Failed to steal session ${input.sessionID} into workspace ${workspaceID}: HTTP ${response.status} ${body}`,
            workspaceID,
            sessionID: input.sessionID,
            status: response.status,
            body,
          })
        }

        yield* syncHistory(space, target.url, target.headers).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              log.warn("session warp follow-up history sync failed", {
                workspaceID: input.workspaceID,
                sessionID: input.sessionID,
                error: errorData(Cause.squash(cause)),
              })
            }),
          ),
        )

        log.info("session warp complete", {
          workspaceID: input.workspaceID,
          sessionID: input.sessionID,
          batches: total,
        })
      }).pipe(
        Effect.catchCause((cause) => {
          if (!Cause.hasDies(cause)) return Effect.failCause(cause)
          const error = Cause.squash(cause)
          const message = error instanceof Error ? error.message : String(error)
          log.error("session warp defect", {
            workspaceID: input.workspaceID,
            sessionID: input.sessionID,
            error: errorData(error),
          })
          return input.workspaceID
            ? Effect.fail(
                new SessionWarpHttpError({
                  message: message.trim() || "切换远端会话失败",
                  workspaceID: input.workspaceID,
                  sessionID: input.sessionID,
                  status: 500,
                  body: message,
                }),
              )
            : Effect.void
        }),
        Effect.tapError((err) =>
          Effect.sync(() =>
            log.error("session warp failed", {
              workspaceID: input.workspaceID,
              sessionID: input.sessionID,
              error: errorData(err),
            }),
          ),
        ),
        Effect.asVoid,
      )
    })

    const list = Effect.fn("Workspace.list")(function* (project: Project.Info, openedDirectory?: string) {
      const owned = yield* db((db) =>
        db.select().from(WorkspaceTable).where(eq(WorkspaceTable.project_id, project.id)).all(),
      )
      const legacy =
        openedDirectory && project.id !== ProjectID.global
          ? yield* db((db) =>
              db.select().from(WorkspaceTable).where(eq(WorkspaceTable.project_id, ProjectID.global)).all(),
            )
          : []
      if (!openedDirectory) {
        return owned.map(fromRow).sort((a, b) => a.id.localeCompare(b.id))
      }
      const seen = new Set<string>()
      const matched: Info[] = []
      for (const row of [...owned, ...legacy]) {
        if (seen.has(row.id)) continue
        if (
          !workspaceBelongsToDirectory({
            extra: row.extra,
            workspaceProjectID: row.project_id,
            openedDirectory,
            openedProjectID: project.id,
          })
        ) {
          continue
        }
        seen.add(row.id)
        matched.push(fromRow(row))
      }
      return matched.sort((a, b) => a.id.localeCompare(b.id))
    })

    const syncList = Effect.fn("Workspace.syncList")(function* (project: Project.Info) {
      const names = new Set((yield* list(project)).map((workspace) => workspace.name))
      const discovered = yield* Effect.forEach(
        registeredAdapters(project.id),
        ([type, adapter]) =>
          adapter.list
            ? EffectBridge.fromPromise(() => Promise.resolve(adapter.list?.() ?? [])).pipe(
                Effect.catchCause((error) =>
                  Effect.sync(() => {
                    log.warn("workspace adapter list failed", { type, error })
                    return []
                  }),
                ),
              )
            : Effect.succeed([]),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((items) => items.flat()))

      yield* Effect.forEach(
        discovered,
        (item) =>
          Effect.gen(function* () {
            if (names.has(item.name)) return
            names.add(item.name)

            const info: Info = {
              id: WorkspaceID.ascending(),
              type: item.type,
              branch: item.branch,
              name: item.name,
              directory: item.directory,
              extra: item.extra,
              projectID: item.projectID,
              timeUsed: Date.now(),
            }

            yield* db((db) => {
              db.insert(WorkspaceTable)
                .values({
                  id: info.id,
                  type: info.type,
                  branch: info.branch,
                  name: info.name,
                  directory: info.directory,
                  extra: info.extra,
                  project_id: info.projectID,
                  time_used: info.timeUsed,
                })
                .run()
            })

            yield* startSync(info)
          }),
        { concurrency: 1 },
      )
    })

    const get = Effect.fn("Workspace.get")(function* (id: WorkspaceID) {
      const row = yield* db((db) => db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, id)).get())
      if (!row) return undefined
      return fromRow(row)
    }) satisfies Interface["get"]

    const remove = Effect.fn("Workspace.remove")(function* (id: WorkspaceID) {
      const row = yield* db((db) => db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, id)).get())
      if (!row) return
      const info = fromRow(row)

      const sessions = yield* db((db) =>
        db
          .select({ id: SessionTable.id })
          .from(SessionTable)
          .where(eq(SessionTable.workspace_id, id))
          .all(),
      )

      // Copy the leaf transcript onto the control plane BEFORE killing the
      // serve. Event replay is best-effort; GET /message is what the UI reads
      // after disconnect. If the tunnel is already gone, skip the copy and
      // still remove so leftover leaf processes are not left running.
      const target = yield* Effect.catchCause(
        Effect.gen(function* () {
          const adapter = getAdapter(info.projectID, row.type)
          // Do not retunnel during remove — disconnect would briefly re-pin SSH.
          return yield* EffectBridge.fromPromise(() =>
            adapter.target(info, { create: false, reconnect: false }),
          )
        }),
        () => Effect.succeed(undefined as Target | undefined),
      )
      if (target?.type === "remote") {
        yield* importRemoteTranscript(
          sessions.map((sessionInfo) => sessionInfo.id),
          target,
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              log.warn("workspace remove transcript import failed", {
                workspaceID: info.id,
                error: errorData(Cause.squash(cause)),
              })
            }),
          ),
        )
        yield* syncHistory(info, target.url, target.headers).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              log.warn("workspace remove history sync failed", {
                workspaceID: info.id,
                error: errorData(Cause.squash(cause)),
              })
            }),
          ),
        )
      }

      yield* Effect.catchCause(
        Effect.forEach(
          sessions,
          (sessionInfo) =>
            Effect.gen(function* () {
              yield* prompt.cancel(sessionInfo.id).pipe(Effect.catch(() => Effect.void))
              yield* sync.claim(sessionInfo.id, info.projectID)
              yield* sync.run(Session.Event.Updated, {
                sessionID: sessionInfo.id,
                info: { workspaceID: null },
              })
            }),
          { discard: true },
        ),
        (cause) =>
          Effect.sync(() => {
            log.warn("workspace remove detach failed", {
              workspaceID: info.id,
              error: errorData(Cause.squash(cause)),
            })
          }),
      )

      yield* stopSync(id).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            log.warn("workspace remove stop sync failed", {
              workspaceID: info.id,
              error: errorData(Cause.squash(cause)),
            })
          }),
        ),
      )

      yield* EffectBridge.fromPromise(() => {
        const adapter = getAdapter(info.projectID, row.type)
        return adapter.remove(info)
      })

      yield* db((db) => db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, id)).run())
      return info
    })

    const status = Effect.fn("Workspace.status")(function* () {
      return [...connections.values()]
    })

    const isSyncing = Effect.fn("Workspace.isSyncing")(function* (workspaceID: WorkspaceID) {
      // Keep proxying while the listener is retrying. SSE/history errors used to
      // flip status to "error" and 503 every file/session call even though the
      // tunnel and leaf serve were still up.
      return yield* FiberMap.has(syncFibers, workspaceID)
    })

    const waitForSync = Effect.fn("Workspace.waitForSync")(function* (
      workspaceID: WorkspaceID,
      state: Record<string, number>,
      signal?: AbortSignal,
    ) {
      if (synced(state)) return

      const poll = Effect.gen(function* () {
        while (!synced(state)) {
          if (signal?.aborted) {
            return yield* Effect.fail(new Error(signal.reason instanceof Error ? signal.reason.message : "Request aborted"))
          }
          yield* Effect.sleep("250 millis")
        }
      })

      yield* Effect.catch(
        Effect.raceFirst(
          waitEvent({
            timeout: TIMEOUT,
            signal,
            fn(event) {
              if (event.workspace !== workspaceID && event.payload.type !== "sync") {
                return false
              }
              return synced(state)
            },
          }),
          poll,
        ),
        (): Effect.Effect<never, WaitForSyncError> =>
          signal?.aborted
            ? Effect.fail(
                new SyncAbortedError({
                  message: signal.reason instanceof Error ? signal.reason.message : "Request aborted",
                  cause: signal.reason,
                }),
              )
            : Effect.fail(
                new SyncTimeoutError({
                  message: `Timed out waiting for sync fence: ${JSON.stringify(state)}`,
                  state,
                }),
              ),
      )
    })

    const startWorkspaceSyncing = Effect.fn("Workspace.startWorkspaceSyncing")(function* (projectID: ProjectID) {
      const rows = yield* db((db) =>
        db
          .selectDistinct({ workspace: WorkspaceTable })
          .from(WorkspaceTable)
          .where(eq(WorkspaceTable.project_id, projectID))
          .all(),
      )

      for (const { workspace } of rows) {
        yield* startSync(fromRow(workspace)).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              setStatus(workspace.id, "error")
              log.warn("workspace sync failed to start", {
                workspaceID: workspace.id,
                error,
              })
            }),
          ),
          Effect.forkDetach,
        )
      }
    })

    return Service.of({
      create,
      sessionWarp,
      list,
      syncList,
      get,
      remove,
      status,
      isSyncing,
      waitForSync,
      startWorkspaceSyncing,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Session.defaultLayer),
  Layer.provide(SyncEvent.defaultLayer),
  Layer.provide(SessionPrompt.defaultLayer),
  Layer.provide(Project.defaultLayer),
  Layer.provide(Vcs.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(RuntimeFlags.defaultLayer),
)

const TIMEOUT = 5000

type HistoryEvent = {
  id: string
  aggregate_id: string
  seq: number
  type: string
  data: Record<string, unknown>
}

function synced(state: Record<string, number>) {
  const ids = Object.keys(state)
  if (ids.length === 0) return true

  const done = Object.fromEntries(
    Database.use((db) =>
      db
        .select({
          id: EventSequenceTable.aggregate_id,
          seq: EventSequenceTable.seq,
        })
        .from(EventSequenceTable)
        .where(inArray(EventSequenceTable.aggregate_id, ids))
        .all(),
    ).map((row) => [row.id, row.seq]),
  ) as Record<string, number>

  return ids.every((id) => {
    return (done[id] ?? -1) >= state[id]
  })
}

function route(url: string | URL, path: string) {
  const next = new URL(url)
  next.pathname = `${next.pathname.replace(/\/$/, "")}${path}`
  next.search = ""
  next.hash = ""
  return next
}

export * as Workspace from "./workspace"
