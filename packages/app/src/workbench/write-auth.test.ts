import { describe, expect, test } from "bun:test"

/**
 * Workbench write actions must redirect to login when the user has no platform session.
 * Keep this list in sync when adding new personal-space mutations.
 */
describe("workbench write-action auth gates", () => {
  test("shared requirePersonalSpace helper exists for write entrypoints", async () => {
    const source = await Bun.file(new URL("./require-auth.ts", import.meta.url)).text()
    expect(source).toContain("export function requirePersonalSpace")
    expect(source).toContain("stashPendingAction")
    expect(source).toContain("`/login?redirect=${redirect}`")
  })

  test("left nav gates new project, new task, and new session", async () => {
    const source = await Bun.file(new URL("./left-nav.tsx", import.meta.url)).text()
    expect(source).toContain("function openNewProject()")
    expect(source).toContain("function openNewTask()")
    expect(source).toContain("function openNewSessionInProject")
    expect(source).toContain("requirePersonalSpace")
    expect(source).toContain("function SidebarMoreMenu")
    expect(source).toContain("MENU_OPEN_GUARD_MS")
    expect(source).toContain("getAnchorRect")
    expect(source).toContain("onFocusOutside={(event) => event.preventDefault()}")
    expect(source).toContain("onInteractOutside")
    expect(source).toContain("onPointerDown={(event: PointerEvent) => event.stopPropagation()}")
    expect(source).toContain("selectProject(worktree)")
    expect(source).toContain("Stay on the current page")
    const projectGate = source.indexOf("function openNewProject()")
    const taskGate = source.indexOf("function openNewTask()")
    const sessionGate = source.indexOf("function openNewSessionInProject")
    expect(source.indexOf("requirePersonalSpace", projectGate)).toBeGreaterThan(projectGate)
    expect(source.indexOf("requirePersonalSpace", projectGate)).toBeLessThan(taskGate)
    expect(source.indexOf("requirePersonalSpace", taskGate)).toBeGreaterThan(taskGate)
    expect(source.indexOf("requirePersonalSpace", sessionGate)).toBeGreaterThan(sessionGate)
  })

  test("capability install and wizard gate session creation", async () => {
    const install = await Bun.file(new URL("./capabilities/install.ts", import.meta.url)).text()
    const wizard = await Bun.file(new URL("./capabilities/wizard.tsx", import.meta.url)).text()
    expect(install).toContain("requirePersonalSpace")
    expect(install).toContain("startCapabilityInstall")
    expect(wizard).toContain("requirePersonalSpace")
    expect(wizard).toContain("const createTask = ()")
  })

  test("oneskills develop requires login and upgrade is disabled until login", async () => {
    const source = await Bun.file(new URL("./capabilities/oneskills-panel.tsx", import.meta.url)).text()
    expect(source).toContain("requirePersonalSpace")
    expect(source).toContain("startDevelop")
    expect(source).toContain("canManageSkills")
    expect(source).toContain("disabled={!canManageSkills() || updating()}")
    const develop = source.indexOf("const startDevelop = ")
    const upgrade = source.indexOf("const handleUpgrade = ")
    expect(develop).toBeGreaterThan(-1)
    expect(source.indexOf("requirePersonalSpace", develop)).toBeGreaterThan(develop)
    expect(source.indexOf("requirePersonalSpace", develop)).toBeLessThan(source.indexOf("pushSessionHandoffDraft", develop))
    expect(source.indexOf("upgradeOneSkills", upgrade)).toBeGreaterThan(upgrade)
    expect(source.indexOf("requirePersonalSpace", upgrade)).toBe(-1)
  })

  test("skills page and skill manager withhold writes until login", async () => {
    const skills = await Bun.file(new URL("./skills.tsx", import.meta.url)).text()
    const manager = await Bun.file(new URL("../components/skill-manager-dialog.tsx", import.meta.url)).text()
    expect(skills).toContain("loginRequired={loginRequired()}")
    expect(manager).toContain("loginRequired")
    expect(manager).toContain("登录后查看个人技能与目录")
    expect(manager).toContain("clearTenantSkillState")
  })

  test("home prompt and prompt submit gate agent writes", async () => {
    const home = await Bun.file(new URL("./home.tsx", import.meta.url)).text()
    const submit = await Bun.file(new URL("../components/prompt-input/submit.ts", import.meta.url)).text()
    expect(home).toContain("requirePersonalSpace")
    expect(home).toContain("loggedIn()")
    expect(submit).toContain("isPlatformAuthRequired")
    expect(submit).toContain("requirePersonalSpace")
    expect(submit).toContain("storedPlatformAuthSession")
  })

  test("legacy onescience skills page disables OneSkills upgrade until login", async () => {
    const source = await Bun.file(new URL("../pages/onescience.tsx", import.meta.url)).text()
    const upgrade = source.indexOf("const handleUpgrade = async () =>")
    expect(upgrade).toBeGreaterThan(-1)
    expect(source.indexOf("if (!canManageSkills()) return", upgrade)).toBeGreaterThan(upgrade)
    expect(source.indexOf("upgradeOneSkills", upgrade)).toBeGreaterThan(upgrade)
    expect(source.indexOf("disabled={!canManageSkills() || updating()}", upgrade)).toBeGreaterThan(upgrade)
  })

  test("session composer blocks writes when platform auth is required and logged out", async () => {
    const composer = await Bun.file(
      new URL("../pages/session/composer/session-composer-region.tsx", import.meta.url),
    ).text()
    expect(composer).toContain("if (loggedOut()) return true")
  })

  test("login cancel restore: hooks keep browse context via current URL or resource path", async () => {
    const requireAuth = await Bun.file(new URL("./require-auth.ts", import.meta.url)).text()
    const install = await Bun.file(new URL("./capabilities/install.ts", import.meta.url)).text()
    const wizard = await Bun.file(new URL("./capabilities/wizard.tsx", import.meta.url)).text()
    const oneskills = await Bun.file(new URL("./capabilities/oneskills-panel.tsx", import.meta.url)).text()
    const leftNav = await Bun.file(new URL("./left-nav.tsx", import.meta.url)).text()
    const home = await Bun.file(new URL("./home.tsx", import.meta.url)).text()
    const skills = await Bun.file(new URL("./skills.tsx", import.meta.url)).text()
    const selection = await Bun.file(new URL("./capabilities/selection.ts", import.meta.url)).text()
    const fork = await Bun.file(new URL("../pages/onescience-case-fork.tsx", import.meta.url)).text()
    const header = await Bun.file(new URL("../components/session/session-header.tsx", import.meta.url)).text()
    const composer = await Bun.file(
      new URL("../pages/session/composer/session-composer-region.tsx", import.meta.url),
    ).text()
    const settings = await Bun.file(new URL("../components/dialog-settings.tsx", import.meta.url)).text()
    const account = await Bun.file(new URL("../components/settings-account.tsx", import.meta.url)).text()

    // Shared helper defaults to the page that opened login (pathname + search + hash).
    expect(requireAuth).toContain("location.pathname")
    expect(requireAuth).toContain("location.search")
    expect(requireAuth).toContain("location.hash")
    expect(requireAuth).toContain("input.redirect ??")

    // Capability / nav write gates: no hardcoded bare capabilities redirect.
    for (const source of [install, wizard, oneskills, leftNav, home]) {
      expect(source).toContain("requirePersonalSpace")
      expect(source).not.toContain('redirect: "/workspace/capabilities"')
      expect(source).not.toContain("redirect: '/workspace/capabilities'")
    }

    // Intro/wizard overlays restore category when closing back to the list.
    expect(wizard).toContain("workspaceCapabilityReturnHref")
    expect(selection).toContain("getCapabilityResource")

    // Skills login keeps the active tab in redirect.
    expect(skills).toContain("workspaceSkillsHref(tab())")
    expect(skills).toContain("workspaceSkillsHref(next)")

    // Fork / settings use the live location (including search) for cancel return.
    expect(fork).toContain("encodeURIComponent(input.redirect)")
    expect(fork).toContain('variant="primary"')
    expect(fork).toContain("确认 Fork")
    expect(fork).not.toContain("os-button-primary")
    expect(header).toContain("redirect: `${location.pathname}${location.search}${location.hash}`")
    expect(composer).toContain("redirect: `${location.pathname}${location.search}${location.hash}`")
    expect(settings).toContain("platformAuthUrl({")
    expect(settings).toContain("pathname: location.pathname")
    expect(settings).toContain("search: location.search")
    expect(account).toContain("platformAuthUrl({")
    expect(account).toContain("pathname: location.pathname")
    expect(account).toContain("search: location.search")
  })
})
