import { Question } from "@/question"
import { QuestionID } from "@/question/schema"
import { Session } from "@/session/session"
import * as SessionViewer from "@/session/viewer"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const questionHandlers = HttpApiBuilder.group(InstanceHttpApi, "question", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Question.Service
    const session = yield* Session.Service

    const assertViewerCanReply = Effect.fn("QuestionHttpApi.assertViewerCanReply")(function* (
      requestID: QuestionID,
      viewerID?: string,
    ) {
      const pending = yield* svc.list()
      const request = pending.find((item) => item.id === requestID)
      if (!request) return
      const info = yield* session.get(request.sessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (
        SessionViewer.canReply({
          sessionID: request.sessionID,
          viewerID,
          parentSessionID: info?.parentID,
        })
      ) {
        return
      }
      return yield* new HttpApiError.Forbidden({})
    })

    const list = Effect.fn("QuestionHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const reply = Effect.fn("QuestionHttpApi.reply")(function* (ctx: {
      params: { requestID: QuestionID }
      payload: Question.Reply
    }) {
      yield* assertViewerCanReply(ctx.params.requestID, ctx.payload.viewerID)
      yield* svc.reply({
        requestID: ctx.params.requestID,
        answers: ctx.payload.answers,
      })
      return true
    })

    const reject = Effect.fn("QuestionHttpApi.reject")(function* (ctx: {
      params: { requestID: QuestionID }
      query?: { viewerID?: string }
    }) {
      yield* assertViewerCanReply(ctx.params.requestID, ctx.query?.viewerID)
      yield* svc.reject(ctx.params.requestID)
      return true
    })

    return handlers.handle("list", list).handle("reply", reply).handle("reject", reject)
  }),
)
