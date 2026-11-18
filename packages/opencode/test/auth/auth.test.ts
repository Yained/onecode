import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Auth } from "../../src/auth"
import * as PlatformAuth from "../../src/platform-auth/platform-auth"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import path from "path"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const node = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(Auth.defaultLayer, node))

describe("Auth", () => {
  it.live("set normalizes trailing slashes in keys", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("https://example.com/", {
          type: "wellknown",
          key: "TOKEN",
          token: "abc",
        })
        const data = yield* auth.all()
        expect(data["https://example.com"]).toBeDefined()
        expect(data["https://example.com/"]).toBeUndefined()
      }),
    ),
  )

  it.live("set cleans up pre-existing trailing-slash entry", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("https://example.com/", {
          type: "wellknown",
          key: "TOKEN",
          token: "old",
        })
        yield* auth.set("https://example.com", {
          type: "wellknown",
          key: "TOKEN",
          token: "new",
        })
        const data = yield* auth.all()
        const keys = Object.keys(data).filter((key) => key.includes("example.com"))
        expect(keys).toEqual(["https://example.com"])
        const entry = data["https://example.com"]!
        expect(entry.type).toBe("wellknown")
        if (entry.type === "wellknown") expect(entry.token).toBe("new")
      }),
    ),
  )

  it.live("remove deletes both trailing-slash and normalized keys", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("https://example.com", {
          type: "wellknown",
          key: "TOKEN",
          token: "abc",
        })
        yield* auth.remove("https://example.com/")
        const data = yield* auth.all()
        expect(data["https://example.com"]).toBeUndefined()
        expect(data["https://example.com/"]).toBeUndefined()
      }),
    ),
  )

  it.live("storedAll ignores OPENCODE_AUTH_CONTENT and reads persisted credentials", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        const previous = process.env.OPENCODE_AUTH_CONTENT
        process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({
          stale: { type: "api", key: "wrong" },
        })
        try {
          yield* auth.set("anthropic", {
            type: "api",
            key: "sk-stored",
          })
          const fromEnv = yield* auth.all()
          const fromDisk = yield* auth.storedAll()
          expect(fromEnv.stale).toBeDefined()
          expect(fromDisk.anthropic).toEqual({ type: "api", key: "sk-stored" })
          expect(fromDisk.stale).toBeUndefined()
        } finally {
          if (previous === undefined) delete process.env.OPENCODE_AUTH_CONTENT
          else process.env.OPENCODE_AUTH_CONTENT = previous
        }
      }),
    ),
  )

  it.live("set and remove are no-ops on keys without trailing slashes", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("anthropic", {
          type: "api",
          key: "sk-test",
        })
        const data = yield* auth.all()
        expect(data["anthropic"]).toBeDefined()
        yield* auth.remove("anthropic")
        const after = yield* auth.all()
        expect(after["anthropic"]).toBeUndefined()
      }),
    ),
  )

  it.live("scopes provider credentials to the current platform account", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        const accountA = {
          token: "token-a",
          expiresAt: Date.now() + 60_000,
          account: {
            id: "acct-a",
            email: "a@example.com",
            name: "A",
            status: "active" as const,
            timeCreated: Date.now(),
          },
          workspaces: [
            {
              id: "ws-a",
              slug: "a",
              name: "A",
              defaultEnvPath: "/tmp/a",
              role: "admin",
            },
          ],
          capabilities: { terminal: false },
        }
        const accountB = {
          ...accountA,
          token: "token-b",
          account: { ...accountA.account, id: "acct-b", email: "b@example.com", name: "B" },
        }

        yield* auth
          .set("openai", { type: "api", key: "sk-a" })
          .pipe(Effect.provideService(PlatformAuth.CurrentSession, PlatformAuth.CurrentSession.of({ session: accountA })))

        const seenByA = yield* auth
          .all()
          .pipe(Effect.provideService(PlatformAuth.CurrentSession, PlatformAuth.CurrentSession.of({ session: accountA })))
        const seenByB = yield* auth
          .all()
          .pipe(Effect.provideService(PlatformAuth.CurrentSession, PlatformAuth.CurrentSession.of({ session: accountB })))
        const seenGlobally = yield* auth.all()

        expect(seenByA.openai?.type === "api" && seenByA.openai.key).toBe("sk-a")
        expect(seenByB.openai).toBeUndefined()
        expect(seenGlobally.openai).toBeUndefined()
        expect(Auth.authFileForAccount("acct-a")).toBe(
          path.join(Global.Path.data, "platform-credentials", "acct-a.json"),
        )
      }),
    ),
  )
})
