import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import type { Config } from "@opencode-ai/sdk/v2/client"
import {
  applyConfirmedTenantMaps,
  buildSshMapFromOpenSshDisk,
  clearConfirmedTenantMapWrite,
  enrichConfigSshFromOpenSsh,
  hasActiveSshPin,
  peekConfirmedTenantMapWrite,
  rememberConfirmedTenantMapWrite,
} from "./bootstrap"

describe("confirmed tenant map writes", () => {
  beforeEach(() => {
    clearConfirmedTenantMapWrite()
  })

  test("rememberConfirmedTenantMapWrite pins delete (empty ssh) across stripped refetch", () => {
    rememberConfirmedTenantMapWrite({
      accountId: "acct-a",
      ssh: {},
    })
    expect(peekConfirmedTenantMapWrite()?.ssh).toEqual({})

    const incoming = { username: "hanmk" } as Config
    const next = applyConfirmedTenantMaps(incoming, "acct-a")
    expect(next.ssh).toEqual({})
    expect(next.username).toBe("hanmk")
  })

  test("rememberConfirmedTenantMapWrite pins delete over stale non-empty refetch", () => {
    rememberConfirmedTenantMapWrite({
      accountId: "acct-a",
      ssh: {},
    })
    const incoming = {
      ssh: { stale: { host: "a", remotePath: "/old" } },
    } as Config
    expect(applyConfirmedTenantMaps(incoming, "acct-a").ssh).toEqual({})
  })

  test("rememberConfirmedTenantMapWrite pins save across stripped refetch", () => {
    const ssh = { lab: { host: "a", remotePath: "/work" } }
    rememberConfirmedTenantMapWrite({ accountId: "acct-a", ssh: ssh as Config["ssh"] })
    const next = applyConfirmedTenantMaps({} as Config, "acct-a")
    expect(next.ssh).toEqual(ssh)
  })

  test("pins save when refetch returns empty ssh map", () => {
    const ssh = { lab: { host: "a", remotePath: "/work" } }
    rememberConfirmedTenantMapWrite({ accountId: "acct-a", ssh: ssh as Config["ssh"] })
    expect(applyConfirmedTenantMaps({ ssh: {} } as Config, "acct-a").ssh).toEqual(ssh)
  })

  test("pins save when refetch returns host-less stubs", () => {
    const ssh = { lab: { host: "a", remotePath: "/work", enabled: true } }
    rememberConfirmedTenantMapWrite({ accountId: "acct-a", ssh: ssh as Config["ssh"] })
    const incoming = {
      ssh: { lab: { enabled: true } },
    } as Config
    expect(applyConfirmedTenantMaps(incoming, "acct-a").ssh).toEqual(ssh)
  })

  test("does not override when server already returned usable ssh", () => {
    rememberConfirmedTenantMapWrite({
      accountId: "acct-a",
      ssh: { old: { host: "a", remotePath: "/old" } } as Config["ssh"],
    })
    const incoming = {
      ssh: { neu: { host: "b", remotePath: "/new" } },
    } as Config
    expect(applyConfirmedTenantMaps(incoming, "acct-a").ssh).toEqual(incoming.ssh)
  })

  test("ignores writes for other accounts", () => {
    rememberConfirmedTenantMapWrite({
      accountId: "acct-a",
      ssh: { lab: { host: "a", remotePath: "/work" } } as Config["ssh"],
    })
    expect(applyConfirmedTenantMaps({} as Config, "acct-b").ssh).toBeUndefined()
  })

  test("failed save can restore previous pin without leaving a ghost map", () => {
    const before = { lab: { host: "a", remotePath: "/work" } } as Config["ssh"]
    rememberConfirmedTenantMapWrite({ accountId: "acct-a", ssh: before })
    // Optimistic pin for a save that will fail.
    rememberConfirmedTenantMapWrite({
      accountId: "acct-a",
      ssh: {
        ...before,
        neu: { host: "b", remotePath: "/new" },
      } as Config["ssh"],
    })
    // Roll back on error (dialog-select-ssh catch path).
    rememberConfirmedTenantMapWrite({ accountId: "acct-a", ssh: before })
    expect(peekConfirmedTenantMapWrite()?.ssh).toEqual(before)
    expect(hasActiveSshPin("acct-a")).toBe(true)
  })

  test("hasActiveSshPin is true only for recent ssh pins on that account", () => {
    expect(hasActiveSshPin("acct-a")).toBe(false)
    rememberConfirmedTenantMapWrite({ accountId: "acct-a", mcp: {} })
    expect(hasActiveSshPin("acct-a")).toBe(false)
    rememberConfirmedTenantMapWrite({
      accountId: "acct-a",
      ssh: { lab: { host: "a", remotePath: "/work" } } as Config["ssh"],
    })
    expect(hasActiveSshPin("acct-a")).toBe(true)
    expect(hasActiveSshPin("acct-b")).toBe(false)
  })
})

