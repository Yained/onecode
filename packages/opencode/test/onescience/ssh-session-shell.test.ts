import { describe, expect, test } from "bun:test"
import {
  parseSshRuntimeFromMessages,
  parseSshRuntimeFromText,
  resolveSshShellTarget,
  sshRemoteWorkdir,
  wrapSshShellCommand,
} from "../../src/onescience/ssh-session-shell"

describe("ssh session shell", () => {
  test("parses the slim runtime header without connection secrets", () => {
    const text = `【环境信息】
SSH 远程 · core1-hanmk_sg
工作目录：/public/home/hanmk_sg
Conda：onescience311`
    expect(parseSshRuntimeFromText(text)).toEqual({
      targetName: "core1-hanmk_sg",
      condaEnv: "onescience311",
    })
    expect(parseSshRuntimeFromText("Execution Environment: SSH 远程 · legacy-target\nConda Env: py311")).toEqual({
      targetName: "legacy-target",
      condaEnv: "py311",
    })
    expect(parseSshRuntimeFromText("Execution Environment: 本地运行")).toBeUndefined()
    expect(parseSshRuntimeFromText("SSH 远程（目标配置缺失，请重新选择运行环境）")).toBeUndefined()
  })

  test("reads the newest user runtime header from session messages", () => {
    expect(
      parseSshRuntimeFromMessages([
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "Execution Environment: SSH 远程 · old-target" }],
        },
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "ok" }],
        },
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "【环境信息】\nSSH 远程 · core1-hanmk_sg\nConda：py311" }],
        },
      ]),
    ).toEqual({ targetName: "core1-hanmk_sg", condaEnv: "py311" })
  })

  test("wraps the user command for a remote login shell", () => {
    const wrapped = wrapSshShellCommand("ls && hostname", "/public/home/hanmk_sg", "onescience311")
    expect(wrapped.startsWith("bash -lc ")).toBe(true)
    expect(wrapped).toContain("conda activate")
    expect(wrapped).toContain("onescience311")
    expect(wrapped).toContain("/public/home/hanmk_sg")
    expect(wrapped).toContain("ls && hostname")
    expect(sshRemoteWorkdir(undefined, "/public/home/hanmk_sg")).toBe("/public/home/hanmk_sg")
    expect(sshRemoteWorkdir("C:\\\\Users\\\\me", "/public/home/hanmk_sg")).toBe("/public/home/hanmk_sg")
    expect(sshRemoteWorkdir("/tmp/work", "/public/home/hanmk_sg")).toBe("/tmp/work")
  })

  test("resolves an enabled SSH target from config", () => {
    expect(
      resolveSshShellTarget("core1", {
        core1: {
          host: "alias",
          hostName: "1.2.3.4",
          username: "alice",
          remotePath: "/work/alice",
          auth: { type: "key", keyPath: "/secret/id_rsa" },
        },
        off: { host: "x", remotePath: "/x", enabled: false },
      }),
    ).toMatchObject({
      name: "core1",
      remotePath: "/work/alice",
      ssh: { host: "alias", hostName: "1.2.3.4", username: "alice" },
    })
    expect(resolveSshShellTarget("off", { off: { host: "x", remotePath: "/x", enabled: false } })).toBeUndefined()
    expect(resolveSshShellTarget("missing", {})).toBeUndefined()
  })
})
