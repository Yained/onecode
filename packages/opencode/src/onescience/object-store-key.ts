import { createHmac, createHash } from "crypto"
import { Database } from "@/storage/db"
import { Identifier } from "@/id/id"
import { and, eq, isNull } from "drizzle-orm"
import { OneScienceObjectStoreKeyTable } from "./data-project.sql"
import { CatalogError, catalogBadRequest, catalogForbidden, catalogUnavailable, catalogUnreachable } from "./catalog-error"
import { decryptSecret, encryptSecret, isSecretMasterKeyAvailable, requireSecretMasterKey } from "./catalog-secret"
import { parseZarray, type ZarrSummary } from "./zarr-summary"

export type ObjectStoreProvider = "s3" | "oss" | "cos"

export type ObjectStoreKeyPublic = {
  id: string
  provider: ObjectStoreProvider
  endpoint?: string
  region?: string
  label?: string
  access_key_id_suffix: string
  time_created: number
  time_updated: number
}

export type ObjectStoreProbe = {
  exists: boolean
  is_dir: boolean
  size_bytes?: number
  logical_bytes?: number
  entry_count?: number
  mtime_ms?: number
  format_hint: string
  normalized_uri: string
}

type StoredKey = {
  provider: ObjectStoreProvider
  endpoint?: string | null
  region?: string | null
  access_key_id: string
  secret: string
}

const PROVIDERS: ObjectStoreProvider[] = ["s3", "oss", "cos"]
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

function suffix(accessKeyId: string) {
  const value = accessKeyId.trim()
  return value.slice(-4)
}

