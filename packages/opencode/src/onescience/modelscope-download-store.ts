import path from "node:path"
import type { ModelScopeCliProgressTracker } from "./modelscope-download-progress"

export type ModelScopeDownloadStatus = "downloading" | "completed" | "failed" | "partial"

export type ModelScopeDownloadSshConfig = {
  host: string
  hostName?: string
  port?: number
  username?: string
  options?: Record<string, string>
  auth?: {
    type?: "config" | "agent" | "key" | "password"
    keyPath?: string
    password?: string
  }
}

/** Persisted with the record so interrupted SSH downloads can be reconciled after a server restart. */
export type ModelScopeDownloadEnvironment =
  | { kind: "local" }
  | {
      kind: "ssh"
      target_name: string
      /** Remote modelscope --cache_dir root. */
      remote_path: string
      log_file: string
      status_file: string
      ssh: ModelScopeDownloadSshConfig
    }

export type ModelScopeDownloadStartEnvironment =
  | { kind: "local"; condaEnv?: string }
  | {
      kind: "ssh"
      targetName: string
      remotePath: string
      ssh: ModelScopeDownloadSshConfig
      condaEnv?: string
    }

export type ModelScopeDownloadRecord = {
  resource_id: string
  kind: "dataset" | "model"
  status: ModelScopeDownloadStatus
  started_at: number
  finished_at?: number
  error?: string
  pid?: number
  environment?: ModelScopeDownloadEnvironment
  /** Absolute paths that currently hold dataset files (legacy and/or hub layout). */
  cache_paths?: string[]
  downloaded_bytes?: number
  total_bytes?: number
  progress_total_bytes?: number
  estimated_total_bytes?: number
  current_file?: string
  current_file_bytes?: number
  current_file_total_bytes?: number
}

export type DownloadStore = Record<string, ModelScopeDownloadRecord>

export const modelScopeDatasetsCacheDir = "modelscope/hub/datasets"

/**
 * Relative cache locations for a dataset under modelscope `--cache_dir`.
 * Delete/has-files must cover both old CLI (`{org}/{name}`) and new hub (`datasets/{org}--{name}`).
 */
export function datasetCacheLayoutRelPaths(resourceId: string): { legacy: string; hub: string } {
  const trimmed = resourceId.replace(/^\/+|\/+$/g, "")
  const [org, name] = trimmed.split("/")
  if (org && name) return { legacy: `${org}/${name}`, hub: `datasets/${org}--${name}` }
  return { legacy: trimmed, hub: trimmed }
}

export function datasetCacheRelPaths(resourceId: string): string[] {
  const trimmed = resourceId.replace(/^\/+|\/+$/g, "")
  if (!trimmed) return []
  const [org, name] = trimmed.split("/")
  const { legacy, hub } = datasetCacheLayoutRelPaths(trimmed)
  const paths = [legacy, hub]
  if (org && name) {
    paths.push(`${org}--${name}`)
    paths.push(`datasets/${org}/${name}`)
    paths.push(`._____temp/${trimmed}`)
    paths.push(`._____temp/${org}/${name}`)
  }
  return [...new Set(paths)]
}

export function datasetCacheDisplayRelPath(resourceId: string) {
  return datasetCacheLayoutRelPaths(resourceId).hub
}

export function resolveDirectory(directory: string) {
  return path.resolve(directory)
}

export function storePath(directory: string) {
  return path.join(resolveDirectory(directory), ".onescience", "modelscope-downloads.json")
}

export function downloadEnvKeyOf(env: { kind: "local" | "ssh"; target_name?: string } | undefined) {
  if (env?.kind === "ssh") return `ssh:${env.target_name ?? ""}`
  return "local"
}

export function downloadStoreKey(
  env: { kind: "local" | "ssh"; target_name?: string } | undefined,
  resourceId: string,
) {
  return `${downloadEnvKeyOf(env)}::${resourceId}`
}

export function environmentOfRecord(record: ModelScopeDownloadRecord): ModelScopeDownloadEnvironment {
  return record.environment ?? { kind: "local" }
}

export async function readStore(directory: string): Promise<DownloadStore> {
  const file = Bun.file(storePath(directory))
  if (!(await file.exists())) return {} as DownloadStore
  const store = (await file.json()) as DownloadStore
  return migrateStore(directory, store)
}

/** Legacy records were keyed by bare resourceId and always meant the local environment. */
async function migrateStore(directory: string, store: DownloadStore): Promise<DownloadStore> {
  let changed = false
  const next: DownloadStore = {}
  for (const [key, record] of Object.entries(store)) {
    if (key.includes("::")) {
      next[key] = record
      continue
    }
    const environment = environmentOfRecord(record)
    if (!record.environment) {
      record.environment = environment
      changed = true
    }
    next[downloadStoreKey(environment, record.resource_id)] = record
    changed = true
  }
  if (changed) await writeStore(directory, next)
  return next
}

export async function writeStore(directory: string, store: DownloadStore) {
  const target = storePath(directory)
  await Bun.write(target, JSON.stringify(store, null, 2), { createPath: true })
}

export function shouldPersistDownloadRecord(record: ModelScopeDownloadRecord) {
  const org = record.resource_id.split("/")[0]
  if (!org || org.startsWith(".")) return false
  return record.status === "downloading" || record.status === "completed" || record.status === "partial"
}

export function completedRecord(
  record: ModelScopeDownloadRecord,
  finished_at = Date.now(),
  cache_paths?: string[],
): ModelScopeDownloadRecord {
  const paths = cache_paths?.map((item) => item.trim()).filter(Boolean)
  return {
    ...record,
    status: "completed",
    finished_at,
    error: undefined,
    pid: undefined,
    ...(paths && paths.length > 0 ? { cache_paths: [...new Set(paths)] } : {}),
  }
}

export function partialRecord(record: ModelScopeDownloadRecord, resourceId: string): ModelScopeDownloadRecord {
  return {
    resource_id: resourceId,
    kind: record.kind,
    status: "partial",
    started_at: record.started_at,
    ...(record.environment ? { environment: record.environment } : {}),
    ...(record.finished_at !== undefined ? { finished_at: record.finished_at } : {}),
    ...(record.error ? { error: record.error } : {}),
  }
}

export async function persistCliProgressToStore(
  directory: string,
  key: string,
  tracker: ModelScopeCliProgressTracker,
  force = false,
) {
  const snapshot = tracker.snapshot()
  if (!force && snapshot.last_line_at === 0) return

  const store = await readStore(directory)
  const current = store[key]
  if (!current || current.status !== "downloading") return

  const progress_total_bytes = tracker.progressTotalBytes()

  const next: ModelScopeDownloadRecord = {
    ...current,
    downloaded_bytes: snapshot.downloaded_bytes,
  }
  if (progress_total_bytes) next.progress_total_bytes = progress_total_bytes
  else delete next.progress_total_bytes
  if (snapshot.current_file) next.current_file = snapshot.current_file
  else delete next.current_file
  if (snapshot.current_file_bytes !== undefined) next.current_file_bytes = snapshot.current_file_bytes
  else delete next.current_file_bytes
  if (snapshot.current_file_total_bytes !== undefined) next.current_file_total_bytes = snapshot.current_file_total_bytes
  else delete next.current_file_total_bytes

  if (
    !force &&
    current.downloaded_bytes === next.downloaded_bytes &&
    current.progress_total_bytes === next.progress_total_bytes &&
    current.current_file === next.current_file &&
    current.current_file_bytes === next.current_file_bytes &&
    current.current_file_total_bytes === next.current_file_total_bytes
  ) {
    return
  }

  store[key] = next
  await writeStore(directory, store)
}
