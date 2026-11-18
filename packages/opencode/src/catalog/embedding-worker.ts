import { Global } from "@opencode-ai/core/global"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync } from "fs"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "catalog" })
const DEFAULT_ONNX_MODEL = "Xenova/bge-small-zh-v1.5"

type WorkerReply = {
  ready?: boolean
  pong?: boolean
  id?: string
  vectors?: number[][]
  error?: string
}

type Pending = {
  resolve: (vectors: number[][]) => void
  reject: (error: Error) => void
}

let child: ChildProcessWithoutNullStreams | undefined
let activeModelId: string | undefined
let stdoutBuffer = ""
let readyResolve: (() => void) | undefined
let readyReject: ((error: Error) => void) | undefined
let readyTimeout: ReturnType<typeof setTimeout> | undefined
let requestChain = Promise.resolve<number[][]>([])
const pending = new Map<string, Pending>()
let nextId = 0

function onnxModelId() {
  return process.env.CATALOG_EMBEDDING_MODEL?.trim() || DEFAULT_ONNX_MODEL
}

function packagedEmbeddingCacheDir() {
  const cache = path.join(path.dirname(process.execPath), "../embedding-models")
  const slug = `models--${onnxModelId().replaceAll("/", "--")}`
  if (!existsSync(path.join(cache, slug, "refs", "main"))) return undefined
  return cache
}

function embeddingCacheDir() {
  const configured = process.env.CATALOG_EMBEDDING_CACHE?.trim()
  if (configured) return configured
  const packaged = packagedEmbeddingCacheDir()
  if (packaged) return packaged
  return path.join(Global.Path.data, "embedding-models")
}

function bunRunnerScript() {
  const root = process.env.ONECODE_ROOT?.trim()
  if (root) {
    const script = path.join(root, "packages/opencode/script/catalog-embed-query.ts")
    if (existsSync(script)) return script
  }
  const script = path.resolve(import.meta.dirname, "../../script/catalog-embed-query.ts")
  if (existsSync(script)) return script
  return undefined
}

function workerEnv(modelId: string) {
  return {
    ...process.env,
    CATALOG_EMBED_WORKER: "1",
    CATALOG_EMBEDDING_MODE: "model",
    CATALOG_EMBEDDING_MODEL: modelId,
    CATALOG_EMBEDDING_CACHE: embeddingCacheDir(),
  }
}

function rejectAllPending(error: Error) {
  for (const entry of pending.values()) entry.reject(error)
  pending.clear()
}

function settleReady() {
  if (readyTimeout) clearTimeout(readyTimeout)
  readyTimeout = undefined
  readyResolve?.()
  readyResolve = undefined
  readyReject = undefined
}

function failReady(error: Error) {
  if (readyTimeout) clearTimeout(readyTimeout)
  readyTimeout = undefined
  readyReject?.(error)
  readyResolve = undefined
  readyReject = undefined
}

function handleWorkerLine(line: string) {
  const payload = JSON.parse(line) as WorkerReply
  if (payload.ready) {
    settleReady()
    return
  }
  if (!payload.id) return
  const entry = pending.get(payload.id)
  if (!entry) return
  pending.delete(payload.id)
  if (payload.error) {
    entry.reject(new Error(payload.error))
    return
  }
  if (!Array.isArray(payload.vectors)) {
    entry.reject(new Error("catalog embed worker returned invalid payload"))
    return
  }
  entry.resolve(payload.vectors)
}

function attachWorker(process: ChildProcessWithoutNullStreams) {
  process.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString()
    let newline = stdoutBuffer.indexOf("\n")
    while (newline >= 0) {
      const line = stdoutBuffer.slice(0, newline).trim()
      stdoutBuffer = stdoutBuffer.slice(newline + 1)
      if (line) handleWorkerLine(line)
      newline = stdoutBuffer.indexOf("\n")
    }
  })
  process.stderr.on("data", (chunk) => {
    const message = chunk.toString().trim()
    if (message) log.warn("catalog embed worker stderr", { message })
  })
  process.on("error", (error) => {
    if (child === process) child = undefined
    activeModelId = undefined
    failReady(error instanceof Error ? error : new Error(String(error)))
    rejectAllPending(error instanceof Error ? error : new Error(String(error)))
  })
  process.on("close", (code) => {
    if (child === process) child = undefined
    activeModelId = undefined
    const error = new Error(`catalog embed worker exited: ${code ?? "unknown"}`)
    failReady(error)
    rejectAllPending(error)
  })
}

function stopWorker() {
  if (!child) return
  child.kill("SIGTERM")
  child = undefined
  activeModelId = undefined
  failReady(new Error("catalog embed worker stopped"))
  rejectAllPending(new Error("catalog embed worker stopped"))
}

async function waitForReady() {
  await new Promise<void>((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
    readyTimeout = setTimeout(() => {
      failReady(new Error("catalog embed worker ready timeout"))
      stopWorker()
    }, 120_000)
  })
}

async function ensureWorker(modelId: string) {
  if (child && activeModelId === modelId) return child
  stopWorker()
  const script = bunRunnerScript()
  if (!script) throw new Error("catalog bun embed runner unavailable; set ONECODE_ROOT")
  const bun = process.env.ONECODE_BUN_BIN?.trim() || "bun"
  const worker = spawn(bun, [script, "--daemon"], {
    env: workerEnv(modelId),
    stdio: ["pipe", "pipe", "pipe"],
  })
  child = worker
  activeModelId = modelId
  stdoutBuffer = ""
  attachWorker(worker)
  await waitForReady()
  return worker
}

async function sendRequest(
  texts: readonly string[],
  modelId: string,
  input?: { query?: boolean },
) {
  if (texts.length === 0) return []
  const worker = await ensureWorker(modelId)
  const id = String(++nextId)
  return new Promise<number[][]>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker.stdin.write(`${JSON.stringify({ id, texts, query: input?.query, modelId })}\n`, (error) => {
      if (error) {
        pending.delete(id)
        reject(error)
      }
    })
  })
}

async function requestOnce(
  texts: readonly string[],
  modelId: string,
  input?: { query?: boolean },
) {
  try {
    return await sendRequest(texts, modelId, input)
  } catch (error) {
    stopWorker()
    return sendRequest(texts, modelId, input)
  }
}

export async function embedViaPersistentWorker(
  texts: readonly string[],
  modelId: string,
  input?: { query?: boolean },
) {
  const run = requestChain.then(() => requestOnce(texts, modelId, input))
  requestChain = run.then(
    () => [],
    () => [],
  )
  return run
}

export function shutdownPersistentWorker() {
  stopWorker()
}

export * as CatalogEmbeddingWorker from "./embedding-worker"
