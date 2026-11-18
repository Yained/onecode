import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs"
import path from "path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { SessionSeed } from "@/session/session-seed"
import { MessageTable, PartTable, SessionTable } from "@/session/session.sql"
import { SessionID } from "@/session/schema"
import { Database } from "@/storage/db"
import { Global } from "@opencode-ai/core/global"
import { resetDatabase } from "../fixture/db"

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  const marker = path.join(Global.Path.data, SessionSeed.MARKER_FILE)
  if (existsSync(marker)) rmSync(marker, { force: true })
  await resetDatabase()
})

describe("SessionSeed", () => {
  test("resolveSeedRoot finds bundled source tree next to dist binary layout", () => {
    const seedRoot = SessionSeed.resolveSeedRoot()
    expect(seedRoot).toBeTruthy()
    expect(seedRoot!.replaceAll("\\", "/")).toContain("/session/session-seed")
    expect(existsSync(path.join(seedRoot!, "manifest.json"))).toBe(true)
  })

  test("resolveSeedRoot prefers OPENCODE_SESSION_SEED_ROOT when set", () => {
    const prev = process.env.OPENCODE_SESSION_SEED_ROOT
    const tmp = path.join(Global.Path.data, `session-seed-env-${Date.now()}`)
    mkdirSync(tmp, { recursive: true })
    writeFileSync(path.join(tmp, "manifest.json"), JSON.stringify({ sessions: [] }), "utf-8")
    process.env.OPENCODE_SESSION_SEED_ROOT = tmp
    try {
      expect(SessionSeed.resolveSeedRoot()).toBe(path.resolve(tmp))
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_SESSION_SEED_ROOT
      else process.env.OPENCODE_SESSION_SEED_ROOT = prev
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("seeds bundled default sessions into the default workspace on first run", () => {
    const result = SessionSeed.seedDefaults()
    expect(result.skipped).toBe(false)
    expect(result.seeded).toBeGreaterThan(0)
    expect(result.directory).toBeTruthy()

    const sessions = Database.use((db) =>
      db
        .select()
        .from(SessionTable)
        .where(eq(SessionTable.directory, result.directory!))
        .all(),
    )
    expect(sessions.length).toBeGreaterThan(0)
    expect(sessions.some((row) => row.title === "地球科学 · 海气融合预测模型搭建")).toBe(true)

    const messages = Database.use((db) => db.select().from(MessageTable).all())
    const parts = Database.use((db) => db.select().from(PartTable).all())
    expect(messages.length).toBeGreaterThan(0)
    expect(parts.length).toBeGreaterThan(0)
    expect(SessionSeed.readAppliedMarker()?.sessionIds.length).toBeGreaterThan(0)
  })

  test("does not seed again after the first application", () => {
    const first = SessionSeed.seedDefaults()
    expect(first.skipped).toBe(false)

    const second = SessionSeed.seedDefaults()
    expect(second.skipped).toBe(true)
    expect(second.reason).toBe("already-applied")
    expect(second.seeded).toBe(0)
  })

  test("imports manifest sessions missing from the database even when marker exists", () => {
    const seedRoot = SessionSeed.resolveSeedRoot()!
    const manifestPath = path.join(seedRoot, "manifest.json")
    const entries = JSON.parse(readFileSync(manifestPath, "utf-8")).sessions as Array<{
      folder: string
      sessionId: string
    }>
    expect(entries.length).toBeGreaterThan(1)

    const first = SessionSeed.seedDefaults()
    expect(first.skipped).toBe(false)

    const target = entries.find((entry) => entry.folder !== "earth_ocean_atmo_fusion_model") ?? entries[1]
    Database.use((db) =>
      db.delete(SessionTable).where(eq(SessionTable.id, target.sessionId as SessionID)).run(),
    )

    const markerPath = path.join(Global.Path.data, SessionSeed.MARKER_FILE)
    writeFileSync(
      markerPath,
      `${JSON.stringify(
        {
          version: 1,
          appliedAt: new Date().toISOString(),
          directory: first.directory,
          sessionIds: entries.filter((entry) => entry.sessionId !== target.sessionId).map((entry) => entry.sessionId),
        },
        null,
        2,
      )}\n`,
      "utf-8",
    )

    const second = SessionSeed.seedDefaults()
    expect(second.skipped).toBe(false)
    expect(second.seeded).toBe(1)

    const restored = Database.use((db) =>
      db.select().from(SessionTable).where(eq(SessionTable.id, target.sessionId as SessionID)).get(),
    )
    expect(restored).toBeTruthy()
  })

  test("restoreSession re-imports a deleted preset session by id", () => {
    const first = SessionSeed.seedDefaults()
    expect(first.skipped).toBe(false)
    expect(first.directory).toBeDefined()

    const sessionId = "ses_173de5f78ffemATonCgBtx7ECA"
    const before = Database.use((db) =>
      db.select().from(SessionTable).where(eq(SessionTable.id, sessionId as SessionID)).get(),
    )
    expect(before).toBeTruthy()

    Database.use((db) =>
      db.delete(SessionTable).where(eq(SessionTable.id, sessionId as SessionID)).run(),
    )

    const result = SessionSeed.restoreSession(sessionId)
    expect(result.restored).toBe(true)
    expect(result.sessionId).toBe(sessionId)
    expect(result.directory).toBe(first.directory!)

    const restored = Database.use((db) =>
      db.select().from(SessionTable).where(eq(SessionTable.id, sessionId as SessionID)).get(),
    )
    expect(restored).toBeTruthy()

    const messages = Database.use((db) =>
      db
        .select()
        .from(MessageTable)
        .where(eq(MessageTable.session_id, sessionId as SessionID))
        .all(),
    )
    expect(messages.length).toBeGreaterThan(0)
  })

  test("restoreSession creates stable scoped preset copies", () => {
    const first = SessionSeed.seedDefaults()
    expect(first.skipped).toBe(false)

    const sessionId = "ses_173de5f78ffemATonCgBtx7ECA"
    const workspaceA = path.join(Global.Path.data, "preset-workspace-a")
    const workspaceB = path.join(Global.Path.data, "preset-workspace-b")

    try {
      const restoredA = SessionSeed.restoreSession(sessionId, { directory: workspaceA, idScope: "acct-a" })
      const restoredAgain = SessionSeed.restoreSession(sessionId, { directory: workspaceA, idScope: "acct-a" })
      const restoredB = SessionSeed.restoreSession(sessionId, { directory: workspaceB, idScope: "acct-b" })

      expect(restoredA.sessionId).not.toBe(sessionId)
      expect(restoredAgain.sessionId).toBe(restoredA.sessionId)
      expect(restoredB.sessionId).not.toBe(restoredA.sessionId)
      expect(restoredA.directory).toBe(path.resolve(workspaceA))
      expect(restoredB.directory).toBe(path.resolve(workspaceB))

      const rowA = Database.use((db) =>
        db.select().from(SessionTable).where(eq(SessionTable.id, restoredA.sessionId as SessionID)).get(),
      )
      const rowB = Database.use((db) =>
        db.select().from(SessionTable).where(eq(SessionTable.id, restoredB.sessionId as SessionID)).get(),
      )
      const messagesA = Database.use((db) =>
        db
          .select()
          .from(MessageTable)
          .where(eq(MessageTable.session_id, restoredA.sessionId as SessionID))
          .all(),
      )
      const partsA = Database.use((db) =>
        db
          .select()
          .from(PartTable)
          .where(eq(PartTable.session_id, restoredA.sessionId as SessionID))
          .all(),
      )

      expect(rowA?.directory).toBe(path.resolve(workspaceA))
      expect(rowB?.directory).toBe(path.resolve(workspaceB))
      expect(messagesA.length).toBeGreaterThan(0)
      expect(partsA.length).toBeGreaterThan(0)
      expect(partsA.every((row) => row.session_id === restoredA.sessionId)).toBe(true)

      const marker = SessionSeed.readAppliedMarker()
      expect(marker?.directory).not.toBe(path.resolve(workspaceA))
      expect(marker?.sessionIds.includes(restoredA.sessionId)).toBe(false)

      const users = messagesA.filter((row) => (row.data as { role?: string }).role === "user")
      const assistants = messagesA.filter((row) => (row.data as { role?: string }).role === "assistant")
      expect(users.length).toBeGreaterThan(0)
      expect(assistants.length).toBeGreaterThan(0)
      const userIds = new Set(users.map((row) => String(row.id)))
      expect(
        assistants.every((row) => {
          const parentID = (row.data as { parentID?: string }).parentID
          return typeof parentID === "string" && userIds.has(parentID)
        }),
      ).toBe(true)
    } finally {
      rmSync(workspaceA, { recursive: true, force: true })
      rmSync(workspaceB, { recursive: true, force: true })
    }
  })

  test("restoreSession repairs a forked session that has no messages", () => {
    const sessionId = "ses_10346f0acffeC6AHvtobK5pHFs"
    const workspace = path.join(Global.Path.data, "preset-workspace-repair")
    mkdirSync(workspace, { recursive: true })
    try {
      const first = SessionSeed.restoreSession(sessionId, {
        directory: workspace,
        idScope: "acct-repair",
      })
      expect(first.restored).toBe(true)

      Database.use((db) => {
        db.delete(PartTable).where(eq(PartTable.session_id, first.sessionId as SessionID)).run()
        db.delete(MessageTable).where(eq(MessageTable.session_id, first.sessionId as SessionID)).run()
      })

      const repaired = SessionSeed.restoreSession(sessionId, {
        directory: workspace,
        idScope: "acct-repair",
      })
      expect(repaired.sessionId).toBe(first.sessionId)
      const messages = Database.use((db) =>
        db.select().from(MessageTable).where(eq(MessageTable.session_id, repaired.sessionId as SessionID)).all(),
      )
      expect(messages.length).toBeGreaterThan(0)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  test("restoreSession copies shared workspace files into the fork directory", () => {
    const first = SessionSeed.seedDefaults()
    expect(first.skipped).toBe(false)

    const sessionId = "ses_173de5f78ffemATonCgBtx7ECA"
    const sharedRoot = path.join(Global.Path.data, "shared-cases-fixture")
    const workspace = path.join(Global.Path.data, "preset-workspace-copy")
    mkdirSync(path.join(sharedRoot, "modelscope", "hub"), { recursive: true })
    writeFileSync(path.join(sharedRoot, "modelscope", "hub", "readme.txt"), "case fixture\n", "utf-8")
    writeFileSync(path.join(sharedRoot, "onescience.json"), "{}\n", "utf-8")

    try {
      const restored = SessionSeed.restoreSession(sessionId, {
        directory: workspace,
        idScope: "acct-copy",
        copyWorkspaceFrom: sharedRoot,
      })
      expect(restored.filesCopied).toBe(2)
      expect(existsSync(path.join(workspace, "onescience.json"))).toBe(true)
      expect(existsSync(path.join(workspace, "modelscope", "hub", "readme.txt"))).toBe(true)

      const again = SessionSeed.restoreSession(sessionId, {
        directory: workspace,
        idScope: "acct-copy",
        copyWorkspaceFrom: sharedRoot,
      })
      expect(again.sessionId).toBe(restored.sessionId)
      expect(again.filesCopied).toBe(0)
    } finally {
      rmSync(sharedRoot, { recursive: true, force: true })
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  test("restoreSession throws when the session id is not a preset", () => {
    expect(() => SessionSeed.restoreSession("ses_not_a_preset")).toThrow()
  })

  test("rewrites session directory to ONECODE_EXTRA_PATH/case when configured", async () => {
    const prev = process.env.ONECODE_EXTRA_PATH
    const extra = path.join(process.cwd(), `.test-extra-${Date.now()}`)
    process.env.ONECODE_EXTRA_PATH = extra
    await resetDatabase()
    try {
      const result = SessionSeed.seedDefaults()
      expect(result.directory).toBe(path.join(extra, "case"))

      const sessions = Database.use((db) =>
        db
          .select({ directory: SessionTable.directory })
          .from(SessionTable)
          .all(),
      )
      expect(sessions.length).toBeGreaterThan(0)
      expect(sessions.every((row) => row.directory === result.directory)).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.ONECODE_EXTRA_PATH
      else process.env.ONECODE_EXTRA_PATH = prev
      const marker = path.join(Global.Path.data, SessionSeed.MARKER_FILE)
      if (existsSync(marker)) rmSync(marker, { force: true })
      rmSync(extra, { recursive: true, force: true })
      await resetDatabase()
    }
  })
})
