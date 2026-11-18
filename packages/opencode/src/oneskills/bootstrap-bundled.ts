import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs"
import path from "path"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { resolveInstallIdentity } from "@opencode-ai/core/install-identity"
import * as Log from "@opencode-ai/core/util/log"
import { OneSkills } from "./index"
import { installFromRelease } from "./release"

const log = Log.create({ service: "oneskills-bootstrap" })

const SYNC_STATE_REL = path.join(".oneskills", "bundled-sync.json")

type BundledSyncState = {
  onecodeVersion: string
  skillsVersion?: string
  skillCount: number
  syncedAt: number
}

export const BUNDLED_ITEMS = [
  "skills",
  "onescience",
  "references",
  "integrations",
  "catalog",
  "opencode.jsonc.snippet",
] as const

function bundledOneskillsDir(packageRoot: string) {
  return path.join(packageRoot, OneSkills.NAMESPACE_ROOT)
}

function electronResourcesPath(): string | undefined {
  const value = (process as { resourcesPath?: unknown }).resourcesPath
  return typeof value === "string" ? value : undefined
}

/** True when candidate's nested oneskills path is the live install target (not a package bundle). */
function isInstallTargetPackageRoot(candidate: string) {
  return path.resolve(bundledOneskillsDir(candidate)) === path.resolve(OneSkills.root())
}

/** Nested `.opencode/oneskills` package layout, or a flat oneskills repo checkout. */
export function resolveBundledOneskillsSource(): { packageRoot: string; bundled: string } | undefined {
  const packageRoot = resolveBundledPackageRoot()
  if (packageRoot) {
    const nested = bundledOneskillsDir(packageRoot)
    if (existsSync(path.join(nested, "skills"))) return { packageRoot, bundled: nested }
  }

  const resourcesPath = electronResourcesPath()
  const flatCandidates = [
    // Electron desktop: oneskills staged into extraResources/oneskills at pack time.
    resourcesPath ? path.join(resourcesPath, "oneskills") : undefined,
    process.env.ONESKILLS_REPO?.trim(),
    process.env.ONECODE_ROOT?.trim() ? path.join(path.resolve(process.env.ONECODE_ROOT.trim()), "..", "oneskills") : undefined,
  ].filter((item): item is string => Boolean(item))

  for (const repo of flatCandidates) {
    const root = path.resolve(repo)
    if (!existsSync(path.join(root, "skills"))) continue
    const electronRoot =
      resourcesPath && root.startsWith(path.resolve(resourcesPath))
        ? resourcesPath
        : root
    return { packageRoot: electronRoot, bundled: root }
  }

  return undefined
}

export function resolveBundledPackageRoot() {
  const resourcesPath = electronResourcesPath()
  const resourceCandidates = resourcesPath
    ? [
        resourcesPath,
        path.join(resourcesPath, "app.asar.unpacked"),
        path.join(resourcesPath, ".."),
      ]
    : []

  for (const candidate of resourceCandidates) {
    if (isInstallTargetPackageRoot(candidate)) continue
    if (existsSync(path.join(candidate, OneSkills.NAMESPACE_ROOT, "skills"))) {
      return candidate
    }
    if (existsSync(path.join(candidate, "oneskills", "skills"))) {
      return candidate
    }
  }

  let current = path.resolve(path.dirname(process.execPath))

  for (let depth = 0; depth < 8; depth++) {
    if (!isInstallTargetPackageRoot(current) && existsSync(path.join(current, OneSkills.NAMESPACE_ROOT, "skills"))) {
      return current
    }

    const sibling = path.join(current, "onecode")
    if (!isInstallTargetPackageRoot(sibling) && existsSync(path.join(sibling, OneSkills.NAMESPACE_ROOT, "skills"))) {
      return sibling
    }

    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }

  const envRoot = process.env.ONECODE_ROOT?.trim()
  if (envRoot) {
    const root = path.resolve(envRoot)
    if (!isInstallTargetPackageRoot(root) && existsSync(path.join(root, OneSkills.NAMESPACE_ROOT, "skills"))) return root
    const opencodePkg = path.join(root, "packages", "opencode")
    if (!isInstallTargetPackageRoot(opencodePkg) && existsSync(path.join(opencodePkg, OneSkills.NAMESPACE_ROOT, "skills"))) {
      return opencodePkg
    }
  }

  return undefined
}

