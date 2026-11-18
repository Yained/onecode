import { Effect, Option, Schema } from "effect"
import * as Tool from "./tool"
import { Flag } from "@opencode-ai/core/flag/flag"
import { readFileSync } from "fs"
import path from "path"
import * as PlatformAuth from "@/platform-auth/platform-auth"
import { DataCatalog } from "@/onescience/data-catalog"
import DESCRIPTION from "./dataset_report.txt"

export const Parameters = Schema.Struct({
  name: Schema.String.annotate({
    description: "Required. Dataset display name (same as the handoff「数据集名称」).",
  }),
  target_dir: Schema.String.annotate({
    description:
      "Required. AI Ready output directory/path after standardization (same as handoff「target dir」). Must already exist.",
  }),
})

function catalogTokenPath() {
  const root = process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY?.trim() || process.cwd()
  return path.join(root, ".opencode-catalog-token")
}

function toIngestReport(params: Schema.Schema.Type<typeof Parameters>) {
  return {
    name: params.name,
    artifact_uri: params.target_dir,
  }
}

async function ingestRemote(params: Schema.Schema.Type<typeof Parameters>, sessionID: string) {
  const base = process.env.ONECODE_CONTROL_PLANE_URL?.trim()
  if (!base) throw new Error("Remote catalog forward is unavailable (ONECODE_CONTROL_PLANE_URL is not set)")
  let token = ""
  try {
    token = readFileSync(catalogTokenPath(), "utf8").trim()
  } catch {
    throw new Error("Catalog token file is missing; reconnect the remote workspace")
  }
  if (!token) throw new Error("Catalog token file is empty; reconnect the remote workspace")
  const workspaceId = Flag.OPENCODE_WORKSPACE_ID?.trim() || ""
  const response = await fetch(new URL("/experimental/onescience/already", base.endsWith("/") ? base : `${base}/`), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      session_id: sessionID,
      workspace_id: workspaceId,
      report: toIngestReport(params),
    }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(text || `Catalog ingest failed (${response.status})`)
  }
  return (await response.json()) as { id?: string; status?: string }
}

export const DatasetReportTool = Tool.define(
  "dataset_report",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        const workspaceId = Flag.OPENCODE_WORKSPACE_ID?.trim() || ""
        const report = toIngestReport(params)
        const already = workspaceId
          ? yield* Effect.tryPromise({
              try: () => ingestRemote(params, ctx.sessionID),
              catch: (error) => Effect.die(error instanceof Error ? error : new Error(String(error))),
            })
          : yield* Effect.gen(function* () {
              const current = Option.getOrUndefined(yield* Effect.serviceOption(PlatformAuth.CurrentSession))
              const accountId = current?.session?.account.id
              if (!accountId) return yield* Effect.die(new Error("Login required to ingest Already datasets"))
              return yield* Effect.tryPromise({
                try: () =>
                  DataCatalog.ingestAlready({
                    accountId,
                    session: current?.session,
                    sessionId: ctx.sessionID,
                    workspaceId: "",
                    report,
                  }),
                catch: (error) => Effect.die(error instanceof Error ? error : new Error(String(error))),
              })
            })
        return {
          title: `Ingested ${params.name}`,
          output: `Registered Already ${already.id ?? ""} (${already.status ?? "unknown"}). Open OneData → 可训练数据 to use it.`,
          metadata: { id: already.id, status: already.status },
        }
      }).pipe(Effect.orDie),
  }),
)
