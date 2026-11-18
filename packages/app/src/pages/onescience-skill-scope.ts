import { ProjectSkillStoragePath } from "@opencode-ai/core/project-skill-storage-path"
import type { SkillRepoConfig, SkillScope } from "./onescience-skill-management"

export type SkillScopeItem = {
  name: string
  description?: string
  location: string
}

export type UserUploadedSkill = SkillScopeItem & {
  scope: SkillScope
}

function normalizePath(value: string | undefined) {
  return value?.replace(/\\/g, "/").replace(/\/+$/, "")
}

function skillNameFromLocation(location: string) {
  const normalized = normalizePath(location)
  if (!normalized?.endsWith("/SKILL.md")) return undefined
  const parts = normalized.slice(0, -"/SKILL.md".length).split("/").filter(Boolean)
  return parts.at(-1)
}

function isProtectedUserSkillName(name: string | undefined) {
  return Boolean(name?.startsWith("onescience-"))
}

/** User global uploads under ~/.opencode/skills/{name}/SKILL.md */
function isHomeUserSkillLocation(location: string, globalRoot: string | undefined) {
  const normalized = normalizePath(location)
  const root = normalizePath(globalRoot)
  if (!normalized || !root) return false
  const prefix = `${root}/.opencode/skills/`
  if (!normalized.startsWith(prefix) || !normalized.endsWith("/SKILL.md")) return false
  const name = skillNameFromLocation(normalized)
  return Boolean(name) && !isProtectedUserSkillName(name)
}

/**
 * Platform-account uploads under {onecode_extra}/accounts/{id}/skills/{name}/SKILL.md.
 * Also accepts any absolute .../accounts/.../skills/... path when extra root is unknown.
 */
function isAccountUserSkillLocation(
  location: string,
  pathInfo: { onecode_extra_path?: string },
) {
  const normalized = normalizePath(location)
  if (!normalized?.endsWith("/SKILL.md")) return false
  const match = normalized.match(/\/accounts\/[^/]+\/skills\/([^/]+)\/SKILL\.md$/)
  if (!match?.[1] || isProtectedUserSkillName(match[1])) return false
  const extra = normalizePath(pathInfo.onecode_extra_path)
  if (extra && !normalized.startsWith(`${extra}/`)) return false
  return true
}

function isGlobalSkillLocation(value: string, globalRoot: string | undefined) {
  const location = normalizePath(value)
  if (location === "<built-in>") return true
  if (!location || !globalRoot) return false
  if (!location.endsWith("/SKILL.md")) return false
  return location === `${globalRoot}/SKILL.md` || location.startsWith(`${globalRoot}/`)
}

function isOneskillsRepo(url: string) {
  return url.trim().toLowerCase().includes("onescience-ai/oneskills")
}

function repoRoots(repos: readonly SkillRepoConfig[], scope: SkillRepoConfig["scope"]) {
  return repos
    .filter((repo) => repo.scope === scope && repo.localPath)
    .map((repo) => normalizePath(repo.localPath))
    .filter((root): root is string => Boolean(root))
}

function isUnderRoot(location: string, roots: readonly string[]) {
  const normalized = normalizePath(location)
  if (!normalized) return false
  return roots.some((root) => normalized === root || normalized.startsWith(`${root}/`))
}

function isPrefabSkill(location: string, globalRoot: string | undefined) {
  const normalized = normalizePath(location)
  const prefabRoot = globalRoot ? `${globalRoot}/.opencode/oneskills/skills` : undefined
  if (!normalized || !prefabRoot) return false
  return normalized.startsWith(`${prefabRoot}/`)
}

function isRepoCacheSkillLocation(location: string) {
  return normalizePath(location)?.includes("/repos/") ?? false
}

function hasGlobalGitRepo(repos: readonly SkillRepoConfig[]) {
  return repos.some((repo) => repo.scope === "global" && repo.kind === "git")
}

function classifySkillScope(
  item: SkillScopeItem,
  projectRoot: string | undefined,
  globalRoot: string | undefined,
  pathInfo: { onecode_extra_path?: string; config?: string; project_data_root?: string },
  repos: readonly SkillRepoConfig[],
) {
  const projectRepoPaths = repoRoots(repos, "project")

  if (ProjectSkillStoragePath.isProjectSkillLocation(item.location, projectRoot, pathInfo)) return "project" as const
  if (isUnderRoot(item.location, projectRepoPaths)) return "project" as const

  const hasProjectOneskillsRepo = repos.some((repo) => repo.scope === "project" && isOneskillsRepo(repo.url))
  if (hasProjectOneskillsRepo && isPrefabSkill(item.location, globalRoot)) return "project" as const

  if (isUnderRoot(item.location, repoRoots(repos, "global"))) return "global" as const
  if (hasGlobalGitRepo(repos) && isRepoCacheSkillLocation(item.location) && !isUnderRoot(item.location, projectRepoPaths)) {
    return "global" as const
  }
  if (isGlobalSkillLocation(item.location, globalRoot)) return "global" as const
  return "global" as const
}

export function splitSkillScopes(
  items: SkillScopeItem[],
  projectRoot: string | undefined,
  globalRoot: string | undefined,
  pathInfo: { onecode_extra_path?: string; config?: string; project_data_root?: string },
  repos: readonly SkillRepoConfig[] = [],
) {
  const project: SkillScopeItem[] = []
  const global: SkillScopeItem[] = []
  const projectNames = new Set<string>()

  for (const item of items) {
    if (classifySkillScope(item, projectRoot, globalRoot, pathInfo, repos) !== "project") continue
    project.push(item)
    projectNames.add(item.name)
  }

  for (const item of items) {
    if (classifySkillScope(item, projectRoot, globalRoot, pathInfo, repos) === "project") continue
    if (projectNames.has(item.name)) continue
    global.push(item)
  }

  return { project, global }
}

/** True when the skill was uploaded by the user and may be deleted from the manager UI. */
export function canDeleteUserSkill(
  item: SkillScopeItem,
  tone: SkillScope,
  projectRoot: string | undefined,
  globalRoot: string | undefined,
  pathInfo: { onecode_extra_path?: string; config?: string; project_data_root?: string },
) {
  if (item.location === "<built-in>") return false
  if (tone === "project") {
    return ProjectSkillStoragePath.isProjectSkillLocation(item.location, projectRoot, pathInfo)
  }
  return isHomeUserSkillLocation(item.location, globalRoot) || isAccountUserSkillLocation(item.location, pathInfo)
}

/** Uploaded project/global skills only (excludes built-in, OneSkills prefab, and repo sync). */
export function listUserUploadedSkills(
  items: SkillScopeItem[],
  projectRoot: string | undefined,
  globalRoot: string | undefined,
  pathInfo: { onecode_extra_path?: string; config?: string; project_data_root?: string },
): UserUploadedSkill[] {
  const uploaded: UserUploadedSkill[] = []
  for (const item of items) {
    if (canDeleteUserSkill(item, "project", projectRoot, globalRoot, pathInfo)) {
      uploaded.push({ ...item, scope: "project" })
      continue
    }
    if (canDeleteUserSkill(item, "global", projectRoot, globalRoot, pathInfo)) {
      uploaded.push({ ...item, scope: "global" })
    }
  }
  return uploaded.sort((a, b) => a.name.localeCompare(b.name))
}