export function bootstrapBundled() {
  const source = resolveBundledOneskillsSource()
  if (!source) {
    log.info("skip bundled OneSkills bootstrap; no pre-installed package content found")
    return { skipped: true as const, reason: "no bundled oneskills" as const, copied: [] as string[], target: undefined }
  }

  const { packageRoot, bundled } = source
  if (!existsSync(path.join(bundled, "skills"))) {
    log.info("skip bundled OneSkills bootstrap; bundled skills directory missing", { bundled })
    return { skipped: true as const, reason: "missing bundled skills" as const, copied: [] as string[], target: undefined }
  }

  const projectRoot = OneSkills.globalProjectRoot()
  const target = OneSkills.root(projectRoot)
  if (path.resolve(bundled) === path.resolve(target)) {
    log.info("skip bundled OneSkills bootstrap; resolved source is the install target", { bundled, target })
    return { skipped: true as const, reason: "source is install target" as const, copied: [] as string[], target }
  }
  mkdirSync(target, { recursive: true })

  const refreshBundled = needsBundledRefresh(bundled, target, packageRoot, projectRoot)
  const copied: string[] = []
  for (const item of BUNDLED_ITEMS) {
    const src = path.join(bundled, item)
    const dst = path.join(target, item)
    if (!existsSync(src) || !shouldCopyBundledItem(item, dst, refreshBundled)) continue
    replaceBundledItem(item, src, dst)
    copied.push(item)
  }

  const bundledState = path.join(packageRoot, ".oneskills", "install-state")
  const targetState = path.join(projectRoot, ".oneskills", "install-state")
  if (existsSync(bundledState) && (!existsSync(targetState) || refreshBundled)) {
    mkdirSync(path.dirname(targetState), { recursive: true })
    cpSync(bundledState, targetState, { recursive: true })
    if (!copied.includes(".oneskills/install-state")) copied.push(".oneskills/install-state")
  }

  if (copied.length > 0) {
    writeSyncState(projectRoot, {
      onecodeVersion: readInstallIdentity(packageRoot),
      skillsVersion: readManifestSkillsVersion(path.join(bundled, "catalog/manifest.json")),
      skillCount: listSkillNames(path.join(bundled, "skills")).length,
      syncedAt: Date.now(),
    })
    log.info("bootstrapped bundled OneSkills", { packageRoot, projectRoot, target, copied, refreshBundled })
  } else {
    log.info("bundled OneSkills already present", { target, refreshBundled })
  }

  return { skipped: false as const, copied, target, projectRoot, packageRoot, refreshBundled }
}

export async function run() {
  const result = bootstrapBundled()
  const skillsDir = OneSkills.skillsDir()
  if (OneSkills.hasDiscoverableSkills(skillsDir)) {
    const legacyRemoved = OneSkills.removeLegacyFlatLayout(result.projectRoot ?? OneSkills.globalProjectRoot())
    if (legacyRemoved.length > 0) {
      log.info("removed legacy flat OneSkills layout", { legacyRemoved })
      return { ...result, legacyRemoved }
    }
    return result
  }

  // Electron desktop sidecar runs under Node (utilityProcess), not Bun.
  // installFromRelease() uses Bun APIs and will throw "Bun is not defined".
  if (typeof (globalThis as { Bun?: unknown }).Bun === "undefined") {
    log.warn("skip OneSkills release fallback; Bun runtime is not available", {
      skillsDir,
      packageRoot: result.packageRoot,
    })
    return { ...result, repaired: false as const, reason: "no-bun" as const }
  }

  log.info("repairing OneSkills install via release fallback", { skillsDir })
  await installFromRelease({ force: true })
  return { ...result, repaired: true as const }
}

function shouldCopyBundledItem(item: (typeof BUNDLED_ITEMS)[number], dst: string, refreshBundled: boolean) {
  if (!existsSync(dst)) return true
  if (refreshBundled) return true
  if (item === "skills") return !OneSkills.hasDiscoverableSkills(dst)
  return false
}

function replaceBundledItem(item: (typeof BUNDLED_ITEMS)[number], src: string, dst: string) {
  if (path.resolve(src) === path.resolve(dst)) return
  if (existsSync(dst)) rmSync(dst, { recursive: true, force: true })
  mkdirSync(path.dirname(dst), { recursive: true })
  cpSync(src, dst, { recursive: true })
}

function syncStatePath(projectRoot: string) {
  return path.join(projectRoot, SYNC_STATE_REL)
}

function readSyncState(projectRoot: string) {
  const file = syncStatePath(projectRoot)
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, "utf8")) as BundledSyncState
  } catch {
    return undefined
  }
}

function writeSyncState(projectRoot: string, state: BundledSyncState) {
  const file = syncStatePath(projectRoot)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`)
}

function readInstallIdentity(packageRoot: string) {
  return resolveInstallIdentity({
    packageRoot,
    searchRoots: [
      packageRoot,
      path.join(packageRoot, ".."),
      electronResourcesPath(),
      path.dirname(process.execPath),
    ].filter((item): item is string => Boolean(item)),
    compiledVersion: InstallationVersion,
  })
}

function readManifestSkillsVersion(manifestFile: string) {
  if (!existsSync(manifestFile)) return undefined
  try {
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { skills_version?: string; version?: string }
    const version = manifest.skills_version ?? manifest.version
    return typeof version === "string" && version.trim() ? version.trim() : undefined
  } catch {
    return undefined
  }
}

function listSkillNames(skillsDir: string) {
  if (!existsSync(skillsDir) || !OneSkills.hasDiscoverableSkills(skillsDir)) return [] as string[]
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => existsSync(path.join(skillsDir, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort()
}

export function needsBundledRefresh(bundled: string, target: string, packageRoot: string, projectRoot: string) {
  const bundledSkills = path.join(bundled, "skills")
  const targetSkills = path.join(target, "skills")
  if (!OneSkills.hasDiscoverableSkills(targetSkills)) return true

  const packageVersion = readInstallIdentity(packageRoot)
  const stored = readSyncState(projectRoot)
  if (packageVersion && packageVersion !== "unknown" && stored?.onecodeVersion !== packageVersion) return true

  const bundledNames = listSkillNames(bundledSkills)
  const installedNames = listSkillNames(targetSkills)
  if (bundledNames.length !== installedNames.length) return true
  for (let index = 0; index < bundledNames.length; index++) {
    if (bundledNames[index] !== installedNames[index]) return true
  }

  const bundledManifest = readManifestSkillsVersion(path.join(bundled, "catalog/manifest.json"))
  const installedManifest = readManifestSkillsVersion(path.join(target, "catalog/manifest.json"))
  if (bundledManifest && bundledManifest !== installedManifest) return true

  return false
}

export * as OneSkillsBootstrapBundled from "./bootstrap-bundled"
