import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "fs"
import os from "os"
import path from "path"
import { Database } from "@/storage/db"
import { DataCatalog } from "@/onescience/data-catalog"
import * as DbConnection from "@/onescience/db-connection"
import { OneScienceResource } from "@/onescience/resource"
import { ProjectTable } from "@/project/project.sql"
import { SessionTable } from "@/session/session.sql"
import { resetDatabase } from "../fixture/db"

const accountId = "acct-catalog-phase0"

function tempDir() {
  const dir = path.join(os.tmpdir(), `onedata-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

beforeEach(async () => {
  await resetDatabase()
  DbConnection.setOpenSqlForTest(undefined)
})

afterEach(async () => {
  DbConnection.setOpenSqlForTest(undefined)
  await resetDatabase()
})

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

function mockPapersSql() {
  DbConnection.setOpenSqlForTest(() => ({
    unsafe(query: string, _params?: unknown[]) {
      if (query.includes("information_schema.columns")) {
        return Promise.resolve([{ column_name: "id" }, { column_name: "title" }])
      }
      if (query.includes("information_schema.tables") || query.includes("pg_class") || query.includes("reltuples")) {
        if (query.includes("information_schema.tables") && query.includes("ORDER BY")) {
          return Promise.resolve([{ table_schema: "public", table_name: "papers", table_type: "BASE TABLE" }])
        }
        return Promise.resolve([{ entry_count: 3 }])
      }
      if (query.includes("SELECT *")) {
        return Promise.resolve([
          { id: 1, title: "a" },
          { id: 2, title: "b" },
          { id: 3, title: "c" },
        ])
      }
      return Promise.resolve([{ ok: 1 }])
    },
    close() {
      return Promise.resolve()
    },
  }))
}

describe("OneData catalog phase 0", () => {
  test("list endpoints omit nextOffset when there is no next page", async () => {
    const emptyRaw = DataCatalog.listRaw({ accountId })
    expect(emptyRaw.items).toEqual([])
    expect("nextOffset" in emptyRaw).toBe(false)
    expect(JSON.parse(JSON.stringify(emptyRaw))).toEqual({ items: [] })

    const emptyAlready = DataCatalog.listAlready({ accountId, scope: "mine" })
    expect(emptyAlready.items).toEqual([])
    expect("nextOffset" in emptyAlready).toBe(false)
    expect(JSON.parse(JSON.stringify(emptyAlready))).toEqual({ items: [] })
  })

  test("registers a local csv, converts it, and reuses the same Already row", async () => {
    const dir = tempDir()
    const file = path.join(dir, "era5.csv")
    writeFileSync(file, "date,value\n2020-01-01,1\n")

    const raw = await DataCatalog.registerRaw({
      accountId,
      title: "ERA5 subset",
      domain: "地球科学",
      uri: file,
      connector: "local_fs",
    })
    expect(raw.id.startsWith("raw_")).toBe(true)
    expect(raw.domain).toBe("weather")
    expect(DataCatalog.listRaw({ accountId }).items.map((item) => item.id)).toEqual([raw.id])
    expect(DataCatalog.listRaw({ accountId: "other" }).items).toEqual([])

    const first = await DataCatalog.convertRaw({ id: raw.id, accountId })
    expect(first.id.startsWith("alr_")).toBe(true)
    expect(first.status).toBe("ready")
    expect(first.source_raw_ids).toEqual([raw.id])

    const second = await DataCatalog.convertRaw({ id: raw.id, accountId })
    expect(second.id).toBe(first.id)
    expect(DataCatalog.listAlready({ accountId, scope: "mine" }).items).toHaveLength(1)
  })

  test("remote workspace probe requires wrk_* and an account", async () => {
    await expect(DataCatalog.probe({
      connector: "remote_workspace",
      uri: "/data/era5",
    })).rejects.toMatchObject({ status: 400, error: "bad_request" })
    await expect(DataCatalog.probe({
      connector: "remote_workspace",
      uri: "/data/era5",
      workspace_id: "wrk_abc",
    })).rejects.toMatchObject({ status: 401 })
    await expect(DataCatalog.probe({
      connector: "remote_workspace",
      uri: "/data/era5",
      workspace_id: "wrk_abc",
      accountId,
    })).rejects.toMatchObject({ status: 404, error: "workspace_not_found" })
  })

  test("blocks converting onedata_ref raw sources", async () => {
    const dir = tempDir()
    const file = path.join(dir, "ready.csv")
    writeFileSync(file, "a,b\n1,2\n")
    const raw = await DataCatalog.registerRaw({
      accountId,
      title: "Public source",
      uri: file,
      connector: "local_fs",
    })
    const already = await DataCatalog.convertRaw({ id: raw.id, accountId })
    const ref = await DataCatalog.registerRaw({
      accountId: "acct-other",
      title: "Re-ingest",
      uri: `onedata://${already.id}`,
      connector: "onedata_ref",
    }).catch(() => undefined)
    expect(ref).toBeUndefined()
  })

  test("session chips stay per session and only accept owned raw ids", async () => {
    const dir = tempDir()
    const file = path.join(dir, "chip.csv")
    writeFileSync(file, "a\n1\n")
    const raw = await DataCatalog.registerRaw({
      accountId,
      title: "Chip raw",
      uri: file,
      connector: "local_fs",
    })

    expect(() => DataCatalog.putChips({
      sessionId: "ses_missing",
      accountId,
      raw_ids: [raw.id],
    })).toThrow()
  })

  test("session chips drop stale raw ids on read so join can succeed", async () => {
    const dir = tempDir()
    const keepFile = path.join(dir, "keep.csv")
    const goneFile = path.join(dir, "gone.csv")
    writeFileSync(keepFile, "a\n1\n")
    writeFileSync(goneFile, "b\n2\n")
    const keep = await DataCatalog.registerRaw({
      accountId,
      title: "Keep raw",
      uri: keepFile,
      connector: "local_fs",
    })
    const gone = await DataCatalog.registerRaw({
      accountId,
      title: "Gone raw",
      uri: goneFile,
      connector: "local_fs",
    })

    const sessionId = "ses_chip_stale_test"
    const projectId = "proj_chip_stale_test"
    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: projectId as never,
          worktree: dir,
          time_created: Date.now(),
          time_updated: Date.now(),
          sandboxes: [],
        })
        .onConflictDoNothing()
        .run()
      db.insert(SessionTable)
        .values({
          id: sessionId as never,
          project_id: projectId as never,
          slug: sessionId,
          directory: dir,
          title: "chip test",
          version: "0.0.0-test",
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .run()
    })

    expect(DataCatalog.putChips({ sessionId, accountId, raw_ids: [keep.id, gone.id] }).raw_ids.sort()).toEqual(
      [gone.id, keep.id].sort(),
    )
    DataCatalog.deleteRaw(gone.id, accountId)

    const cleaned = DataCatalog.getChips(sessionId, accountId)
    expect(cleaned.raw_ids).toEqual([keep.id])

    const nextFile = path.join(dir, "next.csv")
    writeFileSync(nextFile, "c\n3\n")
    const next = await DataCatalog.registerRaw({
      accountId,
      title: "Next raw",
      uri: nextFile,
      connector: "local_fs",
    })
    const merged = DataCatalog.putChips({
      sessionId,
      accountId,
      raw_ids: [...cleaned.raw_ids, next.id],
    })
    expect(merged.raw_ids.sort()).toEqual([keep.id, next.id].sort())
  })
})

