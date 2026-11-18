import { describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import fs from "fs"
import os from "os"
import path from "path"
import { init } from "#db"
import { Global } from "@opencode-ai/core/global"
import { InstallationChannel } from "@opencode-ai/core/installation/version"
import { Database } from "@/storage/db"
import { JsonMigration } from "@/storage/json-migration"

function tableNames(db: ReturnType<typeof init>) {
  return db
    .all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .map((row) => row.name)
}

function migrationNames(db: ReturnType<typeof init>) {
  return db.all<{ name: string }>(sql`SELECT name FROM __drizzle_migrations ORDER BY created_at, name`).map((row) => row.name)
}

describe("Database.getPath", () => {
  test("returns database path for the current channel", () => {
    const expected = ["latest", "beta"].includes(InstallationChannel)
      ? path.join(Global.Path.data, "opencode.db")
      : path.join(Global.Path.data, `opencode-${InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
    expect(Database.getChannelPath()).toBe(expected)
    expect(Database.getPath()).toBe(":memory:")
  })
})

describe("fresh sqlite snapshot", () => {
  test("matches incremental schema and records every journal entry", () => {
    const entries = Database.loadMigrationJournal()
    expect(entries.length).toBeGreaterThan(20)

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "onecode-db-"))
    const snapshotPath = path.join(dir, "snapshot.db")
    const incrementalPath = path.join(dir, "incremental.db")
    const snapshot = init(snapshotPath)
    const incremental = init(incrementalPath)
    try {
      expect(Database.isFreshDatabase(snapshot)).toBe(true)
      Database.applyFreshSnapshot(snapshot, entries)
      Database.applyIncrementalMigrations(incremental, entries)

      expect(Database.isFreshDatabase(snapshot)).toBe(false)
      expect(tableNames(snapshot)).toEqual(tableNames(incremental))
      expect(migrationNames(snapshot)).toEqual(migrationNames(incremental))
      expect(migrationNames(snapshot)).toEqual(entries.map((entry) => entry.name))
      expect(tableNames(snapshot)).toContain("session")
      expect(tableNames(snapshot)).toContain("workspace")
    } finally {
      try {
        snapshot.run("PRAGMA journal_mode = DELETE")
        incremental.run("PRAGMA journal_mode = DELETE")
      } catch {}
      snapshot.$client.close()
      incremental.$client.close()
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
      } catch {}
    }
  })
})

describe("JsonMigration.needsRun", () => {
  test("skips the JSON import when there is no legacy storage directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "onecode-json-"))
    try {
      expect(JsonMigration.needsRun(dir)).toBe(false)
      fs.mkdirSync(path.join(dir, "storage"))
      expect(JsonMigration.needsRun(dir)).toBe(true)
      fs.writeFileSync(path.join(dir, "opencode.db"), "")
      expect(JsonMigration.needsRun(dir)).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
