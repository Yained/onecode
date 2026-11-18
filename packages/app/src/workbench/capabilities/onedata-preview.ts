import { formatDataSize } from "./onedata-filters"

export type OnedataPreviewKind =
  | "table"
  | "json"
  | "fasta"
  | "fastq"
  | "pdf"
  | "directory"
  | "zarr"
  | "scientific"
  | "structure"
  | "text"
  | "empty"

export type OnedataPreviewModel = {
  kind: OnedataPreviewKind
  title: string
  format: string
  subtitle?: string
  samplePath?: string
  headers?: string[]
  rows?: string[][]
  sequences?: Array<{ header: string; sequence: string }>
  entries?: Array<{ path: string; is_dir: boolean; size?: string }>
  truncated?: boolean
  lines?: string[]
  cards?: Array<{ label: string; value: string }>
  body?: string
  nested?: OnedataPreviewModel
}

type PreviewResult = {
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
}

const TABLE_FORMATS = new Set(["csv", "tsv", "xlsx"])
const JSON_FORMATS = new Set(["json", "jsonl", "ndjson"])
const FASTA_FORMATS = new Set(["fasta", "fa", "fna", "faa"])
const FASTQ_FORMATS = new Set(["fastq", "fq"])
const STRUCTURE_FORMATS = new Set(["pdb", "cif", "mmcif", "mol", "sdf", "mol2", "xyz", "extxyz"])
const SCIENTIFIC_FORMATS = new Set(["nc", "nc4", "cdf", "netcdf", "h5", "hdf5", "hdf", "he5", "npy", "npz", "mat"])

export function buildOnedataPreview(result: PreviewResult, input: { title: string; format?: string }): OnedataPreviewModel {
  const format = (result.probe?.format_hint || input.format || "unknown").toLowerCase()
  const size = formatDataSize(result.probe?.logical_bytes)
  const base = {
    title: input.title,
    format,
    subtitle: [size, formatLabel(format)].filter(Boolean).join(" · "),
    samplePath: result.sample_path,
  }

  if (result.zarr_summary?.arrays?.length) {
    return {
      ...base,
      kind: "zarr",
      format: "zarr",
      subtitle: [size, "Zarr", `${result.zarr_summary.arrays.length} 个数组`].filter(Boolean).join(" · "),
      cards: result.zarr_summary.arrays.map((item) => ({
        label: item.path || ".",
        value: `${item.shape.join(" × ")} · ${item.dtype}${item.chunks?.length ? ` · chunks ${item.chunks.join("×")}` : ""}`,
      })),
    }
  }

  if (result.table_preview) {
    const columns = result.table_preview.columns.length
      ? result.table_preview.columns
      : result.table_preview.rows[0]
        ? Object.keys(result.table_preview.rows[0])
        : []
    const width = Math.min(Math.max(columns.length, 1), 12)
    const headers = Array.from({ length: width }, (_, i) => columns[i] ?? "")
    const rows = result.table_preview.rows.slice(0, 21).map((row) =>
      headers.map((column) => formatPreviewCell(row[column])),
    )
    const entryCount = result.probe?.entry_count
    return {
      ...base,
      kind: "table",
      format: format === "table" ? "table" : format || "table",
      subtitle: [entryCount !== undefined ? `约 ${entryCount} 行` : `${rows.length} 行样例`, "数据表"]
        .filter(Boolean)
        .join(" · "),
      headers,
      rows,
    }
  }

  if (result.directory_listing?.entries.length) {
    const samplePath = result.sample_path || result.directory_listing.sample_path
    const nestedFormat = guessFormat(samplePath || "")
    return {
      ...base,
      kind: "directory",
      format: "directory",
      subtitle: [result.probe?.entry_count ? `${result.probe.entry_count} 个文件` : "目录", size]
        .filter(Boolean)
        .join(" · "),
      entries: result.directory_listing.entries.map((item) => ({
        path: item.path,
        is_dir: item.is_dir,
        size: formatDataSize(item.size_bytes) || undefined,
      })),
      truncated: result.directory_listing.truncated,
      samplePath,
      nested: result.sample
        ? buildOnedataPreview(
            { sample: result.sample, probe: { format_hint: nestedFormat || "txt" } },
            { title: samplePath || "样例文件", format: nestedFormat || "txt" },
          )
        : undefined,
    }
  }

  if (!result.sample) {
    return {
      ...base,
      kind: "empty",
      body: [size, formatLabel(format)].filter(Boolean).join(" · ") || "暂无预览内容",
    }
  }

  if (TABLE_FORMATS.has(format)) return { ...base, kind: "table", ...parseTable(result.sample, format) }
  if (JSON_FORMATS.has(format)) return { ...base, kind: "json", body: prettyJson(result.sample) }
  if (FASTA_FORMATS.has(format)) return { ...base, kind: "fasta", sequences: parseFasta(result.sample) }
  if (FASTQ_FORMATS.has(format)) return { ...base, kind: "fastq", sequences: parseFastq(result.sample) }
  if (format === "pdf") {
    return {
      ...base,
      kind: "pdf",
      lines: result.sample
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 60),
    }
  }
  if (SCIENTIFIC_FORMATS.has(format) || looksLikeScientificSummary(result.sample)) {
    return { ...base, kind: "scientific", cards: parseScientificCards(result.sample), body: result.sample }
  }
  if (STRUCTURE_FORMATS.has(format)) {
    return { ...base, kind: "structure", lines: result.sample.split("\n").slice(0, 120) }
  }
  return { ...base, kind: "text", body: result.sample, lines: result.sample.split("\n").slice(0, 160) }
}

