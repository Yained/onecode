import { createHash } from "crypto"
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs"
import path from "path"
import { Database } from "@/storage/db"
import { OneSkills } from "@/oneskills"
import {
  oneskillsPrimitivesAssetsRoot,
  scanOneskillsPrimitiveAssets,
  seedPrimitivesFromEntries,
  type OneskillsPrimitiveMetadata,
  type OneskillsSeedPrimitive,
} from "./oneskills-primitive-ingest"
import bundledSeed from "./oneskills-primitive-seed.json"

export type PrimitiveSeedAsset = {
  assetKey: string
  metadata: OneskillsPrimitiveMetadata
  files: Record<string, string>
}

export type PrimitiveSeedBundle = {
  version: string
  upstreamVersion?: string
  source?: string
  generatedAt?: string
  assetCount?: number
  assets: PrimitiveSeedAsset[]
}

export type ResolvedPrimitiveSeed = {
  bundle: PrimitiveSeedBundle
  source: "disk" | "bundled"
  fallbackReason?: string
}

export const MARKER_SUFFIX = ".primitive-seed.applied.json"

export type AppliedPrimitiveSeedMarker = {
  version: string
  appliedAt: string
  assetCount: number
}

export function bundledPrimitiveSeed() {
  return bundledSeed as PrimitiveSeedBundle
}

export function seedBundleFromAssetsRoot(assetsRoot: string, version: string): PrimitiveSeedBundle {
  const scanned = scanOneskillsPrimitiveAssets(assetsRoot)
  return {
    version,
    source: "disk-assets",
    generatedAt: new Date().toISOString(),
    assetCount: scanned.length,
    assets: scanned.map((item) => ({
      assetKey: item.assetKey,
      metadata: item.metadata,
      files: item.files,
    })),
  }
}

export function seedPrimitivesFromBundle(bundle: PrimitiveSeedBundle): OneskillsSeedPrimitive[] {
  return seedPrimitivesFromEntries(bundle.assets)
}

export function appliedMarkerPath(dbPath = Database.getPath()) {
  if (dbPath === ":memory:") return path.join(process.cwd(), "opencode.memory.primitive-seed.applied.json")
  return `${dbPath}${MARKER_SUFFIX}`
}

export function readAppliedPrimitiveSeed(dbPath = Database.getPath()): AppliedPrimitiveSeedMarker | undefined {
  const file = appliedMarkerPath(dbPath)
  if (!existsSync(file)) return undefined
  const raw = readFileSync(file, "utf8").trim()
  if (!raw) return undefined
  return JSON.parse(raw) as AppliedPrimitiveSeedMarker
}

