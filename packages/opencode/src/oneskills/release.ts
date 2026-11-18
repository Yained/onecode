import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync } from "fs"
import os from "os"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { OneCodeExtraPath } from "@opencode-ai/core/extra-path"
import { Flock } from "@opencode-ai/core/util/flock"
import { Glob } from "@opencode-ai/core/util/glob"
import { Archive } from "../util/archive"
import { Process } from "../util/process"
import { parseMatter } from "../util/frontmatter"

export const DEFAULT_RELEASE_URL =
  "https://gitee.com/onescience-ai/oneskills/releases/download/latest/oneskills-latest.zip"

const NAMESPACE_ROOT = ".opencode/oneskills"

const LEGACY_FLAT_PATHS = [
  "skills/VERSION",
  "references",
  "onescience",
  "integrations",
  "opencode.jsonc.snippet",
] as const

function globalProjectRoot() {
  const extra = OneCodeExtraPath.root()
  if (extra) return extra
  return Global.Path.home
}

function root(projectRoot = globalProjectRoot()) {
  return path.join(projectRoot, NAMESPACE_ROOT)
}

function targetSkillsDir(projectRoot = globalProjectRoot()) {
  return path.join(root(projectRoot), "skills")
}

function targetManifestFile(projectRoot = globalProjectRoot()) {
  return path.join(root(projectRoot), "catalog/manifest.json")
}

function targetInstallStateFile(projectRoot = globalProjectRoot()) {
  return path.join(projectRoot, ".oneskills/install-state/opencode.json")
}

function removeLegacyFlatLayout(projectRoot = globalProjectRoot()) {
  const opencodeRoot = path.join(projectRoot, ".opencode")
  const removed: string[] = []

  const legacySkillsDir = path.join(opencodeRoot, "skills")
  if (existsSync(legacySkillsDir)) {
    for (const entry of readdirSync(legacySkillsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith("onescience-")) continue
        const target = path.join(legacySkillsDir, entry.name)
        rmSync(target, { recursive: true, force: true })
        removed.push(path.relative(projectRoot, target))
        continue
      }
      if (entry.name !== "VERSION") continue
      const target = path.join(legacySkillsDir, entry.name)
      rmSync(target, { force: true })
      removed.push(path.relative(projectRoot, target))
    }
  }

  for (const rel of LEGACY_FLAT_PATHS) {
    if (rel === "skills/VERSION") continue
    const target = path.join(opencodeRoot, rel)
    if (!existsSync(target)) continue
    rmSync(target, { recursive: true, force: true })
    removed.push(path.relative(projectRoot, target))
  }

  return removed
}

export function releaseUrl() {
  const env = process.env.ONESKILLS_RELEASE_URL?.trim()
  if (env) return env
  return DEFAULT_RELEASE_URL
}

type ReleaseInstallOptions = {
  force?: boolean
  projectRoot?: string
  dryRun?: boolean
  url?: string
}

export type ReleaseInstallResult = {
  projectRoot: string
  skillsDir: string
  version?: string
  releaseUrl: string
  skillCount: number
}

function resolvePackageRoot(extractDir: string) {
  const direct = path.join(extractDir, "oneskills")
  if (existsSync(path.join(direct, "skills"))) return direct

  for (const entry of readdirSync(extractDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const candidate = path.join(extractDir, entry.name)
    if (existsSync(path.join(candidate, "skills"))) return candidate
  }

  throw new Error("OneSkills 发布包格式无效：缺少 skills 目录")
}

async function extractZip(zipPath: string, extractDir: string) {
  await Archive.extractZip(zipPath, extractDir)
}

function assertZipFile(zipPath: string) {
  // PK\x03\x04 local file header, or PK\x05\x06 / PK\x07\x08 central/EOCD variants
  const fd = openSync(zipPath, "r")
  try {
    const header = Buffer.alloc(4)
    const n = readSync(fd, header, 0, 4, 0)
    const isZip =
      n >= 4 &&
      header[0] === 0x50 &&
      header[1] === 0x4b &&
      (header[2] === 0x03 || header[2] === 0x05 || header[2] === 0x07)
    if (!isZip) {
      throw new Error("下载的 OneSkills 发布包不是有效的 zip 文件（可能是网关错误页）")
    }
  } finally {
    closeSync(fd)
  }
}

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 90_000

function downloadTimeoutMs() {
  const raw = process.env.ONESKILLS_DOWNLOAD_TIMEOUT_MS?.trim()
  if (!raw) return DEFAULT_DOWNLOAD_TIMEOUT_MS
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_DOWNLOAD_TIMEOUT_MS
  return value
}

function abortableTimeout(timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  }
}

