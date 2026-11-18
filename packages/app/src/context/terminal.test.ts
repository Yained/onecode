import { beforeAll, describe, expect, mock, test } from "bun:test"

type ServerKey = Parameters<typeof import("./terminal").getTerminalServerScope>[1]

let getWorkspaceTerminalCacheKey: (dir: string, scope?: string) => string
let getTerminalServerScope: typeof import("./terminal").getTerminalServerScope
let getLegacyTerminalStorageKeys: (dir: string, legacySessionID?: string) => string[]
let migrateTerminalState: (value: unknown) => unknown
let isRemoteTerminalHostScope: (scope: string | undefined) => boolean

beforeAll(async () => {
  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
    useParams: () => ({}),
  }))
  mock.module("@opencode-ai/ui/context", () => ({
    createSimpleContext: () => ({
      use: () => undefined,
      provider: () => undefined,
    }),
  }))
  const mod = await import("./terminal")
  getWorkspaceTerminalCacheKey = mod.getWorkspaceTerminalCacheKey
  getTerminalServerScope = mod.getTerminalServerScope
  getLegacyTerminalStorageKeys = mod.getLegacyTerminalStorageKeys
  migrateTerminalState = mod.migrateTerminalState
  isRemoteTerminalHostScope = mod.isRemoteTerminalHostScope
})

describe("getWorkspaceTerminalCacheKey", () => {
  test("uses workspace-only directory cache key", () => {
    expect(getWorkspaceTerminalCacheKey("/repo")).toBe("/repo:__workspace__")
  })

  test("can include a server scope", () => {
    expect(getWorkspaceTerminalCacheKey("/repo", "wsl:Debian")).toBe("wsl:Debian:/repo:__workspace__")
  })
})

describe("getTerminalServerScope", () => {
  test("preserves local server keys", () => {
    expect(
      getTerminalServerScope(
        { type: "sidecar", variant: "base", http: { url: "http://127.0.0.1:4096" } },
        "sidecar" as ServerKey,
      ),
    ).toBeUndefined()
    expect(
      getTerminalServerScope(
        { type: "http", http: { url: "http://localhost:4096" } },
        "http://localhost:4096" as ServerKey,
      ),
    ).toBeUndefined()
    expect(
      getTerminalServerScope({ type: "http", http: { url: "http://[::1]:4096" } }, "http://[::1]:4096" as ServerKey),
    ).toBeUndefined()
  })

  test("scopes non-local server keys", () => {
    expect(
      getTerminalServerScope(
        { type: "sidecar", variant: "wsl", distro: "Debian", http: { url: "http://127.0.0.1:4096" } },
        "wsl:Debian" as ServerKey,
      ),
    ).toBe("wsl:Debian" as ServerKey)
    expect(
      getTerminalServerScope(
        { type: "http", http: { url: "https://example.com" } },
        "https://example.com" as ServerKey,
      ),
    ).toBe("https://example.com" as ServerKey)
  })
})

describe("getLegacyTerminalStorageKeys", () => {
  test("keeps workspace storage path when no legacy session id", () => {
    expect(getLegacyTerminalStorageKeys("/repo")).toEqual(["/repo/terminal.v1"])
  })

  test("includes legacy session path before workspace path", () => {
    expect(getLegacyTerminalStorageKeys("/repo", "session-123")).toEqual([
      "/repo/terminal/session-123.v1",
      "/repo/terminal.v1",
    ])
  })
})

describe("migrateTerminalState", () => {
  test("drops invalid terminals and restores a valid active terminal", () => {
    expect(
      migrateTerminalState({
        active: "missing",
        all: [
          null,
          { id: "one", title: "Terminal 2" },
          { id: "one", title: "duplicate", titleNumber: 9 },
          { id: "two", title: "logs", titleNumber: 4, rows: 24, cols: 80 },
          { title: "no-id" },
        ],
      }),
    ).toEqual({
      active: "one",
      all: [
        { id: "one", title: "Terminal 2", titleNumber: 2 },
        { id: "two", title: "logs", titleNumber: 4, rows: 24, cols: 80 },
      ],
    })
  })

  test("keeps a valid active id", () => {
    expect(
      migrateTerminalState({
        active: "two",
        all: [
          { id: "one", title: "Terminal 1" },
          { id: "two", title: "shell", titleNumber: 7 },
        ],
      }),
    ).toEqual({
      active: "two",
      all: [
        { id: "one", title: "Terminal 1", titleNumber: 1 },
        { id: "two", title: "shell", titleNumber: 7 },
      ],
    })
  })
})

describe("isRemoteTerminalHostScope", () => {
  test("detects remote persist scopes", () => {
    expect(isRemoteTerminalHostScope("remote:wrk_abc")).toBe(true)
    expect(isRemoteTerminalHostScope("https://example.com:remote:wrk_abc")).toBe(true)
    expect(isRemoteTerminalHostScope("wsl:Debian")).toBe(false)
    expect(isRemoteTerminalHostScope(undefined)).toBe(false)
  })
})

describe("session project follow (option C)", () => {
  test("opens a new tab on project switch and keeps existing tabs", async () => {
    const source = await Bun.file(new URL("./terminal.tsx", import.meta.url)).text()
    expect(source).toContain("pendingTerminalProjectFollow")
    expect(source).toContain("followProjectIfNeeded")
    expect(source).toContain('layout.view("workbench").terminal.opened()')
    expect(source).toContain("void workspace().new()")
    expect(source).not.toContain("setReplacingProject(true)")
  })

  test("does not trimAll on session-id navigation", async () => {
    const source = await Bun.file(new URL("./terminal.tsx", import.meta.url)).text()
    expect(source).toContain(
      "() => ({ host: ptyDirectory() || params.dir, scope: ptyHostScope(), project: projectKey() })",
    )
    expect(source).not.toContain("id: params.id, scope: scope()")
    expect(source).not.toContain("terminalSnapshots")
  })
})

describe("remote PTY host", () => {
  test("does not open a follow tab when the host already has terminals", async () => {
    const source = await Bun.file(new URL("./terminal.tsx", import.meta.url)).text()
    expect(source).toContain("if (workspace().all().length > 0) return false")
    expect(source).toContain("if (workspace().all().length === 0) void workspace().ensure()")
    expect(source).toContain("ensure(): Promise<TerminalCreateResult>")
    expect(source).toContain("if (existing) return Promise.resolve({ id: store.active ?? existing.id })")
  })

  test("hosts PTY on the bound project and uses the remote cwd", async () => {
    const source = await Bun.file(new URL("./terminal.tsx", import.meta.url)).text()
    expect(source).toContain("boundWorkspaceID(project)")
    expect(source).toContain("remoteWorkspaceFor(project)?.remotePath")
    expect(source).toContain("...(workspaceID ? { experimental_workspaceID: workspaceID } : {})")
    expect(source).toContain("return `remote:${remote}`")
    expect(source).toContain("SSH 未连接，无法打开远端终端")
    expect(source).toContain("createGuard")
  })

  test("does not restore persisted PTY ids for a remote host", async () => {
    const source = await Bun.file(new URL("./terminal.tsx", import.meta.url)).text()
    expect(source).toContain("isRemoteTerminalHostScope(scope)")
    expect(source).toContain("return { active: undefined, all: [] }")
  })

  test("passes bound workspace on the PTY websocket URL", async () => {
    const source = await Bun.file(new URL("../components/terminal.tsx", import.meta.url)).text()
    expect(source).toContain("workspace: workspaceID()")
    expect(source).toContain("ptyWorkspaceID")
  })
})
