import { Database } from "@/storage/db"
import { Identifier } from "@/id/id"
import { and, desc, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm"
import { createHash } from "crypto"
import { existsSync, mkdirSync, readdirSync, realpathSync, statSync, writeFileSync } from "fs"
import path from "path"
import { Schema } from "effect"
import * as PlatformAuth from "@/platform-auth/platform-auth"
import { SessionTable } from "@/session/session.sql"
import { WorkspaceTable } from "@/control-plane/workspace.sql"
import { getAdapter } from "@/control-plane/adapters"
import { parseSshNodeExtra } from "@/control-plane/adapters/ssh-node-path"
import type { WorkspaceInfo } from "@/control-plane/types"
import { OneScienceResource } from "./resource"
import { OneScienceResourceTable } from "./resource.sql"
import { createTrainingHandoff } from "./data-project"
import { deleteAccountCatalog } from "./data-catalog-account"
import { CatalogError } from "./catalog-error"
import { looksLikeZarr, summarizeZarr, type ZarrSummary } from "./zarr-summary"
import { probeObjectUri, summarizeObjectZarr } from "./object-store-key"
import { samplePdf } from "./sample-pdf"
import {
  isSampleableFormat,
  PYTHON_SAMPLE_FORMATS,
  SAMPLEABLE_FORMATS,
  sampleScientificBinary,
  sampleTextFile,
} from "./sample-scientific"
import { sampleXlsx } from "./sample-xlsx"
import {
  DB_EXPORT_MAX_BYTES,
  DB_EXPORT_MAX_ROWS,
  exportDbTable,
  formatDbTableUri,
  listDbConnections,
  listDbTables,
  parseDbTableUri,
  sampleDbTable,
} from "./db-connection"
import {
  OneScienceDataArtifactTable,
  OneScienceDataProjectTable,
  OneScienceDataSessionChipTable,
  OneScienceDataSessionMetaTable,
} from "./data-project.sql"

export { CatalogError } from "./catalog-error"

export const CatalogConnector = Schema.Literals([
  "local_fs",
  "http_dataset",
  "object_store",
  "onedata_ref",
  "remote_workspace",
  "database",
  "unbound",
])
export type CatalogConnector = typeof CatalogConnector.Type

export const CatalogDomain = Schema.Literals(["materials", "weather", "fluid", "bio", "unspecified"])
export type CatalogDomain = typeof CatalogDomain.Type

const LEGACY_DOMAIN: Record<string, CatalogDomain> = {
  地球科学: "weather",
  气象: "weather",
  材料化学: "materials",
  材料: "materials",
  生命科学: "bio",
  生信: "bio",
  流体仿真: "fluid",
  流体: "fluid",
}

export function normalizeDomain(input?: string | null): CatalogDomain {
  const value = input?.trim()
  if (!value) return "unspecified"
  if (value === "materials" || value === "weather" || value === "fluid" || value === "bio" || value === "unspecified") {
    return value
  }
  return LEGACY_DOMAIN[value] ?? "unspecified"
}

export function domainFilterValues(domain?: string) {
  const normalized = domain ? normalizeDomain(domain) : undefined
  if (!normalized || normalized === "unspecified") return undefined
  const legacy = Object.entries(LEGACY_DOMAIN)
    .filter(([, id]) => id === normalized)
    .map(([label]) => label)
  return [normalized, ...legacy]
}

export type ProbeResult = {
  exists: boolean
  is_dir: boolean
  size_bytes?: number
  logical_bytes?: number
  entry_count?: number
  mtime_ms?: number
  format_hint: string
  normalized_uri: string
  connector: CatalogConnector
  workspace_id: string
  columns?: string[]
}

export type RawSource = {
  id: string
  title: string
  description: string
  domain: string
  uri: string
  format: string
  owner: string
  workspace_id: string
  connector: CatalogConnector
  ingest_method: string
  lineage_public_id?: string
  time_created: number
  time_updated: number
}

export type AlreadyDataset = {
  id: string
  title: string
  uri: string
  format: string
  owner: string
  visibility: string
  workspace_id: string
  source_raw_ids: string[]
  status: string
  build_method: string
  connector: CatalogConnector
  logical_bytes?: number
  record_count?: number
  entry_count?: number
  primitive_id?: string
  primitive_complete?: boolean
  time_created: number
  time_updated: number
}

const SAMPLE_MAX = 64 * 1024
const DIR_MAX_ENTRIES = 2000
const DIR_MAX_DEPTH = 4
const DIR_PREVIEW_LIST_MAX = 40
export { SAMPLEABLE_FORMATS }

export type DirectoryListingEntry = {
  path: string
  is_dir: boolean
  size_bytes?: number
}

export type DirectoryPreview = {
  entries: DirectoryListingEntry[]
  truncated: boolean
  sample_path?: string
}

function gone(message = "This endpoint has been replaced by the OneData catalog") {
  return new CatalogError(410, "gone", message)
}

function badRequest(message: string) {
  return new CatalogError(400, "bad_request", message)
}

function forbidden(message: string) {
  return new CatalogError(403, "forbidden", message)
}

function notFound(message: string) {
  return new CatalogError(404, "not_found", message)
}

function workspaceMissing() {
  return new CatalogError(404, "workspace_not_found", "Workspace not found")
}

function conflict(error: string, message: string) {
  return new CatalogError(409, error, message)
}

function unreachable(message: string) {
  return new CatalogError(422, "path_unreachable", message)
}

function badGateway(message: string) {
  return new CatalogError(502, "probe_proxy_failed", message)
}

export function publicDataRoot() {
  const value = process.env.ONECODE_PUBLIC_DATA_ROOT?.trim()
  return value ? path.resolve(value) : undefined
}

export function normalizeFsPath(input: string) {
  let resolved = path.resolve(input)
  try {
    resolved = realpathSync(resolved)
  } catch {
    // keep resolved path when the target is missing
  }
  let normalized = resolved.replaceAll("\\", "/")
  if (normalized.length > 1 && normalized.endsWith("/")) normalized = normalized.slice(0, -1)
  if (/^[a-zA-Z]:/.test(normalized)) {
    normalized = normalized[0]!.toUpperCase() + normalized.slice(1)
  }
  return normalized
}

function isInsideRoot(root: string, target: string) {
  const a = normalizeFsPath(root)
  const b = normalizeFsPath(target)
  return b === a || b.startsWith(a.endsWith("/") ? a : `${a}/`)
}

function formatHint(uri: string, isDir: boolean) {
  if (isDir) {
    if (uri.endsWith(".zarr") || uri.includes(".zarr/") || looksLikeZarr(uri)) return "zarr"
    return "directory"
  }
  const ext = path.extname(uri).replace(".", "").toLowerCase()
  if (ext) return ext
  return "unknown"
}

function walkDirectory(root: string) {
  let logical = 0
  let count = 0
  const walk = (dir: string, depth: number) => {
    if (count >= DIR_MAX_ENTRIES || depth > DIR_MAX_DEPTH) return
    let entries: Array<{ name: string; isDirectory(): boolean }>
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (count >= DIR_MAX_ENTRIES) return
      const next = path.join(dir, entry.name)
      try {
        if (entry.isDirectory()) {
          walk(next, depth + 1)
          continue
        }
        const st = statSync(next)
        logical += st.size
        count += 1
      } catch {
        continue
      }
    }
  }
  walk(root, 0)
  return { logical_bytes: logical, entry_count: count }
}

function listDirectoryPreview(root: string): DirectoryPreview {
  const entries: DirectoryListingEntry[] = []
  let truncated = false
  let samplePath: string | undefined
  const preferSample = (relative: string) => {
    if (samplePath) return
    const hint = formatHint(relative, false)
    if (isSampleableFormat(hint)) samplePath = relative
  }
  const walk = (dir: string, prefix: string, depth: number) => {
    if (entries.length >= DIR_PREVIEW_LIST_MAX || depth > DIR_MAX_DEPTH) {
      if (entries.length >= DIR_PREVIEW_LIST_MAX) truncated = true
      return
    }
    let names: Array<{ name: string; isDirectory(): boolean }>
    try {
      names = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      return
    }
    for (const entry of names) {
      if (entries.length >= DIR_PREVIEW_LIST_MAX) {
        truncated = true
        return
      }
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      const next = path.join(dir, entry.name)
      try {
        if (entry.isDirectory()) {
          entries.push({ path: `${relative}/`, is_dir: true })
          walk(next, relative, depth + 1)
          continue
        }
        const st = statSync(next)
        entries.push({ path: relative, is_dir: false, size_bytes: st.size })
        preferSample(relative)
      } catch {
        continue
      }
    }
  }
  walk(root, "", 0)
  return { entries, truncated, sample_path: samplePath }
}

