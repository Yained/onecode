import { describe, expect, test } from "bun:test"
import {
  collectSshTargetUsage,
  connectedSshMutation,
  formatSshTargetProjectNames,
  sshConfigSnapshot,
  sshDisableRequested,
  sshIdentityChanged,
  sshTargetBusyMessage,
} from "../../src/config/ssh-target-usage"

const parseExecution = (raw: unknown) => raw as { kind: string; sshTarget?: string } | undefined
const parseWorkspace = (extra: unknown) => extra as { sshTarget?: string } | undefined

describe("ssh target usage", () => {
  test("lists bound and connected projects for an SSH name", () => {
    const usage = collectSshTargetUsage({
      sshTarget: "core1",
      projects: [
        { id: "p1", name: "alpha", worktree: "/work/alpha", execution: { kind: "ssh", sshTarget: "core1" } },
        { id: "p2", name: "beta", worktree: "/work/beta", execution: { kind: "ssh", sshTarget: "core1" } },
        { id: "p3", name: "local", worktree: "/work/local", execution: { kind: "local" } },
      ],
      workspaces: [{ type: "ssh-node", project_id: "p1", extra: { sshTarget: "core1" } }],
      parseExecution,
      parseWorkspace,
      workspaceType: "ssh-node",
    })
    expect(usage.map((item) => ({ name: item.name, connected: item.connected }))).toEqual([
      { name: "alpha", connected: true },
      { name: "beta", connected: false },
    ])
    expect(formatSshTargetProjectNames(usage.filter((item) => item.connected))).toBe("alpha")
  })

  test("detects identity, disable, and rename mutations", () => {
    const previous = { host: "hpc", hostName: "10.0.0.1", username: "ubuntu", port: 22, enabled: true, auth: { type: "key", keyPath: "/k" } }
    expect(sshIdentityChanged(previous, { ...previous, hostName: "10.0.0.2" })).toBe(true)
    expect(sshIdentityChanged(previous, { ...previous, auth: { type: "key", keyPath: "/k2" } })).toBe(true)
    expect(sshIdentityChanged(previous, { ...previous, remotePath: "/other" } as typeof previous)).toBe(false)
    expect(sshDisableRequested(previous, { ...previous, enabled: false })).toBe(true)
    expect(connectedSshMutation({ previousName: "core1", nextName: "core2", previous, next: previous })).toBe("rename")
    expect(connectedSshMutation({ previousName: "core1", nextName: "core1", previous, next: { ...previous, username: "root" } })).toBe(
      "identity",
    )
    expect(connectedSshMutation({ previousName: "core1", nextName: "core1", previous, next: { ...previous, enabled: false } })).toBe(
      "disable",
    )
    expect(connectedSshMutation({ previousName: "core1", nextName: "core1", previous, next: previous })).toBeUndefined()
  })

  test("snapshots identity from product overlay", () => {
    const snapshot = sshConfigSnapshot(
      "core1",
      { core1: { host: "hpc", hostName: "10.0.0.1", enabled: true, auth: { type: "password", password: "secret" } } },
      { core1: { host: "hpc", hostName: "10.0.0.1", username: "ubuntu", auth: { type: "key", keyPath: "/k" } } },
    )
    expect(snapshot?.username).toBe("ubuntu")
    expect(snapshot?.auth).toEqual({ type: "password", password: "secret" })
  })

  test("formats a connected-busy message", () => {
    expect(sshTargetBusyMessage("remove", "core1", ["alpha", "beta"])).toContain("alpha、beta")
    expect(sshTargetBusyMessage("identity", "core1", [])).toContain("未知项目")
  })
})
