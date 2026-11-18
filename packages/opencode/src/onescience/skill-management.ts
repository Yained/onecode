import { accessSync, constants, existsSync, mkdirSync, readdirSync, rmSync, unlinkSync } from "fs"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { OneCodeExtraPath } from "@opencode-ai/core/extra-path"
import { ProjectSkillStorage } from "@opencode-ai/core/project-skill-storage"
import { Schema } from "effect"
import { Archive } from "@/util/archive"
import { projectDataRoot } from "@/path/project-folder"
import { OFFICIAL_SKILL_NAMES } from "@/oneskills/index"
import * as PlatformAuth from "@/platform-auth/platform-auth"
import {
  parseGitSkillSource,
  parseRemoteRepositoryReference,
  repositoryCachePath,
  validateRepositoryBranch,
} from "@/util/repository"
import { OneScienceSkill } from "./skill"

const REPO_MANIFEST = "onescience-skill-repos.json"

export const SkillScope = Schema.Literals(["global", "project"])
export type SkillScope = typeof SkillScope.Type

export const SkillRepoKind = Schema.Literals(["index", "git"])
export type SkillRepoKind = typeof SkillRepoKind.Type

export const SkillRepoConfig = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  url: Schema.String,
  scope: SkillScope,
  kind: Schema.optional(SkillRepoKind),
  localPath: Schema.optional(Schema.String),
  timeCreated: Schema.Number,
}).annotate({ identifier: "OneScienceSkillRepoConfig" })
export type SkillRepoConfig = typeof SkillRepoConfig.Type

export const CreateSkillRepo = Schema.Struct({
  title: Schema.NonEmptyString,
  url: Schema.NonEmptyString,
  scope: SkillScope,
}).annotate({ identifier: "CreateOneScienceSkillRepo" })
export type CreateSkillRepo = typeof CreateSkillRepo.Type

export const UploadSkill = Schema.Struct({
  name: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
  scope: SkillScope,
  title: Schema.optional(Schema.NonEmptyString),
  layer: Schema.optional(Schema.NonEmptyString),
  skillBody: Schema.NonEmptyString,
  assetsArchiveBase64: Schema.optional(Schema.String),
  assetsArchiveName: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "UploadOneScienceSkill" })
export type UploadSkill = typeof UploadSkill.Type

export const UploadedSkillResult = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  scope: SkillScope,
  layer: Schema.String,
}).annotate({ identifier: "UploadedOneScienceSkill" })
export type UploadedSkillResult = typeof UploadedSkillResult.Type

export const DeletedSkillResult = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  scope: SkillScope,
}).annotate({ identifier: "DeletedOneScienceSkill" })
export type DeletedSkillResult = typeof DeletedSkillResult.Type

export const DeleteSkill = Schema.Struct({
  name: Schema.NonEmptyString,
  scope: SkillScope,
}).annotate({ identifier: "DeleteOneScienceSkill" })
export type DeleteSkill = typeof DeleteSkill.Type

function globalOpencodeDir() {
  return path.join(Global.Path.home, ".opencode")
}

function accountSkillStorageRoot(accountId: string) {
  return path.dirname(PlatformAuth.accountSkillsDir(accountId))
}

