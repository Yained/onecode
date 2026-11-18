import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { existsSync, readFileSync } from "node:fs"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { McpAuth } from "../../src/mcp/auth"
import * as PlatformAuth from "../../src/platform-auth/platform-auth"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const node = CrossSpawnSpawner.defaultLayer
const it = testEffect(Layer.mergeAll(McpAuth.defaultLayer, node))

function session(id: string): PlatformAuth.AuthSession {
  return {
    token: `token-${id}`,
    expiresAt: Date.now() + 60_000,
    account: {
      id,
      email: `${id}@example.com`,
      name: id,
      status: "active",
      timeCreated: Date.now(),
    },
    workspaces: [
      {
        id: `ws-${id}`,
        slug: id,
        name: id,
        defaultEnvPath: `/tmp/${id}`,
        role: "admin",
      },
    ],
    capabilities: { terminal: false },
  }
}

describe("McpAuth account scoping", () => {
  it.live("mcpAuthFileForAccount scopes under platform-mcp-auth", () =>
    Effect.sync(() => {
      expect(McpAuth.sharedMcpAuthPath()).toBe(path.join(Global.Path.data, "mcp-auth.json"))
      expect(McpAuth.mcpAuthFileForAccount(undefined)).toBe(McpAuth.sharedMcpAuthPath())
      const file = McpAuth.mcpAuthFileForAccount("acc/with spaces!")
      expect(file).toBe(path.join(Global.Path.data, "platform-mcp-auth", "acc_with_spaces_.json"))
      expect(file).not.toContain(" ")
    }),
  )

  it.live("scopes OAuth tokens to the current platform account", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* McpAuth.Service
        const accountA = session("acct-mcp-a")
        const accountB = session("acct-mcp-b")
        const mcpName = "scnet"

        yield* auth
          .set(mcpName, {
            tokens: { accessToken: "token-a" },
            serverUrl: "https://mcp.example/a",
          })
          .pipe(Effect.provideService(PlatformAuth.CurrentSession, PlatformAuth.CurrentSession.of({ session: accountA })))

        yield* auth
          .set(mcpName, {
            tokens: { accessToken: "token-b" },
            serverUrl: "https://mcp.example/b",
          })
          .pipe(Effect.provideService(PlatformAuth.CurrentSession, PlatformAuth.CurrentSession.of({ session: accountB })))

        const seenByA = yield* auth
          .get(mcpName)
          .pipe(Effect.provideService(PlatformAuth.CurrentSession, PlatformAuth.CurrentSession.of({ session: accountA })))
        const seenByB = yield* auth
          .get(mcpName)
          .pipe(Effect.provideService(PlatformAuth.CurrentSession, PlatformAuth.CurrentSession.of({ session: accountB })))
        const seenGlobally = yield* auth.get(mcpName)

        expect(seenByA?.tokens?.accessToken).toBe("token-a")
        expect(seenByA?.serverUrl).toBe("https://mcp.example/a")
        expect(seenByB?.tokens?.accessToken).toBe("token-b")
        expect(seenByB?.serverUrl).toBe("https://mcp.example/b")
        expect(seenGlobally).toBeUndefined()

        const fileA = McpAuth.mcpAuthFileForAccount("acct-mcp-a")
        const fileB = McpAuth.mcpAuthFileForAccount("acct-mcp-b")
        expect(existsSync(fileA)).toBe(true)
        expect(existsSync(fileB)).toBe(true)
        expect(fileA).not.toBe(fileB)
        expect(JSON.parse(readFileSync(fileA, "utf8"))[mcpName].tokens.accessToken).toBe("token-a")
        expect(JSON.parse(readFileSync(fileB, "utf8"))[mcpName].tokens.accessToken).toBe("token-b")
        expect(existsSync(McpAuth.sharedMcpAuthPath())).toBe(false)
      }),
    ),
  )
})
