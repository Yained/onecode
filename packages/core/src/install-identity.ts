import { existsSync, readFileSync } from "fs"
import path from "path"

const BUILD_FILE = "onecode-build.json"
const CST_OFFSET_MS = 8 * 60 * 60 * 1000

export type OnecodeBuildInfo = {
  version: string
  baseVersion?: string
  stamp?: string
}

/** YYYYMMDDHHmm in Asia/Shanghai (UTC+8), aligned with CI pack filenames. */
export function cstBuildStamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  const cst = new Date(date.getTime() + CST_OFFSET_MS)
  return [
    cst.getUTCFullYear(),
    pad(cst.getUTCMonth() + 1),
    pad(cst.getUTCDate()),
    pad(cst.getUTCHours()),
    pad(cst.getUTCMinutes()),
  ].join("")
}

/** Compose full install identity: `1.14.50-202607021504`. */
export function fullInstallIdentity(baseVersion: string, stamp = cstBuildStamp()): string {
  const base = baseVersion.trim()
  const mark = stamp.trim()
  if (!base) return mark || "unknown"
  if (!mark) return base
  if (base.endsWith(`-${mark}`) || /-\d{12}$/.test(base)) return base
  return `${base}-${mark}`
}

export function readBuildInfoFile(file: string): OnecodeBuildInfo | undefined {
  if (!existsSync(file)) return undefined
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<OnecodeBuildInfo>
    const version = typeof raw.version === "string" ? raw.version.trim() : ""
    if (!version) return undefined
    return {
      version,
      baseVersion: typeof raw.baseVersion === "string" ? raw.baseVersion.trim() : undefined,
      stamp: typeof raw.stamp === "string" ? raw.stamp.trim() : undefined,
    }
  } catch {
    return undefined
  }
}

/**
 * Resolve the install identity used for OneSkills refresh + desktop setup gating.
 * Preference: onecode-build.json near package → OPENCODE_VERSION env → package.json → fallback.
 */
export function resolveInstallIdentity(options: {
  packageRoot?: string
  searchRoots?: string[]
  packageVersion?: string
  compiledVersion?: string
  envVersion?: string
  fallback?: string
} = {}): string {
  const roots = [
    ...(options.packageRoot ? [options.packageRoot] : []),
    ...(options.searchRoots ?? []),
  ]

  for (const root of roots) {
    const info = readBuildInfoFile(path.join(root, BUILD_FILE))
    if (info?.version) return info.version
  }

  const envRaw = options.envVersion !== undefined ? options.envVersion : process.env.OPENCODE_VERSION
  const envVersion = envRaw?.trim()
  if (envVersion) return envVersion

  const compiled = options.compiledVersion?.trim()
  if (compiled && compiled !== "local") return compiled

  const pkg = options.packageVersion?.trim()
  if (pkg) return pkg

  for (const root of roots) {
    const pkgFile = path.join(root, "package.json")
    if (!existsSync(pkgFile)) continue
    try {
      const version = JSON.parse(readFileSync(pkgFile, "utf8")).version
      if (typeof version === "string" && version.trim()) return version.trim()
    } catch {
      continue
    }
  }

  return options.fallback?.trim() || "unknown"
}

export const ONECODE_BUILD_FILE = BUILD_FILE

export * as InstallIdentity from "./install-identity"
