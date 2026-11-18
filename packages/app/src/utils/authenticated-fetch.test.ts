import { afterEach, describe, expect, test } from "bun:test"
import { authenticatedFetch, authHeadersFromCachedToken } from "./authenticated-fetch"
import { AUTH_TOKEN_STORAGE_KEY } from "./server-auth-cache"

const originalFetch = globalThis.fetch
const originalLocalStorage = globalThis.localStorage

afterEach(() => {
  globalThis.fetch = originalFetch
  Object.defineProperty(globalThis, "localStorage", { value: originalLocalStorage, configurable: true })
})

function installStorage(value?: string) {
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: (key: string) => key === AUTH_TOKEN_STORAGE_KEY ? value ?? null : null },
    configurable: true,
  })
}

describe("authHeadersFromCachedToken", () => {
  test("returns a Basic header from cached token", () => {
    installStorage(btoa(":secret"))

    expect(authHeadersFromCachedToken()).toEqual({ Authorization: `Basic ${btoa(":secret")}` })
  })

  test("falls back to runtime sidecar credentials", async () => {
    installStorage()
    const { setAuthenticatedFetchCredentials } = await import("./authenticated-fetch")
    setAuthenticatedFetchCredentials({ username: "opencode", password: "sidecar-secret" })
    expect(authHeadersFromCachedToken()).toEqual({
      Authorization: `Basic ${btoa("opencode:sidecar-secret")}`,
    })
    setAuthenticatedFetchCredentials(undefined)
  })
})

describe("authenticatedFetch", () => {
  test("adds cached token to requests without auth header", async () => {
    installStorage(btoa(":secret"))
    let authorization = ""
    globalThis.fetch = ((_: RequestInfo | URL, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get("authorization") ?? ""
      return Promise.resolve(new Response("ok"))
    }) as typeof fetch

    await authenticatedFetch("/experimental/onescience/task-profile")

    expect(authorization).toBe(`Basic ${btoa(":secret")}`)
  })

  test("preserves explicit auth header", async () => {
    installStorage(btoa(":secret"))
    let authorization = ""
    globalThis.fetch = ((_: RequestInfo | URL, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get("authorization") ?? ""
      return Promise.resolve(new Response("ok"))
    }) as typeof fetch

    await authenticatedFetch("/experimental/onescience/task-profile", { headers: { authorization: "Basic explicit" } })

    expect(authorization).toBe("Basic explicit")
  })
})
