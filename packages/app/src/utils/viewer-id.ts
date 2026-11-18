const STORAGE_KEY = "opencode.viewerID"

function createID() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `viewer_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`
}

export function getViewerID() {
  if (typeof sessionStorage === "undefined") return createID()
  const existing = sessionStorage.getItem(STORAGE_KEY)
  if (existing) return existing
  const next = createID()
  sessionStorage.setItem(STORAGE_KEY, next)
  return next
}
