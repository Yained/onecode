export type ProjectSkillPathInfo = {
  onecode_extra_path?: string
  config?: string
  project_data_root?: string
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/\/+$/, "")
}

function resolvePath(value: string) {
  const normalized = normalizePath(value)
  if (!normalized) return "/"
  if (normalized.startsWith("/")) return normalized
  return `/${normalized}`
}

function joinPath(...parts: string[]) {
  return parts
    .flatMap((part, index) => {
      const value = part.replace(/\\/g, "/")
      if (index === 0) return value.replace(/\/+$/, "")
      return value.replace(/^\/+|\/+$/g, "")
    })
    .filter(Boolean)
    .join("/")
    .replace(/\/+/g, "/")
}

function isAbsolutePath(value: string) {
  return value.startsWith("/")
}

function relativePath(from: string, to: string) {
  const base = resolvePath(from).split("/").filter(Boolean)
  const target = resolvePath(to).split("/").filter(Boolean)
  let index = 0
  while (index < base.length && index < target.length && base[index] === target[index]) index++
  const up = Array.from({ length: base.length - index }, () => "..")
  const down = target.slice(index)
  return [...up, ...down].join("/")
}

export function storageKey(directory: string, dataRoot: string) {
  const resolved = resolvePath(directory)
  const relative = relativePath(dataRoot, resolved)
  if (relative && !relative.startsWith("..") && !isAbsolutePath(relative)) return relative
  return resolved.split("/").filter(Boolean).join("_") || "default"
}

export function inlineOpencodeRoot(directory: string) {
  return joinPath(resolvePath(directory), ".opencode")
}

export function shadowOpencodeRootFromPath(directory: string, info: ProjectSkillPathInfo) {
  const extra = info.onecode_extra_path?.trim()
  const configDir = extra ? joinPath(resolvePath(extra), ".config", "opencode") : undefined
  const dataRoot = info.project_data_root?.trim() || "/data"
  const config = info.config?.trim()
  const base = configDir ?? joinPath(config || "", "project-storage")
  return joinPath(base, "projects", storageKey(directory, dataRoot), ".opencode")
}

export function projectSkillRoots(directory: string, info?: ProjectSkillPathInfo) {
  const inline = inlineOpencodeRoot(directory)
  const shadow = info ? shadowOpencodeRootFromPath(directory, info) : inline
  return shadow === inline ? [inline] : [inline, shadow]
}

export function isProjectSkillLocation(location: string, directory: string | undefined, info?: ProjectSkillPathInfo) {
  const normalized = normalizePath(location)
  if (!normalized.endsWith("/SKILL.md") || !directory) return false
  return projectSkillRoots(directory, info).some(
    (root) => normalized === `${normalizePath(root)}/SKILL.md` || normalized.startsWith(`${normalizePath(root)}/`),
  )
}

export * as ProjectSkillStoragePath from "./project-skill-storage-path"
