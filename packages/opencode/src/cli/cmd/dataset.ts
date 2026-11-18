import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { ServerAuth } from "@/server/auth"
import { Flag } from "@opencode-ai/core/flag/flag"
import { readFileSync } from "fs"
import path from "path"

async function readReport(file?: string) {
  const text = file ? readFileSync(file, "utf8") : await Bun.stdin.text()
  const parsed = JSON.parse(text) as {
    name?: string
    target_dir?: string
    artifact_uri?: string
    format?: string
    size_bytes?: number
    record_count?: number
    notes?: string
  }
  const target = parsed.target_dir?.trim() || parsed.artifact_uri?.trim()
  if (!parsed?.name || !target) {
    throw new Error("ingest report requires name and target_dir (or legacy artifact_uri)")
  }
  return {
    name: parsed.name,
    artifact_uri: target,
    format: parsed.format,
    size_bytes: parsed.size_bytes,
    record_count: parsed.record_count,
    notes: parsed.notes,
  }
}

function catalogTokenPath() {
  const root = process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY?.trim() || process.cwd()
  return path.join(root, ".opencode-catalog-token")
}

async function postAlready(url: string, headers: Record<string, string>, body: unknown) {
  const response = await fetch(new URL("/experimental/onescience/already", url.endsWith("/") ? url : `${url}/`), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(text || `Catalog ingest failed (${response.status})`)
  return text
}

export const DatasetReportCommand = cmd({
  command: "report",
  describe: "register a processed dataset as Already",
  builder: (yargs: Argv) =>
    yargs
      .option("attach", {
        type: "string",
        describe: "control-plane URL (local attach, e.g. http://127.0.0.1:4096)",
      })
      .option("token", {
        type: "string",
        describe: "platform auth token for local attach (or OPENCODE_PLATFORM_AUTH_TOKEN)",
      })
      .option("session", {
        alias: "s",
        type: "string",
        describe: "session id for chip-based ingest",
      })
      .option("raw", {
        type: "string",
        array: true,
        describe: "owned raw_ ids when reporting without a session",
      })
      .option("file", {
        alias: "f",
        type: "string",
        describe: "JSON ingest report file (default: stdin)",
      })
      .option("workspace", {
        type: "string",
        describe: "wrk_* id (defaults to OPENCODE_WORKSPACE_ID on a leaf)",
      })
      .option("password", {
        alias: "p",
        type: "string",
        describe: "basic auth password (defaults to OPENCODE_SERVER_PASSWORD)",
      })
      .option("username", {
        alias: "u",
        type: "string",
        describe: "basic auth username",
      }),
  async handler(args) {
    const report = await readReport(args.file)
    const workspaceId = (args.workspace || Flag.OPENCODE_WORKSPACE_ID || "").trim()
    const controlPlane = process.env.ONECODE_CONTROL_PLANE_URL?.trim()
    const body = {
      session_id: args.session,
      workspace_id: workspaceId,
      raw_ids: args.raw,
      report,
    }
    if (controlPlane) {
      let token = ""
      try {
        token = readFileSync(catalogTokenPath(), "utf8").trim()
      } catch {
        throw new Error("Catalog token file is missing; reconnect the remote workspace")
      }
      const text = await postAlready(controlPlane, { authorization: `Bearer ${token}` }, body)
      UI.println(text)
      return
    }
    if (!args.attach) {
      throw new Error("Local ingest must HTTP-attach to a running serve. Pass --attach http://127.0.0.1:<port>")
    }
    const headers: Record<string, string> = { ...(ServerAuth.headers({ password: args.password, username: args.username }) ?? {}) }
    const platformToken = args.token || process.env.OPENCODE_PLATFORM_AUTH_TOKEN
    if (platformToken) headers["x-platform-auth-token"] = platformToken
    const text = await postAlready(args.attach, headers, body)
    UI.println(text)
  },
})

export const DatasetCommand = cmd({
  command: "dataset",
  describe: "OneData catalog commands",
  builder: (yargs: Argv) => yargs.command(DatasetReportCommand).demandCommand(),
  async handler() {},
})
