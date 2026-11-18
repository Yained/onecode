#!/usr/bin/env bun
/**
 * Snapshot onescience-primitives assets into the onecode release seed blob.
 *
 * Upstream: oneskills skills/onescience-primitives/assets
 * Output:   src/onescience/oneskills-primitive-seed.json
 *
 * Version defaults to `<oneskills VERSION>+<contentHash>` so content changes always
 * bump the applied marker. Pass an explicit version as argv[2] to override.
 * Runtime migrate applies upserts/soft-deletes only when that version changes.
 */
import { createHash } from "crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs"
import path from "path"

const COMPANIONS = ["spec.md", "usage.md", "workflow_planning.md"] as const

function resolveAssetsRoot() {
  const env = process.env.ONESKILLS_REPO?.trim()
  const candidates = [
    env ? path.join(env, "skills/onescience-primitives/assets") : undefined,
    path.join(process.env.HOME ?? "", "oneskills/skills/onescience-primitives/assets"),
    path.join(process.env.HOME ?? "", ".opencode/oneskills/skills/onescience-primitives/assets"),
  ].filter((item): item is string => Boolean(item))

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    `onescience-primitives assets not found. Set ONESKILLS_REPO or install oneskills. Tried:\n${candidates.join("\n")}`,
  )
}

function resolveUpstreamVersion(assetsRoot: string) {
  const packageRoot = path.resolve(assetsRoot, "../../..")
  for (const rel of ["VERSION", "skills/VERSION", "catalog/manifest.json"]) {
    const file = path.join(packageRoot, rel)
    if (!existsSync(file)) continue
    if (rel.endsWith("manifest.json")) {
      const manifest = JSON.parse(readFileSync(file, "utf8")) as { version?: string; skills_version?: string }
      const version = manifest.version ?? manifest.skills_version
      if (version) return String(version)
      continue
    }
    const version = readFileSync(file, "utf8").trim()
    if (version) return version
  }
  return new Date().toISOString().slice(0, 10).replaceAll("-", ".")
}

function walkMetadata(root: string, relative = ""): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const childRel = relative ? `${relative}/${entry.name}` : entry.name
    const childAbs = path.join(root, entry.name)
    if (entry.isDirectory()) return walkMetadata(childAbs, childRel)
    if (entry.isFile() && entry.name === "metadata.json") return [path.dirname(childRel).replaceAll("\\", "/")]
    return []
  })
}

const assetsRoot = resolveAssetsRoot()
const upstreamVersion = resolveUpstreamVersion(assetsRoot)
const keys = walkMetadata(assetsRoot).filter((key) => key && key !== ".").toSorted()

const assets = keys.map((assetKey) => {
  const absoluteDir = path.join(assetsRoot, ...assetKey.split("/"))
  const metadata = JSON.parse(readFileSync(path.join(absoluteDir, "metadata.json"), "utf8")) as Record<string, unknown>
  const files: Record<string, string> = {}
  for (const name of COMPANIONS) {
    const filePath = path.join(absoluteDir, name)
    if (!existsSync(filePath)) continue
    files[name] = readFileSync(filePath, "utf8")
  }
  return { assetKey, metadata, files }
})

const contentHash = createHash("sha256").update(JSON.stringify(assets)).digest("hex").slice(0, 12)
const version = process.argv[2]?.trim() || `${upstreamVersion}+${contentHash}`

const outDir = path.join(import.meta.dirname, "../src/onescience")
mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, "oneskills-primitive-seed.json")
writeFileSync(
  outFile,
  `${JSON.stringify({
    version,
    upstreamVersion,
    source: "oneskills/onescience-primitives",
    generatedAt: new Date().toISOString(),
    assetCount: assets.length,
    assets,
  })}\n`,
)
console.log(`Wrote ${assets.length} assets (version ${version}) -> ${outFile}`)
