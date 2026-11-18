import { Workspace } from "@/control-plane/workspace"
import { remapSessionReplayEvents } from "@/control-plane/session-replay-remap"
import * as InstanceState from "@/effect/instance-state"
import { Session } from "@/session/session"
import { SessionTable } from "@/session/session.sql"
import { Database } from "@/storage/db"
import { SyncEvent } from "@/sync"
import { EventTable } from "@/sync/event.sql"
import { asc } from "drizzle-orm"
import { and } from "drizzle-orm"
import { eq } from "drizzle-orm"
import { lte } from "drizzle-orm"
import { not } from "drizzle-orm"
import { or } from "drizzle-orm"
import { Effect, Scope } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { HistoryPayload, ReplayPayload, SessionPayload } from "../groups/sync"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "server.sync" })

export const syncHandlers = HttpApiBuilder.group(InstanceHttpApi, "sync", (handlers) =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const scope = yield* Scope.Scope
    const sync = yield* SyncEvent.Service

    const start = Effect.fn("SyncHttpApi.start")(function* () {
      yield* workspace
        .startWorkspaceSyncing((yield* InstanceState.context).project.id)
        .pipe(Effect.ignore, Effect.forkIn(scope))
      return true
    })

    const replay = Effect.fn("SyncHttpApi.replay")(function* (ctx: { payload: typeof ReplayPayload.Type }) {
      const instance = yield* InstanceState.context
      const events: SyncEvent.SerializedEvent[] = remapSessionReplayEvents(
        ctx.payload.events.map((event) => ({
          id: event.id,
          aggregateID: event.aggregateID,
          seq: event.seq,
          type: event.type,
          data: { ...event.data },
        })),
        {
          projectID: instance.project.id,
          directory: instance.directory,
        },
      )
      const source = events[0].aggregateID
      log.info("sync replay requested", {
        sessionID: source,
        events: events.length,
        first: events[0]?.seq,
        last: events.at(-1)?.seq,
        directory: ctx.payload.directory,
        leafProjectID: instance.project.id,
        leafDirectory: instance.directory,
      })
      yield* sync.replayAll(events)
      log.info("sync replay complete", {
        sessionID: source,
        events: events.length,
        first: events[0]?.seq,
        last: events.at(-1)?.seq,
      })
      return { sessionID: source }
    })

    const steal = Effect.fn("SyncHttpApi.steal")(function* (ctx: { payload: typeof SessionPayload.Type }) {
      const workspaceID = yield* InstanceState.workspaceID
      if (!workspaceID) return yield* new HttpApiError.BadRequest({})

      const existing = Database.use((db) =>
        db.select({ id: SessionTable.id }).from(SessionTable).where(eq(SessionTable.id, ctx.payload.sessionID)).get(),
      )
      if (!existing) {
        // Replay may not have created the row yet (empty event log). Don't 500
        // the warp; the control plane retries after replaying session.created.
        log.warn("sync steal skipped; session missing on leaf", {
          sessionID: ctx.payload.sessionID,
          workspaceID,
        })
        return { sessionID: ctx.payload.sessionID }
      }

      yield* sync.run(Session.Event.Updated, {
        sessionID: ctx.payload.sessionID,
        info: {
          workspaceID,
        },
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            log.warn("sync steal update failed", {
              sessionID: ctx.payload.sessionID,
              workspaceID,
              error: String(cause),
            })
          }),
        ),
      )

      log.info("sync session stolen", {
        sessionID: ctx.payload.sessionID,
        workspaceID,
      })

      return { sessionID: ctx.payload.sessionID }
    })

    const history = Effect.fn("SyncHttpApi.history")(function* (ctx: { payload: typeof HistoryPayload.Type }) {
      const exclude = Object.entries(ctx.payload)
      return Database.use((db) =>
        db
          .select()
          .from(EventTable)
          .where(
            exclude.length > 0
              ? not(or(...exclude.map(([id, seq]) => and(eq(EventTable.aggregate_id, id), lte(EventTable.seq, seq))))!)
              : undefined,
          )
          .orderBy(asc(EventTable.seq))
          .all(),
      )
    })

    return handlers.handle("start", start).handle("replay", replay).handle("steal", steal).handle("history", history)
  }),
)
