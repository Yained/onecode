import { marked, type Tokens } from "marked"

const WEB_SCHEME = /^(https?|mailto|tel|javascript|data):/i

function isWorkspaceFileHref(href: string) {
  const value = href.trim()
  if (!value || value.startsWith("#") || WEB_SCHEME.test(value)) return false
  return true
}

function normalizeWorkspaceFileHref(href: string) {
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

function escapeHtmlAttr(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function renderMarkdownFileLink(href: string, text: string, title?: string) {
  const path = normalizeWorkspaceFileHref(href)
  const titleAttr = title ? ` title="${escapeHtmlAttr(title)}"` : ""
  return `<a href="${escapeHtmlAttr(href)}"${titleAttr} class="file-link" data-file-path="${escapeHtmlAttr(path)}">${text}</a>`
}

const renderer = new marked.Renderer()

renderer.link = ({ href, title, text }: Tokens.Link) => {
  if (isWorkspaceFileHref(href)) return renderMarkdownFileLink(href, text, title ?? undefined)
  const titleAttr = title ? ` title="${title}"` : ""
  return `<a href="${href}"${titleAttr} class="external-link" target="_blank" rel="noopener noreferrer">${text}</a>`
}

export function parseMarkdown(input: string) {
  return marked(input, {
    renderer,
    breaks: false,
    gfm: true,
  })
}
