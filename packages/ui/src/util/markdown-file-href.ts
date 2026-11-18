const WEB_SCHEME = /^(https?|mailto|tel|javascript|data):/i

export function isWorkspaceFileHref(href: string) {
  const value = href.trim()
  if (!value) return false
  if (value.startsWith("#")) return false
  if (WEB_SCHEME.test(value)) return false
  if (/^file:/i.test(value)) return true
  return true
}

export function normalizeWorkspaceFileHref(href: string) {
  const value = href.trim()
  if (!value) return ""
  if (/^file:\/\//i.test(value)) {
    try {
      return decodeURIComponent(value.slice("file://".length).replace(/^\/([A-Za-z]):\//, "$1:/"))
    } catch {
      return value.slice("file://".length)
    }
  }
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function looksLikeFilePathCode(text: string) {
  const value = text.trim().replace(/[),.;!?]+$/, "")
  if (!value || value.length > 260) return false
  if (/\s/.test(value)) return false
  if (WEB_SCHEME.test(value) || value.startsWith("#")) return false
  if (/[\\/]/.test(value)) return value
  if (/\.[A-Za-z0-9]{1,12}$/.test(value)) return value
  return false
}

export function escapeHtmlAttr(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

export function renderMarkdownFileLink(href: string, text: string, title?: string) {
  const path = normalizeWorkspaceFileHref(href)
  const titleAttr = title ? ` title="${escapeHtmlAttr(title)}"` : ""
  return `<a href="${escapeHtmlAttr(href)}"${titleAttr} class="file-link" data-file-path="${escapeHtmlAttr(path)}">${text}</a>`
}
