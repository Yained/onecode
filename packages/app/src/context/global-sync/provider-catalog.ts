/** Keep a warm catalog for an hour so opening the picker does not re-download multi-MB JSON. */
export const PROVIDER_CATALOG_STALE_MS = 60 * 60 * 1000

/** Picker used to paint in ~5s. Never block the dialog on a hung instance /provider. */
export const PROVIDER_CATALOG_WAIT_MS = 8_000

export function providerCatalogStaleTime(allLength: number | undefined) {
  // An empty success (login race / auth not attached yet) must not sit warm for an hour.
  return allLength ? PROVIDER_CATALOG_STALE_MS : 0
}

/** Resolve when the catalog arrives, or give up so the picker can show a list/empty state. */
export function raceProviderCatalogWait<T>(promise: Promise<T>, waitMs = PROVIDER_CATALOG_WAIT_MS): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(undefined), waitMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export function shouldJoinProviderCatalogFetch(input: {
  force?: boolean
  hasCatalog: boolean
  fetching: boolean
}) {
  if (input.force) return false
  return input.hasCatalog || input.fetching
}

/** Toast only when this click started a slow fetch — not when login's silent prefetch is already running. */
export function shouldToastProviderCatalog(input: {
  silent?: boolean
  force?: boolean
  hasCatalog: boolean
  fetching: boolean
}) {
  if (input.silent) return false
  if (input.force) return true
  if (input.hasCatalog) return false
  if (input.fetching) return false
  return true
}

export function isProviderCatalogLoading(input: {
  allLength: number
  fetching: boolean
}) {
  if (input.allLength > 0) return false
  return input.fetching
}
