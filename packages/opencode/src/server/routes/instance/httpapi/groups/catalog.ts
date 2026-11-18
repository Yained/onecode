import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Catalog } from "@/catalog/index"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { described } from "./metadata"
import { QueryBoolean } from "./query"

export const CatalogSearchPayload = Schema.Struct({
  kind: Catalog.Kind,
  q: Schema.optional(Schema.String),
  category: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  source: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  domain: Schema.optional(Catalog.CatalogDomain),
  k: Schema.optional(Schema.Number),
  officialOnly: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "CatalogSearchPayload" })

export const CatalogResolveQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  part: Schema.optional(Catalog.ResolvePart),
})

export const CatalogPaths = {
  search: "/catalog/search",
  entry: "/catalog/entries/:id",
  resolve: "/catalog/entries/:id/resolve",
  reconcile: "/catalog/reconcile",
} as const

export const CatalogApi = HttpApi.make("catalog")
  .add(
    HttpApiGroup.make("catalog")
      .add(
        HttpApiEndpoint.post("search", CatalogPaths.search, {
          query: WorkspaceRoutingQuery,
          payload: CatalogSearchPayload,
          success: described(Catalog.SearchResponse, "Catalog search results"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "catalog.search",
            summary: "Search catalog entries",
            description: "Search skills or AI primitives in the local catalog index.",
          }),
        ),
        HttpApiEndpoint.get("entry", CatalogPaths.entry, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Catalog.EntrySummary, "Catalog entry"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "catalog.entry.get",
            summary: "Get catalog entry",
            description: "Get a catalog entry summary by id.",
          }),
        ),
        HttpApiEndpoint.get("resolve", CatalogPaths.resolve, {
          params: { id: Schema.String },
          query: CatalogResolveQuery,
          success: described(Schema.Unknown, "Catalog resolve payload"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "catalog.entry.resolve",
            summary: "Resolve catalog entry",
            description: "Resolve summary, location, contract, body, or assets for a catalog entry.",
          }),
        ),
        HttpApiEndpoint.post("reconcile", CatalogPaths.reconcile, {
          query: Schema.Struct({
            ...WorkspaceRoutingQueryFields,
            syncSkills: Schema.optional(QueryBoolean),
            embedApi: Schema.optional(QueryBoolean),
            embedModel: Schema.optional(QueryBoolean),
          }),
          success: described(
            Schema.Struct({
              primitiveCount: Schema.Number,
              skillCount: Schema.Number,
              embedded: Schema.optional(Schema.Number),
            }),
            "Catalog reconcile result",
          ),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "catalog.reconcile",
            summary: "Reconcile catalog index",
            description: "Rebuild the primitive index from ai_primitive and optionally sync skills.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "catalog",
          description: "Local catalog search and resolve routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
