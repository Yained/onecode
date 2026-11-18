import { describe, expect, test } from "bun:test"
import { listCustomProviderModels, parseModelIDs, probeCustomProvider } from "./custom-provider-probe"

describe("probeCustomProvider", () => {
  test("reports auth failures without echoing the full api key", async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => {
      return new Response("unauthorized sk-super-secret-key-value", {
        status: 401,
        statusText: "Unauthorized",
      })
    }) as unknown as typeof fetch

    try {
      const result = await probeCustomProvider({
        baseURL: "https://api.example.com/v1",
        apiKey: "sk-super-secret-key-value",
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.kind).toBe("auth")
      expect(result.message).not.toContain("sk-super-secret-key-value")
      expect(result.message).toContain("sk-s…")
    } finally {
      globalThis.fetch = original
    }
  })

  test("treats reachable /models as success", async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }) as unknown as typeof fetch

    try {
      const result = await probeCustomProvider({
        baseURL: "https://api.example.com/v1",
        apiKey: "sk-test",
      })
      expect(result).toEqual({ ok: true })
    } finally {
      globalThis.fetch = original
    }
  })
})

describe("parseModelIDs", () => {
  test("reads OpenAI data array and dedupes", () => {
    expect(
      parseModelIDs({
        data: [{ id: "gpt-4" }, { id: "gpt-4" }, { id: " gpt-5.6 " }, { object: "model" }],
      }),
    ).toEqual(["gpt-4", "gpt-5.6"])
  })

  test("accepts models array and plain string lists", () => {
    expect(parseModelIDs({ models: ["a", "b"] })).toEqual(["a", "b"])
    expect(parseModelIDs(["x", "y"])).toEqual(["x", "y"])
  })
})

describe("listCustomProviderModels", () => {
  test("returns model ids from /models", async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ data: [{ id: "gpt-5.6" }, { id: "claude-sonnet" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }) as unknown as typeof fetch

    try {
      const result = await listCustomProviderModels({
        baseURL: "https://api.example.com/v1",
        apiKey: "sk-test",
      })
      expect(result).toEqual({ ok: true, models: ["gpt-5.6", "claude-sonnet"] })
    } finally {
      globalThis.fetch = original
    }
  })
})
