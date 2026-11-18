import { authenticatedFetch } from "@/utils/authenticated-fetch"
import type { SshTargetOption } from "@/components/onescience/execution-location"

export type ModelScopeDownloadEnvironment =
  | { kind: "local" }
  | { kind: "ssh"; targetName: string; remotePath?: string }

export type ModelScopeDownloadStartEnvironment =
  | { kind: "local"; condaEnv?: string }
  | { kind: "ssh"; targetName: string; remotePath: string; ssh: SshTargetOption; condaEnv?: string }

export type ModelScopeDownloadRecord = {
  resource_id: string
  kind: "dataset" | "model"
  status: "downloading" | "completed" | "failed" | "partial"
  started_at: number
  finished_at?: number
  error?: string
  environment?: ModelScopeDownloadEnvironment
  cache_paths?: string[]
  downloaded_bytes?: number
  total_bytes?: number
  progress_total_bytes?: number
  estimated_total_bytes?: number
  current_file?: string
  current_file_bytes?: number
  current_file_total_bytes?: number
}

export function downloadEnvKey(env: { kind: "local" | "ssh"; targetName?: string } | undefined) {
  return env?.kind === "ssh" ? `ssh:${env.targetName ?? ""}` : "local"
}

export function downloadRecordKey(
  env: { kind: "local" | "ssh"; targetName?: string } | undefined,
  resourceId: string,
) {
  return `${downloadEnvKey(env)}::${resourceId}`
}

export function downloadRecordKeyOf(record: ModelScopeDownloadRecord) {
  return downloadRecordKey(record.environment, record.resource_id)
}

/** Prefer an in-flight download (current env first) so a new local/SSH job is not hidden by another env's completed copy. */
export function selectDatasetProgressRecord(
  records: Record<string, ModelScopeDownloadRecord>,
  resourceId: string,
  env?: { kind: "local" | "ssh"; targetName?: string },
) {
  const own = env ? records[downloadRecordKey(env, resourceId)] : undefined
  if (own?.status === "downloading") return own
  for (const record of Object.values(records)) {
    if (record.resource_id === resourceId && record.status === "downloading") return record
  }
  return own
}

/** Newest ModelScope hub layout under `--cache_dir`. Older `{org}/{name}` copies are still deleted. */
export function datasetCacheLayoutRelPaths(resourceId: string): { legacy: string; hub: string } {
  const trimmed = resourceId.replace(/^\/+|\/+$/g, "")
  const [org, name] = trimmed.split("/")
  if (org && name) return { legacy: `${org}/${name}`, hub: `datasets/${org}--${name}` }
  return { legacy: trimmed, hub: trimmed }
}

export function datasetCacheDisplayRelPath(resourceId: string) {
  return datasetCacheLayoutRelPaths(resourceId).hub
}

/** Possible on-disk paths under a ModelScope cache_dir (legacy org/name vs hub layout). */
export function datasetCacheLocationPaths(base: string, resourceId: string): string[] {
  const root = base.replace(/\/+$/, "")
  const { legacy, hub } = datasetCacheLayoutRelPaths(resourceId)
  const left = root ? `${root}/${legacy}` : legacy
  if (legacy === hub) return [left]
  const right = root ? `${root}/${hub}` : hub
  return [left, right]
}

export function datasetCacheLocationLabel(base: string, resourceId: string) {
  return datasetCacheLocationPaths(base, resourceId).join(" 或 ")
}

export type DatasetDownloadCopy = {
  key: string
  label: string
  /** Joined paths for compact display / tests. */
  path: string
  paths: string[]
  /** True when paths are confirmed on disk (post-download). */
  confirmed: boolean
  environment: ModelScopeDownloadEnvironment
  partial: boolean
}

