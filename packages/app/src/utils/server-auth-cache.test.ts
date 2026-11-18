import { describe, expect, test } from "bun:test"
import { AUTH_TOKEN_STORAGE_KEY, resolveBrowserAuth } from "./server-auth-cache"

describe("resolveBrowserAuth", () => {
  test("uses onecode auth token storage key", () => {
    expect(AUTH_TOKEN_STORAGE_KEY).toBe("onecode.settings.dat:authToken")
  })

  test("uses cached token when URL has no auth token", () => {
    expect(resolveBrowserAuth({ queryToken: null, storedToken: btoa(":cached") })).toEqual({
      auth: { username: "", password: "cached" },
      token: btoa(":cached"),
      persist: false,
    })
  })

  test("accepts a raw cached token", () => {
    expect(resolveBrowserAuth({ queryToken: null, storedToken: "cached" })).toEqual({
      auth: { username: "", password: "cached" },
      token: btoa(":cached"),
      persist: false,
    })
  })

  test("uses and persists a new URL token over cached token", () => {
    expect(resolveBrowserAuth({ queryToken: btoa(":fresh"), storedToken: btoa(":cached") })).toEqual({
      auth: { username: "", password: "fresh" },
      token: btoa(":fresh"),
      persist: true,
    })
  })

  test("uses raw URL token and stores it as token-only credentials", () => {
    expect(resolveBrowserAuth({ queryToken: "fresh", storedToken: btoa(":cached") })).toEqual({
      auth: { username: "", password: "fresh" },
      token: btoa(":fresh"),
      persist: true,
    })
  })
})
