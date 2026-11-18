import { createHash } from "crypto"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { OneScienceCodeDefaultDirectory } from "@opencode-ai/core/onescience-code-default-directory"
import * as Log from "@opencode-ai/core/util/log"
import { resolveBundledPackageRoot } from "@/oneskills/bootstrap-bundled"
import { ProjectID } from "@/project/schema"
import { WorkspaceID } from "@/control-plane/schema"
import { Database } from "@/storage/db"
import { eq } from "drizzle-orm"
import { ProjectTable } from "@/project/project.sql"
import {
  MessageTable,
  PartTable,
  SessionMessageTable,
  SessionTable,
  TodoTable,
} from "./session.sql"
import { MessageID, PartID, SessionID } from "./schema"
import type { SessionMessage } from "../v2/session-message"

const log = Log.create({ service: "session-seed" })

export const BUNDLED_SEED_RELATIVE = ".opencode/session-seed"
export const MARKER_FILE = "session-seed.applied.json"
export const MARKER_VERSION = 1

type ManifestEntry = {
  folder: string
  sessionId: string
  title: string
  sourceDirectory?: string
  directoryRewrite?: string
}

type Manifest = {
  sessions: ManifestEntry[]
}

type AppliedMarker = {
  version: number
  appliedAt: string
  directory: string
  sessionIds: string[]
}

type SeedResult = {
  skipped: boolean
  reason?: "already-applied" | "missing-seed-root" | "empty-manifest"
  seeded: number
  directory?: string
  sessionIds: string[]
}

type RestoreResult = {
  restored: boolean
  sessionId: string
  directory: string
  filesCopied: number
}

type RestoreOptions = {
  directory?: string
  idScope?: string
  /** Copy workspace files from the shared cases root into the fork target directory. */
  copyWorkspaceFrom?: string
}

type ImportOptions = {
  idScope?: string
}

class SessionSeedError extends Error {}

function readJsonFile<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf-8")) as T
}

function readManifest(seedRoot: string) {
  return readJsonFile<Manifest>(path.join(seedRoot, "manifest.json"))
}

function readOptionalJsonFile<T>(file: string): T[] {
  if (!existsSync(file)) return []
  const data = readJsonFile<T[]>(file)
  return Array.isArray(data) ? data : []
}

function scopedSeedID(prefix: "ses" | "msg" | "prt" | "evt", scope: string | undefined, id: string) {
  if (!scope) return id
  return `${prefix}_${createHash("sha256").update(`${scope}\0${id}`).digest("hex").slice(0, 26)}`
}

function parseDbJson<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T
  return value as T
}

function hasSeedManifest(candidate: string) {
  return existsSync(path.join(candidate, "manifest.json"))
}

