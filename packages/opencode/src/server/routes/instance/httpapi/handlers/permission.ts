import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { Session } from "@/session/session"
import * as SessionViewer from "@/session/viewer"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const permissionHandlers = HttpApiBuilder.group(InstanceHttpApi, "permission", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Permission.Service
    const session = yield* Session.Service

    const list = Effect.fn("PermissionHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const reply = Effect.fn("PermissionHttpApi.reply")(function* (ctx: {
      params: { requestID: PermissionID }
      payload: Permission.ReplyBody
    }) {
      const pending = yield* svc.list()
      const request = pending.find((item) => item.id === ctx.params.requestID)
      if (request) {
        const info = yield* session.get(request.sessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (
          !SessionViewer.canReply({
            sessionID: request.sessionID,
            viewerID: ctx.payload.viewerID,
            parentSessionID: info?.parentID,
          })
        ) {
          return yield* new HttpApiError.Forbidden({})
        }
      }
      yield* svc.reply({
        requestID: ctx.params.requestID,
        reply: ctx.payload.reply,
        message: ctx.payload.message,
      })
      return true
    })

    return handlers.handle("list", list).handle("reply", reply)
  }),
)
