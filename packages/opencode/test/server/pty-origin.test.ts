import { describe, expect, test } from "bun:test"

describe("PTY origin checks", () => {
  test("leaf workspace serves skip browser Origin vs Host mismatch", async () => {
    const source = await Bun.file(
      new URL("../../src/server/routes/instance/httpapi/handlers/pty.ts", import.meta.url),
    ).text()
    expect(source).toContain("if (Flag.OPENCODE_WORKSPACE_ID) return true")
    expect(source).toContain("isAllowedRequestOrigin")
    expect(source).toContain("if (Flag.OPENCODE_WORKSPACE_ID) return")
    const sandbox = await Bun.file(
      new URL("../../src/platform-auth/terminal-sandbox.ts", import.meta.url),
    ).text()
    expect(sandbox).toContain("isRemoteLeafTerminal")
    expect(sandbox).toContain("isOffHostRemoteCwd")
    expect(sandbox).toContain("if (isOffHostRemoteCwd(input.session, input.cwd) || !input.session)")
    const auth = await Bun.file(
      new URL("../../src/server/routes/instance/httpapi/middleware/authorization.ts", import.meta.url),
    ).text()
    expect(auth).toContain("if (Flag.OPENCODE_WORKSPACE_ID)")
    const proxyUtil = await Bun.file(new URL("../../src/server/proxy-util.ts", import.meta.url)).text()
    expect(proxyUtil).toContain("export function leafHeaders")
    expect(proxyUtil).toContain('out.set("origin", new URL(target).origin)')
    const proxy = await Bun.file(
      new URL("../../src/server/routes/instance/httpapi/middleware/proxy.ts", import.meta.url),
    ).text()
    expect(proxy).toContain("ProxyUtil.leafHeaders(request.headers as HeadersInit, extra, url)")
  })
})
