import { authenticatedFetch } from "@/utils/authenticated-fetch"
import { storedPlatformAuthToken } from "@/utils/platform-auth"

export type ProjectUploadResult = {
  path: string
  status: "written" | "skipped"
}

function apiBaseUrl(serverUrl: string) {
  try {
    return new URL(serverUrl).toString().replace(/\/$/, "")
  } catch {
    return serverUrl.replace(/\/$/, "")
  }
}

function uploadHeaders(directory: string, workspaceID?: string, init?: HeadersInit) {
  const headers = new Headers(init)
  const platformToken = storedPlatformAuthToken()
  if (platformToken && !headers.has("x-platform-auth-token")) {
    headers.set("x-platform-auth-token", platformToken)
  }
  if (workspaceID && !headers.has("x-opencode-workspace")) {
    headers.set("x-opencode-workspace", workspaceID)
  }
  if (!headers.has("x-opencode-directory")) {
    headers.set("x-opencode-directory", encodeURIComponent(directory))
  }
  return headers
}

async function readApiError(response: Response, fallback: string) {
  const text = await response.text()
  if (!text) return fallback
  try {
    const json = JSON.parse(text) as { message?: string; error?: string; data?: { message?: string } }
    if (json.message) return json.message
    if (json.error) return json.error
    if (json.data?.message) return json.data.message
  } catch {}
  return text
}

export async function fetchProjectDiskSpace(serverUrl: string, directory: string, workspaceID?: string) {
  const query = new URLSearchParams({ directory })
  const response = await authenticatedFetch(`${apiBaseUrl(serverUrl)}/file/disk-space?${query}`, {
    headers: uploadHeaders(directory, workspaceID),
  })
  if (!response.ok) throw new Error(await readApiError(response, "Failed to read disk space"))
  const data = (await response.json()) as { availableBytes?: number; available_bytes?: number }
  const availableBytes = data.availableBytes ?? data.available_bytes
  return availableBytes !== undefined ? { availableBytes } : {}
}

export async function uploadProjectFile(
  serverUrl: string,
  directory: string,
  input: { path: string; file: Blob; overwrite: boolean; signal?: AbortSignal; workspaceID?: string },
) {
  const query = new URLSearchParams({ directory })
  const body = new FormData()
  body.set("path", input.path)
  body.set("overwrite", input.overwrite ? "true" : "false")
  body.set("file", input.file, input.path.split("/").pop() || "file")

  const response = await authenticatedFetch(`${apiBaseUrl(serverUrl)}/file/upload?${query}`, {
    method: "POST",
    headers: uploadHeaders(directory, input.workspaceID),
    body,
    signal: input.signal,
  })
  if (!response.ok) {
    throw new Error(await readApiError(response, "Upload failed"))
  }
  return (await response.json()) as ProjectUploadResult
}

export async function deleteProjectFile(
  serverUrl: string,
  directory: string,
  path: string,
  workspaceID?: string,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ directory, path })
  const response = await authenticatedFetch(`${apiBaseUrl(serverUrl)}/file/upload?${query}`, {
    method: "DELETE",
    headers: uploadHeaders(directory, workspaceID),
    signal,
  })
  if (response.status === 404) return { path, status: "missing" as const }
  if (!response.ok) {
    throw new Error(await readApiError(response, "Delete failed"))
  }
  return (await response.json()) as { path: string; status: "deleted" | "missing" }
}

export type LocalUploadEntry = {
  /** Relative path under the project directory (posix separators). */
  path: string
  file: File
  size: number
}

export function normalizeLocalRelativePath(input: string) {
  const parts = input
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part.length > 0 && part !== ".")
  if (parts.length === 0) return
  if (parts.some((part) => part === "..")) return
  return parts.join("/")
}

export const PREVIEW_UPLOAD_ENTRIES = 8
/** Hard cap to avoid freezing the browser on huge folder picks. */
export const MAX_UPLOAD_ENTRIES = 5_000

/** Browser upload limits for OneData → workspace (not conversation attachments). */
export const ONEDATA_UPLOAD_MAX_FILE_BYTES = 200 * 1024 * 1024
export const ONEDATA_UPLOAD_MAX_TOTAL_BYTES = 512 * 1024 * 1024

export type UploadSizeLimitError =
  | { kind: "file"; path: string; size: number; max: number }
  | { kind: "total"; size: number; max: number }

export function findUploadSizeLimitError(
  entries: readonly LocalUploadEntry[],
  limits: { maxFileBytes?: number; maxTotalBytes?: number },
): UploadSizeLimitError | undefined {
  if (limits.maxFileBytes !== undefined) {
    const oversized = entries.find((entry) => entry.size > limits.maxFileBytes!)
    if (oversized) {
      return { kind: "file", path: oversized.path, size: oversized.size, max: limits.maxFileBytes }
    }
  }
  if (limits.maxTotalBytes !== undefined) {
    const total = sumUploadBytes(entries)
    if (total > limits.maxTotalBytes) {
      return { kind: "total", size: total, max: limits.maxTotalBytes }
    }
  }
}

export function collectLocalUploadEntries(files: FileList | File[]) {
  const list = Array.from(files)
  const entries: LocalUploadEntry[] = []
  for (const file of list) {
    const relative =
      normalizeLocalRelativePath((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name) ||
      normalizeLocalRelativePath(file.name)
    if (!relative) continue
    entries.push({ path: relative, file, size: file.size })
    if (entries.length >= MAX_UPLOAD_ENTRIES) break
  }
  return {
    entries,
    truncated: list.length > entries.length,
    totalSelected: list.length,
  }
}

export function uploadRootLabel(entries: readonly LocalUploadEntry[]) {
  if (entries.length === 0) return
  const first = entries[0]!.path
  const slash = first.indexOf("/")
  if (slash <= 0) return
  const root = first.slice(0, slash)
  if (entries.every((entry) => entry.path === root || entry.path.startsWith(`${root}/`))) return root
}

export function sumUploadBytes(entries: readonly LocalUploadEntry[]) {
  return entries.reduce((total, entry) => total + entry.size, 0)
}

export function formatUploadBytes(bytes: number | undefined) {
  if (bytes === undefined) return "—"
  if (bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  const digits = value >= 100 || index === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${units[index]}`
}
