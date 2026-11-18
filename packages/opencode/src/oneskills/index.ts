import { existsSync, mkdirSync, readdirSync, rmSync } from "fs"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { OneCodeExtraPath } from "@opencode-ai/core/extra-path"
import { installFromRelease } from "./release"

export const OFFICIAL_SKILL_NAMES = [
  "onescience-cli",
  "onescience-coder",
  "onescience-data-analyzer",
  "onescience-data-profile",
  "onescience-dataset-builder",
  "onescience-infer",
  "onescience-installer",
  "onescience-orchestrator",
  "onescience-paper-repro",
  "onescience-parallel",
  "onescience-primitives",
  "onescience-research-workflow",
  "onescience-runsite",
  "onescience-runtime",
  "scnet-chat",
] as const

const LEGACY_FLAT_PATHS = [
  "skills/VERSION",
  "references",
  "onescience",
  "integrations",
  "opencode.jsonc.snippet",
] as const

/** Web / server install layout (unchanged). */
export const NAMESPACE_ROOT = ".opencode/oneskills"

/** Desktop install layout under ~/.agents/oneskills (bundled sync target). */
export const AGENTS_ONESKILLS_ROOT = ".agents/oneskills"

export type SkillScanTarget = {
  root: string
  patterns: readonly string[]
}

function isDesktopClient() {
  return (process.env.OPENCODE_CLIENT ?? "cli") === "desktop"
}

export function namespaceRoot() {
  return isDesktopClient() ? AGENTS_ONESKILLS_ROOT : NAMESPACE_ROOT
}

export function globalProjectRoot() {
  const extra = OneCodeExtraPath.root()
  if (extra) return extra
  return Global.Path.home
}

export function hasDiscoverableSkills(root: string) {
  if (!existsSync(root)) return false
  if (existsSync(path.join(root, "SKILL.md"))) return true
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (existsSync(path.join(root, entry.name, "SKILL.md"))) return true
  }
  return false
}

export function globalHomeOpencodeDir() {
  return path.join(Global.Path.home, ".opencode")
}

export function globalAgentsOneskillsDir() {
  return path.join(Global.Path.home, ".agents", "oneskills")
}

export function globalAgentsSkillsDir() {
  return path.join(Global.Path.home, ".agents", "skills")
}

export function globalSkillScanTargets(options?: { includeSharedUserSkills?: boolean }): SkillScanTarget[] {
  const includeSharedUserSkills = options?.includeSharedUserSkills !== false
  const homeOpencode = globalHomeOpencodeDir()
  const extra = OneCodeExtraPath.root()

  if (isDesktopClient()) {
    const targets: SkillScanTarget[] = [
      { root: globalAgentsOneskillsDir(), patterns: ["skills/*/SKILL.md"] },
      { root: globalAgentsSkillsDir(), patterns: ["*/SKILL.md"] },
      // Compatibility: still see ~/.opencode skills if present (no migration).
      {
        root: homeOpencode,
        patterns: includeSharedUserSkills
          ? ["oneskills/skills/*/SKILL.md", "{skill,skills}/*/SKILL.md", "skill/*/SKILL.md"]
          : ["oneskills/skills/*/SKILL.md"],
      },
    ]
    if (extra) {
      targets.unshift(
        { root: path.join(extra, AGENTS_ONESKILLS_ROOT), patterns: ["skills/*/SKILL.md"] },
        { root: path.join(extra, ".agents", "skills"), patterns: ["*/SKILL.md"] },
      )
    }
    return targets
  }

  if (extra) {
    const targets: SkillScanTarget[] = [
      { root: path.join(extra, NAMESPACE_ROOT), patterns: ["skills/*/SKILL.md"] },
    ]
    if (includeSharedUserSkills) {
      targets.push({ root: homeOpencode, patterns: ["{skill,skills}/*/SKILL.md", "skill/*/SKILL.md"] })
    }
    return targets
  }
  return [
    {
      root: homeOpencode,
      patterns: includeSharedUserSkills
        ? ["oneskills/skills/*/SKILL.md", "{skill,skills}/*/SKILL.md", "skill/*/SKILL.md"]
        : ["oneskills/skills/*/SKILL.md"],
    },
  ]
}

