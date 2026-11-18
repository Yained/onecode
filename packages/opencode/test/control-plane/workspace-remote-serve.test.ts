import { describe, expect, test, afterEach } from "bun:test"
import { readFileSync } from "fs"
import path from "path"
import { mergeCustomProviderEnvAuth } from "../../src/control-plane/remote-serve-env"
const sshNodeSource = readFileSync(
  path.join(import.meta.dir, "../../src/control-plane/adapters/ssh-node.ts"),
  "utf8",
)
const workspaceSource = readFileSync(
  path.join(import.meta.dir, "../../src/control-plane/workspace.ts"),
  "utf8",
)
const remoteServeEnvSource = readFileSync(
  path.join(import.meta.dir, "../../src/control-plane/remote-serve-env.ts"),
  "utf8",
)

describe("mergeCustomProviderEnvAuth", () => {
  const previous = process.env.RELAY_API_KEY

  afterEach(() => {
    if (previous === undefined) delete process.env.RELAY_API_KEY
    else process.env.RELAY_API_KEY = previous
  })

  test("fills missing auth entries from provider env vars", () => {
    process.env.RELAY_API_KEY = "sk-from-env"
    const auth: Record<string, { type: "api"; key: string }> = {}
    const providers = {
      relay: {
        npm: "@ai-sdk/openai-compatible",
        name: "relay",
        env: ["RELAY_API_KEY"],
        options: { baseURL: "https://relay.example/v1" },
        models: { "m-1": { name: "m-1" } },
      },
    }

    const merged = mergeCustomProviderEnvAuth(auth, providers)
    expect(merged.relay).toEqual({ type: "api", key: "sk-from-env" })
  })

  test("does not override stored auth", () => {
    process.env.RELAY_API_KEY = "sk-from-env"
    const auth: Record<string, { type: "api"; key: string }> = {
      relay: { type: "api", key: "sk-stored" },
    }
    const providers = {
      relay: {
        npm: "@ai-sdk/openai-compatible",
        env: ["RELAY_API_KEY"],
        options: { baseURL: "https://relay.example/v1" },
        models: { "m-1": { name: "m-1" } },
      },
    }

    expect(mergeCustomProviderEnvAuth(auth, providers).relay).toEqual({ type: "api", key: "sk-stored" })
  })
})

describe("remote SSH serve sync", () => {
  test("ssh-node always writes overlay, auth, and kills reused serve on connect", () => {
    expect(sshNodeSource).toContain("await writeRemoteFile(target, authFile, auth ?? \"{}\")")
    expect(sshNodeSource).toContain("await writeRemoteFile(target, platformConfigPath, platformConfigContent)")
    expect(sshNodeSource).toContain("OPENCODE_CONFIG: platformConfigPath")
    expect(sshNodeSource).toContain("remoteKillScript(info.id, { remotePath, port: remotePort })")
    expect(sshNodeSource).not.toMatch(/if \(platformConfigContent && platformConfigPath\)/)
  })

  test("buildRemoteServeEnv uses stored auth and always emits platform overlay", () => {
    expect(workspaceSource).toContain("auth.storedAll()")
    expect(workspaceSource).toContain('from "./remote-serve-env"')
    expect(workspaceSource).toContain("OPENCODE_PLATFORM_CONFIG_CONTENT: platformConfigContent")
    expect(workspaceSource).not.toMatch(/platformConfigContent\s*\?\s*\{\s*OPENCODE_PLATFORM_CONFIG_CONTENT/)
    // Schema.Class Oauth is not assignable to Record<string, unknown>.
    expect(remoteServeEnvSource).toContain("mergeCustomProviderEnvAuth<T extends object>")
    expect(remoteServeEnvSource).not.toContain("Record<string, unknown>")
  })
})