export function datasetDownloadCopyPaths(record: ModelScopeDownloadRecord, localBase?: string) {
  const resourceId = record.resource_id
  const env = record.environment
  const base =
    env?.kind === "ssh"
      ? (env.remotePath ?? "").replace(/\/+$/, "")
      : localBase
        ? `${localBase.replace(/\/+$/, "")}/modelscope/hub/datasets`
        : "modelscope/hub/datasets"
  const confirmed = Array.isArray(record.cache_paths) && record.cache_paths.length > 0
  if (confirmed) return { paths: [...new Set(record.cache_paths!)], confirmed: true as const }
  const candidates = datasetCacheLocationPaths(base, resourceId)
  // Completed downloads without a stored probe still prefer the current hub layout (single path).
  if (record.status === "completed" || record.status === "partial") {
    const hub = candidates.find((item) => /\/datasets\/[^/]+--/.test(item)) ?? candidates[candidates.length - 1]
    return { paths: hub ? [hub] : candidates, confirmed: false as const }
  }
  return { paths: candidates, confirmed: false as const }
}

export function datasetDownloadCopyOf(record: ModelScopeDownloadRecord, localBase?: string): DatasetDownloadCopy {
  const resourceId = record.resource_id
  const env = record.environment
  const { paths, confirmed } = datasetDownloadCopyPaths(record, localBase)
  if (env?.kind === "ssh") {
    return {
      key: downloadRecordKeyOf(record),
      label: `SSH: ${env.targetName}`,
      path: paths.join(" 或 "),
      paths,
      confirmed,
      environment: { kind: "ssh", targetName: env.targetName, ...(env.remotePath ? { remotePath: env.remotePath } : {}) },
      partial: record.status === "partial",
    }
  }
  return {
    key: downloadRecordKeyOf(record),
    label: "本地",
    path: paths.join(" 或 "),
    paths,
    confirmed,
    environment: { kind: "local" },
    partial: record.status === "partial",
  }
}

export function listDatasetDownloadCopies(
  records: Record<string, ModelScopeDownloadRecord>,
  resourceId: string,
  localBase?: string,
) {
  const copies = Object.values(records).flatMap((record) => {
    if (record.resource_id !== resourceId) return []
    if (record.status !== "completed" && record.status !== "partial") return []
    return [datasetDownloadCopyOf(record, localBase)]
  })
  copies.sort((a, b) => {
    if (a.environment.kind !== b.environment.kind) return a.environment.kind === "local" ? -1 : 1
    return a.label.localeCompare(b.label)
  })
  return copies
}

export function datasetCopyStatusForEnv(
  copies: readonly DatasetDownloadCopy[],
  env: { kind: "local" | "ssh" | "scnet"; targetName?: string },
): "completed" | "partial" | undefined {
  const copy = copies.find((item) => {
    if (env.kind === "local") return item.environment.kind === "local"
    if (env.kind === "ssh") return item.environment.kind === "ssh" && item.environment.targetName === env.targetName
    return false
  })
  if (!copy) return undefined
  return copy.partial ? "partial" : "completed"
}

function oneScienceApiBaseUrl(serverUrl: string) {
  try {
    return new URL(serverUrl).toString().replace(/\/$/, "")
  } catch {
    return serverUrl.replace(/\/$/, "")
  }
}

function modelScopeDownloadUrl(serverUrl: string, directory: string, suffix = "") {
  const query = new URLSearchParams({ directory })
  return `${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/modelscope/download${suffix}?${query}`
}

function readString(record: Record<string, unknown>, snake: string, camel: string) {
  const value = record[snake] ?? record[camel]
  return typeof value === "string" ? value : undefined
}

function readNumber(record: Record<string, unknown>, snake: string, camel: string) {
  const value = record[snake] ?? record[camel]
  return typeof value === "number" ? value : undefined
}

