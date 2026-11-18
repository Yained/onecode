import { describe, expect, test } from "bun:test"

describe("workbench resources page", () => {
  test("embeds SSH panel only", async () => {
    const source = await Bun.file(new URL("./resources.tsx", import.meta.url)).text()

    expect(source).toContain("WorkbenchResourcesPage")
    expect(source).toContain("os-client-resources-page")
    expect(source).toContain('SshConfigPanel variant="page"')
    expect(source).not.toContain("McpConfigPanel")
    expect(source).not.toContain('id: "mcp"')
    expect(source).not.toContain("os-client-capability-domain-row")
    expect(source).toContain("SSH 连接配置")
    expect(source).toContain("workspaceHomeHref")
    expect(source).toContain("os-client-resources-close")
  })
})
