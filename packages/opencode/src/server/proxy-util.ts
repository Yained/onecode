const hop = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
])

function sanitize(out: Headers) {
  for (const key of hop) out.delete(key)
  out.delete("accept-encoding")
  out.delete("x-opencode-directory")
  out.delete("x-opencode-workspace")
  // Leaf PTY/shell must not inherit A's platform session (that remaps HOME onto
  // control-plane workspace roots that do not exist on B).
  out.delete("x-platform-auth-token")
}

export function headers(input: Request | HeadersInit | Record<string, string>, extra?: HeadersInit) {
  const raw = input instanceof Request ? input.headers : input
  const out = new Headers(raw instanceof Headers ? raw : Object.entries(raw as Record<string, string>))
  sanitize(out)
  if (!extra) return out
  for (const [key, value] of new Headers(extra).entries()) {
    out.set(key, value)
  }
  return out
}

/**
 * Headers for A→B HTTP. Browser Origin is A's public URL; B's Host is 127.0.0.1,
 * so leftover leaf serves reject PTY connect-token (CSRF/origin 403). Rewrite Origin
 * to the tunnel target so B's same-origin check matches.
 */
export function leafHeaders(
  input: Request | HeadersInit | Record<string, string>,
  extra: HeadersInit | undefined,
  target: string | URL,
) {
  const out = headers(input, extra)
  out.delete("origin")
  out.delete("referer")
  try {
    out.set("origin", new URL(target).origin)
  } catch {
    // leave Origin unset — B treats a missing Origin as allowed
  }
  return out
}

export function websocketProtocols(input: Request | Record<string, string | undefined>) {
  const value = input instanceof Request ? input.headers.get("sec-websocket-protocol") : input["sec-websocket-protocol"]
  if (!value) return []
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

export function websocketTargetURL(url: string | URL) {
  const next = new URL(url)
  if (next.protocol === "http:") next.protocol = "ws:"
  if (next.protocol === "https:") next.protocol = "wss:"
  return next.toString()
}

export * as ProxyUtil from "./proxy-util"