export function isGlobalHomeOpencodeDir(dir: string) {
  return path.resolve(dir) === path.resolve(globalHomeOpencodeDir())
}

export function root(projectRoot = globalProjectRoot()) {
  return path.join(projectRoot, namespaceRoot())
}

export function skillsDir(projectRoot = globalProjectRoot()) {
  return path.join(root(projectRoot), "skills")
}

export function manifestFile(projectRoot = globalProjectRoot()) {
  return path.join(root(projectRoot), "catalog/manifest.json")
}

export function installStateFile(projectRoot = globalProjectRoot()) {
  return path.join(projectRoot, ".oneskills/install-state/opencode.json")
}

export function configSnippetFile(projectRoot = globalProjectRoot()) {
  return path.join(root(projectRoot), "opencode.jsonc.snippet")
}

export function findInstallerScript() {
  const env = process.env.ONESKILLS_REPO
  const candidates = [
    env ? path.join(env, "install/install_oneskills.py") : undefined,
    path.join(Global.Path.home, "oneskills/install/install_oneskills.py"),
  ].filter((item): item is string => item !== undefined)

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

export function installerRepoRoot(installerScript: string) {
  return path.resolve(path.dirname(installerScript), "..")
}

type InstallOptions = {
  profile?: "basic" | "runtime"
  mode?: "copy" | "symlink"
  force?: boolean
  projectRoot?: string
  dryRun?: boolean
}

export async function install(options: InstallOptions = {}) {
  return installFromRelease({
    force: options.force,
    projectRoot: options.projectRoot,
    dryRun: options.dryRun,
  })
}

export async function runInstaller(options: InstallOptions = {}) {
  return install(options)
}

function legacyFlatRoot(projectRoot: string) {
  return path.join(projectRoot, ".opencode")
}

export function removeLegacyFlatLayout(projectRoot = globalProjectRoot()) {
  const opencodeRoot = legacyFlatRoot(projectRoot)
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

export async function publishManifest(repoRoot: string, projectRoot = globalProjectRoot()) {
  const source = path.join(repoRoot, "catalog/manifest.json")
  const target = manifestFile(projectRoot)
  const file = Bun.file(source)
  if (!(await file.exists())) return false
  mkdirSync(path.dirname(target), { recursive: true })
  await Bun.write(target, file)
  return true
}

export async function uninstall(projectRoot = globalProjectRoot(), dryRun = false) {
  const script = findInstallerScript()
  if (!script) throw new Error("OneSkills installer not found.")

  const args = [script, "--agent", "opencode", "--project", projectRoot, "--uninstall"]
  if (dryRun) args.push("--dry-run")

  const proc = Bun.spawn(["python3", ...args], {
    stdout: "inherit",
    stderr: "inherit",
    cwd: installerRepoRoot(script),
  })
  const code = await proc.exited
  if (code !== 0) throw new Error(`OneSkills uninstall failed with exit code ${code}`)
}

export type InstallState = {
  schema_version: number
  agent: string
  mode: string
  profile: string
  targets: string[]
}

export async function readInstallState(projectRoot = globalProjectRoot()) {
  const file = Bun.file(installStateFile(projectRoot))
  if (!(await file.exists())) return undefined
  return (await file.json()) as InstallState
}

export async function status(projectRoot = globalProjectRoot()) {
  const state = await readInstallState(projectRoot)
  const manifest = Bun.file(manifestFile(projectRoot))
  return {
    projectRoot,
    root: root(projectRoot),
    skillsDir: skillsDir(projectRoot),
    installed: state !== undefined,
    mode: state?.mode,
    profile: state?.profile,
    targets: state?.targets ?? [],
    manifest: (await manifest.exists()) ? manifestFile(projectRoot) : undefined,
    installer: findInstallerScript(),
  }
}

export async function upgrade(options: InstallOptions = {}) {
  return installFromRelease({
    force: true,
    projectRoot: options.projectRoot,
    dryRun: options.dryRun,
  })
}

export const UPGRADED_EVENT = "oneskills.upgraded"

export * as OneSkills from "./index"
export { DEFAULT_RELEASE_URL, installFromRelease, releaseUrl } from "./release"
