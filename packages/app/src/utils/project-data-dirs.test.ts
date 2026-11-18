import { describe, expect, test } from "bun:test"
import { listProjectDataDirectories, relativeProjectDataPath } from "./project-data-dirs"
import { AUTH_TOKEN_STORAGE_KEY } from "./server-auth-cache"

describe("project-data-dirs", () => {
  test("relativeProjectDataPath resolves paths under project data root", () => {
    expect(relativeProjectDataPath("/data", "/data")).toBe("")
    expect(relativeProjectDataPath("/data", "/data/case")).toBe("case")
    expect(relativeProjectDataPath("/data", "/other")).toBeUndefined()
  })

  test("listProjectDataDirectories parses array and wrapped responses", async () => {
    const fetchImpl = (async (input: string | URL) => {
      const url = input.toString()
      if (url.endsWith("/global/path/dirs?path=case")) {
        return new Response(JSON.stringify([{ name: "demo", absolute: "/data/case/demo" }]), { status: 200 })
      }
      return new Response(JSON.stringify({ data: [{ name: "root", absolute: "/data/root" }] }), { status: 200 })
    }) as typeof fetch

    await expect(listProjectDataDirectories({ url: "http://127.0.0.1:4096" }, "", { fetch: fetchImpl })).resolves.toEqual([
      { name: "root", absolute: "/data/root" },
    ])
    await expect(
      listProjectDataDirectories({ url: "http://127.0.0.1:4096" }, "case", { fetch: fetchImpl }),
    ).resolves.toEqual([{ name: "demo", absolute: "/data/case/demo" }])
  })

  test("listProjectDataDirectories sends cached auth token", async () => {
    const previous = globalThis.localStorage
    const seen: string[] = []
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => key === AUTH_TOKEN_STORAGE_KEY ? "cached-token" : null,
      },
    })
    const fetchImpl = (async (_input: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      seen.push(headers.get("authorization") ?? "")
      return new Response(JSON.stringify([]), { status: 200 })
    }) as typeof fetch

    try {
      await listProjectDataDirectories({ url: "http://127.0.0.1:4096" }, "", { fetch: fetchImpl })
      await listProjectDataDirectories({ url: "http://127.0.0.1:4096" }, "", {
        fetch: fetchImpl,
        headers: { Authorization: "Basic explicit" },
      })
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: previous,
      })
    }

    expect(seen).toEqual(["Basic cached-token", "Basic explicit"])
  })
})
