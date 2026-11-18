import postgres from "postgres"
import mysql from "mysql2/promise"
import { Database } from "@/storage/db"
import { Identifier } from "@/id/id"
import { and, eq, isNull } from "drizzle-orm"
import { OneScienceDataProjectTable, OneScienceDbConnectionTable } from "./data-project.sql"
import { CatalogError, catalogBadRequest, catalogForbidden } from "./catalog-error"
import { decryptSecret, encryptSecret, isSecretMasterKeyAvailable, requireSecretMasterKey } from "./catalog-secret"

export type DbEngine = "postgres" | "mysql"

export type DbConnectionPublic = {
  id: string
  engine: DbEngine
  host: string
  port: number
  database: string
  username: string
  label?: string
  ssl_mode?: string
  time_created: number
  time_updated: number
}

export type DbTableRef = {
  schema: string | null
  name: string
}

export type DbTableItem = {
  schema: string
  name: string
  kind: "table" | "view"
}

type SqlConn = {
  engine: string
  host: string
  port: number
  database: string
  username: string
  password: string
  ssl_mode?: string | null
}

type SqlClient = {
  unsafe(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  close(): Promise<void>
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
const DEFAULT_SAMPLE_LIMIT = 20
const MAX_SAMPLE_LIMIT = 100
export const DB_EXPORT_MAX_ROWS = 50_000
export const DB_EXPORT_MAX_BYTES = 32 * 1024 * 1024
/** Cap preview/sample payload size in addition to row LIMIT (~1.5MB encoded JSON). */
export const DB_SAMPLE_MAX_BYTES = 1.5 * 1024 * 1024
const DB_EXPORT_BATCH = 1_000
const SQL_CONNECT_TIMEOUT_MS = 8_000
/** Server-side statement budget for list/sample/export/test (~5–8s). */
const SQL_STATEMENT_TIMEOUT_MS = 8_000

let openSqlOverride: ((conn: SqlConn) => SqlClient) | undefined

export function setOpenSqlForTest(fn: ((conn: SqlConn) => SqlClient) | undefined) {
  openSqlOverride = fn
}

function asEngine(value: string): DbEngine {
  const engine = value.trim().toLowerCase()
  if (engine === "postgres" || engine === "mysql") return engine
  throw catalogBadRequest("engine must be postgres or mysql")
}

function assertPort(port: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw catalogBadRequest("port must be an integer between 1 and 65535")
}

function hostForbidden() {
  return catalogForbidden("Database host cannot target loopback or link-local addresses")
}

function rejectForbiddenIpv4(host: string) {
  const parts = host.split(".").map((item) => Number(item))
  if (parts.length !== 4 || !parts.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) return false
  const [a, b] = parts
  if (a === 127) throw hostForbidden()
  if (a === 169 && b === 254) throw hostForbidden()
  return true
}

/** Decode ::ffff:127.0.0.1 or ::ffff:7f00:1 into dotted IPv4 when present. */
function ipv4MappedAddress(host: string) {
  if (!host.startsWith("::ffff:")) return
  const rest = host.slice("::ffff:".length)
  if (rest.includes(".")) return rest
  const match = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(rest)
  if (!match) return
  const hi = Number.parseInt(match[1]!, 16)
  const lo = Number.parseInt(match[2]!, 16)
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`
}

function isIpv6LinkLocal(host: string) {
  // fe80::/10 → first hextet fe80–febf
  const first = host.split(":")[0]
  if (!first) return false
  const n = Number.parseInt(first, 16)
  return Number.isInteger(n) && n >= 0xfe80 && n <= 0xfebf
}

export function assertDbHost(hostInput: string) {
  const host = hostInput.replace(/^\[|\]$/g, "").trim().toLowerCase()
  if (!host) throw catalogBadRequest("host is required")
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "0.0.0.0") {
    throw hostForbidden()
  }
  const mapped = ipv4MappedAddress(host)
  if (mapped) {
    rejectForbiddenIpv4(mapped)
    return
  }
  if (isIpv6LinkLocal(host)) throw hostForbidden()
  rejectForbiddenIpv4(host)
}

function assertIdent(value: string, label: string) {
  if (!IDENT.test(value)) throw catalogBadRequest(`Invalid ${label} identifier`)
  return value
}

function toPublic(row: typeof OneScienceDbConnectionTable.$inferSelect): DbConnectionPublic {
  return {
    id: row.id,
    engine: row.engine as DbEngine,
    host: row.host,
    port: row.port,
    database: row.database,
    username: row.username,
    ...(row.label ? { label: row.label } : {}),
    ...(row.ssl_mode ? { ssl_mode: row.ssl_mode } : {}),
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

function notFound(message: string) {
  return new CatalogError(404, "not_found", message)
}

function connectionFailed(message: string) {
  return new CatalogError(422, "connection_failed", message)
}

function queryTimeout(message = "Database query timed out") {
  return new CatalogError(422, "query_timeout", message)
}

function isTimeoutError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  return (
    lower.includes("statement timeout") ||
    lower.includes("canceling statement") ||
    lower.includes("cancelled on completion of") ||
    lower.includes("max_execution_time") ||
    lower.includes("query timed out") ||
    lower.includes("query_timeout") ||
    (lower.includes("timeout") && (lower.includes("statement") || lower.includes("execution") || lower.includes("query")))
  )
}

function buildPostgresUrl(conn: SqlConn) {
  let url = `postgres://${encodeURIComponent(conn.username)}:${encodeURIComponent(conn.password)}@${conn.host}:${conn.port}/${encodeURIComponent(conn.database)}`
  const sslMode = conn.ssl_mode?.trim()
  if (sslMode) url += `?sslmode=${encodeURIComponent(sslMode)}`
  return url
}

function mysqlSslOption(sslMode: string | null | undefined) {
  const mode = sslMode?.trim().toLowerCase()
  if (!mode || mode === "disable" || mode === "false" || mode === "0") return undefined
  // Prefer encrypted transport; certificate verification follows strict modes when requested.
  if (mode === "verify-full" || mode === "verify-ca" || mode === "required") {
    return { rejectUnauthorized: mode !== "required" }
  }
  return { rejectUnauthorized: false }
}

function openPostgres(conn: SqlConn): SqlClient {
  const sql = postgres(buildPostgresUrl(conn), {
    max: 1,
    connect_timeout: SQL_CONNECT_TIMEOUT_MS / 1000,
    idle_timeout: 5,
  })
  return {
    unsafe(query, params) {
      return Promise.resolve(sql.unsafe(query, (params ?? []) as never[])).then(
        (rows) => Array.from(rows) as Record<string, unknown>[],
      )
    },
    async close() {
      await sql.end({ timeout: 5 })
    },
  }
}

function openMysql(conn: SqlConn): SqlClient {
  let connection: mysql.Connection | undefined
  let connecting: Promise<mysql.Connection> | undefined

  const getConnection = () => {
    if (connection) return Promise.resolve(connection)
    if (!connecting) {
      connecting = mysql
        .createConnection({
          host: conn.host,
          port: conn.port,
          user: conn.username,
          password: conn.password,
          database: conn.database,
          connectTimeout: SQL_CONNECT_TIMEOUT_MS,
          ssl: mysqlSslOption(conn.ssl_mode),
        })
        .then((created: mysql.Connection) => {
          connection = created
          return created
        })
    }
    return connecting
  }

  return {
    async unsafe(query, params) {
      const client = await getConnection()
      const [rows] = await client.query(query, params ?? [])
      return rows as Record<string, unknown>[]
    },
    async close() {
      if (connection) {
        await connection.end()
        connection = undefined
      }
      connecting = undefined
    },
  }
}

function openSql(conn: SqlConn): SqlClient {
  if (openSqlOverride) return openSqlOverride(conn)
  if (conn.engine === "mysql") return openMysql(conn)
  return openPostgres(conn)
}

async function applyStatementTimeout(sql: SqlClient, engine: string) {
  if (engine === "mysql") {
    // MySQL 5.7.8+: SELECT max_execution_time is milliseconds.
    await sql.unsafe(`SET SESSION max_execution_time = ${SQL_STATEMENT_TIMEOUT_MS}`)
    return
  }
  await sql.unsafe(`SET statement_timeout = ${SQL_STATEMENT_TIMEOUT_MS}`)
}

async function withSql<T>(conn: SqlConn, run: (sql: SqlClient) => Promise<T>) {
  const sql = openSql(conn)
  try {
    await applyStatementTimeout(sql, conn.engine)
    return await run(sql)
  } catch (error) {
    if (error instanceof CatalogError) throw error
    if (isTimeoutError(error)) throw queryTimeout(error instanceof Error ? error.message : undefined)
    throw error
  } finally {
    await sql.close().catch(() => undefined)
  }
}

function capSampleRows(rows: Record<string, unknown>[], maxBytes = DB_SAMPLE_MAX_BYTES) {
  const capped: Record<string, unknown>[] = []
  let size = 2
  for (const row of rows) {
    const encoded = Buffer.byteLength(JSON.stringify(row), "utf8")
    const next = size + encoded + (capped.length ? 1 : 0)
    if (capped.length > 0 && next > maxBytes) break
    if (capped.length === 0 && encoded > maxBytes) {
      capped.push(row)
      break
    }
    capped.push(row)
    size = next
  }
  return capped
}

function loadOwnedConnection(accountId: string, connectionId: string) {
  requireSecretMasterKey()
  const row = Database.use((db) =>
    db
      .select()
      .from(OneScienceDbConnectionTable)
      .where(
        and(
          eq(OneScienceDbConnectionTable.account_id, accountId),
          eq(OneScienceDbConnectionTable.id, connectionId),
          isNull(OneScienceDbConnectionTable.time_deleted),
        ),
      )
      .get(),
  )
  if (!row) throw notFound("Database connection not found")
  return {
    ...toPublic(row),
    password: decryptSecret(row.password_ciphertext),
    ssl_mode: row.ssl_mode,
  }
}

function quoteIdent(engine: DbEngine, name: string) {
  if (engine === "mysql") return `\`${name}\``
  return `"${name}"`
}

function qualifyTable(engine: DbEngine, tableRef: DbTableRef) {
  const name = assertIdent(tableRef.name, "table")
  if (engine === "mysql") return quoteIdent(engine, name)
  const schema = assertIdent(tableRef.schema ?? "", "schema")
  return `${quoteIdent(engine, schema)}.${quoteIdent(engine, name)}`
}

function asKind(tableType: unknown): "table" | "view" {
  const value = String(tableType ?? "").toUpperCase()
  if (value.includes("VIEW")) return "view"
  return "table"
}

function clampLimit(limit?: number) {
  if (limit === undefined) return DEFAULT_SAMPLE_LIMIT
  if (!Number.isInteger(limit) || limit < 1) throw catalogBadRequest("limit must be a positive integer")
  return Math.min(limit, MAX_SAMPLE_LIMIT)
}

export function parseDbTableUri(uri: string) {
  const match = /^(postgres|mysql):\/\/(dbc_[A-Za-z0-9]+)\/(.+)$/.exec(uri.trim())
  if (!match) throw catalogBadRequest("Invalid database table URI")
  const engine = match[1] as DbEngine
  const connectionId = match[2]!
  const path = match[3]!
  if (engine === "postgres") {
    const dot = path.indexOf(".")
    if (dot <= 0 || dot === path.length - 1) throw catalogBadRequest("Postgres table URI requires schema.table")
    const schema = assertIdent(path.slice(0, dot), "schema")
    const table = assertIdent(path.slice(dot + 1), "table")
    return { engine, connectionId, schema, table }
  }
  return { engine, connectionId, schema: null as string | null, table: assertIdent(path, "table") }
}

export function formatDbTableUri(engine: DbEngine, connectionId: string, schema: string | null, table: string) {
  assertIdent(table, "table")
  if (engine === "postgres") {
    if (!schema) throw catalogBadRequest("Postgres table URI requires schema")
    assertIdent(schema, "schema")
    return `postgres://${connectionId}/${schema}.${table}`
  }
  return `mysql://${connectionId}/${table}`
}

export async function testDbConnection(input: {
  engine: string
  host: string
  port: number
  database: string
  username: string
  password: string
  ssl_mode?: string
}) {
  const engine = asEngine(input.engine)
  assertPort(input.port)
  const host = input.host.trim()
  const database = input.database.trim()
  const username = input.username.trim()
  const password = input.password.trim()
  if (!host || !database || !username || !password) throw catalogBadRequest("host, database, username, and password are required")
  assertDbHost(host)
  try {
    await withSql(
      { engine, host, port: input.port, database, username, password, ssl_mode: input.ssl_mode },
      async (sql) => {
        await sql.unsafe("SELECT 1")
      },
    )
  } catch (error) {
    if (error instanceof CatalogError) throw error
    throw connectionFailed(error instanceof Error ? error.message : "Database connection failed")
  }
}

export async function putDbConnection(input: {
  accountId: string
  engine: string
  host: string
  port: number
  database: string
  username: string
  password: string
  label?: string
  ssl_mode?: string
  skipLiveProbe?: boolean
}) {
  const engine = asEngine(input.engine)
  assertPort(input.port)
  const host = input.host.trim()
  const database = input.database.trim()
  const username = input.username.trim()
  const password = input.password.trim()
  if (!host || !database || !username || !password) throw catalogBadRequest("host, database, username, and password are required")
  assertDbHost(host)
  if (!input.skipLiveProbe) {
    await testDbConnection({
      engine,
      host,
      port: input.port,
      database,
      username,
      password,
      ssl_mode: input.ssl_mode,
    })
  }
  const now = Date.now()
  const ciphertext = encryptSecret(password)
  return Database.transaction((db) => {
    const existing = db
      .select()
      .from(OneScienceDbConnectionTable)
      .where(
        and(
          eq(OneScienceDbConnectionTable.account_id, input.accountId),
          eq(OneScienceDbConnectionTable.engine, engine),
          eq(OneScienceDbConnectionTable.host, host),
          eq(OneScienceDbConnectionTable.port, input.port),
          eq(OneScienceDbConnectionTable.database, database),
          eq(OneScienceDbConnectionTable.username, username),
          isNull(OneScienceDbConnectionTable.time_deleted),
        ),
      )
      .get()
    if (existing) {
      db.update(OneScienceDbConnectionTable)
        .set({
          label: input.label?.trim() || null,
          ssl_mode: input.ssl_mode?.trim() || null,
          password_ciphertext: ciphertext,
          time_updated: now,
        })
        .where(eq(OneScienceDbConnectionTable.id, existing.id))
        .run()
      return toPublic({
        ...existing,
        label: input.label?.trim() || null,
        ssl_mode: input.ssl_mode?.trim() || null,
        password_ciphertext: ciphertext,
        time_updated: now,
      })
    }
    const row = {
      id: Identifier.create("dbc", "ascending"),
      account_id: input.accountId,
      engine,
      host,
      port: input.port,
      database,
      username,
      password_ciphertext: ciphertext,
      label: input.label?.trim() || null,
      ssl_mode: input.ssl_mode?.trim() || null,
      time_created: now,
      time_updated: now,
      time_deleted: null,
    }
    db.insert(OneScienceDbConnectionTable).values(row).run()
    return toPublic(row)
  })
}

export function listDbConnections(accountId: string) {
  if (!isSecretMasterKeyAvailable()) return { items: [] as DbConnectionPublic[], configured: false as const }
  const rows = Database.use((db) =>
    db
      .select()
      .from(OneScienceDbConnectionTable)
      .where(and(eq(OneScienceDbConnectionTable.account_id, accountId), isNull(OneScienceDbConnectionTable.time_deleted)))
      .all(),
  )
  return { items: rows.map(toPublic), configured: true as const }
}

function rawUriReferencesConnection(uri: string, id: string) {
  try {
    return parseDbTableUri(uri).connectionId === id
  } catch {
    return uri.includes(`://${id}/`)
  }
}

export function deleteDbConnection(accountId: string, id: string) {
  requireSecretMasterKey()
  const referenced = Database.use((db) =>
    db
      .select({ uri: OneScienceDataProjectTable.raw_data_uri })
      .from(OneScienceDataProjectTable)
      .where(and(eq(OneScienceDataProjectTable.owner, accountId), isNull(OneScienceDataProjectTable.time_deleted)))
      .all()
      .some((row) => rawUriReferencesConnection(row.uri, id)),
  )
  if (referenced) {
    throw new CatalogError(409, "conflict", "Database connection is still referenced by a raw source")
  }
  Database.use((db) => {
    db.delete(OneScienceDbConnectionTable)
      .where(and(eq(OneScienceDbConnectionTable.account_id, accountId), eq(OneScienceDbConnectionTable.id, id)))
      .run()
  })
  return { ok: true as const }
}

export function deleteAccountDbConnections(accountId: string) {
  Database.use((db) => {
    db.delete(OneScienceDbConnectionTable).where(eq(OneScienceDbConnectionTable.account_id, accountId)).run()
  })
}

export async function listDbTables(accountId: string, connectionId: string) {
  const conn = loadOwnedConnection(accountId, connectionId)
  try {
    const rows = await withSql(conn, async (sql) => {
      if (conn.engine === "mysql") {
        return sql.unsafe(
          `SELECT table_schema, table_name, table_type
           FROM information_schema.tables
           WHERE table_schema = DATABASE()
           ORDER BY table_name`,
        )
      }
      return sql.unsafe(
        `SELECT table_schema, table_name, table_type
         FROM information_schema.tables
         WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
         ORDER BY table_schema, table_name`,
      )
    })
    return {
      items: rows.map((row) => ({
        schema: String(row.table_schema ?? ""),
        name: String(row.table_name ?? ""),
        kind: asKind(row.table_type),
      })) satisfies DbTableItem[],
    }
  } catch (error) {
    if (error instanceof CatalogError) throw error
    throw connectionFailed(error instanceof Error ? error.message : "Failed to list tables")
  }
}

async function listTableColumns(sql: SqlClient, engine: DbEngine, tableRef: DbTableRef) {
  if (engine === "mysql") {
    const name = assertIdent(tableRef.name, "table")
    const rows = await sql.unsafe(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ?
       ORDER BY ordinal_position`,
      [name],
    )
    return rows.map((row) => String(row.column_name ?? "")).filter(Boolean)
  }
  const schema = assertIdent(tableRef.schema ?? "", "schema")
  const name = assertIdent(tableRef.name, "table")
  const rows = await sql.unsafe(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, name],
  )
  return rows.map((row) => String(row.column_name ?? "")).filter(Boolean)
}

function csvEscape(value: unknown) {
  if (value === null || value === undefined) return ""
  const text = typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}

export async function describeDbTable(accountId: string, connectionId: string, tableRef: DbTableRef) {
  const conn = loadOwnedConnection(accountId, connectionId)
  try {
    return await withSql(conn, async (sql) => ({
      columns: await listTableColumns(sql, conn.engine, tableRef),
    }))
  } catch (error) {
    if (error instanceof CatalogError) throw error
    throw connectionFailed(error instanceof Error ? error.message : "Failed to describe table")
  }
}

export async function sampleDbTable(
  accountId: string,
  connectionId: string,
  tableRef: DbTableRef,
  opts?: { limit?: number },
) {
  const conn = loadOwnedConnection(accountId, connectionId)
  const limit = clampLimit(opts?.limit)
  const qualified = qualifyTable(conn.engine, tableRef)
  try {
    return await withSql(conn, async (sql) => {
      const metaColumns = await listTableColumns(sql, conn.engine, tableRef)
      const rows = capSampleRows(await sql.unsafe(`SELECT * FROM ${qualified} LIMIT ${limit}`))
      const columns = metaColumns.length ? metaColumns : rows[0] ? Object.keys(rows[0]) : []
      const entry_count = await estimateEntryCount(sql, conn.engine, tableRef).catch(() => undefined)
      return {
        columns,
        rows,
        ...(entry_count === undefined ? {} : { entry_count }),
      }
    })
  } catch (error) {
    if (error instanceof CatalogError) throw error
    throw connectionFailed(error instanceof Error ? error.message : "Failed to sample table")
  }
}

export async function exportDbTable(
  accountId: string,
  connectionId: string,
  tableRef: DbTableRef,
  opts?: { maxRows?: number; maxBytes?: number },
) {
  const conn = loadOwnedConnection(accountId, connectionId)
  const maxRows = Math.min(Math.max(1, opts?.maxRows ?? DB_EXPORT_MAX_ROWS), DB_EXPORT_MAX_ROWS)
  const maxBytes = Math.min(Math.max(1, opts?.maxBytes ?? DB_EXPORT_MAX_BYTES), DB_EXPORT_MAX_BYTES)
  const qualified = qualifyTable(conn.engine, tableRef)
  try {
    return await withSql(conn, async (sql) => {
      const metaColumns = await listTableColumns(sql, conn.engine, tableRef)
      const headerColumns = metaColumns.length ? metaColumns : null
      const parts: string[] = []
      let size = 0
      let rowCount = 0
      let offset = 0
      let columns = headerColumns ?? ([] as string[])

      while (rowCount < maxRows) {
        const take = Math.min(DB_EXPORT_BATCH, maxRows - rowCount)
        const rows = await sql.unsafe(`SELECT * FROM ${qualified} LIMIT ${take} OFFSET ${offset}`)
        if (!rows.length) break
        if (!columns.length) columns = Object.keys(rows[0]!)
        if (!parts.length) {
          const header = columns.map(csvEscape).join(",")
          size = Buffer.byteLength(header + "\n", "utf8")
          parts.push(header)
        }
        let stopped = false
        for (const row of rows) {
          const line = columns.map((column) => csvEscape(row[column])).join(",")
          const next = Buffer.byteLength(line + "\n", "utf8")
          if (size + next > maxBytes) {
            stopped = true
            break
          }
          parts.push(line)
          size += next
          rowCount++
          if (rowCount >= maxRows) {
            stopped = true
            break
          }
        }
        if (stopped || rows.length < take) break
        offset += rows.length
      }

      if (!parts.length) {
        const header = columns.map(csvEscape).join(",")
        size = Buffer.byteLength(header + "\n", "utf8")
        parts.push(header)
      }
      return {
        columns,
        csv: parts.join("\n") + "\n",
        row_count: rowCount,
        bytes: size,
      }
    })
  } catch (error) {
    if (error instanceof CatalogError) throw error
    throw connectionFailed(error instanceof Error ? error.message : "Failed to export table")
  }
}

async function estimateEntryCount(sql: SqlClient, engine: DbEngine, tableRef: DbTableRef) {
  if (engine === "mysql") {
    const name = assertIdent(tableRef.name, "table")
    const rows = await sql.unsafe(
      `SELECT table_rows AS entry_count
       FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = ?`,
      [name],
    )
    const value = rows[0]?.entry_count
    if (value === null || value === undefined) return undefined
    const n = Number(value)
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : undefined
  }
  const schema = assertIdent(tableRef.schema ?? "", "schema")
  const name = assertIdent(tableRef.name, "table")
  const rows = await sql.unsafe(
    `SELECT c.reltuples::bigint AS entry_count
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relname = $2`,
    [schema, name],
  )
  const value = rows[0]?.entry_count
  if (value === null || value === undefined) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : undefined
}
