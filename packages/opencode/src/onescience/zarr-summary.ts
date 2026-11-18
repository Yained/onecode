import { existsSync, readdirSync, readFileSync, statSync } from "fs"
import path from "path"

export type ZarrArraySummary = {
  path: string
  shape: number[]
  dtype: string
  chunks: number[]
}

export type ZarrSummary = {
  zarr_version?: number
  arrays: ZarrArraySummary[]
  truncated?: boolean
}

const MAX_ARRAYS = 32
const MAX_DEPTH = 6
const TIMEOUT_MS = 8_000

function asNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "number")) return
  return value as number[]
}

function parseZarray(raw: string, rel: string): { version?: number; array?: ZarrArraySummary } {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
  if (typeof parsed.zarr_format === "number" && parsed.zarr_format >= 3) {
    if (parsed.node_type !== "array") return { version: Number(parsed.zarr_format) }
    const shape = asNumberArray(parsed.shape)
    const grid = parsed.chunk_grid as { configuration?: { chunk_shape?: unknown } } | undefined
    const chunks = asNumberArray(grid?.configuration?.chunk_shape) ?? shape
    const dtype = typeof parsed.data_type === "string" ? parsed.data_type : "unknown"
    if (!shape) return { version: Number(parsed.zarr_format) }
    return {
      version: Number(parsed.zarr_format),
      array: { path: rel || ".", shape, dtype, chunks: chunks ?? [] },
    }
  }
  const shape = asNumberArray(parsed.shape)
  const chunks = asNumberArray(parsed.chunks) ?? shape
  const dtype = typeof parsed.dtype === "string" ? parsed.dtype : "unknown"
  if (!shape) return { version: 2 }
  return {
    version: 2,
    array: { path: rel || ".", shape, dtype, chunks: chunks ?? [] },
  }
}

export function looksLikeZarr(root: string) {
  return existsSync(path.join(root, ".zgroup"))
    || existsSync(path.join(root, ".zarray"))
    || existsSync(path.join(root, "zarr.json"))
    || root.replaceAll("\\", "/").endsWith(".zarr")
}

export function summarizeZarr(root: string): ZarrSummary | undefined {
  if (!existsSync(root)) return
  let st
  try {
    st = statSync(root)
  } catch {
    return
  }
  if (!st.isDirectory() && !looksLikeZarr(root)) return
  const started = Date.now()
  const arrays: ZarrArraySummary[] = []
  let truncated = false
  let version: number | undefined

  const walk = (dir: string, rel: string, depth: number) => {
    if (arrays.length >= MAX_ARRAYS || depth > MAX_DEPTH || Date.now() - started > TIMEOUT_MS) {
      truncated = arrays.length >= MAX_ARRAYS || depth > MAX_DEPTH || Date.now() - started > TIMEOUT_MS
      return
    }
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (arrays.length >= MAX_ARRAYS || Date.now() - started > TIMEOUT_MS) {
        truncated = true
        return
      }
      const next = path.join(dir, entry.name)
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(next, nextRel, depth + 1)
        continue
      }
      if (entry.name !== ".zarray" && entry.name !== "zarr.json") continue
      let raw: string
      try {
        raw = readFileSync(next, "utf8")
      } catch {
        continue
      }
      const parsed = parseZarray(raw, entry.name === ".zarray" || entry.name === "zarr.json" ? rel : nextRel)
      if (parsed.version && !version) version = parsed.version
      if (parsed.array) arrays.push(parsed.array)
    }
  }

  const base = st.isDirectory() ? root : path.dirname(root)
  if (!st.isDirectory() && !looksLikeZarr(base)) return
  walk(st.isDirectory() ? root : base, "", 0)
  if (!arrays.length && !looksLikeZarr(st.isDirectory() ? root : base)) return
  return {
    ...(version ? { zarr_version: version } : {}),
    arrays,
    ...(truncated ? { truncated: true } : {}),
  }
}

export { parseZarray }
