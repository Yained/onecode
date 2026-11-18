import { uuid } from "./uuid"

export const defaultProjectDataRoot = "/data"

export function projectDataRoot(path?: { project_data_root?: string }) {
  return path?.project_data_root?.trim() || defaultProjectDataRoot
}

export function normalizeAbsolutePath(input: string) {
  const value = input.replaceAll("\\", "/").replace(/\/+$/, "")
  return value || "/"
}

export function isWithinProjectDataRoot(target: string, root: string) {
  const normalized = normalizeAbsolutePath(target)
  const normalizedRoot = normalizeAbsolutePath(root)
  return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`)
}

export function clampToProjectDataRoot(target: string, root: string) {
  return isWithinProjectDataRoot(target, root) ? normalizeAbsolutePath(target) : normalizeAbsolutePath(root)
}

export function relativeProjectFolderPath(directory: string, root: string) {
  const normalized = normalizeAbsolutePath(directory)
  const normalizedRoot = normalizeAbsolutePath(root)
  if (!isWithinProjectDataRoot(normalized, normalizedRoot)) return undefined
  if (normalized === normalizedRoot) return undefined
  return normalized.slice(normalizedRoot.length + 1)
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

export function resolveProjectFolderPath(name: string, root = defaultProjectDataRoot) {
  const relative = sanitizeProjectFolderPath(name)
  if (!relative) return undefined
  return `${root.replace(/\/+$/, "")}/${relative}`
}

const IDENTITY_SUFFIX_LEN = 8

function shortIdentitySuffix(value?: string) {
  const compact = (value || uuid()).replace(/-/g, "")
  return compact.slice(0, IDENTITY_SUFFIX_LEN) || compact || "id"
}

/** Keep the requested name when free; otherwise append a uuid suffix so a remote project
 * can occupy its own local identity folder without touching the existing local project
 * or the remote path on B. */
export function allocateLocalIdentityName(
  name: string,
  existingNames: Iterable<string>,
  suffix?: string,
) {
  const relative = sanitizeProjectFolderPath(name)
  if (!relative) return undefined
  const parts = relative.split("/")
  const leaf = parts[parts.length - 1]!
  const parent = parts.slice(0, -1).join("/")
  const taken = new Set(
    [...existingNames]
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  )
  if (!taken.has(leaf.toLowerCase())) return relative
  const token = shortIdentitySuffix(suffix)
  let candidate = `${leaf}-${token}`
  let n = 2
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${leaf}-${token}-${n}`
    n += 1
  }
  return parent ? `${parent}/${candidate}` : candidate
}
