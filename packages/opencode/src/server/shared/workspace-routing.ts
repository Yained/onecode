import { SessionID } from "@/session/schema"

type Rule = { method?: string; path: string; exact?: boolean; action: "local" | "forward" }

const RULES: Array<Rule> = [
  { path: "/experimental/workspace", action: "local" },
  { path: "/experimental/session", action: "local" },
  { path: "/experimental/onescience/data-project", action: "local" },
  { path: "/experimental/onescience/probe", action: "local" },
  { path: "/experimental/onescience/raw-source", action: "local" },
  { path: "/experimental/onescience/already", action: "local" },
  { path: "/experimental/onescience/session", action: "local" },
  { path: "/experimental/onescience/object-store-key", action: "local" },
  { path: "/experimental/onescience/db-connection", action: "local" },
  { method: "DELETE", path: "/project/current", exact: true, action: "local" },
  { path: "/sync", action: "local" },
]

function isSessionViewerRoute(path: string) {
  return /^\/session\/[^/]+\/view(?:\/heartbeat)?$/.test(path)
}

/** Prompt/abort/status/live transcript must run on the leaf. Session records stay on A. */
export function isSessionTranscriptReadRoute(method: string, path: string) {
  if (method !== "GET") return false
  return (
    /^\/session\/[^/]+\/messages?(?:\/|$)/.test(path) || /^\/api\/session\/[^/]+\/messages?(?:\/|$)/.test(path)
  )
}

function isSessionExecutionRoute(method: string, path: string) {
  if (path === "/session/status" || path.startsWith("/session/status/")) return true
  // Busy UI polls GET /message against A; if the turn ran on B the timeline stays on 思考中.
  if (isSessionTranscriptReadRoute(method, path)) return true
  if (method !== "POST") return false
  return (
    /^\/session\/[^/]+\/(prompt_async|prompt|command|shell|abort|init|summarize)$/.test(path) ||
    /^\/session\/[^/]+\/message$/.test(path) ||
    /^\/session\/[^/]+\/permissions\//.test(path)
  )
}

function isSessionRecordRoute(path: string) {
  return path === "/session" || path.startsWith("/session/")
}

export function isLocalWorkspaceRoute(method: string, path: string) {
  if (isSessionViewerRoute(path)) return true
  if (isSessionExecutionRoute(method, path)) return false
  if (isSessionRecordRoute(path)) return true
  for (const rule of RULES) {
    if (rule.method && rule.method !== method) continue
    const match = rule.exact ? path === rule.path : path === rule.path || path.startsWith(rule.path + "/")
    if (match) return rule.action === "local"
  }
  return false
}

export function getWorkspaceRouteSessionID(url: URL) {
  if (url.pathname === "/session/status") return null

  const id = url.pathname.match(/^\/session\/([^/]+)(?:\/|$)/)?.[1]
  if (!id) return null

  return SessionID.make(id)
}

export function workspaceProxyURL(target: string | URL, requestURL: URL) {
  const proxyURL = new URL(target)
  proxyURL.pathname = `${proxyURL.pathname.replace(/\/$/, "")}${requestURL.pathname}`
  proxyURL.search = requestURL.search
  proxyURL.hash = requestURL.hash
  proxyURL.searchParams.delete("workspace")
  // `directory` 来自 A 本机工作目录，转发到 B 时无意义且可能解析错误（见上游 #40136）
  proxyURL.searchParams.delete("directory")
  return proxyURL
}

/** Leaf Instance directory from ssh-node `target.headers` (`x-opencode-directory` = remotePath). */
export function leafDirectoryFromTargetHeaders(headers?: HeadersInit) {
  if (!headers) return
  const value = new Headers(headers).get("x-opencode-directory")?.trim()
  return value || undefined
}

/**
 * HTTP proxy already forwards extra headers. WebSocket upgrades cannot, so stamp
 * the same leaf directory onto the proxied URL. PTY tickets and InstanceState are
 * keyed by directory — create/connect-token on B with remotePath must match WS connect.
 */
export function stampLeafDirectoryOnProxyURL(proxyURL: URL, extraHeaders?: HeadersInit) {
  const leaf = leafDirectoryFromTargetHeaders(extraHeaders)
  if (leaf) proxyURL.searchParams.set("directory", leaf)
  return proxyURL
}
