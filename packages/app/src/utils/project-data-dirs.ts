import type { useGlobalSDK } from "@/context/global-sdk"
import { authHeadersFromCachedToken } from "./authenticated-fetch"

export type ProjectDataDirectoryEntry = {
  name: string
  absolute: string
}

function normalizeProjectDataDirectories(body: unknown): ProjectDataDirectoryEntry[] {
  if (Array.isArray(body)) {
    return body.filter(
      (entry): entry is ProjectDataDirectoryEntry =>
        !!entry &&
        typeof entry === "object" &&
        typeof (entry as ProjectDataDirectoryEntry).name === "string" &&
        typeof (entry as ProjectDataDirectoryEntry).absolute === "string",
    )
  }
  if (body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)) {
    return normalizeProjectDataDirectories((body as { data: unknown }).data)
  }
  return []
}

export async function listProjectDataDirectories(
  sdk: Pick<ReturnType<typeof useGlobalSDK>, "url">,
  relativePath = "",
  init?: {
    fetch?: typeof fetch
    headers?: Record<string, string>
  },
): Promise<ProjectDataDirectoryEntry[]> {
  const url = new URL("/global/path/dirs", sdk.url)
  if (relativePath) url.searchParams.set("path", relativePath)
  const fetchImpl = init?.fetch ?? fetch
  const headers = {
    ...authHeadersFromCachedToken(),
    ...init?.headers,
  }
  const response = await fetchImpl(url, Object.keys(headers).length > 0 ? { headers } : undefined).catch(() => undefined)
  if (!response?.ok) return []
  return normalizeProjectDataDirectories(await response.json().catch(() => undefined))
}

export function relativeProjectDataPath(root: string, absolute: string) {
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "")
  const normalizedAbsolute = absolute.replace(/\\/g, "/").replace(/\/+$/, "")
  if (normalizedAbsolute === normalizedRoot) return ""
  if (!normalizedAbsolute.startsWith(`${normalizedRoot}/`)) return undefined
  return normalizedAbsolute.slice(normalizedRoot.length + 1)
}
