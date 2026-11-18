import { describe, expect, test } from "bun:test"
import { canAccessRemoteWorkspace, extraAccountId } from "../../src/server/shared/remote-workspace-access"

describe("remote workspace access", () => {
  test("parses extra.accountId", () => {
    expect(extraAccountId({ accountId: " acct-1 " })).toBe("acct-1")
    expect(extraAccountId({})).toBeUndefined()
    expect(extraAccountId(null)).toBeUndefined()
  })

  test("allows unauthenticated requests", () => {
    expect(canAccessRemoteWorkspace({ workspaceId: "wrk_1" })).toBe(true)
  })

  test("allows the account that created the ssh-node workspace", () => {
    expect(
      canAccessRemoteWorkspace({
        sessionAccountId: "acct-1",
        platformWorkspaceIds: ["plat-1"],
        workspaceId: "wrk_1",
        extraAccountId: "acct-1",
      }),
    ).toBe(true)
  })

  test("does not confuse platform tenant ids with experimental workspace ids", () => {
    expect(
      canAccessRemoteWorkspace({
        sessionAccountId: "acct-1",
        platformWorkspaceIds: ["plat-1"],
        workspaceId: "wrk_1",
        extraAccountId: "acct-2",
      }),
    ).toBe(false)
  })

  test("falls back to the local project directory when extra has no account", () => {
    expect(
      canAccessRemoteWorkspace({
        sessionAccountId: "acct-1",
        workspaceId: "wrk_1",
        localDirectoryAllowed: true,
      }),
    ).toBe(true)
    expect(
      canAccessRemoteWorkspace({
        sessionAccountId: "acct-1",
        workspaceId: "wrk_1",
        localDirectoryAllowed: false,
      }),
    ).toBe(false)
  })
})