export function formatLabel(format: string) {
  const labels: Record<string, string> = {
    csv: "CSV 表格",
    tsv: "TSV 表格",
    xlsx: "Excel 表格",
    json: "JSON",
    jsonl: "JSON Lines",
    ndjson: "JSON Lines",
    fasta: "FASTA 序列",
    fa: "FASTA 序列",
    fna: "FASTA 序列",
    faa: "FASTA 序列",
    fastq: "FASTQ 序列",
    fq: "FASTQ 序列",
    pdf: "PDF 文本",
    pdb: "PDB 结构",
    cif: "CIF 结构",
    mmcif: "mmCIF 结构",
    xyz: "XYZ 结构",
    extxyz: "EXTXYZ 结构",
    sdf: "SDF 分子",
    mol: "MOL 分子",
    nc: "NetCDF",
    nc4: "NetCDF",
    netcdf: "NetCDF",
    h5: "HDF5",
    hdf5: "HDF5",
    npy: "NumPy",
    npz: "NumPy Archive",
    mat: "MATLAB",
    zarr: "Zarr",
    directory: "目录",
    table: "数据表",
    txt: "文本",
  }
  return labels[format] || format.toUpperCase()
}

function formatPreviewCell(value: unknown) {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value)
  if (value instanceof Date) return value.toISOString()
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function guessFormat(path: string) {
  const leaf = path.split("/").filter(Boolean).at(-1) || ""
  const ext = leaf.includes(".") ? leaf.split(".").pop()?.toLowerCase() : ""
  return ext || ""
}

function parseTable(sample: string, format: string) {
  const delimiter = format === "csv" ? "," : detectDelimiter(sample)
  const lines = sample
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(0, 41)
  if (lines.length === 0) return { headers: [] as string[], rows: [] as string[][] }
  const cells = lines.map((line) => splitRow(line, delimiter))
  const width = Math.min(Math.max(...cells.map((row) => row.length), 1), 12)
  const normalize = (row: string[]) => Array.from({ length: width }, (_, i) => row[i] ?? "")
  return { headers: normalize(cells[0]!), rows: cells.slice(1, 21).map(normalize) }
}

function detectDelimiter(sample: string) {
  const first = sample.split(/\r?\n/).find((line) => line.trim()) || ""
  const tabs = (first.match(/\t/g) || []).length
  const commas = (first.match(/,/g) || []).length
  return tabs >= commas ? "\t" : ","
}

function splitRow(line: string, delimiter: string) {
  if (delimiter === "\t") return line.split("\t")
  const out: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i += 1
      } else inQuotes = !inQuotes
      continue
    }
    if (ch === delimiter && !inQuotes) {
      out.push(cur)
      cur = ""
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out
}

function prettyJson(sample: string) {
  try {
    return JSON.stringify(JSON.parse(sample), null, 2)
  } catch {
    return sample
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 30)
      .map((line) => {
        try {
          return JSON.stringify(JSON.parse(line), null, 2)
        } catch {
          return line
        }
      })
      .join("\n\n")
  }
}

function parseFasta(sample: string) {
  const sequences: Array<{ header: string; sequence: string }> = []
  let header = ""
  let seq: string[] = []
  for (const line of sample.split(/\r?\n/)) {
    if (line.startsWith(">")) {
      if (header || seq.length) sequences.push({ header: header || "sequence", sequence: seq.join("") })
      if (sequences.length >= 8) break
      header = line.slice(1).trim() || "sequence"
      seq = []
      continue
    }
    if (line.trim()) seq.push(line.trim())
  }
  if ((header || seq.length) && sequences.length < 8) {
    sequences.push({ header: header || "sequence", sequence: seq.join("") })
  }
  return sequences
}

function parseFastq(sample: string) {
  const lines = sample.split(/\r?\n/)
  const sequences: Array<{ header: string; sequence: string }> = []
  for (let i = 0; i + 1 < lines.length && sequences.length < 8; i += 4) {
    const header = (lines[i] || "").replace(/^@/, "").trim() || "read"
    const sequence = (lines[i + 1] || "").trim()
    if (sequence) sequences.push({ header, sequence })
  }
  return sequences
}

function looksLikeScientificSummary(sample: string) {
  return /^(netcdf|hdf5|npy|npz|mat variables):/im.test(sample) || /\bshape=\(/i.test(sample)
}

function parseScientificCards(sample: string) {
  return sample
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(0, 40)
    .map((line) => {
      const indexed = line.match(/^\s*(.+?):\s*(.+)$/)
      if (indexed) return { label: indexed[1]!.trim(), value: indexed[2]!.trim() }
      return { label: "", value: line.trim() }
    })
}
