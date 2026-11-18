const STALE_CHUNK_RELOAD_KEY = "onescience:stale-chunk-reload"

export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    message.includes("error loading dynamically imported module")
  )
}

/** Reload once per tab session when a hashed JS chunk 404s after deploy. */
export function reloadOnceForStaleChunk(): boolean {
  if (typeof window === "undefined" || typeof sessionStorage === "undefined") return false
  try {
    if (sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY) === "1") return false
    sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, "1")
  } catch {
    // sessionStorage may be blocked; still attempt a single reload via location.
  }
  window.location.reload()
  return true
}
