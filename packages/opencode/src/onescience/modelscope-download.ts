import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Process } from "@/util/process"
import { getAvailableDiskBytes } from "./disk-space"
import { ModelScopeCliProgressTracker } from "./modelscope-download-progress"
import {
  cancelSshDatasetDownload,
  deleteSshDatasetDownload,
  ensureSshDownloadWatcher,
  getSshRemoteDiskBytes,
  listLocalCondaEnvs,
  listSshCondaEnvs,
  remoteCondaPrefix,
  startSshDatasetDownload,
} from "./modelscope-download-ssh"
import {
  completedRecord,
  datasetCacheLayoutRelPaths,
  datasetCacheRelPaths,
  downloadStoreKey,
  environmentOfRecord,
  modelScopeDatasetsCacheDir,
  partialRecord,
  persistCliProgressToStore,
  readStore,
  resolveDirectory,
  shouldPersistDownloadRecord,
  writeStore,
  type DownloadStore,
  type ModelScopeDownloadRecord,
  type ModelScopeDownloadSshConfig,
  type ModelScopeDownloadStartEnvironment,
  type ModelScopeDownloadStatus,
} from "./modelscope-download-store"

export type {
  ModelScopeDownloadEnvironment,
  ModelScopeDownloadRecord,
  ModelScopeDownloadSshConfig,
  ModelScopeDownloadStartEnvironment,
  ModelScopeDownloadStatus,
} from "./modelscope-download-store"
export { downloadEnvKeyOf, downloadStoreKey, environmentOfRecord } from "./modelscope-download-store"

export const MODELSCOPE_DOWNLOAD_PROGRESS_WRITE_INTERVAL_MS = 1_000
export const MODELSCOPE_DOWNLOAD_WATCH_INTERVAL_MS = 2_000
export const MODELSCOPE_DATASET_SIZE_PREFLIGHT_TIMEOUT_MS = 5_000
export const MODELSCOPE_DATASET_SIZE_CACHE_MS = 60 * 60 * 1000

const datasetSizeCache = new Map<string, { bytes: number; at: number }>()

const active = new Map<string, ReturnType<typeof Bun.spawn>>()
const progressTrackers = new Map<string, ModelScopeCliProgressTracker>()

function jobKey(directory: string, key: string) {
  return `${resolveDirectory(directory)}\0${key}`
}

function datasetCacheTargets(directory: string, resourceId: string) {
  const root = path.join(resolveDirectory(directory), modelScopeDatasetsCacheDir)
  return datasetCacheRelPaths(resourceId).map((rel) => path.join(root, rel))
}

/** Absolute local paths that currently hold files for the two primary layouts. */
export async function localExistingCachePaths(directory: string, resourceId: string) {
  const root = path.join(resolveDirectory(directory), modelScopeDatasetsCacheDir)
  const { legacy, hub } = datasetCacheLayoutRelPaths(resourceId)
  const targets = [...new Set([path.join(root, legacy), ...(legacy === hub ? [] : [path.join(root, hub)])])]
  const found: string[] = []
  for (const target of targets) {
    const entries = await fs.readdir(target).catch(() => [] as string[])
    if (entries.length > 0) found.push(target)
  }
  return found
}

async function datasetHasFiles(directory: string, resourceId: string) {
  return (await localExistingCachePaths(directory, resourceId)).length > 0
}

function processRunning(pid: number | undefined) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function downloadStillLive(key: string, pid: number | undefined) {
  const proc = active.get(key)
  if (proc) {
    if (proc.exitCode !== null) {
      active.delete(key)
      return false
    }
    if (!processRunning(pid)) {
      active.delete(key)
      return false
    }
    return true
  }
  return processRunning(pid)
}

function readCachedDatasetStorageSize(resourceId: string) {
  const cached = datasetSizeCache.get(resourceId)
  if (!cached || Date.now() - cached.at > MODELSCOPE_DATASET_SIZE_CACHE_MS) return undefined
  return cached.bytes
}

function writeCachedDatasetStorageSize(resourceId: string, bytes: number) {
  datasetSizeCache.set(resourceId, { bytes, at: Date.now() })
}