export function normalizeDownloadRecord(raw: unknown): ModelScopeDownloadRecord | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const record = raw as Record<string, unknown>
  const resource_id = readString(record, "resource_id", "resourceId")
  if (!resource_id) return undefined
  const status = record.status
  if (status !== "downloading" && status !== "completed" && status !== "failed" && status !== "partial") return undefined
  const started_at = readNumber(record, "started_at", "startedAt")
  if (started_at === undefined) return undefined
  const kind = record.kind
  if (kind !== "dataset" && kind !== "model") return undefined
  const finished_at = readNumber(record, "finished_at", "finishedAt")
  const downloaded_bytes = readNumber(record, "downloaded_bytes", "downloadedBytes")
  const total_bytes = readNumber(record, "total_bytes", "totalBytes")
  const progress_total_bytes = readNumber(record, "progress_total_bytes", "progressTotalBytes")
  const estimated_total_bytes = readNumber(record, "estimated_total_bytes", "estimatedTotalBytes")
  const current_file = readString(record, "current_file", "currentFile")
  const current_file_bytes = readNumber(record, "current_file_bytes", "currentFileBytes")
  const current_file_total_bytes = readNumber(record, "current_file_total_bytes", "currentFileTotalBytes")
  const error = readString(record, "error", "error")
  const environment = normalizeDownloadEnvironment(record.environment)
  const cacheRaw = record.cache_paths ?? record.cachePaths
  const cache_paths = Array.isArray(cacheRaw)
    ? [...new Set(cacheRaw.filter((item): item is string => typeof item === "string" && item.trim().length > 0))]
    : undefined
  return {
    resource_id,
    kind,
    status,
    started_at,
    ...(environment ? { environment } : {}),
    ...(finished_at !== undefined ? { finished_at } : {}),
    ...(downloaded_bytes !== undefined ? { downloaded_bytes } : {}),
    ...(total_bytes !== undefined ? { total_bytes } : {}),
    ...(progress_total_bytes !== undefined ? { progress_total_bytes } : {}),
    ...(estimated_total_bytes !== undefined ? { estimated_total_bytes } : {}),
    ...(current_file ? { current_file } : {}),
    ...(current_file_bytes !== undefined ? { current_file_bytes } : {}),
    ...(current_file_total_bytes !== undefined ? { current_file_total_bytes } : {}),
    ...(cache_paths && cache_paths.length > 0 ? { cache_paths } : {}),
    ...(error ? { error } : {}),
  }
}

export function formatDownloadBytes(bytes: number | undefined) {
  if (bytes === undefined || bytes <= 0) return "0 B"
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

const DATASET_DIALOG_GB = 1024 ** 3
const DATASET_DIALOG_MB = 1024 ** 2

export function formatDatasetDialogSize(bytes: number | undefined) {
  if (bytes === undefined || bytes <= 0) return "未知"
  if (bytes >= DATASET_DIALOG_GB) {
    const value = bytes / DATASET_DIALOG_GB
    return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} GB`
  }
  const value = bytes / DATASET_DIALOG_MB
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} MB`
}

export type ModelScopeDownloadPreflight = {
  resourceId: string
  availableBytes?: number
  datasetBytes?: number
}

function normalizeDownloadPreflight(raw: unknown): ModelScopeDownloadPreflight | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const record = raw as Record<string, unknown>
  const resourceId = readString(record, "resource_id", "resourceId")
  if (!resourceId) return undefined
  const availableBytes = readNumber(record, "available_bytes", "availableBytes")
  const datasetBytes = readNumber(record, "dataset_bytes", "datasetBytes")
  return {
    resourceId,
    ...(availableBytes !== undefined ? { availableBytes } : {}),
    ...(datasetBytes !== undefined ? { datasetBytes } : {}),
  }
}

function normalizeDownloadEnvironment(raw: unknown): ModelScopeDownloadEnvironment | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const record = raw as Record<string, unknown>
  if (record.kind === "ssh") {
    const targetName = readString(record, "target_name", "targetName")
    if (!targetName) return undefined
    const remotePath = readString(record, "remote_path", "remotePath")
    return { kind: "ssh", targetName, ...(remotePath ? { remotePath } : {}) }
  }
  if (record.kind === "local") return { kind: "local" }
  return undefined
}

function normalizeDownloadRecords(raw: unknown) {
  if (!Array.isArray(raw)) return [] as ModelScopeDownloadRecord[]
  return raw.flatMap((item) => {
    const record = normalizeDownloadRecord(item)
    return record ? [record] : []
  })
}

