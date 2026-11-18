import { describe, expect, test } from "bun:test"
import {
  applyServerRemoteWorkspace,
  boundWorkspaceID,
  clearRemoteWorkspaceUserStopped,
  forgetLiveRemoteWorkspacesForTest,
  isRemoteWorkspaceConnected,
  isRemoteWorkspaceUserStopped,
  isSshFileTreePending,
  lastKnownWorkspaceID,
  liveWorkspaceFromServer,
  markRemoteWorkspaceUserStopped,
  previewDefaultRemotePath,
  remoteHttpErrorMessage,
  remapRemoteEventDirectory,
  bindRemoteSessionDirectory,
  remoteProjectSlug,
  remoteWorkspaceFor,
  resetRemoteWorkspaceForTest,
  setRemoteWorkspaceFor,
  waitForWorkspaceFileList,
  fileWaitConnectSteps,
} from "./remote-workspace"
import { resetRuntimeEnvironmentForTest, setRuntimeEnvironmentFor } from "./runtime-environment"

describe("remote workspace binding", () => {
  test("persists user-stopped flag across memory reset (F5)", () => {
    resetRemoteWorkspaceForTest()
    markRemoteWorkspaceUserStopped("D:/work/proj")
    expect(isRemoteWorkspaceUserStopped("D:/work/proj")).toBe(true)
    const raw = localStorage.getItem("onescience.remote-workspace.stopped.v1")
    expect(raw).toBeTruthy()
    resetRemoteWorkspaceForTest()
    localStorage.setItem("onescience.remote-workspace.stopped.v1", raw!)
    expect(isRemoteWorkspaceUserStopped("D:/work/proj")).toBe(true)
    clearRemoteWorkspaceUserStopped("D:/work/proj")
    expect(isRemoteWorkspaceUserStopped("D:/work/proj")).toBe(false)
    resetRemoteWorkspaceForTest()
  })

  test("binds workspace id only for the matching ssh target", () => {
    resetRuntimeEnvironmentForTest()
    resetRemoteWorkspaceForTest()
    setRemoteWorkspaceFor("D:/work/proj", { workspaceID: "wrk_1", targetName: "core1" })
    expect(remoteWorkspaceFor("D:\\work\\proj")?.workspaceID).toBe("wrk_1")
    expect(boundWorkspaceID("D:/work/proj")).toBeUndefined()
    setRuntimeEnvironmentFor("D:/work/proj", { kind: "ssh", targetName: "core1" })
    expect(boundWorkspaceID("D:/work/proj")).toBe("wrk_1")
    setRuntimeEnvironmentFor("D:/work/proj", { kind: "ssh", targetName: "other" })
    expect(boundWorkspaceID("D:/work/proj")).toBeUndefined()
    setRuntimeEnvironmentFor("D:/work/proj", { kind: "local" })
    expect(boundWorkspaceID("D:/work/proj")).toBeUndefined()
    resetRuntimeEnvironmentForTest()
    resetRemoteWorkspaceForTest()
  })

  test("treats a remembered path with empty workspace id as disconnected", () => {
    resetRemoteWorkspaceForTest()
    resetRuntimeEnvironmentForTest()
    setRemoteWorkspaceFor("D:/work/proj", {
      workspaceID: "",
      targetName: "core1",
      remotePath: "/home/u/.onecode/workspaces/proj",
    })
    const binding = remoteWorkspaceFor("D:/work/proj")
    expect(binding?.targetName).toBe("core1")
    expect(isRemoteWorkspaceConnected(binding)).toBe(false)
    expect(isSshFileTreePending("D:/work/proj")).toBe(true)
    setRuntimeEnvironmentFor("D:/work/proj", { kind: "ssh", targetName: "core1" })
    expect(isSshFileTreePending("D:/work/proj")).toBe(true)
    resetRuntimeEnvironmentForTest()
    resetRemoteWorkspaceForTest()
  })

  test("persists last-known workspace id as cache but does not treat it as connected", () => {
    resetRuntimeEnvironmentForTest()
    resetRemoteWorkspaceForTest()
    setRuntimeEnvironmentFor("D:/work/proj", { kind: "ssh", targetName: "core1" })
    setRemoteWorkspaceFor("D:/work/proj", {
      workspaceID: "wrk_1",
      targetName: "core1",
      remotePath: "/home/u/.onecode/workspaces/proj",
    })
    expect(boundWorkspaceID("D:/work/proj")).toBe("wrk_1")
    forgetLiveRemoteWorkspacesForTest()
    expect(lastKnownWorkspaceID("D:/work/proj")).toBe("wrk_1")
    expect(boundWorkspaceID("D:/work/proj")).toBeUndefined()
    expect(remoteWorkspaceFor("D:/work/proj")?.targetName).toBe("core1")
    expect(isRemoteWorkspaceConnected(remoteWorkspaceFor("D:/work/proj"))).toBe(false)
    resetRuntimeEnvironmentForTest()
    resetRemoteWorkspaceForTest()
  })

  test("restores a live workspace id from control-plane list+status", () => {
    const list = [
      {
        id: "wrk_1",
        type: "ssh-node",
        extra: { sshTarget: "core1", remotePath: "/home/u/test_dir" },
      },
    ]
    expect(
      liveWorkspaceFromServer({
        targetName: "core1",
        list,
        status: [{ workspaceID: "wrk_1", status: "connected" }],
      }),
    ).toEqual({
      workspaceID: "wrk_1",
      targetName: "core1",
      remotePath: "/home/u/test_dir",
    })
    expect(
      liveWorkspaceFromServer({
        targetName: "core1",
        list,
        status: [],
      }),
    ).toBeUndefined()
    expect(
      liveWorkspaceFromServer({
        targetName: "core1",
        list,
        status: [{ workspaceID: "wrk_1", status: "disconnected" }],
      }),
    ).toBeUndefined()
    expect(
      liveWorkspaceFromServer({
        targetName: "other",
        list,
        status: [{ workspaceID: "wrk_1", status: "connected" }],
      }),
    ).toBeUndefined()
    expect(
      liveWorkspaceFromServer({
        targetName: "core1",
        list: [
          { id: "wrk_old", type: "ssh-node", extra: { sshTarget: "core1" } },
          { id: "wrk_1", type: "ssh-node", extra: { sshTarget: "core1" } },
        ],
        status: [
          { workspaceID: "wrk_old", status: "connected" },
          { workspaceID: "wrk_1", status: "connected" },
        ],
        preferredWorkspaceID: "wrk_1",
      })?.workspaceID,
    ).toBe("wrk_1")
  })

  test("applyServerRemoteWorkspace overlays control-plane status onto the live cache", () => {
    resetRuntimeEnvironmentForTest()
    resetRemoteWorkspaceForTest()
    setRuntimeEnvironmentFor("D:/work/proj", { kind: "ssh", targetName: "core1" })
    setRemoteWorkspaceFor("D:/work/proj", {
      workspaceID: "wrk_1",
      targetName: "core1",
      remotePath: "/home/u/.onecode/workspaces/proj",
    })
    forgetLiveRemoteWorkspacesForTest()
    expect(isRemoteWorkspaceConnected(remoteWorkspaceFor("D:/work/proj"))).toBe(false)
    const list = [
      {
        id: "wrk_1",
        type: "ssh-node",
        extra: { sshTarget: "core1", remotePath: "/home/u/test_dir" },
      },
    ]
    expect(
      applyServerRemoteWorkspace("D:/work/proj", {
        targetName: "core1",
        list,
        status: [{ workspaceID: "wrk_1", status: "connected" }],
      }),
    ).toEqual({
      workspaceID: "wrk_1",
      targetName: "core1",
      remotePath: "/home/u/test_dir",
    })
    expect(boundWorkspaceID("D:/work/proj")).toBe("wrk_1")
    expect(isRemoteWorkspaceConnected(remoteWorkspaceFor("D:/work/proj"))).toBe(true)
    expect(
      applyServerRemoteWorkspace("D:/work/proj", {
        targetName: "core1",
        list,
        status: [],
        clearIfAbsent: false,
      }),
    ).toBeUndefined()
    expect(isRemoteWorkspaceConnected(remoteWorkspaceFor("D:/work/proj"))).toBe(true)
    applyServerRemoteWorkspace("D:/work/proj", {
      targetName: "core1",
      list,
      status: [],
    })
    expect(isRemoteWorkspaceConnected(remoteWorkspaceFor("D:/work/proj"))).toBe(false)
    expect(lastKnownWorkspaceID("D:/work/proj")).toBe("")
    expect(remoteWorkspaceFor("D:/work/proj")?.targetName).toBe("core1")
    resetRuntimeEnvironmentForTest()
    resetRemoteWorkspaceForTest()
  })

  test("does not adopt a differently-pathed leftover workspace on the same SSH target", () => {
    expect(
      liveWorkspaceFromServer({
        targetName: "core1",
        preferredRemotePath: "/home/u/test_dir",
        localDirectory: "D:/work/proj",
        list: [
          {
            id: "wrk_default",
            type: "ssh-node",
            extra: {
              sshTarget: "core1",
              remotePath: "/home/u/.onecode/workspaces/proj",
              localDirectory: "D:/work/other",
            },
          },
          {
            id: "wrk_test",
            type: "ssh-node",
            extra: {
              sshTarget: "core1",
              remotePath: "/home/u/test_dir",
              localDirectory: "D:/work/proj",
            },
          },
        ],
        status: [
          { workspaceID: "wrk_default", status: "connected" },
          { workspaceID: "wrk_test", status: "connected" },
        ],
      }),
    ).toEqual({
      workspaceID: "wrk_test",
      targetName: "core1",
      remotePath: "/home/u/test_dir",
    })
    expect(
      liveWorkspaceFromServer({
        targetName: "core1",
        preferredRemotePath: "/home/u/test_dir",
        list: [
          {
            id: "wrk_default",
            type: "ssh-node",
            extra: { sshTarget: "core1", remotePath: "/home/u/.onecode/workspaces/proj" },
          },
        ],
        status: [{ workspaceID: "wrk_default", status: "connected" }],
      }),
    ).toBeUndefined()
  })

  test("applyServerRemoteWorkspace keeps remembered remotePath when live rows are foreign", () => {
    resetRuntimeEnvironmentForTest()
    resetRemoteWorkspaceForTest()
    setRuntimeEnvironmentFor("D:/work/proj", { kind: "ssh", targetName: "core1" })
    setRemoteWorkspaceFor("D:/work/proj", {
      workspaceID: "",
      targetName: "core1",
      remotePath: "/home/u/test_dir",
    })
    applyServerRemoteWorkspace("D:/work/proj", {
      targetName: "core1",
      list: [
        {
          id: "wrk_default",
          type: "ssh-node",
          extra: {
            sshTarget: "core1",
            remotePath: "/home/u/.onecode/workspaces/proj",
            localDirectory: "D:/work/other",
          },
        },
      ],
      status: [{ workspaceID: "wrk_default", status: "connected" }],
      clearIfAbsent: true,
    })
    expect(remoteWorkspaceFor("D:/work/proj")).toEqual({
      workspaceID: "",
      targetName: "core1",
      remotePath: "/home/u/test_dir",
    })
    resetRuntimeEnvironmentForTest()
    resetRemoteWorkspaceForTest()
  })

  test("scopes bindings by account id", () => {
    resetRemoteWorkspaceForTest()
    setRemoteWorkspaceFor("D:/work/proj", { workspaceID: "wrk_a", targetName: "core1" }, "alice")
    setRemoteWorkspaceFor("D:/work/proj", { workspaceID: "wrk_b", targetName: "core1" }, "bob")
    expect(remoteWorkspaceFor("D:/work/proj", "alice")?.workspaceID).toBe("wrk_a")
    expect(remoteWorkspaceFor("D:/work/proj", "bob")?.workspaceID).toBe("wrk_b")
    expect(remoteWorkspaceFor("D:/work/proj")?.workspaceID).toBeUndefined()
    resetRemoteWorkspaceForTest()
  })

  test("remaps leaf event directories onto the bound local project", () => {
    resetRemoteWorkspaceForTest()
    setRemoteWorkspaceFor("D:/work/proj", { workspaceID: "wrk_1", targetName: "core1" }, "alice")
    expect(remapRemoteEventDirectory("/home/remote/ws", "wrk_1", "alice")).toBe("D:/work/proj")
    expect(remapRemoteEventDirectory("D:/work/proj", "wrk_1", "alice")).toBe("D:/work/proj")
    expect(remapRemoteEventDirectory("/home/remote/ws", "wrk_missing", "alice")).toBe("/home/remote/ws")
    expect(remapRemoteEventDirectory("global", "wrk_1", "alice")).toBe("global")
    forgetLiveRemoteWorkspacesForTest()
    expect(remapRemoteEventDirectory("/home/remote/ws", "wrk_1", "alice")).toBe("D:/work/proj")
    setRemoteWorkspaceFor("D:/work/other", { workspaceID: "wrk_1", targetName: "core1" }, "alice")
    expect(remapRemoteEventDirectory("/home/remote/ws", "wrk_1", "alice")).toBe("/home/remote/ws")
    resetRemoteWorkspaceForTest()
  })

  test("rewrites leaf session.created onto the bound local project directory", () => {
    const payload = {
      type: "session.created",
      properties: { info: { id: "ses_1", directory: "/home/remote/ws", title: "pwd" } },
    }
    expect(bindRemoteSessionDirectory(payload, "D:/work/proj").properties.info.directory).toBe("D:/work/proj")
    expect(bindRemoteSessionDirectory(payload, "/home/remote/ws")).toBe(payload)
    expect(bindRemoteSessionDirectory({ type: "message.updated", properties: {} }, "D:/work/proj").type).toBe(
      "message.updated",
    )
  })

  test("uses distinct remote slugs for same-named folders", () => {
    const one = remoteProjectSlug("D:/work/a/frontend")
    const two = remoteProjectSlug("D:/work/b/frontend")
    expect(one).not.toBe(two)
    expect(one).toBe(remoteProjectSlug("D:\\work\\a\\frontend"))
    expect(one.startsWith("frontend-")).toBe(true)
  })

  test("previews the default remote path with account and project leaf", () => {
    expect(previewDefaultRemotePath({ accountId: "alice/id", projectName: "team/my_proj" })).toBe(
      "~/onecode_remote/workspaces/alice_id/my_proj",
    )
    expect(previewDefaultRemotePath({})).toBe("~/onecode_remote/workspaces/local/project")
  })

  test("extracts a readable message from UnknownError JSON", () => {
    expect(
      remoteHttpErrorMessage(
        { name: "UnknownError", data: { message: "Unexpected server error. Check server logs for details." } },
        '{"name":"UnknownError"}',
        "预检失败",
      ),
    ).toBe("Unexpected server error. Check server logs for details.")
    expect(remoteHttpErrorMessage(undefined, "SSH timed out", "预检失败")).toBe("SSH timed out")
    expect(remoteHttpErrorMessage(undefined, '{"name":"UnknownError"}', "预检失败")).toBe("预检失败")
  })

  test("waitForWorkspaceFileList requires two successful lists", async () => {
    let n = 0
    await waitForWorkspaceFileList({
      list: async () => {
        n += 1
      },
      timeoutMs: 3_000,
      stable: 2,
    })
    expect(n).toBe(2)
  })

  test("waitForWorkspaceFileList ignores transient list failures then succeeds", async () => {
    let n = 0
    await waitForWorkspaceFileList({
      list: async () => {
        n += 1
        if (n < 2) throw new Error("Unexpected server error. Check server logs for details.")
      },
      timeoutMs: 4_000,
      stable: 1,
    })
    expect(n).toBe(2)
  })

  test("waitForWorkspaceFileList aborts", async () => {
    const abort = new AbortController()
    abort.abort()
    await expect(
      waitForWorkspaceFileList({
        list: async () => undefined,
        abort: abort.signal,
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow("已取消连接")
  })

  test("fileWaitConnectSteps marks session as current with a typed status", () => {
    const steps = fileWaitConnectSteps("正在等待文件服务")
    expect(steps.every((item) => item.status === "ok" || item.status === "current")).toBe(true)
    expect(steps.find((item) => item.id === "session")).toEqual({
      id: "session",
      message: "同步会话",
      status: "current",
      detail: "正在等待文件服务",
    })
  })
})
