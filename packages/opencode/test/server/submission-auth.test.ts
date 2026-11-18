import { test, expect } from "bun:test"
import { Server } from "../../src/server/server"
import * as PlatformAuth from "../../src/platform-auth/platform-auth"
import { tmpdir } from "../fixture/fixture"

test("real platform session can access integrated submission", async () => {
  await using dir = await tmpdir()
  const saved = { ...process.env }
  process.env.ONECODE_EXTRA_PATH = dir.path
  process.env.SUBMISSION_STORAGE_DIR = `${dir.path}/submission`
  delete process.env.ONECODE_SUBMISSION_URL
  delete process.env.ONECODE_SUBMISSION_ROOT
  const session = PlatformAuth.provision({ email: "submission-auth@example.com", name: "submission_auth", password: "fixture-password-only" })
  const host = await Server.listen({ port: 0, hostname: "127.0.0.1" })
  try {
    const direct = await fetch(new URL(`/platform/auth/session?token=${encodeURIComponent(session.token)}`, host.url))
    expect(direct.status).toBe(200)
    const response = await fetch(new URL("/intelligent-submission/api/projects", host.url), { headers: { Authorization: `Basic ${Buffer.from(`:${session.token}`).toString("base64")}` } })
    const body = await response.text()
    expect(response.status).toBe(200)
    expect(JSON.parse(body)).toEqual([])
    const invalid = await fetch(new URL("/intelligent-submission/api/projects", host.url), {
      headers: { Authorization: `Basic ${Buffer.from(":invalid-session").toString("base64")}` },
    })
    expect(invalid.status).toBe(401)
    await host.stop(true)
    const restarted = await Server.listen({ port: 0, hostname: "127.0.0.1" })
    try {
      const restored = await fetch(new URL("/intelligent-submission/api/projects", restarted.url), {
        headers: { Authorization: `Basic ${Buffer.from(`:${session.token}`).toString("base64")}` },
      })
      expect(restored.status).toBe(200)
    } finally {
      await restarted.stop(true)
    }
  } finally {
    await host.stop(true)
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
    Object.assign(process.env, saved)
  }
})
