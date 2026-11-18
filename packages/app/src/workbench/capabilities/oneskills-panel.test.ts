import { describe, expect, test } from "bun:test"

describe("oneskills panel", () => {
  test("passes For items as values, not accessors", async () => {
    const source = await Bun.file(new URL("./oneskills-panel.tsx", import.meta.url)).text()
    expect(source).toContain("onOpen={() => props.onOpen(item)}")
    expect(source).toContain("onDevelop={() => props.onDevelop(item)}")
    expect(source).toContain("canDevelop={props.canDevelop}")
    expect(source).toContain("item={item}")
    expect(source).not.toContain("onOpen={() => props.onOpen(item())}")
    expect(source).not.toContain("group={group()}")
    expect(source).toContain("setDetailOpen(true)")
    expect(source).toContain("open={detailOpen()}")
    expect(source).toContain("requirePersonalSpace")
    expect(source).toContain('workspaceCapabilitiesCategoryHref("oneskills", domain)')
    expect(source).not.toContain("redirect:")
  })
})
