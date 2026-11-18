import { authenticatedFetch } from "@/utils/authenticated-fetch"

export type ResourceDomainCounts = Record<string, number>
export type ResourceCustomCounts = {
  datasets: number
  models: number
  apps: number
  frameworks: number
  byDomain: {
    datasets: ResourceDomainCounts
    models: ResourceDomainCounts
    apps: ResourceDomainCounts
    frameworks: ResourceDomainCounts
  }
}
export type CatalogMetrics = ResourceCustomCounts & { callablePrimitives: number }

function normalizeResourceCustomCounts(value: Partial<ResourceCustomCounts> & { callablePrimitives?: number }): ResourceCustomCounts {
  return {
    datasets: Number(value.datasets) || 0,
    models: Number(value.models) || 0,
    apps: Number(value.apps) || 0,
    frameworks: Number(value.frameworks) || 0,
    byDomain: {
      datasets: value.byDomain?.datasets ?? {},
      models: value.byDomain?.models ?? {},
      apps: value.byDomain?.apps ?? {},
      frameworks: value.byDomain?.frameworks ?? {},
    },
  }
}

const catalogMetricsStorageMaxAge = 5 * 60 * 1000

let resourceCustomCountsCache: { serverUrl: string; value: ResourceCustomCounts } | undefined
let catalogMetricsCache: { serverUrl: string; value: CatalogMetrics } | undefined
const catalogMetricsInflight = new Map<string, Promise<CatalogMetrics | undefined>>()

function oneScienceApiBaseUrl(serverUrl: string) {
  try {
    return new URL(serverUrl).toString().replace(/\/$/, "")
  } catch {
    return serverUrl.replace(/\/$/, "")
  }
}

function catalogMetricsStorageKey(serverUrl: string) {
  return `onescience:catalog-metrics:${oneScienceApiBaseUrl(serverUrl)}`
}

export function readCatalogMetricsCache(serverUrl: string) {
  if (typeof sessionStorage === "undefined") return undefined
  try {
    const raw = sessionStorage.getItem(catalogMetricsStorageKey(serverUrl))
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as { time: number; value: CatalogMetrics }
    if (Date.now() - parsed.time > catalogMetricsStorageMaxAge) return undefined
    const counts = normalizeResourceCustomCounts(parsed.value)
    return { ...counts, callablePrimitives: Number(parsed.value.callablePrimitives) || 0 }
  } catch {
    return undefined
  }
}

function writeCatalogMetricsCache(serverUrl: string, value: CatalogMetrics) {
  if (typeof sessionStorage === "undefined") return
  try {
    sessionStorage.setItem(catalogMetricsStorageKey(serverUrl), JSON.stringify({ time: Date.now(), value }))
  } catch {
    return
  }
}

export function storeCatalogMetricsCache(serverUrl: string, value: CatalogMetrics) {
  const base = oneScienceApiBaseUrl(serverUrl)
  const normalized = {
    ...normalizeResourceCustomCounts(value),
    callablePrimitives: Number(value.callablePrimitives) || 0,
  }
  catalogMetricsCache = { serverUrl: base, value: normalized }
  resourceCustomCountsCache = { serverUrl: base, value: normalizeResourceCustomCounts(normalized) }
  writeCatalogMetricsCache(serverUrl, normalized)
}

export function invalidateCatalogMetricsCache() {
  resourceCustomCountsCache = undefined
  catalogMetricsCache = undefined
  catalogMetricsInflight.clear()
  if (typeof sessionStorage !== "undefined") {
    try {
      for (const key of Object.keys(sessionStorage)) {
        if (key.startsWith("onescience:catalog-metrics:")) sessionStorage.removeItem(key)
      }
    } catch {
      // ignore storage failures
    }
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("onescience:catalog-metrics-invalidated"))
  }
}

async function fetchCatalogMetricsFromNetwork(base: string, serverUrl: string) {
  try {
    const response = await authenticatedFetch(`${base}/experimental/onescience/catalog-metrics`)
    if (!response.ok) return undefined
    const raw = await response.json() as CatalogMetrics
    const value = {
      ...normalizeResourceCustomCounts(raw),
      callablePrimitives: Number(raw.callablePrimitives) || 0,
    }
    catalogMetricsCache = { serverUrl: base, value }
    resourceCustomCountsCache = { serverUrl: base, value: normalizeResourceCustomCounts(value) }
    writeCatalogMetricsCache(serverUrl, value)
    return value
  } catch {
    return undefined
  }
}

export async function fetchCatalogMetrics(serverUrl: string, input?: { refresh?: boolean }) {
  const base = oneScienceApiBaseUrl(serverUrl)
  if (!input?.refresh && catalogMetricsCache?.serverUrl === base) {
    return catalogMetricsCache.value
  }

  const inflight = catalogMetricsInflight.get(base)
  if (inflight) return inflight

  const promise = fetchCatalogMetricsFromNetwork(base, serverUrl).finally(() => {
    if (catalogMetricsInflight.get(base) === promise) {
      catalogMetricsInflight.delete(base)
    }
  })
  catalogMetricsInflight.set(base, promise)
  return promise
}

export async function fetchResourceCustomCounts(serverUrl: string) {
  const base = oneScienceApiBaseUrl(serverUrl)
  if (resourceCustomCountsCache?.serverUrl === base) return resourceCustomCountsCache.value
  const metrics = await fetchCatalogMetrics(serverUrl)
  if (!metrics) return undefined
  return normalizeResourceCustomCounts(metrics)
}
