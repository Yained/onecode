import { createHash } from "crypto"
import { existsSync, readFileSync } from "fs"
import { Global } from "@opencode-ai/core/global"
import path from "path"
import { CatalogEmbeddingModel } from "@/catalog/embedding-model"
import { parseMatter } from "@/util/frontmatter"
import type { CatalogEntryTable } from "./index.sql"

export const LOCAL_MODEL_ID = "catalog:hash-v1"
export const DEFAULT_API_MODEL = "text-embedding-3-small"
export const LOCAL_EMBED_DIMS = 384
export const DEFAULT_ONNX_MODEL = CatalogEmbeddingModel.DEFAULT_ONNX_MODEL
export const DEFAULT_ONNX_DIMS = CatalogEmbeddingModel.DEFAULT_ONNX_DIMS
const SKILL_BODY_LIMIT = 2000

export type EmbedMode = "auto" | "local" | "model" | "api" | "off"

export type EmbedModel =
  | { id: typeof LOCAL_MODEL_ID; mode: "local"; dims: number }
  | { id: string; mode: "model"; dims: number }
  | { id: string; mode: "api"; dims?: number; baseUrl: string; apiKey: string }

export function embedMode(): EmbedMode {
  const raw = process.env.CATALOG_EMBEDDING_MODE?.trim().toLowerCase()
  if (raw === "off" || raw === "local" || raw === "model" || raw === "api" || raw === "auto") return raw
  if (CatalogEmbeddingModel.packagedEmbeddingCacheDir()) return "model"
  return "auto"
}

function onnxModel(prefer?: EmbedMode) {
  const id = CatalogEmbeddingModel.onnxModelId()
  if (prefer === "api" || prefer === "local" || prefer === "off") return undefined
  return { id, mode: "model" as const, dims: DEFAULT_ONNX_DIMS }
}

function readOpenAIKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  const authFile = path.join(Global.Path.data, "auth.json")
  if (!existsSync(authFile)) return undefined
  const data = JSON.parse(readFileSync(authFile, "utf8")) as Record<string, { type?: string; key?: string }>
  const openai = data.openai
  if (openai?.type === "api" && openai.key) return openai.key
  return undefined
}

export function resolveEmbedModel(prefer?: EmbedMode): EmbedModel | undefined {
  const mode = prefer ?? embedMode()
  if (mode === "off") return undefined
  if (mode === "local") return { id: LOCAL_MODEL_ID, mode: "local", dims: LOCAL_EMBED_DIMS }
  if (mode === "model") return onnxModel("model")

  const apiKey = readOpenAIKey()
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "")
  const apiModel =
    process.env.CATALOG_EMBEDDING_API_MODEL?.trim() ||
    (mode === "api" ? process.env.CATALOG_EMBEDDING_MODEL?.trim() : undefined) ||
    DEFAULT_API_MODEL
  if (mode === "api") {
    if (!apiKey) return undefined
    return { id: apiModel, mode: "api", baseUrl, apiKey }
  }

  if (apiKey) return { id: apiModel, mode: "api", baseUrl, apiKey }
  return onnxModel("auto") ?? { id: LOCAL_MODEL_ID, mode: "local", dims: LOCAL_EMBED_DIMS }
}

export function resolveEmbedModelById(modelId: string): EmbedModel | undefined {
  if (modelId === LOCAL_MODEL_ID) return resolveEmbedModel("local")
  if (modelId === CatalogEmbeddingModel.onnxModelId() || modelId.startsWith("Xenova/")) {
    return { id: modelId, mode: "model", dims: DEFAULT_ONNX_DIMS }
  }
  const apiKey = readOpenAIKey()
  if (!apiKey) return undefined
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "")
  return { id: modelId, mode: "api", baseUrl, apiKey }
}

export function entryEmbedText(row: typeof CatalogEntryTable.$inferSelect) {
  const parts = [row.title, row.description, row.category ?? "", ...row.tags]
  if (row.kind === "skill" && row.location && existsSync(row.location)) {
    const body = parseMatter(readFileSync(row.location, "utf8")).content.trim().slice(0, SKILL_BODY_LIMIT)
    if (body) parts.push(body)
  }
  return parts.filter(Boolean).join("\n")
}

