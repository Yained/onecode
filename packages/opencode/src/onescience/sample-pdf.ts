import { spawnSync } from "child_process"
import { inflateSync } from "zlib"
import { readFileSync } from "fs"

const DEFAULT_MAX_BYTES = 64 * 1024
const DEFAULT_MAX_PAGES = 5

/** Extract a short text preview from a PDF (pdftotext when available, else a lightweight fallback). */
export function samplePdf(
  filePath: string,
  opts?: { maxBytes?: number; maxPages?: number },
): string | undefined {
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES
  const maxPages = opts?.maxPages ?? DEFAULT_MAX_PAGES
  const fromTool = sampleWithPdftotext(filePath, maxPages)
  const text = (fromTool ?? sampleWithEmbeddedStrings(filePath))?.replace(/\f/g, "\n").trim()
  if (!text) return undefined
  return text.length > maxBytes ? `${text.slice(0, maxBytes)}\n…` : text
}

function sampleWithPdftotext(filePath: string, maxPages: number) {
  try {
    const result = spawnSync(
      "pdftotext",
      ["-f", "1", "-l", String(maxPages), "-nopgbrk", "-q", filePath, "-"],
      { encoding: "utf8", maxBuffer: DEFAULT_MAX_BYTES * 2, timeout: 8_000 },
    )
    if (result.status !== 0) return
    const text = result.stdout?.trim()
    return text || undefined
  } catch {
    return
  }
}

function sampleWithEmbeddedStrings(filePath: string) {
  const bytes = readFileSync(filePath)
  if (bytes.length < 5 || bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return

  const chunks: string[] = []
  const latin = bytes.toString("latin1")
  for (const match of latin.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const raw = Buffer.from(match[1]!, "latin1")
    const decoded = tryInflate(raw) ?? raw
    const content = decoded.toString("latin1")
    for (const token of content.matchAll(/\((?:\\.|[^\\)])*\)/g)) {
      const value = unescapePdfString(token[0]!.slice(1, -1))
      if (value.trim()) chunks.push(value)
    }
    for (const token of content.matchAll(/\[(.*?)\]\s*TJ/gs)) {
      for (const part of token[1]!.matchAll(/\((?:\\.|[^\\)])*\)/g)) {
        const value = unescapePdfString(part[0]!.slice(1, -1))
        if (value.trim()) chunks.push(value)
      }
    }
    if (chunks.join("").length >= DEFAULT_MAX_BYTES) break
  }
  const joined = chunks.join("").replace(/[^\S\n]+/g, " ").trim()
  return joined || undefined
}

function tryInflate(raw: Buffer) {
  try {
    return inflateSync(raw)
  } catch {
    try {
      return inflateSync(raw.subarray(2))
    } catch {
      return
    }
  }
}

function unescapePdfString(value: string) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\([()\\])/g, "$1")
    .replace(/\\(\d{1,3})/g, (_, digits) => String.fromCharCode(Number.parseInt(digits, 8)))
}
