import { type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { sql } from "drizzle-orm"
import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"
export * from "drizzle-orm"
import { LocalContext } from "@/util/local-context"
import { lazy } from "../util/lazy"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { NamedError } from "@opencode-ai/core/util/error"
import path from "path"
import { readFileSync, readdirSync, existsSync } from "fs"
import { Flag } from "@opencode-ai/core/flag/flag"
import { InstallationChannel } from "@opencode-ai/core/installation/version"
import { InstanceState } from "@/effect/instance-state"
import { init } from "#db"
import { Schema } from "effect"

declare const OPENCODE_MIGRATIONS: { sql: string; timestamp: number; name: string }[] | undefined

export const NotFoundError = NamedError.create("NotFoundError", {
  message: Schema.String,
})

const log = Log.create({ service: "db" })

export function getChannelPath() {
  if (["latest", "beta", "prod"].includes(InstallationChannel) || Flag.OPENCODE_DISABLE_CHANNEL_DB)
    return path.join(Global.Path.data, "opencode.db")
  const safe = InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")
  return path.join(Global.Path.data, `opencode-${safe}.db`)
}

export function getPath() {
  if (Flag.OPENCODE_DB) {
    if (Flag.OPENCODE_DB === ":memory:" || path.isAbsolute(Flag.OPENCODE_DB)) return Flag.OPENCODE_DB
    return path.join(Global.Path.data, Flag.OPENCODE_DB)
  }
  return getChannelPath()
}

export type Transaction = SQLiteTransaction<"sync", void>

type Client = SQLiteBunDatabase

type Journal = { sql: string; timestamp: number; name: string }[]
const PLATFORM_USER_SYSTEM_MIGRATION = "20260627133000_platform_user_system"

// Drizzle's migrate overloads trigger expensive variance checks here; narrow to the journal overload we actually use.
const migrateFromJournal = migrate as unknown as (db: SQLiteBunDatabase, entries: Journal) => void

function applyMigrations(db: SQLiteBunDatabase, entries: Journal) {
  migrateFromJournal(db, entries)
}

function closeSqlite(db: ReturnType<typeof init>) {
  db.$client.close()
}

export function isFreshDatabase(db: SQLiteBunDatabase) {
  const row = db.get<{ c: number }>(
    sql`SELECT COUNT(*) as c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
  )
  return (row?.c ?? 0) === 0
}

function copySchema(from: SQLiteBunDatabase, to: SQLiteBunDatabase) {
  const objects = from.all<{ sql: string }>(
    sql`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 WHEN 'trigger' THEN 3 ELSE 4 END, name`,
  )
  const rows = from.all<{ hash: string; created_at: number; name: string; applied_at: string }>(
    sql`SELECT hash, created_at, name, applied_at FROM __drizzle_migrations`,
  )
  to.run("PRAGMA foreign_keys = OFF")
  to.run("BEGIN")
  try {
    for (const object of objects) to.run(object.sql)
    for (const row of rows) {
      to.run(
        sql`INSERT INTO __drizzle_migrations ("hash", "created_at", "name", "applied_at") VALUES (${row.hash}, ${row.created_at}, ${row.name}, ${row.applied_at})`,
      )
    }
    to.run("COMMIT")
  } catch (error) {
    to.run("ROLLBACK")
    throw error
  } finally {
    to.run("PRAGMA foreign_keys = ON")
  }
}

export function applyIncrementalMigrations(db: SQLiteBunDatabase, entries: Journal) {
  applyMigrations(db, entries)
  repairPlatformUserSystemMigration(db, entries)
}

/** Build the current schema in memory, then copy the final DDL onto an empty file DB. */
export function applyFreshSnapshot(db: SQLiteBunDatabase, entries: Journal) {
  const memory = init(":memory:")
  try {
    memory.run("PRAGMA foreign_keys = ON")
    applyIncrementalMigrations(memory, entries)
    copySchema(memory, db)
  } finally {
    closeSqlite(memory)
  }
}

function repairPlatformUserSystemMigration(db: SQLiteBunDatabase, entries: Journal) {
  if (tableExists(db, "platform_password_credential")) return
  const migration = entries.find((entry) => entry.name === PLATFORM_USER_SYSTEM_MIGRATION)
  if (!migration) return
  if (!migrationApplied(db, PLATFORM_USER_SYSTEM_MIGRATION)) return

  // A few local databases recorded this migration after only the first statement.
  // The platform migration is fully idempotent, so replaying it repairs that state.
  log.warn("repairing partial platform user migration", { name: PLATFORM_USER_SYSTEM_MIGRATION })
  migration.sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
    .forEach((statement) => db.run(statement))
}

function tableExists(db: SQLiteBunDatabase, table: string) {
  return !!db.get(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${table}`)
}

function migrationApplied(db: SQLiteBunDatabase, name: string) {
  return !!db.get(sql`SELECT 1 FROM __drizzle_migrations WHERE name = ${name}`)
}

function time(tag: string) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
  if (!match) return 0
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  )
}

