import { describe, expect, test } from "bun:test"
import { getAdapter, listAdapters, registerAdapter } from "../../src/control-plane/adapters"
import { ProjectID } from "../../src/project/schema"
import type { WorkspaceInfo } from "../../src/control-plane/types"

function info(projectID: WorkspaceInfo["projectID"], type: string): WorkspaceInfo {
  return {
    id: "workspace-test" as WorkspaceInfo["id"],
    type,
    name: "workspace-test",
    branch: null,
    directory: null,
    extra: null,
    projectID,
  }
}

function adapter(dir: string) {
  return {
    name: dir,
    description: dir,
    configure(input: WorkspaceInfo) {
      return input
    },
    async create() {},
    async remove() {},
    target() {
      return {
        type: "local" as const,
        directory: dir,
      }
    },
  }
}

describe("control-plane/adapters", () => {
  test("registers the builtin ssh-node adapter", () => {
    const id = ProjectID.make(`project-${Math.random().toString(36).slice(2)}`)
    expect(listAdapters(id).some((item) => item.type === "ssh-node")).toBe(true)
    expect(getAdapter(id, "ssh-node").name).toBe("SSH 节点")
  })

  test("ssh-node remove does not recreate a leaf and verifies the serve is dead", async () => {
    const source = await Bun.file(new URL("../../src/control-plane/adapters/ssh-node.ts", import.meta.url)).text()
    expect(source).toContain("opts?.create !== false")
    expect(source).toContain("无法停止远端 onecode serve")
    expect(source).toContain("info.extra = extra")
    expect(source).toContain("withCreateLock")
    expect(source).toContain("tunnelAlive")
    expect(source).toContain("isConnectProgressComplete")
    expect(source).toContain("waitForServeReadyMark")
    expect(source).toContain("dropLiveForPath")
    expect(source).toContain("stopAllSshNodeHeartbeats")
    expect(source).toContain("async function retunnel")
    expect(source).toContain("runWorkspacePreflightChecks")
    expect(source).toContain('markConnectStep(progressKey, "preflight")')
    expect(source).toContain("await retunnel(info)")
    expect(source).toContain("reuseOnly: true")
    expect(source).not.toContain("remotePathLeafAliveScript")
    expect(source).not.toContain("remoteKillExtraPathLeafsScript")
    expect(source).not.toContain("existing?.workspaceID === info.id && existing.servePort")
  })

  test("resolves HOME without a login shell", async () => {
    const source = await Bun.file(new URL("../../src/control-plane/adapters/ssh-node.ts", import.meta.url)).text()
    expect(source).toContain("runRemote(target, REMOTE_HOME_SCRIPT, 20_000, { login: false })")
  })

  test("pins serve health and tunnel onto one SSH session", async () => {
    const source = await Bun.file(new URL("../../src/control-plane/adapters/ssh-node.ts", import.meta.url)).text()
    expect(source).toContain("startPinnedServeTunnel")
    expect(source).toContain("pickEphemeralPort")
    expect(source).toContain("newLeaseToken")
    expect(source).toContain("remotePinnedKeepaliveScript")
    expect(source).toContain("login: false")
    expect(source).not.toContain("waitForRemoteHealth")
    expect(source).not.toContain("tryReuse")
    expect(source).toContain("abortSshNodeConnect")
    expect(source).toContain("Process.stop")
    expect(source).toContain("ready: false")
    expect(source).toContain("throwIfConnectAborted")
    expect(source).toContain("writeRemoteFile")
    expect(source).toContain("reusedServe")
    expect(source).toContain("waitForLeafReady")
    expect(source).toContain("remoteRefreshLeaseScript")
    expect(source).toContain("remoteKillScript(info.id")
    expect(source).toContain("leaveForReuse")
    expect(source).toContain("健康检查超时")
    expect(source).not.toContain("remoteReclaimServeScript")
    expect(source).not.toContain("LIVE_HEALTH_MS")
    expect(source).not.toContain("remoteWriteCatalogTokenScript")
  })
  test("isolates custom adapters by project", async () => {
    const type = `demo-${Math.random().toString(36).slice(2)}`
    const one = ProjectID.make(`project-${Math.random().toString(36).slice(2)}`)
    const two = ProjectID.make(`project-${Math.random().toString(36).slice(2)}`)
    registerAdapter(one, type, adapter("/one"))
    registerAdapter(two, type, adapter("/two"))

    expect(await (await getAdapter(one, type)).target(info(one, type))).toEqual({
      type: "local",
      directory: "/one",
    })
    expect(await (await getAdapter(two, type)).target(info(two, type))).toEqual({
      type: "local",
      directory: "/two",
    })
  })

  test("latest install wins within a project", async () => {
    const type = `demo-${Math.random().toString(36).slice(2)}`
    const id = ProjectID.make(`project-${Math.random().toString(36).slice(2)}`)
    registerAdapter(id, type, adapter("/one"))

    expect(await (await getAdapter(id, type)).target(info(id, type))).toEqual({
      type: "local",
      directory: "/one",
    })

    registerAdapter(id, type, adapter("/two"))

    expect(await (await getAdapter(id, type)).target(info(id, type))).toEqual({
      type: "local",
      directory: "/two",
    })
  })
})
