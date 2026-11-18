import { authenticatedFetch } from "@/utils/authenticated-fetch"
import { oneScienceApiBaseUrl } from "@/pages/onescience-catalog"

export type CatalogRaw = {
  id: string
  title: string
  description: string
  domain: string
  uri: string
  format: string
  connector: string
  workspace_id?: string
  time_created: number
  time_updated: number
}

export type CatalogAlready = {
  id: string
  title: string
  uri: string
  format: string
  status: string
  visibility: string
  build_method?: string
  connector?: string
  logical_bytes?: number
  record_count?: number
  entry_count?: number
  primitive_id?: string
  primitive_complete?: boolean
  time_updated: number
}

export function catalogErrorMessage(err: unknown, fallback: string) {
  if (!(err instanceof Error)) return fallback
  const raw = err.message.trim()
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw) as { message?: string; error?: string; _tag?: string }
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      const msg = parsed.message.trim()
      if (msg.includes("Chip must be an owned raw source")) {
        return "无法挂到会话：会话里绑定了已失效的原始数据（已删除或不可用）。请再试一次；若仍失败，先在会话输入框内移除旧的原始数据绑定。"
      }
      if (msg.includes("remote workspace") || msg.includes("object store") || msg.includes("onedata_ref")) {
        return "远端环境、对象存储或从公开 OneData 拉回的引用不能直接发布。请使用工作区路径或公开网址的可训练数据。"
      }
      return msg
    }
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim()
    if (parsed._tag === "NotFound") return "未找到该资源"
    if (parsed._tag === "Forbidden" || parsed._tag === "CatalogForbiddenError") {
      return "没有权限执行该操作。若是发布失败，请确认数据为工作区路径或公开网址，且状态为可训练。"
    }
  } catch {
    // body may already be plain text
  }
  if (raw.includes("remote workspace") || raw.includes("object store") || raw.includes("onedata_ref")) {
    return "远端环境、对象存储或从公开 OneData 拉回的引用不能直接发布。请使用工作区路径或公开网址的可训练数据。"
  }
  return raw
}

export function isCatalogNotFoundError(err: unknown) {
  if (!(err instanceof Error)) return false
  const raw = err.message.trim()
  if (!raw) return false
  if (/\b404\b/.test(raw)) return true
  try {
    const parsed = JSON.parse(raw) as { _tag?: string; status?: number }
    return parsed._tag === "NotFound" || parsed.status === 404
  } catch {
    return raw.includes("NotFound")
  }
}