describe("OneData catalog phase 1", () => {
  test("ingests via --raw and allows publishing workspace local_fs paths", async () => {
    const dir = tempDir()
    const file = path.join(dir, "ready.csv")
    writeFileSync(file, "a,b\n1,2\n")
    const raw = await DataCatalog.registerRaw({
      accountId,
      title: "Local csv",
      uri: file,
      connector: "local_fs",
    })
    const already = await DataCatalog.ingestAlready({
      accountId,
      rawIds: [raw.id],
      report: { name: "Processed csv", artifact_uri: file, format: "csv" },
    })
    expect(already.id.startsWith("alr_")).toBe(true)
    expect(already.build_method).toBe("agent")
    expect(already.source_raw_ids).toEqual([raw.id])
    expect(already.status).toBe("ready")

    const published = await DataCatalog.publishAlready(already.id, accountId)
    expect(published.visibility).toBe("public")

    await expect(DataCatalog.ingestAlready({
      accountId,
      report: { name: "No source", artifact_uri: file },
    })).rejects.toMatchObject({ status: 400 })
  })

  test("republish updates the same platform catalog row", async () => {
    const previous = process.env.ONECODE_PUBLIC_DATA_ROOT
    const root = tempDir()
    process.env.ONECODE_PUBLIC_DATA_ROOT = root
    try {
      const file = path.join(root, "public.csv")
      writeFileSync(file, "a,b\n1,2\n")
      const raw = await DataCatalog.registerRaw({
        accountId,
        title: "Public csv",
        uri: file,
        connector: "local_fs",
      })
      const already = await DataCatalog.convertRaw({ id: raw.id, accountId })
      await DataCatalog.publishAlready(already.id, accountId)
      DataCatalog.unpublishAlready(already.id, accountId)
      const again = await DataCatalog.publishAlready(already.id, accountId)
      expect(again.visibility).toBe("public")
      expect(OneScienceResource.list("datasets", { customOnly: true, accountId, limit: 100 }).items).toHaveLength(1)
    } finally {
      if (previous === undefined) delete process.env.ONECODE_PUBLIC_DATA_ROOT
      else process.env.ONECODE_PUBLIC_DATA_ROOT = previous
    }
  })

  test("leaf fs-sample puts already.json text in sample, not the stat object", async () => {
    const previous = process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY
    const root = tempDir()
    const file = path.join(root, ".onescience", "already.json")
    mkdirSync(path.dirname(file), { recursive: true })
    const body = JSON.stringify({ name: "Ready", artifact_uri: "./out.csv" })
    writeFileSync(file, body)
    process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY = root
    try {
      const sampled = await DataCatalog.leafFsSample(file)
      expect(sampled.sample).toBe(body)
      expect(JSON.parse(sampled.sample ?? "")).toEqual({ name: "Ready", artifact_uri: "./out.csv" })
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY
      else process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY = previous
    }
  })

  test("http probe refuses redirects to loopback or private hosts", async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => {
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } })
    }) as unknown as typeof fetch
    try {
      await expect(DataCatalog.probe({
        connector: "http_dataset",
        uri: "https://example.com/public.csv",
        accountId,
      })).rejects.toMatchObject({ status: 403 })
    } finally {
      globalThis.fetch = original
    }
  })

  test("token ingest without session or raw ids is rejected", async () => {
    const dir = tempDir()
    const file = path.join(dir, "token.csv")
    writeFileSync(file, "a\n1\n")
    await expect(DataCatalog.ingestAlready({
      accountId,
      viaToken: true,
      tokenWorkspaceId: "wrk_token",
      workspaceId: "wrk_token",
      report: { name: "Token", artifact_uri: file },
    })).rejects.toMatchObject({ status: 400 })
  })

  test("rejects seed ids and unpublished foreign alr_ in datasetRefs", async () => {
    expect(() => DataCatalog.assertAlreadyDatasetRefs({ datasetRefs: "seed-datasets-era5" }, accountId)).toThrow()
    const dir = tempDir()
    const file = path.join(dir, "train.csv")
    writeFileSync(file, "a,b\n1,2\n")
    const raw = await DataCatalog.registerRaw({
      accountId,
      title: "Train",
      uri: file,
      connector: "local_fs",
    })
    const already = await DataCatalog.convertRaw({ id: raw.id, accountId })
    expect(() => DataCatalog.assertAlreadyDatasetRefs({ datasetRefs: already.id }, accountId)).not.toThrow()
    expect(() => DataCatalog.assertAlreadyDatasetRefs({ datasetRefs: already.id }, "acct-other")).toThrow()
  })

  test("fs-stat refuses paths outside the serve working directory", () => {
    const previous = process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY
    const root = tempDir()
    process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY = root
    try {
      expect(() => DataCatalog.leafFsStat(path.join(os.tmpdir(), "outside-onedata.txt"))).toThrow()
      const inside = path.join(root, "inside.csv")
      writeFileSync(inside, "a\n1\n")
      expect(DataCatalog.leafFsStat(inside).exists).toBe(true)
      expect(DataCatalog.leafFsStat(path.join(root, "missing.csv")).exists).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY
      else process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY = previous
    }
  })
})

