import { describe, expect, test } from "bun:test"
import { resetRuntimeEnvironmentForTest, setRuntimeEnvironmentFor } from "./runtime-environment"
import { resetRemoteWorkspaceForTest, setRemoteWorkspaceFor } from "./remote-workspace"
import {
  cascadeClientSshTarget,
  formatSshTargetProjectNames,
  listSshTargetProjects,
  sshDisableRequested,
  sshFormIdentity,
  sshIdentityChanged,
} from "./ssh-target-usage"

describe("ssh target usage", () => {
  test("lists bound remote projects and connection state", () => {
    resetRuntimeEnvironmentForTest()
    resetRemoteWorkspaceForTest()
    setRuntimeEnvironmentFor("/work/alpha", { kind: "ssh", targetName: "core1" })
    setRuntimeEnvironmentFor("/work/beta", { kind: "ssh", targetName: "core1" })
    setRemoteWorkspaceFor("/work/alpha", { workspaceID: "ws-1", targetName: "core1", remotePath: "/data/a" })
    const usage = listSshTargetProjects({
      sshName: "core1",
      projects: [
        { name: "alpha", worktree: "/work/alpha", execution: { kind: "ssh", sshTarget: "core1" } },
        { name: "beta", worktree: "/work/beta", execution: { kind: "ssh", sshTarget: "core1" } },
        { name: "other", worktree: "/work/other", execution: { kind: "ssh", sshTarget: "core2" } },
      ],
    })
    expect(usage).toEqual([
      { directory: "/work/alpha", name: "alpha", connected: true },
      { directory: "/work/beta", name: "beta", connected: false },
    ])
    expect(formatSshTargetProjectNames(usage.filter((item) => item.connected))).toBe("alpha")
    resetRuntimeEnvironmentForTest()
    resetRemoteWorkspaceForTest()
  })

  test("detects identity changes from the SSH form", () => {
    const previous = sshFormIdentity({
      name: "core1",
      hostName: "10.0.0.1",
      username: "ubuntu",
      remotePath: "/data",
      port: "22",
      keyPath: "/k",
      authType: "key",
      password: "",
      options: "",
    })
    expect(sshIdentityChanged(previous, { ...previous, hostName: "10.0.0.2" })).toBe(true)
    expect(sshIdentityChanged(previous, { ...previous, auth: { type: "key", keyPath: "/k2" } })).toBe(true)
    expect(sshDisableRequested(previous, { ...previous, enabled: false })).toBe(true)
    expect(sshIdentityChanged(previous, previous)).toBe(false)
  })

  test("cascades client bindings after a disconnected rename", () => {
    resetRuntimeEnvironmentForTest()
    resetRemoteWorkspaceForTest()
    setRuntimeEnvironmentFor("/work/alpha", { kind: "ssh", targetName: "core1" })
    setRemoteWorkspaceFor("/work/alpha", { workspaceID: "", targetName: "core1", remotePath: "/data/a" })
    cascadeClientSshTarget("core1", "core2", ["/work/alpha"])
    const usage = listSshTargetProjects({
      sshName: "core2",
      projects: [{ name: "alpha", worktree: "/work/alpha", execution: { kind: "ssh", sshTarget: "core2" } }],
    })
    expect(usage).toEqual([{ directory: "/work/alpha", name: "alpha", connected: false }])
    resetRuntimeEnvironmentForTest()
    resetRemoteWorkspaceForTest()
  })
})