async function catalogFetch<T>(serverUrl: string, path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(`${oneScienceApiBaseUrl(serverUrl)}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  })
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(body || `Request failed (${response.status})`)
  }
  return (await response.json()) as T
}

export function listRawSources(serverUrl: string, input?: { domain?: string }) {
  const query = new URLSearchParams()
  if (input?.domain && input.domain !== "all") query.set("domain", input.domain)
  return catalogFetch<{ items: CatalogRaw[] }>(serverUrl, `/experimental/onescience/raw-source?${query}`)
}

export function listAlreadyDatasets(serverUrl: string, input: { scope: "mine" | "public"; domain?: string }) {
  const query = new URLSearchParams({ scope: input.scope })
  if (input.domain && input.domain !== "all") query.set("domain", input.domain)
  return catalogFetch<{ items: CatalogAlready[] }>(serverUrl, `/experimental/onescience/already?${query}`)
}

export function registerRawSource(serverUrl: string, input: {
  title: string
  description?: string
  domain?: string
  uri: string
  connector: "local_fs" | "http_dataset" | "database" | "remote_workspace" | "onedata_ref"
  workspace_id?: string
}) {
  return catalogFetch<CatalogRaw>(serverUrl, "/experimental/onescience/raw-source", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export function convertRawSource(serverUrl: string, id: string) {
  return catalogFetch<CatalogAlready>(serverUrl, `/experimental/onescience/raw-source/${encodeURIComponent(id)}/convert`, {
    method: "POST",
  })
}

export function previewRawSource(serverUrl: string, id: string, viewerWorkspaceId?: string) {
  const query = new URLSearchParams()
  if (viewerWorkspaceId) query.set("viewer_workspace_id", viewerWorkspaceId)
  const suffix = query.size ? `?${query}` : ""
  return catalogFetch<{
    sample?: string
    sample_path?: string
    table_preview?: {
      columns: string[]
      rows: Array<Record<string, unknown>>
    }
    directory_listing?: {
      entries: Array<{ path: string; is_dir: boolean; size_bytes?: number }>
      truncated: boolean
      sample_path?: string
    }
    zarr_summary?: { arrays?: Array<{ path: string; shape: number[]; dtype: string; chunks: number[] }> }
    probe?: { logical_bytes?: number; format_hint?: string; entry_count?: number; is_dir?: boolean }
  }>(
    serverUrl,
    `/experimental/onescience/raw-source/${encodeURIComponent(id)}/preview${suffix}`,
  )
}

export function previewAlreadyDataset(serverUrl: string, id: string, viewerWorkspaceId?: string) {
  const query = new URLSearchParams()
  if (viewerWorkspaceId) query.set("viewer_workspace_id", viewerWorkspaceId)
  const suffix = query.size ? `?${query}` : ""
  return catalogFetch<{
    sample?: string
    sample_path?: string
    directory_listing?: {
      entries: Array<{ path: string; is_dir: boolean; size_bytes?: number }>
      truncated: boolean
      sample_path?: string
    }
    zarr_summary?: { arrays?: Array<{ path: string; shape: number[]; dtype: string; chunks: number[] }> }
  }>(
    serverUrl,
    `/experimental/onescience/already/${encodeURIComponent(id)}/preview${suffix}`,
  )
}

export function putSessionChips(serverUrl: string, sessionId: string, rawIds: string[]) {
  return catalogFetch<{ raw_ids: string[] }>(
    serverUrl,
    `/experimental/onescience/session/${encodeURIComponent(sessionId)}/chips`,
    { method: "PUT", body: JSON.stringify({ raw_ids: rawIds }) },
  )
}

export function getSessionChips(serverUrl: string, sessionId: string) {
  return catalogFetch<{ raw_ids: string[] }>(
    serverUrl,
    `/experimental/onescience/session/${encodeURIComponent(sessionId)}/chips`,
  )
}

export function publishAlreadyDataset(serverUrl: string, id: string) {
  return catalogFetch<CatalogAlready>(serverUrl, `/experimental/onescience/already/${encodeURIComponent(id)}/publish`, {
    method: "POST",
  })
}

export function unpublishAlreadyDataset(serverUrl: string, id: string) {
  return catalogFetch<CatalogAlready>(serverUrl, `/experimental/onescience/already/${encodeURIComponent(id)}/unpublish`, {
    method: "POST",
  })
}

export function reingestAlreadyDataset(serverUrl: string, id: string) {
  return catalogFetch<CatalogRaw>(serverUrl, `/experimental/onescience/already/${encodeURIComponent(id)}/reingest`, {
    method: "POST",
  })
}

export function startAlreadyTraining(serverUrl: string, id: string, input: {
  target: "local" | "workspace" | "shared_root"
  workspace_id?: string
}) {
  return catalogFetch<unknown>(serverUrl, `/experimental/onescience/already/${encodeURIComponent(id)}/training`, {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export function bindAlreadyPrimitive(serverUrl: string, id: string, input?: {
  title?: string
  description?: string
  data_schema?: string
  usage_notes?: string
}) {
  return catalogFetch<{ already_id: string; primitive_id: string; primitive_complete: boolean }>(
    serverUrl,
    `/experimental/onescience/already/${encodeURIComponent(id)}/primitive`,
    {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    },
  )
}

export function listSshWorkspaces(serverUrl: string) {
  return catalogFetch<Array<{ id: string; type: string; name: string }>>(serverUrl, "/experimental/workspace")
}

export type CatalogDbEngine = "postgres" | "mysql"

export type CatalogDbConnection = {
  id: string
  engine: CatalogDbEngine
  host: string
  port: number
  database: string
  username: string
  label?: string
  ssl_mode?: string
  time_created: number
  time_updated: number
}

export type CatalogDbTable = {
  schema: string
  name: string
  kind: "table" | "view"
}

export function listDbConnections(serverUrl: string) {
  return catalogFetch<{ items: CatalogDbConnection[]; configured?: boolean }>(
    serverUrl,
    "/experimental/onescience/db-connection",
  )
}

export function putDbConnection(serverUrl: string, input: {
  engine: CatalogDbEngine
  host: string
  port: number
  database: string
  username: string
  password: string
  label?: string
  ssl_mode?: string
  id?: string
}) {
  return catalogFetch<CatalogDbConnection>(serverUrl, "/experimental/onescience/db-connection", {
    method: "PUT",
    body: JSON.stringify(input),
  })
}

export function deleteDbConnection(serverUrl: string, id: string) {
  return catalogFetch<{ ok: boolean }>(serverUrl, `/experimental/onescience/db-connection/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

export function listDbTables(serverUrl: string, id: string) {
  return catalogFetch<{ items: CatalogDbTable[] }>(
    serverUrl,
    `/experimental/onescience/db-connection/${encodeURIComponent(id)}/tables`,
  )
}

export function deleteRawSource(serverUrl: string, id: string) {
  return catalogFetch<{ ok: boolean }>(serverUrl, `/experimental/onescience/raw-source/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

export function deleteAlreadyDataset(serverUrl: string, id: string) {
  return catalogFetch<{ ok: boolean }>(serverUrl, `/experimental/onescience/already/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}
