import { describe, expect, test } from "bun:test"
import { createSshRemoteManager, planSshConnection, sshConnectionKey, sshStatusLabel } from "./ssh-remote"

describe("ssh remote planning", () => {
  test("builds ssh commands from a config alias and remote path", () => {
    const plan = planSshConnection(
      {
        host: "devbox",
        remotePath: "/home/user/app",
      },
      { localPort: 43101, remotePort: 43102 },
    )

    expect(plan.key).toBe("ssh:devbox:/home/user/app")
    expect(plan.checkDirectory).toEqual({
      command: "ssh",
      args: ["devbox", "test -d '/home/user/app'"],
    })
    expect(plan.checkOpencode).toEqual({
      command: "ssh",
      args: ["devbox", "command -v onecode"],
    })
    expect(plan.startServer).toEqual({
      command: "ssh",
      args: ["devbox", "cd '/home/user/app' && onecode serve --hostname 127.0.0.1 --port 43102"],
    })
    expect(plan.tunnel).toEqual({
      command: "ssh",
      args: ["-N", "-L", "127.0.0.1:43101:127.0.0.1:43102", "devbox"],
    })
    expect(plan.http.url).toBe("http://127.0.0.1:43101")
  })

  test("builds ssh commands with username, port, key, and custom startup command", () => {
    const plan = planSshConnection(
      {
        host: "10.0.0.8",
        port: 2202,
        username: "alice",
        remotePath: "/srv/one science/app",
        auth: { type: "key", keyPath: "/home/alice/.ssh/id_ed25519" },
        startup: { command: "env OPENCODE_DISABLE_UPDATE=1 /opt/onecode/bin/onecode" },
      },
      { localPort: 43101, remotePort: 43102 },
    )

    expect(plan.checkDirectory.args).toEqual([
      "-p",
      "2202",
      "-i",
      "/home/alice/.ssh/id_ed25519",
      "alice@10.0.0.8",
      "test -d '/srv/one science/app'",
    ])
    expect(plan.checkOpencode.args.at(-1)).toBe("command -v /opt/onecode/bin/onecode")
    expect(plan.startServer.args.at(-1)).toBe(
      "cd '/srv/one science/app' && env OPENCODE_DISABLE_UPDATE=1 /opt/onecode/bin/onecode serve --hostname 127.0.0.1 --port 43102",
    )
    expect(plan.tunnel.args).toEqual([
      "-p",
      "2202",
      "-i",
      "/home/alice/.ssh/id_ed25519",
      "-N",
      "-L",
      "127.0.0.1:43101:127.0.0.1:43102",
      "alice@10.0.0.8",
    ])
  })

  test("uses host and remote path as the stable connection key", () => {
    expect(sshConnectionKey({ host: "devbox", remotePath: "/a" })).toBe("ssh:devbox:/a")
    expect(sshConnectionKey({ host: "devbox", remotePath: "/b" })).toBe("ssh:devbox:/b")
  })

  test("maps internal states to user-facing status labels", () => {
    expect(sshStatusLabel("connected")).toBe("已连接")
    expect(sshStatusLabel("auth_failed")).toBe("SSH 认证失败")
    expect(sshStatusLabel("missing_opencode")).toBe("远端 onecode 未安装")
    expect(sshStatusLabel("tunnel_failed")).toBe("隧道已断开")
  })

  test("disconnectAll is safe when there are no connections", () => {
    const manager = createSshRemoteManager()

    manager.disconnectAll()

    expect(manager.status("ssh:devbox:/home/user/app")).toEqual({
      key: "ssh:devbox:/home/user/app",
      status: "disconnected",
    })
  })
})