/** The server resolves SSH connection details from its own config by targetName — never send keyPath/host over the wire. */
function sanitizeStartEnvironment(environment: ModelScopeDownloadStartEnvironment | undefined) {
  if (!environment) return environment
  const condaEnv = environment.condaEnv?.trim()
  if (environment.kind === "local") {
    return { kind: "local" as const, ...(condaEnv ? { condaEnv } : {}) }
  }
  return {
    kind: "ssh" as const,
    targetName: environment.targetName,
    remotePath: environment.remotePath,
    ...(condaEnv ? { condaEnv } : {}),
  }
}

export async function fetchModelScopeDownloadDiskSpace(
  serverUrl: string,
  directory: string,
  environment?: ModelScopeDownloadStartEnvironment,
) {
  const query = new URLSearchParams({ directory })
  const sanitized = sanitizeStartEnvironment(environment)
  if (sanitized) query.set("environment", JSON.stringify(sanitized))
  const response = await authenticatedFetch(
    `${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/modelscope/download/disk-space?${query}`,
  )
  if (!response.ok) throw new Error("读取磁盘空间失败")
  const data = (await response.json()) as { availableBytes?: number; available_bytes?: number }
  const availableBytes = data.availableBytes ?? data.available_bytes
  return availableBytes !== undefined ? { availableBytes } : {}
}

export type RemoteCondaEnv = {
  name: string
  path: string
  active?: boolean
}

export function localizeCondaListError(message: string) {
  const local = /local host/i.test(message)
  if (message.includes("conda CLI not found")) {
    return local
      ? "本机未检测到 conda。可留空，将使用当前环境中的 modelscope。"
      : "远端未检测到 conda。可留空，将使用远端默认环境中的 modelscope。"
  }
  if (message.includes("no conda environments found")) {
    return local ? "本机没有列出 conda 环境。可手动填写，或留空。" : "远端没有列出 conda 环境。可手动填写，或留空。"
  }
  if (message.includes("failed to list conda") || message.includes("ssh exited") || /Permission denied|Connection timed out|Could not resolve/i.test(message)) {
    const detail = message
      .replace(/^failed to list conda environments on the (?:remote SSH|local) host:?\s*/i, "")
      .trim()
    if (detail && detail !== message) return `查询 conda 环境失败：${detail}`
    return local ? "查询 conda 环境失败。请确认本机已安装 conda 后重试。" : "查询 conda 环境失败。请确认该 SSH 目标可连接后重试。"
  }
  return message.trim() || "查询 conda 环境失败。"
}

export function isCondaOptionalMessage(message: string) {
  return (
    message.includes("未检测到 conda") ||
    message.includes("未安装 conda") ||
    message.includes("conda CLI not found") ||
    message.includes("没有列出 conda")
  )
}

export async function fetchCondaEnvs(
  serverUrl: string,
  directory: string,
  environment: { kind: "local" } | { kind: "ssh"; targetName: string },
) {
  const query = new URLSearchParams({
    directory,
    environment: JSON.stringify(environment),
  })
  const response = await authenticatedFetch(
    `${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/modelscope/download/conda-envs?${query}`,
  )
  if (!response.ok) {
    throw new Error(localizeCondaListError(await readDownloadApiError(response, "查询 conda 环境失败")))
  }
  const data = (await response.json()) as { items?: unknown; available?: unknown }
  const items = Array.isArray(data.items)
    ? data.items.flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const record = item as Record<string, unknown>
        const name = typeof record.name === "string" ? record.name.trim() : ""
        const path = typeof record.path === "string" ? record.path.trim() : ""
        if (!name || !path) return []
        return [{ name, path, ...(record.active === true ? { active: true as const } : {}) }]
      })
    : []
  const available = typeof data.available === "boolean" ? data.available : items.length > 0
  return { items: items as RemoteCondaEnv[], available }
}

export async function fetchRemoteCondaEnvs(serverUrl: string, directory: string, targetName: string) {
  return fetchCondaEnvs(serverUrl, directory, { kind: "ssh", targetName })
}

