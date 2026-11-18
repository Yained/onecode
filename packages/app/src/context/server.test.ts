import { describe, expect, test } from "bun:test"
import { createSshServerConnection, resolveServerList, ServerConnection } from "./server"

describe("resolveServerList", () => {
  test("lets startup auth_token credentials override a persisted same-url server", () => {
    const list = resolveServerList({
      stored: [{ url: "https://server.example.test" }],
      props: [
        {
          type: "http",
          authToken: true,
          http: {
            url: "https://server.example.test",
            username: "opencode",
            password: "secret",
          },
        },
      ],
    })

    expect(list).toHaveLength(1)
    expect(list[0]?.type).toBe("http")
    expect(list[0]?.http).toEqual({
      url: "https://server.example.test",
      username: "opencode",
      password: "secret",
    })
    expect(list[0]?.type === "http" ? list[0].authToken : false).toBe(true)
    expect(ServerConnection.key(list[0]!) as string).toBe("https://server.example.test")
  })

  test("keeps persisted credentials when startup has no auth_token", () => {
    const list = resolveServerList({
      stored: [
        {
          url: "https://server.example.test",
          username: "opencode",
          password: "saved",
        },
      ],
      props: [{ type: "http", http: { url: "https://server.example.test" } }],
    })

    expect(list).toHaveLength(1)
    expect(list[0]?.type).toBe("http")
    expect(list[0]?.http).toEqual({
      url: "https://server.example.test",
      username: "opencode",
      password: "saved",
    })
    expect(list[0]?.type === "http" ? list[0].authToken : true).toBeUndefined()
  })

  test("keys ssh servers by host and remote path", () => {
    const conn: ServerConnection.Ssh = {
      type: "ssh",
      host: "devbox",
      remotePath: "/home/user/app",
      http: { url: "http://127.0.0.1:43101" },
    }

    expect(ServerConnection.key(conn) as string).toBe("ssh:devbox:/home/user/app")
  })

  test("keeps ssh servers with different remote paths on the same host", () => {
    const list = resolveServerList({
      stored: [
        {
          type: "ssh",
          host: "devbox",
          remotePath: "/home/user/app",
          http: { url: "http://127.0.0.1:43101" },
        },
        {
          type: "ssh",
          host: "devbox",
          remotePath: "/home/user/other",
          http: { url: "http://127.0.0.1:43102" },
        },
      ],
    })

    expect(list).toHaveLength(2)
    expect(list.map((conn) => ServerConnection.key(conn) as string)).toEqual([
      "ssh:devbox:/home/user/app",
      "ssh:devbox:/home/user/other",
    ])
  })

  test("lets startup ssh tunnel override a persisted same remote path server", () => {
    const list = resolveServerList({
      stored: [
        {
          type: "ssh",
          host: "devbox",
          remotePath: "/home/user/app",
          http: { url: "http://127.0.0.1:43101" },
        },
      ],
      props: [
        {
          type: "ssh",
          host: "devbox",
          remotePath: "/home/user/app",
          tunnel: { localPort: 43102, remotePort: 43102, status: "connected" },
          http: { url: "http://127.0.0.1:43102" },
        },
      ],
    })

    expect(list).toHaveLength(1)
    expect(list[0]?.type).toBe("ssh")
    expect(list[0]?.http.url).toBe("http://127.0.0.1:43102")
  })

  test("creates a web ssh server connection through the current http control plane", () => {
    const conn = createSshServerConnection({
      host: " devbox ",
      remotePath: " /home/user/app ",
      displayName: " DevBox ",
      username: " alice ",
      port: "2202",
      keyPath: " ~/.ssh/id_ed25519 ",
      command: " /opt/onecode/bin/onecode ",
      remotePort: "43102",
      http: { url: "http://127.0.0.1:4096" },
    })

    expect(conn).toEqual({
      type: "ssh",
      host: "devbox",
      remotePath: "/home/user/app",
      displayName: "DevBox",
      username: "alice",
      port: 2202,
      auth: { type: "key", keyPath: "~/.ssh/id_ed25519" },
      startup: { command: "/opt/onecode/bin/onecode", remotePort: 43102 },
      http: { url: "http://127.0.0.1:4096" },
    })
    expect(ServerConnection.key(conn) as string).toBe("ssh:devbox:/home/user/app")
  })
})