async function readSampleFile(filePath: string, format = formatHint(filePath, false)) {
  if (format === "xlsx") return sampleXlsx(filePath, { maxBytes: SAMPLE_MAX })
  if (format === "pdf") return samplePdf(filePath, { maxBytes: SAMPLE_MAX })
  if ((PYTHON_SAMPLE_FORMATS as readonly string[]).includes(format)) {
    return sampleScientificBinary(filePath, format, SAMPLE_MAX)
  }
  return sampleTextFile(filePath, SAMPLE_MAX)
}

function blockedHttpHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "0.0.0.0") return true
  if (host === "metadata.google.internal" || host.endsWith(".internal")) return true
  const parts = host.split(".").map((item) => Number(item))
  if (parts.length === 4 && parts.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
    const [a, b] = parts
    if (a === 127 || a === 10 || a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
  }
  return false
}

function assertHttpProbeUrl(url: URL, kind: "uri" | "redirect") {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw kind === "uri" ? badRequest("Only http(s) URIs are allowed") : forbidden("HTTP probe cannot follow non-http redirects")
  }
  if (blockedHttpHost(url.hostname)) throw forbidden("HTTP probe cannot target loopback, private, or metadata hosts")
}

async function probeHttp(uri: string): Promise<ProbeResult> {
  let current: URL
  try {
    current = new URL(uri)
  } catch {
    throw badRequest("Invalid HTTP URI")
  }
  const requested = current
  assertHttpProbeUrl(current, "uri")
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  try {
    for (let hop = 0; hop <= 5; hop++) {
      const response = await fetch(current, { method: "GET", redirect: "manual", signal: controller.signal })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location")
        await response.body?.cancel().catch(() => undefined)
        if (!location) throw unreachable(`HTTP ${response.status}`)
        if (hop === 5) throw unreachable("Too many HTTP redirects")
        let next: URL
        try {
          next = new URL(location, current)
        } catch {
          throw badRequest("Invalid HTTP redirect")
        }
        assertHttpProbeUrl(next, "redirect")
        current = next
        continue
      }
      if (!response.ok) throw unreachable(`HTTP ${response.status}`)
      const length = Number(response.headers.get("content-length") ?? "")
      await response.body?.cancel().catch(() => undefined)
      return {
        exists: true,
        is_dir: false,
        size_bytes: Number.isFinite(length) && length > 0 ? length : undefined,
        logical_bytes: Number.isFinite(length) && length > 0 ? length : undefined,
        mtime_ms: Date.parse(response.headers.get("last-modified") ?? "") || undefined,
        format_hint: formatHint(requested.pathname, false),
        normalized_uri: requested.toString(),
        connector: "http_dataset",
        workspace_id: "",
      }
    }
    throw unreachable("Too many HTTP redirects")
  } catch (error) {
    if (error instanceof CatalogError) throw error
    throw unreachable(error instanceof Error ? error.message : "HTTP probe failed")
  } finally {
    clearTimeout(timer)
  }
}

function probeLocalPath(uri: string, session: PlatformAuth.AuthSession | undefined, skipAcl: boolean): ProbeResult {
  const normalized = normalizeFsPath(uri)
  // local_fs registration relies on OS permissions of the OneCode process.
  // Account workspace ACL is intentionally not applied (private same-org deploys).
  void session
  if (!existsSync(normalized)) {
    return {
      exists: false,
      is_dir: false,
      format_hint: "unknown",
      normalized_uri: normalized,
      connector: skipAcl ? "object_store" : "local_fs",
      workspace_id: "",
    }
  }
  const st = statSync(normalized)
  const isDir = st.isDirectory()
  const scale = isDir ? walkDirectory(normalized) : { logical_bytes: st.size, entry_count: 1 }
  return {
    exists: true,
    is_dir: isDir,
    size_bytes: st.size,
    logical_bytes: scale.logical_bytes,
    entry_count: scale.entry_count,
    mtime_ms: Math.trunc(st.mtimeMs),
    format_hint: formatHint(normalized, isDir),
    normalized_uri: normalized,
    connector: skipAcl ? "object_store" : "local_fs",
    workspace_id: "",
  }
}

function leafRoot() {
  const raw = process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY?.trim() || process.cwd()
  return normalizeFsPath(raw)
}

export type FsStatResult = {
  exists: boolean
  is_dir: boolean
  size_bytes?: number
  logical_bytes?: number
  entry_count?: number
  mtime_ms?: number
  format_hint: string
  sample?: string
  sample_path?: string
  directory_listing?: DirectoryPreview
  zarr_summary?: ZarrSummary
}

export function leafFsStat(inputPath: string): FsStatResult {
  const root = leafRoot()
  const target = normalizeFsPath(inputPath)
  if (!isInsideRoot(root, target)) throw forbidden("Path is outside the serve working directory")
  if (!existsSync(target)) {
    return { exists: false, is_dir: false, format_hint: "unknown" }
  }
  const st = statSync(target)
  const isDir = st.isDirectory()
  const scale = isDir ? walkDirectory(target) : { logical_bytes: st.size, entry_count: 1 }
  return {
    exists: true,
    is_dir: isDir,
    size_bytes: st.size,
    logical_bytes: scale.logical_bytes,
    entry_count: scale.entry_count,
    mtime_ms: Math.trunc(st.mtimeMs),
    format_hint: formatHint(target, isDir),
  }
}

export async function leafFsSample(inputPath: string) {
  const stat = leafFsStat(inputPath)
  if (!stat.exists) return { ...stat, sample: undefined as string | undefined }
  const root = leafRoot()
  const target = normalizeFsPath(inputPath)
  if (!isInsideRoot(root, target)) return { ...stat, sample: undefined as string | undefined }
  if (stat.format_hint === "zarr" || (stat.is_dir && looksLikeZarr(target))) {
    return { ...stat, format_hint: "zarr", sample: undefined as string | undefined, zarr_summary: summarizeZarr(target) }
  }
  if (stat.is_dir) {
    const listing = listDirectoryPreview(target)
    const sampleFile = listing.sample_path ? path.join(target, listing.sample_path) : undefined
    const sampleHint = listing.sample_path ? formatHint(listing.sample_path, false) : ""
    const sample =
      sampleFile &&
      existsSync(sampleFile) &&
      isSampleableFormat(sampleHint)
        ? await readSampleFile(sampleFile, sampleHint)
        : undefined
    return {
      ...stat,
      directory_listing: listing,
      sample_path: sample ? listing.sample_path : undefined,
      sample,
    }
  }
  if (!isSampleableFormat(stat.format_hint)) {
    return { ...stat, sample: undefined as string | undefined }
  }
  if (!existsSync(target)) return { ...stat, sample: undefined as string | undefined }
  return { ...stat, sample: await readSampleFile(target, stat.format_hint) }
}

async function probeRemoteWorkspace(input: { uri: string; workspaceId: string; accountId: string }): Promise<ProbeResult> {
  const workspace = Database.use((db) => db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, input.workspaceId as never)).get())
  if (!workspace) throw workspaceMissing()
  const extra = parseSshNodeExtra(workspace.extra)
  if (extra?.accountId !== input.accountId) throw forbidden("Workspace is not owned by the current account")
  const adapter = getAdapter(workspace.project_id, workspace.type)
  const info: WorkspaceInfo = {
    id: workspace.id,
    type: workspace.type,
    name: workspace.name,
    directory: workspace.directory ?? undefined,
    extra: workspace.extra,
    projectID: workspace.project_id,
  }
  let target: Awaited<ReturnType<typeof adapter.target>>
  try {
    target = await adapter.target(info, { create: false, reconnect: false })
  } catch {
    throw conflict("workspace_offline", "Remote workspace is not connected")
  }
  if (target.type !== "remote") throw conflict("workspace_offline", "Remote workspace is not connected")
  const url = new URL("/experimental/onescience/fs-stat", target.url)
  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: input.uri }),
    })
  } catch (error) {
    throw badGateway(error instanceof Error ? error.message : "Failed to reach remote workspace")
  }
  if (!response.ok) throw badGateway(`Remote fs-stat failed (${response.status})`)
  const body = (await response.json()) as FsStatResult
  const normalized = input.uri.replaceAll("\\", "/")
  if (!body.exists) {
    return {
      exists: false,
      is_dir: false,
      format_hint: "unknown",
      normalized_uri: normalized,
      connector: "remote_workspace",
      workspace_id: input.workspaceId,
    }
  }
  return {
    exists: true,
    is_dir: Boolean(body.is_dir),
    size_bytes: body.size_bytes,
    logical_bytes: body.logical_bytes,
    entry_count: body.entry_count,
    mtime_ms: body.mtime_ms,
    format_hint: body.format_hint || formatHint(normalized, Boolean(body.is_dir)),
    normalized_uri: normalized,
    connector: "remote_workspace",
    workspace_id: input.workspaceId,
  }
}

