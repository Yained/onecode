import { describe, expect, test } from "bun:test"
import {
  PROVIDER_CATALOG_STALE_MS,
  isProviderCatalogLoading,
  providerCatalogStaleTime,
  raceProviderCatalogWait,
  shouldJoinProviderCatalogFetch,
  shouldToastProviderCatalog,
} from "./provider-catalog"

describe("providerCatalogStaleTime", () => {
  test("keeps a non-empty catalog warm", () => {
    expect(providerCatalogStaleTime(3)).toBe(PROVIDER_CATALOG_STALE_MS)
  })

  test("does not cache an empty catalog", () => {
    expect(providerCatalogStaleTime(0)).toBe(0)
    expect(providerCatalogStaleTime(undefined)).toBe(0)
  })
})

describe("shouldJoinProviderCatalogFetch", () => {
  test("joins an in-flight login prefetch instead of starting a second download", () => {
    expect(shouldJoinProviderCatalogFetch({ hasCatalog: false, fetching: true })).toBe(true)
  })

  test("reuses a warm catalog", () => {
    expect(shouldJoinProviderCatalogFetch({ hasCatalog: true, fetching: false })).toBe(true)
  })

  test("refetches an empty idle catalog", () => {
    expect(shouldJoinProviderCatalogFetch({ hasCatalog: false, fetching: false })).toBe(false)
  })
})

describe("shouldToastProviderCatalog", () => {
  test("does not toast over login's silent in-flight prefetch", () => {
    expect(shouldToastProviderCatalog({ hasCatalog: false, fetching: true })).toBe(false)
  })

  test("does not toast when the catalog is already on screen", () => {
    expect(shouldToastProviderCatalog({ hasCatalog: true, fetching: false })).toBe(false)
  })

  test("toasts when this click started the first fetch", () => {
    expect(shouldToastProviderCatalog({ hasCatalog: false, fetching: false })).toBe(true)
  })

  test("stays silent when the caller asked for silent", () => {
    expect(shouldToastProviderCatalog({ silent: true, hasCatalog: false, fetching: false })).toBe(false)
  })
})

describe("isProviderCatalogLoading", () => {
  test("shows loading while the first catalog fetch is in flight", () => {
    expect(isProviderCatalogLoading({ allLength: 0, fetching: true })).toBe(true)
  })

  test("does not treat an idle observer as loading", () => {
    // enabled && !fetched && !fetching used to lock the picker on "正在拉取" with no network.
    expect(isProviderCatalogLoading({ allLength: 0, fetching: false })).toBe(false)
  })

  test("treats a populated catalog as not loading", () => {
    expect(isProviderCatalogLoading({ allLength: 3, fetching: true })).toBe(false)
  })
})

describe("raceProviderCatalogWait", () => {
  test("resolves the catalog when it arrives before the wait", async () => {
    await expect(raceProviderCatalogWait(Promise.resolve("ok"), 50)).resolves.toBe("ok")
  })

  test("resolves undefined when the catalog wait times out", async () => {
    await expect(raceProviderCatalogWait(new Promise(() => undefined), 10)).resolves.toBeUndefined()
  })
})
