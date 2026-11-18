import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { Bus } from "@/bus"
import { Duration, Effect, Exit, Schema } from "effect"
import { EffectBridge } from "@/effect/bridge"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts>
}

const id = "task"

/**
 * A subagent run is considered stalled when its session has emitted no bus
 * activity (message/part updates, deltas, status changes) for this long. LLM
 * streams emit deltas continuously and the longest quiet tool (shell) times
 * out after 2 minutes, so a 10 minute silence means the run is wedged
 * (hung provider stream, deadlocked loop) and will never finish on its own.
 */
const DEFAULT_TASK_STALL_TIMEOUT_MS = 10 * 60 * 1000

/** Extracts the session an event belongs to from the common bus payload shapes. */
function busEventSessionID(properties: unknown): string | undefined {
  if (!properties || typeof properties !== "object") return undefined
  const props = properties as {
    sessionID?: unknown
    info?: { sessionID?: unknown }
    part?: { sessionID?: unknown }
  }
  if (typeof props.sessionID === "string") return props.sessionID
  if (props.info && typeof props.info.sessionID === "string") return props.info.sessionID
  if (props.part && typeof props.part.sessionID === "string") return props.part.sessionID
  return undefined
}

export const Parameters = Schema.Struct({
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
})

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const bus = yield* Bus.Service

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const next = yield* agent.get(params.subagent_type)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }

      const taskID = params.task_id
      const session = taskID
        ? yield* sessions.get(SessionID.make(taskID)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const parent = yield* sessions.get(ctx.sessionID)
      const parentAgent = parent.agent
        ? yield* agent.get(parent.agent).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          permission: [
            ...deriveSubagentSessionPermission({
              parentSessionPermission: parent.permission ?? [],
              parentAgent,
              subagent: next,
            }),
            ...(cfg.experimental?.primary_tools?.map((item) => ({
              pattern: "*",
              action: "allow" as const,
              permission: item,
            })) ?? []),
          ],
        }))

      const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(Effect.orDie)
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))

      const model = next.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      yield* ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: nextSession.id,
          model,
        },
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))
      const runCancel = yield* EffectBridge.make()

      const messageID = MessageID.ascending()
      const cancel = ops.cancel(nextSession.id)
      const stallTimeout = cfg.experimental?.task_stall_timeout_ms ?? DEFAULT_TASK_STALL_TIMEOUT_MS

      /**
       * Watches the subagent session for activity and cancels it when wedged.
       * Completes successfully once a stall was handled; until then it runs
       * forever, so racing it against the prompt keeps it alive exactly as
       * long as the subagent is running.
       */
      const watchStall = Effect.fn("TaskTool.watchStall")(function* (sessionID: SessionID) {
        let lastActivity = Date.now()
        yield* Effect.acquireUseRelease(
          bus.subscribeAllCallback((event) => {
            if (busEventSessionID(event?.properties) === sessionID) lastActivity = Date.now()
          }),
          () =>
            Effect.gen(function* () {
              while (true) {
                yield* Effect.sleep(Duration.seconds(30))
                if (Date.now() - lastActivity >= stallTimeout) break
              }
              yield* cancel.pipe(Effect.ignore)
            }),
          (unsubscribe) => Effect.sync(() => unsubscribe()),
        )
      })

      function onAbort() {
        runCancel.fork(cancel)
      }

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", onAbort)
        }),
        () =>
          Effect.gen(function* () {
            const parts = yield* ops.resolvePromptParts(params.prompt)
            const outcome = yield* Effect.race(
              ops
                .prompt({
                  messageID,
                  sessionID: nextSession.id,
                  model: {
                    modelID: model.modelID,
                    providerID: model.providerID,
                  },
                  agent: next.name,
                  tools: {
                    ...(next.permission.some((rule) => rule.permission === "todowrite") ? {} : { todowrite: false }),
                    ...(next.permission.some((rule) => rule.permission === id) ? {} : { task: false }),
                    ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
                  },
                  parts,
                })
                .pipe(Effect.map((result) => ({ stalled: false as const, result }))),
              watchStall(nextSession.id).pipe(Effect.as({ stalled: true as const })),
            )
            if (outcome.stalled) {
              return yield* Effect.fail(
                new Error(
                  `Task stalled: the subagent session produced no activity for ` +
                    `${Math.round(stallTimeout / 60000)} minutes and was cancelled. ` +
                    `You can resume it in a new task call with task_id="${nextSession.id}".`,
                ),
              )
            }
            const result = outcome.result

            return {
              title: params.description,
              metadata: {
                sessionId: nextSession.id,
                model,
              },
              output: [
                `task_id: ${nextSession.id} (for resuming to continue this task if needed)`,
                "",
                "<task_result>",
                result.parts.findLast((item) => item.type === "text")?.text ?? "",
                "</task_result>",
              ].join("\n"),
            }
          }),
        (_, exit) =>
          Effect.gen(function* () {
            if (Exit.hasInterrupts(exit)) yield* cancel
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                ctx.abort.removeEventListener("abort", onAbort)
              }),
            ),
          ),
      )
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
