import { describe, expect, test } from "bun:test"

describe("desktop platform auth meta", () => {
  test("injects platform-auth-required so logout gates chat and workspace paths", async () => {
    const source = await Bun.file(new URL("./index.tsx", import.meta.url)).text()
    expect(source).toContain('ensure("onescience-platform-auth-required", "true")')
    expect(source).toContain("injectDesktopWorkspaceMeta(null)")
  })
})
