import { existsSync, statSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"

/** Paths that must never be rewritten to index.html (API / protocol mistakes). */
export function isRendererApiPath(pathname: string) {
  const path = (pathname.split("?")[0] || "/").toLowerCase()
  return (
    path.startsWith("/platform/") ||
    path.startsWith("/global/") ||
    path.startsWith("/experimental/") ||
    path.startsWith("/session") ||
    path.startsWith("/file/") ||
    path.startsWith("/pty") ||
    path.startsWith("/provider") ||
    path.startsWith("/config") ||
    path.startsWith("/auth/") ||
    path.startsWith("/doc") ||
    path === "/event" ||
    path.startsWith("/event/") ||
    path.startsWith("/mcp") ||
    path.startsWith("/tui") ||
    path.startsWith("/instance")
  )
}

/**
 * Resolve a path under the packaged renderer root.
 * Client routes (e.g. /login) have no matching file — fall back to index.html
 * so window.location redirects from platform auth do not white-screen.
 */
export function resolveRendererAsset(pathname: string, rootDir: string): string | null {
  const decoded = decodeURIComponent(pathname || "/")
  const candidate = resolve(rootDir, `.${decoded.startsWith("/") ? decoded : `/${decoded}`}`)
  const rel = relative(rootDir, candidate)
  if (rel.startsWith("..") || isAbsolute(rel)) return null

  try {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  } catch {
    // fall through to SPA index
  }

  const leaf = decoded.split("/").filter(Boolean).pop() ?? ""
  const looksLikeAsset = /\.[a-zA-Z0-9]{1,12}$/.test(leaf)
  if (looksLikeAsset) return null
  if (isRendererApiPath(decoded)) return null

  const index = join(rootDir, "index.html")
  return existsSync(index) ? index : null
}
