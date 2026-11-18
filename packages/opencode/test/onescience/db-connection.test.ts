import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { resetDatabase } from "../fixture/db"
import { CatalogError } from "../../src/onescience/catalog-error"
import * as DbConnection from "../../src/onescience/db-connection"

const accountId = "acct_db_test"

function withMasterKey<T>(fn: () => T | Promise<T>) {
  const previous = process.env.ONECODE_OBJECT_STORE_MASTER_KEY
  process.env.ONECODE_OBJECT_STORE_MASTER_KEY = Buffer.alloc(32, 7).toString("base64")
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous === undefined) delete process.env.ONECODE_OBJECT_STORE_MASTER_KEY
      else process.env.ONECODE_OBJECT_STORE_MASTER_KEY = previous
    })
}

beforeEach(async () => {
  await resetDatabase()
  DbConnection.setOpenSqlForTest?.(undefined)
})

afterEach(async () => {
  DbConnection.setOpenSqlForTest?.(undefined)
  await resetDatabase()
})

describe("db-connection", () => {
  test("stores password as ciphertext and never returns it", async () => {
    await withMasterKey(async () => {
      const saved = await DbConnection.putDbConnection({
        accountId,
        engine: "postgres",
        host: "10.0.0.5",
        port: 5432,
        database: "papers_db",
        username: "reader",
        password: "super-secret-db",
        label: "文献库",
        skipLiveProbe: true,
      })
      expect(saved.id.startsWith("dbc_")).toBe(true)
      expect(JSON.stringify(saved)).not.toContain("super-secret-db")
      expect(DbConnection.listDbConnections(accountId)).toMatchObject({ configured: true })
      expect(JSON.stringify(DbConnection.listDbConnections(accountId))).not.toContain("super-secret-db")
    })
  })

  test("list soft-disables without master key", () => {
    const previous = process.env.ONECODE_OBJECT_STORE_MASTER_KEY
    delete process.env.ONECODE_OBJECT_STORE_MASTER_KEY
    try {
      expect(DbConnection.listDbConnections(accountId)).toEqual({ items: [], configured: false })
    } finally {
      if (previous === undefined) delete process.env.ONECODE_OBJECT_STORE_MASTER_KEY
      else process.env.ONECODE_OBJECT_STORE_MASTER_KEY = previous
    }
  })

  test("rejects localhost hosts", () => {
    process.env.ONECODE_OBJECT_STORE_MASTER_KEY = Buffer.alloc(32, 7).toString("base64")
    expect(() => DbConnection.assertDbHost("127.0.0.1")).toThrow()
    expect(() => DbConnection.assertDbHost("169.254.169.254")).toThrow()
    expect(() => DbConnection.assertDbHost("::ffff:127.0.0.1")).toThrow()
    expect(() => DbConnection.assertDbHost("::ffff:7f00:1")).toThrow()
    expect(() => DbConnection.assertDbHost("fe80::1")).toThrow()
    expect(() => DbConnection.assertDbHost("[fe80::abcd]")).toThrow()
    expect(() => DbConnection.assertDbHost("10.0.0.5")).not.toThrow()
    expect(() => DbConnection.assertDbHost("192.168.1.10")).not.toThrow()
  })

  test("parses postgres and mysql table URIs", () => {
    expect(DbConnection.parseDbTableUri("postgres://dbc_abc/public.papers")).toEqual({
      engine: "postgres",
      connectionId: "dbc_abc",
      schema: "public",
      table: "papers",
    })
    expect(DbConnection.parseDbTableUri("mysql://dbc_xyz/papers")).toEqual({
      engine: "mysql",
      connectionId: "dbc_xyz",
      schema: null,
      table: "papers",
    })
    expect(DbConnection.formatDbTableUri("postgres", "dbc_abc", "public", "papers")).toBe("postgres://dbc_abc/public.papers")
    expect(DbConnection.formatDbTableUri("mysql", "dbc_xyz", null, "papers")).toBe("mysql://dbc_xyz/papers")
  })

  test("listDbTables rejects foreign connection", async () => {
    await withMasterKey(async () => {
      const saved = await DbConnection.putDbConnection({
        accountId,
        engine: "postgres",
        host: "10.0.0.5",
        port: 5432,
        database: "papers_db",
        username: "reader",
        password: "super-secret-db",
        skipLiveProbe: true,
      })
      try {
        await DbConnection.listDbTables("acct_other", saved.id)
        expect.unreachable()
      } catch (error) {
        expect(error).toBeInstanceOf(CatalogError)
        expect((error as CatalogError).status === 403 || (error as CatalogError).status === 404).toBe(true)
      }
    })
  })

  test("sampleDbTable rejects unsafe identifiers", async () => {
    await withMasterKey(async () => {
      const saved = await DbConnection.putDbConnection({
        accountId,
        engine: "postgres",
        host: "10.0.0.5",
        port: 5432,
        database: "papers_db",
        username: "reader",
        password: "super-secret-db",
        skipLiveProbe: true,
      })
      await expect(
        DbConnection.sampleDbTable(accountId, saved.id, { schema: "public", name: "papers; drop" }),
      ).rejects.toBeInstanceOf(CatalogError)
    })
  })

  test("listDbTables and sampleDbTable work via injectable SQL hook", async () => {
    await withMasterKey(async () => {
      const saved = await DbConnection.putDbConnection({
        accountId,
        engine: "postgres",
        host: "10.0.0.5",
        port: 5432,
        database: "papers_db",
        username: "reader",
        password: "super-secret-db",
        skipLiveProbe: true,
      })
      const queries: string[] = []
      DbConnection.setOpenSqlForTest(() => ({
        unsafe(query: string, _params?: unknown[]) {
          queries.push(query)
          if (query.includes("information_schema.columns")) {
            return Promise.resolve([{ column_name: "id" }, { column_name: "title" }])
          }
          if (query.includes("information_schema.tables")) {
            return Promise.resolve([{ table_schema: "public", table_name: "papers", table_type: "BASE TABLE" }])
          }
          if (query.includes("pg_class") || query.includes("reltuples")) {
            return Promise.resolve([{ entry_count: 42 }])
          }
          if (query.includes("SELECT *")) {
            return Promise.resolve([{ id: 1, title: "a" }])
          }
          return Promise.resolve([{ ok: 1 }])
        },
        close() {
          return Promise.resolve()
        },
      }))
      const tables = await DbConnection.listDbTables(accountId, saved.id)
      expect(tables.items).toEqual([{ schema: "public", name: "papers", kind: "table" }])
      const sample = await DbConnection.sampleDbTable(accountId, saved.id, { schema: "public", name: "papers" }, { limit: 5 })
      expect(sample.columns).toEqual(["id", "title"])
      expect(sample.rows).toEqual([{ id: 1, title: "a" }])
      expect(sample.entry_count).toBe(42)
      expect(queries.some((q) => q.includes("information_schema.tables"))).toBe(true)
      expect(queries.some((q) => q.includes("information_schema.columns"))).toBe(true)
    })
  })

  test("describeDbTable and sampleDbTable return columns for empty tables", async () => {
    await withMasterKey(async () => {
      const saved = await DbConnection.putDbConnection({
        accountId,
        engine: "postgres",
        host: "10.0.0.5",
        port: 5432,
        database: "papers_db",
        username: "reader",
        password: "super-secret-db",
        skipLiveProbe: true,
      })
      DbConnection.setOpenSqlForTest(() => ({
        unsafe(query: string) {
          if (query.includes("information_schema.columns")) {
            return Promise.resolve([{ column_name: "id" }, { column_name: "title" }])
          }
          if (query.includes("SELECT *")) return Promise.resolve([])
          return Promise.resolve([{ ok: 1 }])
        },
        close() {
          return Promise.resolve()
        },
      }))
      const described = await DbConnection.describeDbTable(accountId, saved.id, { schema: "public", name: "papers" })
      expect(described.columns).toEqual(["id", "title"])
      const sample = await DbConnection.sampleDbTable(accountId, saved.id, { schema: "public", name: "papers" }, { limit: 1 })
      expect(sample.columns).toEqual(["id", "title"])
      expect(sample.rows).toEqual([])
    })
  })

  test("exportDbTable stops when encoded CSV approaches max bytes", async () => {
    await withMasterKey(async () => {
      const saved = await DbConnection.putDbConnection({
        accountId,
        engine: "postgres",
        host: "10.0.0.5",
        port: 5432,
        database: "papers_db",
        username: "reader",
        password: "super-secret-db",
        skipLiveProbe: true,
      })
      const cell = "x".repeat(100_000)
      let selectCalls = 0
      DbConnection.setOpenSqlForTest(() => ({
        unsafe(query: string) {
          if (query.includes("information_schema.columns")) {
            return Promise.resolve([{ column_name: "payload" }])
          }
          if (query.includes("SELECT *")) {
            selectCalls++
            const match = /OFFSET\s+(\d+)/i.exec(query)
            const offset = match ? Number(match[1]) : 0
            if (offset >= 500) return Promise.resolve([])
            return Promise.resolve(Array.from({ length: 100 }, (_, i) => ({ payload: `${offset + i}-${cell}` })))
          }
          return Promise.resolve([{ ok: 1 }])
        },
        close() {
          return Promise.resolve()
        },
      }))
      const maxBytes = 250_000
      const exported = await DbConnection.exportDbTable(accountId, saved.id, { schema: "public", name: "papers" }, {
        maxRows: 50_000,
        maxBytes,
      })
      expect(exported.bytes).toBeLessThanOrEqual(maxBytes)
      expect(Buffer.byteLength(exported.csv, "utf8")).toBeLessThanOrEqual(maxBytes + 1)
      expect(exported.row_count).toBeGreaterThan(0)
      expect(exported.row_count).toBeLessThan(500)
      expect(selectCalls).toBeGreaterThan(0)
      expect(selectCalls).toBeLessThan(5)
      expect("rows" in exported).toBe(false)
    })
  })

  test("sampleDbTable stops when encoded JSON approaches byte cap", async () => {
    await withMasterKey(async () => {
      const saved = await DbConnection.putDbConnection({
        accountId,
        engine: "postgres",
        host: "10.0.0.5",
        port: 5432,
        database: "papers_db",
        username: "reader",
        password: "super-secret-db",
        skipLiveProbe: true,
      })
      const cell = "y".repeat(200_000)
      DbConnection.setOpenSqlForTest(() => ({
        unsafe(query: string) {
          if (query.includes("information_schema.columns")) {
            return Promise.resolve([{ column_name: "payload" }])
          }
          if (query.includes("SELECT *")) {
            return Promise.resolve(Array.from({ length: 20 }, (_, i) => ({ payload: `${i}-${cell}` })))
          }
          return Promise.resolve([{ ok: 1 }])
        },
        close() {
          return Promise.resolve()
        },
      }))
      const sample = await DbConnection.sampleDbTable(accountId, saved.id, { schema: "public", name: "papers" }, { limit: 20 })
      expect(sample.rows.length).toBeGreaterThan(0)
      expect(sample.rows.length).toBeLessThan(20)
      expect(Buffer.byteLength(JSON.stringify(sample.rows), "utf8")).toBeLessThanOrEqual(DbConnection.DB_SAMPLE_MAX_BYTES + 200_000)
    })
  })

  test("query timeout becomes CatalogError", async () => {
    await withMasterKey(async () => {
      const saved = await DbConnection.putDbConnection({
        accountId,
        engine: "postgres",
        host: "10.0.0.5",
        port: 5432,
        database: "papers_db",
        username: "reader",
        password: "super-secret-db",
        skipLiveProbe: true,
      })
      DbConnection.setOpenSqlForTest(() => ({
        unsafe(query: string) {
          if (query.includes("statement_timeout")) return Promise.resolve([])
          return Promise.reject(new Error("canceling statement due to statement timeout"))
        },
        close() {
          return Promise.resolve()
        },
      }))
      try {
        await DbConnection.listDbTables(accountId, saved.id)
        expect.unreachable()
      } catch (error) {
        expect(error).toBeInstanceOf(CatalogError)
        expect((error as CatalogError).error).toBe("query_timeout")
      }
    })
  })
})