function electronResourcesPath() {
  const value = (process as { resourcesPath?: unknown }).resourcesPath
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function resolveFromExecPath() {
  let current = path.resolve(path.dirname(process.execPath))
  for (let depth = 0; depth < 10; depth++) {
    const candidates = [
      path.join(current, "packages/opencode/src/session/session-seed"),
      path.join(current, "src/session/session-seed"),
      path.join(current, BUNDLED_SEED_RELATIVE),
      // Desktop extraResources layout: <resources>/session-seed
      path.join(current, "session-seed"),
      path.join(current, "resources", "session-seed"),
    ]
    for (const candidate of candidates) {
      if (hasSeedManifest(candidate)) return candidate
    }

    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return undefined
}

export function resolveSeedRoot() {
  // Desktop main process injects this for the packaged sidecar (resources/session-seed).
  const fromEnv = process.env.OPENCODE_SESSION_SEED_ROOT?.trim()
  if (fromEnv) {
    const resolved = path.resolve(fromEnv)
    if (hasSeedManifest(resolved)) return resolved
  }

  const source = path.join(import.meta.dirname, "session-seed")
  if (hasSeedManifest(source)) return source

  const fromExec = resolveFromExecPath()
  if (fromExec) return fromExec

  const resourcesPath = electronResourcesPath()
  if (resourcesPath) {
    const packaged = path.join(resourcesPath, "session-seed")
    if (hasSeedManifest(packaged)) return packaged
  }

  const packageRoot = resolveBundledPackageRoot()
  if (packageRoot) {
    // Electron packs seed as flat resources/session-seed (not .opencode/session-seed).
    const flat = path.join(packageRoot, "session-seed")
    if (hasSeedManifest(flat)) return flat
    const bundled = path.join(packageRoot, BUNDLED_SEED_RELATIVE)
    if (hasSeedManifest(bundled)) return bundled
  }

  const root = process.env.ONECODE_ROOT?.trim()
  if (root) {
    const fromRoot = path.join(path.resolve(root), "packages/opencode/src/session/session-seed")
    if (hasSeedManifest(fromRoot)) return fromRoot
  }

  return undefined
}

function markerPath() {
  return path.join(Global.Path.data, MARKER_FILE)
}

export function readAppliedMarker(): AppliedMarker | undefined {
  const file = markerPath()
  if (!existsSync(file)) return undefined
  try {
    return readJsonFile<AppliedMarker>(file)
  } catch {
    return undefined
  }
}

function writeAppliedMarker(input: { directory: string; sessionIds: string[] }) {
  mkdirSync(Global.Path.data, { recursive: true })
  const marker: AppliedMarker = {
    version: MARKER_VERSION,
    appliedAt: new Date().toISOString(),
    directory: input.directory,
    sessionIds: input.sessionIds,
  }
  writeFileSync(markerPath(), `${JSON.stringify(marker, null, 2)}\n`, "utf-8")
}

function ensureGlobalProject() {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({
        id: ProjectID.global,
        worktree: "/",
        time_created: now,
        time_updated: now,
        sandboxes: [],
      })
      .onConflictDoNothing()
      .run(),
  )
}

function sessionExists(sessionId: string) {
  return Database.use(
    (db) => db.select({ id: SessionTable.id }).from(SessionTable).where(eq(SessionTable.id, sessionId as SessionID)).get(),
  )
}

function countSessionMessages(sessionId: string) {
  return Database.use(
    (db) =>
      db
        .select({ id: MessageTable.id })
        .from(MessageTable)
        .where(eq(MessageTable.session_id, sessionId as SessionID))
        .all().length,
  )
}

function clearSessionContents(sessionId: string) {
  Database.transaction((db) => {
    db.delete(PartTable).where(eq(PartTable.session_id, sessionId as SessionID)).run()
    db.delete(MessageTable).where(eq(MessageTable.session_id, sessionId as SessionID)).run()
    db.delete(SessionMessageTable).where(eq(SessionMessageTable.session_id, sessionId as SessionID)).run()
    db.delete(TodoTable).where(eq(TodoTable.session_id, sessionId as SessionID)).run()
  })
}

function seedFolder(seedRoot: string, entry: ManifestEntry) {
  const folder = path.join(seedRoot, entry.folder)
  if (!existsSync(folder)) {
    throw new SessionSeedError(`session seed folder not found: ${folder}`)
  }
  return folder
}


function workspaceDirectoryKey(directory: string) {
  return directory.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
}

const WORKSPACE_COPY_SKIP = new Set([".git", "node_modules", ".opencode"])

/** Deep-merge shared-case workspace files into the personal fork directory (fill missing paths only). */
export function copyWorkspaceFiles(from: string, to: string) {
  const source = path.resolve(from)
  const target = path.resolve(to)
  if (workspaceDirectoryKey(source) === workspaceDirectoryKey(target)) {
    return { copied: 0, skipped: true as const, reason: "same-path" as const }
  }
  if (!existsSync(source) || !statSync(source).isDirectory()) {
    return { copied: 0, skipped: true as const, reason: "missing-source" as const }
  }

  mkdirSync(target, { recursive: true })
  let copied = 0

  const walk = (srcDir: string, dstDir: string) => {
    for (const entry of readdirSync(srcDir)) {
      if (WORKSPACE_COPY_SKIP.has(entry)) continue
      const src = path.join(srcDir, entry)
      const dst = path.join(dstDir, entry)
      const stat = statSync(src)
      if (stat.isDirectory()) {
        mkdirSync(dst, { recursive: true })
        walk(src, dst)
        continue
      }
      if (existsSync(dst)) continue
      mkdirSync(path.dirname(dst), { recursive: true })
      cpSync(src, dst, { recursive: false, force: false })
      copied++
    }
  }

  walk(source, target)
  log.info("copied case workspace files", { from: source, to: target, copied })
  return { copied, skipped: false as const }
}

/** Keep seeded sessions pointed at the current desktop/data-root case directory. */
function realignSessionDirectory(sessionId: string, directory: string) {
  const row = Database.use(
    (db) =>
      db
        .select({ directory: SessionTable.directory })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionId as SessionID))
        .get(),
  )
  if (!row || workspaceDirectoryKey(row.directory) === workspaceDirectoryKey(directory)) return false
  Database.use((db) =>
    db.update(SessionTable).set({ directory }).where(eq(SessionTable.id, sessionId as SessionID)).run(),
  )
  log.info("realigned seeded session directory", { sessionId, from: row.directory, to: directory })
  return true
}