function blockedHost(hostname: string) {
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

function asProvider(value: string): ObjectStoreProvider {
  const provider = value.trim().toLowerCase()
  if (provider === "s3" || provider === "oss" || provider === "cos") return provider
  throw catalogBadRequest("provider must be s3, oss, or cos")
}

function toPublic(row: typeof OneScienceObjectStoreKeyTable.$inferSelect): ObjectStoreKeyPublic {
  return {
    id: row.id,
    provider: row.provider as ObjectStoreProvider,
    ...(row.endpoint ? { endpoint: row.endpoint } : {}),
    ...(row.region ? { region: row.region } : {}),
    ...(row.label ? { label: row.label } : {}),
    access_key_id_suffix: suffix(row.access_key_id),
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

export function parseObjectUri(uri: string) {
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    throw catalogBadRequest("Invalid object store URI")
  }
  const provider = parsed.protocol.replace(":", "").toLowerCase()
  if (provider !== "s3" && provider !== "oss" && provider !== "cos") {
    throw catalogBadRequest("Object store URI must use s3://, oss://, or cos://")
  }
  const bucket = parsed.hostname.trim()
  const key = decodeURIComponent(parsed.pathname.replace(/^\//, "")).replace(/\/+$/, "")
  if (!bucket) throw catalogBadRequest("Object store URI is missing a bucket")
  return { provider: provider as ObjectStoreProvider, bucket, key, normalized: `${provider}://${bucket}${key ? `/${key}` : ""}` }
}

function loadAliveKey(accountId: string, provider: ObjectStoreProvider) {
  requireSecretMasterKey()
  const row = Database.use((db) =>
    db
      .select()
      .from(OneScienceObjectStoreKeyTable)
      .where(
        and(
          eq(OneScienceObjectStoreKeyTable.account_id, accountId),
          eq(OneScienceObjectStoreKeyTable.provider, provider),
          isNull(OneScienceObjectStoreKeyTable.time_deleted),
        ),
      )
      .get(),
  )
  if (!row) throw catalogBadRequest(`No ${provider} object store key saved for this account`)
  return {
    provider,
    endpoint: row.endpoint,
    region: row.region,
    access_key_id: row.access_key_id,
    secret: decryptSecret(row.secret_ciphertext),
  } satisfies StoredKey
}

export function putObjectStoreKey(input: {
  accountId: string
  provider: string
  access_key_id: string
  secret: string
  endpoint?: string
  region?: string
  label?: string
}) {
  const provider = asProvider(input.provider)
  const accessKeyId = input.access_key_id.trim()
  const secret = input.secret.trim()
  if (!accessKeyId || !secret) throw catalogBadRequest("access_key_id and secret are required")
  const endpoint = input.endpoint?.trim() || ""
  if ((provider === "oss" || provider === "cos") && !endpoint) {
    throw catalogBadRequest(`${provider} requires endpoint`)
  }
  if (endpoint) {
    const host = endpoint.replace(/^https?:\/\//i, "").split("/")[0]!.split(":")[0]!
    if (blockedHost(host)) throw catalogForbidden("Object store endpoint cannot target loopback, private, or metadata hosts")
  }
  const now = Date.now()
  const ciphertext = encryptSecret(secret)
  return Database.transaction((db) => {
    const existing = db
      .select()
      .from(OneScienceObjectStoreKeyTable)
      .where(
        and(
          eq(OneScienceObjectStoreKeyTable.account_id, input.accountId),
          eq(OneScienceObjectStoreKeyTable.provider, provider),
          isNull(OneScienceObjectStoreKeyTable.time_deleted),
        ),
      )
      .get()
    if (existing) {
      db.update(OneScienceObjectStoreKeyTable)
        .set({
          endpoint: endpoint || null,
          region: input.region?.trim() || null,
          label: input.label?.trim() || null,
          access_key_id: accessKeyId,
          secret_ciphertext: ciphertext,
          time_updated: now,
        })
        .where(eq(OneScienceObjectStoreKeyTable.id, existing.id))
        .run()
      return toPublic({ ...existing, endpoint: endpoint || null, region: input.region?.trim() || null, label: input.label?.trim() || null, access_key_id: accessKeyId, secret_ciphertext: ciphertext, time_updated: now })
    }
    const row = {
      id: Identifier.create("osk", "ascending"),
      account_id: input.accountId,
      provider,
      endpoint: endpoint || null,
      region: input.region?.trim() || null,
      label: input.label?.trim() || null,
      access_key_id: accessKeyId,
      secret_ciphertext: ciphertext,
      time_created: now,
      time_updated: now,
      time_deleted: null,
    }
    db.insert(OneScienceObjectStoreKeyTable).values(row).run()
    return toPublic(row)
  })
}

export function listObjectStoreKeys(accountId: string) {
  if (!isSecretMasterKeyAvailable()) return { items: [] as ObjectStoreKeyPublic[], configured: false as const }
  const rows = Database.use((db) =>
    db
      .select()
      .from(OneScienceObjectStoreKeyTable)
      .where(and(eq(OneScienceObjectStoreKeyTable.account_id, accountId), isNull(OneScienceObjectStoreKeyTable.time_deleted)))
      .all(),
  )
  return { items: rows.map(toPublic), configured: true as const }
}

export function deleteObjectStoreKey(accountId: string, providerInput: string) {
  requireSecretMasterKey()
  const provider = asProvider(providerInput)
  Database.use((db) => {
    db.delete(OneScienceObjectStoreKeyTable)
      .where(
        and(eq(OneScienceObjectStoreKeyTable.account_id, accountId), eq(OneScienceObjectStoreKeyTable.provider, provider)),
      )
      .run()
  })
  return { ok: true as const }
}

export function deleteAccountObjectStoreKeys(accountId: string) {
  Database.use((db) => {
    db.delete(OneScienceObjectStoreKeyTable).where(eq(OneScienceObjectStoreKeyTable.account_id, accountId)).run()
  })
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest()
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function signingKey(secret: string, date: string, region: string) {
  const kDate = hmac(`AWS4${secret}`, date)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, "s3")
  return hmac(kService, "aws4_request")
}

function encodePath(pathname: string) {
  return pathname
    .split("/")
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/")
}

function objectUrl(input: { key: StoredKey; bucket: string; objectKey: string; query?: string }) {
  const region = input.key.region?.trim() || "us-east-1"
  const custom = input.key.endpoint?.trim()
  if (custom) {
    const origin = /^https?:\/\//i.test(custom) ? custom.replace(/\/+$/, "") : `https://${custom.replace(/\/+$/, "")}`
    const url = new URL(`${origin}/${input.bucket}${input.objectKey ? `/${input.objectKey}` : ""}`)
    if (input.query) url.search = input.query.startsWith("?") ? input.query : `?${input.query}`
    return url
  }
  const url = new URL(`https://${input.bucket}.s3.${region}.amazonaws.com/${input.objectKey}`)
  if (input.query) url.search = input.query.startsWith("?") ? input.query : `?${input.query}`
  return url
}

async function signedRequest(input: {
  key: StoredKey
  method: "HEAD" | "GET"
  url: URL
}) {
  if (blockedHost(input.url.hostname)) {
    throw new CatalogError(403, "forbidden", "Object store endpoint cannot target loopback, private, or metadata hosts")
  }
  const region = input.key.region?.trim() || "us-east-1"
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "")
  const dateStamp = amzDate.slice(0, 8)
  const canonicalUri = encodePath(input.url.pathname || "/")
  const queryPairs = [...input.url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b))
  const canonicalQuery = queryPairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")
  const payloadHash = EMPTY_SHA256
  const headers: Record<string, string> = {
    host: input.url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  }
  const signedHeaderNames = Object.keys(headers).sort()
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join("")
  const signedHeaders = signedHeaderNames.join(";")
  const canonical = `${input.method}\n${canonicalUri}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`
  const scope = `${dateStamp}/${region}/s3/aws4_request`
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonical)}`
  const signature = createHmac("sha256", signingKey(input.key.secret, dateStamp, region)).update(stringToSign, "utf8").digest("hex")
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.key.access_key_id}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  try {
    return await fetch(input.url, { method: input.method, headers, signal: controller.signal, redirect: "follow" })
  } catch (error) {
    if (error instanceof CatalogError) throw error
    throw catalogUnreachable(error instanceof Error ? error.message : "Object store request failed")
  } finally {
    clearTimeout(timer)
  }
}

function formatHintFromKey(objectKey: string, isDir: boolean) {
  const normalized = objectKey.replaceAll("\\", "/")
  if (isDir || normalized.endsWith(".zarr") || normalized.includes(".zarr/")) {
    if (normalized.endsWith(".zarr") || normalized.includes(".zarr/")) return "zarr"
    return isDir ? "directory" : "unknown"
  }
  const base = normalized.split("/").pop() ?? ""
  const dot = base.lastIndexOf(".")
  if (dot > 0) return base.slice(dot + 1).toLowerCase()
  return "unknown"
}

export async function probeObjectUri(uri: string, accountId: string): Promise<ObjectStoreProbe> {
  if (!accountId) throw new CatalogError(401, "unauthorized", "Login required")
  const parsed = parseObjectUri(uri)
  const key = loadAliveKey(accountId, parsed.provider)
  const headUrl = objectUrl({ key, bucket: parsed.bucket, objectKey: parsed.key })
  const head = await signedRequest({ key, method: "HEAD", url: headUrl })
  if (head.status >= 200 && head.status < 300) {
    const length = Number(head.headers.get("content-length") ?? "")
    const mtime = Date.parse(head.headers.get("last-modified") ?? "")
    return {
      exists: true,
      is_dir: false,
      ...(Number.isFinite(length) && length > 0 ? { size_bytes: length, logical_bytes: length, entry_count: 1 } : {}),
      ...(Number.isFinite(mtime) ? { mtime_ms: mtime } : {}),
      format_hint: formatHintFromKey(parsed.key, false),
      normalized_uri: parsed.normalized,
    }
  }
  const prefix = parsed.key ? `${parsed.key.replace(/\/+$/, "")}/` : ""
  const listUrl = objectUrl({
    key,
    bucket: parsed.bucket,
    objectKey: "",
    query: `list-type=2&max-keys=8&prefix=${encodeURIComponent(prefix || parsed.key)}`,
  })
  const list = await signedRequest({ key, method: "GET", url: listUrl })
  if (!list.ok) throw catalogUnreachable(`Object store ${list.status}`)
  const xml = await list.text()
  const listed = xml.includes("<Key>") || xml.includes("<Prefix>") || xml.includes("<Contents>")
  if (!listed && head.status === 404) throw catalogUnreachable("Object does not exist")
  if (!listed) throw catalogUnreachable(`Object store ${head.status}`)
  const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((item) => item[1]!)
  return {
    exists: true,
    is_dir: true,
    entry_count: keys.length || 1,
    format_hint: formatHintFromKey(parsed.key, true),
    normalized_uri: parsed.normalized,
  }
}

export async function summarizeObjectZarr(uri: string, accountId: string): Promise<ZarrSummary | undefined> {
  const parsed = parseObjectUri(uri)
  if (parsed.provider !== "s3" && parsed.provider !== "oss" && parsed.provider !== "cos") return
  const key = loadAliveKey(accountId, parsed.provider)
  const prefix = parsed.key ? `${parsed.key.replace(/\/+$/, "")}/` : ""
  const listUrl = objectUrl({
    key,
    bucket: parsed.bucket,
    objectKey: "",
    query: `list-type=2&max-keys=80&prefix=${encodeURIComponent(prefix)}`,
  })
  const list = await signedRequest({ key, method: "GET", url: listUrl })
  if (!list.ok) return
  const xml = await list.text()
  const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((item) => item[1]!)
  const metaKeys = keys.filter((item) => item.endsWith(".zarray") || item.endsWith("/zarr.json") || item === "zarr.json").slice(0, 32)
  const arrays: ZarrSummary["arrays"] = []
  let version: number | undefined
  const started = Date.now()
  for (const objectKey of metaKeys) {
    if (Date.now() - started > 8_000) break
    const getUrl = objectUrl({ key, bucket: parsed.bucket, objectKey })
    const response = await signedRequest({ key, method: "GET", url: getUrl })
    if (!response.ok) continue
    const raw = await response.text()
    const rel = objectKey.startsWith(prefix) ? objectKey.slice(prefix.length).replace(/\/(?:\.zarray|zarr\.json)$/, "") : objectKey
    const parsedMeta = parseZarray(raw, rel || ".")
    if (parsedMeta.version && !version) version = parsedMeta.version
    if (parsedMeta.array) arrays.push(parsedMeta.array)
  }
  if (!arrays.length) return
  return {
    ...(version ? { zarr_version: version } : {}),
    arrays,
    ...(metaKeys.length === 32 || keys.length >= 80 ? { truncated: true } : {}),
  }
}

export { PROVIDERS as OBJECT_STORE_PROVIDERS }
