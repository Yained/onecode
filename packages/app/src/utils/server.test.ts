import { afterEach, describe, expect, test } from "bun:test"
import { authFromToken, authTokenFromCredentials, createSdkForServer } from "./server"
import { AUTH_TOKEN_STORAGE_KEY } from "./server-auth-cache"

const originalLocalStorage = globalThis.localStorage

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: originalLocalStorage, configurable: true })
})

function installStorage(value?: string) {
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: (key: string) => key === AUTH_TOKEN_STORAGE_KEY ? value ?? null : null },
    configurable: true,
  })
}

describe("authFromToken", () => {
  test("decodes basic auth credentials from auth_token", () => {
    expect(authFromToken(btoa("kit:secret"))).toEqual({ username: "kit", password: "secret" })
  })

  test("preserves blank username for token-only credentials", () => {
    expect(authFromToken(btoa(":secret"))).toEqual({ username: "", password: "secret" })
  })

  test("ignores malformed tokens", () => {
    expect(authFromToken("not base64")).toBeUndefined()
    expect(authFromToken(btoa("missing-separator"))).toBeUndefined()
  })
})

describe("authTokenFromCredentials", () => {
  test("encodes token-only credentials by default", () => {
    expect(authTokenFromCredentials({ password: "secret" })).toBe(btoa(":secret"))
  })
})

describe("createSdkForServer", () => {
  test("uses cached auth token for SDK requests after platform login", async () => {
    installStorage(btoa(":session-token"))
    let authorization = ""
    const client = createSdkForServer({
      server: { url: "http://127.0.0.1:4096", password: "startup-token" },
      fetch: (async (input: RequestInfo | URL) => {
        authorization = input instanceof Request ? input.headers.get("authorization") ?? "" : ""
        return new Response(JSON.stringify({ healthy: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }) as typeof fetch,
    })

    await client.global.health()

    expect(authorization).toBe(`Basic ${btoa(":session-token")}`)
  })

  test("preserves explicit SDK auth headers", async () => {
    installStorage(btoa(":session-token"))
    let authorization = ""
    const client = createSdkForServer({
      server: { url: "http://127.0.0.1:4096", password: "startup-token" },
      headers: { Authorization: "Basic explicit" },
      fetch: (async (input: RequestInfo | URL) => {
        authorization = input instanceof Request ? input.headers.get("authorization") ?? "" : ""
        return new Response(JSON.stringify({ healthy: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }) as typeof fetch,
    })

    await client.global.health()

    expect(authorization).toBe("Basic explicit")
  })
})
