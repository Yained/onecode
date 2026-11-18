export type ScienceMetricRow = {
  name: string
  value: string
  unit?: string
  baseline?: string
  delta?: string
}

export type ScienceArtifactRef = {
  path: string
  label?: string
  script?: string
  url?: string
}

export type ScienceReport = {
  title?: string
  domain?: string
  status?: "passed" | "warning" | "failed"
  metrics: ScienceMetricRow[]
  artifacts?: ScienceArtifactRef[]
  summary?: string
}

export type ScienceTextSegment =
  | { type: "markdown"; text: string }
  | { type: "science"; report: ScienceReport }

const OS_SCIENCE_BLOCK = /```os-science\s*\n([\s\S]*?)```/g

function metricValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value === "string" && value.trim()) return value.trim()
  return undefined
}

function metricRow(input: unknown): ScienceMetricRow | undefined {
  if (!input || typeof input !== "object") return undefined
  const row = input as Record<string, unknown>
  const name = typeof row.name === "string" ? row.name.trim() : undefined
  const value = metricValue(row.value)
  if (!name || !value) return undefined
  const unit = typeof row.unit === "string" && row.unit.trim() ? row.unit.trim() : undefined
  const baseline = metricValue(row.baseline)
  const delta = metricValue(row.delta)
  return {
    name,
    value,
    ...(unit ? { unit } : {}),
    ...(baseline ? { baseline } : {}),
    ...(delta ? { delta } : {}),
  }
}

function artifactRef(input: unknown): ScienceArtifactRef | undefined {
  if (!input || typeof input !== "object") return undefined
  const row = input as Record<string, unknown>
  const path = typeof row.path === "string" ? row.path.trim() : undefined
  if (!path) return undefined
  const label = typeof row.label === "string" && row.label.trim() ? row.label.trim() : undefined
  const script = typeof row.script === "string" && row.script.trim() ? row.script.trim() : undefined
  return {
    path,
    ...(label ? { label } : {}),
    ...(script ? { script } : {}),
  }
}

export function parseScienceReport(input: unknown): ScienceReport | undefined {
  if (!input || typeof input !== "object") return undefined
  const raw = input as Record<string, unknown>
  const metrics = Array.isArray(raw.metrics)
    ? raw.metrics.flatMap((item) => {
        const row = metricRow(item)
        return row ? [row] : []
      })
    : []
  if (metrics.length === 0) return undefined

  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : undefined
  const domain = typeof raw.domain === "string" && raw.domain.trim() ? raw.domain.trim() : undefined
  const summary = typeof raw.summary === "string" && raw.summary.trim() ? raw.summary.trim() : undefined
  const status =
    raw.status === "passed" || raw.status === "warning" || raw.status === "failed" ? raw.status : undefined
  const artifacts = Array.isArray(raw.artifacts)
    ? raw.artifacts.flatMap((item) => {
        const ref = artifactRef(item)
        return ref ? [ref] : []
      })
    : undefined

  return {
    metrics,
    ...(title ? { title } : {}),
    ...(domain ? { domain } : {}),
    ...(summary ? { summary } : {}),
    ...(status ? { status } : {}),
    ...(artifacts?.length ? { artifacts } : {}),
  }
}

export function parseScienceReportJson(text: string) {
  const trimmed = text.trim()
  if (!trimmed.startsWith("{")) return undefined
  try {
    return parseScienceReport(JSON.parse(trimmed))
  } catch {
    return undefined
  }
}

export function splitScienceText(text: string): ScienceTextSegment[] {
  const segments: ScienceTextSegment[] = []
  let lastIndex = 0
  for (const match of text.matchAll(OS_SCIENCE_BLOCK)) {
    const index = match.index ?? 0
    const before = text.slice(lastIndex, index).trim()
    if (before) segments.push({ type: "markdown", text: before })
    const report = parseScienceReportJson(match[1] ?? "")
    if (report) segments.push({ type: "science", report })
    else if (match[0].trim()) segments.push({ type: "markdown", text: match[0].trim() })
    lastIndex = index + match[0].length
  }
  const rest = text.slice(lastIndex).trim()
  if (rest) segments.push({ type: "markdown", text: rest })
  return segments.length > 0 ? segments : [{ type: "markdown", text }]
}

const METRIC_LINE =
  /^(?<name>[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff /.-]{0,48})\s*[:=]\s*(?<value>-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)(?:\s*(?<unit>[A-Za-z%/°]+))?$/i

const TABLE_HEADER = /^\|\s*(?:var|variable|变量|metric|指标)/i

