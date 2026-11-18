import { afterEach, describe, expect, test } from "bun:test"
import { Option, Redacted } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ServerAuth } from "../../src/server/auth"

const original = {
  OPENCODE_SERVER_PASSWORD: Flag.OPENCODE_SERVER_PASSWORD,
  OPENCODE_SERVER_USERNAME: Flag.OPENCODE_SERVER_USERNAME,
  envPassword: process.env.OPENCODE_SERVER_PASSWORD,
  envUsername: process.env.OPENCODE_SERVER_USERNAME,
}

afterEach(() => {
  Flag.OPENCODE_SERVER_PASSWORD = original.OPENCODE_SERVER_PASSWORD
  Flag.OPENCODE_SERVER_USERNAME = original.OPENCODE_SERVER_USERNAME
  if (original.envPassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
  else process.env.OPENCODE_SERVER_PASSWORD = original.envPassword
  if (original.envUsername === undefined) delete process.env.OPENCODE_SERVER_USERNAME
  else process.env.OPENCODE_SERVER_USERNAME = original.envUsername
})

describe("ServerAuth", () => {
  test("does not emit auth headers without a password", () => {
    Flag.OPENCODE_SERVER_PASSWORD = undefined
    Flag.OPENCODE_SERVER_USERNAME = "alice"

    expect(ServerAuth.header()).toBeUndefined()
    expect(ServerAuth.headers()).toBeUndefined()
  })

  test("defaults to token-only auth", () => {
    Flag.OPENCODE_SERVER_PASSWORD = "secret"
    Flag.OPENCODE_SERVER_USERNAME = undefined

    expect(ServerAuth.headers()).toEqual({
      Authorization: `Basic ${Buffer.from(":secret").toString("base64")}`,
    })
  })

  test("uses the configured username", () => {
    Flag.OPENCODE_SERVER_PASSWORD = "secret"
    Flag.OPENCODE_SERVER_USERNAME = "alice"

    expect(ServerAuth.headers()).toEqual({
      Authorization: `Basic ${Buffer.from("alice:secret").toString("base64")}`,
    })
  })

  test("prefers explicit credentials", () => {
    Flag.OPENCODE_SERVER_PASSWORD = "secret"
    Flag.OPENCODE_SERVER_USERNAME = "alice"

    expect(ServerAuth.headers({ password: "cli-secret", username: "bob" })).toEqual({
      Authorization: `Basic ${Buffer.from("bob:cli-secret").toString("base64")}`,
    })
  })

  test("uses token-only credentials when no username is configured", () => {
    Flag.OPENCODE_SERVER_PASSWORD = "secret"
    Flag.OPENCODE_SERVER_USERNAME = undefined

    expect(ServerAuth.header()).toBe(`Basic ${Buffer.from(":secret").toString("base64")}`)
    expect(ServerAuth.token()).toBe(Buffer.from(":secret").toString("base64"))
    expect(ServerAuth.urlToken()).toBe("secret")
  })

  test("validates decoded credentials against effect config", () => {
    const previous = process.env.OPENCODE_CLIENT
    delete process.env.OPENCODE_CLIENT
    const config = { password: Option.some("secret"), username: "alice" }

    expect(ServerAuth.required(config)).toBe(true)
    expect(ServerAuth.authorized({ username: "alice", password: Redacted.make("secret") }, config)).toBe(true)
    expect(ServerAuth.authorized({ username: "opencode", password: Redacted.make("secret") }, config)).toBe(false)
    if (previous === undefined) delete process.env.OPENCODE_CLIENT
    else process.env.OPENCODE_CLIENT = previous
  })

  test("ignores shared-password gate for serve/web clients", () => {
    const previous = process.env.OPENCODE_CLIENT
    process.env.OPENCODE_CLIENT = "serve"
    const config = { password: Option.some("secret"), username: "alice" }

    expect(ServerAuth.required(config)).toBe(false)
    expect(ServerAuth.authorized({ username: "alice", password: Redacted.make("secret") }, config)).toBe(false)
    process.env.OPENCODE_CLIENT = "web"
    expect(ServerAuth.required(config)).toBe(false)
    if (previous === undefined) delete process.env.OPENCODE_CLIENT
    else process.env.OPENCODE_CLIENT = previous
  })

  test("validates token-only credentials against empty username config", () => {
    const previous = process.env.OPENCODE_CLIENT
    delete process.env.OPENCODE_CLIENT
    const config = { password: Option.some("secret"), username: "" }

    expect(ServerAuth.required(config)).toBe(true)
    expect(ServerAuth.authorized({ username: "", password: Redacted.make("secret") }, config)).toBe(true)
    expect(ServerAuth.authorized({ username: "opencode", password: Redacted.make("secret") }, config)).toBe(false)
    if (previous === undefined) delete process.env.OPENCODE_CLIENT
    else process.env.OPENCODE_CLIENT = previous
  })

  test("never enables workspace gate from env or credentials", () => {
    process.env.OPENCODE_SERVER_PASSWORD = "secret"
    process.env.OPENCODE_SERVER_USERNAME = "alice"
    Flag.OPENCODE_SERVER_PASSWORD = "secret"
    Flag.OPENCODE_SERVER_USERNAME = "alice"

    expect(ServerAuth.hasRetiredWorkspaceGateInput({ token: "legacy" })).toBe(true)
    expect(ServerAuth.ensureStartupAuth({ username: "bob", password: "cli-secret" })).toEqual({
      enabled: false,
      generated: false,
      username: "",
      password: undefined,
    })
    expect(process.env.OPENCODE_SERVER_PASSWORD).toBeUndefined()
    expect(process.env.OPENCODE_SERVER_USERNAME).toBeUndefined()
    expect(Flag.OPENCODE_SERVER_PASSWORD).toBeUndefined()
    expect(Flag.OPENCODE_SERVER_USERNAME).toBeUndefined()
  })

  test("leaves auth disabled when no password is configured", () => {
    delete process.env.OPENCODE_SERVER_PASSWORD
    delete process.env.OPENCODE_SERVER_USERNAME
    Flag.OPENCODE_SERVER_PASSWORD = undefined
    Flag.OPENCODE_SERVER_USERNAME = undefined

    const auth = ServerAuth.ensureStartupAuth()

    expect(auth).toEqual({ enabled: false, generated: false, username: "", password: undefined })
    expect(process.env.OPENCODE_SERVER_PASSWORD).toBeUndefined()
    expect(process.env.OPENCODE_SERVER_USERNAME).toBeUndefined()
    expect(Flag.OPENCODE_SERVER_PASSWORD).toBeUndefined()
    expect(ServerAuth.header()).toBeUndefined()
  })
})
