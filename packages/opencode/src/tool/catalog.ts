import { Effect, Schema } from "effect"
import { Catalog } from "@/catalog/index"
import { Skill } from "../skill"
import * as Tool from "./tool"
import SEARCH_DESCRIPTION from "./catalog_search.txt"
import RESOLVE_DESCRIPTION from "./catalog_resolve.txt"

export const SearchParameters = Schema.Struct({
  kind: Catalog.Kind.annotate({ description: "Asset kind to search: skill or primitive" }),
  q: Schema.optional(Schema.String.annotate({ description: "Search query text" })),
  category: Schema.optional(Schema.String.annotate({ description: "Filter by category, layer, or primitive_type" })),
  tags: Schema.optional(Schema.Array(Schema.String).annotate({ description: "Require all listed tags" })),
  source: Schema.optional(Schema.String.annotate({ description: "Filter by source: official, local, opencode-config" })),
  status: Schema.optional(Schema.String.annotate({ description: "Filter by status; primitives default to callable in upstream sync" })),
  domain: Schema.optional(Catalog.CatalogDomain),
  k: Schema.optional(Schema.Number.annotate({ description: "Maximum number of results (default 8)" })),
})

export const ResolveParameters = Schema.Struct({
  id: Schema.String.annotate({ description: "Catalog entry id from catalog_search" }),
  part: Schema.optional(Catalog.ResolvePart.annotate({ description: "summary, location, contract, body, or assets" })),
})

export function emptyCatalogSearchHint(input: {
  domain?: string
  tags?: readonly string[]
  q?: string
}) {
  if (input.tags?.length) {
    return input.domain
      ? `No matches. domain=${input.domain} is valid; the tags filter is likely too strict. Drop tags (or use fewer tags) and retry before changing domain.`
      : "No matches. The tags filter is likely too strict. Drop tags or use fewer tags, then retry."
  }
  if (input.domain) {
    return `No matches. domain=${input.domain} is a valid domain value; q/category/source filters are more likely too strict. Broaden q or drop those filters before changing domain.`
  }
  return "No matches. Broaden q or drop optional filters (category, tags, source, domain)."
}

export const CatalogSearchTool = Tool.define(
  "catalog_search",
  Effect.succeed({
    description: SEARCH_DESCRIPTION,
    parameters: SearchParameters,
    execute: (params: Schema.Schema.Type<typeof SearchParameters>) =>
      Effect.tryPromise({
        try: async () => {
          try {
            return await Catalog.searchAsync(params)
          } catch {
            return Catalog.search(params)
          }
        },
        catch: (error) => Effect.die(error),
      }).pipe(
        Effect.map((result) => ({
          title: `Catalog search (${params.kind})`,
          output: JSON.stringify(
            result.items.length === 0 ? { ...result, hint: emptyCatalogSearchHint(params) } : result,
            null,
            2,
          ),
          metadata: { kind: params.kind, count: result.items.length },
        })),
        Effect.orDie,
      ),
  }),
)

export const CatalogResolveTool = Tool.define(
  "catalog_resolve",
  Effect.gen(function* () {
    yield* Skill.Service
    return {
      description: RESOLVE_DESCRIPTION,
      parameters: ResolveParameters,
      execute: (params: Schema.Schema.Type<typeof ResolveParameters>) =>
        Effect.sync(() => {
          const result = Catalog.resolve(params.id, params.part ?? "summary")
          return {
            title: `Catalog resolve (${params.part ?? "summary"})`,
            output: JSON.stringify(result, null, 2),
            metadata: { id: params.id, part: params.part ?? "summary" },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
