import { describe, expect, test } from "bun:test"
import { isPlatformAuthPublicPath, isDefaultProjectWorktree, platformAuthCancelTarget, shouldShowPlatformLogin } from "./platform-auth"

describe("platform auth public paths", () => {
  test("allows anonymous browse of capability center and skills only", () => {
    expect(isPlatformAuthPublicPath("/workspace/capabilities")).toBe(true)
    expect(isPlatformAuthPublicPath("/workspace/capabilities/mace")).toBe(true)
    expect(isPlatformAuthPublicPath("/workspace/skills")).toBe(true)
  })

  test("requires login for workbench home and session chat when auth is required", () => {
    // /workspace itself is the welcome chat (login CTA) — browsable while logged out.
    expect(isPlatformAuthPublicPath("/workspace")).toBe(true)
    expect(isPlatformAuthPublicPath("/workspace/YWJj/session")).toBe(false)
    expect(isPlatformAuthPublicPath("/workspace/YWJj/session/ses_1")).toBe(false)
    expect(
      shouldShowPlatformLogin({
        pathname: "/workspace",
        hasToken: false,
        authRequired: true,
      }),
    ).toBe(false)
    expect(
      shouldShowPlatformLogin({
        pathname: "/workspace/YWJj/session/ses_1",
        hasToken: false,
        authRequired: true,
      }),
    ).toBe(true)
    // Soft auth still must not treat private chat as anonymous browse (cache-clear F5).
    expect(
      shouldShowPlatformLogin({
        pathname: "/workspace/YWJj/session/ses_1",
        hasToken: false,
        authRequired: false,
      }),
    ).toBe(false)
  })

  test("cancel from chat home returns to /workspace", () => {
    expect(platformAuthCancelTarget("?redirect=%2Fworkspace")).toBe("/workspace")
  })

  test("does not force login for capability browse when platform auth is required", () => {
    expect(
      shouldShowPlatformLogin({
        pathname: "/workspace/capabilities",
        hasToken: false,
        authRequired: true,
      }),
    ).toBe(false)
  })

  test("still forces login for /code when platform auth is required", () => {
    expect(
      shouldShowPlatformLogin({
        pathname: "/code",
        hasToken: false,
        authRequired: true,
      }),
    ).toBe(true)
  })

  test("cancel target returns public redirect when present", () => {
    expect(platformAuthCancelTarget("?redirect=%2Fworkspace%2Fcapabilities%2Fmace")).toBe("/workspace/capabilities/mace")
    expect(platformAuthCancelTarget("?redirect=%2Fworkspace%2Fskills")).toBe("/workspace/skills")
    expect(platformAuthCancelTarget("?next=%2Fworkspace%2Fskills")).toBe("/workspace/skills")
  })

  test("cancel target avoids protected redirect paths", () => {
    expect(platformAuthCancelTarget("?redirect=%2Fcode")).toBe("/workspace/capabilities")
    expect(platformAuthCancelTarget("")).toBe("/workspace/capabilities")
  })

  test("allows anonymous browse of shared-case session routes", () => {
    // /workspace/{base64("/data/case")}/session/... — matches app base64Encode (no padding)
    expect(isPlatformAuthPublicPath("/workspace/L2RhdGEvY2FzZQ/session/ses_1")).toBe(true)
    expect(isPlatformAuthPublicPath("/workspace/YWJj/session/ses_1")).toBe(false)
  })

  test("treats a default worktree leaf as the reserved local project", () => {
    expect(isDefaultProjectWorktree("/data/workspaces/acct/default")).toBe(true)
    expect(isDefaultProjectWorktree("D:\\data\\workspaces\\acct\\default\\")).toBe(true)
    expect(isDefaultProjectWorktree("/data/workspaces/acct/test_session")).toBe(false)
  })
})