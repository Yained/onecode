import { describe, expect, test } from "bun:test"

describe("OneScience skill detail dialog", () => {
  test("loads skill body through catalog resolve", async () => {
    const requests: string[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = ((input: RequestInfo | URL) => {
      requests.push(String(input))
      if (String(input).includes("/catalog/entries/skill%3Aonescience-coder/resolve?part=body")) {
        return Promise.resolve(
          Response.json({
            location: "/tmp/.opencode/oneskills/skills/onescience-coder/SKILL.md",
            content: "# Coder\n\nBuild modules.",
            frontmatter: {
              name: "onescience-coder",
              description: "Code generation skill",
              references: ["models", "datapipes"],
            },
          }),
        )
      }
      return Promise.resolve(Response.json({}))
    }) as typeof fetch

    try {
      const { fetchCatalogSkillBody } = await import("./onescience-catalog")
      const result = await fetchCatalogSkillBody("http://localhost:4096", "onescience-coder")
      expect(result.loaded).toBe(true)
      expect(result.content).toContain("# Coder")
      expect(result.frontmatter?.name).toBe("onescience-coder")
      expect(requests.some((url) => url.includes("skill%3Aonescience-coder"))).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("exposes skill detail dialog and clickable cards on the skills page", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()
    const dialogSource = await Bun.file(new URL("./onescience-skill-detail-dialog.tsx", import.meta.url)).text()
    const cardBody = source.slice(source.indexOf("function ResourceCard"), source.indexOf("function ResourceCardMenu"))

    expect(dialogSource).toContain("SkillDetailDialog")
    expect(dialogSource).toContain("fetchCatalogSkillBody")
    expect(dialogSource).toContain("SkillFrontmatterPanel")
    expect(dialogSource).toContain("os-skill-detail-meta")
    expect(dialogSource).toContain("os-skill-detail-markdown")
    expect(dialogSource).toContain("os-skill-detail-head")
    expect(dialogSource).toContain("os-skill-detail-chips")
    expect(dialogSource).toContain("variant?: \"default\" | \"workbench\"")
    expect(dialogSource).toContain("os-client-capability-skill-detail-dialog")
    expect(dialogSource).toContain("activeItem()!.title")
    const css = await Bun.file(new URL("../index.css", import.meta.url)).text()
    expect(css).toContain(".os-client-capability-skill-detail-overlay {")
    expect(css).not.toContain(".os-client-workbench .os-client-capability-skill-detail-overlay")
    expect(source).toContain("<SkillDetailDialog")
    expect(cardBody).toContain("isSkillCard")
    expect(cardBody).toContain("openSkillDetail")
    expect(cardBody).toContain("onDevelop={() => openSkillDevelop()}")
  })
})
