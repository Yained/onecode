export type FilePreviewKind = "html" | "markdown" | "csv" | "pdf" | "xyz" | "text"

export function isHtmlPath(path: string | undefined) {
  return !!path && /\.html?$/i.test(path)
}

export function isMarkdownPath(path: string | undefined) {
  return !!path && /\.md$/i.test(path)
}

export function isCsvPath(path: string | undefined) {
  return !!path && /\.csv$/i.test(path)
}

export function isPdfPath(path: string | undefined) {
  return !!path && /\.pdf$/i.test(path)
}

export function isXyzPath(path: string | undefined) {
  return !!path && /\.(?:xyz|extxyz)$/i.test(path)
}

export function filePreviewKind(path: string | undefined): FilePreviewKind {
  if (isHtmlPath(path)) return "html"
  if (isMarkdownPath(path)) return "markdown"
  if (isCsvPath(path)) return "csv"
  if (isPdfPath(path)) return "pdf"
  if (isXyzPath(path)) return "xyz"
  return "text"
}

/** Preview kinds that still expose an editable/plain source view. */
export function hasSourceToggle(kind: FilePreviewKind) {
  return kind === "html" || kind === "markdown" || kind === "csv" || kind === "xyz"
}
