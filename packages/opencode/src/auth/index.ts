import path from "path"
import { Effect, Layer, Option, Record, Result, Schema, Context } from "effect"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/core/global"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import * as PlatformAuth from "@/platform-auth/platform-auth"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

const globalFile = path.join(Global.Path.data, "auth.json")
const credentialsDir = path.join(Global.Path.data, "platform-credentials")

const fail = (message: string) => (cause: unknown) => new AuthError({ message, cause })

export class Oauth extends Schema.Class<Oauth>("OAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
}) {}

export class Api extends Schema.Class<Api>("ApiAuth")({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
}) {}

export const Info = Schema.Union([Oauth, Api, WellKnown]).annotate({ discriminator: "type", identifier: "Auth" })
export type Info = Schema.Schema.Type<typeof Info>

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export interface Interface {
  readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
  readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
  /** Read persisted credentials only — ignores OPENCODE_AUTH_CONTENT (used when syncing to SSH leaf). */
  readonly storedAll: () => Effect.Effect<Record<string, Info>, AuthError>
  readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
  readonly remove: (key: string) => Effect.Effect<void, AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Auth") {}

function sanitizeAccountId(accountId: string) {
  return accountId.replace(/[^a-zA-Z0-9._-]+/g, "_")
}

/** Platform sessions use per-account credential files; CLI / no session uses global auth.json. */
export function authFileForAccount(accountId: string | undefined) {
  if (!accountId) return globalFile
  return path.join(credentialsDir, `${sanitizeAccountId(accountId)}.json`)
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* AppFileSystem.Service
    const decode = Schema.decodeUnknownOption(Info)

    const resolveAccountId = Effect.gen(function* () {
      const current = Option.getOrUndefined(yield* Effect.serviceOption(PlatformAuth.CurrentSession))
      return current?.session?.account.id
    })

    const resolveFile = Effect.map(resolveAccountId, authFileForAccount)

    const readStored = Effect.fn("Auth.readStored")(function* () {
      const file = yield* resolveFile
      const data = (yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => ({})))) as Record<string, unknown>
      return Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
    })

    const all = Effect.fn("Auth.all")(function* () {
      // SSH leaf: prefer the synced snapshot file so reconnect/auth updates do not depend
      // solely on process env baked in at serve start (empty cat → parse fail → empty keys).
      if (process.env.OPENCODE_WORKSPACE_ID?.trim()) {
        const leafAuth =
          process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY?.trim() || process.cwd()
        const leafFile = path.join(leafAuth.replace(/\/+$/, ""), ".opencode-auth.json")
        const leafData = (yield* fsys.readJson(leafFile).pipe(Effect.orElseSucceed(() => undefined))) as
          | Record<string, unknown>
          | undefined
        if (leafData && typeof leafData === "object") {
          return Record.filterMap(leafData, (value) => Result.fromOption(decode(value), () => undefined))
        }
      }

      if (process.env.OPENCODE_AUTH_CONTENT) {
        try {
          return JSON.parse(process.env.OPENCODE_AUTH_CONTENT)
        } catch (err) {}
      }

      return yield* readStored()
    })

    const storedAll = readStored

    const get = Effect.fn("Auth.get")(function* (providerID: string) {
      return (yield* all())[providerID]
    })

    const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
      const norm = key.replace(/\/+$/, "")
      const data = yield* all()
      const file = yield* resolveFile
      if (norm !== key) delete data[key]
      delete data[norm + "/"]
      yield* fsys.ensureDir(path.dirname(file)).pipe(Effect.mapError(fail("Failed to create auth directory")))
      yield* fsys
        .writeJson(file, { ...data, [norm]: info }, 0o600)
        .pipe(Effect.mapError(fail("Failed to write auth data")))
    })

    const remove = Effect.fn("Auth.remove")(function* (key: string) {
      const norm = key.replace(/\/+$/, "")
      const data = yield* all()
      const file = yield* resolveFile
      delete data[key]
      delete data[norm]
      yield* fsys.ensureDir(path.dirname(file)).pipe(Effect.mapError(fail("Failed to create auth directory")))
      yield* fsys.writeJson(file, data, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
    })

    return Service.of({ get, all, storedAll, set, remove })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

export * as Auth from "."
