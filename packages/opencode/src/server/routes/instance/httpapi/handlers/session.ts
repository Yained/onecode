import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Command } from "@/command"
import { InstanceState } from "@/effect/instance-state"
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import * as PlatformAuth from "@/platform-auth/platform-auth"
import { SessionShare } from "@/share/session"
import { Workspace } from "@/control-plane/workspace"
import { canAccessRemoteWorkspace, extraAccountId } from "@/server/shared/remote-workspace-access"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Session } from "@/session/session"
import { SessionCompaction } from "@/session/compaction"
import { MessageV2 } from "@/session/message-v2"
import { SessionPromote } from "@/session/promote"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Todo } from "@/session/todo"
import * as SessionViewer from "@/session/viewer"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { NamedError } from "@opencode-ai/core/util/error"
import { Cause, Effect, Option, Schema, Scope } from "effect"
import * as Stream from "effect/Stream"
import path from "path"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError, HttpApiSchema } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { notFound } from "../errors"
import {
  CommandPayload,
  DiffQuery,
  ForkPayload,
  InitPayload,
  ListQuery,
  MessagesQuery,
  PermissionResponsePayload,
  PromptPayload,
  RevertPayload,
  SessionViewPayload,
  ShellPayload,
  SummarizePayload,
  UpdatePayload,
} from "../groups/session"
import * as SessionError from "./session-errors"

const tryParseJson = (text: string) =>
  Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: () => new HttpApiError.BadRequest({}),
  })

