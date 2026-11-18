import { describe, expect, test } from "bun:test"
import { nextProjectExecution, parseProjectExecution, projectExecutionEquals, isLocalOnlyProjectWorktree, sameProjectWorktree } from "../../src/project/execution"

describe("project execution", () => {
  test("parses sshTarget and legacy targetName", () => {
    expect(parseProjectExecution({ kind: "local" })).toEqual({ kind: "local" })
    expect(parseProjectExecution({ kind: "ssh", sshTarget: "core1-hanmk_sq", remotePath: "/data/proj" })).toEqual({
      kind: "ssh",
      sshTarget: "core1-hanmk_sq",
      remotePath: "/data/proj",
    })
    expect(parseProjectExecution({ kind: "ssh", targetName: "core1-hanmk_sq" })).toEqual({
      kind: "ssh",
      sshTarget: "core1-hanmk_sq",
    })
    expect(parseProjectExecution(undefined)).toBeUndefined()
    expect(parseProjectExecution({ kind: "ssh" })).toBeUndefined()
  })

  test("writes missing rows once and keeps ssh/local immutable", () => {
    expect(nextProjectExecution(undefined, { kind: "local" })).toEqual({ kind: "local" })
    expect(nextProjectExecution(undefined, { kind: "ssh", sshTarget: "core1" })).toEqual({
      kind: "ssh",
      sshTarget: "core1",
    })
    expect(nextProjectExecution({ kind: "local" }, { kind: "ssh", sshTarget: "core1" })).toBeUndefined()
    expect(nextProjectExecution({ kind: "ssh", sshTarget: "core1" }, { kind: "local" })).toBeUndefined()
    expect(nextProjectExecution({ kind: "ssh", sshTarget: "core1" }, { kind: "ssh", sshTarget: "other" })).toBeUndefined()
    expect(
      nextProjectExecution({ kind: "ssh", sshTarget: "core1" }, { kind: "ssh", sshTarget: "core1", remotePath: "/data" }),
    ).toEqual({ kind: "ssh", sshTarget: "core1", remotePath: "/data" })
    expect(
      nextProjectExecution(
        { kind: "ssh", sshTarget: "core1", remotePath: "/home/u/.onecode/workspaces/acct/proj" },
        { kind: "ssh", sshTarget: "core1", remotePath: "/home/u/test_dir" },
      ),
    ).toEqual({ kind: "ssh", sshTarget: "core1", remotePath: "/home/u/test_dir" })
    expect(
      nextProjectExecution(
        { kind: "ssh", sshTarget: "core1", remotePath: "/home/u/test_dir" },
        { kind: "ssh", sshTarget: "core1", remotePath: "/home/u/.onecode/workspaces/acct/proj" },
      ),
    ).toEqual({ kind: "ssh", sshTarget: "core1", remotePath: "/home/u/test_dir" })
    expect(
      projectExecutionEquals({ kind: "ssh", sshTarget: "a" }, { kind: "ssh", sshTarget: "a" }),
    ).toBe(true)
  })

  test("keeps reserved default worktrees local", () => {
    expect(isLocalOnlyProjectWorktree("/home/u/workspaces/acct/default")).toBe(true)
    expect(isLocalOnlyProjectWorktree("D:\\data\\acct\\default\\")).toBe(true)
    expect(isLocalOnlyProjectWorktree("/home/u/workspaces/acct/test_remote")).toBe(false)
    expect(nextProjectExecution(undefined, { kind: "ssh", sshTarget: "core1" }, "/data/acct/default")).toEqual({
      kind: "local",
    })
    expect(
      nextProjectExecution({ kind: "ssh", sshTarget: "aliyun" }, { kind: "ssh", sshTarget: "aliyun" }, "/data/acct/default"),
    ).toEqual({ kind: "local" })
    expect(sameProjectWorktree("D:/data/acct/default", "D:\\data\\acct\\default\\")).toBe(true)
    expect(sameProjectWorktree("D:/data/acct/default", "D:/data/acct/test_remote")).toBe(false)
  })
})