describe("enrichConfigSshFromOpenSsh", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    clearConfirmedTenantMapWrite()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("refills empty product ssh from OpenSSH and pins it across empty refetch", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ssh: { lab: { host: "a", remotePath: "/work", enabled: true } },
          path: "/tmp/config",
        }),
        { status: 200 },
      )) as unknown as typeof fetch

    const enriched = await enrichConfigSshFromOpenSsh({
      config: {} as Config,
      serverUrl: "http://127.0.0.1:8007",
      accountId: "acct-a",
    })
    expect(enriched.ssh).toEqual({ lab: { host: "a", remotePath: "/work", enabled: true } })
    expect(hasActiveSshPin("acct-a")).toBe(true)

    const afterEmptyRefetch = applyConfirmedTenantMaps({ ssh: {} } as Config, "acct-a")
    expect(afterEmptyRefetch.ssh).toEqual(enriched.ssh)
  })

  test("does not call OpenSSH when a user pin is already active", async () => {
    rememberConfirmedTenantMapWrite({
      accountId: "acct-a",
      ssh: {},
    })
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return new Response(JSON.stringify({ ssh: { lab: { host: "a", remotePath: "/work" } } }), { status: 200 })
    }) as unknown as typeof fetch

    const enriched = await enrichConfigSshFromOpenSsh({
      config: { ssh: { stale: { host: "b", remotePath: "/old" } } } as Config,
      serverUrl: "http://127.0.0.1:8007",
      accountId: "acct-a",
    })
    expect(called).toBe(false)
    expect(enriched.ssh).toEqual({})
  })

  test("failed OpenSSH fetch leaves empty product empty without pinning", async () => {
    globalThis.fetch = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch
    const enriched = await enrichConfigSshFromOpenSsh({
      config: {} as Config,
      serverUrl: "http://127.0.0.1:8007",
      accountId: "acct-a",
    })
    expect(enriched.ssh).toBeUndefined()
    expect(hasActiveSshPin("acct-a")).toBe(false)
  })

  test("after await, honors a pin landed by concurrent hydrate (F12 race)", async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    globalThis.fetch = (async () => {
      await gate
      return new Response("nope", { status: 500 })
    }) as unknown as typeof fetch

    const pending = enrichConfigSshFromOpenSsh({
      config: {} as Config,
      serverUrl: "http://127.0.0.1:8007",
      accountId: "acct-a",
    })
    // Simulate Integration hydrate winning while empty config enrich is still awaiting disk.
    rememberConfirmedTenantMapWrite({
      accountId: "acct-a",
      ssh: { lab: { host: "a", remotePath: "/work" } } as Config["ssh"],
    })
    release?.()
    const enriched = await pending
    expect(enriched.ssh).toEqual({ lab: { host: "a", remotePath: "/work" } })
  })

  test("successful empty OpenSSH read does not pin {} (login race with OS ~/.ssh)", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ssh: {}, path: "/home/bench/.ssh/config" }), { status: 200 })) as unknown as typeof fetch
    const enriched = await enrichConfigSshFromOpenSsh({
      config: {} as Config,
      serverUrl: "http://127.0.0.1:8007",
      accountId: "acct-a",
    })
    expect(enriched.ssh).toEqual({})
    expect(hasActiveSshPin("acct-a")).toBe(false)
  })
})

describe("buildSshMapFromOpenSshDisk", () => {
  test("does not resurrect cache-only names missing from disk", () => {
    const disk = {
      keep: { host: "a", remotePath: "/work" },
    } as NonNullable<Config["ssh"]>
    const current = {
      ssh: {
        keep: { host: "a", remotePath: "/work", enabled: true },
        ghost: { host: "b", remotePath: "/gone" },
      },
    } as Config
    expect(buildSshMapFromOpenSshDisk(disk, current)).toEqual({
      keep: { host: "a", remotePath: "/work", enabled: true },
    })
  })

  test("empty disk yields empty map so deletes stick", () => {
    const current = {
      ssh: { stale: { host: "a", remotePath: "/old" } },
    } as Config
    expect(buildSshMapFromOpenSshDisk({}, current)).toEqual({})
  })

  test("overlays enabled/submit from cache onto disk entry", () => {
    const disk = {
      lab: { host: "a", remotePath: "/disk", auth: { type: "key", keyPath: "/k" } },
    } as NonNullable<Config["ssh"]>
    const current = {
      ssh: {
        lab: {
          host: "a",
          remotePath: "/cache",
          enabled: false,
          submit: { command: "sbatch" },
        },
      },
    } as Config
    expect(buildSshMapFromOpenSshDisk(disk, current)).toEqual({
      lab: {
        host: "a",
        remotePath: "/disk",
        auth: { type: "key", keyPath: "/k" },
        enabled: false,
        submit: { command: "sbatch" },
      },
    })
  })

  test("overlays password auth from cache onto disk entry", () => {
    const disk = {
      lab: { host: "a", remotePath: "/disk" },
    } as NonNullable<Config["ssh"]>
    const current = {
      ssh: {
        lab: {
          host: "a",
          remotePath: "/cache",
          auth: { type: "password", password: "secret" },
        },
      },
    } as Config
    expect(buildSshMapFromOpenSshDisk(disk, current)).toEqual({
      lab: {
        host: "a",
        remotePath: "/disk",
        auth: { type: "password", password: "secret" },
      },
    })
  })
})