function remapScopedMessageData(data: unknown, idScope?: string) {
  const parsed = parseDbJson<Record<string, unknown>>(data)
  if (typeof parsed.parentID !== "string") {
    return parseDbJson<(typeof MessageTable.$inferInsert)["data"]>(data)
  }
  const { id: _id, sessionID: _sessionID, ...rest } = parsed
  return {
    ...rest,
    parentID: scopedSeedID("msg", idScope, parsed.parentID),
  } as (typeof MessageTable.$inferInsert)["data"]
}

function remapScopedPartData(data: unknown, idScope?: string) {
  const parsed = parseDbJson<Record<string, unknown>>(data)
  if (parsed.type !== "compaction" || typeof parsed.tail_start_id !== "string") {
    return parseDbJson<(typeof PartTable.$inferInsert)["data"]>(data)
  }
  const { id: _id, sessionID: _sessionID, messageID: _messageID, ...rest } = parsed
  return {
    ...rest,
    type: parsed.type,
    tail_start_id: scopedSeedID("msg", idScope, parsed.tail_start_id),
  } as (typeof PartTable.$inferInsert)["data"]
}

function importSession(folder: string, directory: string, options: ImportOptions = {}) {
  const sessionFile = path.join(folder, "session.json")
  const sessions = readJsonFile<Record<string, unknown>[]>(sessionFile)
  const session = sessions[0]
  if (!session || typeof session.id !== "string") {
    throw new Error(`invalid session seed file: ${sessionFile}`)
  }

  const sessionId = scopedSeedID("ses", options.idScope, session.id)
  const expectedMessages = readOptionalJsonFile<Record<string, unknown>>(path.join(folder, "messages.json")).length
  if (sessionExists(sessionId)) {
    realignSessionDirectory(sessionId, directory)
    const existingMessages = countSessionMessages(sessionId)
    // Repair incomplete forks (session row without message body).
    if (existingMessages === 0 && expectedMessages > 0) {
      log.warn("reimport empty seeded session contents", { sessionId, expectedMessages })
      clearSessionContents(sessionId)
      importSessionContents(folder, sessionId, options)
      return { sessionId, seeded: true as const }
    }
    if (existingMessages > 0 && existingMessages < expectedMessages) {
      log.warn("reimport incomplete seeded session contents", {
        sessionId,
        existingMessages,
        expectedMessages,
      })
      clearSessionContents(sessionId)
      importSessionContents(folder, sessionId, options)
      return { sessionId, seeded: true as const }
    }
    log.info("skip existing seeded session", { sessionId, existingMessages })
    return { sessionId, seeded: false as const }
  }

  const sessionRow = {
    id: sessionId as SessionID,
    project_id: (session.project_id as ProjectID | undefined) ?? ProjectID.global,
    workspace_id: (session.workspace_id as WorkspaceID | null | undefined) ?? null,
    parent_id:
      typeof session.parent_id === "string"
        ? scopedSeedID("ses", options.idScope, session.parent_id) as SessionID
        : null,
    slug: String(session.slug ?? sessionId),
    directory,
    // Forked sessions should not keep the original private export path.
    path: options.idScope ? null : ((session.path as string | null | undefined) ?? null),
    title: String(session.title ?? sessionId),
    version: String(session.version ?? "0.0.0"),
    share_url: (session.share_url as string | null | undefined) ?? null,
    summary_additions: (session.summary_additions as number | null | undefined) ?? null,
    summary_deletions: (session.summary_deletions as number | null | undefined) ?? null,
    summary_files: (session.summary_files as number | null | undefined) ?? null,
    summary_diffs: session.summary_diffs ? parseDbJson<(typeof SessionTable.$inferInsert)["summary_diffs"]>(session.summary_diffs) : null,
    cost: Number(session.cost ?? 0),
    tokens_input: Number(session.tokens_input ?? 0),
    tokens_output: Number(session.tokens_output ?? 0),
    tokens_reasoning: Number(session.tokens_reasoning ?? 0),
    tokens_cache_read: Number(session.tokens_cache_read ?? 0),
    tokens_cache_write: Number(session.tokens_cache_write ?? 0),
    revert: session.revert ? parseDbJson<(typeof SessionTable.$inferInsert)["revert"]>(session.revert) : null,
    permission: session.permission ? parseDbJson<(typeof SessionTable.$inferInsert)["permission"]>(session.permission) : null,
    agent: (session.agent as string | null | undefined) ?? null,
    model: session.model ? parseDbJson<(typeof SessionTable.$inferInsert)["model"]>(session.model) : null,
    time_created: Number(session.time_created ?? Date.now()),
    time_updated: Number(session.time_updated ?? Date.now()),
    time_compacting: (session.time_compacting as number | null | undefined) ?? null,
    time_archived: (session.time_archived as number | null | undefined) ?? null,
  } satisfies typeof SessionTable.$inferInsert

  Database.transaction((db) => {
    db.insert(SessionTable).values(sessionRow).run()
  })
  importSessionContents(folder, sessionId, options)

  return { sessionId, seeded: true as const }
}

