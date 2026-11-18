import { describe, expect, test } from "bun:test"
import { terminalWebSocketURL } from "./terminal-websocket-url"

describe("terminalWebSocketURL", () => {
  test("uses query auth without embedding credentials in websocket URL", () => {
    const url = terminalWebSocketURL({
      url: "http://127.0.0.1:49365",
      id: "pty_test",
      directory: "/tmp/project",
      cursor: 0,
      sameOrigin: false,
      username: "opencode",
      password: "secret",
    })

    expect(url.protocol).toBe("ws:")
    expect(url.username).toBe("")
    expect(url.password).toBe("")
    expect(url.searchParams.get("auth_token")).toBe(btoa("opencode:secret"))
  })

  test("omits query auth for same-origin saved credentials", () => {
    const url = terminalWebSocketURL({
      url: "https://app.example.test",
      id: "pty_test",
      directory: "/tmp/project",
      cursor: 10,
      sameOrigin: true,
      username: "opencode",
      password: "secret",
    })

    expect(url.protocol).toBe("wss:")
    expect(url.searchParams.has("auth_token")).toBe(false)
  })

  test("uses query auth for same-origin credentials from auth_token", () => {
    const url = terminalWebSocketURL({
      url: "https://app.example.test",
      id: "pty_test",
      directory: "/tmp/project",
      cursor: 10,
      sameOrigin: true,
      password: "secret",
      authToken: true,
    })

    expect(url.protocol).toBe("wss:")
    expect(url.searchParams.get("auth_token")).toBe(btoa(":secret"))
  })

  test("attaches workspace so the control plane can proxy PTY connect to the leaf", () => {
    const url = terminalWebSocketURL({
      url: "http://127.0.0.1:4096",
      id: "pty_test",
      directory: "/data/local/project",
      cursor: 0,
      ticket: "ticket-1",
      workspace: "wrk_remote",
    })

    expect(url.searchParams.get("workspace")).toBe("wrk_remote")
    expect(url.searchParams.get("ticket")).toBe("ticket-1")
  })

  test("omits workspace when the PTY host is local", () => {
    const url = terminalWebSocketURL({
      url: "http://127.0.0.1:4096",
      id: "pty_test",
      directory: "/data/local/project",
      cursor: 0,
    })

    expect(url.searchParams.has("workspace")).toBe(false)
  })
})
