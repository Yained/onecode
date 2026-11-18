import path from "path"
import { Global } from "@opencode-ai/core/global"
import { OneCodeExtraPath } from "@opencode-ai/core/extra-path"

export type SkillOverrideContext = {
  directory: string
  worktree: string
}

export const SkillOverrideRank = {
  external: 0,
  prefab: 1,
  repo: 3,
  global: 4,
  project: 5,
} as const

export function makeSkillOverrideContext(input: SkillOverrideContext) {
  return {
    directory: path.resolve(input.directory),
    worktree: path.resolve(input.worktree),
    globalHomeOpencode: path.resolve(Global.Path.home, ".opencode"),
    globalConfig: path.resolve(Global.Path.config),
    extraConfig: OneCodeExtraPath.configDirIfExists()
      ? path.resolve(OneCodeExtraPath.configDirIfExists()!)
      : undefined,
  }
}

type ResolvedContext = ReturnType<typeof makeSkillOverrideContext>

function normalizePath(location: string) {
  return path.resolve(location).replaceAll("\\", "/")
}

function isPrefabSkillPath(normalized: string) {
  return normalized.includes("/.opencode/oneskills/skills/")
}

function isRepoCacheSkillPath(normalized: string) {
  return normalized.includes("/repos/") && normalized.endsWith("/SKILL.md")
}

function isUserSkillPath(normalized: string, ctx: ResolvedContext) {
  if (normalized.includes("/.opencode/skills/") || normalized.includes("/.opencode/skill/")) return true
  const roots = [
    path.join(ctx.globalConfig, "skills"),
    path.join(ctx.globalConfig, "skill"),
    ...(ctx.extraConfig
      ? [path.join(ctx.extraConfig, "skills"), path.join(ctx.extraConfig, "skill")]
      : []),
  ]
  return roots.some((root) => isUnderRoot(normalized, root))
}

function opencodeRootForSkill(normalized: string) {
  const match = normalized.match(/^(.*\/\.opencode)\/(?:skills|skill|oneskills\/skills)\//)
  return match?.[1]
}

function isUnderRoot(normalized: string, root: string) {
  const resolved = root.replaceAll("\\", "/")
  return normalized === resolved || normalized.startsWith(`${resolved}/`)
}

function isProjectScopedOpencodePath(normalized: string, ctx: ResolvedContext) {
  const opencodeRoot = opencodeRootForSkill(normalized)
  if (!opencodeRoot) return false

  let current = ctx.directory
  while (true) {
    if (isUnderRoot(opencodeRoot, path.join(current, ".opencode"))) return true
    if (current === ctx.worktree) break
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return false
}

function isGlobalScopedOpencodePath(normalized: string, ctx: ResolvedContext) {
  const opencodeRoot = opencodeRootForSkill(normalized)
  if (opencodeRoot) {
    const roots = [ctx.globalHomeOpencode, ctx.globalConfig, ...(ctx.extraConfig ? [ctx.extraConfig] : [])]
    if (roots.some((root) => isUnderRoot(opencodeRoot, root))) return true
  }

  const configSkillRoots = [
    path.join(ctx.globalConfig, "skills"),
    path.join(ctx.globalConfig, "skill"),
    ...(ctx.extraConfig
      ? [path.join(ctx.extraConfig, "skills"), path.join(ctx.extraConfig, "skill")]
      : []),
  ]
  return configSkillRoots.some((root) => isUnderRoot(normalized, root))
}

export function skillOverrideRank(location: string, input: SkillOverrideContext) {
  const normalized = normalizePath(location)
  const ctx = makeSkillOverrideContext(input)
  if (isPrefabSkillPath(normalized)) return SkillOverrideRank.prefab
  if (isRepoCacheSkillPath(normalized)) return SkillOverrideRank.repo
  if (!isUserSkillPath(normalized, ctx)) return SkillOverrideRank.external

  if (isProjectScopedOpencodePath(normalized, ctx)) return SkillOverrideRank.project
  if (isGlobalScopedOpencodePath(normalized, ctx)) return SkillOverrideRank.global
  return SkillOverrideRank.global
}

export function shouldOverrideSkill(
  existingLocation: string,
  nextLocation: string,
  input: SkillOverrideContext,
  existingIsBuiltIn = false,
) {
  const existingRank = existingIsBuiltIn ? SkillOverrideRank.external : skillOverrideRank(existingLocation, input)
  const nextRank = skillOverrideRank(nextLocation, input)
  return nextRank >= existingRank
}
