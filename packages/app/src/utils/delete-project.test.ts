import { afterEach, describe, expect, test } from "bun:test"
import {
  forgetLiveRemoteWorkspacesForTest,
  resetRemoteWorkspaceForTest,
  setRemoteWorkspaceFor,
} from "@/components/onescience/remote-workspace"
import {
  disconnectLiveRemoteWorkspace,
  hasArchivedProjectRoots,
  liveRemoteWorkspaceID,
  removeLeftoverRemoteWorkspaces,
  requestProjectRemove,
  sessionUsesLiveRemote,
  withTimeout,
} from "./delete-project"

afterEach(() => {
  resetRemoteWorkspaceForTest()
})

function hanging<T = never>() {
  return new Promise<T>(() => undefined)
}

function mockClient(input: {
  listSessions?: () => Promise<{ data?: Array<{ time?: { archived?: number | null } }> }>
  listWorkspaces?: () => Promise<{ data?: Array<{ id?: string | null }> }>
  removeWorkspace?: (params: { id: string; directory: string }) => Promise<unknown>
  warp?: (params: { sessionID: string }) => Promise<unknown>
  removeProject?: () => Promise<{ data?: boolean | null }>
}) {
  return {
    experimental: {
      session: { list: input.listSessions ?? (() => Promise.resolve({ data: [] })) },
      workspace: {
        list: input.listWorkspaces ?? (() => Promise.resolve({ data: [] })),
        remove: input.removeWorkspace ?? (() => Promise.resolve({})),
        warp: (params: { sessionID: string }) => (input.warp ?? (() => Promise.resolve({})))(params),
      },
    },
    project: { remove: input.removeProject ?? (() => Promise.resolve({ data: true })) },
  }
}

describe("delete-project helpers", () => {
  test("withTimeout rejects a hung promise", async () => {
    await expect(withTimeout(hanging(), 20, "timed out")).rejects.toThrow("timed out")
  })

  test("archived-root probe treats a hang as unblocked so delete stays clickable", async () => {
    const blocked = await hasArchivedProjectRoots(mockClient({ listSessions: () => hanging() }), "D:/work/remote_proj_4")
    expect(blocked).toBe(false)
  }, 10_000)

  test("treats last-known leftover as disconnected", () => {
    setRemoteWorkspaceFor("D:/work/remote_proj_4", {
      workspaceID: "wrk_stale",
      targetName: "core1",
      remotePath: "/home/u/remote_proj_4",
    })
    forgetLiveRemoteWorkspacesForTest()
    expect(liveRemoteWorkspaceID("D:/work/remote_proj_4")).toBe("")
    expect(sessionUsesLiveRemote({ directory: "D:/work/remote_proj_4", workspaceID: "wrk_stale" })).toBe(false)
  })

  test("does not disconnect when the remote project is already 未连接", async () => {
    setRemoteWorkspaceFor("D:/work/remote_proj_4", {
      workspaceID: "wrk_stale",
      targetName: "core1",
    })
    forgetLiveRemoteWorkspacesForTest()
    const removed: string[] = []
    const result = await disconnectLiveRemoteWorkspace(
      mockClient({
        removeWorkspace: (params) => {
          removed.push(params.id)
          return Promise.resolve({})
        },
      }),
      "D:/work/remote_proj_4",
      ["ses_1"],
    )
    expect(result.ok).toBe(true)
    expect(removed).toEqual([])
  })

  test("disconnects a live remote before delete", async () => {
    setRemoteWorkspaceFor("D:/work/remote_proj_4", {
      workspaceID: "wrk_live",
      targetName: "core1",
      remotePath: "/home/u/remote_proj_4",
    })
    const warped: string[] = []
    const removed: string[] = []
    const result = await disconnectLiveRemoteWorkspace(
      mockClient({
        warp: (params) => {
          warped.push(params.sessionID)
          return Promise.resolve({})
        },
        removeWorkspace: (params) => {
          removed.push(params.id)
          return Promise.resolve({})
        },
      }),
      "D:/work/remote_proj_4",
      ["ses_1"],
    )
    expect(result.ok).toBe(true)
    expect(warped).toEqual(["ses_1"])
    expect(removed).toEqual(["wrk_live"])
    expect(liveRemoteWorkspaceID("D:/work/remote_proj_4")).toBe("")
  })

  test("fails delete-time disconnect when live remove errors", async () => {
    setRemoteWorkspaceFor("D:/work/remote_proj_4", {
      workspaceID: "wrk_live",
      targetName: "core1",
    })
    const result = await disconnectLiveRemoteWorkspace(
      mockClient({
        removeWorkspace: () => Promise.reject(new Error("无法停止远端 onecode serve")),
      }),
      "D:/work/remote_proj_4",
    )
    expect(result.ok).toBe(false)
    expect(liveRemoteWorkspaceID("D:/work/remote_proj_4")).toBe("wrk_live")
  })

  test("removes last-known leftover workspace even when the UI is disconnected", async () => {
    setRemoteWorkspaceFor("D:/work/remote_proj_4", {
      workspaceID: "wrk_stale",
      targetName: "core1",
      remotePath: "/home/u/remote_proj_4",
    })
    forgetLiveRemoteWorkspacesForTest()
    const removed: string[] = []
    await removeLeftoverRemoteWorkspaces(
      mockClient({
        listWorkspaces: () => Promise.resolve({ data: [{ id: "wrk_listed" }] }),
        removeWorkspace: (params) => {
          removed.push(params.id)
          return Promise.resolve({})
        },
      }),
      "D:/work/remote_proj_4",
    )
    expect(removed.sort()).toEqual(["wrk_listed", "wrk_stale"])
  })

  test("project remove reports failure without throwing", async () => {
    const result = await requestProjectRemove(
      mockClient({
        removeProject: () => Promise.reject(new Error("Unexpected server error")),
      }),
      "D:/work/remote_proj_4",
    )
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain("Unexpected server error")
  })
})