export function parseScienceMetricsFromOutput(text: string): ScienceReport | undefined {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  const metrics: ScienceMetricRow[] = []
  let title: string | undefined

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (!title && /^#{1,3}\s+/.test(trimmed)) {
      title = trimmed.replace(/^#{1,3}\s+/, "").trim()
      continue
    }

    const direct = trimmed.match(METRIC_LINE)
    if (direct?.groups?.name && direct.groups.value) {
      metrics.push({
        name: direct.groups.name.trim(),
        value: direct.groups.value,
        ...(direct.groups.unit ? { unit: direct.groups.unit } : {}),
      })
      continue
    }

    if (TABLE_HEADER.test(trimmed)) continue

    const table = trimmed.match(/^\|\s*([^|]+?)\s*\|\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*(?:\|\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?))?\s*\|/)
    if (table?.[1] && table[2] && !table[1].includes("---")) {
      const name = table[1].trim()
      if (/^(var|variable|变量|metric|指标|name|rmse|mae)$/i.test(name)) continue
      metrics.push({
        name,
        value: table[2],
        ...(table[3] ? { baseline: table[3] } : {}),
      })
    }
  }

  if (metrics.length === 0) return undefined
  return { ...(title ? { title } : {}), metrics }
}

const SIZE_MULTIPLIERS: Record<string, number> = {
  "": 1,
  K: 1024,
  M: 1024 ** 2,
  G: 1024 ** 3,
  T: 1024 ** 4,
}

function parseDownloadSize(value: string, unit: string) {
  const amount = Number.parseFloat(value)
  if (!Number.isFinite(amount)) return 0
  const normalized = unit.toUpperCase().replace(/B$/, "")
  return Math.round(amount * (SIZE_MULTIPLIERS[normalized] ?? 1))
}

export type ModelScopeDownloadProgress = {
  downloaded: number
  total: number
  file?: string
  percent: number
}

function parseModelScopeDownloadLine(line: string): ModelScopeDownloadProgress | undefined {
  const clean = line.replace(/\u001b\[[0-9;]*m/g, "").trim()
  if (!clean.includes("/")) return undefined
  const size = clean.match(/([\d.]+)\s*([KMGTP]?B?)\s*\/\s*([\d.]+)\s*([KMGTP]?B?)/i)
  if (!size) return undefined
  const downloaded = parseDownloadSize(size[1], size[2])
  const total = parseDownloadSize(size[3], size[4])
  if (downloaded <= 0 && total <= 0) return undefined
  const percentMatch = clean.match(/(\d+(?:\.\d+)?)%/)
  const percent =
    percentMatch && Number.isFinite(Number.parseFloat(percentMatch[1]))
      ? Number.parseFloat(percentMatch[1])
      : total > 0
        ? Math.min(100, Math.round((downloaded / total) * 1000) / 10)
        : 0
  const bracket = clean.match(/Downloading\s*\[([^\]]+)\]:/i)
  const file =
    bracket?.[1]?.trim() ??
    clean.match(/^([^:\n]+):\s*(?:\d+\s*files:\s*)?\d/)?.[1]?.trim() ??
    clean.match(/^([^:\n]+):/)?.[1]?.trim()
  return {
    downloaded,
    total,
    percent,
    ...(file ? { file } : {}),
  }
}

export function parseModelScopeDownloadProgress(text: string): ModelScopeDownloadProgress | undefined {
  const lines = text.replace(/\u001b\[[0-9;]*m/g, "").replace(/\r/g, "\n").split("\n")
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsed = parseModelScopeDownloadLine(lines[index] ?? "")
    if (parsed) return parsed
  }
  return undefined
}

export function isModelScopeDownloadCommand(command: string | undefined) {
  if (!command) return false
  return /\bmodelscope\s+download\b/i.test(command)
}

const MARKDOWN_IMAGE_INLINE = /!\[([^\]]*)\]\(([^)]+)\)/g
const MARKDOWN_IMAGE_HTML = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*(?:\salt=["']([^"']*)["'])?[^>]*>/gi
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg)$/i
const IMAGE_SAVE_PATTERN =
  /(?:saved|wrote|written|output)(?:\s+\S+)*\s+to\s+['"]?([^\s'"]+\.(?:png|jpe?g|gif|webp|svg))['"]?/gi

