import { afterEach, describe, expect, test } from "bun:test"
import { Context } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import * as PlatformAuth from "../../src/platform-auth/platform-auth"
import { PtyPaths } from "../../src/server/routes/instance/httpapi/groups/pty"
import { SessionPaths } from "../../src/server/routes/instance/httpapi/groups/session"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"

void Log.init({ print: false })

const context = Context.empty() as Context.Context<unknown>

async function withEnv<T>(entries: Record<string, string | undefined>, run: () => T | Promise<T>) {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(entries)) {
    previous.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return await run()
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function request(token: string, pathname: string, init?: RequestInit) {
  return ExperimentalHttpApiServer.webHandler().handler(
    new Request(`http://localhost${pathname}`, {
      ...init,
      headers: {
        "x-platform-auth-token": token,
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(init?.headers instanceof Headers
          ? Object.fromEntries(init.headers.entries())
          : Array.isArray(init?.headers)
            ? Object.fromEntries(init.headers)
            : init?.headers),
      },
    }),
    context,
  )
}

describe("terminal HttpApi account isolation", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("forbids PTY creation for platform account sessions", async () => {
    await resetDatabase()

    await withEnv({ ONECODE_TERMINAL_ISOLATION: "disabled" }, async () => {
      const session = PlatformAuth.register({
        email: `pty-blocked-${crypto.randomUUID().slice(0, 8)}@example.com`,
        name: `pty-blocked-${crypto.randomUUID().slice(0, 8)}`,
        password: "password123",
      })
      const response = await request(session.token, PtyPaths.create, {
        method: "POST",
        body: JSON.stringify({ title: "blocked" }),
      })

      expect(response.status).toBe(403)
    })
  }, 20_000)

  test("forbids session shell execution for platform account sessions", async () => {
    await resetDatabase()

    await withEnv({ ONECODE_TERMINAL_ISOLATION: "disabled" }, async () => {
      const platform = PlatformAuth.register({
        email: `shell-blocked-${crypto.randomUUID().slice(0, 8)}@example.com`,
        name: `shell-blocked-${crypto.randomUUID().slice(0, 8)}`,
        password: "password123",
      })
      const created = await request(platform.token, SessionPaths.create, {
        method: "POST",
        body: JSON.stringify({ title: "blocked shell" }),
      })
      const info = (await created.json()) as { id: string; directory: string }

      expect(created.status).toBe(200)
      expect(info).toMatchObject({
        id: expect.any(String),
        directory: expect.any(String),
      })

      const response = await request(platform.token, SessionPaths.shell.replace(":sessionID", info.id), {
        method: "POST",
        body: JSON.stringify({ agent: "build", command: "echo blocked" }),
      })

      expect(response.status).toBe(403)
    })
  }, 20_000)

  test("allows PTY shell listing when terminal sandboxing is configured", async () => {
    await resetDatabase()

    await withEnv({ ONECODE_TERMINAL_ISOLATION: "docker", ONECODE_DOCKER_PATH: process.execPath }, async () => {
      const platform = PlatformAuth.register({
        email: `shells-enabled-${crypto.randomUUID().slice(0, 8)}@example.com`,
        name: `shells-enabled-${crypto.randomUUID().slice(0, 8)}`,
        password: "password123",
      })
      const response = await request(platform.token, PtyPaths.shells)
      const shells = (await response.json()) as Array<{ path: string; name: string; acceptable: boolean }>

      expect(response.status).toBe(200)
      expect(shells).toHaveLength(1)
      expect(shells[0]?.acceptable).toBe(true)
      expect(shells[0]?.path).toContain("bash")
      expect(shells[0]?.name).toContain("bash")
    })
  }, 20_000)
})