async function sampleRemote(input: { uri: string; workspaceId: string; accountId: string }) {
  const workspace = Database.use((db) => db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, input.workspaceId as never)).get())
  if (!workspace) throw workspaceMissing()
  const extra = parseSshNodeExtra(workspace.extra)
  if (extra?.accountId !== input.accountId) throw forbidden("Workspace is not owned by the current account")
  const adapter = getAdapter(workspace.project_id, workspace.type)
  const info: WorkspaceInfo = {
    id: workspace.id,
    type: workspace.type,
    name: workspace.name,
    directory: workspace.directory ?? undefined,
    extra: workspace.extra,
    projectID: workspace.project_id,
  }
  let target: Awaited<ReturnType<typeof adapter.target>>
  try {
    target = await adapter.target(info, { create: false, reconnect: false })
  } catch {
    throw conflict("workspace_offline", "Remote workspace is not connected")
  }
  if (target.type !== "remote") throw conflict("workspace_offline", "Remote workspace is not connected")
  const url = new URL("/experimental/onescience/fs-sample", target.url)
  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: input.uri }),
    })
  } catch (error) {
    throw badGateway(error instanceof Error ? error.message : "Failed to reach remote workspace")
  }
  if (!response.ok) throw badGateway(`Remote fs-sample failed (${response.status})`)
  return (await response.json()) as FsStatResult
}