async function downloadWithCurl(url: string, zipPath: string, timeoutMs: number) {
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000))
  const timeout = abortableTimeout(timeoutMs)
  try {
    const result = await Process.run(
      ["curl", "-fsSL", "--connect-timeout", "15", "--max-time", String(seconds), "-o", zipPath, url],
      { nothrow: true, abort: timeout.signal },
    )
    if (timeout.signal.aborted || result.code === 28) {
      throw new Error(`下载 OneSkills 发布包超时（超过 ${Math.round(timeoutMs / 1000)} 秒），请检查网络或稍后重试`)
    }
    if (result.code !== 0) {
      const detail = result.stderr.toString().trim() || result.stdout.toString().trim() || `exit ${result.code}`
      // curl may report wall-clock timeout without exit 28 in some builds/wrappers
      if (/timed?\s*out|timeout/i.test(detail)) {
        throw new Error(`下载 OneSkills 发布包超时（超过 ${Math.round(timeoutMs / 1000)} 秒），请检查网络或稍后重试`)
      }
      throw new Error(`无法下载 OneSkills 发布包（curl: ${detail}）`)
    }
  } finally {
    timeout.clear()
  }
}

async function downloadWithFetch(url: string, zipPath: string, timeoutMs: number) {
  const timeout = abortableTimeout(timeoutMs)
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: timeout.signal,
    }).catch((error) => {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new Error(`下载 OneSkills 发布包超时（超过 ${Math.round(timeoutMs / 1000)} 秒），请检查网络或稍后重试`)
      }
      throw error
    })
    if (!response.ok) {
      throw new Error(`无法下载 OneSkills 发布包（HTTP ${response.status} ${response.statusText}）`)
    }
    await Bun.write(zipPath, response)
  } finally {
    timeout.clear()
  }
}

function isTimeoutError(error: unknown) {
  if (!(error instanceof Error)) return false
  if (error.name === "TimeoutError" || error.name === "AbortError") return true
  return /超时|timed?\s*out|timeout/i.test(error.message)
}

export async function downloadRelease(url = releaseUrl()) {
  const tempDir = path.join(os.tmpdir(), `oneskills-release-${Date.now()}-${process.pid}`)
  mkdirSync(tempDir, { recursive: true })
  const zipPath = path.join(tempDir, "oneskills.zip")
  const extractDir = path.join(tempDir, "extract")
  const cleanup = () => rmSync(tempDir, { recursive: true, force: true })
  const timeoutMs = downloadTimeoutMs()

  try {
    // Prefer curl: Bun fetch to some Gitee/CDN endpoints can hang without completing.
    // Do not fall back to fetch after a timeout — that would double the wait past the UI budget.
    try {
      await downloadWithCurl(url, zipPath, timeoutMs)
    } catch (curlError) {
      if (isTimeoutError(curlError)) throw curlError
      try {
        await downloadWithFetch(url, zipPath, timeoutMs)
      } catch (fetchError) {
        throw isTimeoutError(fetchError) ? fetchError : curlError
      }
    }
    assertZipFile(zipPath)
    await extractZip(zipPath, extractDir)

    return {
      packageRoot: resolvePackageRoot(extractDir),
      cleanup,
    }
  } catch (error) {
    cleanup()
    throw error
  }
}

function readPackageVersion(packageRoot: string) {
  const file = path.join(packageRoot, "VERSION")
  if (!existsSync(file)) return undefined
  const version = readFileSync(file, "utf8").trim()
  return version || undefined
}

function generateManifest(skillsRoot: string, version?: string) {
  const skills = Glob.scanSync("*/SKILL.md", { cwd: skillsRoot, absolute: true })
    .map((file) => {
      const parsed = parseMatter(readFileSync(file, "utf8"))
      const name = typeof parsed.data.name === "string" ? parsed.data.name : path.basename(path.dirname(file))
      const description = typeof parsed.data.description === "string" ? parsed.data.description : ""
      const tags = Array.isArray(parsed.data.tags)
        ? parsed.data.tags.filter((tag): tag is string => typeof tag === "string")
        : []
      return {
        id: `skill:${name}`,
        name,
        description,
        layer: typeof parsed.data.layer === "string" ? parsed.data.layer : undefined,
        tags,
        location: path.relative(path.dirname(skillsRoot), file).replaceAll("\\", "/"),
        source: "official",
      }
    })
    .filter((skill) => skill.description)
    .toSorted((a, b) => a.name.localeCompare(b.name))

  return {
    schema_version: 1,
    package: "oneskills",
    version,
    skills_version: version,
    generated_at: new Date().toISOString(),
    skills,
  }
}

