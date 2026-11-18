const frontmatterOrder = ["name", "description", "layer", "tags", "references", "allowed-tools", "metadata"] as const

const frontmatterLabels: Record<string, string> = {
  name: "名称",
  description: "描述",
  tags: "标签",
  references: "引用资源",
  "allowed-tools": "可用工具",
  metadata: "元数据",
  layer: "分层",
}

export function skillFrontmatterLabel(key: string) {
  return frontmatterLabels[key] ?? key
}

export function skillFrontmatterEntries(data: Record<string, unknown>) {
  const keys = Object.keys(data)
  const ordered = [
    ...frontmatterOrder.filter((key) => keys.includes(key)),
    ...keys.filter((key) => !frontmatterOrder.includes(key as (typeof frontmatterOrder)[number])).sort(),
  ]
  return ordered.flatMap((key) => {
    const value = data[key]
    if (value === undefined || value === null || value === "") return []
    return [[key, value] as const]
  })
}

export function skillFrontmatterHasContent(data: Record<string, unknown> | undefined) {
  if (!data) return false
  return skillFrontmatterEntries(data).length > 0
}

export function formatSkillFrontmatterScalar(value: unknown) {
  if (typeof value === "boolean") return value ? "是" : "否"
  if (typeof value === "number") return String(value)
  if (typeof value === "string") return value
  return JSON.stringify(value, null, 2)
}

export function skillFrontmatterListItems(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (item === undefined || item === null || item === "") return []
    return [typeof item === "string" ? item : JSON.stringify(item)]
  })
}

export function skillFrontmatterNested(value: unknown) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return
  return JSON.stringify(value, null, 2)
}