export function loadMigrationJournal(): Journal {
  if (typeof OPENCODE_MIGRATIONS !== "undefined") return OPENCODE_MIGRATIONS
  return migrations(path.join(import.meta.dirname, "../../migration"))
}

function migrations(dir: string): Journal {
  const dirs = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  const sql = dirs
    .map((name) => {
      const file = path.join(dir, name, "migration.sql")
      if (!existsSync(file)) return
      return {
        sql: readFileSync(file, "utf-8"),
        timestamp: time(name),
        name,
      }
    })
    .filter(Boolean) as Journal

  return sql.sort((a, b) => a.timestamp - b.timestamp)
}

export const Client = lazy(() => {
  const dbPath = getPath()
  log.info("opening database", { path: dbPath })

  const db = init(dbPath)

  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA synchronous = NORMAL")
  // SSH leaf on shared FS (scnet): fcntl locks stall in D-state; give peers more time
  // before SQLITE_BUSY instead of failing fast and thrashing the event loop.
  db.run(Flag.OPENCODE_WORKSPACE_ID ? "PRAGMA busy_timeout = 30000" : "PRAGMA busy_timeout = 5000")
  db.run("PRAGMA cache_size = -64000")
  db.run("PRAGMA foreign_keys = ON")
  try {
    db.run("PRAGMA wal_checkpoint(PASSIVE)")
  } catch (err) {
    log.warn("sqlite wal checkpoint failed", { error: err })
  }

  const entries = loadMigrationJournal()
  if (entries.length > 0) {
    const mode = typeof OPENCODE_MIGRATIONS !== "undefined" ? "bundled" : "dev"
    if (Flag.OPENCODE_SKIP_MIGRATIONS) {
      for (const item of entries) {
        item.sql = "select 1;"
      }
    }
    const freshFile = dbPath !== ":memory:" && isFreshDatabase(db) && !Flag.OPENCODE_SKIP_MIGRATIONS
    log.info("applying migrations", {
      count: entries.length,
      mode,
      strategy: freshFile ? "fresh-snapshot" : "incremental",
    })
    if (freshFile) applyFreshSnapshot(db, entries)
    else applyIncrementalMigrations(db, entries)
  }

  return db
})

export function close() {
  if (!Client.loaded()) return
  Client().$client.close()
  Client.reset()
}

export type TxOrDb = Transaction | Client

const ctx = LocalContext.create<{
  tx: TxOrDb
  effects: (() => void | Promise<void>)[]
}>("database")

export function use<T>(callback: (trx: TxOrDb) => T): T {
  try {
    return callback(ctx.use().tx)
  } catch (err) {
    if (err instanceof LocalContext.NotFound) {
      const effects: (() => void | Promise<void>)[] = []
      const result = ctx.provide({ effects, tx: Client() }, () => callback(Client()))
      for (const effect of effects) effect()
      return result
    }
    throw err
  }
}

export function effect(fn: () => any | Promise<any>) {
  const bound = InstanceState.bind(fn)
  try {
    ctx.use().effects.push(bound)
  } catch {
    bound()
  }
}

type NotPromise<T> = T extends Promise<any> ? never : T

export function transaction<T>(
  callback: (tx: TxOrDb) => NotPromise<T>,
  options?: {
    behavior?: "deferred" | "immediate" | "exclusive"
  },
): NotPromise<T> {
  try {
    return callback(ctx.use().tx)
  } catch (err) {
    if (err instanceof LocalContext.NotFound) {
      const effects: (() => void | Promise<void>)[] = []
      const txCallback = InstanceState.bind((tx: TxOrDb) => ctx.provide({ tx, effects }, () => callback(tx)))
      const result = Client().transaction(txCallback, { behavior: options?.behavior })
      for (const effect of effects) effect()
      return result as NotPromise<T>
    }
    throw err
  }
}

export * as Database from "./db"
