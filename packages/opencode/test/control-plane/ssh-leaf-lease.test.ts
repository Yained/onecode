import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  applySshLeafServeEnv,
  isSshLeafLeaseExpired,
  isSshLeafLeaseSuperseded,
  isSshLeafServe,
  shouldWatchSshLeafLease,
  sshLeafLeaseFile,
  startSshLeafLeaseWatchdog,
} from "../../src/control-plane/adapters/ssh-leaf-lease"
import { LEASE_NAME, LEASE_TTL_MS } from "../../src/control-plane/adapters/ssh-node-exec"

describe("ssh leaf lease watchdog", () => {
  const timers: Array<ReturnType<typeof setInterval>> = []

  afterEach(() => {
    for (const timer of timers) clearInterval(timer)
    timers.length = 0
  })

  test("only watches ssh leaf processes", () => {
    expect(shouldWatchSshLeafLease({})).toBe(false)
    expect(shouldWatchSshLeafLease({ OPENCODE_WORKSPACE_ID: "wrk_1" })).toBe(true)
    expect(isSshLeafServe({})).toBe(false)
    expect(isSshLeafServe({ OPENCODE_WORKSPACE_ID: "wrk_1" })).toBe(true)
    expect(sshLeafLeaseFile("/tmp/ws")).toBe(path.join("/tmp/ws", LEASE_NAME))
  })

  test("disables hot reload and file watchers on ssh leaf serve", () => {
    const local: NodeJS.ProcessEnv = { OPENCODE_CLIENT: "serve" }
    expect(applySshLeafServeEnv(local)).toBe(false)
    expect(local.OPENCODE_HOT_RELOAD).toBeUndefined()

    const leaf: NodeJS.ProcessEnv = { OPENCODE_WORKSPACE_ID: "wrk_1", OPENCODE_CLIENT: "serve" }
    expect(applySshLeafServeEnv(leaf)).toBe(true)
    expect(leaf.OPENCODE_HOT_RELOAD).toBe("false")
    expect(leaf.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER).toBe("true")
    expect(leaf.OPENCODE_EXPERIMENTAL_FILEWATCHER).toBe("false")
  })

  test("expires a lease after the ttl", () => {
    expect(isSshLeafLeaseExpired(0, LEASE_TTL_MS - 1)).toBe(false)
    expect(isSshLeafLeaseExpired(0, LEASE_TTL_MS)).toBe(true)
  })

  test("exits when the lease file is missing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssh-leaf-lease-"))
    const exits: number[] = []
    const timer = startSshLeafLeaseWatchdog({
      env: { OPENCODE_WORKSPACE_ID: "wrk_1" },
      directory: dir,
      intervalMs: 20,
      exit: (code) => {
        exits.push(code)
      },
    })
    if (timer) timers.push(timer)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(exits).toEqual([0])
  })

  test("keeps running while the lease is fresh", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssh-leaf-lease-"))
    const file = sshLeafLeaseFile(dir)
    fs.writeFileSync(file, "ok")
    const exits: number[] = []
    const timer = startSshLeafLeaseWatchdog({
      env: { OPENCODE_WORKSPACE_ID: "wrk_1" },
      directory: dir,
      intervalMs: 20,
      exit: (code) => {
        exits.push(code)
      },
    })
    if (timer) timers.push(timer)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(exits).toEqual([])
  })

  test("exits when another login node supersedes the lease token", async () => {
    expect(isSshLeafLeaseSuperseded("old", "new")).toBe(true)
    expect(isSshLeafLeaseSuperseded("new", "new")).toBe(false)
    expect(isSshLeafLeaseSuperseded("new", "")).toBe(false)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssh-leaf-lease-"))
    const file = sshLeafLeaseFile(dir)
    fs.writeFileSync(file, "old-token")
    const exits: number[] = []
    const timer = startSshLeafLeaseWatchdog({
      env: { OPENCODE_WORKSPACE_ID: "wrk_1", OPENCODE_SSH_LEASE_TOKEN: "new-token" },
      directory: dir,
      intervalMs: 20,
      exit: (code) => {
        exits.push(code)
      },
    })
    if (timer) timers.push(timer)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(exits).toEqual([0])
  })
})
