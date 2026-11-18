import { readFileSync } from "fs"
import { TextWriter, Uint8ArrayReader, ZipReader } from "@zip.js/zip.js"

const DEFAULT_MAX_ROWS = 40
const DEFAULT_MAX_BYTES = 64 * 1024

/** Turn the first worksheet of an .xlsx into a small TSV preview. */
export async function sampleXlsx(
  filePath: string,
  opts?: { maxRows?: number; maxBytes?: number },
): Promise<string | undefined> {
  const maxRows = opts?.maxRows ?? DEFAULT_MAX_ROWS
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES
  const bytes = new Uint8Array(readFileSync(filePath))
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return undefined

  const reader = new ZipReader(new Uint8ArrayReader(bytes))
  try {
    const entries = await reader.getEntries()
    const byName = new Map(entries.map((entry) => [entry.filename.replace(/^\/+/, ""), entry]))
    const sharedEntry = byName.get("xl/sharedStrings.xml")
    const sheetEntry =
      byName.get("xl/worksheets/sheet1.xml") ||
      entries.find((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.filename.replace(/^\/+/, "")))
    if (!sheetEntry?.getData) return undefined

    const shared = sharedEntry?.getData
      ? parseSharedStrings(await sharedEntry.getData(new TextWriter()))
      : []
    const sheetXml = await sheetEntry.getData(new TextWriter())
    const text = sheetToTsv(sheetXml, shared, maxRows)
    if (!text.trim()) return undefined
    return text.length > maxBytes ? `${text.slice(0, maxBytes)}\n…` : text
  } finally {
    await reader.close()
  }
}

function parseSharedStrings(xml: string) {
  const out: string[] = []
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)) {
    const parts = [...match[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((item) => decodeXml(item[1] ?? ""))
    out.push(parts.join(""))
  }
  return out
}

function sheetToTsv(xml: string, shared: string[], maxRows: number) {
  const rows: string[] = []
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    if (rows.length >= maxRows) break
    const cells = new Map<number, string>()
    let maxCol = -1
    for (const cell of rowMatch[1]!.matchAll(/<c\b([^>\/]*)(?:\/>|>([\s\S]*?)<\/c>)/gi)) {
      const attrs = cell[1] ?? ""
      const body = cell[2] ?? ""
      const ref = /\br="([A-Z]+)(\d+)"/i.exec(attrs)
      const col = ref ? columnIndex(ref[1]!) : maxCol + 1
      const type = /\bt="([^"]+)"/i.exec(attrs)?.[1]
      cells.set(col, cellValue(type, body, shared))
      if (col > maxCol) maxCol = col
    }
    const line: string[] = []
    for (let i = 0; i <= maxCol; i++) line.push(cells.get(i) ?? "")
    rows.push(line.join("\t"))
  }
  return rows.join("\n")
}

function cellValue(type: string | undefined, body: string, shared: string[]) {
  if (type === "s") {
    const index = Number(/<v\b[^>]*>([^<]*)<\/v>/i.exec(body)?.[1])
    return Number.isInteger(index) ? (shared[index] ?? "") : ""
  }
  if (type === "inlineStr" || type === "str") {
    return [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((item) => decodeXml(item[1] ?? "")).join("")
  }
  if (type === "b") {
    const raw = /<v\b[^>]*>([^<]*)<\/v>/i.exec(body)?.[1] ?? ""
    return raw === "1" ? "TRUE" : raw === "0" ? "FALSE" : raw
  }
  return /<v\b[^>]*>([^<]*)<\/v>/i.exec(body)?.[1] ?? ""
}

function columnIndex(letters: string) {
  let value = 0
  for (const ch of letters.toUpperCase()) {
    value = value * 26 + (ch.charCodeAt(0) - 64)
  }
  return value - 1
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&")
}
