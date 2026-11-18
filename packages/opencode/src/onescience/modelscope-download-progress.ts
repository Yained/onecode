export type ModelScopeTqdmScope = "aggregate" | "single" | "per_file"

export type ModelScopeTqdmProgress = {
  file: string
  downloaded: number
  total: number
  complete: boolean
  scope: ModelScopeTqdmScope
}

export type ModelScopeCliProgressSnapshot = {
  downloaded_bytes: number
  current_file?: string
  current_file_bytes?: number
  current_file_total_bytes?: number
  last_line_at: number
}

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g

const SIZE_MULTIPLIERS: Record<string, number> = {
  "": 1,
  K: 1024,
  M: 1024 ** 2,
  G: 1024 ** 3,
  T: 1024 ** 4,
}

export function parseModelScopeSize(value: string, unit: string) {
  const amount = Number.parseFloat(value)
  if (!Number.isFinite(amount)) return 0
  const normalized = unit.toUpperCase().replace(/B$/, "")
  return Math.round(amount * (SIZE_MULTIPLIERS[normalized] ?? 1))
}

export function parseModelScopeTqdmLine(line: string): ModelScopeTqdmProgress | undefined {
  const clean = line.replace(ANSI_PATTERN, "").trim()
  if (!clean.includes("/")) return undefined

  const size = clean.match(/([\d.]+)\s*([KMGTP]?B?)\s*\/\s*([\d.]+)\s*([KMGTP]?B?)/i)
  if (!size) return undefined

  const isBracketDownload = /Downloading\s*\[[^\]]+\]:/i.test(clean)
  const isFetchingFiles = /^Fetching\s+\d+\s+files:/i.test(clean)
  const bracket = clean.match(/Downloading\s*\[([^\]]+)\]:/i)
  const file =
    bracket?.[1]?.trim() ??
    clean.match(/^([^:\n]+):\s*(?:\d+\s*files:\s*)?\d/)?.[1]?.trim() ??
    clean.match(/^([^:\n]+):/)?.[1]?.trim() ??
    "__download__"

  const scope: ModelScopeTqdmScope = isFetchingFiles
    ? "aggregate"
    : isBracketDownload
      ? "per_file"
      : "single"

  const downloaded = parseModelScopeSize(size[1], size[2])
  const total = parseModelScopeSize(size[3], size[4])
  const percentMatch = clean.match(/(\d+(?:\.\d+)?)%/)
  const percent = percentMatch ? Number.parseFloat(percentMatch[1]) : undefined
  const complete =
    percent !== undefined ? percent >= 100 : total > 0 && downloaded >= total

  return { file, downloaded, total, complete, scope }
}

export class ModelScopeCliProgressTracker {
  private files = new Map<string, number>()
  private totals = new Map<string, number>()
  private scopes = new Map<string, ModelScopeTqdmScope>()
  private lastFile?: string
  private lastLineAt = 0
  private buffer = ""

  private applyParsed(parsed: ModelScopeTqdmProgress) {
    this.lastFile = parsed.file
    this.lastLineAt = Date.now()
    this.totals.set(parsed.file, parsed.total)
    this.scopes.set(parsed.file, parsed.scope)
    const bytes = parsed.complete && parsed.total > 0 ? parsed.total : parsed.downloaded
    this.files.set(parsed.file, Math.max(this.files.get(parsed.file) ?? 0, bytes))
  }

  feed(text: string) {
    this.buffer += text
    const parts = this.buffer.split(/\r|\n/)
    this.buffer = parts.pop() ?? ""
    for (const raw of parts) {
      const parsed = parseModelScopeTqdmLine(raw)
      if (!parsed) continue
      this.applyParsed(parsed)
    }
  }

  flush() {
    if (!this.buffer) return
    const parsed = parseModelScopeTqdmLine(this.buffer)
    this.buffer = ""
    if (!parsed) return
    this.applyParsed(parsed)
  }

  hasProgress() {
    return this.lastLineAt > 0
  }

  progressTotalBytes() {
    this.flush()
    let aggregateTotal = 0
    let aggregateCount = 0
    for (const [file, total] of this.totals.entries()) {
      if (this.scopes.get(file) !== "aggregate" || total <= 0) continue
      aggregateTotal += total
      aggregateCount += 1
    }
    if (aggregateCount > 0) return aggregateTotal

    const singleEntries = [...this.totals.entries()].filter(([file, total]) => {
      return total > 0 && this.scopes.get(file) === "single"
    })
    if (singleEntries.length === 1) return singleEntries[0]![1]

    return undefined
  }

  snapshot(): ModelScopeCliProgressSnapshot {
    this.flush()
    let downloaded_bytes = 0
    for (const bytes of this.files.values()) downloaded_bytes += bytes

    const current_file = this.lastFile
    const current_file_bytes = current_file ? this.files.get(current_file) : undefined
    const current_file_total_bytes = current_file ? this.totals.get(current_file) : undefined

    return {
      downloaded_bytes,
      ...(current_file ? { current_file } : {}),
      ...(current_file_bytes !== undefined ? { current_file_bytes } : {}),
      ...(current_file_total_bytes !== undefined ? { current_file_total_bytes } : {}),
      last_line_at: this.lastLineAt,
    }
  }
}
