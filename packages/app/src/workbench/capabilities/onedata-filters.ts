import type { CapabilityDomainSelection } from "./selection"

export const capabilityDomainToDatasetFilter: Record<CapabilityDomainSelection, string> = {
  all: "全部",
  weather: "地球科学",
  materials: "材料化学",
  bio: "生命科学",
  fluid: "流体仿真",
}

export type RawConnector = "local_fs" | "http_dataset" | "database" | "remote_workspace"

export function connectorLabel(connector: string): string {
  switch (connector) {
    case "local_fs":
      return "工作区"
    case "http_dataset":
      return "公开网址"
    case "database":
      return "数据库"
    case "remote_workspace":
      return "远端环境"
    case "onedata_ref":
      return "公开数据引用"
    default:
      return "其他"
  }
}

export function alreadyStatusLabel(status: string): string {
  return status === "ready" ? "可训练" : "未就绪"
}

/** Mirror backend canPublishConnector: local_fs + http_dataset only; database / object-store URI blocked. */
export function publishBlockedReason(item: { connector?: string; uri: string }): string | undefined {
  if (item.connector === "remote_workspace") {
    return "远端环境上的数据不能发布；请先落到工作区路径后再发布。"
  }
  if (item.connector === "onedata_ref") {
    return "从公开 OneData 拉回的引用不能直接发布；请对话加工成新的可训练数据后再发布。"
  }
  if (item.connector === "database" || /^(postgres|mysql):\/\//i.test(item.uri)) {
    return "数据库表不能直接发布；请先转化为可训练数据或落到工作区路径后再发布。"
  }
  if (item.connector === "object_store" || /^(s3|oss|cos):\/\//i.test(item.uri)) {
    return "对象存储路径不能直接发布；请使用工作区路径或公开网址。"
  }
  if (item.connector === "local_fs" || item.connector === "http_dataset" || !item.connector) return undefined
  return "当前数据来源不支持发布；请使用工作区路径或公开网址的可训练数据。"
}

export function canPublishAlreadyItem(item: { connector?: string; uri: string; status: string }) {
  if (item.status !== "ready") return false
  return !publishBlockedReason(item)
}

export function inferConnector(uri: string): RawConnector | undefined {
  const value = uri.trim().toLowerCase()
  if (value.startsWith("http://") || value.startsWith("https://")) return "http_dataset"
  if (value.startsWith("postgres://") || value.startsWith("mysql://")) return "database"
  return undefined
}

export function connectorPlaceholder(connector: RawConnector): string {
  switch (connector) {
    case "local_fs":
      return "服务器上可访问的绝对路径（账号工作区或其他有权限的目录）"
    case "http_dataset":
      return "公开可访问的网址"
    case "database":
      return "已连接数据库中的表"
    case "remote_workspace":
      return "已连接远端机器上的文件路径"
  }
}

/** Absolute server path used after uploading browser-local files into the workspace. */
export function workspaceUploadRegisterUri(directory: string, relativePaths: string[]) {
  const options = workspaceUploadRegisterOptions(directory, relativePaths)
  return options[0]?.uri ?? ""
}

export type WorkspaceUploadRegisterOption = {
  kind: "folder" | "file"
  label: string
  uri: string
}

/** Prefer registering the common folder; also expose per-file targets when a folder was uploaded. */
export function workspaceUploadRegisterOptions(directory: string, relativePaths: string[]) {
  const absolute = relativePaths
    .map((item) => item.replace(/\\/g, "/").trim())
    .filter((item) => item.startsWith("/") || /^[a-zA-Z]:\//.test(item))
  if (absolute.length > 0 && absolute.length === relativePaths.length) {
    if (absolute.length === 1) {
      const uri = absolute[0]!
      return [{ kind: "file" as const, label: uri.split("/").filter(Boolean).at(-1) || uri, uri }]
    }
    const root = commonAbsoluteDirectory(absolute)
    const files = absolute.slice(0, 50).map((uri) => ({
      kind: "file" as const,
      label: uri,
      uri,
    }))
    if (!root) return files
    return [{ kind: "folder" as const, label: root, uri: root }, ...files]
  }

  const base = directory.replace(/\/+$/, "")
  const normalized = relativePaths
    .map((item) => item.replace(/\\/g, "/").replace(/^\/+/, ""))
    .filter(Boolean)
  if (normalized.length === 0) return [] as WorkspaceUploadRegisterOption[]
  if (normalized.length === 1) {
    return [{ kind: "file" as const, label: normalized[0]!, uri: `${base}/${normalized[0]}` }]
  }
  const root = commonRelativeDirectory(normalized)
  const files = normalized.slice(0, 50).map((item) => ({
    kind: "file" as const,
    label: item,
    uri: `${base}/${item}`,
  }))
  if (!root) return files
  return [{ kind: "folder" as const, label: root, uri: `${base}/${root}` }, ...files]
}

function commonAbsoluteDirectory(paths: string[]) {
  const relative = commonRelativeDirectory(paths.map((item) => item.replace(/^\/+/, "")))
  return relative ? `/${relative}` : undefined
}

function commonRelativeDirectory(paths: string[]) {
  const parts = paths.map((item) => item.split("/").filter(Boolean))
  const first = parts[0]
  if (!first || first.length === 0) return
  let depth = 0
  while (depth < first.length - 1) {
    const part = first[depth]
    if (!parts.every((item) => item[depth] === part)) break
    depth += 1
  }
  if (depth === 0) return
  return first.slice(0, depth).join("/")
}

export function formatDataSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
