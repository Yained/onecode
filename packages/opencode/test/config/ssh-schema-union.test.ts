import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Config } from "../../src/config/config"

describe("ssh schema union", () => {
  const decode = Schema.decodeUnknownSync(Config.Info)

  test("keeps a complete SSH entry", () => {
    const decoded = decode({
      ssh: {
        lab: {
          enabled: true,
          host: "east1",
          remotePath: "/work",
          port: 65023,
          auth: { type: "key", keyPath: "/tmp/id" },
        },
      },
    })
    expect(decoded.ssh?.lab).toMatchObject({
      host: "east1",
      remotePath: "/work",
      port: 65023,
    })
  })

  test("accepts password auth", () => {
    const decoded = decode({
      ssh: {
        lab: {
          enabled: true,
          host: "east1",
          remotePath: "/work",
          auth: { type: "password", password: "secret" },
        },
      },
    })
    expect(decoded.ssh?.lab).toMatchObject({
      auth: { type: "password", password: "secret" },
    })
  })

  test("accepts disable-only stubs", () => {
    const decoded = decode({
      ssh: {
        lab: { enabled: false },
      },
    })
    expect(decoded.ssh?.lab).toEqual({ enabled: false })
  })

  test("does not silent-strip invalid full entries to {enabled:true}", () => {
    expect(() =>
      decode({
        ssh: {
          lab: {
            enabled: true,
            host: "east1",
            remotePath: "/work",
            port: "65023",
          },
        },
      }),
    ).toThrow()

    expect(() =>
      decode({
        ssh: {
          lab: {
            enabled: true,
            host: "east1",
            remotePath: "/work",
            options: { Port: 22 },
          },
        },
      }),
    ).toThrow()
  })

  test("normalizeSshMap coerces port strings and option numbers before decode", () => {
    const normalized = Config.testing.normalizeSshMap({
      lab: {
        enabled: true,
        host: "east1",
        remotePath: "/work",
        port: "65023",
        options: { Port: 22 },
      },
    })
    const decoded = decode({ ssh: normalized })
    expect(decoded.ssh?.lab).toMatchObject({
      host: "east1",
      remotePath: "/work",
      port: 65023,
      options: { Port: "22" },
    })
  })

  test("normalizeSshMap demotes corrupt partials so schema decode cannot brick getGlobal", () => {
    const normalized = Config.testing.normalizeSshMap({
      ok: { enabled: true, host: "a", remotePath: "/work" },
      partial: { enabled: true, host: "b" },
      stub: { enabled: false },
    })
    const decoded = decode({ ssh: normalized })
    expect(decoded.ssh).toEqual({
      ok: { enabled: true, host: "a", remotePath: "/work" },
      partial: { enabled: true },
      stub: { enabled: false },
    })
  })

  test("isTenantMapsOnlyPatch detects ssh/mcp-only updates", () => {
    expect(Config.testing.isTenantMapsOnlyPatch({ ssh: {} })).toBe(true)
    expect(Config.testing.isTenantMapsOnlyPatch({ mcp: {}, ssh: {} })).toBe(true)
    expect(Config.testing.isTenantMapsOnlyPatch({ ssh: {}, username: "a" })).toBe(false)
    expect(Config.testing.isTenantMapsOnlyPatch({ provider: {} })).toBe(false)
  })
})