async function writeManifest(skillsRoot: string, projectRoot: string, version?: string) {
  const manifest = generateManifest(skillsRoot, version)
  const target = targetManifestFile(projectRoot)
  mkdirSync(path.dirname(target), { recursive: true })
  await Bun.write(target, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest.skills.length
}

async function writeInstallState(projectRoot: string, input: { version?: string; releaseUrl: string }) {
  const state = {
    schema_version: 1,
    agent: "opencode",
    mode: "copy",
    profile: "basic",
    targets: [NAMESPACE_ROOT],
    source: "release",
    version: input.version,
    release_url: input.releaseUrl,
    updated_at: new Date().toISOString(),
  }
  const file = targetInstallStateFile(projectRoot)
  mkdirSync(path.dirname(file), { recursive: true })
  await Bun.write(file, `${JSON.stringify(state, null, 2)}\n`)
}

export async function installFromPackageRoot(packageRoot: string, options: ReleaseInstallOptions = {}) {
  const sourceSkills = path.join(packageRoot, "skills")
  if (!existsSync(sourceSkills)) {
    throw new Error(`OneSkills 发布包格式无效：缺少 skills 目录`)
  }

  const projectRoot = options.projectRoot ?? globalProjectRoot()
  const skillsDir = targetSkillsDir(projectRoot)
  const version = readPackageVersion(packageRoot)
  const currentUrl = options.url ?? releaseUrl()

  if (options.dryRun) {
    return {
      projectRoot,
      skillsDir,
      version,
      releaseUrl: currentUrl,
      skillCount: generateManifest(sourceSkills, version).skills.length,
    }
  }

  mkdirSync(path.dirname(skillsDir), { recursive: true })
  if (options.force) {
    const stagingDir = `${skillsDir}.staging-${process.pid}-${Date.now()}`
    const backupDir = `${skillsDir}.bak-${process.pid}-${Date.now()}`
    rmSync(stagingDir, { recursive: true, force: true })
    rmSync(backupDir, { recursive: true, force: true })
    try {
      cpSync(sourceSkills, stagingDir, { recursive: true })
      if (existsSync(skillsDir)) {
        renameSync(skillsDir, backupDir)
        try {
          renameSync(stagingDir, skillsDir)
          rmSync(backupDir, { recursive: true, force: true })
        } catch (error) {
          renameSync(backupDir, skillsDir)
          throw error
        }
      } else {
        renameSync(stagingDir, skillsDir)
      }
    } catch (error) {
      rmSync(stagingDir, { recursive: true, force: true })
      throw error
    }
  } else {
    cpSync(sourceSkills, skillsDir, { recursive: true })
  }

  const skillCount = await writeManifest(skillsDir, projectRoot, version)
  await writeInstallState(projectRoot, { version, releaseUrl: currentUrl })
  if (projectRoot === globalProjectRoot()) removeLegacyFlatLayout(projectRoot)

  return {
    projectRoot,
    skillsDir,
    version,
    releaseUrl: currentUrl,
    skillCount,
  }
}

const INSTALL_LOCK_STALE_MS = 3 * 60_000

async function acquireInstallLock(projectRoot: string) {
  const dir = path.join(projectRoot, ".oneskills")
  mkdirSync(dir, { recursive: true })
  try {
    return await Flock.acquire(path.resolve(projectRoot), {
      dir,
      timeoutMs: 0,
      staleMs: INSTALL_LOCK_STALE_MS,
    })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Timed out waiting for lock")) {
      throw new Error("OneSkills 正在更新中，请稍后再试")
    }
    throw error
  }
}

export async function installFromRelease(options: ReleaseInstallOptions = {}) {
  const projectRoot = options.projectRoot ?? globalProjectRoot()
  const lock = await acquireInstallLock(projectRoot)
  try {
    const downloaded = await downloadRelease(options.url ?? releaseUrl())
    try {
      return await installFromPackageRoot(downloaded.packageRoot, {
        ...options,
        projectRoot,
      })
    } finally {
      downloaded.cleanup()
    }
  } finally {
    await lock.release()
  }
}

export * as OneSkillsRelease from "./release"