export async function fetchModelScopeDatasetStorageSize(
  resourceId: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 15_000,
): Promise<number | undefined> {
  if (!resourceId.includes("/")) return undefined
  const cached = readCachedDatasetStorageSize(resourceId)
  if (cached !== undefined) return cached
  const url = `https://www.modelscope.cn/api/v1/datasets/${resourceId}`
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) }).catch(() => undefined)
  if (!response?.ok) return undefined
  const payload = (await response.json().catch(() => undefined)) as
    | {
        Data?: {
          StorageSize?: number
          storageSize?: number
          Size?: number
          size?: number
        }
      }
    | undefined
  const data = payload?.Data
  if (!data) return undefined
  for (const value of [data.StorageSize, data.storageSize, data.Size, data.size]) {
    if (typeof value === "number" && value > 0) {
      writeCachedDatasetStorageSize(resourceId, value)
      return value
    }
  }
  return undefined
}

export async function getModelScopeDownloadDiskSpace(
  directory: string,
  environment?: ModelScopeDownloadStartEnvironment,
) {
  if (environment?.kind === "ssh") {
    const remotePath = environment.remotePath.trim().replace(/\/+$/, "")
    if (!remotePath) return {}
    const availableBytes = await getSshRemoteDiskBytes(environment.ssh, remotePath).catch(() => undefined)
    return {
      ...(availableBytes !== undefined ? { availableBytes } : {}),
    }
  }
  const availableBytes = await getAvailableDiskBytes(directory).catch(() => undefined)
  return {
    ...(availableBytes !== undefined ? { availableBytes } : {}),
  }
}

export async function listModelScopeCondaEnvs(ssh?: ModelScopeDownloadSshConfig) {
  if (!ssh) return listLocalCondaEnvs()
  return listSshCondaEnvs(ssh)
}

function modelScopeDownloadEnv() {
  return {
    ...process.env,
    PYTHONUNBUFFERED: "1",
    TERM: "xterm-256color",
    COLUMNS: "120",
    LINES: "30",
  }
}

