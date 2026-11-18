import { accessSync, constants, cpSync, existsSync, mkdirSync, readdirSync, statSync } from "fs"
import os from "os"
import path from "path"

const app = "opencode"

function xdgDataHome() {
  if (process.env.XDG_DATA_HOME) return process.env.XDG_DATA_HOME
  if (process.platform === "win32") return process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support")
  return path.join(os.homedir(), ".local", "share")
}

export class ExtraDataPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ExtraDataPathError"
  }
}

export function dataDir(xdgData: string) {
  return path.join(xdgData, app)
}

export function extraXdgDataHome(extraRoot: string) {
  return path.join(path.resolve(extraRoot), ".local", "share")
}

export function extraDataDir(extraRoot: string) {
  return dataDir(extraXdgDataHome(extraRoot))
}

export function defaultDataDir() {
  return dataDir(xdgDataHome())
}

export function resolveDataHome() {
  const extra = process.env.ONECODE_EXTRA_PATH?.trim()
  if (extra) return extraDataDir(extra)
  return defaultDataDir()
}

function hasDatabase(dir: string) {
  if (!existsSync(dir)) return false
  return readdirSync(dir).some((name) => name.endsWith(".db") && !name.endsWith(".db-shm") && !name.endsWith(".db-wal"))
}

function hasContent(dir: string) {
  if (!existsSync(dir)) return false
  return readdirSync(dir).length > 0
}

export function validateRoot(input: string) {
  const trimmed = input.trim()
  if (!trimmed) throw new ExtraDataPathError("ONECODE_EXTRA_PATH is empty")

  if (trimmed.includes("\0")) throw new ExtraDataPathError("ONECODE_EXTRA_PATH contains invalid characters")

  const resolved = path.resolve(trimmed)
  if (!path.isAbsolute(resolved)) throw new ExtraDataPathError(`ONECODE_EXTRA_PATH must resolve to an absolute path: ${resolved}`)

  if (existsSync(resolved) && !statSync(resolved).isDirectory()) {
    throw new ExtraDataPathError(`ONECODE_EXTRA_PATH must be a directory: ${resolved}`)
  }

  mkdirSync(resolved, { recursive: true })

  try {
    accessSync(resolved, constants.W_OK)
  } catch {
    throw new ExtraDataPathError(`ONECODE_EXTRA_PATH is not writable: ${resolved}`)
  }

  return resolved
}

export function needsDataMigration(source: string, target: string) {
  if (source === target) return false
  if (!hasContent(source)) return false
  if (hasDatabase(target)) return false
  return true
}

export function migrateData(source: string, target: string) {
  mkdirSync(path.dirname(target), { recursive: true })

  if (!existsSync(target)) {
    cpSync(source, target, { recursive: true, force: false })
    return
  }

  for (const entry of readdirSync(source)) {
    const from = path.join(source, entry)
    const to = path.join(target, entry)
    if (existsSync(to)) continue
    cpSync(from, to, { recursive: true, force: false })
  }
}

export function bootstrapExtraDataHome() {
  const raw = process.env.ONECODE_EXTRA_PATH
  if (!raw?.trim()) return

  const root = validateRoot(raw)
  const source = defaultDataDir()
  const target = extraDataDir(root)
  mkdirSync(extraXdgDataHome(root), { recursive: true })
  mkdirSync(target, { recursive: true })

  if (needsDataMigration(source, target)) {
    process.stderr.write(`Migrating opencode data from ${source} to ${target}...` + "\n")
    migrateData(source, target)
    process.stderr.write("Opencode data migration complete." + "\n")
  }

  process.env.XDG_DATA_HOME = extraXdgDataHome(root)
}

export * as ExtraData from "./extra-data"
