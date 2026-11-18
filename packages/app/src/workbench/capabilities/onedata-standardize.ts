/** Build the session handoff prompt for Raw → AI Ready standardization. */

export function sanitizeDatasetSlug(name: string) {
  return name
    .trim()
    .replace(/[^\w.\u4e00-\u9fff-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

/** Suggest an AI Ready output path next to the raw source (or under onedata/ for remote URIs). */
export function suggestAiReadyTargetDir(sourceDir: string, name: string) {
  const trimmed = sourceDir.trim().replace(/\/+$/, "")
  const slug = sanitizeDatasetSlug(name) || "dataset"
  if (/^(https?|s3|oss|cos):\/\//i.test(trimmed)) return `onedata/ai-ready/${slug}`

  const parts = trimmed.split(/[/\\]/)
  const leaf = parts.at(-1) ?? ""
  const looksFile = /\.[A-Za-z0-9]+$/.test(leaf)
  if (looksFile) {
    const stem = leaf.replace(/\.[A-Za-z0-9]+$/, "")
    const parent = parts.slice(0, -1).join("/")
    return parent ? `${parent}/${stem}-ai-ready` : `${stem}-ai-ready`
  }
  return `${trimmed}-ai-ready`
}

export function buildStandardizeHandoffPrompt(input: {
  name: string
  sourceDir: string
  targetDir: string
}) {
  return [
    "请使用OneScience技能对原始数据进行数据标准化处理。",
    "",
    `数据集名称：${input.name}`,
    `source dir（原始数据）：${input.sourceDir}`,
    `target dir（AI Ready）：${input.targetDir}`,
    "",
    "从 source dir 读取，标准化后写入 target dir。",
    "完成后调用 dataset_report，只传：name（数据集名称）、target_dir（上面的 AI Ready 路径）。",
    "dataset_report 成功后，再调用 register_dataset_primitive，传入 already_id（返回的 alr_*），可选填 title/description/data_schema/usage_notes。",
    "source 已绑定到本会话，血缘会自动挂上；不要写 .onescience/already.json。",
  ].join("\n")
}

export function trainTargetLabel(target: "local" | "workspace" | "shared_root") {
  if (target === "workspace") return "已连接的远端"
  if (target === "shared_root") return "平台共享盘"
  return "当前执行环境"
}

const domainLabel: Record<string, string> = {
  materials: "材料",
  weather: "地球",
  fluid: "流体",
  bio: "生命",
}

export function trainableModelLabel(input: { name: string; domain: string }, showDomain: boolean) {
  if (showDomain) return `${domainLabel[input.domain] ?? input.domain} · ${input.name}`
  return input.name
}

/** Keyword match: every whitespace-separated token must appear in name/id/tags/blurb/domain. */
export function matchTrainableModel(
  item: { id: string; name: string; domain: string; tags: string[]; blurb: string },
  query: string,
  showDomain: boolean,
) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack = [
    item.name,
    item.id,
    item.blurb,
    domainLabel[item.domain] ?? item.domain,
    item.domain,
    trainableModelLabel(item, showDomain),
    ...item.tags,
  ]
    .join(" ")
    .toLowerCase()
  return q.split(/\s+/).every((token) => haystack.includes(token))
}

export function buildTrainWithModelHandoffPrompt(input: {
  alreadyName: string
  alreadyId: string
  dataUri: string
  modelName: string
  modelId: string
  scenarioTitle?: string
  scenarioSummary?: string
  target: "local" | "workspace" | "shared_root"
  workspaceId?: string
}) {
  const lines = [
    "请使用OneScience技能，结合选定模型与可训练数据执行训练。",
    "",
    `模型：${input.modelName}（${input.modelId}）`,
  ]
  if (input.scenarioTitle) {
    lines.push(`场景：${input.scenarioTitle}`)
    if (input.scenarioSummary) lines.push(`场景说明：${input.scenarioSummary}`)
  }
  lines.push(
    `数据集名称：${input.alreadyName}`,
    `可训练数据 ID：${input.alreadyId}`,
    `数据路径：${input.dataUri}`,
    `训练位置：${trainTargetLabel(input.target)}`,
  )
  if (input.target === "workspace" && input.workspaceId) {
    lines.push(`远端环境：${input.workspaceId}`)
  }
  lines.push(
    "",
    "请按该模型的训练流程配置并执行；引用数据时使用上面的可训练数据 ID（datasetRefs）。",
  )
  return lines.join("\n")
}
