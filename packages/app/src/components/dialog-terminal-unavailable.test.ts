import { describe, expect, test } from "bun:test"

describe("DialogTerminalUnavailable", () => {
  test("uses a solid normal-size dialog and skips bubblewrap copy when create failed", async () => {
    const source = await Bun.file(new URL("./dialog-terminal-unavailable.tsx", import.meta.url)).text()
    expect(source).toContain('class="os-client-terminal-dialog w-full" size="normal"')
    expect(source).not.toContain('size="large">')
    expect(source).toContain("if (sshRemote()) return []")
    expect(source).toContain("if (allowedButFailed() && failure()) return []")
    expect(source).toContain("SSH 远端项目的终端在远端以普通 shell 运行")
    expect(source).toContain("在远端创建或连接普通 shell 失败")
    expect(source).not.toContain("请断开后重新连接远端，再打开终端。")
    const css = await Bun.file(new URL("../index.css", import.meta.url)).text()
    expect(css).toContain("[data-component=\"dialog\"]:has(.os-client-terminal-dialog) [data-slot=\"dialog-container\"]")
    expect(css).toContain("background: #ffffff")
  })
})