export async function fetchModelScopeDownloadPreflight(serverUrl: string, directory: string, resourceId: string) {
  const query = new URLSearchParams({ directory, resourceId })
  const response = await authenticatedFetch(
    `${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/modelscope/download/info?${query}`,
  )
  if (!response.ok) throw new Error("读取下载信息失败")
  const preflight = normalizeDownloadPreflight(await response.json())
  if (!preflight) throw new Error("读取下载信息失败")
  return preflight
}

export async function listModelScopeDownloads(serverUrl: string, directory: string) {
  const response = await authenticatedFetch(modelScopeDownloadUrl(serverUrl, directory))
  if (!response.ok) throw new Error("读取下载状态失败")
  const data = (await response.json()) as { items?: unknown[] }
  return normalizeDownloadRecords(data.items)
}

async function readDownloadApiError(response: Response, fallback: string) {
  const text = await response.text()
  if (!text) return fallback
  try {
    const json = JSON.parse(text) as { message?: string; error?: string; data?: { message?: string } }
    const message = json.message ?? json.data?.message ?? json.error
    if (typeof message === "string" && message.trim()) return message.trim()
  } catch {}
  return fallback
}

export function localizeModelScopeDownloadError(message: string) {
  if (message.includes("modelscope CLI not found in conda environment")) {
    return "指定的 conda 环境中未找到 modelscope。请确认环境名，或先在该环境中安装。"
  }
  if (
    message.includes("modelscope CLI not found") ||
    /Executable not found in \$PATH: ["']?modelscope/i.test(message) ||
    /modelscope.*(ENOENT|not found)/i.test(message)
  ) {
    return "所选环境找不到 modelscope 命令。请先在该环境安装后再试。"
  }
  if (message.includes("remote download failed to start")) {
    return "下载未能启动。请检查连接、目录权限，以及所选环境是否已安装并可执行 modelscope。"
  }
  if (message.includes("remote storage directory is empty")) {
    return "请填写远端存储目录。"
  }
  if (message === "启动下载失败") return message
  return `启动下载失败：${message}`
}

export async function startModelScopeDatasetDownload(
  serverUrl: string,
  directory: string,
  resourceId: string,
  environment?: ModelScopeDownloadStartEnvironment,
) {
  const response = await authenticatedFetch(modelScopeDownloadUrl(serverUrl, directory), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ directory, resourceId, ...(environment ? { environment: sanitizeStartEnvironment(environment) } : {}) }),
  })
  if (!response.ok) throw new Error(localizeModelScopeDownloadError(await readDownloadApiError(response, "启动下载失败")))
  const record = normalizeDownloadRecord(await response.json())
  if (!record) throw new Error("启动下载失败")
  return record
}

export async function cancelModelScopeDatasetDownload(
  serverUrl: string,
  directory: string,
  resourceId: string,
  environment?: ModelScopeDownloadEnvironment,
) {
  const response = await authenticatedFetch(modelScopeDownloadUrl(serverUrl, directory, "/cancel"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ directory, resourceId, ...(environment ? { environment } : {}) }),
  })
  if (!response.ok) throw new Error("取消下载失败")
  const record = normalizeDownloadRecord(await response.json())
  if (!record) throw new Error("取消下载失败")
  return record
}

export async function deleteModelScopeDatasetDownload(
  serverUrl: string,
  directory: string,
  resourceId: string,
  environment?: ModelScopeDownloadEnvironment,
) {
  const query = new URLSearchParams({ directory, resourceId })
  if (environment) query.set("environment", JSON.stringify(environment))
  const response = await authenticatedFetch(
    `${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/modelscope/download?${query}`,
    { method: "DELETE" },
  )
  if (!response.ok) throw new Error("删除数据集失败")
}

export function modelScopeDownloadStatus(
  records: Record<string, ModelScopeDownloadRecord>,
  resourceId: string | undefined,
  environment?: { kind: "local" | "ssh"; targetName?: string },
) {
  if (!resourceId) return undefined
  return records[downloadRecordKey(environment, resourceId)]?.status
}