export async function probe(input: {
  connector: CatalogConnector
  uri: string
  workspace_id?: string
  session?: PlatformAuth.AuthSession
  accountId?: string
}): Promise<ProbeResult> {
  const connector = input.connector
  const workspaceId = input.workspace_id?.trim() ?? ""
  if (connector === "remote_workspace" || workspaceId.startsWith("wrk_")) {
    if (!workspaceId.startsWith("wrk_")) throw badRequest("Remote workspace probe requires a wrk_* workspace_id")
    if (!input.accountId) throw new CatalogError(401, "unauthorized", "Login required")
    const remote = await probeRemoteWorkspace({
      uri: input.uri,
      workspaceId,
      accountId: input.accountId,
    })
    if (!remote.exists) throw unreachable("Path does not exist on the remote workspace")
    return remote
  }
  if (connector === "unbound") throw badRequest("unbound is not a form connector")
  if (connector === "onedata_ref") {
    const already = getAlready(input.uri.replace(/^onedata:\/\//, ""), { publicOnly: true })
    if (!already || already.status !== "ready") throw notFound("Public Already dataset not found")
    return {
      exists: true,
      is_dir: false,
      format_hint: already.format,
      logical_bytes: already.logical_bytes,
      record_count: already.record_count,
      entry_count: already.entry_count,
      normalized_uri: `onedata://${already.id}`,
      connector: "onedata_ref",
      workspace_id: "",
    } as ProbeResult
  }
  if (connector === "database" || /^(postgres|mysql):\/\//i.test(input.uri)) {
    return probeDatabase(input.uri, input.accountId)
  }
  if (connector === "http_dataset" || /^https?:\/\//i.test(input.uri)) {
    return probeHttp(input.uri)
  }
  if (connector === "object_store" || /^(s3|oss|cos):\/\//i.test(input.uri)) {
    if (/^(s3|oss|cos):\/\//i.test(input.uri)) {
      if (!input.accountId) throw new CatalogError(401, "unauthorized", "Login required")
      const remote = await probeObjectUri(input.uri, input.accountId)
      if (!remote.exists) throw unreachable("Object does not exist")
      return {
        ...remote,
        connector: "object_store" as const,
        workspace_id: "",
      }
    }
    const root = publicDataRoot()
    const skipAcl = !!root && isInsideRoot(root, input.uri)
    if (!skipAcl) throw badRequest("Platform bucket is not configured or path is outside ONECODE_PUBLIC_DATA_ROOT")
    const result = probeLocalPath(input.uri, input.session, true)
    if (!result.exists) throw unreachable("Path does not exist on this machine")
    return result
  }
  const result = probeLocalPath(input.uri, input.session, false)
  if (!result.exists) throw unreachable("Path does not exist on this machine")
  return result
}

async function probeDatabase(uri: string, accountId?: string): Promise<ProbeResult> {
  if (!accountId) throw new CatalogError(401, "unauthorized", "Login required")
  const parsed = parseDbTableUri(uri)
  const conn = listDbConnections(accountId).items.find((item) => item.id === parsed.connectionId)
  if (!conn) throw notFound("Database connection not found")
  if (conn.engine !== parsed.engine) throw badRequest("Database URI engine does not match the saved connection")
  const tables = await listDbTables(accountId, parsed.connectionId)
  const found = tables.items.some((item) => {
    if (item.name !== parsed.table) return false
    if (parsed.engine === "mysql") return true
    return item.schema === parsed.schema
  })
  if (!found) throw unreachable("Table does not exist on the database connection")
  const sample = await sampleDbTable(
    accountId,
    parsed.connectionId,
    { schema: parsed.schema, name: parsed.table },
    { limit: 1 },
  )
  return {
    exists: true,
    is_dir: false,
    format_hint: "table",
    entry_count: sample.entry_count,
    normalized_uri: formatDbTableUri(parsed.engine, parsed.connectionId, parsed.schema, parsed.table),
    connector: "database",
    workspace_id: "",
    ...(sample.columns.length ? { columns: sample.columns } : {}),
  }
}

function generateSlug(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 100) || "dataset"
}

function publicIdOf(row: { id: string; public_id?: string | null }) {
  return row.public_id || row.id
}

function fromRawRow(row: typeof OneScienceDataProjectTable.$inferSelect): RawSource {
  return {
    id: publicIdOf(row),
    title: row.title,
    description: row.description,
    domain: normalizeDomain(row.domain),
    uri: row.raw_data_uri,
    format: row.raw_data_format,
    owner: row.owner ?? "",
    workspace_id: row.workspace_id,
    connector: row.connector as CatalogConnector,
    ingest_method: row.ingest_method,
    ...(row.lineage_public_id ? { lineage_public_id: row.lineage_public_id } : {}),
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

function fromAlreadyRow(row: typeof OneScienceDataArtifactTable.$inferSelect): AlreadyDataset {
  const meta = (row.metadata_json && typeof row.metadata_json === "object" ? row.metadata_json : {}) as Record<string, unknown>
  const primitiveId = typeof meta.primitive_id === "string" && meta.primitive_id ? meta.primitive_id : undefined
  const primitiveComplete = meta.primitive_complete === true && !!primitiveId
  return {
    id: publicIdOf(row),
    title: row.title,
    uri: row.uri ?? "",
    format: row.format,
    owner: row.owner ?? "",
    visibility: row.visibility,
    workspace_id: row.workspace_id,
    source_raw_ids: row.source_raw_ids ?? [],
    status: row.status,
    build_method: row.build_method,
    connector: row.connector as CatalogConnector,
    ...(row.logical_bytes == null ? {} : { logical_bytes: row.logical_bytes }),
    ...(row.record_count == null ? {} : { record_count: row.record_count }),
    ...(row.entry_count == null ? {} : { entry_count: row.entry_count }),
    ...(primitiveId ? { primitive_id: primitiveId } : {}),
    primitive_complete: primitiveComplete,
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

function findRawRow(db: Database.TxOrDb, id: string) {
  return db
    .select()
    .from(OneScienceDataProjectTable)
    .where(
      and(
        isNull(OneScienceDataProjectTable.time_deleted),
        or(eq(OneScienceDataProjectTable.public_id, id), eq(OneScienceDataProjectTable.id, id)),
      ),
    )
    .get()
}

function isChipEligibleRaw(
  row: typeof OneScienceDataProjectTable.$inferSelect | undefined,
  accountId: string,
) {
  return !!row && row.owner === accountId && row.connector !== "unbound" && row.ingest_method !== "unbound"
}

function findAlreadyRow(db: Database.TxOrDb, id: string) {
  return db
    .select()
    .from(OneScienceDataArtifactTable)
    .where(
      and(
        isNull(OneScienceDataArtifactTable.time_deleted),
        or(eq(OneScienceDataArtifactTable.public_id, id), eq(OneScienceDataArtifactTable.id, id)),
      ),
    )
    .get()
}

function requireOwner(row: { owner?: string | null }, accountId: string) {
  if (row.owner !== accountId) throw notFound("Not found")
}

function alreadyReady(input: {
  title: string
  logical_bytes?: number | null
  record_count?: number | null
  entry_count?: number | null
  source_raw_ids: string[]
}) {
  const hasScale = (input.logical_bytes ?? 0) > 0 || (input.record_count ?? 0) > 0 || (input.entry_count ?? 0) > 0
  const hasRaw = input.source_raw_ids.some((id) => id.startsWith("raw_") && !id.startsWith("raw_unbound_"))
  return Boolean(input.title.trim() && hasScale && hasRaw)
}

export async function registerRaw(input: {
  accountId: string
  session?: PlatformAuth.AuthSession
  title: string
  description?: string
  domain?: string
  uri: string
  connector: CatalogConnector
  workspace_id?: string
}) {
  if (!input.accountId) throw new CatalogError(401, "unauthorized", "Login required")
  if (input.connector === "unbound") throw badRequest("unbound is not a form connector")
  const probed = await probe({
    connector: input.connector,
    uri: input.uri,
    workspace_id: input.workspace_id,
    session: input.session,
    accountId: input.accountId,
  })
  const now = Date.now()
  const id = Identifier.create("raw", "ascending")
  const domain = normalizeDomain(input.domain)
  const title = input.title.trim()
  const row = {
    id,
    slug: `${generateSlug(title)}-${id.slice(-8)}`,
    title,
    description: input.description?.trim() || "",
    domain,
    status: "draft",
    raw_data_uri: probed.normalized_uri,
    raw_data_format: probed.format_hint || "unknown",
    raw_data_license: null,
    raw_data_metadata_json: {
      logical_bytes: probed.logical_bytes,
      entry_count: probed.entry_count,
      is_dir: probed.is_dir,
      ...(probed.columns?.length ? { columns: probed.columns } : {}),
    } as Record<string, unknown>,
    target_dataset_name: title,
    target_dataset_goal: "unset",
    target_task_type: "unset",
    owner: input.accountId,
    public_id: id,
    workspace_id: probed.workspace_id,
    connector: probed.connector,
    ingest_method: probed.connector === "onedata_ref" ? "onedata_ref" : "onescience",
    lineage_public_id: probed.connector === "onedata_ref" ? probed.normalized_uri.replace(/^onedata:\/\//, "") : null,
    time_created: now,
    time_updated: now,
    time_deleted: null,
  }
  Database.use((db) => db.insert(OneScienceDataProjectTable).values(row).run())
  return fromRawRow(row)
}

export function listRaw(input: { accountId: string; domain?: string; limit?: number; offset?: number }) {
  if (!input.accountId) throw new CatalogError(401, "unauthorized", "Login required")
  const limit = Math.max(1, Math.min(input.limit ?? 24, 100))
  const offset = Math.max(0, input.offset ?? 0)
  const domains = domainFilterValues(input.domain)
  return Database.use((db) => {
    const rows = db
      .select()
      .from(OneScienceDataProjectTable)
      .where(
        and(
          eq(OneScienceDataProjectTable.owner, input.accountId),
          isNull(OneScienceDataProjectTable.time_deleted),
          ne(OneScienceDataProjectTable.ingest_method, "unbound"),
          ne(OneScienceDataProjectTable.connector, "unbound"),
          domains ? or(...domains.map((item) => eq(OneScienceDataProjectTable.domain, item))) : undefined,
        ),
      )
      .orderBy(desc(OneScienceDataProjectTable.time_updated), desc(OneScienceDataProjectTable.id))
      .limit(limit + 1)
      .offset(offset)
      .all()
    return {
      items: rows.slice(0, limit).map(fromRawRow),
      ...(rows.length > limit ? { nextOffset: offset + limit } : {}),
    }
  })
}

export function getRaw(id: string, accountId: string) {
  if (!accountId) throw new CatalogError(401, "unauthorized", "Login required")
  return Database.use((db) => {
    const row = findRawRow(db, id)
    if (!row || row.connector === "unbound" || row.ingest_method === "unbound") throw notFound("Raw source not found")
    requireOwner(row, accountId)
    return fromRawRow(row)
  })
}

export async function patchRaw(input: {
  id: string
  accountId: string
  session?: PlatformAuth.AuthSession
  uri: string
}) {
  const existing = Database.use((db) => {
    const row = findRawRow(db, input.id)
    if (!row) throw notFound("Raw source not found")
    requireOwner(row, input.accountId)
    return row
  })
  const probed = await probe({
    connector: existing.connector as CatalogConnector,
    uri: input.uri,
    workspace_id: existing.workspace_id,
    session: input.session,
    accountId: input.accountId,
  })
  const now = Date.now()
  Database.use((db) => {
    db.update(OneScienceDataProjectTable)
      .set({
        raw_data_uri: probed.normalized_uri,
        raw_data_format: probed.format_hint || existing.raw_data_format,
        workspace_id: probed.workspace_id,
        connector: probed.connector,
        time_updated: now,
      })
      .where(eq(OneScienceDataProjectTable.id, existing.id))
      .run()
  })
  return getRaw(existing.public_id || existing.id, input.accountId)
}

export function deleteRaw(id: string, accountId: string) {
  return Database.transaction((db) => {
    const row = findRawRow(db, id)
    if (!row) throw notFound("Raw source not found")
    requireOwner(row, accountId)
    const publicId = publicIdOf(row)
    const referenced = db
      .select({ id: OneScienceDataArtifactTable.id, source_raw_ids: OneScienceDataArtifactTable.source_raw_ids })
      .from(OneScienceDataArtifactTable)
      .where(and(isNull(OneScienceDataArtifactTable.time_deleted), eq(OneScienceDataArtifactTable.owner, accountId)))
      .all()
      .some((item) => (item.source_raw_ids ?? []).includes(publicId) || (item.source_raw_ids ?? []).includes(row.id))
    if (referenced) throw conflict("conflict", "Raw source is still referenced by an Already dataset")
    const now = Date.now()
    db.update(OneScienceDataProjectTable).set({ time_deleted: now, time_updated: now }).where(eq(OneScienceDataProjectTable.id, row.id)).run()
    return { ok: true }
  })
}

async function materializeDatabaseRaw(
  raw: typeof OneScienceDataProjectTable.$inferSelect,
  accountId: string,
): Promise<ProbeResult> {
  const parsed = parseDbTableUri(raw.raw_data_uri)
  const exported = await exportDbTable(accountId, parsed.connectionId, { schema: parsed.schema, name: parsed.table }, {
    maxRows: DB_EXPORT_MAX_ROWS,
    maxBytes: DB_EXPORT_MAX_BYTES,
  })
  const outDir = path.join(leafRoot(), ".onescience", "db-export")
  mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `${publicIdOf(raw)}.csv`)
  writeFileSync(outPath, exported.csv, "utf8")
  return probe({ connector: "local_fs", uri: outPath, accountId })
}

export async function convertRaw(input: {
  id: string
  accountId: string
  session?: PlatformAuth.AuthSession
}) {
  const raw = Database.use((db) => {
    const row = findRawRow(db, input.id)
    if (!row) throw notFound("Raw source not found")
    requireOwner(row, input.accountId)
    return row
  })
  if (raw.connector === "onedata_ref") {
    throw conflict("conflict", "onedata_ref cannot be converted; pick the public Already dataset instead")
  }
  const probed =
    raw.connector === "database"
      ? await materializeDatabaseRaw(raw, input.accountId)
      : await probe({
          connector: raw.connector as CatalogConnector,
          uri: raw.raw_data_uri,
          workspace_id: raw.workspace_id,
          session: input.session,
          accountId: input.accountId,
        })
  const sourceId = publicIdOf(raw)
  const now = Date.now()
  return Database.transaction((db) => {
    const existing = db
      .select()
      .from(OneScienceDataArtifactTable)
      .where(
        and(
          eq(OneScienceDataArtifactTable.owner, input.accountId),
          eq(OneScienceDataArtifactTable.workspace_id, probed.workspace_id),
          eq(OneScienceDataArtifactTable.uri, probed.normalized_uri),
          isNull(OneScienceDataArtifactTable.time_deleted),
        ),
      )
      .get()
    const sourceIds = existing
      ? Array.from(new Set([...(existing.source_raw_ids ?? []), sourceId]))
      : [sourceId]
    const keepAgent = existing?.build_method === "agent"
    const status = alreadyReady({
      title: raw.title,
      logical_bytes: probed.logical_bytes,
      entry_count: probed.entry_count,
      source_raw_ids: keepAgent ? existing!.source_raw_ids ?? sourceIds : sourceIds,
    })
      ? "ready"
      : "draft"
    if (existing) {
      db.update(OneScienceDataArtifactTable)
        .set({
          title: raw.title,
          format: probed.format_hint || existing.format,
          logical_bytes: probed.logical_bytes ?? null,
          entry_count: probed.entry_count ?? null,
          connector: probed.connector,
          source_raw_ids: keepAgent ? existing.source_raw_ids : sourceIds,
          build_method: keepAgent ? "agent" : "direct",
          status: keepAgent ? existing.status : status,
          time_updated: now,
        })
        .where(eq(OneScienceDataArtifactTable.id, existing.id))
        .run()
      return fromAlreadyRow(findAlreadyRow(db, existing.public_id || existing.id)!)
    }
    const id = Identifier.create("alr", "ascending")
    const row = {
      id,
      project_id: raw.id,
      run_id: null,
      artifact_type: "ai_ready_dataset",
      title: raw.title,
      uri: probed.normalized_uri,
      format: probed.format_hint || raw.raw_data_format || "unknown",
      metadata_json: null,
      version: null,
      quality_score: null,
      public_id: id,
      owner: input.accountId,
      visibility: "private",
      workspace_id: probed.workspace_id,
      source_raw_ids: sourceIds,
      status,
      build_method: "direct",
      connector: probed.connector,
      logical_bytes: probed.logical_bytes ?? null,
      record_count: null,
      entry_count: probed.entry_count ?? null,
      time_created: now,
      time_updated: now,
      time_deleted: null,
    }
    db.insert(OneScienceDataArtifactTable).values(row).run()
    return fromAlreadyRow(row)
  })
}

export function listAlready(input: {
  accountId: string
  scope: "mine" | "public"
  domain?: string
  limit?: number
  offset?: number
}) {
  if (!input.accountId) throw new CatalogError(401, "unauthorized", "Login required")
  const limit = Math.max(1, Math.min(input.limit ?? 24, 100))
  const offset = Math.max(0, input.offset ?? 0)
  const domains = domainFilterValues(input.domain)
  return Database.use((db) => {
    const rows = db
      .select({
        artifact: OneScienceDataArtifactTable,
        domain: OneScienceDataProjectTable.domain,
      })
      .from(OneScienceDataArtifactTable)
      .innerJoin(OneScienceDataProjectTable, eq(OneScienceDataArtifactTable.project_id, OneScienceDataProjectTable.id))
      .where(
        and(
          isNull(OneScienceDataArtifactTable.time_deleted),
          eq(OneScienceDataArtifactTable.artifact_type, "ai_ready_dataset"),
          isNotNull(OneScienceDataArtifactTable.uri),
          ne(OneScienceDataArtifactTable.uri, ""),
          input.scope === "public"
            ? and(eq(OneScienceDataArtifactTable.visibility, "public"), eq(OneScienceDataArtifactTable.status, "ready"))
            : eq(OneScienceDataArtifactTable.owner, input.accountId),
          domains ? or(...domains.map((item) => eq(OneScienceDataProjectTable.domain, item))) : undefined,
        ),
      )
      .orderBy(desc(OneScienceDataArtifactTable.time_updated), desc(OneScienceDataArtifactTable.id))
      .limit(limit + 1)
      .offset(offset)
      .all()
    return {
      items: rows.slice(0, limit).map((row) => fromAlreadyRow(row.artifact)),
      ...(rows.length > limit ? { nextOffset: offset + limit } : {}),
    }
  })
}

export function getAlready(id: string, input?: { accountId?: string; publicOnly?: boolean }) {
  return Database.use((db) => {
    const row = findAlreadyRow(db, id)
    if (!row || !row.uri) throw notFound("Already dataset not found")
    const item = fromAlreadyRow(row)
    if (input?.publicOnly) {
      if (item.visibility !== "public" || item.status !== "ready") throw notFound("Already dataset not found")
      return item
    }
    if (input?.accountId && item.owner !== input.accountId && !(item.visibility === "public" && item.status === "ready")) {
      throw notFound("Already dataset not found")
    }
    return item
  })
}

export async function previewRaw(id: string, accountId: string, session?: PlatformAuth.AuthSession, viewerWorkspaceId?: string) {
  const raw = getRaw(id, accountId)
  if (raw.connector === "onedata_ref") {
    const sourceId = raw.lineage_public_id || raw.uri.replace(/^onedata:\/\//, "")
    return previewAlready(sourceId, accountId, session, viewerWorkspaceId)
  }
  if (raw.connector === "database") {
    const parsed = parseDbTableUri(raw.uri)
    const probed = await probe({
      connector: "database",
      uri: raw.uri,
      workspace_id: raw.workspace_id,
      session,
      accountId,
    })
    const sample = await sampleDbTable(
      accountId,
      parsed.connectionId,
      { schema: parsed.schema, name: parsed.table },
    )
    return {
      ...raw,
      probe: probed,
      table_preview: { columns: sample.columns, rows: sample.rows },
    }
  }
  const probed = await probe({
    connector: raw.connector,
    uri: raw.uri,
    workspace_id: raw.workspace_id,
    session,
    accountId,
  })
  const extras = await previewExtras(probed, accountId)
  return { ...raw, probe: probed, ...extras }
}

export async function previewAlready(id: string, accountId: string, session?: PlatformAuth.AuthSession, viewerWorkspaceId?: string) {
  const already = getAlready(id, { accountId })
  const publicView = already.visibility === "public" && already.status === "ready"
  let connector = already.connector
  let workspaceId = already.workspace_id
  if (publicView) {
    const viewer = viewerWorkspaceId?.trim() ?? ""
    if (viewer) {
      if (!viewer.startsWith("wrk_")) throw badRequest("viewer_workspace_id must be wrk_*")
      connector = "remote_workspace"
      workspaceId = viewer
    } else {
      workspaceId = ""
      if (connector === "remote_workspace") connector = connectorFromArtifact(already.uri, "")
    }
  }
  const probed = await probe({
    connector,
    uri: already.uri,
    workspace_id: workspaceId,
    session,
    accountId,
  })
  const extras = await previewExtras(probed, accountId)
  return { ...already, probe: probed, ...extras }
}

async function previewExtras(probed: ProbeResult, accountId: string) {
  const extras: {
    sample?: string
    sample_path?: string
    directory_listing?: DirectoryPreview
    zarr_summary?: ZarrSummary
    table_preview?: { columns: string[]; rows: Record<string, unknown>[] }
  } = {}
  if (probed.format_hint === "zarr") {
    if (probed.connector === "remote_workspace" && probed.workspace_id.startsWith("wrk_")) {
      const remote = await sampleRemote({ uri: probed.normalized_uri, workspaceId: probed.workspace_id, accountId })
      if (remote.sample) extras.sample = remote.sample
      if (remote.zarr_summary) extras.zarr_summary = remote.zarr_summary
      return extras
    }
    if (/^(s3|oss|cos):\/\//i.test(probed.normalized_uri)) {
      extras.zarr_summary = await summarizeObjectZarr(probed.normalized_uri, accountId)
      return extras
    }
    if (existsSync(probed.normalized_uri)) extras.zarr_summary = summarizeZarr(probed.normalized_uri)
    return extras
  }
  if (!probed.exists) return extras
  if (probed.is_dir) {
    if (probed.connector === "remote_workspace" && probed.workspace_id.startsWith("wrk_")) {
      const remote = await sampleRemote({ uri: probed.normalized_uri, workspaceId: probed.workspace_id, accountId })
      if (remote.directory_listing) extras.directory_listing = remote.directory_listing
      if (remote.sample) extras.sample = remote.sample
      if (remote.sample_path) extras.sample_path = remote.sample_path
      return extras
    }
    if (!existsSync(probed.normalized_uri)) return extras
    const listing = listDirectoryPreview(probed.normalized_uri)
    extras.directory_listing = listing
    if (listing.sample_path) {
      const sampleFile = path.join(probed.normalized_uri, listing.sample_path)
      const hint = formatHint(listing.sample_path, false)
      if (existsSync(sampleFile) && isSampleableFormat(hint)) {
        extras.sample = await readSampleFile(sampleFile, hint)
        extras.sample_path = listing.sample_path
      }
    }
    return extras
  }
  if (!isSampleableFormat(probed.format_hint)) return extras
  if (probed.connector === "remote_workspace" && probed.workspace_id.startsWith("wrk_")) {
    const remote = await sampleRemote({ uri: probed.normalized_uri, workspaceId: probed.workspace_id, accountId })
    if (remote.sample) extras.sample = remote.sample
    return extras
  }
  if (!existsSync(probed.normalized_uri)) return extras
  extras.sample = await readSampleFile(probed.normalized_uri, probed.format_hint)
  return extras
}

function assertSessionOwned(sessionId: string, accountId: string, session?: PlatformAuth.AuthSession) {
  const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, sessionId as never)).get())
  if (!row) throw notFound("Session not found")
  const workspaceId = row.workspace_id
  if (workspaceId && String(workspaceId).startsWith("wrk_")) {
    const workspace = Database.use((db) => db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceId)).get())
    const extra = (workspace?.extra ?? {}) as { accountId?: string }
    if (extra.accountId !== accountId) throw notFound("Session not found")
    return row
  }
  if (!PlatformAuth.canAccessPath(session, row.directory)) throw notFound("Session not found")
  return row
}

export function getChips(sessionId: string, accountId: string, session?: PlatformAuth.AuthSession) {
  assertSessionOwned(sessionId, accountId, session)
  return Database.use((db) => {
    const rows = db
      .select()
      .from(OneScienceDataSessionChipTable)
      .where(and(eq(OneScienceDataSessionChipTable.session_id, sessionId), eq(OneScienceDataSessionChipTable.owner, accountId)))
      .all()
    const valid: string[] = []
    const orphans: string[] = []
    for (const chip of rows) {
      const row = findRawRow(db, chip.raw_id)
      if (!isChipEligibleRaw(row, accountId)) {
        orphans.push(chip.raw_id)
        continue
      }
      valid.push(publicIdOf(row!))
    }
    if (orphans.length > 0) {
      db.delete(OneScienceDataSessionChipTable)
        .where(
          and(
            eq(OneScienceDataSessionChipTable.session_id, sessionId),
            eq(OneScienceDataSessionChipTable.owner, accountId),
            inArray(OneScienceDataSessionChipTable.raw_id, orphans),
          ),
        )
        .run()
    }
    return { raw_ids: valid }
  })
}

export function putChips(input: {
  sessionId: string
  accountId: string
  raw_ids: string[]
  session?: PlatformAuth.AuthSession
}) {
  assertSessionOwned(input.sessionId, input.accountId, input.session)
  const unique = Array.from(new Set(input.raw_ids.map((item) => item.trim()).filter(Boolean)))
  Database.transaction((db) => {
    for (const rawId of unique) {
      const row = findRawRow(db, rawId)
      if (!isChipEligibleRaw(row, input.accountId)) {
        throw forbidden(`Chip must be an owned raw source (${rawId})`)
      }
    }
    db.delete(OneScienceDataSessionChipTable)
      .where(
        and(eq(OneScienceDataSessionChipTable.session_id, input.sessionId), eq(OneScienceDataSessionChipTable.owner, input.accountId)),
      )
      .run()
    const now = Date.now()
    for (const rawId of unique) {
      const row = findRawRow(db, rawId)!
      db.insert(OneScienceDataSessionChipTable)
        .values({
          session_id: input.sessionId,
          raw_id: publicIdOf(row),
          owner: input.accountId,
          time_created: now,
          time_updated: now,
        })
        .run()
    }
  })
  return getChips(input.sessionId, input.accountId, input.session)
}

export function listLegacyProjects(input: { accountId: string; domain?: string; limit?: number; offset?: number }) {
  if (!input.accountId) throw new CatalogError(401, "unauthorized", "Login required")
  const result = listRaw(input)
  return {
    items: result.items.map((item) => ({
      id: item.id,
      slug: item.id,
      title: item.title,
      description: item.description,
      domain: item.domain,
      status: "draft",
      rawDataUri: item.uri,
      rawDataFormat: item.format,
      owner: item.owner,
      timeCreated: item.time_created,
      timeUpdated: item.time_updated,
    })),
    nextOffset: result.nextOffset,
  }
}

export function getLegacyProject(id: string, accountId: string) {
  const raw = getRaw(id, accountId)
  return {
    project: {
      id: raw.id,
      slug: raw.id,
      title: raw.title,
      description: raw.description,
      domain: raw.domain,
      status: "draft",
      rawDataUri: raw.uri,
      rawDataFormat: raw.format,
      owner: raw.owner,
      timeCreated: raw.time_created,
      timeUpdated: raw.time_updated,
    },
    runs: [],
    artifacts: [],
    qualityReports: [],
    releases: [],
  }
}

export type IngestReport = {
  name: string
  artifact_uri: string
  format?: string
  size_bytes?: number
  record_count?: number
  notes?: string
}

function connectorFromArtifact(uri: string, workspaceId: string): CatalogConnector {
  if (/^https?:\/\//i.test(uri)) return "http_dataset"
  if (/^(s3|oss|cos):\/\//i.test(uri)) return "object_store"
  if (workspaceId.startsWith("wrk_")) return "remote_workspace"
  return "local_fs"
}

function resolveArtifactUri(uri: string, sessionDirectory?: string) {
  const trimmed = uri.trim()
  if (!trimmed) throw badRequest("artifact_uri is required")
  if (/^(https?|s3|oss|cos|onedata):\/\//i.test(trimmed)) return trimmed
  if (path.isAbsolute(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed)) return normalizeFsPath(trimmed)
  if (!sessionDirectory) throw badRequest("Relative artifact_uri requires a session working directory")
  return normalizeFsPath(path.resolve(sessionDirectory, trimmed))
}

function contentHash(text: string) {
  return createHash("sha256").update(text).digest("hex")
}

function ensureUnboundRaw(accountId: string) {
  const id = `raw_unbound_${accountId}`
  return Database.use((db) => {
    const existing = findRawRow(db, id)
    if (existing && !existing.time_deleted) return publicIdOf(existing)
    const now = Date.now()
    const slug = `unbound-${accountId.replace(/[^a-zA-Z0-9._-]+/g, "-")}`.slice(0, 100)
    if (existing) {
      db.update(OneScienceDataProjectTable)
        .set({ time_deleted: null, time_updated: now })
        .where(eq(OneScienceDataProjectTable.id, existing.id))
        .run()
      return publicIdOf(existing)
    }
    db.insert(OneScienceDataProjectTable)
      .values({
        id,
        slug,
        title: "(unbound)",
        description: "",
        domain: "unspecified",
        status: "draft",
        raw_data_uri: `unbound://${accountId}`,
        raw_data_format: "none",
        raw_data_license: null,
        raw_data_metadata_json: null,
        target_dataset_name: "(unbound)",
        target_dataset_goal: "unset",
        target_task_type: "unset",
        owner: accountId,
        public_id: id,
        workspace_id: "",
        connector: "unbound",
        ingest_method: "unbound",
        lineage_public_id: null,
        time_created: now,
        time_updated: now,
        time_deleted: null,
      })
      .run()
    return id
  })
}

function ownedRawIds(accountId: string, ids: string[]) {
  const unique = Array.from(new Set(ids.map((item) => item.trim()).filter(Boolean)))
  return Database.use((db) => {
    const resolved: string[] = []
    for (const id of unique) {
      const row = findRawRow(db, id)
      if (!row || row.owner !== accountId || row.connector === "unbound" || row.ingest_method === "unbound") {
        throw forbidden("CLI --raw must list owned raw sources")
      }
      resolved.push(publicIdOf(row))
    }
    return resolved
  })
}

function writeSessionMeta(sessionId: string, owner: string, hash: string) {
  const now = Date.now()
  Database.use((db) => {
    const existing = db.select().from(OneScienceDataSessionMetaTable).where(eq(OneScienceDataSessionMetaTable.session_id, sessionId)).get()
    if (existing) {
      db.update(OneScienceDataSessionMetaTable)
        .set({ owner, last_already_json_hash: hash, last_ingest_at: now, time_updated: now })
        .where(eq(OneScienceDataSessionMetaTable.session_id, sessionId))
        .run()
      return
    }
    db.insert(OneScienceDataSessionMetaTable)
      .values({
        session_id: sessionId,
        owner,
        last_already_json_hash: hash,
        last_ingest_at: now,
        time_created: now,
        time_updated: now,
      })
      .run()
  })
}

export async function ingestAlready(input: {
  accountId: string
  session?: PlatformAuth.AuthSession
  sessionId?: string
  workspaceId?: string
  rawIds?: string[]
  report: IngestReport
  viaToken?: boolean
  tokenWorkspaceId?: string
}) {
  if (!input.accountId) throw new CatalogError(401, "unauthorized", "Login required")
  const workspaceId = input.workspaceId?.trim() ?? ""
  if (input.viaToken) {
    if (!input.tokenWorkspaceId?.startsWith("wrk_") || workspaceId !== input.tokenWorkspaceId) {
      throw forbidden("Catalog token workspace mismatch")
    }
  } else if (workspaceId.startsWith("wrk_")) {
    const workspace = Database.use((db) => db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, workspaceId as never)).get())
    if (!workspace) throw workspaceMissing()
    const extra = parseSshNodeExtra(workspace.extra)
    if (extra?.accountId !== input.accountId) throw forbidden("Workspace is not owned by the current account")
  } else if (workspaceId) {
    throw badRequest("workspace_id must be wrk_* or empty")
  }

  const sessionId = input.sessionId?.trim()
  const listedRaw = input.rawIds?.filter(Boolean) ?? []
  if (!sessionId && listedRaw.length === 0) throw badRequest("Ingest requires session_id or a --raw list")

  let sessionDirectory: string | undefined
  if (sessionId) {
    const session = assertSessionOwned(sessionId, input.accountId, input.session)
    const sessionWorkspace = session.workspace_id ? String(session.workspace_id) : ""
    if (sessionWorkspace !== workspaceId) throw forbidden("Session workspace does not match ingest workspace_id")
    sessionDirectory = session.directory
  }

  const name = input.report.name.trim()
  if (!name) throw badRequest("Ingest report name is required")
  const uri = resolveArtifactUri(input.report.artifact_uri, sessionDirectory)
  const connector = connectorFromArtifact(uri, workspaceId)
  const probed = await probe({
    connector,
    uri,
    workspace_id: workspaceId,
    session: input.session,
    accountId: input.accountId,
  })

  let sourceRawIds: string[]
  if (sessionId) {
    const chips = getChips(sessionId, input.accountId, input.session).raw_ids
    sourceRawIds = chips
  } else {
    sourceRawIds = ownedRawIds(input.accountId, listedRaw)
  }

  const unboundId = ensureUnboundRaw(input.accountId)
  const now = Date.now()
  const result = Database.transaction((db) => {
    const existing = db
      .select()
      .from(OneScienceDataArtifactTable)
      .where(
        and(
          eq(OneScienceDataArtifactTable.owner, input.accountId),
          eq(OneScienceDataArtifactTable.workspace_id, probed.workspace_id),
          eq(OneScienceDataArtifactTable.uri, probed.normalized_uri),
          isNull(OneScienceDataArtifactTable.time_deleted),
        ),
      )
      .get()
    const previous = existing?.source_raw_ids ?? []
    const merged = sessionId
      ? Array.from(new Set([...previous, ...sourceRawIds]))
      : sourceRawIds
    const effective = merged.filter((id) => !id.startsWith("raw_unbound_"))
    const finalSources = effective.length > 0 ? effective : [unboundId]
    const recordCount = input.report.record_count ?? existing?.record_count ?? null
    const status = alreadyReady({
      title: name,
      logical_bytes: probed.logical_bytes ?? input.report.size_bytes,
      record_count: recordCount,
      entry_count: probed.entry_count,
      source_raw_ids: finalSources,
    })
      ? "ready"
      : "draft"
    const firstRaw = findRawRow(db, finalSources[0]!)
    if (!firstRaw) throw notFound("Raw source not found")
    if (existing) {
      db.update(OneScienceDataArtifactTable)
        .set({
          title: name,
          format: input.report.format || probed.format_hint || existing.format,
          logical_bytes: probed.logical_bytes ?? input.report.size_bytes ?? existing.logical_bytes,
          record_count: recordCount,
          entry_count: probed.entry_count ?? existing.entry_count,
          connector: probed.connector,
          source_raw_ids: finalSources,
          build_method: "agent",
          status,
          time_updated: now,
        })
        .where(eq(OneScienceDataArtifactTable.id, existing.id))
        .run()
      return fromAlreadyRow(findAlreadyRow(db, existing.public_id || existing.id)!)
    }
    const id = Identifier.create("alr", "ascending")
    const row = {
      id,
      project_id: firstRaw.id,
      run_id: null,
      artifact_type: "ai_ready_dataset",
      title: name,
      uri: probed.normalized_uri,
      format: input.report.format || probed.format_hint || "unknown",
      metadata_json: input.report.notes ? { notes: input.report.notes } : null,
      version: null,
      quality_score: null,
      public_id: id,
      owner: input.accountId,
      visibility: "private",
      workspace_id: probed.workspace_id,
      source_raw_ids: finalSources,
      status,
      build_method: "agent",
      connector: probed.connector,
      logical_bytes: probed.logical_bytes ?? input.report.size_bytes ?? null,
      record_count: recordCount,
      entry_count: probed.entry_count ?? null,
      time_created: now,
      time_updated: now,
      time_deleted: null,
    }
    db.insert(OneScienceDataArtifactTable).values(row).run()
    return fromAlreadyRow(row)
  })
  if (sessionId) writeSessionMeta(sessionId, input.accountId, contentHash(JSON.stringify(input.report)))
  return result
}

export function patchAlready(input: { id: string; accountId: string; source_raw_ids: string[] }) {
  return Database.transaction((db) => {
    const row = findAlreadyRow(db, input.id)
    if (!row) throw notFound("Already dataset not found")
    requireOwner(row, input.accountId)
    const sourceIds = ownedRawIds(input.accountId, input.source_raw_ids)
    const status = alreadyReady({
      title: row.title,
      logical_bytes: row.logical_bytes,
      record_count: row.record_count,
      entry_count: row.entry_count,
      source_raw_ids: sourceIds,
    })
      ? "ready"
      : "draft"
    const now = Date.now()
    db.update(OneScienceDataArtifactTable)
      .set({ source_raw_ids: sourceIds, status, time_updated: now })
      .where(eq(OneScienceDataArtifactTable.id, row.id))
      .run()
    return fromAlreadyRow(findAlreadyRow(db, row.public_id || row.id)!)
  })
}

function canPublishConnector(already: AlreadyDataset) {
  // Owner chooses to publish. Local workspace paths and http datasets are allowed.
  // Remote SSH paths, object-store URIs, database table URIs, and onedata_ref pullbacks stay blocked —
  // others cannot reliably fetch those without shared credentials / leaf access.
  if (already.connector === "database") return false
  if (already.connector === "http_dataset" || already.connector === "local_fs") return true
  if (/^(s3|oss|cos):\/\//i.test(already.uri)) return false
  return false
}

export async function publishAlready(id: string, accountId: string, session?: PlatformAuth.AuthSession) {
  const already = Database.use((db) => {
    const row = findAlreadyRow(db, id)
    if (!row) throw notFound("Already dataset not found")
    requireOwner(row, accountId)
    return fromAlreadyRow(row)
  })
  if (already.status !== "ready") throw conflict("conflict", "Only ready Already datasets can be published")
  if (!canPublishConnector(already)) {
    throw forbidden(
      "This dataset cannot be published (remote workspace, object store, database, or onedata_ref). Convert database sources first, or use a workspace path / http dataset.",
    )
  }
  if (already.connector === "http_dataset") {
    await probe({ connector: "http_dataset", uri: already.uri, accountId, session })
  }
  const now = Date.now()
  Database.use((db) => {
    db.update(OneScienceDataArtifactTable)
      .set({ visibility: "public", time_updated: now })
      .where(or(eq(OneScienceDataArtifactTable.public_id, already.id), eq(OneScienceDataArtifactTable.id, already.id)))
      .run()
  })
  upsertAlreadyPlatformResource(already, accountId)
  return getAlready(already.id, { accountId })
}

function upsertAlreadyPlatformResource(already: AlreadyDataset, accountId: string) {
  const title = already.title.slice(0, 64)
  const copy = already.uri.slice(0, 120)
  const size = already.logical_bytes ? String(already.logical_bytes) : "unknown"
  const format = already.format.slice(0, 48)
  const now = Date.now()
  const existing = Database.use((db) =>
    db
      .select()
      .from(OneScienceResourceTable)
      .where(
        and(
          eq(OneScienceResourceTable.page, "datasets"),
          eq(OneScienceResourceTable.owner, accountId),
          isNull(OneScienceResourceTable.time_deleted),
        ),
      )
      .all()
      .filter((row) => row.metadata?.already_id === already.id),
  )
  if (existing.length > 0) {
    Database.use((db) => {
      const [keep, ...dupes] = existing
      db.update(OneScienceResourceTable)
        .set({ title, copy, size, format, metadata: { already_id: already.id }, time_updated: now })
        .where(eq(OneScienceResourceTable.id, keep!.id))
        .run()
      for (const extra of dupes) {
        db.update(OneScienceResourceTable)
          .set({ time_deleted: now, time_updated: now })
          .where(eq(OneScienceResourceTable.id, extra.id))
          .run()
      }
    })
    return
  }
  const resource = OneScienceResource.create(
    {
      page: "datasets",
      title,
      copy,
      domain: "其它",
      tags: ["already"],
      provider: "onedata",
      size,
      format,
      source: "local",
    },
    accountId,
  )
  Database.use((db) => {
    db.update(OneScienceResourceTable)
      .set({ metadata: { already_id: already.id } })
      .where(eq(OneScienceResourceTable.id, resource.id))
      .run()
  })
}

function softDeleteAlreadyPlatformResources(alreadyId: string, accountId: string, now = Date.now()) {
  Database.use((db) => {
    const resources = db
      .select()
      .from(OneScienceResourceTable)
      .where(
        and(
          eq(OneScienceResourceTable.page, "datasets"),
          eq(OneScienceResourceTable.owner, accountId),
          isNull(OneScienceResourceTable.time_deleted),
        ),
      )
      .all()
      .filter((row) => row.metadata?.already_id === alreadyId)
    for (const resource of resources) {
      db.update(OneScienceResourceTable)
        .set({ time_deleted: now, time_updated: now })
        .where(eq(OneScienceResourceTable.id, resource.id))
        .run()
    }
  })
}

export function unpublishAlready(id: string, accountId: string) {
  const already = Database.use((db) => {
    const row = findAlreadyRow(db, id)
    if (!row) throw notFound("Already dataset not found")
    requireOwner(row, accountId)
    const now = Date.now()
    db.update(OneScienceDataArtifactTable)
      .set({ visibility: "private", time_updated: now })
      .where(eq(OneScienceDataArtifactTable.id, row.id))
      .run()
    return fromAlreadyRow(findAlreadyRow(db, row.public_id || row.id)!)
  })
  softDeleteAlreadyPlatformResources(already.id, accountId)
  return already
}

export async function reingestAlready(id: string, accountId: string, session?: PlatformAuth.AuthSession) {
  const already = getAlready(id, { publicOnly: true })
  return registerRaw({
    accountId,
    session,
    title: already.title,
    uri: `onedata://${already.id}`,
    connector: "onedata_ref",
    workspace_id: "",
  })
}

export function deleteAlready(id: string, accountId: string) {
  const already = Database.use((db) => {
    const row = findAlreadyRow(db, id)
    if (!row) throw notFound("Already dataset not found")
    requireOwner(row, accountId)
    const item = fromAlreadyRow(row)
    const now = Date.now()
    db.update(OneScienceDataArtifactTable).set({ time_deleted: now, time_updated: now }).where(eq(OneScienceDataArtifactTable.id, row.id)).run()
    return item
  })
  softDeleteAlreadyPlatformResources(already.id, accountId)
  return { ok: true }
}

export async function startTraining(input: {
  id: string
  accountId: string
  session?: PlatformAuth.AuthSession
  target: "local" | "workspace" | "shared_root"
  workspace_id?: string
  trainingConfigJson?: Record<string, unknown>
}) {
  const row = Database.use((db) => {
    const found = findAlreadyRow(db, input.id)
    if (!found) throw notFound("Already dataset not found")
    const item = fromAlreadyRow(found)
    if (item.owner !== input.accountId && !(item.visibility === "public" && item.status === "ready")) {
      throw notFound("Already dataset not found")
    }
    if (item.status !== "ready") throw conflict("conflict", "Only ready Already datasets can be used for training")
    return found
  })
  const already = fromAlreadyRow(row)
  if (input.target === "workspace") {
    const workspaceId = input.workspace_id?.trim() ?? ""
    if (!workspaceId.startsWith("wrk_")) throw badRequest("Training target workspace must be wrk_*")
    await probe({
      connector: "remote_workspace",
      uri: already.uri,
      workspace_id: workspaceId,
      session: input.session,
      accountId: input.accountId,
    })
  } else if (input.target === "shared_root") {
    const root = publicDataRoot()
    if (!root || !isInsideRoot(root, already.uri)) throw unreachable("Job target does not have the shared platform root")
    await probe({ connector: "object_store", uri: already.uri, session: input.session, accountId: input.accountId })
  } else if (already.connector === "http_dataset") {
    await probe({ connector: "http_dataset", uri: already.uri, session: input.session, accountId: input.accountId })
  } else {
    await probe({ connector: "local_fs", uri: already.uri, session: input.session, accountId: input.accountId })
  }
  return createTrainingHandoff(row.project_id, row.id, input.trainingConfigJson ?? { alreadyId: already.id, target: input.target })
}

function collectDatasetRefIds(value: unknown, into: string[] = []) {
  if (!value) return into
  if (Array.isArray(value)) {
    for (const item of value) collectDatasetRefIds(item, into)
    return into
  }
  if (typeof value !== "object") return into
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "datasetRefs" || key === "alreadyIds") {
      if (typeof child === "string") into.push(...child.split(/[,\s]+/).filter(Boolean))
      else if (Array.isArray(child)) {
        for (const item of child) if (typeof item === "string" && item.trim()) into.push(item.trim())
      }
      continue
    }
    collectDatasetRefIds(child, into)
  }
  return into
}

export function assertAlreadyDatasetRefs(value: unknown, accountId?: string) {
  const ids = Array.from(new Set(collectDatasetRefIds(value)))
  for (const id of ids) {
    if (!id.startsWith("alr_")) throw new Error("datasetRefs must be ready Already ids (alr_)")
    const row = Database.use((db) => findAlreadyRow(db, id))
    if (!row || row.status !== "ready") throw new Error("datasetRefs must be ready Already ids (alr_)")
    const owned = !!accountId && row.owner === accountId
    const published = row.visibility === "public"
    if (!owned && !published) throw new Error("datasetRefs cannot use another account's unpublished Already")
  }
}

export { deleteAccountCatalog } from "./data-catalog-account"
export { putObjectStoreKey, listObjectStoreKeys, deleteObjectStoreKey } from "./object-store-key"
export { putDbConnection, listDbConnections, deleteDbConnection, listDbTables } from "./db-connection"
export { bindAlreadyPrimitive } from "./already-primitive"

export { gone as catalogGone }

export * as DataCatalog from "./data-catalog"
