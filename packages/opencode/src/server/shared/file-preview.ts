const TICKET_PATH = /^\/file\/preview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/(.*))?$/i

export const FILE_PREVIEW_CSP =
  "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' data:; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"

export function hasFilePreviewTicketPath(method: string, pathname: string) {
  if (method !== "GET" && method !== "HEAD") return false
  return TICKET_PATH.test(pathname)
}

export function parseFilePreviewPath(pathname: string) {
  const match = TICKET_PATH.exec(pathname)
  if (!match) return
  return {
    ticket: match[1],
    filePath: decodePreviewPath(match[2] ?? ""),
  }
}

export function decodePreviewPath(value: string) {
  if (!value) return ""
  return value
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })
    .filter((segment) => segment !== "" && segment !== "." && segment !== "..")
    .join("/")
}

export function encodePreviewPath(value: string) {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}
