import { describe, expect, test } from "bun:test"
import {
  isPlatformAuthRequired,
  personalWorkspaceDirectory,
  type PlatformAuthSession,
} from "@/utils/platform-auth"

describe("workbench skills logged-out gate", () => {
  test("does not resolve a personal directory without a platform session", () => {
    const last = "/home/wangliqi/private_data/workspace/zhaogingli/default"
    expect(personalWorkspaceDirectory(null, last)).toBeUndefined()
    expect(personalWorkspaceDirectory(undefined, last)).toBeUndefined()
  })

  test("keeps last personal directory when a platform session is present", () => {
    const session = {
      token: "t",
      expiresAt: Date.now() + 60_000,
      account: { id: "a", email: "a@example.com", name: "a", status: "active", timeCreated: 1 },
      workspaces: [
        {
          id: "w",
          slug: "zhaogingli",
          name: "zhaogingli",
          defaultEnvPath: "/home/wangliqi/private_data/workspace/zhaogingli",
          role: "admin",
        },
      ],
      capabilities: { terminal: false },
    } satisfies PlatformAuthSession
    expect(
      personalWorkspaceDirectory(session, "/home/wangliqi/private_data/workspace/zhaogingli/default"),
    ).toBe("/home/wangliqi/private_data/workspace/zhaogingli/default")
  })

  test("skills page withholds SkillManagerPanel data until login", async () => {
    const source = await Bun.file(new URL("./skills.tsx", import.meta.url)).text()
    expect(source).toContain("storedPlatformAuthSession()")
    expect(source).toContain("if (!session) return \"\"")
    expect(source).toContain("loginRequired")
    expect(source).toContain("directory={loginRequired() ? undefined : directory() || undefined}")
    expect(source).toContain("workspaceSkillsHref(tab())")
    expect(source).toContain("workspaceSkillsHref(next)")
    expect(source).toContain("const selectTab = ")
  })

  test("skill manager hides tenant paths and skill lists when login is required", async () => {
    const source = await Bun.file(new URL("../components/skill-manager-dialog.tsx", import.meta.url)).text()
    expect(source).toContain("loginRequired")
    expect(source).toContain("isPlatformAuthRequired")
    expect(source).toContain("clearTenantSkillState")
    expect(source).toContain("if (loginRequired())")
    expect(source).toContain("登录后查看个人技能与目录")
    expect(source).toContain("SkillProjectPathBar")
    expect(source).toContain("切换项目")
    expect(source).toContain("chooseProjectDirectory")
    expect(source).toContain("os-skill-manager-page-body")
    expect(source).toContain("SKILL_LIST_PAGE_SIZE")
    expect(source).toContain("os-skill-manager-card-popover")
    expect(typeof isPlatformAuthRequired).toBe("function")
  })
})