function localModelscopeSearchPath() {
  const extra = [path.join(os.homedir(), ".local", "bin"), path.join(os.homedir(), "bin")]
  return [...extra, process.env.PATH ?? ""].join(path.delimiter)
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function resolveLocalModelscopeBin() {
  const found = Bun.which("modelscope")
  if (found) return found
  const names = process.platform === "win32" ? ["modelscope.exe", "modelscope.cmd", "modelscope"] : ["modelscope"]
  for (const dir of [path.join(os.homedir(), ".local", "bin"), path.join(os.homedir(), "bin")]) {
    for (const name of names) {
      const candidate = path.join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

/** Local download command. Activates conda only when the user named an env. */
export function localModelscopeDownloadCommand(resourceId: string, condaEnv?: string) {
  const setup = remoteCondaPrefix(condaEnv)
  return `${setup}modelscope download --dataset ${shellQuote(resourceId)} --cache_dir ${shellQuote(modelScopeDatasetsCacheDir)}`
}

async function ensureLocalModelscope(condaEnv?: string) {
  const name = condaEnv?.trim()
  if (!name) {
    if (!resolveLocalModelscopeBin()) throw new Error("modelscope CLI not found")
    return
  }
  const result = await Process.run(["bash", "-lc", `${remoteCondaPrefix(name)}command -v modelscope`], {
    nothrow: true,
    timeout: 5_000,
    abort: AbortSignal.timeout(15_000),
  }).catch(() => undefined)
  if (!result?.stdout.toString().trim()) {
    throw new Error(`modelscope CLI not found in conda environment ${name}`)
  }
}

async function spawnModelScopeDownload(cwd: string, resourceId: string, condaEnv?: string) {
  const name = condaEnv?.trim() || undefined
  await ensureLocalModelscope(name)
  if (!name) {
    const bin = resolveLocalModelscopeBin()
    if (!bin) throw new Error("modelscope CLI not found")
    return Bun.spawn([bin, "download", "--dataset", resourceId, "--cache_dir", modelScopeDatasetsCacheDir], {
      cwd,
      env: {
        ...modelScopeDownloadEnv(),
        PATH: localModelscopeSearchPath(),
      },
      stdout: "pipe",
      stderr: "pipe",
    })
  }
  return Bun.spawn(["bash", "-lc", localModelscopeDownloadCommand(resourceId, name)], {
    cwd,
    env: modelScopeDownloadEnv(),
    stdout: "pipe",
    stderr: "pipe",
  })
}

async function pipeDownloadOutput(
  stream: ReadableStream<Uint8Array> | null | undefined,
  tracker: ModelScopeCliProgressTracker,
  onUpdate: () => void,
) {
  if (!stream) return
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      tracker.feed(decoder.decode(value, { stream: true }))
      onUpdate()
    }
  } finally {
    tracker.feed(decoder.decode())
    tracker.flush()
    onUpdate()
    reader.releaseLock()
  }
}

function attachModelScopeDownloadProgress(
  id: string,
  directory: string,
  key: string,
  proc: ReturnType<typeof Bun.spawn>,
) {
  const tracker = new ModelScopeCliProgressTracker()
  progressTrackers.set(id, tracker)

  let pendingWrite: ReturnType<typeof setTimeout> | undefined
  const scheduleWrite = () => {
    if (pendingWrite) return
    pendingWrite = setTimeout(() => {
      pendingWrite = undefined
      void persistCliProgressToStore(directory, key, tracker)
    }, MODELSCOPE_DOWNLOAD_PROGRESS_WRITE_INTERVAL_MS)
  }

  void (async () => {
    await Promise.all([
      pipeDownloadOutput(proc.stdout instanceof ReadableStream ? proc.stdout : null, tracker, scheduleWrite),
      pipeDownloadOutput(proc.stderr instanceof ReadableStream ? proc.stderr : null, tracker, scheduleWrite),
    ])
    progressTrackers.delete(id)
    if (pendingWrite) clearTimeout(pendingWrite)
    tracker.flush()
    await persistCliProgressToStore(directory, key, tracker, true)
  })()
}

async function finalizeDownloadRecord(
  directory: string,
  resourceId: string,
  record: ModelScopeDownloadRecord,
  code: number | null,
) {
  const cachePaths = await localExistingCachePaths(directory, resourceId)
  const hasFiles = cachePaths.length > 0
  const downloaded_bytes =
    record.downloaded_bytes ??
    (hasFiles && record.progress_total_bytes ? record.progress_total_bytes : record.downloaded_bytes)
  const next = code === 0 || hasFiles
    ? completedRecord(record, Date.now(), cachePaths)
    : { ...record, status: "failed" as const, finished_at: Date.now(), error: `exit ${code}`, pid: undefined }
  return downloaded_bytes === undefined ? next : { ...next, downloaded_bytes }
}

async function syncDownloadingRecord(directory: string, key: string, resourceId: string) {
  const store = await readStore(directory)
  const current = store[key]
  if (!current || current.status !== "downloading") return
  if (!current.estimated_total_bytes) {
    const estimated_total_bytes = await fetchModelScopeDatasetStorageSize(resourceId).catch(() => undefined)
    if (estimated_total_bytes) {
      store[key] = { ...current, estimated_total_bytes }
      await writeStore(directory, store)
    }
  }
  await reconcileStore(directory, await readStore(directory))
  const next = await readStore(directory)
  if (next[key]?.status !== "downloading") return
  await markInstalledRecords(directory, next)
}

function killDownloadProcess(id: string, pid: number | undefined) {
  progressTrackers.delete(id)
  const proc = active.get(id)
  if (proc) {
    proc.kill()
    active.delete(id)
    return
  }
  if (!processRunning(pid)) return
  try {
    process.kill(pid!)
  } catch {
    return
  }
}

async function removeDatasetCache(directory: string, resourceId: string) {
  for (const target of datasetCacheTargets(directory, resourceId)) {
    await fs.rm(target, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function completeWhenProcessEnded(
  directory: string,
  key: string,
  resourceId: string,
  record: ModelScopeDownloadRecord,
  store: DownloadStore,
) {
  const id = jobKey(directory, key)
  if (downloadStillLive(id, record.pid)) return false
  if (!(await datasetHasFiles(directory, resourceId))) return false
  store[key] = completedRecord(record, record.finished_at ?? Date.now(), await localExistingCachePaths(directory, resourceId))
  return true
}

function isLocalRecord(record: ModelScopeDownloadRecord) {
  return environmentOfRecord(record).kind === "local"
}

async function promotePartialRecords(directory: string, store: DownloadStore) {
  let changed = false
  for (const [key, record] of Object.entries(store)) {
    if (!isLocalRecord(record)) continue
    if (record.status === "completed" || record.status === "downloading" || record.status === "partial") continue
    if (!(await datasetHasFiles(directory, record.resource_id))) continue
    store[key] = partialRecord(record, record.resource_id)
    changed = true
  }

  const root = path.join(resolveDirectory(directory), modelScopeDatasetsCacheDir)
  const orgs = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  for (const org of orgs) {
    if (!org.isDirectory() || org.name.startsWith(".")) continue
    const orgPath = path.join(root, org.name)
    const datasets = await fs.readdir(orgPath, { withFileTypes: true }).catch(() => [])
    for (const dataset of datasets) {
      if (!dataset.isDirectory()) continue
      const resourceId = `${org.name}/${dataset.name}`
      const key = downloadStoreKey({ kind: "local" }, resourceId)
      const existing = store[key]
      if (existing?.status === "completed" || existing?.status === "downloading" || existing?.status === "partial") continue
      if (!(await datasetHasFiles(directory, resourceId))) continue
      store[key] = partialRecord(
        existing ?? {
          resource_id: resourceId,
          kind: "dataset",
          status: "failed",
          started_at: Date.now(),
          error: "cancelled",
          environment: { kind: "local" },
        },
        resourceId,
      )
      changed = true
    }
  }

  const tempRoot = path.join(root, "._____temp")
  const tempOrgs = await fs.readdir(tempRoot, { withFileTypes: true }).catch(() => [])
  for (const org of tempOrgs) {
    if (!org.isDirectory() || org.name.startsWith(".")) continue
    const orgPath = path.join(tempRoot, org.name)
    const datasets = await fs.readdir(orgPath, { withFileTypes: true }).catch(() => [])
    for (const dataset of datasets) {
      if (!dataset.isDirectory()) continue
      const resourceId = `${org.name}/${dataset.name}`
      const key = downloadStoreKey({ kind: "local" }, resourceId)
      const existing = store[key]
      if (existing?.status === "completed" || existing?.status === "downloading" || existing?.status === "partial") continue
      if (!(await datasetHasFiles(directory, resourceId))) continue
      store[key] = partialRecord(
        existing ?? {
          resource_id: resourceId,
          kind: "dataset",
          status: "failed",
          started_at: Date.now(),
          error: "cancelled",
          environment: { kind: "local" },
        },
        resourceId,
      )
      changed = true
    }
  }
  if (changed) await writeStore(directory, store)
}

async function pruneHiddenDownloadRecords(directory: string, store: DownloadStore) {
  let changed = false
  for (const [key, record] of Object.entries(store)) {
    if (shouldPersistDownloadRecord(record)) continue
    delete store[key]
    changed = true
  }
  if (changed) await writeStore(directory, store)
}

async function markInstalledRecords(directory: string, store: DownloadStore) {
  let changed = false
  for (const [key, record] of Object.entries(store)) {
    if (!isLocalRecord(record)) continue
    if (record.status === "completed") continue
    if (record.status === "partial") continue
    if (record.error === "cancelled") {
      if (await datasetHasFiles(directory, record.resource_id)) {
        store[key] = partialRecord(record, record.resource_id)
        changed = true
      }
      continue
    }
    if (await completeWhenProcessEnded(directory, key, record.resource_id, record, store)) changed = true
  }

  const root = path.join(resolveDirectory(directory), modelScopeDatasetsCacheDir)
  const orgs = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  for (const org of orgs) {
    if (!org.isDirectory() || org.name.startsWith(".")) continue
    const orgPath = path.join(root, org.name)
    const datasets = await fs.readdir(orgPath, { withFileTypes: true }).catch(() => [])
    for (const dataset of datasets) {
      if (!dataset.isDirectory()) continue
      const resourceId = `${org.name}/${dataset.name}`
      const key = downloadStoreKey({ kind: "local" }, resourceId)
      const existing = store[key]
      if (existing?.status === "completed" || existing?.status === "downloading" || existing?.status === "partial") continue
      if (existing?.error === "cancelled") {
        if (await datasetHasFiles(directory, resourceId)) {
          store[key] = partialRecord(existing, resourceId)
          changed = true
        }
        continue
      }
      if (
        await completeWhenProcessEnded(
          directory,
          key,
          resourceId,
          existing ?? {
            resource_id: resourceId,
            kind: "dataset",
            status: "failed",
            started_at: Date.now(),
            environment: { kind: "local" },
          },
          store,
        )
      ) {
        changed = true
      }
    }
  }

  if (changed) await writeStore(directory, store)
}

async function reconcileStore(directory: string, store: DownloadStore) {
  const now = Date.now()
  let changed = false
  for (const [key, record] of Object.entries(store)) {
    if (record.status !== "downloading") continue
    if (environmentOfRecord(record).kind === "ssh") {
      // Server may have restarted; rebuild the polling loop from the persisted snapshot.
      ensureSshDownloadWatcher(directory, key, record)
      continue
    }
    const id = jobKey(directory, key)
    if (downloadStillLive(id, record.pid)) continue
    if (await datasetHasFiles(directory, record.resource_id)) {
      store[key] = completedRecord(record, Date.now(), await localExistingCachePaths(directory, record.resource_id))
      changed = true
      continue
    }
    if (now - record.started_at < 30_000) continue
    store[key] = { ...record, status: "failed", finished_at: Date.now(), error: "interrupted", pid: undefined }
    changed = true
  }
  if (changed) await writeStore(directory, store)
}

export async function getModelScopeDownloadPreflight(directory: string, resourceId: string) {
  const datasetBytes = await fetchModelScopeDatasetStorageSize(
    resourceId,
    fetch,
    MODELSCOPE_DATASET_SIZE_PREFLIGHT_TIMEOUT_MS,
  ).catch(() => undefined)
  return {
    resourceId,
    ...(datasetBytes !== undefined ? { datasetBytes } : {}),
  }
}

export async function listModelScopeDownloads(directory: string) {
  await readStore(directory)
  await reconcileStore(directory, await readStore(directory))
  await markInstalledRecords(directory, await readStore(directory))
  await promotePartialRecords(directory, await readStore(directory))
  const next = await readStore(directory)
  await pruneHiddenDownloadRecords(directory, next)
  return Object.values(await readStore(directory)).filter(shouldPersistDownloadRecord)
}

export async function getModelScopeDownload(
  directory: string,
  resourceId: string,
  environment?: { kind: "local" | "ssh"; targetName?: string },
) {
  const key = downloadStoreKey(
    environment?.kind === "ssh" ? { kind: "ssh", target_name: environment.targetName ?? "" } : { kind: "local" },
    resourceId,
  )
  return (await readStore(directory))[key]
}

export async function startModelScopeDatasetDownload(
  directory: string,
  resourceId: string,
  environment?: ModelScopeDownloadStartEnvironment,
) {
  if (environment?.kind === "ssh") {
    const key = downloadStoreKey({ kind: "ssh", target_name: environment.targetName }, resourceId)
    const existing = (await readStore(directory))[key]
    if (existing?.status === "downloading") {
      ensureSshDownloadWatcher(directory, key, existing)
      return existing
    }
    return startSshDatasetDownload({
      directory,
      resourceId,
      targetName: environment.targetName,
      remotePath: environment.remotePath,
      ssh: environment.ssh,
      ...(environment.condaEnv ? { condaEnv: environment.condaEnv } : {}),
      estimatedTotalBytes: await fetchModelScopeDatasetStorageSize(resourceId).catch(() => undefined),
    })
  }

  const key = downloadStoreKey({ kind: "local" }, resourceId)
  const id = jobKey(directory, key)
  const store = await readStore(directory)
  const existing = store[key]
  if (existing?.status === "downloading" && downloadStillLive(id, existing.pid)) return existing
  if (existing?.status === "downloading") {
    store[key] = { ...existing, status: "failed", finished_at: Date.now(), error: "interrupted", pid: undefined }
  }

  const root = resolveDirectory(directory)
  const condaEnv = environment?.kind === "local" ? environment.condaEnv : undefined
  let proc: ReturnType<typeof Bun.spawn>
  try {
    proc = await spawnModelScopeDownload(root, resourceId, condaEnv)
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    if (text.includes("modelscope CLI not found in conda environment")) {
      throw error instanceof Error ? error : new Error(text)
    }
    if (
      text.includes("modelscope CLI not found") ||
      text.includes("ENOENT") ||
      text.includes("Executable not found")
    ) {
      throw new Error("modelscope CLI not found")
    }
    throw error
  }
  const estimated_total_bytes = await fetchModelScopeDatasetStorageSize(resourceId).catch(() => undefined)
  active.set(id, proc)
  attachModelScopeDownloadProgress(id, directory, key, proc)

  const record: ModelScopeDownloadRecord = {
    resource_id: resourceId,
    kind: "dataset",
    status: "downloading",
    started_at: Date.now(),
    pid: proc.pid,
    environment: { kind: "local" },
    downloaded_bytes: 0,
    ...(estimated_total_bytes ? { estimated_total_bytes } : {}),
  }
  store[key] = record
  await writeStore(directory, store)

  const watch = setInterval(() => {
    void (async () => {
      const store = await readStore(directory)
      const current = store[key]
      if (!current || current.status !== "downloading") {
        clearInterval(watch)
        return
      }
      await syncDownloadingRecord(directory, key, resourceId)
      if ((await readStore(directory))[key]?.status !== "downloading") clearInterval(watch)
    })()
  }, MODELSCOPE_DOWNLOAD_WATCH_INTERVAL_MS)

  void proc.exited.then(async (code) => {
    clearInterval(watch)
    active.delete(id)
    progressTrackers.delete(id)
    const next = await readStore(directory)
    const current = next[key]
    if (!current || current.status !== "downloading") return
    next[key] = await finalizeDownloadRecord(directory, resourceId, current, code)
    await writeStore(directory, next)
  })

  return record
}

function locateRecord(store: DownloadStore, resourceId: string, environment?: { kind: "local" | "ssh"; targetName?: string }) {
  if (environment) {
    const key = downloadStoreKey(
      environment.kind === "ssh" ? { kind: "ssh", target_name: environment.targetName ?? "" } : { kind: "local" },
      resourceId,
    )
    const record = store[key]
    return record ? { key, record } : undefined
  }
  const matches = Object.entries(store).filter(([, record]) => record.resource_id === resourceId)
  if (matches.length !== 1) return undefined
  const [key, record] = matches[0]!
  return { key, record }
}

export async function cancelModelScopeDatasetDownload(
  directory: string,
  resourceId: string,
  environment?: { kind: "local" | "ssh"; targetName?: string },
) {
  const store = await readStore(directory)
  const located = locateRecord(store, resourceId, environment)
  if (!located) throw new Error("not downloading")
  const { key, record: existing } = located
  if (existing.status === "completed") return existing

  if (environmentOfRecord(existing).kind === "ssh") {
    return cancelSshDatasetDownload(directory, key, existing)
  }

  const id = jobKey(directory, key)
  killDownloadProcess(id, existing.pid)

  if (existing.status !== "downloading") return existing

  const cancelled: ModelScopeDownloadRecord = {
    ...existing,
    status: "failed",
    finished_at: Date.now(),
    error: "cancelled",
    pid: undefined,
  }
  store[key] = (await datasetHasFiles(directory, resourceId))
    ? partialRecord(cancelled, resourceId)
    : cancelled
  await writeStore(directory, store)
  return store[key]!
}

export async function deleteModelScopeDatasetDownload(
  directory: string,
  resourceId: string,
  environment?: { kind: "local" | "ssh"; targetName?: string },
) {
  const store = await readStore(directory)
  const located = locateRecord(store, resourceId, environment)
  const existing = located?.record
  if (existing && environmentOfRecord(existing).kind === "ssh") {
    if (existing.status === "downloading") throw new Error("download in progress")
    await deleteSshDatasetDownload(directory, located!.key, existing)
    return true
  }

  const key = located?.key ?? downloadStoreKey({ kind: "local" }, resourceId)
  const id = jobKey(directory, key)
  if (downloadStillLive(id, existing?.pid)) throw new Error("download in progress")
  if (existing?.status === "downloading") throw new Error("download in progress")
  if (
    existing?.status !== "completed" &&
    existing?.status !== "partial" &&
    !(await datasetHasFiles(directory, resourceId))
  ) {
    throw new Error("not downloaded")
  }

  await removeDatasetCache(directory, resourceId)
  if (!(await datasetHasFiles(directory, resourceId))) {
    const next = await readStore(directory)
    delete next[key]
    await writeStore(directory, next)
    return true
  }
  throw new Error("delete failed")
}

export * as OneScienceModelScopeDownload from "./modelscope-download"
