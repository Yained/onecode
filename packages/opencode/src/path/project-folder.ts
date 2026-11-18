import fs from "fs/promises"
import path from "path"

export type ProjectDataDirectoryEntry = {
  name: string
  absolute: string
}

function normalizeDisplayPath(input: string) {
  const normalized = input.trim().replace(/\\/g, "/")
  if (!normalized) return normalized
  if (normalized === "/") return normalized
  if (/^[A-Za-z]:\/?$/.test(normalized)) return normalized.slice(0, 2) + "/"
  return normalized.replace(/\/+$/, "")
}

function joinDisplayPath(root: string, relative: string) {
  const base = normalizeDisplayPath(root)
  if (!relative) return base
  if (base.endsWith("/")) return `${base}${relative}`
  return `${base}/${relative}`
}

function isInsideDisplayRoot(root: string, target: string) {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
}

export function projectDataRoot(root?: string) {
  return normalizeDisplayPath(root ?? process.env.ONECODE_EXTRA_PATH?.trim() ?? "/data")
}

export function sanitizeProjectFolderPath(name: string) {
  const trimmed = name.trim().replace(/\\/g, "/")
  if (!trimmed) return undefined
  const segments = trimmed.split("/").filter(Boolean)
  if (segments.length === 0) return undefined
  for (const segment of segments) {
    if (segment === "." || segment === "..") return undefined
  }
  return segments.join("/")
}

export function resolveProjectFolderPath(name: string, root = projectDataRoot()) {
  const base = projectDataRoot(root)
  const relative = sanitizeProjectFolderPath(name)
  if (!relative) return undefined
  const resolved = joinDisplayPath(base, relative)
  if (!isInsideDisplayRoot(base, resolved)) return undefined
  return resolved
}

/**
 * True when `relative` looks like a path cut against a parent of `root` (e.g. against
 * `/data` while mkdir joins under the account workspace). Independent of terminal isolation.
 */
export function wouldNestProjectFolder(root: string, relative: string) {
  const base = normalizeDisplayPath(root)
  const rel = sanitizeProjectFolderPath(relative)
  if (!base || !rel || base === "/") return false
  const parts = base.split("/").filter(Boolean)
  // Any non-trivial suffix of the workspace root appearing as the relative prefix
  // means the client used a shallower base (e.g. /data) when computing the name.
  for (let i = 0; i < parts.length - 1; i++) {
    const suffix = parts.slice(i).join("/")
    if (rel === suffix || rel.startsWith(`${suffix}/`)) return true
  }
  return false
}

export function resolveProjectDataAbsolutePath(relative?: string, root = projectDataRoot()) {
  const base = projectDataRoot(root)
  if (!relative?.trim()) return base
  const sanitized = sanitizeProjectFolderPath(relative)
  if (!sanitized) return undefined
  const resolved = joinDisplayPath(base, sanitized)
  if (!isInsideDisplayRoot(base, resolved)) return undefined
  return resolved
}

export async function listProjectDataSubdirectories(relative = "", root = projectDataRoot()) {
  const directory = resolveProjectDataAbsolutePath(relative, root)
  if (!directory) return [] as ProjectDataDirectoryEntry[]

  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => ({
      name: entry.name,
      absolute: path.join(directory, entry.name).replace(/\\/g, "/"),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