function importSessionContents(folder: string, sessionId: string, options: ImportOptions = {}) {
  Database.transaction((db) => {
    for (const row of readOptionalJsonFile<Record<string, unknown>>(path.join(folder, "messages.json"))) {
      const messageId = scopedSeedID("msg", options.idScope, String(row.id)) as MessageID
      db
        .insert(MessageTable)
        .values({
          id: messageId,
          session_id: sessionId as SessionID,
          time_created: Number(row.time_created ?? Date.now()),
          time_updated: Number(row.time_updated ?? Date.now()),
          data: remapScopedMessageData(row.data, options.idScope),
        })
        .run()
    }

    for (const row of readOptionalJsonFile<Record<string, unknown>>(path.join(folder, "parts.json"))) {
      const messageId = scopedSeedID("msg", options.idScope, String(row.message_id)) as MessageID
      const partId = scopedSeedID("prt", options.idScope, String(row.id)) as PartID
      db
        .insert(PartTable)
        .values({
          id: partId,
          message_id: messageId,
          session_id: sessionId as SessionID,
          time_created: Number(row.time_created ?? Date.now()),
          time_updated: Number(row.time_updated ?? Date.now()),
          data: remapScopedPartData(row.data, options.idScope),
        })
        .run()
    }

    for (const row of readOptionalJsonFile<Record<string, unknown>>(path.join(folder, "session_message.json"))) {
      db
        .insert(SessionMessageTable)
        .values({
          id: scopedSeedID("evt", options.idScope, String(row.id)) as SessionMessage.ID,
          session_id: sessionId as SessionID,
          type: row.type as SessionMessage.Type,
          time_created: Number(row.time_created ?? Date.now()),
          time_updated: Number(row.time_updated ?? Date.now()),
          data: parseDbJson(row.data),
        })
        .run()
    }

    for (const row of readOptionalJsonFile<Record<string, unknown>>(path.join(folder, "todo.json"))) {
      db
        .insert(TodoTable)
        .values({
          session_id: sessionId as SessionID,
          content: String(row.content ?? ""),
          status: String(row.status ?? "pending"),
          priority: String(row.priority ?? "medium"),
          position: Number(row.position ?? 0),
          time_created: Number(row.time_created ?? Date.now()),
          time_updated: Number(row.time_updated ?? Date.now()),
        })
        .run()
    }
  })
}