function normalizeImagePath(path: string) {
  return path.replace(/^<|>$/g, "").replace(/^["']|["']$/g, "").trim()
}

export function isPlausibleImagePath(path: string | undefined) {
  if (!path) return false
  const normalized = normalizeImagePath(path)
  if (!normalized || normalized.includes("*") || normalized.includes("?")) return false
  if (!IMAGE_FILE.test(normalized)) return false
  if (normalized === "*.png" || normalized.endsWith("/*.png")) return false
  return true
}

function artifactPathKey(path: string) {
  return path.replace(/\\/g, "/").toLowerCase()
}

function pathsRelate(a: string | undefined, b: string | undefined) {
  if (!a || !b) return false
  const left = a.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
  const right = b.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
  if (left === right) return true
  const leftName = left.split("/").pop()
  const rightName = right.split("/").pop()
  if (leftName && rightName && leftName === rightName) return true
  return left.endsWith(`/${right}`) || right.endsWith(`/${left}`)
}

function pushMarkdownImage(out: ScienceArtifactRef[], seen: Set<string>, rawPath?: string, rawLabel?: string) {
  const path = normalizeImagePath(rawPath ?? "")
  if (!isPlausibleImagePath(path)) return
  const key = artifactPathKey(path)
  if (seen.has(key)) return
  seen.add(key)
  const label = rawLabel?.trim()
  out.push(label ? { path, label } : { path })
}

export function parseMarkdownImages(text: string | undefined): ScienceArtifactRef[] {
  if (!text) return []
  const out: ScienceArtifactRef[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(MARKDOWN_IMAGE_INLINE)) {
    pushMarkdownImage(out, seen, match[2], match[1])
  }
  for (const match of text.matchAll(MARKDOWN_IMAGE_HTML)) {
    pushMarkdownImage(out, seen, match[1], match[2])
  }
  return out
}

export function imagePathsFromText(text: string | undefined): ScienceArtifactRef[] {
  if (!text) return []
  const out: ScienceArtifactRef[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(IMAGE_SAVE_PATTERN)) {
    pushMarkdownImage(out, seen, match[1])
  }
  return out
}

export function stripMarkdownImages(text: string | undefined) {
  if (!text) return ""
  return text
    .replace(MARKDOWN_IMAGE_INLINE, "")
    .replace(MARKDOWN_IMAGE_HTML, "")
    .replace(/^\[[^\]]+\]:\s*\S+.*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function mergeScienceArtifacts(...groups: Array<ScienceArtifactRef[] | undefined>) {
  const out: ScienceArtifactRef[] = []
  for (const group of groups) {
    if (!group?.length) continue
    for (const item of group) {
      if (!item?.path) continue
      const existing = out.find((entry) => entry.path && pathsRelate(entry.path, item.path))
      if (existing) {
        if (!existing.label && item.label) existing.label = item.label
        if (!existing.script && item.script) existing.script = item.script
        if (!existing.url && item.url) existing.url = item.url
        continue
      }
      out.push({ ...item })
    }
  }
  return out
}

export function scienceImagesFromMessageParts(parts: Array<{ type: string; state?: { status?: string; attachments?: Array<{ mime: string; url?: string; filename?: string }>; input?: { filePath?: string }; output?: string } }>) {
  const out: ScienceArtifactRef[] = []
  const seen = new Set<string>()
  for (const part of parts) {
    if (part.type !== "tool") continue
    if (part.state?.status !== "completed") continue
    let imagePath: string | undefined
    const input = part.state.input
    if (input && typeof input.filePath === "string") imagePath = input.filePath
    if (!imagePath && part.state.output) imagePath = part.state.output.match(IMAGE_SAVE_PATTERN)?.[1]
    const attachments = part.state.attachments?.filter((file) => file.mime.startsWith("image/")) ?? []
    if (attachments.length) {
      for (const file of attachments) {
        const path = imagePath ?? (file.filename?.includes("/") ? file.filename : file.filename) ?? ""
        if (!path) continue
        const key = artifactPathKey(path)
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
          path,
          ...(file.filename ? { label: file.filename.split(/[/\\]/).pop() } : {}),
          ...(file.url ? { url: file.url } : {}),
        })
      }
      continue
    }
    if (imagePath && IMAGE_FILE.test(imagePath)) {
      const key = artifactPathKey(imagePath)
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ path: imagePath, label: imagePath.split(/[/\\]/).pop() })
    }
  }
  return out
}

export function reportForMetricsCard(report: ScienceReport): ScienceReport {
  return {
    title: report.title,
    domain: report.domain,
    status: report.status,
    summary: report.summary,
    metrics: report.metrics,
  }
}

export const ONESCIENCE_SKILL_LAYERS: Record<string, string> = {
  "onescience-workflow": "入口层",
  "onescience-role": "路由层",
  "onescience-skill": "技能层",
  "onescience-resources": "资源层",
  "onescience-coder": "编码层",
  "onescience-runtime": "运行层",
  "onescience-installer": "安装层",
}
