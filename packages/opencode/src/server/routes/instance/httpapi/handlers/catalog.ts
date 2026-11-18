import { Catalog } from "@/catalog/index"
import { Database } from "@/storage/db"
import { Skill } from "@/skill"
import * as PlatformAuth from "@/platform-auth/platform-auth"
import * as Log from "@opencode-ai/core/util/log"
import { Effect } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { CatalogSearchPayload } from "../groups/catalog"
import { WorkspaceRoutingQuery } from "../middleware/workspace-routing"

const jsonSafe = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown

const projectDir = Effect.fn("CatalogHttpApi.projectDir")(function* (query: typeof WorkspaceRoutingQuery.Type) {
  if (query.directory) return query.directory
  const request = yield* HttpServerRequest.HttpServerRequest
  return request.headers["x-opencode-directory"] ?? process.cwd()
})

function mapNotFound<A, R>(self: Effect.Effect<A, unknown, R>) {
  return self.pipe(
    Effect.catch((error) => {
      if (Database.NotFoundError.isInstance(error)) {
        return Effect.fail(new HttpApiError.NotFound({}))
      }
      return Effect.die(error)
    }),
  )
}

export const catalogHandlers = HttpApiBuilder.group(InstanceHttpApi, "catalog", (handlers) =>
  Effect.gen(function* () {
    const skill = yield* Skill.Service

    const search = Effect.fn("CatalogHttpApi.search")(function* (ctx: {
      payload: typeof CatalogSearchPayload.Type
      query: typeof WorkspaceRoutingQuery.Type
    }) {
      const current = yield* PlatformAuth.CurrentSession
      const accountId = current.session?.account.id ?? (current.serverAdmin ? undefined : "")
      const payload = accountId !== undefined ? { ...ctx.payload, accountId } : ctx.payload
      return yield* Effect.promise(async () => {
        try {
          return await Catalog.searchAsync(payload)
        } catch (error) {
          Log.Default.error("catalog searchAsync failed, falling back to sync search", { error })
          return Catalog.search(payload)
        }
      })
    })

    const entry = Effect.fn("CatalogHttpApi.entry")(function* (ctx: { params: { id: string } }) {
      return Catalog.getEntry(ctx.params.id)
    })

    const resolve = Effect.fn("CatalogHttpApi.resolve")(function* (ctx: {
      params: { id: string }
      query: { part?: typeof Catalog.ResolvePart.Type }
    }) {
      return jsonSafe(Catalog.resolve(ctx.params.id, ctx.query.part ?? "summary"))
    })

    const reconcile = Effect.fn("CatalogHttpApi.reconcile")(function* (ctx: {
      query: typeof WorkspaceRoutingQuery.Type & { syncSkills?: boolean; embedApi?: boolean; embedModel?: boolean }
    }) {
      const directory = yield* projectDir(ctx.query)
      const indexed = Catalog.reconcile(
        ctx.query.syncSkills ? { projectDir: directory, syncSkills: true } : undefined,
      )
      if (ctx.query.syncSkills) {
        const runtime = yield* skill.all()
        Catalog.syncRuntimeSkills(Skill.catalogSnapshot(runtime), directory)
      }
      if (!ctx.query.embedApi && !ctx.query.embedModel) return indexed
      const mode = ctx.query.embedApi ? "api" : "model"
      const extra = yield* Effect.tryPromise(() => Catalog.embedCatalogAsync({ mode })).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => Log.Default.error("catalog embed failed", { error, mode })),
        ),
        Effect.orElseSucceed(() => 0),
      )
      return { ...indexed, embedded: indexed.embedded + extra }
    })

    return handlers
      .handle("search", search)
      .handle("entry", (ctx) => mapNotFound(entry(ctx)))
      .handle("resolve", (ctx) => mapNotFound(resolve(ctx)))
      .handle("reconcile", reconcile)
  }),
)
