import { Global } from "@opencode-ai/core/global"
import { existsSync, readFileSync } from "fs"
import path from "path"
import { pathToFileURL } from "url"
import * as Log from "@opencode-ai/core/util/log"
import { CatalogEmbeddingWorker } from "@/catalog/embedding-worker"

const log = Log.create({ service: "catalog" })

export const DEFAULT_ONNX_MODEL = "Xenova/bge-small-zh-v1.5"
export const DEFAULT_ONNX_DIMS = 512
export const BGE_QUERY_PREFIX = "为这个句子生成表示以用于检索相关文章："

type FeatureOutput = {
  dims: number[]
  data: Float32Array | number[]
}

type FeatureExtractor = (
  input: string | readonly string[],
  options?: { pooling?: "mean"; normalize?: boolean },
) => Promise<FeatureOutput>

let pipelinePromise: Promise<FeatureExtractor> | undefined
let loadedModelId: string | undefined

export function onnxModelId() {
  return process.env.CATALOG_EMBEDDING_MODEL?.trim() || DEFAULT_ONNX_MODEL
}

type TransformersModule = {
  env: {
    allowRemoteModels: boolean
    backends: { onnx: { wasm: boolean | { wasmPaths?: string } } }
  }
  pipeline: (task: string, model: string, options?: unknown) => Promise<FeatureExtractor>
}

let transformersPromise: Promise<TransformersModule> | undefined

function bundledTransformersLibDir() {
  return path.join(path.dirname(process.execPath), "../lib")
}

export function transformersModuleCandidates() {
  const configured = process.env.ONECODE_TRANSFORMERS_PATH?.trim()
  const source = path.resolve(
    import.meta.dirname,
    "../../node_modules/@huggingface/transformers/dist/transformers.node.mjs",
  )
  const bundled = path.join(bundledTransformersLibDir(), "transformers.node.mjs")
  if (configured) return [configured, source, bundled]
  return [source, bundled]
}

export function transformersModuleAvailable() {
  return transformersModuleCandidates().some((candidate) => existsSync(candidate))
}

async function loadTransformers() {
  if (!transformersPromise) {
    transformersPromise = (async () => {
      let lastError: unknown
      for (const candidate of transformersModuleCandidates()) {
        if (!existsSync(candidate)) continue
        try {
          const mod = (await import(pathToFileURL(candidate).href)) as TransformersModule
          const libDir = path.dirname(candidate)
          const wasm = mod.env.backends.onnx.wasm
          if (wasm && typeof wasm === "object" && "wasmPaths" in wasm) {
            wasm.wasmPaths = libDir.endsWith("/") ? libDir : `${libDir}/`
          }
          mod.env.allowRemoteModels = true
          return mod
        } catch (error) {
          lastError = error
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new Error("transformers module not found; rebuild onecode or set ONECODE_TRANSFORMERS_PATH")
    })()
  }
  return transformersPromise
}

export function packagedEmbeddingCacheDir() {
  const cache = path.join(path.dirname(process.execPath), "../embedding-models")
  const slug = `models--${onnxModelId().replaceAll("/", "--")}`
  if (!existsSync(path.join(cache, slug, "refs", "main"))) return undefined
  return cache
}

export function embeddingCacheDir() {
  const configured = process.env.CATALOG_EMBEDDING_CACHE?.trim()
  if (configured) return configured
  const packaged = packagedEmbeddingCacheDir()
  if (packaged) return packaged
  return path.join(Global.Path.data, "embedding-models")
}

function resolveSnapshotPath(modelId: string) {
  const explicit = process.env.CATALOG_EMBEDDING_SNAPSHOT_PATH?.trim()
  if (explicit) return path.resolve(explicit)
  if (path.isAbsolute(modelId)) return modelId
  const cache = embeddingCacheDir()
  const slug = `models--${modelId.replaceAll("/", "--")}`
  const refPath = path.join(cache, slug, "refs", "main")
  if (!existsSync(refPath)) {
    throw new Error(`catalog embedding cache missing ${refPath}; run script/catalog-embedding-install-cache.sh`)
  }
  const revision = readFileSync(refPath, "utf8").trim()
  return path.join(cache, slug, "snapshots", revision)
}

export function formatQueryText(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return trimmed
  if (trimmed.startsWith(BGE_QUERY_PREFIX)) return trimmed
  return `${BGE_QUERY_PREFIX}${trimmed}`
}

function tensorToVectors(output: FeatureOutput) {
  const rows = output.dims.length === 1 ? 1 : output.dims[0]!
  const cols = output.dims.length === 1 ? output.dims[0]! : output.dims[1]!
  const data = output.data instanceof Float32Array ? output.data : Float32Array.from(output.data)
  if (rows === 1) return [[...data]]
  const vectors: number[][] = []
  for (let index = 0; index < rows; index++) {
    vectors.push([...data.subarray(index * cols, (index + 1) * cols)])
  }
  return vectors
}

async function loadExtractor(modelId: string): Promise<FeatureExtractor> {
  if (pipelinePromise && loadedModelId === modelId) return pipelinePromise
  loadedModelId = modelId
  pipelinePromise = (async () => {
    const { env, pipeline } = await loadTransformers()
    env.allowRemoteModels = false
    return pipeline("feature-extraction", resolveSnapshotPath(modelId)) as unknown as FeatureExtractor
  })()
  return pipelinePromise
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

function runningInCompiledBinary() {
  return path.basename(process.execPath).includes("onecode")
}

function embedWorkerProcess() {
  return process.env.CATALOG_EMBED_WORKER === "1"
}

let useBunRunner = runningInCompiledBinary() && !embedWorkerProcess()

async function embedTextsViaBunRunner(
  texts: readonly string[],
  modelId: string,
  input?: { query?: boolean },
) {
  return CatalogEmbeddingWorker.embedViaPersistentWorker(texts, modelId, input)
}

async function embedTextsDirect(texts: readonly string[], modelId: string, input?: { query?: boolean }) {
  if (texts.length === 0) return []
  const extractor = await loadExtractor(modelId)
  const batchSize = 16
  const vectors: number[][] = []
  for (let index = 0; index < texts.length; index += batchSize) {
    const batch = texts.slice(index, index + batchSize)
    const values = batch.map((text) => (input?.query ? formatQueryText(text) : text))
    const modelInput = values.length === 1 ? values[0]! : values
    const output = await extractor(modelInput, { pooling: "mean", normalize: true })
    vectors.push(...tensorToVectors(output))
  }
  return vectors
}

export async function embedWithOnnxModel(text: string, modelId = onnxModelId()) {
  const [vector] = await embedTextsWithOnnxModel([text], modelId)
  if (!vector) throw new Error("catalog embedding missing vector")
  return vector
}

export async function embedTextsWithOnnxModel(
  texts: readonly string[],
  modelId = onnxModelId(),
  input?: { query?: boolean },
) {
  if (embedWorkerProcess() || !useBunRunner) {
    try {
      return await embedTextsDirect(texts, modelId, input)
    } catch (error) {
      if (embedWorkerProcess() || !bunRunnerScript()) throw error
      useBunRunner = true
      log.warn("catalog direct onnx embed unavailable; using bun runner", { error })
    }
  }
  return embedTextsViaBunRunner(texts, modelId, input)
}

export async function pullOnnxModel(modelId = onnxModelId()) {
  await embedWithOnnxModel("catalog embedding warmup", modelId)
  return { modelId, cacheDir: embeddingCacheDir() }
}

export function shutdownEmbedWorker() {
  CatalogEmbeddingWorker.shutdownPersistentWorker()
}

export * as CatalogEmbeddingModel from "./embedding-model"
