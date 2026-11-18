import { Effect, Option, Schema } from "effect"
import * as Tool from "./tool"
import * as PlatformAuth from "@/platform-auth/platform-auth"
import { bindAlreadyPrimitive } from "@/onescience/already-primitive"
import DESCRIPTION from "./register_dataset_primitive.txt"

export const Parameters = Schema.Struct({
  already_id: Schema.String.annotate({
    description: "Required. Ready Already id (alr_*) from dataset_report.",
  }),
  title: Schema.optional(
    Schema.String.annotate({
      description: "Optional display name for the dataset description / data.load primitive.",
    }),
  ),
  description: Schema.optional(
    Schema.String.annotate({
      description: "Optional one-line summary for agents.",
    }),
  ),
  data_schema: Schema.optional(
    Schema.String.annotate({
      description: "Optional schema / columns / variable list.",
    }),
  ),
  usage_notes: Schema.optional(
    Schema.String.annotate({
      description: "Optional usage notes or caveats.",
    }),
  ),
})

export const RegisterDatasetPrimitiveTool = Tool.define(
  "register_dataset_primitive",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
      Effect.gen(function* () {
        const current = Option.getOrUndefined(yield* Effect.serviceOption(PlatformAuth.CurrentSession))
        const accountId = current?.session?.account.id
        if (!accountId) return yield* Effect.die(new Error("Login required to register dataset primitive"))
        const result = yield* Effect.try({
          try: () =>
            bindAlreadyPrimitive({
              alreadyId: params.already_id.trim(),
              accountId,
              fields: {
                ...(params.title?.trim() ? { title: params.title.trim() } : {}),
                ...(params.description?.trim() ? { description: params.description.trim() } : {}),
                ...(params.data_schema?.trim() ? { data_schema: params.data_schema.trim() } : {}),
                ...(params.usage_notes?.trim() ? { usage_notes: params.usage_notes.trim() } : {}),
              },
            }),
          catch: (error) => Effect.die(error instanceof Error ? error : new Error(String(error))),
        })
        return {
          title: "Dataset primitive registered",
          metadata: {
            already_id: result.already_id,
            primitive_id: result.primitive_id,
            primitive_complete: result.primitive_complete,
          },
          output: JSON.stringify(result, null, 2),
        }
      }).pipe(Effect.orDie),
  }),
)
