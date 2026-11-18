import { authTokenFromCredentials } from "@/utils/server"

const tickets = new Map<string, { ticket: string; expiresAt: number }>()

export function workspaceRelativePath(directory: string, filePath: string) {
  const root = directory.replace(/\\/g, "/").replace(/\/+$/, "")
  const target = filePath.replace(/\\/g, "/")
  if (target === root) return ""
  if (target.startsWith(`${root}/`)) return target.slice(root.length + 1)
  if (/^(?:[A-Za-z]:)?\//.test(target)) return target.replace(/^\/+/, "")
  return target.replace(/^\.\//, "")
}

export function encodePreviewPath(value: string) {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

async function issueTicket(input: {
  baseUrl: string
  directory: string
  headers?: HeadersInit
}) {
  const cached = tickets.get(input.directory)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.ticket

  const url = new URL("/file/preview/ticket", input.baseUrl)
  url.searchParams.set("directory", input.directory)
  const response = await fetch(url, {
    method: "POST",
    headers: input.headers,
  })
  if (!response.ok) throw new Error(`Failed to issue HTML preview ticket (${response.status})`)
  const body = (await response.json()) as { ticket?: string; expires_in?: number }
  if (!body.ticket) throw new Error("Preview ticket missing")
  const ttlMs = Math.max(60, Number(body.expires_in) || 3600) * 1000
  tickets.set(input.directory, { ticket: body.ticket, expiresAt: Date.now() + ttlMs })
  return body.ticket
}

export async function resolveHtmlPreviewUrl(input: {
  baseUrl: string
  directory: string
  filePath: string
  username?: string
  password?: string
}) {
  const relative = workspaceRelativePath(input.directory, input.filePath)
  if (!relative) return

  const headers: Record<string, string> = {
    "x-opencode-directory": input.directory,
  }
  if (input.password) {
    headers.Authorization = `Basic ${authTokenFromCredentials({
      username: input.username,
      password: input.password,
    })}`
  }

  const ticket = await issueTicket({
    baseUrl: input.baseUrl,
    directory: input.directory,
    headers,
  })
  return `${input.baseUrl.replace(/\/+$/, "")}/file/preview/${ticket}/${encodePreviewPath(relative)}`
}
