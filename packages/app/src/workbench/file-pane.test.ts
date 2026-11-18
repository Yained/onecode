import { describe, expect, test } from "bun:test"

describe("workbench directory pane", () => {
  test("lists the bound remote path and does not show A's identity folder while SSH is disconnected", async () => {
    const pane = await Bun.file(new URL("./file-pane.tsx", import.meta.url)).text()
    const files = await Bun.file(new URL("../context/file.tsx", import.meta.url)).text()
    expect(pane).toContain("runtimeEnvironmentFor(directory).kind === \"ssh\"")
    expect(pane).toContain("remoteWorkspaceFor(directory)?.remotePath")
    expect(pane).toContain("未连接远端")
    expect(pane).toContain("isSshFileTreePending(directory)")
    expect(files).toContain("treeScope")
    expect(files).toContain("isSshFileTreePending(current)")
    expect(files).toContain("Never list A's identity folder")
  })
})