export function seedDefaults() {
  const seedRoot = resolveSeedRoot()
  if (!seedRoot) {
    log.warn("skip session seed; seed root not found", {
      execPath: process.execPath,
      onecodeRoot: process.env.ONECODE_ROOT,
      sessionSeedRoot: process.env.OPENCODE_SESSION_SEED_ROOT,
      resourcesPath: electronResourcesPath(),
    })
    return { skipped: true, reason: "missing-seed-root", seeded: 0, sessionIds: [] } satisfies SeedResult
  }

  const manifest = readManifest(seedRoot)
  if (!manifest.sessions?.length) {
    log.info("skip session seed; manifest is empty", { seedRoot })
    return { skipped: true, reason: "empty-manifest", seeded: 0, sessionIds: [] } satisfies SeedResult
  }

  const existingMarker = readAppliedMarker()
  const directory = OneScienceCodeDefaultDirectory.resolve()
  OneScienceCodeDefaultDirectory.ensureDirectory(directory)
  ensureGlobalProject()

  const processedIds: string[] = []
  let seeded = 0

  for (const entry of manifest.sessions) {
    const result = importSession(seedFolder(seedRoot, entry), directory)
    processedIds.push(result.sessionId)
    if (result.seeded) seeded++
  }

  const sessionIds = [
    ...new Set([
      ...(existingMarker?.sessionIds ?? []),
      ...manifest.sessions.map((entry) => entry.sessionId),
      ...processedIds,
    ]),
  ]

  writeAppliedMarker({ directory, sessionIds })

  if (seeded === 0) {
    log.info("session seed up to date", { seedRoot, directory, sessionIds, hadMarker: Boolean(existingMarker) })
    return {
      skipped: true,
      reason: "already-applied",
      seeded: 0,
      directory,
      sessionIds,
    } satisfies SeedResult
  }

  log.info("session seed applied", { seedRoot, directory, seeded, sessionIds })
  return { skipped: false, seeded, directory, sessionIds } satisfies SeedResult
}

export function restoreSession(sessionId: string, options: RestoreOptions = {}): RestoreResult {
  const seedRoot = resolveSeedRoot()
  if (!seedRoot) {
    throw new SessionSeedError("session seed root not found")
  }

  const manifest = readManifest(seedRoot)
  const entry = manifest.sessions?.find((item) => item.sessionId === sessionId)
  if (!entry) {
    throw new SessionSeedError(`preset session not found in manifest: ${sessionId}`)
  }

  const directory = options.directory ? path.resolve(options.directory) : OneScienceCodeDefaultDirectory.resolve()
  OneScienceCodeDefaultDirectory.ensureDirectory(directory)
  ensureGlobalProject()

  const result = importSession(seedFolder(seedRoot, entry), directory, { idScope: options.idScope ?? (options.directory ? directory : undefined) })
  if (!result.seeded && !sessionExists(result.sessionId)) {
    throw new SessionSeedError(`failed to restore preset session: ${sessionId}`)
  }

  let filesCopied = 0
  if (options.copyWorkspaceFrom) {
    filesCopied = copyWorkspaceFiles(options.copyWorkspaceFrom, directory).copied
  }

  // Only refresh the shared seed marker when restoring the shared catalog.
  // Forks must not rewrite it — that previously pointed the marker at a personal
  // case directory and mixed scoped fork IDs into shared seed bookkeeping.
  if (!options.idScope) {
    const existingMarker = readAppliedMarker()
    const sessionIds = [
      ...new Set([...(existingMarker?.sessionIds ?? []), result.sessionId, sessionId]),
    ]
    writeAppliedMarker({ directory, sessionIds })
  }

  log.info("session seed restored", {
    sessionId: result.sessionId,
    sourceSessionId: sessionId,
    directory,
    seeded: result.seeded,
    filesCopied,
  })
  return { restored: true, sessionId: result.sessionId, directory, filesCopied }
}

export * as SessionSeed from "./session-seed"
