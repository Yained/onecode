// Static UI assets the browser fetches without app-managed credentials, e.g.
// the manifest link in <head> and the auth-page brand <img>. These bypass auth
// so the page can install/render icons even when a server password is configured
// (auth_token in the page URL is not attached to subresource requests).
export const PUBLIC_UI_PATHS = new Set<string>([
  "/favicon.svg",
  "/favicon.ico",
  "/favicon-v3.svg",
  "/favicon-v3.ico",
  "/favicon-96x96.png",
  "/favicon-96x96-v3.png",
  "/apple-touch-icon.png",
  "/apple-touch-icon-v3.png",
  "/site.webmanifest",
  "/web-app-manifest-192x192.png",
  "/web-app-manifest-512x512.png",
])

const PUBLIC_UI_PREFIXES = [
  "/account",
  "/apps",
  "/auth",
  "/cases",
  "/code",
  "/data-management",
  "/datasets",
  "/dev",
  "/docs",
  "/frameworks",
  "/home",
  "/login",
  "/models",
  "/operators",
  "/primitives",
  "/register",
  "/skills",
  "/users",
  "/workspace",
]

export function isPublicUIPath(method: string, pathname: string) {
  return (
    method === "GET" &&
    (pathname === "/" ||
      PUBLIC_UI_PATHS.has(pathname) ||
      pathname === "/intelligent-submission" ||
      pathname === "/intelligent-submission/" ||
      pathname.startsWith("/intelligent-submission/assets/") ||
      pathname.startsWith("/assets/") ||
      PUBLIC_UI_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)))
  )
}
