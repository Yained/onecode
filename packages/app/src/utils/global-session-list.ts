import type { Session } from "@opencode-ai/sdk/v2/client"
import { authenticatedFetch } from "@/utils/authenticated-fetch"
import { authTokenFromCredentials } from "@/utils/server"

export type GlobalSessionListQuery = {
  directory: string
  roots: true
  limit?: number
  archived?: boolean
}

/** List sessions from /global/session — does not bootstrap workspace instances. */
export async function listGlobalSessions(
  input: {
    baseUrl: string
    query: GlobalSessionListQuery
    username?: string
    password?: string
    fetch?: (input: string | URL, init?: RequestInit) => Promise<Response>
  },
): Promise<{ data?: Session[] }> {
  const url = new URL("/global/session", input.baseUrl)
  url.searchParams.set("directory", input.query.directory)
  url.searchParams.set("roots", "true")
  if (input.query.limit != null) url.searchParams.set("limit", String(input.query.limit))
  if (input.query.archived != null) url.searchParams.set("archived", input.query.archived ? "true" : "false")

  const headers: Record<string, string> = {}
  if (input.password) {
    headers.Authorization = `Basic ${authTokenFromCredentials({
      username: input.username,
      password: input.password,
    })}`
  }

  // Prefer authenticatedFetch so web `--token` / localStorage auth is applied even when
  // server.current.http.password is missing (projects can still render from local cache).
  const response = await (input.fetch ?? authenticatedFetch)(url, { headers })
  if (!response.ok) throw new Error(`global session list failed: ${response.status}`)
  const data = (await response.json()) as Session[]
  return { data: Array.isArray(data) ? data : [] }
}
