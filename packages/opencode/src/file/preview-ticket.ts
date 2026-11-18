export * as FilePreviewTicket from "./preview-ticket"

import { Cache, Context, Duration, Effect, Layer, Option, Schema } from "effect"
import { PositiveInt } from "@opencode-ai/core/schema"

const DEFAULT_TTL = Duration.hours(1)
const CAPACITY = 10_000

export const PreviewToken = Schema.Struct({
  ticket: Schema.String,
  expires_in: PositiveInt,
})

export type Scope = {
  readonly directory: string
}

export interface Interface {
  issue(input: Scope): Effect.Effect<typeof PreviewToken.Type>
  peek(input: { readonly ticket: string }): Effect.Effect<Scope | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/FilePreviewTicket") {}

const noLookup = () => Effect.die("FilePreviewTicket cache must be used via set/get, never lookup")

export const make = (ttl: Duration.Input = DEFAULT_TTL) =>
  Effect.gen(function* () {
    const cache = yield* Cache.make<string, Scope>({ capacity: CAPACITY, lookup: noLookup, timeToLive: ttl })
    const expiresIn = Math.max(1, Math.round(Duration.toSeconds(Duration.fromInputUnsafe(ttl))))
    return Service.of({
      issue: Effect.fn("FilePreviewTicket.issue")(function* (input) {
        const ticket = crypto.randomUUID()
        yield* Cache.set(cache, ticket, { directory: input.directory })
        return { ticket, expires_in: expiresIn }
      }),
      peek: Effect.fn("FilePreviewTicket.peek")(function* (input) {
        return Option.getOrUndefined(yield* Cache.getOption(cache, input.ticket))
      }),
    })
  })

export const layer = Layer.effect(Service, make())

export const defaultLayer = layer
