import * as InstanceState from "@/effect/instance-state"
import { Database, and, eq, inArray, isNotNull, isNull } from "@/storage/db"
import * as PlatformAuth from "@/platform-auth/platform-auth"
import { Project } from "@/project/project"
import { ProjectID } from "@/project/schema"
import { ProjectTable } from "@/project/project.sql"
import { Session, directoryEquals, directoryQueryValues } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { SessionTable } from "@/session/session.sql"
import { SessionID } from "@/session/schema"
import { Workspace } from "@/control-plane/workspace"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { markInstanceForDisposal, markInstanceForReload } from "../lifecycle"

function normalizeProjectPath(value: string) {
  return value.replaceAll("\\", "/").replace(/\/+$/, "")
}

export const projectHandlers = HttpApiBuilder.group(InstanceHttpApi, "project", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Project.Service
    const session = yield* Session.Service
    const promptSvc = yield* SessionPrompt.Service
    const statusSvc = yield* SessionStatus.Service
    const workspaceSvc = yield* Workspace.Service
    const appFs = yield* AppFileSystem.Service

    const list = Effect.fn("ProjectHttpApi.list")(function* () {
      const current = yield* PlatformAuth.CurrentSession
      const projects = yield* svc.list()
      return PlatformAuth.filterAccessibleProjects(current.session, projects)
    })

    const current = Effect.fn("ProjectHttpApi.current")(function* () {
      return (yield* InstanceState.context).project
    })

    const initGit = Effect.fn("ProjectHttpApi.initGit")(function* () {
      const ctx = yield* InstanceState.context
      const next = yield* svc.initGit({ directory: ctx.directory, project: ctx.project })
      if (next.id === ctx.project.id && next.vcs === ctx.project.vcs && next.worktree === ctx.project.worktree)
        return next
      yield* markInstanceForReload(ctx, {
        directory: ctx.directory,
        worktree: ctx.directory,
        project: next,
      })
      return next
    })

    const update = Effect.fn("ProjectHttpApi.update")(function* (ctx: {
      params: { projectID: ProjectID }
      payload: Project.UpdatePayload
    }) {
      return yield* svc.update({ ...ctx.payload, projectID: ctx.params.projectID })
    })

    const remove = Effect.fn("ProjectHttpApi.remove")(function* () {
      const auth = yield* PlatformAuth.CurrentSession
      const ctx = yield* InstanceState.context
      const project = ctx.project

      // Use the request directory (instance path), not project.worktree.
      // Empty / non-git folders resolve as ProjectID.global with worktree "/", which would
      // incorrectly fail permission checks and refuse deletion.
      let directory: string
      try {
        directory = PlatformAuth.assertDeletableAccountProject(auth.session, ctx.directory)
      } catch (error) {
        const message = error instanceof Error ? error.message : "cannot delete project"
        if (message.includes("login")) {
          return yield* new HttpApiError.Forbidden({})
        }
        return yield* new HttpApiError.BadRequest({})
      }

      const worktree = normalizeProjectPath(project.worktree || "")
      const isPrimary = project.id !== ProjectID.global && worktree === directory

      const archived = yield* Effect.sync(() =>
        Database.use((db) => {
          const archivedRoot = and(isNotNull(SessionTable.time_archived), isNull(SessionTable.parent_id))
          if (isPrimary) {
            return db
              .select({ id: SessionTable.id })
              .from(SessionTable)
              .where(and(eq(SessionTable.project_id, project.id), archivedRoot))
              .limit(1)
              .all()
          }
          return db
            .select({ id: SessionTable.id })
            .from(SessionTable)
            .where(and(directoryEquals(directory), archivedRoot))
            .limit(1)
            .all()
        }),
      )
      if (archived.length > 0) {
        return yield* new HttpApiError.BadRequest({})
      }

      // Disconnected SSH projects still leave wrk_* rows. Kill them with a
      // timeout so leftover serve/tunnel cannot pin DELETE /project/current.
      const leftover = yield* workspaceSvc.list(project, directory)
      yield* Effect.forEach(
        leftover,
        (item) =>
          workspaceSvc.remove(item.id).pipe(
            Effect.timeout("8 seconds"),
            Effect.ignore,
          ),
        { concurrency: "unbounded", discard: true },
      )

      const statuses = yield* statusSvc.list()
      for (const [sessionID, status] of statuses) {
        if (status.type === "busy" || status.type === "retry") {
          yield* promptSvc.cancel(sessionID).pipe(
            Effect.timeout("2 seconds"),
            Effect.ignore,
          )
        }
      }

      const sessionRows = yield* Effect.sync(() =>
        Database.use((db) => {
          if (isPrimary) {
            return db
              .select({ id: SessionTable.id, parent_id: SessionTable.parent_id })
              .from(SessionTable)
              .where(eq(SessionTable.project_id, project.id))
              .all()
          }
          return db
            .select({ id: SessionTable.id, parent_id: SessionTable.parent_id })
            .from(SessionTable)
            .where(directoryEquals(directory))
            .all()
        }),
      )
      const roots = sessionRows.filter((row) => !row.parent_id)
      const rest = sessionRows.filter((row) => row.parent_id)
      for (const row of [...roots, ...rest]) {
        yield* session.remove(SessionID.make(row.id)).pipe(Effect.catch(() => Effect.void))
      }

      if (isPrimary) {
        yield* svc.destroy(project.id).pipe(Effect.mapError(() => new HttpApiError.NotFound({})))
      } else {
        const isSandbox =
          project.id !== ProjectID.global &&
          (project.sandboxes ?? []).some((sandbox) => normalizeProjectPath(sandbox) === directory)
        if (isSandbox) {
          yield* svc.removeSandbox(project.id, directory).pipe(Effect.catch(() => Effect.void))
        }

        const worktreeValues = directoryQueryValues(directory)
        yield* Effect.sync(() =>
          Database.use((db) => {
            const rows =
              worktreeValues.length === 1
                ? db.select({ id: ProjectTable.id }).from(ProjectTable).where(eq(ProjectTable.worktree, worktreeValues[0]!)).all()
                : db.select({ id: ProjectTable.id }).from(ProjectTable).where(inArray(ProjectTable.worktree, worktreeValues)).all()
            for (const row of rows) {
              if (row.id === ProjectID.global) continue
              db.delete(ProjectTable).where(eq(ProjectTable.id, row.id)).run()
            }
          }),
        )

        yield* appFs.remove(directory, { recursive: true }).pipe(
          Effect.catch(() => Effect.fail(new HttpApiError.BadRequest({}))),
        )
      }

      yield* markInstanceForDisposal(ctx)
      return true
    })

    return handlers
      .handle("list", list)
      .handle("current", current)
      .handle("initGit", initGit)
      .handle("update", update)
      .handle("remove", remove)
  }),
)