function canWriteDir(dir: string) {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

function projectStorageKey(directory: string) {
  return ProjectSkillStorage.storageKey(directory, projectDataRoot())
}

function inlineProjectOpencodeRoot(directory: string) {
  return ProjectSkillStorage.inlineOpencodeRoot(directory)
}

function projectUsesShadowStorage(directory: string) {
  return !canWriteDir(path.resolve(directory))
}

function projectOpencodeShadowRoot(directory: string) {
  return ProjectSkillStorage.shadowOpencodeRoot(directory, projectDataRoot())
}

function projectOpencodeDir(directory: string) {
  const inline = inlineProjectOpencodeRoot(directory)
  if (!projectUsesShadowStorage(directory)) {
    if (!existsSync(inline)) mkdirSync(inline, { recursive: true })
    return inline
  }
  const shadow = projectOpencodeShadowRoot(directory)
  if (!existsSync(shadow)) mkdirSync(shadow, { recursive: true })
  return shadow
}

function configFileForScope(scope: SkillScope, directory: string) {
  if (scope === "global") return path.join(globalOpencodeDir(), "opencode.json")
  if (!projectUsesShadowStorage(directory)) return path.join(inlineProjectOpencodeRoot(directory), "opencode.json")
  const extra = OneCodeExtraPath.configDir()
  if (extra) return path.join(extra, "opencode.json")
  return path.join(Global.Path.config, "opencode.json")
}

function storageRootForScope(scope: SkillScope, directory: string, accountId?: string) {
  if (scope === "global" && accountId) return accountSkillStorageRoot(accountId)
  return scope === "global" ? globalOpencodeDir() : projectOpencodeDir(directory)
}

function scopeRoot(scope: SkillScope, directory: string, accountId?: string) {
  return storageRootForScope(scope, directory, accountId)
}

function opencodeConfigPath(scope: SkillScope, directory: string) {
  return configFileForScope(scope, directory)
}

function repoManifestPath(scope: SkillScope, directory: string) {
  return path.join(scopeRoot(scope, directory), REPO_MANIFEST)
}

function skillInstallDir(scope: SkillScope, directory: string, name: string, accountId?: string) {
  if (scope === "global" && accountId) return path.join(PlatformAuth.accountSkillsDir(accountId), name)
  return path.join(scopeRoot(scope, directory), "skills", name)
}

export function userSkillId(name: string, accountId?: string) {
  return accountId ? `custom-skill-${accountId}-${name}` : `custom-skill-${name}`
}

function normalizeSkillUrl(url: string) {
  const trimmed = url.trim()
  if (!trimmed) throw new Error("仓库地址不能为空")
  try {
    const parsed = new URL(trimmed)
    return `${parsed.toString().replace(/\/$/, "")}/`
  } catch {
    throw new Error("仓库地址格式无效，请输入可访问的 HTTP(S) 技能索引地址")
  }
}

export const SKILL_NAME_MAX = 32
export const SKILL_DESCRIPTION_MAX = 80

function validateSkillName(name: string) {
  const trimmed = name.trim()
  if (!/^[a-z0-9][a-z0-9-]*$/.test(trimmed)) {
    throw new Error("技能标识需为小写字母、数字和连字符，且以字母或数字开头")
  }
  return trimmed
}

function validateUploadSkillName(name: string) {
  const trimmed = validateSkillName(name)
  if (trimmed.length > SKILL_NAME_MAX) {
    throw new Error(`技能标识最多 ${SKILL_NAME_MAX} 个字符`)
  }
  return trimmed
}

function validateSkillDescription(description: string) {
  const trimmed = description.trim()
  if (!trimmed) throw new Error("请填写技能描述")
  if (trimmed.length > SKILL_DESCRIPTION_MAX) {
    throw new Error(`技能描述最多 ${SKILL_DESCRIPTION_MAX} 个字符`)
  }
  return trimmed
}

async function readJsonFile<T>(file: string) {
  if (!existsSync(file)) return undefined
  try {
    return (await Bun.file(file).json()) as T
  } catch {
    throw new Error(`配置文件解析失败：${file}`)
  }
}

async function writeJsonFile(file: string, value: unknown) {
  const dir = path.dirname(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  await Bun.write(file, JSON.stringify(value, null, 2))
}

async function readOpencodeConfig(file: string) {
  return (await readJsonFile<Record<string, unknown>>(file)) ?? {}
}

async function mergeSkillUrls(file: string, urls: string[]) {
  const config = await readOpencodeConfig(file)
  const skills = config.skills && typeof config.skills === "object" ? (config.skills as Record<string, unknown>) : {}
  const current = Array.isArray(skills.urls) ? skills.urls.filter((item): item is string => typeof item === "string") : []
  const merged = [...new Set([...current, ...urls])]
  await writeJsonFile(file, { ...config, skills: { ...skills, urls: merged } })
}

async function mergeSkillPaths(file: string, paths: string[]) {
  const config = await readOpencodeConfig(file)
  const skills = config.skills && typeof config.skills === "object" ? (config.skills as Record<string, unknown>) : {}
  const current = Array.isArray(skills.paths) ? skills.paths.filter((item): item is string => typeof item === "string") : []
  const merged = [...new Set([...current, ...paths])]
  await writeJsonFile(file, { ...config, skills: { ...skills, paths: merged } })
}

async function removeSkillUrl(file: string, url: string) {
  const config = await readOpencodeConfig(file)
  const skills = config.skills && typeof config.skills === "object" ? (config.skills as Record<string, unknown>) : {}
  const current = Array.isArray(skills.urls) ? skills.urls.filter((item): item is string => typeof item === "string") : []
  const normalized = normalizeSkillUrl(url)
  const next = current.filter((item) => normalizeSkillUrl(item) !== normalized)
  await writeJsonFile(file, { ...config, skills: { ...skills, urls: next } })
}

function sameGitHubRepository(left: string, right: string) {
  const parsedLeft = parseGitSkillSource(left)
  const parsedRight = parseGitSkillSource(right)
  if (!parsedLeft || !parsedRight) return false
  return parsedLeft.owner === parsedRight.owner && parsedLeft.repo === parsedRight.repo
}

function gitSkillCacheRoot(url: string) {
  const source = parseGitSkillSource(url)
  if (!source) return
  return repositoryCachePath(parseRemoteRepositoryReference(`https://${source.host}/${source.owner}/${source.repo}`))
}

function pathWithinRoot(candidate: string, root: string) {
  const resolved = path.resolve(candidate)
  const resolvedRoot = path.resolve(root)
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`)
}

async function removeGitHubSkillUrls(file: string, githubUrl: string) {
  const source = parseGitSkillSource(githubUrl)
  if (!source) return

  const config = await readOpencodeConfig(file)
  const skills = config.skills && typeof config.skills === "object" ? (config.skills as Record<string, unknown>) : {}
  const current = Array.isArray(skills.urls) ? skills.urls.filter((item): item is string => typeof item === "string") : []
  const next = current.filter((item) => !sameGitHubRepository(item, githubUrl))
  if (next.length === current.length) return
  await writeJsonFile(file, { ...config, skills: { ...skills, urls: next } })
}

async function removeGitSkillPaths(file: string, githubUrl: string, localPath?: string) {
  const cacheRoot = gitSkillCacheRoot(githubUrl)
  const resolvedLocal = localPath ? path.resolve(localPath) : undefined
  const config = await readOpencodeConfig(file)
  const skills = config.skills && typeof config.skills === "object" ? (config.skills as Record<string, unknown>) : {}
  const current = Array.isArray(skills.paths) ? skills.paths.filter((item): item is string => typeof item === "string") : []
  const next = current.filter((item) => {
    const resolved = path.resolve(item)
    if (resolvedLocal && resolved === resolvedLocal) return false
    if (cacheRoot && pathWithinRoot(item, cacheRoot)) return false
    return true
  })
  if (next.length === current.length) return
  await writeJsonFile(file, { ...config, skills: { ...skills, paths: next } })
}

export function hasDiscoverableSkills(root: string) {
  if (existsSync(path.join(root, "SKILL.md"))) return true

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (existsSync(path.join(root, entry.name, "SKILL.md"))) return true
  }

  return false
}

export function resolveSkillRootFromClone(cloneRoot: string, subpath: string) {
  const candidates = subpath ? [path.join(cloneRoot, subpath)] : [path.join(cloneRoot, "skills"), cloneRoot]

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    if (hasDiscoverableSkills(candidate)) return candidate
  }

  if (subpath) throw new Error(`仓库中找不到技能目录：${subpath}`)
  throw new Error("仓库中找不到技能目录，请使用包含 skills 子目录的地址（如 .../tree/main/skills）")
}

async function runGit(cwd: string, args: string[]) {
  if (!Bun.which("git")) throw new Error("未找到 git 命令，无法克隆 GitHub 技能仓库")

  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  const exitCode = await proc.exited
  if (exitCode === 0) return

  const stderr = await new Response(proc.stderr).text()
  const stdout = await new Response(proc.stdout).text()
  throw new Error(stderr.trim() || stdout.trim() || `git ${args[0]} 失败`)
}

async function syncGitSkillRepo(source: ReturnType<typeof parseGitSkillSource>) {
  if (!source) throw new Error("Git 仓库地址无效")

  const reference = parseRemoteRepositoryReference(`https://${source.host}/${source.owner}/${source.repo}`)
  validateRepositoryBranch(source.branch)
  const localPath = repositoryCachePath(reference)
  const remote = reference.remote

  if (!existsSync(path.join(localPath, ".git"))) {
    mkdirSync(path.dirname(localPath), { recursive: true })
    await runGit(path.dirname(localPath), [
      "clone",
      "--depth",
      "100",
      "--branch",
      source.branch,
      "--",
      remote,
      localPath,
    ])
  } else {
    await runGit(localPath, ["fetch", "--all", "--prune"])
    await runGit(localPath, ["checkout", "-B", source.branch, `origin/${source.branch}`])
    await runGit(localPath, ["reset", "--hard", `origin/${source.branch}`])
  }

  return resolveSkillRootFromClone(localPath, source.subpath)
}

function buildSkillMarkdown(name: string, description: string, body: string) {
  const frontmatter = `---\nname: ${name}\ndescription: ${description.replace(/\n/g, " ")}\n---\n\n`
  return `${frontmatter}${body.trim()}\n`
}

async function listReposWithoutRepair(directory: string) {
  const items: SkillRepoConfig[] = []
  for (const scope of ["global", "project"] as const) {
    const manifest = await readJsonFile<{ items?: SkillRepoConfig[] }>(repoManifestPath(scope, directory))
    for (const item of manifest?.items ?? []) {
      if (item.scope === scope) items.push(item)
    }
  }
  return items
}

export function skillRepoEntriesNeedRepair(items: readonly SkillRepoConfig[]) {
  return items.some((item) => parseGitSkillSource(item.url) && (item.kind !== "git" || !item.localPath))
}

export async function listReposFast(directory: string) {
  const items = await listReposWithoutRepair(directory)
  return items.sort((left, right) => right.timeCreated - left.timeCreated)
}

export async function listRepos(directory: string) {
  const items = await listReposWithoutRepair(directory)
  const needsRepair = skillRepoEntriesNeedRepair(items)
  if (needsRepair) await syncConfiguredSkillRepos(directory)

  const listed = needsRepair ? await listReposWithoutRepair(directory) : items
  return {
    items: listed.sort((left, right) => right.timeCreated - left.timeCreated),
    repaired: needsRepair,
  }
}

export async function syncConfiguredSkillRepos(directory: string) {
  for (const scope of ["global", "project"] as const) {
    const manifestFile = repoManifestPath(scope, directory)
    const manifest = await readJsonFile<{ items: SkillRepoConfig[] }>(manifestFile)
    if (!manifest?.items.length) continue

    const configFile = opencodeConfigPath(scope, directory)
    let changed = false
    const items: SkillRepoConfig[] = []

    for (const item of manifest.items) {
      const github = parseGitSkillSource(item.url)
      if (!github) {
        items.push(item)
        continue
      }

      const localPath = await syncGitSkillRepo(github)
      await mergeSkillPaths(configFile, [localPath])
      await removeGitHubSkillUrls(configFile, item.url)

      const next = {
        ...item,
        scope,
        kind: "git" as const,
        localPath,
      }
      items.push(next)
      changed =
        changed ||
        item.kind !== "git" ||
        !item.localPath ||
        path.resolve(item.localPath) !== path.resolve(localPath)
    }

    if (changed) await writeJsonFile(manifestFile, { items })
  }
}

export async function addRepo(directory: string, input: CreateSkillRepo) {
  const scope = input.scope
  const configFile = opencodeConfigPath(scope, directory)
  const github = parseGitSkillSource(input.url)

  if (github) {
    const localPath = await syncGitSkillRepo(github)
    await mergeSkillPaths(configFile, [localPath])
    await removeGitHubSkillUrls(configFile, input.url.trim())
    const manifestFile = repoManifestPath(scope, directory)
    const manifest = (await readJsonFile<{ items: SkillRepoConfig[] }>(manifestFile)) ?? { items: [] }
    const url = input.url.trim()
    const row: SkillRepoConfig = {
      id: `repo-${crypto.randomUUID()}`,
      title: input.title.trim(),
      url,
      scope,
      kind: "git",
      localPath,
      timeCreated: Date.now(),
    }
    manifest.items = [
      ...manifest.items.filter(
        (item) => item.kind !== "git" || !item.localPath || path.resolve(item.localPath) !== path.resolve(localPath),
      ),
      row,
    ]
    await writeJsonFile(manifestFile, manifest)
    return row
  }

  const url = normalizeSkillUrl(input.url)
  await mergeSkillUrls(configFile, [url])
  const manifestFile = repoManifestPath(scope, directory)
  const manifest = (await readJsonFile<{ items: SkillRepoConfig[] }>(manifestFile)) ?? { items: [] }
  const row: SkillRepoConfig = {
    id: `repo-${crypto.randomUUID()}`,
    title: input.title.trim(),
    url,
    scope,
    kind: "index",
    timeCreated: Date.now(),
  }
  manifest.items = [...manifest.items.filter((item) => item.kind !== "index" || normalizeSkillUrl(item.url) !== url), row]
  await writeJsonFile(manifestFile, manifest)
  return row
}

export async function removeRepo(directory: string, id: string) {
  for (const scope of ["global", "project"] as const) {
    const manifestFile = repoManifestPath(scope, directory)
    const manifest = await readJsonFile<{ items: SkillRepoConfig[] }>(manifestFile)
    if (!manifest) continue
    const removed = manifest.items.find((item) => item.id === id)
    if (!removed) continue
    manifest.items = manifest.items.filter((item) => item.id !== id)
    await writeJsonFile(manifestFile, manifest)
    const configFile = opencodeConfigPath(scope, directory)
    if (parseGitSkillSource(removed.url)) {
      await removeGitHubSkillUrls(configFile, removed.url)
      await removeGitSkillPaths(configFile, removed.url, removed.localPath)
    } else {
      await removeSkillUrl(configFile, removed.url)
    }
    return removed
  }
  throw new Error(`Skill repo not found: ${id}`)
}

export async function uploadSkill(directory: string, input: UploadSkill, accountId?: string) {
  const name = validateUploadSkillName(input.name)
  const description = validateSkillDescription(input.description)
  const title = input.title?.trim() || name
  const layer = input.layer?.trim() || "自定义"
  const installDir = skillInstallDir(input.scope, directory, name, accountId)
  if (!existsSync(installDir)) mkdirSync(installDir, { recursive: true })

  await Bun.write(path.join(installDir, "SKILL.md"), buildSkillMarkdown(name, description, input.skillBody))

  if (input.assetsArchiveBase64) {
    const archiveName = input.assetsArchiveName?.trim() || "assets.zip"
    const archivePath = path.join(installDir, `.upload-${path.basename(archiveName)}`)
    await Bun.write(archivePath, Buffer.from(input.assetsArchiveBase64, "base64"))
    await Archive.extractArchive(archivePath, installDir, archiveName)
    unlinkSync(archivePath)
  }

  if (input.scope === "project" && projectUsesShadowStorage(directory)) {
    await mergeSkillPaths(configFileForScope(input.scope, directory), [path.join(storageRootForScope(input.scope, directory), "skills")])
  }

  const skillId = userSkillId(name, accountId)
  const tags = [
    ...(input.tags?.length ? [...input.tags] : [layer, "user-skill"]),
    ...(accountId ? [`owner:${accountId}`] : []),
  ]
  OneScienceSkill.upsertUser({
    id: skillId,
    title,
    copy: description,
    layer,
    tags,
    provider: name,
    href: `file://${path.join(installDir, "SKILL.md")}`,
  })

  return {
    id: skillId,
    name,
    path: installDir,
    scope: input.scope,
    layer,
  } satisfies UploadedSkillResult
}

function isProtectedGlobalSkill(name: string) {
  if ((OFFICIAL_SKILL_NAMES as readonly string[]).includes(name)) return true
  return name.startsWith("onescience-")
}

export async function deleteSkill(directory: string, input: DeleteSkill, accountId?: string) {
  const name = validateSkillName(input.name)
  if (input.scope === "global" && isProtectedGlobalSkill(name)) {
    throw new Error("不能删除内置或官方 OneSkills 技能")
  }

  const installDir = skillInstallDir(input.scope, directory, name, accountId)
  const skillFile = path.join(installDir, "SKILL.md")
  if (!existsSync(skillFile)) throw new Error(`Skill not found: ${name}`)

  rmSync(installDir, { recursive: true, force: true })
  OneScienceSkill.removeUser(userSkillId(name, accountId))
  if (accountId) OneScienceSkill.removeUser(`custom-skill-${name}`)

  return {
    name,
    path: installDir,
    scope: input.scope,
  } satisfies DeletedSkillResult
}

export * as OneScienceSkillManagement from "./skill-management"