describe("OneData catalog phase 2", () => {
  test("stores object store keys as ciphertext and never returns the secret", () => {
    const previous = process.env.ONECODE_OBJECT_STORE_MASTER_KEY
    process.env.ONECODE_OBJECT_STORE_MASTER_KEY = Buffer.alloc(32, 9).toString("base64")
    try {
      const saved = DataCatalog.putObjectStoreKey({
        accountId,
        provider: "s3",
        access_key_id: "AKIAEXAMPLEKEYID",
        secret: "super-secret-value",
        region: "us-east-1",
      })
      expect(saved.access_key_id_suffix).toBe("EYID")
      expect(JSON.stringify(saved)).not.toContain("super-secret-value")
      expect(DataCatalog.listObjectStoreKeys(accountId).items).toHaveLength(1)
      expect(DataCatalog.listObjectStoreKeys(accountId).configured).toBe(true)
      expect(JSON.stringify(DataCatalog.listObjectStoreKeys(accountId))).not.toContain("super-secret-value")
    } finally {
      if (previous === undefined) delete process.env.ONECODE_OBJECT_STORE_MASTER_KEY
      else process.env.ONECODE_OBJECT_STORE_MASTER_KEY = previous
    }
  })

  test("refuses personal object URIs without a saved key", async () => {
    const previous = process.env.ONECODE_OBJECT_STORE_MASTER_KEY
    process.env.ONECODE_OBJECT_STORE_MASTER_KEY = Buffer.alloc(32, 9).toString("base64")
    try {
      await expect(DataCatalog.probe({
        connector: "object_store",
        uri: "s3://bucket/era5.zarr",
        accountId,
      })).rejects.toMatchObject({ status: 400, error: "bad_request" })
    } finally {
      if (previous === undefined) delete process.env.ONECODE_OBJECT_STORE_MASTER_KEY
      else process.env.ONECODE_OBJECT_STORE_MASTER_KEY = previous
    }
  })

  test("summarizes local zarr metadata without reading array payloads", async () => {
    const previous = process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY
    const root = tempDir()
    const zarr = path.join(root, "era5.zarr")
    mkdirSync(path.join(zarr, "temperature"), { recursive: true })
    writeFileSync(path.join(zarr, ".zgroup"), JSON.stringify({ zarr_format: 2 }))
    writeFileSync(path.join(zarr, "temperature", ".zarray"), JSON.stringify({
      zarr_format: 2,
      shape: [365, 180, 360],
      chunks: [1, 180, 360],
      dtype: "<f4",
    }))
    process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY = root
    try {
      const sampled = await DataCatalog.leafFsSample(zarr)
      expect(sampled.format_hint).toBe("zarr")
      expect(sampled.zarr_summary?.arrays).toEqual([
        { path: "temperature", shape: [365, 180, 360], dtype: "<f4", chunks: [1, 180, 360] },
      ])
      expect(sampled.sample).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY
      else process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY = previous
    }
  })

  test("directory fs-sample lists entries and samples a representative text file", async () => {
    const previous = process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY
    const root = tempDir()
    const dir = path.join(root, "bundle")
    mkdirSync(path.join(dir, "nested"), { recursive: true })
    writeFileSync(path.join(dir, "readme.md"), "# ignore\n")
    writeFileSync(path.join(dir, "meta.json"), '{"ok":true}\n')
    writeFileSync(path.join(dir, "nested", "rows.csv"), "a,b\n1,2\n")
    process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY = root
    try {
      const sampled = await DataCatalog.leafFsSample(dir)
      expect(sampled.is_dir).toBe(true)
      expect(sampled.format_hint).toBe("directory")
      expect(sampled.directory_listing?.entries.some((item) => item.path === "meta.json")).toBe(true)
      expect(sampled.directory_listing?.entries.some((item) => item.path === "nested/")).toBe(true)
      expect(sampled.sample_path).toBe("meta.json")
      expect(sampled.sample).toContain('"ok":true')
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY
      else process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY = previous
    }
  })

  test("leaf fs-sample renders xlsx sheets as TSV text", async () => {
    const previous = process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY
    const root = tempDir()
    const file = path.join(root, "table.xlsx")
    const { BlobWriter, TextReader, ZipWriter } = await import("@zip.js/zip.js")
    const writer = new ZipWriter(new BlobWriter())
    await writer.add(
      "xl/sharedStrings.xml",
      new TextReader(`<sst><si><t>city</t></si><si><t>beijing</t></si></sst>`),
    )
    await writer.add(
      "xl/worksheets/sheet1.xml",
      new TextReader(
        `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c></row></sheetData></worksheet>`,
      ),
    )
    writeFileSync(file, Buffer.from(await (await writer.close()).arrayBuffer()))
    process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY = root
    try {
      const sampled = await DataCatalog.leafFsSample(file)
      expect(sampled.format_hint).toBe("xlsx")
      expect(sampled.sample).toBe("city\nbeijing")
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY
      else process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY = previous
    }
  })

  test("leaf fs-sample previews fasta and pdf text", async () => {
    const previous = process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY
    const root = tempDir()
    const fasta = path.join(root, "seq.fasta")
    writeFileSync(fasta, ">seq1\nATGCATGC\n>seq2\nGGTTAACC\n")
    const pdf = path.join(root, "note.pdf")
    const stream = "BT /F1 24 Tf 50 100 Td (Catalog PDF) Tj ET\n"
    const objects = [
      "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
      "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
      "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n",
      `4 0 obj<< /Length ${stream.length} >>stream\n${stream}endstream\nendobj\n`,
      "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n",
    ]
    let body = "%PDF-1.4\n"
    const offsets = [0]
    for (const object of objects) {
      offsets.push(Buffer.byteLength(body, "latin1"))
      body += object
    }
    const xrefStart = Buffer.byteLength(body, "latin1")
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    for (let i = 1; i < offsets.length; i++) body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`
    body += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
    writeFileSync(pdf, body, "latin1")
    process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY = root
    try {
      const fastaSample = await DataCatalog.leafFsSample(fasta)
      expect(fastaSample.format_hint).toBe("fasta")
      expect(fastaSample.sample).toContain(">seq1")
      expect(fastaSample.sample).toContain("ATGCATGC")

      const pdfSample = await DataCatalog.leafFsSample(pdf)
      expect(pdfSample.format_hint).toBe("pdf")
      expect(pdfSample.sample).toContain("Catalog PDF")
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY
      else process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY = previous
    }
  })

  test("object store key APIs soft-disable without master key env", () => {
    const previous = process.env.ONECODE_OBJECT_STORE_MASTER_KEY
    delete process.env.ONECODE_OBJECT_STORE_MASTER_KEY
    try {
      expect(DataCatalog.listObjectStoreKeys(accountId)).toEqual({ items: [], configured: false })
      expect(() =>
        DataCatalog.putObjectStoreKey({
          accountId,
          provider: "s3",
          access_key_id: "AKIA",
          secret: "secret",
        }),
      ).toThrow(/未配置/)
    } finally {
      if (previous !== undefined) process.env.ONECODE_OBJECT_STORE_MASTER_KEY = previous
    }
  })
})

describe("OneData catalog completion", () => {
  test("reingest creates onedata_ref that cannot convert", async () => {
    const previous = process.env.ONECODE_PUBLIC_DATA_ROOT
    const root = tempDir()
    process.env.ONECODE_PUBLIC_DATA_ROOT = root
    try {
      const file = path.join(root, "public-re.csv")
      writeFileSync(file, "a,b\n1,2\n")
      const raw = await DataCatalog.registerRaw({
        accountId,
        title: "Public re",
        uri: file,
        connector: "local_fs",
      })
      const already = await DataCatalog.convertRaw({ id: raw.id, accountId })
      await DataCatalog.publishAlready(already.id, accountId)
      const ref = await DataCatalog.reingestAlready(already.id, "acct-other")
      expect(ref.connector).toBe("onedata_ref")
      await expect(DataCatalog.convertRaw({ id: ref.id, accountId: "acct-other" })).rejects.toMatchObject({
        status: 409,
      })
    } finally {
      if (previous === undefined) delete process.env.ONECODE_PUBLIC_DATA_ROOT
      else process.env.ONECODE_PUBLIC_DATA_ROOT = previous
    }
  })

  test("deleteAccountCatalog soft-deletes published onescience_resource cards", async () => {
    const previous = process.env.ONECODE_PUBLIC_DATA_ROOT
    const root = tempDir()
    process.env.ONECODE_PUBLIC_DATA_ROOT = root
    try {
      const file = path.join(root, "public-del.csv")
      writeFileSync(file, "a,b\n1,2\n")
      const raw = await DataCatalog.registerRaw({
        accountId,
        title: "Public delete",
        uri: file,
        connector: "local_fs",
      })
      const already = await DataCatalog.convertRaw({ id: raw.id, accountId })
      await DataCatalog.publishAlready(already.id, accountId)
      expect(OneScienceResource.list("datasets", { customOnly: true, accountId, limit: 100 }).items).toHaveLength(1)
      DataCatalog.deleteAccountCatalog(accountId)
      expect(OneScienceResource.list("datasets", { customOnly: true, accountId, limit: 100 }).items).toHaveLength(0)
      expect(DataCatalog.listAlready({ accountId, scope: "mine" }).items).toHaveLength(0)
      expect(DataCatalog.listRaw({ accountId }).items).toHaveLength(0)
    } finally {
      if (previous === undefined) delete process.env.ONECODE_PUBLIC_DATA_ROOT
      else process.env.ONECODE_PUBLIC_DATA_ROOT = previous
    }
  })

  test("unpublish and deleteAlready soft-delete onescience_resource cards", async () => {
    const previous = process.env.ONECODE_PUBLIC_DATA_ROOT
    const root = tempDir()
    process.env.ONECODE_PUBLIC_DATA_ROOT = root
    try {
      const file = path.join(root, "public-unpub.csv")
      writeFileSync(file, "a,b\n1,2\n")
      const raw = await DataCatalog.registerRaw({
        accountId,
        title: "Public unpub",
        uri: file,
        connector: "local_fs",
      })
      const already = await DataCatalog.convertRaw({ id: raw.id, accountId })
      await DataCatalog.publishAlready(already.id, accountId)
      expect(OneScienceResource.list("datasets", { customOnly: true, accountId, limit: 100 }).items).toHaveLength(1)
      DataCatalog.unpublishAlready(already.id, accountId)
      expect(OneScienceResource.list("datasets", { customOnly: true, accountId, limit: 100 }).items).toHaveLength(0)
      expect(DataCatalog.getAlready(already.id, { accountId }).visibility).toBe("private")

      await DataCatalog.publishAlready(already.id, accountId)
      expect(OneScienceResource.list("datasets", { customOnly: true, accountId, limit: 100 }).items).toHaveLength(1)
      DataCatalog.deleteAlready(already.id, accountId)
      expect(OneScienceResource.list("datasets", { customOnly: true, accountId, limit: 100 }).items).toHaveLength(0)
    } finally {
      if (previous === undefined) delete process.env.ONECODE_PUBLIC_DATA_ROOT
      else process.env.ONECODE_PUBLIC_DATA_ROOT = previous
    }
  })

  test("assertAlreadyDatasetRefs accepts owned ready and public ready", async () => {
    const previous = process.env.ONECODE_PUBLIC_DATA_ROOT
    const root = tempDir()
    process.env.ONECODE_PUBLIC_DATA_ROOT = root
    try {
      const file = path.join(root, "train-assert.csv")
      writeFileSync(file, "a,b\n1,2\n")
      const raw = await DataCatalog.registerRaw({
        accountId,
        title: "Assert",
        uri: file,
        connector: "local_fs",
      })
      const already = await DataCatalog.convertRaw({ id: raw.id, accountId })
      expect(() => DataCatalog.assertAlreadyDatasetRefs({ datasetRefs: already.id }, accountId)).not.toThrow()
      await DataCatalog.publishAlready(already.id, accountId)
      expect(() => DataCatalog.assertAlreadyDatasetRefs({ datasetRefs: already.id }, "acct-other")).not.toThrow()
    } finally {
      if (previous === undefined) delete process.env.ONECODE_PUBLIC_DATA_ROOT
      else process.env.ONECODE_PUBLIC_DATA_ROOT = previous
    }
  })
})

describe("OneData catalog database connector", () => {
  test("database connector cannot publish; convert materializes to local file", async () => {
    await withMasterKey(async () => {
      const previousDir = process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY
      const previousRoot = process.env.ONECODE_PUBLIC_DATA_ROOT
      const root = tempDir()
      process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY = root
      process.env.ONECODE_PUBLIC_DATA_ROOT = root
      try {
        mockPapersSql()
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
        const uri = DbConnection.formatDbTableUri("postgres", saved.id, "public", "papers")
        const raw = await DataCatalog.registerRaw({
          accountId,
          title: "Papers table",
          uri,
          connector: "database",
        })
        expect(raw.connector).toBe("database")
        expect(raw.format).toBe("table")
        expect(raw.uri).toBe(uri)

        const preview = await DataCatalog.previewRaw(raw.id, accountId)
        expect(preview.table_preview?.columns).toEqual(["id", "title"])
        expect(preview.table_preview?.rows).toHaveLength(3)

        const already = await DataCatalog.convertRaw({ id: raw.id, accountId })
        expect(already.connector).toBe("local_fs")
        expect(already.build_method).toBe("direct")
        expect(already.uri.endsWith(".csv")).toBe(true)
        expect(already.uri.includes(".onescience/db-export/")).toBe(true)
        expect(already.source_raw_ids).toEqual([raw.id])
        expect(already.status).toBe("ready")

        const published = await DataCatalog.publishAlready(already.id, accountId)
        expect(published.visibility).toBe("public")

        const { Database } = await import("@/storage/db")
        const { OneScienceDataArtifactTable } = await import("@/onescience/data-project.sql")
        const { eq } = await import("drizzle-orm")
        Database.use((db) => {
          db.update(OneScienceDataArtifactTable)
            .set({ connector: "database", uri, visibility: "private" })
            .where(eq(OneScienceDataArtifactTable.id, already.id))
            .run()
        })
        await expect(DataCatalog.publishAlready(already.id, accountId)).rejects.toMatchObject({
          status: 403,
        })
      } finally {
        if (previousDir === undefined) delete process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY
        else process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY = previousDir
        if (previousRoot === undefined) delete process.env.ONECODE_PUBLIC_DATA_ROOT
        else process.env.ONECODE_PUBLIC_DATA_ROOT = previousRoot
      }
    })
  })

  test("deleteDbConnection blocked while raw references it", async () => {
    await withMasterKey(async () => {
      mockPapersSql()
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
      const uri = DbConnection.formatDbTableUri("postgres", saved.id, "public", "papers")
      await DataCatalog.registerRaw({
        accountId,
        title: "Papers table",
        uri,
        connector: "database",
      })
      try {
        DbConnection.deleteDbConnection(accountId, saved.id)
        expect.unreachable()
      } catch (error) {
        expect(error).toMatchObject({ status: 409, error: "conflict" })
      }
    })
  })

  test("probe returns columns for empty database table", async () => {
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
            return Promise.resolve([{ column_name: "id" }, { column_name: "title" }, { column_name: "body" }])
          }
          if (query.includes("information_schema.tables") && query.includes("ORDER BY")) {
            return Promise.resolve([{ table_schema: "public", table_name: "empty_papers", table_type: "BASE TABLE" }])
          }
          if (query.includes("pg_class") || query.includes("reltuples")) {
            return Promise.resolve([{ entry_count: 0 }])
          }
          if (query.includes("SELECT *")) return Promise.resolve([])
          return Promise.resolve([{ ok: 1 }])
        },
        close() {
          return Promise.resolve()
        },
      }))
      const uri = DbConnection.formatDbTableUri("postgres", saved.id, "public", "empty_papers")
      const probed = await DataCatalog.probe({ connector: "database", uri, accountId })
      expect(probed.exists).toBe(true)
      expect(probed.columns).toEqual(["id", "title", "body"])
      expect(probed.entry_count).toBe(0)
    })
  })
})