export function writeAppliedPrimitiveSeed(marker: AppliedPrimitiveSeedMarker, dbPath = Database.getPath()) {
  const file = appliedMarkerPath(dbPath)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(marker, null, 2)}\n`)
}

export function clearAppliedPrimitiveSeed(dbPath = Database.getPath()) {
  const file = appliedMarkerPath(dbPath)
  if (!existsSync(file)) return
  unlinkSync(file)
}

export function shouldApplyPrimitiveSeed(bundle: PrimitiveSeedBundle, options: { force?: boolean; dbPath?: string } = {}) {
  if (options.force) return true
  const applied = readAppliedPrimitiveSeed(options.dbPath)
  if (!applied) return true
  return applied.version !== bundle.version
}

/** Strip content-hash suffix: `2026.07.09+abc` → `2026.07.09`. */
export function seedUpstreamVersion(version: string) {
  const index = version.indexOf("+")
  if (index <= 0) return version
  return version.slice(0, index)
}

/**
 * Prefer disk when it is strictly newer than the last applied marker, or when nothing
 * has been applied yet. Same upstream with a different content hash counts as newer.
 */
export function isSeedVersionNewer(candidate: string, baseline: string | undefined) {
  if (!baseline) return true
  const candidateUpstream = seedUpstreamVersion(candidate)
  const baselineUpstream = seedUpstreamVersion(baseline)
  if (candidateUpstream !== baselineUpstream) return candidateUpstream > baselineUpstream
  return candidate !== baseline
}

export function readInstalledOneskillsVersion(projectRoot = OneSkills.globalProjectRoot()) {
  const root = OneSkills.root(projectRoot)
  for (const file of [path.join(root, "VERSION"), path.join(root, "skills", "VERSION")]) {
    if (!existsSync(file)) continue
    const version = readFileSync(file, "utf8").trim()
    if (version) return version
  }
  const manifestPath = OneSkills.manifestFile(projectRoot)
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: string; skills_version?: string }
    const version = manifest.version ?? manifest.skills_version
    if (version) return String(version).trim()
  }
  const statePath = OneSkills.installStateFile(projectRoot)
  if (existsSync(statePath)) {
    const state = JSON.parse(readFileSync(statePath, "utf8")) as { version?: string }
    if (state.version?.trim()) return state.version.trim()
  }
  return undefined
}

function contentHashForAssets(assets: PrimitiveSeedAsset[]) {
  return createHash("sha256").update(JSON.stringify(assets)).digest("hex").slice(0, 12)
}

export function tryBuildDiskPrimitiveSeed(options: {
  projectRoot?: string
  assetsRoot?: string
} = {}): PrimitiveSeedBundle | undefined {
  const assetsRoot = options.assetsRoot ?? oneskillsPrimitivesAssetsRoot(options.projectRoot)
  if (!existsSync(assetsRoot)) return
  const scanned = scanOneskillsPrimitiveAssets(assetsRoot)
  if (scanned.length === 0) return
  const assets = scanned.map((item) => ({
    assetKey: item.assetKey,
    metadata: item.metadata,
    files: item.files,
  }))
  const upstreamVersion = readInstalledOneskillsVersion(options.projectRoot) ?? new Date().toISOString().slice(0, 10).replaceAll("-", ".")
  const hash = contentHashForAssets(assets)
  return {
    version: `${upstreamVersion}+${hash}`,
    upstreamVersion,
    source: "disk-assets",
    generatedAt: new Date().toISOString(),
    assetCount: assets.length,
    assets,
  }
}

export function validateDiskPrimitiveSeed(
  disk: PrimitiveSeedBundle,
  bundled: PrimitiveSeedBundle = bundledPrimitiveSeed(),
): { ok: true } | { ok: false; reason: string } {
  const assetCount = disk.assets.length
  if (assetCount === 0) return { ok: false, reason: "disk assets empty" }

  const bundledCount = bundled.assets.length
  const minCount = bundledCount > 0 ? Math.max(1, Math.floor(bundledCount * 0.5)) : 1
  if (assetCount < minCount) {
    return { ok: false, reason: `disk asset count ${assetCount} below minimum ${minCount}` }
  }

  const missingDescription = disk.assets.filter((asset) => {
    const description = asset.metadata.description
    return typeof description !== "string" || !description.trim()
  }).length
  if (missingDescription / assetCount > 0.2) {
    return { ok: false, reason: `disk assets missing descriptions (${missingDescription}/${assetCount})` }
  }

  const missingName = disk.assets.filter((asset) => !asset.metadata.name?.trim()).length
  if (missingName > 0) {
    return { ok: false, reason: `disk assets missing names (${missingName}/${assetCount})` }
  }

  return { ok: true }
}

/**
 * Prefer a newer (or already-applied) installed oneskills assets tree; fall back to the
 * onecode-bundled seed when disk is missing, older than applied, or fails validation.
 */
export function resolvePrimitiveSeedBundle(options: {
  projectRoot?: string
  assetsRoot?: string
  dbPath?: string
  bundled?: PrimitiveSeedBundle
} = {}): ResolvedPrimitiveSeed {
  const bundled = options.bundled ?? bundledPrimitiveSeed()
  const applied = readAppliedPrimitiveSeed(options.dbPath)
  const disk = tryBuildDiskPrimitiveSeed({
    projectRoot: options.projectRoot,
    assetsRoot: options.assetsRoot,
  })

  if (!disk) {
    return { bundle: bundled, source: "bundled", fallbackReason: "disk assets unavailable" }
  }

  const validation = validateDiskPrimitiveSeed(disk, bundled)
  if (!validation.ok) {
    return { bundle: bundled, source: "bundled", fallbackReason: validation.reason }
  }

  // Keep the current disk snapshot when it matches what we already applied, or when it is
  // strictly newer. Only fall back to bundled when the installed tree is older than applied.
  if (!applied || disk.version === applied.version || isSeedVersionNewer(disk.version, applied.version)) {
    return { bundle: disk, source: "disk" }
  }

  return { bundle: bundled, source: "bundled", fallbackReason: "disk older than applied seed" }
}

export * as OneskillsPrimitiveSeed from "./oneskills-primitive-seed"
