/**
 * npm publish version helpers for CI-only releases.
 * Source package.json version is the base; npm publish version adds a CST (Asia/Shanghai) timestamp suffix.
 *
 * Once a publish version is chosen (e.g. 1.14.50-202607250911), every package in the same
 * CI run (@onescience/onecode and @onescience/onecode-web) must reuse it — never call
 * {@link npmPublishVersionFromBase} again, or minute-level timestamps can drift apart.
 */

const CST_OFFSET_MS = 8 * 60 * 60 * 1000

/** YYYYMMDDHHmm in Asia/Shanghai (UTC+8), aligned with CI host `timedatectl`. */
export function cstPublishTimestamp(date = new Date()): string {
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

/** @deprecated Use {@link cstPublishTimestamp}; kept for callers expecting the old name. */
export const utcPublishTimestamp = cstPublishTimestamp

export function npmPublishVersionFromBase(baseVersion: string, date = new Date()): string {
  return `${baseVersion}-${cstPublishTimestamp(date)}`
}

/** Parse `--publish-version=<ver>` from argv (preferred over regenerating a timestamp). */
export function publishVersionFromArgv(argv: string[] = process.argv): string | undefined {
  const eq = argv.find((a) => a.startsWith("--publish-version="))
  if (eq) {
    const value = eq.slice("--publish-version=".length).trim()
    return value || undefined
  }
  const idx = argv.indexOf("--publish-version")
  if (idx >= 0) {
    const value = argv[idx + 1]?.trim()
    return value || undefined
  }
  return undefined
}

/**
 * Resolve npm publish version without mutating the source tree.
 * Prefer an already-chosen version (argv / env) so onecode and onecode-web stay in lockstep.
 */
export function resolveNpmPublishVersion(baseVersion: string, explicit?: string): string {
  const chosen =
    explicit?.trim() ||
    publishVersionFromArgv()?.trim() ||
    process.env.OPENCODE_NPM_PUBLISH_VERSION?.trim()
  if (chosen) return chosen

  if (process.env.OPENCODE_NPM_CI === "1") {
    return npmPublishVersionFromBase(baseVersion)
  }

  const legacy = process.env.OPENCODE_VERSION?.trim()
  if (legacy) return legacy

  return baseVersion
}

export function resolveNpmDistTag(fallback?: string): string {
  const explicit = process.env.OPENCODE_NPM_DIST_TAG?.trim()
  if (explicit) return explicit

  if (process.env.OPENCODE_NPM_CI === "1") return "latest"

  if (fallback) return fallback

  const channel = process.env.OPENCODE_CHANNEL?.trim()
  if (channel) return channel

  return "latest"
}
