import { describe, expect, test } from "bun:test"
import {
  applyServerProjectExecutions,
  extractFileReadText,
  hydrateProjectRuntimeEnvironment,
  liveSshWorkspaceFromList,
  parseProjectExecutionMarker,
  remotePathFromProjectExecution,
  persistProjectExecutionMarker,
  PROJECT_EXECUTION_MARKER,
  resolveProjectRemotePath,
  serializeProjectExecutionMarker,
  sshEvidenceFromBinding,
  sshEvidenceFromRuntime,
  sshEvidenceFromWorkspaceList,
} from "./project-execution"
import { resetRuntimeEnvironmentForTest, runtimeEnvironmentFor, setRuntimeEnvironmentFor } from "./runtime-environment"
import { remoteWorkspaceFor, resetRemoteWorkspaceForTest, setRemoteWorkspaceFor } from "./remote-workspace"

describe("project execution marker", () => {
  test("round-trips ssh and ignores empty local evidence", () => {
    const ssh = { kind: "ssh" as const, targetName: "core1-hanmk_sq" }
    expect(parseProjectExecutionMarker(serializeProjectExecutionMarker(ssh))).toEqual(ssh)
    expect(parseProjectExecutionMarker('{"kind":"ssh","targetName":"core1-hanmk_sq"}')).toEqual(ssh)
    expect(parseProjectExecutionMarker({ kind: "ssh", sshTarget: "core1-hanmk_sq" })).toEqual({
      kind: "ssh",
      targetName: "core1-hanmk_sq",
    })
    expect(parseProjectExecutionMarker(serializeProjectExecutionMarker({ kind: "local" }))).toEqual({ kind: "local" })
    expect(parseProjectExecutionMarker("")).toBeUndefined()
    expect(parseProjectExecutionMarker("{not json")).toBeUndefined()
    expect(extractFileReadText({ type: "text", content: '{"kind":"ssh","targetName":"core1"}' })).toContain("core1")
  })

  test("extracts ssh evidence from binding, workspace list, and session env", () => {
    expect(sshEvidenceFromBinding({ targetName: "core1-hanmk_sq" })).toEqual({
      kind: "ssh",
      targetName: "core1-hanmk_sq",
    })
    expect(sshEvidenceFromBinding({ targetName: "  " })).toBeUndefined()
    expect(sshEvidenceFromRuntime({ kind: "local" })).toBeUndefined()
    expect(sshEvidenceFromRuntime({ kind: "ssh", targetName: "core1-hanmk_sq" })).toEqual({
      kind: "ssh",
      targetName: "core1-hanmk_sq",
    })
    expect(
      sshEvidenceFromWorkspaceList([
        { type: "local", extra: { sshTarget: "ignored" } },
        { id: "wrk_1", type: "ssh-node", directory: "/home/u/proj", extra: { sshTarget: "core1-hanmk_sq" } },
      ]),
    ).toEqual({ kind: "ssh", targetName: "core1-hanmk_sq" })
    expect(
      liveSshWorkspaceFromList([
        { id: "wrk_1", type: "ssh-node", extra: { sshTarget: "core1-hanmk_sq", remotePath: "/data/proj" } },
      ]),
    ).toEqual({
      workspaceID: "wrk_1",
      targetName: "core1-hanmk_sq",
      remotePath: "/data/proj",
    })
  })

  test("does not hydrate from leftover workspaces or session messages", async () => {
    resetRuntimeEnvironmentForTest()
    const restored = await hydrateProjectRuntimeEnvironment("D:/work/test_remote", {
      fileRead: async () => undefined,
    })
    expect(restored).toBeUndefined()
    expect(runtimeEnvironmentFor("D:/work/test_remote")).toEqual({ kind: "local" })
    resetRuntimeEnvironmentForTest()
  })

  test("hydrates from the durable project marker only", async () => {
    resetRuntimeEnvironmentForTest()
    const restoredFromMarker = await hydrateProjectRuntimeEnvironment("D:/work/hmk_remote_test", {
      fileRead: async () => ({ type: "text", content: '{"kind":"ssh","targetName":"core1"}' }),
    })
    expect(restoredFromMarker?.env).toEqual({ kind: "ssh", targetName: "core1" })
    resetRuntimeEnvironmentForTest()
  })

  test("does not hydrate the reserved default project", async () => {
    resetRuntimeEnvironmentForTest()
    const restored = await hydrateProjectRuntimeEnvironment("D:/data/workspaces/acct/default", {
      fileRead: async () => ({ type: "text", content: '{"kind":"ssh","targetName":"aliyun"}' }),
    })
    expect(restored).toBeUndefined()
    expect(runtimeEnvironmentFor("D:/data/workspaces/acct/default")).toEqual({ kind: "local" })
    resetRuntimeEnvironmentForTest()
  })

  test("does not hydrate a project that is already ssh", async () => {
    resetRuntimeEnvironmentForTest()
    setRuntimeEnvironmentFor("D:/work/proj", { kind: "ssh", targetName: "core1" })
    const restored = await hydrateProjectRuntimeEnvironment("D:/work/proj", {
      fileRead: async () => ({ type: "text", content: '{"kind":"ssh","targetName":"other"}' }),
    })
    expect(restored).toBeUndefined()
    expect(runtimeEnvironmentFor("D:/work/proj")).toEqual({ kind: "ssh", targetName: "core1" })
    resetRuntimeEnvironmentForTest()
  })

  test("applies listed project execution and leaves missing records untouched", () => {
    resetRuntimeEnvironmentForTest()
    setRuntimeEnvironmentFor("D:/work/poisoned", { kind: "ssh", targetName: "stale" })
    applyServerProjectExecutions([
      { worktree: "D:/work/poisoned" },
      { worktree: "D:/work/remote", execution: { kind: "ssh", sshTarget: "core1" } },
      { worktree: "D:/work/explicit-local", execution: { kind: "local" } },
      { worktree: "D:/data/acct/default", execution: { kind: "ssh", sshTarget: "aliyun" } },
    ])
    // Missing execution must not stamp server-local (that froze unbound remotes).
    expect(runtimeEnvironmentFor("D:/work/poisoned")).toEqual({ kind: "ssh", targetName: "stale" })
    expect(runtimeEnvironmentFor("D:/work/remote")).toEqual({ kind: "ssh", targetName: "core1" })
    expect(runtimeEnvironmentFor("D:/work/explicit-local")).toEqual({ kind: "local" })
    expect(runtimeEnvironmentFor("D:/data/acct/default")).toEqual({ kind: "local" })
    resetRuntimeEnvironmentForTest()
  })

  test("writes only remote markers", async () => {
    const writes: Array<{ path: string; content: string }> = []
    await persistProjectExecutionMarker(
      async (input) => {
        writes.push({ path: input.path, content: input.content })
      },
      "D:/work/proj",
      { kind: "local" },
    )
    await persistProjectExecutionMarker(
      async (input) => {
        writes.push({ path: input.path, content: input.content })
      },
      "D:/work/proj",
      { kind: "ssh", targetName: "core1" },
    )
    expect(writes).toEqual([
      { path: PROJECT_EXECUTION_MARKER, content: serializeProjectExecutionMarker({ kind: "ssh", targetName: "core1" }) },
    ])
  })

  test("restores remembered remotePath from control-plane project execution", () => {
    resetRuntimeEnvironmentForTest()
    resetRemoteWorkspaceForTest()
    expect(remotePathFromProjectExecution({ kind: "ssh", sshTarget: "core1", remotePath: "/home/u/test_dir" })).toBe(
      "/home/u/test_dir",
    )
    applyServerProjectExecutions([
      {
        worktree: "D:/work/proj",
        execution: { kind: "ssh", sshTarget: "core1", remotePath: "/home/u/test_dir" },
      },
    ])
    expect(runtimeEnvironmentFor("D:/work/proj")).toEqual({ kind: "ssh", targetName: "core1" })
    expect(remoteWorkspaceFor("D:/work/proj")).toEqual({
      workspaceID: "",
      targetName: "core1",
      remotePath: "/home/u/test_dir",
    })
    // Do not clobber an existing custom override.
    applyServerProjectExecutions([
      {
        worktree: "D:/work/proj",
        execution: { kind: "ssh", sshTarget: "core1", remotePath: "/home/u/other" },
      },
    ])
    expect(remoteWorkspaceFor("D:/work/proj")?.remotePath).toBe("/home/u/test_dir")
    resetRuntimeEnvironmentForTest()
    resetRemoteWorkspaceForTest()
  })

  test("heals auto-default remotePath leftovers from control-plane custom path", () => {
    resetRuntimeEnvironmentForTest()
    resetRemoteWorkspaceForTest()
    setRemoteWorkspaceFor("D:/work/proj", {
      workspaceID: "",
      targetName: "core1",
      remotePath: "/public/home/u/.onecode/workspaces/acct/proj",
    })
    applyServerProjectExecutions([
      {
        worktree: "D:/work/proj",
        execution: { kind: "ssh", sshTarget: "core1", remotePath: "/public/home/u/test_dir" },
      },
    ])
    expect(remoteWorkspaceFor("D:/work/proj")?.remotePath).toBe("/public/home/u/test_dir")
    resetRuntimeEnvironmentForTest()
    resetRemoteWorkspaceForTest()
  })

  test("marker round-trips remotePath and resolve prefers custom binding", () => {
    expect(serializeProjectExecutionMarker({ kind: "ssh", targetName: "core1" }, "/data/proj")).toContain(
      "/data/proj",
    )
    expect(remotePathFromProjectExecution(serializeProjectExecutionMarker({ kind: "ssh", targetName: "core1" }, "/data/proj"))).toBe(
      "/data/proj",
    )
    expect(
      resolveProjectRemotePath({
        directory: "D:/work/proj",
        bindingPath: "/public/home/u/.onecode/workspaces/a/b",
        execution: { kind: "ssh", sshTarget: "core1", remotePath: "/public/home/u/test_dir" },
      }),
    ).toBe("/public/home/u/test_dir")
    expect(
      resolveProjectRemotePath({
        directory: "D:/work/proj",
        bindingPath: "/public/home/u/test_dir",
        execution: { kind: "ssh", sshTarget: "core1", remotePath: "/public/home/u/other" },
      }),
    ).toBe("/public/home/u/test_dir")
  })
})
