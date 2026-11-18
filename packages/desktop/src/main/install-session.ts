import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { app } from "electron"
import {
  ONECODE_BUILD_FILE,
  readBuildInfoFile,
  resolveInstallIdentity,
} from "../../../core/src/install-identity"
import { CONFIRMED_INSTALL_TOKEN_KEY, SETUP_COMPLETE_KEY } from "./constants"
import { getStore } from "./store"

const INSTALL_MARKER = "onecode-desktop-install.marker"

function parseMarker(content: string): { installToken?: string; version?: string } {
  const result: { installToken?: string; version?: string } = {}
  for (const line of content.split(/\r?\n/)) {
    const idx = line.indexOf("=")
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (!value) continue
    if (key === "installToken") result.installToken = value
    if (key === "version") result.version = value
  }
  return result
}

function installDirCandidates(): string[] {
  const exe = app.getPath("exe")
  const exeDir = dirname(exe)
  const candidates = [exeDir]
  if (app.isPackaged) {
    // resources/.. is the install root for electron-builder layouts
    candidates.push(dirname(process.resourcesPath))
    candidates.push(join(process.resourcesPath, ".."))
  }
  return [...new Set(candidates.map((item) => join(item)))]
}

export function readInstallMarker(): { installToken?: string; version?: string; path?: string } {
  for (const dir of installDirCandidates()) {
    const file = join(dir, INSTALL_MARKER)
    if (!existsSync(file)) continue
    try {
      const parsed = parseMarker(readFileSync(file, "utf8"))
      return { ...parsed, path: file }
    } catch {
      continue
    }
  }
  return {}
}

export function resolveDesktopInstallIdentity(): string {
  const marker = readInstallMarker()
  if (marker.version) return marker.version

  const searchRoots = [
    process.resourcesPath,
    join(process.resourcesPath, ".."),
    dirname(app.getPath("exe")),
  ].filter(Boolean)

  return resolveInstallIdentity({
    searchRoots,
    packageVersion: app.getVersion(),
    envVersion: process.env.OPENCODE_VERSION,
  })
}

/** Session token that changes on every NSIS install/upgrade. */
export function resolveDesktopInstallToken(): string {
  const marker = readInstallMarker()
  if (marker.installToken) return marker.installToken
  // Dev / non-NSIS: fall back to build identity so version bumps still re-prompt.
  return `identity:${resolveDesktopInstallIdentity()}`
}

export function isDesktopSetupComplete(): boolean {
  const store = getStore()
  const confirmed = store.get(CONFIRMED_INSTALL_TOKEN_KEY)
  const token = resolveDesktopInstallToken()
  if (typeof confirmed !== "string" || confirmed !== token) return false
  const value = store.get(SETUP_COMPLETE_KEY)
  return value === true || value === "true"
}

export function markDesktopSetupComplete(complete: boolean) {
  const store = getStore()
  store.set(SETUP_COMPLETE_KEY, complete)
  if (complete) {
    store.set(CONFIRMED_INSTALL_TOKEN_KEY, resolveDesktopInstallToken())
  } else {
    store.delete(CONFIRMED_INSTALL_TOKEN_KEY)
  }
}

export function desktopBuildInfoPath() {
  return join(process.resourcesPath, ONECODE_BUILD_FILE)
}

export function readDesktopBuildInfo() {
  return readBuildInfoFile(desktopBuildInfoPath())
}
