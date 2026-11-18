import { Catalog } from "@/catalog/index"
import { migrateStaticPrimitives } from "@/onescience/primitive-migration"
import { ExperimentalHttpApiServer } from "@/server/routes/instance/httpapi/server"
import { Context } from "effect"

const projectDir = process.argv[2] ?? process.env.OPENCODE_DIRECTORY ?? process.cwd()
const handlerContext = Context.empty() as Context.Context<unknown>

async function request(path: string, init?: RequestInit) {
  return ExperimentalHttpApiServer.webHandler().handler(
    new Request(`http://localhost${path}`, {
      ...init,
      headers: {
        "x-opencode-directory": projectDir,
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    }),
    handlerContext,
  )
}

migrateStaticPrimitives()
Catalog.reconcile({ syncSkills: true, projectDir })

const reconcile = await request("/catalog/reconcile?syncSkills=true", { method: "POST" })
const reconcileBody = await reconcile.json()
console.log("catalog reconcile status:", reconcile.status, "body:", JSON.stringify(reconcileBody))

const primitiveSearch = await request("/catalog/search", {
  method: "POST",
  body: JSON.stringify({ kind: "primitive", q: "data", k: 5 }),
})
const primitiveBody = await primitiveSearch.json()
console.log("primitive search status:", primitiveSearch.status, "count:", primitiveBody.items?.length)

const skillSearch = await request("/catalog/search", {
  method: "POST",
  body: JSON.stringify({ kind: "skill", q: "workflow", k: 8 }),
})
const skillBody = await skillSearch.json()
console.log("skill search status:", skillSearch.status, "count:", skillBody.items?.length)
console.log(
  "skill hits:",
  (skillBody.items ?? []).map((item: { name: string }) => item.name).join(", "),
)

const primitiveId = primitiveBody.items?.[0]?.id
if (primitiveId) {
  const resolve = await request(`/catalog/entries/${encodeURIComponent(primitiveId)}/resolve?part=summary`)
  const resolveBody = await resolve.json()
  console.log("resolve status:", resolve.status, "id:", resolveBody.id)
}

const failed =
  reconcile.status !== 200 ||
  (reconcileBody.skillCount ?? 0) < 7 ||
  primitiveSearch.status !== 200 ||
  skillSearch.status !== 200 ||
  !primitiveBody.items?.length ||
  !skillBody.items?.some((item: { name: string }) => item.name.startsWith("onescience-"))

if (failed) {
  console.error("catalog e2e check failed")
  process.exit(1)
}

console.log("catalog e2e check passed (HTTP catalog + oneskills ingest)")