export const sessionHandlers = HttpApiBuilder.group(InstanceHttpApi, "session", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    const workspaceSvc = yield* Workspace.Service
    const shareSvc = yield* SessionShare.Service
    const promptSvc = yield* SessionPrompt.Service
    const revertSvc = yield* SessionRevert.Service
    const compactSvc = yield* SessionCompaction.Service
    const runState = yield* SessionRunState.Service
    const agentSvc = yield* Agent.Service
    const permissionSvc = yield* Permission.Service
    const statusSvc = yield* SessionStatus.Service
    const todoSvc = yield* Todo.Service
    const summary = yield* SessionSummary.Service
    const bus = yield* Bus.Service
    const scope = yield* Scope.Scope

    const mapBusy = <A, R>(
      effect: Effect.Effect<A, Session.BusyError, R>,
    ): Effect.Effect<A, HttpApiError.BadRequest, R> =>
      effect.pipe(Effect.catchTag("SessionBusyError", () => Effect.fail(new HttpApiError.BadRequest({}))))

    const list = Effect.fn("SessionHttpApi.list")(function* (ctx: { query: typeof ListQuery.Type }) {
      return yield* session.list({
        directory: ctx.query.scope === "project" ? undefined : ctx.query.directory,
        scope: ctx.query.scope,
        path: ctx.query.path,
        roots: ctx.query.roots,
        start: ctx.query.start,
        search: ctx.query.search,
        limit: ctx.query.limit,
      })
    })

    const status = Effect.fn("SessionHttpApi.status")(function* () {
      return Object.fromEntries(yield* statusSvc.list())
    })

    const requireSession = Effect.fn("SessionHttpApi.requireSession")(function* (sessionID: SessionID) {
      const current = yield* PlatformAuth.CurrentSession
      const info = yield* SessionError.mapStorageNotFound(session.get(sessionID))
      if (PlatformAuth.canAccessPath(current.session, info.directory)) return info
      // After SSH warp, session.directory may be the remote path. Platform roots
      // are still the control-plane project dir, so canAccessPath 404s and the
      // timeline stays on "正在加载消息...".
      if (info.workspaceID && Flag.OPENCODE_WORKSPACE_ID === info.workspaceID) return info
      if (info.workspaceID) {
        const space = yield* workspaceSvc.get(info.workspaceID)
        if (
          space &&
          canAccessRemoteWorkspace({
            sessionAccountId: current.session?.account.id,
            platformWorkspaceIds: current.session?.workspaces.map((item) => item.id),
            workspaceId: space.id,
            extraAccountId: extraAccountId(space.extra),
            localDirectoryAllowed: false,
          })
        ) {
          return info
        }
      }
      return yield* notFound(`Session not found: ${sessionID}`)
    })

    /** Shared preset cases are browse-only: logged-in users cannot delete or archive them. */
    const requireMutableSession = Effect.fn("SessionHttpApi.requireMutableSession")(function* (sessionID: SessionID) {
      const info = yield* requireSession(sessionID)
      const current = yield* PlatformAuth.CurrentSession
      if (current.session && PlatformAuth.isSharedCasesPath(info.directory)) {
        // remove/update endpoints only declare BadRequest (not Forbidden) in their error schema.
        return yield* new HttpApiError.BadRequest({})
      }
      return info
    })

    const requireTerminalAccess = Effect.fn("SessionHttpApi.requireTerminalAccess")(function* () {
      const current = yield* PlatformAuth.CurrentSession
      const request = yield* HttpServerRequest.HttpServerRequest
      const session = current.session ?? PlatformAuth.resolveSessionToken(request.headers["x-platform-auth-token"])
      if (PlatformAuth.canUseTerminal(session)) return
      return yield* new HttpApiError.Forbidden({})
    })

    const get = Effect.fn("SessionHttpApi.get")(function* (ctx: { params: { sessionID: SessionID } }) {
      return yield* requireSession(ctx.params.sessionID)
    })

    const children = Effect.fn("SessionHttpApi.children")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* session.children(ctx.params.sessionID)
    })

    const todo = Effect.fn("SessionHttpApi.todo")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* todoSvc.get(ctx.params.sessionID)
    })

    const diff = Effect.fn("SessionHttpApi.diff")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof DiffQuery.Type
    }) {
      return yield* summary.diff({ sessionID: ctx.params.sessionID, messageID: ctx.query.messageID })
    })

    const messages = Effect.fn("SessionHttpApi.messages")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof MessagesQuery.Type
    }) {
      if (ctx.query.before && ctx.query.limit === undefined) return yield* new HttpApiError.BadRequest({})
      if (ctx.query.before) {
        const before = ctx.query.before
        yield* Effect.try({
          try: () => MessageV2.cursor.decode(before),
          catch: () => new HttpApiError.BadRequest({}),
        })
      }
      yield* requireSession(ctx.params.sessionID)
      if (ctx.query.limit === undefined || ctx.query.limit === 0) {
        // Paginate internally so forClient stubbing applies; never hydrate GB parts into JS.
        const items: MessageV2.WithParts[] = []
        let before: string | undefined
        for (;;) {
          const page = yield* SessionError.mapStorageNotFound(
            MessageV2.page({
              sessionID: ctx.params.sessionID,
              limit: 100,
              before,
              forClient: true,
              forHistory: true,
            }),
          )
          items.push(...page.items)
          if (!page.more || !page.cursor) break
          before = page.cursor
        }
        return MessageV2.sanitizeForHistory(items)
      }

      const page = yield* SessionError.mapStorageNotFound(
        MessageV2.page({
          sessionID: ctx.params.sessionID,
          limit: ctx.query.limit,
          before: ctx.query.before,
          forClient: true,
          forHistory: true,
        }),
      )
      const items = MessageV2.sanitizeForHistory(page.items)
      if (!page.cursor) return items

      const request = yield* HttpServerRequest.HttpServerRequest
      // toURL() honors the Host + x-forwarded-proto headers, so the Link
      // header echoes the real origin instead of a hard-coded localhost.
      const url = Option.getOrElse(HttpServerRequest.toURL(request), () => new URL(request.url, "http://localhost"))
      url.searchParams.set("limit", ctx.query.limit.toString())
      url.searchParams.set("before", page.cursor)
      return HttpServerResponse.jsonUnsafe(items, {
        headers: {
          "Access-Control-Expose-Headers": "Link, X-Next-Cursor",
          Link: `<${url.toString()}>; rel="next"`,
          "X-Next-Cursor": page.cursor,
        },
      })
    })

    const message = Effect.fn("SessionHttpApi.message")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID }
    }) {
      const item = yield* SessionError.mapStorageNotFound(
        MessageV2.get({ sessionID: ctx.params.sessionID, messageID: ctx.params.messageID, forClient: true }),
      )
      return MessageV2.sanitizeForClient([item])[0]!
    })

    const create = Effect.fn("SessionHttpApi.create")(function* (ctx: { payload?: Session.CreateInput }) {
      return yield* shareSvc.create(ctx.payload)
    })

    const createRaw = Effect.fn("SessionHttpApi.createRaw")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      if (body.trim().length === 0) return yield* create({})

      const json = yield* tryParseJson(body)
      const payload = yield* Schema.decodeUnknownEffect(Session.CreateInput)(json).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      return yield* create({ payload })
    })

    const remove = Effect.fn("SessionHttpApi.remove")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireMutableSession(ctx.params.sessionID)
      yield* SessionError.mapStorageNotFound(session.remove(ctx.params.sessionID))
      return true
    })

    const update = Effect.fn("SessionHttpApi.update")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof UpdatePayload.Type
    }) {
      const current =
        ctx.payload.time?.archived !== undefined || ctx.payload.moveTo !== undefined
          ? yield* requireMutableSession(ctx.params.sessionID)
          : yield* requireSession(ctx.params.sessionID)
      if (ctx.payload.title !== undefined) {
        yield* session.setTitle({ sessionID: ctx.params.sessionID, title: ctx.payload.title })
      }
      if (ctx.payload.permission !== undefined) {
        yield* session.setPermission({
          sessionID: ctx.params.sessionID,
          permission: Permission.merge(current.permission ?? [], ctx.payload.permission),
        })
      }
      if (ctx.payload.time?.archived !== undefined) {
        yield* session.setArchived({ sessionID: ctx.params.sessionID, time: ctx.payload.time.archived })
      }
      if (ctx.payload.moveTo !== undefined) {
        const target = ctx.payload.moveTo.trim()
        if (!target) return yield* new HttpApiError.BadRequest({})
        const auth = yield* PlatformAuth.CurrentSession
        if (!auth.session) return yield* new HttpApiError.BadRequest({})
        if (!PlatformAuth.canAccessPath(auth.session, target)) {
          return yield* new HttpApiError.BadRequest({})
        }
        if (PlatformAuth.isSharedCasesPath(target)) {
          return yield* new HttpApiError.BadRequest({})
        }

        const sourceDirectory = path.resolve(current.directory).replaceAll("\\", "/")
        // Promote only: default staging → a real project. No cross-project moves.
        if (!PlatformAuth.isDefaultProjectDirectory(auth.session, sourceDirectory)) {
          return yield* new HttpApiError.BadRequest({})
        }
        if (PlatformAuth.isDefaultProjectDirectory(auth.session, target)) {
          return yield* new HttpApiError.BadRequest({})
        }

        yield* mapBusy(runState.assertNotBusy(ctx.params.sessionID))
        if (current.revert) return yield* new HttpApiError.BadRequest({})

        const kids = yield* session.children(ctx.params.sessionID)
        for (const kid of kids) {
          yield* mapBusy(runState.assertNotBusy(kid.id))
          if (kid.revert) return yield* new HttpApiError.BadRequest({})
        }

        // User projects may exist only as folders opened in the UI; register them before move.
        const project = yield* Effect.try({
          try: () => PlatformAuth.ensureAccountProject(auth.session, target),
          catch: () => new HttpApiError.BadRequest({}),
        })
        const worktree = path.resolve(project.worktree).replaceAll("\\", "/")
        const directory = path.resolve(target).replaceAll("\\", "/")
        const relative = path.relative(worktree, directory).replaceAll("\\", "/")
        if (relative.startsWith("..")) return yield* new HttpApiError.BadRequest({})

        const promoteOne = Effect.fn("SessionHttpApi.promoteOne")(function* (info: Session.Info) {
          const diffs = yield* session.diff(info.id)
          const messages = yield* SessionError.mapStorageNotFound(session.messages({ sessionID: info.id }))
          const relatives = SessionPromote.collectTouchedRelativePaths({
            sourceDirectory: info.directory,
            diffs,
            messages,
          })
          yield* Effect.tryPromise({
            try: () =>
              SessionPromote.copyTouchedFiles({
                sourceDirectory: info.directory,
                targetDirectory: directory,
                relatives,
              }),
            catch: () => new HttpApiError.BadRequest({}),
          })
          yield* session.setDirectory({
            sessionID: info.id,
            directory,
            projectID: project.id,
            path: relative === "" ? "" : relative,
            workspaceID: null,
          })
        })

        yield* promoteOne(current)
        for (const kid of kids) yield* promoteOne(kid)
      }
      return yield* requireSession(ctx.params.sessionID)
    })

    const fork = Effect.fn("SessionHttpApi.fork")(function* (ctx: {
      params: { sessionID: SessionID }
      payload?: typeof ForkPayload.Type
    }) {
      return yield* SessionError.mapStorageNotFound(
        session.fork({ sessionID: ctx.params.sessionID, messageID: ctx.payload?.messageID }),
      )
    })

    const forkRaw = Effect.fn("SessionHttpApi.forkRaw")(function* (ctx: {
      params: { sessionID: SessionID }
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      if (body.trim().length === 0) return yield* fork({ params: ctx.params })

      const json = yield* tryParseJson(body)
      const payload = yield* Schema.decodeUnknownEffect(ForkPayload)(json).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      return yield* fork({ params: ctx.params, payload })
    })

    const abort = Effect.fn("SessionHttpApi.abort")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* promptSvc.cancel(ctx.params.sessionID)
      return true
    })

    const init = Effect.fn("SessionHttpApi.init")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof InitPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* promptSvc
        .command({
          sessionID: ctx.params.sessionID,
          messageID: ctx.payload.messageID,
          model: `${ctx.payload.providerID}/${ctx.payload.modelID}`,
          command: Command.Default.INIT,
          arguments: "",
        })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      return true
    })

    // share/unshare errors aren't all client-induced — storage and network
    // failures from SessionShare are real possibilities. Map to a typed 500
    // (matches the legacy route behavior which routed any failure through
    // ErrorMiddleware → NamedError.Unknown 500) instead of blanket-mapping
    // every failure to a 400 BadRequest.
    const share = Effect.fn("SessionHttpApi.share")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      yield* shareSvc.share(ctx.params.sessionID).pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
      return yield* requireSession(ctx.params.sessionID)
    })

    const unshare = Effect.fn("SessionHttpApi.unshare")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      yield* shareSvc
        .unshare(ctx.params.sessionID)
        .pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
      return yield* requireSession(ctx.params.sessionID)
    })

    const summarize = Effect.fn("SessionHttpApi.summarize")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof SummarizePayload.Type
    }) {
      yield* revertSvc.cleanup(yield* requireSession(ctx.params.sessionID))
      const messages = yield* SessionError.mapStorageNotFound(session.messages({ sessionID: ctx.params.sessionID }))
      const defaultAgent = yield* agentSvc.defaultAgent()
      const currentAgent = messages.findLast((message) => message.info.role === "user")?.info.agent ?? defaultAgent

      yield* compactSvc.create({
        sessionID: ctx.params.sessionID,
        agent: currentAgent,
        model: {
          providerID: ctx.payload.providerID,
          modelID: ctx.payload.modelID,
        },
        auto: ctx.payload.auto ?? false,
      })
      yield* promptSvc.loop({ sessionID: ctx.params.sessionID })
      return true
    })

    const prompt = Effect.fn("SessionHttpApi.prompt")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      const message = yield* promptSvc
        .prompt({
          ...ctx.payload,
          sessionID: ctx.params.sessionID,
        })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      return HttpServerResponse.stream(Stream.make(JSON.stringify(message)).pipe(Stream.encodeText), {
        contentType: "application/json",
      })
    })

    const promptAsync = Effect.fn("SessionHttpApi.promptAsync")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* promptSvc.prompt({ ...ctx.payload, sessionID: ctx.params.sessionID }).pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            yield* Effect.logError("prompt_async failed").pipe(
              Effect.annotateLogs({ sessionID: ctx.params.sessionID, cause }),
            )
            yield* bus.publish(Session.Event.Error, {
              sessionID: ctx.params.sessionID,
              error: new NamedError.Unknown({ message: Cause.pretty(cause) }).toObject(),
            })
          }),
        ),
        Effect.forkIn(scope, { startImmediately: true }),
      )
      return HttpApiSchema.NoContent.make()
    })

    const command = Effect.fn("SessionHttpApi.command")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof CommandPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* promptSvc
        .command({ ...ctx.payload, sessionID: ctx.params.sessionID })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const shell = Effect.fn("SessionHttpApi.shell")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof ShellPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* requireTerminalAccess()
      return yield* mapBusy(promptSvc.shell({ ...ctx.payload, sessionID: ctx.params.sessionID }))
    })

    const revert = Effect.fn("SessionHttpApi.revert")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof RevertPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* mapBusy(revertSvc.revert({ sessionID: ctx.params.sessionID, ...ctx.payload }))
    })

    const unrevert = Effect.fn("SessionHttpApi.unrevert")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* mapBusy(revertSvc.unrevert({ sessionID: ctx.params.sessionID }))
    })

    const assertViewerCanReply = Effect.fn("SessionHttpApi.assertViewerCanReply")(function* (
      sessionID: SessionID,
      viewerID?: string,
    ) {
      const info = yield* requireSession(sessionID)
      if (
        SessionViewer.canReply({
          sessionID,
          viewerID,
          parentSessionID: info.parentID,
        })
      ) {
        return
      }
      return yield* new HttpApiError.Forbidden({})
    })

    const permissionRespond = Effect.fn("SessionHttpApi.permissionRespond")(function* (ctx: {
      params: { sessionID: SessionID; permissionID: PermissionID }
      payload: typeof PermissionResponsePayload.Type
    }) {
      yield* assertViewerCanReply(ctx.params.sessionID, ctx.payload.viewerID)
      yield* permissionSvc.reply({ requestID: ctx.params.permissionID, reply: ctx.payload.response })
      return true
    })

    const view = Effect.fn("SessionHttpApi.view")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof SessionViewPayload.Type
    }) {
      // Presence is control-plane memory. The leaf often has no /view route
      // (404 in the browser), and the session row may only exist on B.
      yield* requireSession(ctx.params.sessionID).pipe(Effect.catch(() => Effect.void))
      const directory = yield* InstanceState.directory
      SessionViewer.register({
        directory,
        sessionID: ctx.params.sessionID,
        viewerID: ctx.payload.viewerID,
      })
      return true
    })

    const viewHeartbeat = Effect.fn("SessionHttpApi.viewHeartbeat")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof SessionViewPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID).pipe(Effect.catch(() => Effect.void))
      const ok = SessionViewer.heartbeat({
        sessionID: ctx.params.sessionID,
        viewerID: ctx.payload.viewerID,
      })
      if (!ok) {
        const directory = yield* InstanceState.directory
        SessionViewer.register({
          directory,
          sessionID: ctx.params.sessionID,
          viewerID: ctx.payload.viewerID,
        })
      }
      return true
    })

    const unview = Effect.fn("SessionHttpApi.unview")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof SessionViewPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID).pipe(Effect.catch(() => Effect.void))
      SessionViewer.unregister({
        sessionID: ctx.params.sessionID,
        viewerID: ctx.payload.viewerID,
      })
      return true
    })

    const deleteMessage = Effect.fn("SessionHttpApi.deleteMessage")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID }
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* mapBusy(runState.assertNotBusy(ctx.params.sessionID))
      yield* session.removeMessage(ctx.params)
      return true
    })

    const deletePart = Effect.fn("SessionHttpApi.deletePart")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID; partID: PartID }
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* session.removePart(ctx.params)
      return true
    })

    const updatePart = Effect.fn("SessionHttpApi.updatePart")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID; partID: PartID }
      payload: typeof MessageV2.Part.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      const payload = ctx.payload as MessageV2.Part
      if (
        payload.id !== ctx.params.partID ||
        payload.messageID !== ctx.params.messageID ||
        payload.sessionID !== ctx.params.sessionID
      ) {
        return yield* new HttpApiError.BadRequest({})
      }
      return yield* session.updatePart(payload)
    })

    return handlers
      .handle("list", list)
      .handle("status", status)
      .handle("get", get)
      .handle("children", children)
      .handle("todo", todo)
      .handle("diff", diff)
      .handle("messages", messages)
      .handle("message", message)
      .handleRaw("create", createRaw)
      .handle("remove", remove)
      .handle("update", update)
      .handleRaw("fork", forkRaw)
      .handle("abort", abort)
      .handle("init", init)
      .handle("share", share)
      .handle("unshare", unshare)
      .handle("summarize", summarize)
      .handle("prompt", prompt)
      .handle("promptAsync", promptAsync)
      .handle("command", command)
      .handle("shell", shell)
      .handle("revert", revert)
      .handle("unrevert", unrevert)
      .handle("permissionRespond", permissionRespond)
      .handle("view", view)
      .handle("viewHeartbeat", viewHeartbeat)
      .handle("unview", unview)
      .handle("deleteMessage", deleteMessage)
      .handle("deletePart", deletePart)
      .handle("updatePart", updatePart)
  }),
)