export function embedSourceHash(text: string) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16)
}

function hashToken(token: string) {
  const digest = createHash("sha256").update(token).digest()
  return ((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0
}

function addToVector(vector: Float32Array, token: string, weight: number) {
  const index = hashToken(token) % vector.length
  vector[index]! += weight
}

function normalizeVector(vector: Float32Array) {
  let sum = 0
  for (const value of vector) sum += value * value
  const norm = Math.sqrt(sum)
  if (norm === 0) return [...vector]
  return [...vector].map((value) => value / norm)
}

export function embedTextLocal(text: string, dims = LOCAL_EMBED_DIMS) {
  const vector = new Float32Array(dims)
  const normalized = text.toLowerCase()
  const tokens = normalized.split(/\s+/).filter(Boolean)
  for (const token of tokens) {
    addToVector(vector, token, 2)
    if (/[\u4e00-\u9fff]/.test(token)) {
      for (let index = 0; index < token.length - 1; index++) addToVector(vector, token.slice(index, index + 2), 1.5)
    }
    for (let index = 0; index < token.length - 2; index++) addToVector(vector, token.slice(index, index + 3), 1)
  }
  return normalizeVector(vector)
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]) {
  const length = Math.min(left.length, right.length)
  if (length === 0) return 0
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < length; index++) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    dot += a * b
    leftNorm += a * a
    rightNorm += b * b
  }
  const denom = Math.sqrt(leftNorm) * Math.sqrt(rightNorm)
  if (denom === 0) return 0
  return dot / denom
}

export function embedText(text: string, model: EmbedModel) {
  if (model.mode === "local") return embedTextLocal(text, model.dims)
  throw new Error("API embedding requires embedTextAsync")
}

async function embedTextsApi(texts: readonly string[], model: Extract<EmbedModel, { mode: "api" }>) {
  const response = await fetch(`${model.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${model.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: model.id, input: texts }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`embedding request failed: ${response.status} ${body}`)
  }
  const payload = (await response.json()) as { data?: Array<{ embedding?: number[]; index?: number }> }
  const items = payload.data ?? []
  return items
    .toSorted((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((item) => item.embedding)
    .filter((item): item is number[] => Array.isArray(item))
}

export async function embedTextAsync(text: string, model: EmbedModel, input?: { query?: boolean }) {
  if (model.mode === "local") return embedTextLocal(text, model.dims)
  if (model.mode === "model") {
    const value = input?.query ? CatalogEmbeddingModel.formatQueryText(text) : text
    return CatalogEmbeddingModel.embedWithOnnxModel(value, model.id)
  }
  const [vector] = await embedTextsApi([text], model)
  if (!vector) throw new Error("embedding response missing vector")
  return vector
}

export async function embedTextsAsync(texts: readonly string[], model: EmbedModel, input?: { query?: boolean }) {
  if (model.mode === "local") return texts.map((text) => embedTextLocal(text, model.dims))
  if (model.mode === "model") {
    const values = input?.query ? texts.map((text) => CatalogEmbeddingModel.formatQueryText(text)) : texts
    return CatalogEmbeddingModel.embedTextsWithOnnxModel(values, model.id)
  }
  const batchSize = 64
  const vectors: number[][] = []
  for (let index = 0; index < texts.length; index += batchSize) {
    const batch = texts.slice(index, index + batchSize)
    vectors.push(...(await embedTextsApi(batch, model)))
  }
  return vectors
}

export function needsEmbedding(
  row: typeof CatalogEntryTable.$inferSelect,
  text: string,
  model: EmbedModel,
) {
  const hash = embedSourceHash(text)
  if (row.embedding_source_hash !== hash) return true
  if (row.embedding_model !== model.id) return true
  if (!row.embedding_json?.length) return true
  if ((model.mode === "local" || model.mode === "model") && row.embedding_json.length !== model.dims) return true
  return false
}

export * as CatalogEmbedding from "./embedding"
