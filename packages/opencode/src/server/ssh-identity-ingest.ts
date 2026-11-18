import fs from "fs/promises"
import os from "os"
import path from "path"

export const IDENTITY_MAX_BYTES = 64 * 1024

export function isWindowsIdentityPath(keyPath: string) {
  const trimmed = keyPath.trim()
  if (!trimmed) return false
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) return true
  if (trimmed.startsWith("\\\\") || trimmed.startsWith("//")) return true
  return false
}

/** True when this host cannot open the path (Windows drive on Linux, unix path on Windows). */
export function isUnreachableOnThisHost(keyPath: string) {
  const trimmed = keyPath.trim()
  if (isWindowsIdentityPath(trimmed)) return process.platform !== "win32"
  if (process.platform === "win32" && trimmed.startsWith("/") && !trimmed.startsWith("//")) return true
  return false
}

export function resolveIdentitySourcePath(keyPath: string, homedir = os.homedir()) {
  const trimmed = keyPath.trim()
  if (!trimmed) return ""
  if (trimmed === "~") return homedir
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(homedir, trimmed.slice(2))
  }
  return path.resolve(trimmed)
}

export function safeIdentityFileName(name: string) {
  return (path.basename(name.trim()) || "identity").replace(/[^A-Za-z0-9._-]/g, "_")
}

function isPathInsideRoot(root: string, target: string) {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
}

export type IngestIdentityResult =
  | { ok: true; keyPath: string; ingested: boolean }
  | { ok: false; reason: "empty" | "windows" | "notFound" | "invalid" }

/** Copy a server-local private key into the managed identity dir when needed. */
export async function ingestServerIdentityFile(input: {
  sourcePath: string
  destDir: string
  now?: number
}): Promise<IngestIdentityResult> {
  const source = input.sourcePath.trim()
  if (!source) return { ok: false, reason: "empty" }
  if (isUnreachableOnThisHost(source)) return { ok: false, reason: "windows" }

  const resolved = resolveIdentitySourcePath(source)

  const stat = await fs.stat(resolved).catch(() => undefined)
  if (!stat?.isFile() || stat.size <= 0 || stat.size > IDENTITY_MAX_BYTES) {
    return { ok: false, reason: "notFound" }
  }

  const content = await fs.readFile(resolved, "utf8").catch(() => "")
  if (!content.includes("PRIVATE KEY")) return { ok: false, reason: "invalid" }

  if (isPathInsideRoot(input.destDir, resolved)) {
    return { ok: true, keyPath: resolved, ingested: false }
  }

  await fs.mkdir(input.destDir, { recursive: true, mode: 0o700 })
  const dest = path.join(input.destDir, `${input.now ?? Date.now()}-${safeIdentityFileName(resolved)}`)
  await fs.writeFile(dest, `${content.trimEnd()}\n`, { mode: 0o600 })
  await fs.chmod(dest, 0o600).catch(() => undefined)
  return { ok: true, keyPath: dest, ingested: true }
}

export function normalizeIdentityPath(keyPath: string) {
  return path.resolve(keyPath.trim().replaceAll("\\", "/"))
}

/** Follow extra_path / home symlinks so `/data/...` and `/home/...` compare equal. */
export async function canonicalizeIdentityPath(keyPath: string) {
  const resolved = normalizeIdentityPath(keyPath)
  return fs.realpath(resolved).catch(() => resolved)
}

export function sshAuthKeyPath(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object") return
  const keyPath = (entry as { auth?: { keyPath?: unknown } }).auth?.keyPath
  if (typeof keyPath !== "string" || !keyPath.trim()) return
  return keyPath
}

/** Absolute IdentityFile paths still referenced by SSH targets (realpath when possible). */
export async function referencedIdentityPaths(ssh: Record<string, unknown> | undefined) {
  const out = new Set<string>()
  for (const entry of Object.values(ssh ?? {})) {
    const keyPath = sshAuthKeyPath(entry)
    if (!keyPath) continue
    out.add(await canonicalizeIdentityPath(keyPath))
  }
  return out
}

async function isInsideManagedIdentityDir(file: string, identityDirs: string[]) {
  for (const dir of identityDirs) {
    const root = await canonicalizeIdentityPath(dir)
    if (file === root || file.startsWith(`${root}${path.sep}`)) return true
  }
  return false
}

/**
 * Delete only the previous IdentityFile of one SSH target after it was replaced or removed.
 * Never sweeps the whole identities directory — other leftover keys stay put so a stale
 * OpenSSH IdentityFile / UI overlay cannot lose the live key.
 */
export async function releaseReplacedManagedIdentity(input: {
  identityDirs: string[]
  previousKeyPath?: string
  keepKeyPath?: string
  referenced: Set<string>
}) {
  const previousRaw = input.previousKeyPath?.trim()
  if (!previousRaw) return undefined
  const previous = await canonicalizeIdentityPath(previousRaw)
  const keep = input.keepKeyPath?.trim() ? await canonicalizeIdentityPath(input.keepKeyPath) : ""
  if (keep && previous === keep) return undefined
  if (!(await isInsideManagedIdentityDir(previous, input.identityDirs))) return undefined
  if (input.referenced.has(previous)) return undefined
  await fs.unlink(previous).catch(() => undefined)
  return previous
}
