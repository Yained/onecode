import { afterEach, describe, expect, test } from "bun:test"
import { AUTH_TOKEN_STORAGE_KEY } from "./server-auth-cache"
import { listGlobalSessions } from "./global-session-list"

const originalFetch = globalThis.fetch
const originalLocalStorage = globalThis.localStorage

afterEach(() => {
  globalThis.fetch = originalFetch
  Object.defineProperty(globalThis, "localStorage", { value: originalLocalStorage, configurable: true })
})

describe("listGlobalSessions", () => {
  test("calls /global/session with directory and roots", async () => {
    const calls: Array<{ url: string; headers: HeadersInit | undefined }> = []
    const result = await listGlobalSessions({
      baseUrl: "http://127.0.0.1:4096",
      query: { directory: "/data/case", roots: true, limit: 55 },
      username: "",
      password: "secret",
      fetch: async (input, init) => {
        calls.push({ url: String(input), headers: init?.headers })
        return new Response(JSON.stringify([{ id: "ses_1", directory: "/data/case" }]), { status: 200 })
      },
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain("/global/session?")
    expect(calls[0].url).toContain("directory=%2Fdata%2Fcase")
    expect(calls[0].url).toContain("roots=true")
    expect(calls[0].url).toContain("limit=55")
    expect(String(calls[0].headers && (calls[0].headers as Record<string, string>).Authorization)).toContain("Basic ")
    expect(result.data?.[0]?.id).toBe("ses_1")
  })

  test("falls back to cached web token when password is omitted", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: { getItem: (key: string) => (key === AUTH_TOKEN_STORAGE_KEY ? btoa(":web-token") : null) },
      configurable: true,
    })
    let authorization = ""
    globalThis.fetch = ((_: RequestInfo | URL, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get("authorization") ?? ""
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    }) as typeof fetch

    await listGlobalSessions({
      baseUrl: "http://127.0.0.1:4096",
      query: { directory: "/data/case", roots: true, limit: 10 },
    })

    expect(authorization).toBe(`Basic ${btoa(":web-token")}`)
  })
})
