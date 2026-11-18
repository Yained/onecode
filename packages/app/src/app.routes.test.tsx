import { describe, expect, test } from "bun:test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import {
  codeDefaultDirectoryMetaName,
  onecodeExtraPathMetaName,
  codeDefaultDirectoryForExtraPath,
  codeSessionHref,
  codePromptHref,
  codeSlugSessionHref,
  codeRouteWorkspaceDirectory,
  configuredCodeDefaultDirectory,
  codeDevelopmentEntryHref,
  codeEntryWorkspaceDirectory,
  defaultProjectSessionHref,
  codeWorkspaceDirectory,
  codeWorkspaceRecentProjects,
  oneScienceResourceWorkspaceDirectory,
  persistableWorkspacePath,
  fallbackCodeDefaultDirectory,
  oneScienceRoutes,
  workspaceDevelopmentEntryHref,
  sessionHrefForPath,
  isWorkbenchSharedCaseBrowse,
} from "./app-routes"
import { PRESET_CASE_SESSION_IDS } from "./pages/preset-cases"
import { resetCodeSessionNavigationForTest } from "./code-session-navigation"
import { AUTH_TOKEN_STORAGE_KEY } from "./utils/server-auth-cache"
import {
  PLATFORM_AUTH_SESSION_STORAGE_KEY,
  PLATFORM_AUTH_TOKEN_STORAGE_KEY,
  canWritePlatformPath,
  clearPlatformAuthSession,
  filterPlatformAccountProjects,
  isPathInsidePlatformWorkspace,
  canAccessPlatformPath,
  isPinnedPlatformWorkspace,
  isSharedCasesSessionPath,
  platformWorkspacePathAliases,
  storePlatformAuthSession,
} from "./utils/platform-auth"

describe("OneScience app routes", () => {
  const appCss = () => Bun.file(new URL("./index.css", import.meta.url)).text()

  test("wires unified workbench routes and landing CTA", async () => {
    const appSource = await Bun.file(new URL("./app.tsx", import.meta.url)).text()
    const homeSource = await Bun.file(new URL("./pages/onescience.tsx", import.meta.url)).text()
    expect(appSource).toContain('path="/workspace"')
    expect(appSource).toContain("WorkbenchShell")
    expect(appSource).toContain("CapabilityCenterPage")
    expect(appSource).toContain("WorkbenchHomePage")
    expect(appSource).toContain("Eager shell + home:")
    expect(appSource).toContain("const WorkbenchHomeRoute = WorkbenchHomePage")
    expect(appSource).toContain("suspenseLazyRoute")
    expect(appSource).not.toContain("WorkbenchShellLazy")
    expect(appSource).toContain("import { WorkbenchShell } from \"@/workbench/shell\"")
    expect(appSource).toContain('os-workspace-session-embed')
    expect(appSource).toContain('<DirectoryLayout prefix="/workspace">')
    expect(appSource).not.toContain('<Layout embeddedCode')
    expect(homeSource).toContain('navigate("/workspace")')
    expect(homeSource).toContain('href="/workspace"')
    expect(homeSource).toContain("platformAuthUrl")
    expect(homeSource).toContain("useHomeAuthSession")
    expect(homeSource).toContain("platformAuthLoggingOutEvent")
    expect(homeSource).toMatch(/>\s*登录\s*</)
    expect(homeSource).toContain("flex shrink-0 items-center gap-2")
    expect(appSource).toMatch(/path="\/"\s+component=\{WorkbenchHomeRoute\}/)
    expect(appSource).not.toMatch(
      /path="\/"\s+component=\{\(\) => <Navigate href=\{workspaceCapabilitiesHref\(\)\} \/\>\}/,
    )
  })

  test("workbench home and right panel match welcome-card spec", async () => {
    const home = await Bun.file(new URL("./workbench/home.tsx", import.meta.url)).text()
    const right = await Bun.file(new URL("./workbench/right-panel.tsx", import.meta.url)).text()
    const shell = await Bun.file(new URL("./workbench/shell.tsx", import.meta.url)).text()
    expect(home).toContain("WorkbenchHomePage")
    expect(home).toContain("SessionEnvironmentBar")
    expect(home).toContain("PromptInput")
    expect(home).toContain("remoteDisconnected")
    expect(home).toContain("loggedIn()")
    expect(home).toContain("登录后开始对话")
    expect(home).toContain("os-client-welcome-login-cta")
    expect(home).toContain('href={`/login?redirect=${encodeURIComponent("/workspace")}`}')
    expect(home).toContain("RouteParamsProvider")
    expect(home).toContain("SDKProvider")
    expect(home).toContain("全流程科研模型生成平台")
    expect(home).toContain("useWorkbenchProjectDirectory")
    expect(home).toContain("WorkbenchWelcomeTerminalHost")
    expect(right).toContain("目录")
    expect(right).toContain("可视化组件")
    expect(right).toContain('label: "待办"')
    expect(right).toContain("WorkbenchTodoPane")
    expect(right).toContain("尚未打开页面")
    expect(right).toContain("WorkbenchDirectoryPane")
    expect(right).toContain("请先打开项目或任务")
    expect(right).toContain("useWorkbenchProjectDirectory")
    expect(right).toContain("hasProject()")
    expect(right).not.toContain("when={inSession()}")
    expect(right).not.toContain('label: "文本编辑器"')
    expect(shell).toContain("createSignal(false)")
    expect(shell).toContain("rightDockOpenRequest")
    expect(shell).toContain("isWorkspaceCapabilitiesPath")
    expect(shell).toContain("setRightOpen(false)")
    expect(shell).toContain("能力中心不可用右侧栏")
    expect(shell).toContain("startLeftResize")
    expect(shell).toContain("startRightResize")
    expect(shell).toContain("--os-client-sidebar-w")
    expect(shell).toContain("--os-client-tool-w")
    expect(shell).toContain("调整左边栏宽度")
    expect(shell).toContain("调整右边栏宽度")
    expect(shell).toContain("PANE_WIDTH_DEFAULT = 320")
    expect(shell).toContain("LEFT_WIDTH_MIN = 230")
    expect(shell).toContain("LEFT_WIDTH_MAX = 430")
    expect(shell).toContain('openRightDock("directory")')
    expect(right).toContain("if (now && !wasSession && !activePane()) setActivePane(\"directory\")")
  })

  test("workbench right directory pane reuses file tree and editor", async () => {
    const pane = await Bun.file(new URL("./workbench/file-pane.tsx", import.meta.url)).text()
    const css = await Bun.file(new URL("./index.css", import.meta.url)).text()
    expect(pane).toContain("FileTree")
    expect(pane).toContain("返回目录")
    expect(pane).toContain("file.write")
    expect(pane).toContain("ensureRootListed")
    expect(pane).toContain("正在加载目录")
    expect(pane).toContain("os-client-right-files")
    expect(css).toContain(".os-client-right-files")
    expect(css).toContain(".os-client-right-files-tree-scroll")
    expect(pane).toContain("HtmlFilePreview")
    expect(pane).toContain("PdfFilePreview")
    expect(pane).toContain("XyzFilePreview")
    expect(pane).toContain("MarkdownFilePreview")
    expect(pane).toContain("CsvFilePreview")
    expect(pane).toContain('chrome="workbench"')
    expect(css).toContain(".os-file-preview-toggle")
    expect(css).toContain(".os-file-xyz-toolbar")
    expect(css).toContain('html[data-color-scheme="dark"] .os-client-right-files-textarea')
    expect(css).toContain('html[data-color-scheme="dark"] .os-file-xyz-viewer')
    expect(css).toContain(".os-file-xyz-viewer")
    expect(css).toContain(".os-file-pdf-viewer")
  })

  test("keeps an index child under /capabilities so the center path matches", async () => {
    // Solid Router only emits leaf branches. Nested /capabilities without path="/"
    // leaves /workspace/capabilities unmatched (white screen).
    const appSource = await Bun.file(new URL("./app.tsx", import.meta.url)).text()
    const block = appSource.slice(appSource.indexOf('path="/capabilities"'), appSource.indexOf('path="/:dir/session'))
    expect(block).toMatch(/<Route path="\/" component=\{\(\) => null\} \/>/)
  })

  test("hides duplicate layout chrome inside workspace session embed", async () => {
    const layoutSource = await Bun.file(new URL("./pages/layout.tsx", import.meta.url)).text()
    const css = await appCss()

    expect(layoutSource).toContain('embeddedWorkbench = () => props.embeddedCode && props.routePrefix === "/workspace"')
    expect(layoutSource).toContain("<Show when={!embeddedWorkbench()}>")
    expect(layoutSource).toContain("<Titlebar embeddedCode={props.embeddedCode} />")
    expect(css).toContain(".os-workspace-session-embed header,")
    expect(css).toContain('.os-workspace-session-embed [data-component="sidebar-nav-desktop"]')
  })

  test("keeps workbench session main height inside the padded shell", async () => {
    const css = await Bun.file(new URL("./index.css", import.meta.url)).text()
    expect(css).toContain(".os-client-workbench .os-workspace-main:has(.os-code-keepalive.is-active)")
    expect(css).toContain("height: 100%;")
    expect(css).toContain("max-height: 100%;")
    expect(css).toContain(
      '.os-client-workbench .os-workspace-session-embed [data-component="session-prompt-dock"]',
    )
  })

  test("hides session file/review side panel inside workspace main card", async () => {
    const session = await Bun.file(new URL("./pages/session.tsx", import.meta.url)).text()
    const sidePanel = await Bun.file(new URL("./pages/session/session-side-panel.tsx", import.meta.url)).text()
    const header = await Bun.file(new URL("./components/session/session-header.tsx", import.meta.url)).text()
    const css = await appCss()

    expect(session).toContain("isWorkspaceSessionPath")
    expect(session).toContain("<Show when={!workbenchEmbed()}>")
    expect(session).toContain("SessionSidePanel")
    expect(sidePanel).toContain("isWorkspaceSessionPath")
    expect(sidePanel).toContain("when={isDesktop() && !workbenchEmbed()}")
    expect(header).toContain("isWorkspaceSessionPath")
    expect(header).toContain("<Show when={!workbenchEmbed()}>")
    expect(css).toContain(".os-workspace-session-embed #review-panel")
    const commands = await Bun.file(new URL("./pages/session/use-session-commands.tsx", import.meta.url)).text()
    expect(commands).toContain('openRightDock("directory")')
  })

  test("wires workbench left nav to personal projects and sessions", async () => {
    const leftNavSource = await Bun.file(new URL("./workbench/left-nav.tsx", import.meta.url)).text()
    const routesSource = await Bun.file(new URL("./workbench/routes.ts", import.meta.url)).text()

    expect(routesSource).toContain("hasMarketingHome")
    expect(routesSource).toContain('marketingHomeRoute = "/"')
    expect(leftNavSource).toContain("shellBrandHref")
    expect(leftNavSource).toContain("shellBrandName")
    expect(leftNavSource).toContain("capabilityCatalogHref")
    expect(leftNavSource).toContain("capabilitiesHref")
    expect(leftNavSource).toContain("capabilitiesActive")
    expect(leftNavSource).toContain("isWorkspaceHomePath")
    expect(leftNavSource).toContain("@opencode-ai/ui/logo")
    expect(leftNavSource).toContain("os-sidebar-brand-mark")
    expect(leftNavSource).toContain("<Mark")
    expect(leftNavSource).toContain("os-sidebar-brand-link")
    expect(leftNavSource).toContain('href={newSessionHref()}')
    expect(leftNavSource).toContain("newSessionActive")
    expect(leftNavSource).toContain(">新建会话<")
    expect(leftNavSource).toContain("filterPlatformAccountProjects")
    expect(leftNavSource).toContain("isDefaultPlatformProject")
    expect(leftNavSource).toContain("sortedRootSessions")
    expect(leftNavSource).toContain("workspaceSessionHref")
    expect(leftNavSource).toContain("function selectProject")
    expect(leftNavSource).toContain("Stay on the current page")
    expect(leftNavSource).toContain("onClick={() => selectProject(worktree)}")
    expect(leftNavSource).toContain("requirePersonalSpace")
    expect(leftNavSource).toContain("DialogSettings")
    expect(leftNavSource).toContain("RECENT_SESSIONS_PREVIEW_LIMIT = 4")
    expect(leftNavSource).toContain("recentSessions")
    expect(leftNavSource).toContain("visibleRecent")
    expect(leftNavSource).toContain("defaultPlatformProjectDirectory")
    expect(leftNavSource).toContain('data-action="recent-expand"')
    expect(leftNavSource).toContain("SessionContextMenuContent")
    expect(leftNavSource).toContain("projectSessions")
    expect(leftNavSource).toContain('data-action="project-upload"')
    expect(leftNavSource).toContain('data-action="project-remove-from-view"')
    expect(leftNavSource).toContain("sidebar.project.removeFromView")
    expect(leftNavSource).toContain('data-action="project-delete"')
    expect(leftNavSource).toContain("sidebar.project.delete")
    expect(leftNavSource).toContain("confirmDeleteProject")
    expect(leftNavSource).toContain("requestProjectRemove")
    expect(leftNavSource).toContain("disconnectLiveRemoteWorkspace")
    expect(leftNavSource).toContain("removeLeftoverRemoteWorkspaces")
    expect(leftNavSource).toContain("hasArchivedProjectRoots")
    expect(leftNavSource).toContain("purgeDeletedProjectState(directory)")
    expect(leftNavSource).toContain("layout.projects.close(directory)")
    expect(leftNavSource).toContain("DialogProjectUpload")
    expect(leftNavSource).not.toContain('data-action="project-environment"')
    expect(leftNavSource).not.toContain("DialogProjectEnvironment")
    expect(leftNavSource).not.toContain("openProjectEnvironment")
    expect(leftNavSource).toContain('language.t("command.project.upload")')
    expect(leftNavSource).not.toContain('language.t("sidebar.project.environment")')
    expect(leftNavSource).toContain("confirmMoveSession")
    expect(leftNavSource).toContain("moveSession")
    expect(leftNavSource).toContain("moveTo")
    expect(leftNavSource).not.toContain("removeSessionFromProject")
    expect(leftNavSource).toContain("workspaceSkillsHref")
    expect(leftNavSource).toContain('href={workspaceSkillsHref()}')
    expect(leftNavSource).toContain("skillsActive")
    expect(leftNavSource).toContain("workspaceResourcesHref")
    expect(leftNavSource).toContain('href={workspaceResourcesHref()}')
    expect(leftNavSource).toContain("resourcesActive")
    expect(leftNavSource).toContain(">资源配置<")
    expect(leftNavSource).not.toContain("demoProjects")
    expect(leftNavSource).not.toContain("demoTasks")

    const sessionMenuSource = await Bun.file(
      new URL("./workbench/session-context-menu.tsx", import.meta.url),
    ).text()
    expect(sessionMenuSource).toContain('data-action="session-move"')
    expect(sessionMenuSource).toContain('data-action="session-move-new-project"')
    expect(sessionMenuSource).toContain('data-action="session-move-target"')
    expect(sessionMenuSource).toContain("isDefaultPlatformProject")
    expect(sessionMenuSource).not.toContain('data-action="session-move-remove"')
    expect(sessionMenuSource).toContain("canPromote")
  })

  test("pins default shared cases above the left-nav settings footer", async () => {
    const leftNavSource = await Bun.file(new URL("./workbench/left-nav.tsx", import.meta.url)).text()
    const css = await Bun.file(new URL("./index.css", import.meta.url)).text()

    expect(leftNavSource).toContain('data-section="shared-cases"')
    expect(leftNavSource).toContain("sharedCasesRoot")
    expect(leftNavSource).toContain("isPresetCaseSessionId")
    expect(leftNavSource).toContain("sortPresetCaseSessions")
    expect(leftNavSource).toContain("SHARED_CASES_PREVIEW_LIMIT = 4")
    expect(leftNavSource).toContain('language.t("sidebar.section.sharedCases")')
    expect(leftNavSource).toContain("SessionTitleLabel")
    expect(leftNavSource).not.toContain("title={sessionLabel")
    expect(leftNavSource).not.toContain("title={sessionTitle")
    expect(css).toContain(".os-client-session-title-tooltip")
    expect(css).toContain(".os-client-session-title-tip")
    expect(css).toContain(".os-client-session-title-trigger.is-fit")
    expect(leftNavSource.indexOf('data-section="shared-cases"')).toBeLessThan(
      leftNavSource.indexOf("os-sidebar-footer"),
    )
    expect(css).toContain(".os-client-workbench .os-client-shared-cases")
    expect(css).toContain("margin-top: auto")
  })

  test("workbench left-nav scroll stays vertical-only without hover translate", async () => {
    const css = await Bun.file(new URL("./index.css", import.meta.url)).text()
    const navScroll = css.slice(css.indexOf(".os-client-workbench .os-sidebar-nav-scroll"))
    const linkHover = css.slice(css.indexOf(".os-client-workbench .os-sidebar-link:hover"))

    expect(css).toContain(".os-client-workbench .os-sidebar-brand-link [data-component=\"logo-mark\"]")
    expect(css).toContain("background: transparent")
    expect(css).toContain(".os-client-workbench .os-sidebar-brand-link .os-sidebar-label")
    expect(navScroll).toMatch(/overflow-x:\s*hidden/)
    expect(navScroll).toMatch(/overflow-y:\s*auto/)
    expect(navScroll.slice(0, 280)).not.toMatch(/overflow:\s*auto/)
    expect(linkHover.slice(0, 200)).toMatch(/transform:\s*none/)
  })

  test("capability intro page exports and route exist", async () => {
    const intro = await Bun.file(new URL("./workbench/capabilities/intro.tsx", import.meta.url)).text()
    const css = await Bun.file(new URL("./index.css", import.meta.url)).text()
    const app = await Bun.file(new URL("./app.tsx", import.meta.url)).text()
    expect(intro).toContain("CapabilityIntroPage")
    expect(intro).toContain("30 秒看懂")
    expect(intro).toContain("深入资料")
    expect(intro).toContain("docsHref")
    expect(intro).toContain("进入能力向导")
    expect(intro).toContain('data-tone="prepare"')
    expect(intro).toContain('data-tone="flow"')
    expect(intro).toMatch(/data-tone="prepare"[\s\S]*?<ul>[\s\S]*?<li>/)
    expect(intro).toMatch(/data-tone="flow"[\s\S]*?怎么用[\s\S]*?os-client-capability-intro-flow/)
    expect(intro).toContain("怎么用")
    expect(css).toContain(".os-client-workbench .os-client-capability-intro-flow")
    expect(css).toContain(".os-client-workbench .os-client-capability-intro-matrix")
    expect(app).toContain("/capabilities/:id")
  })

  test("exposes /code as the opencode development route", () => {
    expect(oneScienceRoutes.code).toBe("/code")
  })

  test("keeps /dev as a compatibility redirect to /code", () => {
    expect(oneScienceRoutes.devRedirect).toEqual({ from: "/dev", to: "/code" })
  })

  test("maps /code development entry into workspace session routes", () => {
    expect(
      workspaceDevelopmentEntryHref({
        pathname: "/code/Lw/session/ses_1",
        search: "",
        hash: "",
        path: { directory: "/repo" },
        recent: [],
        defaultDirectory: "/data/app/onescience",
        lastCodeWorkspace: "/data/work/my_proj",
      }),
    ).toBe(`/workspace/${base64Encode("/")}/session/ses_1`)
  })

  test("exposes account system routes", () => {
    expect(oneScienceRoutes.login).toBe("/login")
    expect(oneScienceRoutes.register).toBe("/register")
    expect(oneScienceRoutes.forgotPassword).toBe("/forgot-password")
    expect(oneScienceRoutes.account).toBe("/account")
    expect(oneScienceRoutes.users).toBe("/users")
  })

  test("supports admin-assisted password reset from forgot-password page", async () => {
    const appSource = await Bun.file(new URL("./app.tsx", import.meta.url)).text()
    const accountSource = await Bun.file(new URL("./pages/account-system.tsx", import.meta.url)).text()
    const platformAuthSource = await Bun.file(new URL("./utils/platform-auth.ts", import.meta.url)).text()
    const settingsGeneralSource = await Bun.file(new URL("./components/settings-general.tsx", import.meta.url)).text()
    const adminDialogSource = await Bun.file(new URL("./components/dialog-onescience-preset-admin.tsx", import.meta.url)).text()

    expect(appSource).toContain("ForgotPasswordRoute")
    expect(appSource).toContain('<Route path={oneScienceRoutes.forgotPassword} component={ForgotPasswordRoute} />')
    expect(platformAuthSource).toContain('"/forgot-password"')
    expect(platformAuthSource).toContain("resetPlatformPassword")
    expect(platformAuthSource).toContain("requestPlatformPasswordReset")
    expect(accountSource).toContain("ForgotPasswordPage")
    expect(accountSource).toContain("忘记密码？")
    expect(accountSource).toContain("resetPlatformPassword")
    expect(accountSource).toContain("requestPlatformPasswordReset")
    expect(accountSource).toContain("获取验证码")
    expect(accountSource).toContain("邮件验证码")
    expect(accountSource).toContain("adminLinkMode")
    expect(accountSource).toContain('new URLSearchParams(location.search).get("token")')
    expect(accountSource).toContain("重置密码")
    expect(settingsGeneralSource).toContain("DialogOnesciencePresetAdmin")
    expect(settingsGeneralSource).toContain("adminEnabled")
    expect(adminDialogSource).toContain("/global/onescience-preset/admin/accounts")
    expect(adminDialogSource).toContain("/global/onescience-preset/admin/password-reset")
    expect(adminDialogSource).toContain("/global/onescience-preset/admin/mail/config")
    expect(adminDialogSource).toContain("settings.providers.onescience.admin.resetPassword.generate")
    expect(adminDialogSource).toContain("settings.providers.onescience.admin.menu.mail")
    expect(adminDialogSource).toContain("settings.providers.onescience.admin.menu.backends")
    expect(adminDialogSource).toContain("openBackends")
    expect(adminDialogSource).toContain("DialogSelectServer")
    expect(adminDialogSource).toContain('step() === "backends"')
  })

  test("requires login before showing the code development interface", async () => {
    const appSource = await Bun.file(new URL("./app.tsx", import.meta.url)).text()
    const platformAuthSource = await Bun.file(new URL("./utils/platform-auth.ts", import.meta.url)).text()

    expect(platformAuthSource).toContain("isPlatformCodeRoute")
    expect(platformAuthSource).toContain('value === "/code"')
    expect(platformAuthSource).toContain('value.startsWith("/code/")')
    expect(platformAuthSource).toContain('value === "/dev"')
    expect(platformAuthSource).toContain("if (isPlatformCodeRoute(input.pathname)) return true")
    expect(platformAuthSource).toContain("normalizeTimestamp(session.expiresAt) <= Date.now()")
    expect(appSource).toContain("shouldValidatePlatformSession({ pathname, authRequired: platformAuthRequired })")
    expect(appSource).toContain("goPlatformLogin(pathname, search, hash)")
    expect(appSource).toContain("shouldShowPlatformLogin")
    expect(appSource).toContain('navigate(platformAuthUrl({ pathname, search, hash }), { replace: true })')
  })

  test("clears workspace project caches when the platform account changes", async () => {
    localStorage.clear()
    const desktopStores = new Map<string, Map<string, string>>()
    const desktopStorage = (name = "default.dat") => {
      if (!desktopStores.has(name)) desktopStores.set(name, new Map())
      const store = desktopStores.get(name)!
      return {
        getItem: (key: string) => Promise.resolve(store.get(key) ?? null),
        setItem: (key: string, value: string) => {
          store.set(key, value)
          return Promise.resolve()
        },
        removeItem: (key: string) => {
          store.delete(key)
          return Promise.resolve()
        },
      }
    }
    const serverCache = {
      list: ["http://127.0.0.1:4096"],
      projects: { local: [{ worktree: "/workspace/acct-1/case", expanded: true }] },
      lastProject: { local: "/workspace/acct-1/case" },
      lastCodeWorkspace: { local: "/workspace/acct-1/case" },
    }
    const platformSession = (accountID: string, token: string) => ({
      token,
      expiresAt: Date.now() + 60_000,
      account: {
        id: accountID,
        email: `${accountID}@example.com`,
        name: accountID,
        status: "active",
        timeCreated: Date.now(),
      },
      workspaces: [
        {
          id: `workspace-${accountID}`,
          slug: accountID,
          name: `${accountID} workspace`,
          defaultEnvPath: `/workspace/${accountID}`,
          role: "admin",
        },
      ],
      capabilities: {
        terminal: false,
      },
    })

    try {
      localStorage.setItem("opencode.global.dat:server", JSON.stringify(serverCache))
      localStorage.setItem("onescience.code-session-navigation.v1", JSON.stringify({ directory: "/workspace/acct-1/case" }))
      await desktopStorage("opencode.global.dat").setItem("server", JSON.stringify(serverCache))

      await storePlatformAuthSession(platformSession("acct-1", "token-1"), desktopStorage)
      expect(JSON.parse(localStorage.getItem("opencode.global.dat:server") ?? "{}").projects.local).toHaveLength(1)

      // Same-account session refresh must not wipe workspace / lastCode caches.
      await storePlatformAuthSession(
        { ...platformSession("acct-1", "token-1"), capabilities: { terminal: true, sharedCasesRoot: "/data/case" } },
        desktopStorage,
      )
      expect(JSON.parse(localStorage.getItem("opencode.global.dat:server") ?? "{}").projects.local).toHaveLength(1)
      expect(localStorage.getItem("onescience.code-session-navigation.v1")).not.toBeNull()

      await storePlatformAuthSession(platformSession("acct-2", "token-2"), desktopStorage)
      const browserServer = JSON.parse(localStorage.getItem("opencode.global.dat:server") ?? "{}")
      const desktopServer = JSON.parse((await desktopStorage("opencode.global.dat").getItem("server")) ?? "{}")
      expect(browserServer.list).toEqual(serverCache.list)
      expect(browserServer.projects).toEqual({})
      expect(browserServer.lastProject).toEqual({})
      expect(browserServer.lastCodeWorkspace).toEqual({})
      expect(desktopServer.list).toEqual(serverCache.list)
      expect(desktopServer.projects).toEqual({})
      expect(desktopServer.lastProject).toEqual({})
      expect(desktopServer.lastCodeWorkspace).toEqual({})
      expect(localStorage.getItem("onescience.code-session-navigation.v1")).toBeNull()
      expect(localStorage.getItem(PLATFORM_AUTH_TOKEN_STORAGE_KEY)).toBe("token-2")

      await clearPlatformAuthSession(desktopStorage)
      expect(localStorage.getItem(PLATFORM_AUTH_TOKEN_STORAGE_KEY)).toBeNull()
      expect(localStorage.getItem(PLATFORM_AUTH_SESSION_STORAGE_KEY)).toBeNull()
      expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull()
    } finally {
      localStorage.clear()
    }
  })

  test("soft-revalidates cached platform sessions without blocking or logging out on network errors", async () => {
    const appSource = await Bun.file(new URL("./app.tsx", import.meta.url)).text()
    const platformAuthSource = await Bun.file(new URL("./utils/platform-auth.ts", import.meta.url)).text()

    expect(platformAuthSource).toContain("platformAuthSessionUpdatedEvent")
    expect(platformAuthSource).toContain("isPlatformAuthRejection")
    expect(platformAuthSource).toContain("if (!accountChanged) dispatchPlatformAuthSessionUpdated()")
    expect(platformAuthSource).not.toContain(
      "localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, authTokenFromCredentials({ password: next.token }))\n  dispatchPlatformWorkspaceCacheCleared()",
    )
    expect(appSource).toContain("isPlatformAuthRejection(error)")
    expect(appSource).toContain("cached && cached.token === platformToken")
    expect(appSource).toContain("Only force logout when the server rejects the token")
  })

  test("filters platform account projects to the current workspace", () => {
    const session = {
      token: "token",
      expiresAt: Date.now() + 60_000,
      account: {
        id: "acct-liu0218dong",
        email: "liu0218dong@example.com",
        name: "liu0218dong",
        status: "active",
        timeCreated: Date.now(),
      },
      workspaces: [
        {
          id: "workspace-liu0218dong",
          slug: "liu0218dong",
          name: "liu0218dong",
          defaultEnvPath: "/data/guest_data/workspaces/liu0218dong-0cc8f29e",
          role: "admin",
        },
      ],
      capabilities: {
        terminal: false,
      },
    }

    const projects = filterPlatformAccountProjects(
      [
        { worktree: "/data/guest_data/workspaces/lidong6-b9d4d023", expanded: true },
        { worktree: "/data/guest_data/workspaces/liu0218dong-0cc8f29e", expanded: true },
        { worktree: "/data/case", expanded: true },
      ],
      session,
    )

    expect(projects.map((project) => project.worktree)).toEqual([
      "/data/guest_data/workspaces/liu0218dong-0cc8f29e",
    ])
  })

  test("filters platform account projects sandboxes to the current workspace", () => {
    const session = {
      token: "token",
      expiresAt: Date.now() + 60_000,
      account: {
        id: "acct-liu0218dong",
        email: "liu0218dong@example.com",
        name: "liu0218dong",
        status: "active",
        timeCreated: Date.now(),
      },
      workspaces: [
        {
          id: "workspace-liu0218dong",
          slug: "liu0218dong",
          name: "liu0218dong",
          defaultEnvPath: "/data/guest_data/workspaces/liu0218dong-0cc8f29e",
          role: "admin",
        },
      ],
      capabilities: {
        terminal: false,
      },
    }

    const [project] = filterPlatformAccountProjects(
      [
        {
          worktree: "/data/guest_data/workspaces/liu0218dong-0cc8f29e",
          expanded: true,
          sandboxes: [
            "/data/guest_data/workspaces/liu0218dong-0cc8f29e/case-a",
            "/data/guest_data/workspaces/lidong6-b9d4d023/case-b",
            "/data/case",
          ],
        },
      ],
      session,
    )

    expect(project?.sandboxes).toEqual([
      "/data/guest_data/workspaces/liu0218dong-0cc8f29e/case-a",
    ])
    expect(isPathInsidePlatformWorkspace(session, "/data/guest_data/workspaces/lidong6-b9d4d023")).toBe(false)
    expect(isPathInsidePlatformWorkspace(session, "/data/case")).toBe(false)
    expect(isPinnedPlatformWorkspace(session, "/data/guest_data/workspaces/liu0218dong-0cc8f29e")).toBe(true)
    expect(isPinnedPlatformWorkspace(session, "/data/guest_data/workspaces/liu0218dong-0cc8f29e/case-a")).toBe(false)
    expect(isPinnedPlatformWorkspace(session, "/data/case")).toBe(false)
    expect(canAccessPlatformPath(session, "/data/case")).toBe(true)
    expect(canWritePlatformPath(session, "/data/case")).toBe(false)
    expect(canWritePlatformPath(session, "/data/guest_data/workspaces/liu0218dong-0cc8f29e/case-a")).toBe(true)
  })

  test("matches platform account projects when Windows drive casing differs from workspace roots", () => {
    const session = {
      token: "token",
      expiresAt: Date.now() + 60_000,
      account: {
        id: "acct-liu0218dong",
        email: "liu0218dong@example.com",
        name: "liu0218dong",
        status: "active",
        timeCreated: Date.now(),
      },
      workspaces: [
        {
          id: "workspace-liu0218dong",
          slug: "liu0218dong",
          name: "liu0218dong",
          defaultEnvPath: "/data/guest_data/workspaces/liu0218dong-0cc8f29e",
          role: "admin",
        },
      ],
      capabilities: {
        terminal: false,
      },
    }

    const [project] = filterPlatformAccountProjects(
      [
        {
          worktree: "D:/Data/guest_data/workspaces/liu0218dong-0cc8f29e",
          expanded: true,
          sandboxes: [
            "D:/Data/guest_data/workspaces/liu0218dong-0cc8f29e/case-a",
            "D:/Data/guest_data/workspaces/lidong6-b9d4d023/case-b",
          ],
        },
      ],
      session,
    )

    expect(isPathInsidePlatformWorkspace(session, "D:/Data/guest_data/workspaces/liu0218dong-0cc8f29e")).toBe(true)
    expect(project?.worktree).toBe("D:/Data/guest_data/workspaces/liu0218dong-0cc8f29e")
    expect(project?.sandboxes).toEqual(["D:/Data/guest_data/workspaces/liu0218dong-0cc8f29e/case-a"])
  })

  test("aliases Windows backend events to the logged-in workspace route directory", async () => {
    const session = {
      token: "token",
      expiresAt: Date.now() + 60_000,
      account: {
        id: "acct-liu0218dong",
        email: "liu0218dong@example.com",
        name: "liu0218dong",
        status: "active",
        timeCreated: Date.now(),
      },
      workspaces: [
        {
          id: "workspace-liu0218dong",
          slug: "liu0218dong",
          name: "liu0218dong",
          defaultEnvPath: "/data/guest_data/workspaces/liu0218dong-0cc8f29e",
          role: "admin",
        },
      ],
      capabilities: {
        terminal: false,
      },
    }

    expect(platformWorkspacePathAliases(session, "D:/Data/guest_data/workspaces/liu0218dong-0cc8f29e")).toEqual([
      "/data/guest_data/workspaces/liu0218dong-0cc8f29e",
    ])
    expect(platformWorkspacePathAliases(session, "D:/Data/guest_data/workspaces/liu0218dong-0cc8f29e/case")).toEqual([
      "/data/guest_data/workspaces/liu0218dong-0cc8f29e/case",
    ])
    expect(platformWorkspacePathAliases(session, "D:/Data/guest_data/workspaces/lidong6-b9d4d023")).toEqual([])

    const globalSyncSource = await Bun.file(new URL("./context/global-sync.tsx", import.meta.url)).text()
    const sdkSource = await Bun.file(new URL("./context/sdk.tsx", import.meta.url)).text()
    const directoryLayoutSource = await Bun.file(new URL("./pages/directory-layout.tsx", import.meta.url)).text()
    expect(globalSyncSource).toContain("platformWorkspacePathAliases(storedPlatformAuthSession(), directory)")
    expect(sdkSource).toContain("platformWorkspacePathAliases(storedPlatformAuthSession(), event.name)")
    expect(sdkSource).toContain("远端同步失败")
    expect(sdkSource).not.toContain("远端连接仍保持")
    expect(directoryLayoutSource).toContain("远端连接仍保持")
    expect(directoryLayoutSource).toContain("isRemoteWorkspaceConnected(remoteWorkspaceFor(previous))")
    expect(sdkSource).not.toContain("setRemoteWorkspaceFor(current, undefined)")
    expect(sdkSource).toContain("文件树与终端仍走已连接的远端")
    expect(sdkSource).toContain("const clientKey = createMemo")
    expect(sdkSource).toContain("clientKey()")
    expect(sdkSource).not.toContain("sdk.experimental.workspace")
    expect(sdkSource).not.toContain(".remove({")
  })

  test("guards layout project open against outside platform account projects", async () => {
    const layoutSource = await Bun.file(new URL("./context/layout.tsx", import.meta.url)).text()
    const pagesLayoutSource = await Bun.file(new URL("./pages/layout.tsx", import.meta.url)).text()
    const onescienceSource = await Bun.file(new URL("./pages/onescience.tsx", import.meta.url)).text()
    const appSource = await Bun.file(new URL("./app.tsx", import.meta.url)).text()
    const platformAuthSource = await Bun.file(new URL("./utils/platform-auth.ts", import.meta.url)).text()

    expect(layoutSource).toContain("filterPlatformAccountProjects(server.projects.list(), platformSession())")
    expect(layoutSource).toContain("filterPlatformAccountProjects(globalSync.data.project, platformSession())")
    expect(layoutSource).toContain("if (!session) return")
    expect(layoutSource).toContain("if (!canAccessPlatformPath(session, root)) return")
    expect(layoutSource).toContain("if (isSharedCasesPath(session, root)) return")
    expect(layoutSource).toContain("if (isSharedCasesPath(session, project.worktree))")
    expect(layoutSource).toContain("server.projects.close(project.worktree)")
    expect(layoutSource).toContain("browsing chat must not switch workspace")
    expect(platformAuthSource).toContain("if (isSharedCasesPath(session, project.worktree)) return []")
    expect(platformAuthSource).toContain("export function personalWorkspaceDirectory")
    expect(pagesLayoutSource).toContain("personalWorkspaceDirectory(session, server.projects.lastCode())")
    expect(pagesLayoutSource).toContain('activeRoute.sessionProject = ""')
    expect(onescienceSource).toContain("ensureSessions?: (directory: string) => void")
    expect(onescienceSource).toContain("input.ensureSessions?.(root)")
    expect(onescienceSource).not.toContain("openProject: (directory) =>")
    expect(layoutSource).toContain("if (opts?.unlessHidden && hiddenProjects.has(key)) return")
    expect(layoutSource).toContain("if (hiddenProjects.has(pathKey(worktree))) continue")
    expect(layoutSource).toContain("if (!globalSync.bootstrapped) return")
    expect(layoutSource).toContain("const hasUserOpen = open.some(")
    expect(layoutSource).toContain("rehydrate from project.list()")
    expect(layoutSource).toContain("Sidebar-only: do not loadSessions here")
    expect(appSource).toContain("server.projects.touchCode(directory)")
  })

  test("supports password changes from account center", async () => {
    const accountSource = await Bun.file(new URL("./pages/account-system.tsx", import.meta.url)).text()
    const platformAuthSource = await Bun.file(new URL("./utils/platform-auth.ts", import.meta.url)).text()
    const css = await appCss()

    expect(platformAuthSource).toContain("changePlatformPassword")
    expect(platformAuthSource).toContain("/platform/auth/change-password")
    expect(platformAuthSource).toContain("Authorization")
    expect(accountSource).toContain("changePlatformPassword")
    expect(accountSource).toContain("修改密码")
    expect(accountSource).toContain("current-password")
    expect(accountSource).toContain("new-password")
    expect(css).toContain(".os-account-password-form")
    expect(css).toContain(".os-account-success")
  })

  test("exposes code-scoped session routes", () => {
    expect(oneScienceRoutes.codeSession).toBe("/code/:dir/session/:id?")
    expect(codeSessionHref("/")).toBe("/code/Lw/session")
    expect(codeSessionHref("/", "ses_1")).toBe("/code/Lw/session/ses_1")
    expect(codeSlugSessionHref("Lw")).toBe("/code/Lw/session")
    expect(codeSlugSessionHref("Lw", "ses_1")).toBe("/code/Lw/session/ses_1")
    expect(sessionHrefForPath("/code/Lw/session", "Lw", "ses_2")).toBe("/code/Lw/session/ses_2")
    expect(sessionHrefForPath("/Lw/session", "Lw", "ses_2")).toBe("/Lw/session/ses_2")
  })

  test("reads the active workspace from /code session URLs", () => {
    expect(codeRouteWorkspaceDirectory(codeSessionHref("/data/app/new-project"))).toBe("/data/app/new-project")
    expect(codeRouteWorkspaceDirectory(codeSessionHref("/data/app/new-project", "ses_1"))).toBe("/data/app/new-project")
    expect(codeRouteWorkspaceDirectory("/code")).toBeUndefined()
    expect(codeRouteWorkspaceDirectory("/code/d-code/session")).toBeUndefined()
  })

  test("chooses a concrete workspace for the /code AI session", () => {
    expect(codeWorkspaceDirectory({ directory: "/repo", home: "/home/user" }, [], "/data/app/onescience")).toBe("/data/app/onescience")
    expect(codeWorkspaceDirectory({ directory: "/repo", home: "/home/user" }, [{ worktree: "/recent" }], "/data/app/onescience")).toBe(
      "/data/app/onescience",
    )
    expect(
      codeWorkspaceDirectory({ directory: "/repo", home: "/home/user" }, [{ worktree: "/data/app/onescience" }], "/data/app/onescience"),
    ).toBe("/data/app/onescience")
    expect(codeWorkspaceDirectory({ directory: "/repo", home: "/home/user" }, [])).toBe("/repo")
    expect(codeWorkspaceDirectory({ directory: "/repo" }, [{ worktree: "/recent" }])).toBe("/recent")
    expect(codeWorkspaceDirectory({}, [])).toBe("/")
    expect(
      codeWorkspaceDirectory({ directory: "/repo", home: "/home/user" }, [{ worktree: "/data/app/onescience" }], "/data/app/onescience", "/data/work/my_proj"),
    ).toBe("/data/work/my_proj")
    expect(persistableWorkspacePath("/")).toBeUndefined()
    expect(codeWorkspaceDirectory({ directory: "/repo" }, [], "/data/app/onescience", "/")).toBe("/data/app/onescience")
  })

  test("uses the logged-in account workspace instead of the shared case directory", () => {
    const session = {
      token: "token",
      expiresAt: Date.now() + 60_000,
      account: {
        id: "acct-1",
        email: "one@example.com",
        name: "One User",
        status: "active",
        timeCreated: Date.now(),
      },
      workspaces: [
        {
          id: "wrk-1",
          slug: "one",
          name: "One workspace",
          defaultEnvPath: "/data/guest_data/workspaces/one",
          role: "admin",
        },
      ],
      capabilities: {
        terminal: false,
      },
    }

    expect(
      codeWorkspaceDirectory(
        { directory: "/data/onecode", home: "/home/user" },
        [{ worktree: "/data/case" }],
        "/data/case",
        "/data/case",
        session,
      ),
    ).toBe("/data/guest_data/workspaces/one/default")
    expect(
      codeWorkspaceDirectory(
        { directory: "/data/onecode", home: "/home/user" },
        [],
        "/data/case",
        "/data/guest_data/workspaces/one/case-a",
        session,
      ),
    ).toBe("/data/guest_data/workspaces/one/case-a")
  })

  test("keeps shared cases /code routes for logged-in accounts", () => {
    const session = {
      token: "token",
      expiresAt: Date.now() + 60_000,
      account: {
        id: "acct-1",
        email: "one@example.com",
        name: "One User",
        status: "active",
        timeCreated: Date.now(),
      },
      workspaces: [
        {
          id: "wrk-1",
          slug: "one",
          name: "One workspace",
          defaultEnvPath: "/data/guest_data/workspaces/one",
          role: "admin",
        },
      ],
      capabilities: {
        terminal: false,
        sharedCasesRoot: "/data/case",
      },
    }

    expect(
      codeDevelopmentEntryHref({
        pathname: codeSessionHref("/data/case", "ses_shared"),
        search: "?view=shared",
        hash: "#files",
        path: { directory: "/data/onecode", home: "/home/user" },
        recent: [{ worktree: "/data/case" }],
        defaultDirectory: "/data/case",
        lastCodeWorkspace: "/data/guest_data/workspaces/one",
        accountSession: session,
      }),
    ).toBe(`${codeSessionHref("/data/case", "ses_shared")}?view=shared#files`)
    expect(
      codeDevelopmentEntryHref({
        pathname: codeSessionHref("/outside/other", "ses_old"),
        search: "?view=old",
        hash: "#files",
        path: { directory: "/data/onecode", home: "/home/user" },
        recent: [{ worktree: "/data/case" }],
        defaultDirectory: "/data/case",
        lastCodeWorkspace: "/data/case",
        accountSession: session,
      }),
    ).toBe(codeSessionHref("/data/guest_data/workspaces/one/default"))
  })

  test("container EXTRA_PATH/case is never the first /code home for logged-in accounts", () => {
    const session = {
      token: "token",
      expiresAt: Date.now() + 60_000,
      account: {
        id: "acct-1",
        email: "one@example.com",
        name: "One User",
        status: "active",
        timeCreated: Date.now(),
      },
      workspaces: [
        {
          id: "wrk-1",
          slug: "one",
          name: "One workspace",
          defaultEnvPath: "/data/guest_data/workspaces/one",
          role: "admin",
        },
      ],
      capabilities: {
        terminal: true,
        sharedCasesRoot: "/data/guest_data/case",
      },
    }
    const catalog = "/data/guest_data/case"

    expect(
      codeWorkspaceDirectory(
        { directory: catalog, home: "/root", onecode_extra_path: "/data/guest_data" },
        [{ worktree: catalog }],
        catalog,
        catalog,
        session,
      ),
    ).toBe("/data/guest_data/workspaces/one/default")

    expect(
      codeDevelopmentEntryHref({
        pathname: "/home",
        search: "",
        hash: "",
        path: { directory: catalog, home: "/root", onecode_extra_path: "/data/guest_data" },
        recent: [{ worktree: catalog }],
        defaultDirectory: catalog,
        lastCodeWorkspace: catalog,
        accountSession: session,
      }),
    ).toBe(codeSessionHref("/data/guest_data/workspaces/one/default"))

    // Blank new-session under the shared catalog must rewrite to the personal default.
    expect(
      codeDevelopmentEntryHref({
        pathname: codeSessionHref(catalog),
        search: "",
        hash: "",
        path: { directory: catalog, home: "/root", onecode_extra_path: "/data/guest_data" },
        recent: [],
        defaultDirectory: catalog,
        accountSession: session,
      }),
    ).toBe(codeSessionHref("/data/guest_data/workspaces/one/default"))

    // Intentional browse of a concrete shared session stays put.
    expect(
      codeDevelopmentEntryHref({
        pathname: codeSessionHref(catalog, "ses_shared"),
        search: "",
        hash: "",
        path: { directory: catalog, home: "/root" },
        recent: [],
        defaultDirectory: catalog,
        accountSession: session,
      }),
    ).toBe(codeSessionHref(catalog, "ses_shared"))
  })

  test("preserves sharedCasesRoot and keeps extra-path shared case routes", async () => {
    localStorage.clear()
    const sharedRoot = "/data/hanmk/privated_data/case"
    const session = {
      token: "token-shared",
      expiresAt: Date.now() + 60_000,
      account: {
        id: "acct-1",
        email: "one@example.com",
        name: "One User",
        status: "active",
        timeCreated: Date.now(),
      },
      workspaces: [
        {
          id: "wrk-1",
          slug: "one",
          name: "One workspace",
          defaultEnvPath: "/data/hanmk/privated_data/workspaces/one",
          role: "admin",
        },
      ],
      capabilities: {
        terminal: false,
        sharedCasesRoot: sharedRoot,
      },
    }

    try {
      await storePlatformAuthSession(session)
      const stored = JSON.parse(localStorage.getItem(PLATFORM_AUTH_SESSION_STORAGE_KEY) ?? "{}")
      expect(stored.capabilities.sharedCasesRoot).toBe(sharedRoot)

      expect(
        codeDevelopmentEntryHref({
          pathname: codeSessionHref(sharedRoot, "ses_shared"),
          search: "",
          hash: "",
          path: { directory: "/data/onecode", home: "/home/user", onecode_extra_path: "/data/hanmk/privated_data" },
          recent: [{ worktree: sharedRoot }],
          defaultDirectory: sharedRoot,
          lastCodeWorkspace: "/data/hanmk/privated_data/workspaces/one",
          accountSession: stored,
        }),
      ).toBe(codeSessionHref(sharedRoot, "ses_shared"))
    } finally {
      localStorage.clear()
    }
  })

  test("gates model settings behind platform login when auth is required", async () => {
    const settingsSource = await Bun.file(new URL("./components/dialog-settings.tsx", import.meta.url)).text()
    const accountSource = await Bun.file(new URL("./components/settings-account.tsx", import.meta.url)).text()
    const css = await Bun.file(new URL("./index.css", import.meta.url)).text()
    const zh = await Bun.file(new URL("./i18n/zh.ts", import.meta.url)).text()
    expect(settingsSource).toContain("isPlatformAuthRequired")
    expect(settingsSource).toContain("storedPlatformAuthSession")
    expect(settingsSource).toContain("SettingsLoginGate")
    expect(settingsSource).toContain('value="account"')
    expect(settingsSource).toContain("SettingsAccount")
    expect(settingsSource).toContain('class="os-client-settings-dialog"')
    expect(settingsSource).toContain('title={language.t("sidebar.settings")}')
    expect(accountSource).toContain("settings.account.action.login")
    expect(accountSource).toContain("settings.account.action.logout")
    // Soft navigate keeps cancel/login fast; hard location.assign remounts the app.
    expect(accountSource).toContain("platformAuthUrl")
    expect(accountSource).toContain("navigate(")
    expect(accountSource).toContain('navigate("/login", { replace: true })')
    expect(accountSource).toContain('platform.platform === "desktop"')
    expect(css).toContain(".os-client-settings-dialog[data-slot=\"dialog-content\"]")
    expect(css).toContain(".os-client-settings-dialog .os-client-settings-panel")
    expect(zh).toContain('"settings.authRequired.models"')
    expect(zh).toContain('"settings.tab.account"')
  })

  test("adapts login auth shell to dark color scheme", async () => {
    const css = await Bun.file(new URL("./index.css", import.meta.url)).text()
    expect(css).toContain('html[data-color-scheme="dark"] .os-auth-page')
    expect(css).toContain('html[data-color-scheme="dark"] .os-auth-shell')
    expect(css).toContain('html[data-color-scheme="dark"] .os-auth-panel')
    expect(css).toContain('html[data-color-scheme="dark"] .os-auth-form input')
    expect(css).toContain('html[data-color-scheme="dark"] .os-auth-form input::placeholder')
    expect(css).toContain('html[data-color-scheme="dark"] .os-auth-dismiss')
    expect(css).toContain('html[data-color-scheme="dark"] .os-auth-link-button')
  })

  test("makes capability tab active states visible in dark color scheme", async () => {
    const css = await Bun.file(new URL("./index.css", import.meta.url)).text()
    const active = css.slice(
      css.indexOf(
        'html[data-color-scheme="dark"] .os-client-workbench .os-client-capability-domain-row button.is-active',
      ),
      css.indexOf(
        'html[data-color-scheme="dark"] .os-client-workbench .os-client-capability-tabs button.is-active strong',
      ),
    )
    expect(active).toContain("var(--os-wb-surface-active)")
    expect(active).toContain("var(--os-wb-border-strong)")
    expect(active).not.toContain("173, 40, 48")
    expect(css).toContain(
      'html[data-color-scheme="dark"] .os-client-workbench .os-client-capability-wizard-scenarios button.is-active',
    )
    expect(css).toContain('html[data-color-scheme="dark"] .os-client-right-files-mode button.is-active')
  })

  test("blocks session composer when platform auth is required and user is logged out", async () => {
    const composerSource = await Bun.file(
      new URL("./pages/session/composer/session-composer-region.tsx", import.meta.url),
    ).text()
    expect(composerSource).toContain("if (loggedOut()) return true")
    expect(composerSource).toContain("loggedOut")
  })

  test("surfaces default cases beside projects instead of recent", async () => {
    const sidebarCodeTreeSource = await Bun.file(new URL("./pages/layout/sidebar-code-tree.tsx", import.meta.url)).text()
    const zh = await Bun.file(new URL("./i18n/zh.ts", import.meta.url)).text()
    const sidebarItemsSource = await Bun.file(new URL("./pages/layout/sidebar-items.tsx", import.meta.url)).text()
    const composerSource = await Bun.file(
      new URL("./pages/session/composer/session-composer-region.tsx", import.meta.url),
    ).text()

    expect(sidebarCodeTreeSource).toContain('language.t("sidebar.section.sharedCases")')
    expect(sidebarCodeTreeSource).toContain('data-section="shared-cases"')
    expect(sidebarCodeTreeSource).toContain('data-action="shared-cases-toggle"')
    expect(sidebarCodeTreeSource).toContain("allowIds={PRESET_CASE_SESSION_IDS}")
    expect(sidebarCodeTreeSource).toContain("readOnlyActions")
    expect(sidebarCodeTreeSource).toContain("previewLimit={SHARED_CASES_PREVIEW_LIMIT}")
    expect(sidebarCodeTreeSource).toContain("const SHARED_CASES_PREVIEW_LIMIT = 5")
    expect(sidebarCodeTreeSource).toContain('data-action="session-load-more"')
    expect(sidebarCodeTreeSource).toContain('data-action="session-collapse-preview"')
    expect(sidebarCodeTreeSource).toContain("sharedDirectory()")
    expect(sidebarCodeTreeSource).toContain("newSessionSlug()")
    expect(sidebarCodeTreeSource).toContain("defaultPlatformProjectDirectory")
    expect(sidebarCodeTreeSource).toContain("Do not fall back to shared-cases")
    expect(sidebarCodeTreeSource).toContain("Always navigate so a stale session")
    expect(sidebarCodeTreeSource).toContain("Accordion: switching projects collapses every other folder")
    expect(sidebarCodeTreeSource).toContain("if (existing !== key) setExpanded(existing, false)")
    expect(sidebarCodeTreeSource).toContain('data-current-project={current() ? "true" : undefined}')
    expect(sidebarCodeTreeSource).not.toContain('language.t("sidebar.project.current")')
    expect(sidebarCodeTreeSource).not.toContain('language.t("sidebar.section.recent")')
    expect(sidebarCodeTreeSource.indexOf('data-section="shared-cases"')).toBeLessThan(
      sidebarCodeTreeSource.indexOf('language.t("sidebar.section.projects")'),
    )
    expect(sidebarItemsSource).toContain("isSharedCasesPath(storedPlatformAuthSession(), props.session.directory)")
    expect(composerSource).toContain("isSharedCodeCatalogDirectory")
    expect(composerSource).toContain("SharedCaseForkBanner")
    expect(composerSource).toContain('type !== "fork"')
    expect(composerSource).toContain("const composerBlocked = createMemo")
    expect(composerSource.indexOf("sharedReadonly")).toBeLessThan(composerSource.indexOf("composerBlocked"))
    expect(zh).toContain('"sidebar.section.sharedCases": "默认案例展示"')
    expect(zh).toContain('"sidebar.project.current": "当前"')
    expect(zh).toContain('"sidebar.project.defaultWorkspace": "主空间"')
  })

  test("redirects stale /code routes outside the logged-in account workspace", () => {
    const session = {
      token: "token",
      expiresAt: Date.now() + 60_000,
      account: {
        id: "acct-1",
        email: "one@example.com",
        name: "One User",
        status: "active",
        timeCreated: Date.now(),
      },
      workspaces: [
        {
          id: "wrk-1",
          slug: "one",
          name: "One workspace",
          defaultEnvPath: "/data/guest_data/workspaces/one",
          role: "admin",
        },
      ],
      capabilities: {
        terminal: false,
      },
    }

    expect(
      codeDevelopmentEntryHref({
        pathname: codeSessionHref("/tmp/unrelated", "ses_old"),
        search: "?view=old",
        hash: "#files",
        path: { directory: "/data/onecode", home: "/home/user" },
        recent: [{ worktree: "/data/case" }],
        defaultDirectory: "/data/case",
        lastCodeWorkspace: "/data/case",
        accountSession: session,
      }),
    ).toBe(codeSessionHref("/data/guest_data/workspaces/one/default"))
    expect(
      codeDevelopmentEntryHref({
        pathname: codeSessionHref("/data/guest_data/workspaces/one/case-a", "ses_1"),
        search: "?view=current",
        hash: "#files",
        path: { directory: "/data/onecode", home: "/home/user" },
        recent: [],
        defaultDirectory: "/data/case",
        accountSession: session,
      }),
    ).toBe(`${codeSessionHref("/data/guest_data/workspaces/one/case-a", "ses_1")}?view=current#files`)
  })

  test("restores the last user-selected code workspace when re-entering development", () => {
    expect(
      codeWorkspaceDirectory(
        { directory: "/data/hanmk/onecode", home: "/home/hanmk" },
        [{ worktree: "/data/hanmk/privated_data/case" }],
        "/data/hanmk/privated_data/case",
        "/data/work/my_proj",
      ),
    ).toBe("/data/work/my_proj")
    expect(
      codeEntryWorkspaceDirectory({
        path: { directory: "/data/hanmk/onecode", onecode_extra_path: "/data/hanmk/privated_data" },
        recent: [{ worktree: "/data/hanmk/privated_data/case" }],
        lastCodeWorkspace: "/data/work/my_proj",
      }),
    ).toBe("/data/work/my_proj")
  })

  test("ignores serve cwd when remembering the last code workspace", () => {
    expect(
      codeWorkspaceDirectory(
        { directory: "/data/hanmk/onecode", home: "/home/hanmk" },
        [{ worktree: "/data/hanmk/onecode" }],
        "/data/hanmk/privated_data/case",
      ),
    ).toBe("/data/hanmk/privated_data/case")
    expect(
      codeWorkspaceDirectory(
        { directory: "/data/hanmk/onecode", home: "/home/hanmk" },
        [{ worktree: "/data/hanmk/onecode" }],
        "/data/hanmk/privated_data/case",
        "/data/hanmk/onecode",
      ),
    ).toBe("/data/hanmk/privated_data/case")
    expect(
      codeEntryWorkspaceDirectory({
        path: { directory: "/data/hanmk/onecode", onecode_extra_path: "/data/hanmk/privated_data" },
        recent: [{ worktree: "/data/hanmk/onecode" }],
      }),
    ).toBe("/data/hanmk/privated_data/case")
    expect(
      codeEntryWorkspaceDirectory({
        path: { directory: "/data/hanmk/onecode" },
        recent: [{ worktree: "/data/hanmk/onecode" }],
      }),
    ).toBe("/data/case")
    expect(
      codeEntryWorkspaceDirectory({
        path: { directory: "/data/hanmk/onecode", onecode_extra_path: "/data" },
        recent: [{ worktree: "/data/hanmk/onecode" }],
      }),
    ).toBe("/data/case")
  })

  test("ignores stale /data/case memory when a desktop data root is configured", () => {
    expect(
      codeWorkspaceDirectory(
        { directory: "C:\\Users\\me\\AppData\\Roaming\\ai.opencode.desktop.dev", onecode_extra_path: "D:\\onecode_proj" },
        [{ worktree: "/data/case" }],
        "D:/onecode_proj/case",
        "/data/case",
      ),
    ).toBe("D:/onecode_proj/case")
    expect(
      codeWorkspaceDirectory(
        { directory: "C:\\Users\\me\\AppData\\Roaming\\ai.opencode.desktop.dev", onecode_extra_path: "D:\\onecode_proj" },
        [{ worktree: "D:/data/case" }],
        "D:/onecode_proj/case",
        "D:/data/case",
      ),
    ).toBe("D:/onecode_proj/case")
    expect(codeDefaultDirectoryForExtraPath("D:\\onecode_proj")).toBe("D:/onecode_proj/case")
  })

  test("uses project_data_root when onecode_extra_path is missing", () => {
    expect(
      configuredCodeDefaultDirectory(document, { project_data_root: "D:\\onecode_proj_1" }),
    ).toBe("D:/onecode_proj_1/case")
    expect(
      codeEntryWorkspaceDirectory({
        path: {
          directory: "C:\\Users\\me\\AppData\\Roaming\\ai.onescience.onecode.desktop",
          project_data_root: "D:\\onecode_proj_1",
        },
        recent: [{ worktree: "D:/data/case" }],
        lastCodeWorkspace: "D:/data/case",
      }),
    ).toBe("D:/onecode_proj_1/case")
  })

  test("prefers the connected workspace over the demo default on OneHub resource pages", () => {
    expect(
      oneScienceResourceWorkspaceDirectory(
        { worktree: "/", directory: "/data/appuser_8007", home: "/home/user" },
        [],
        "/data/case",
      ),
    ).toBe("/data/appuser_8007")
    expect(
      oneScienceResourceWorkspaceDirectory(
        { worktree: "/", directory: "/data/appuser_8007", home: "/home/user" },
        [],
        "/data/case",
        "/data/work/my_proj",
      ),
    ).toBe("/data/work/my_proj")
  })

  test("rewrites an active /code route stuck on D:/data/case when data root is known", () => {
    resetCodeSessionNavigationForTest()
    const stale = codeSessionHref("D:/data/case", "ses_1")
    expect(
      codeDevelopmentEntryHref({
        pathname: stale.split("?")[0]!,
        search: "",
        hash: "",
        path: {
          directory: "C:\\Users\\me\\AppData\\Roaming\\ai.onescience.onecode.desktop",
          onecode_extra_path: "D:\\onecode_proj_1",
        },
        recent: [{ worktree: "D:/data/case" }],
        defaultDirectory: "D:/onecode_proj_1/case",
        lastCodeWorkspace: "D:/data/case",
      }),
    ).toBe(codeSessionHref("D:/onecode_proj_1/case"))
  })

  test("keeps the active code session while already in /code", () => {
    expect(
      codeDevelopmentEntryHref({
        pathname: "/code/Lw/session/ses_1",
        search: "",
        hash: "",
        path: { directory: "/repo" },
        recent: [],
        defaultDirectory: "/data/app/onescience",
        lastCodeWorkspace: "/data/work/my_proj",
      }),
    ).toBe("/code/Lw/session/ses_1")
  })


  test("builds prompt links with an explicit code workspace", () => {
    expect(codePromptHref("/data/work/my_proj", "hello science")).toBe(
      `${codeSessionHref("/data/work/my_proj")}?prompt=hello%20science`,
    )
  })

  test("restores the last opened project when leaving /code", () => {
    resetCodeSessionNavigationForTest()
    expect(
      codeDevelopmentEntryHref({
        pathname: "/home",
        search: "",
        hash: "",
        path: { directory: "/repo" },
        recent: [{ worktree: "/data/app/onescience" }],
        defaultDirectory: "/data/app/onescience",
        lastCodeWorkspace: "/data/work/my_proj",
      }),
    ).toBe(codeSessionHref("/data/work/my_proj"))
  })

  test("builds the default project session href", () => {
    expect(defaultProjectSessionHref()).toBe(codeSessionHref(fallbackCodeDefaultDirectory))
  })

  test("reads the /code default workspace from runtime metadata", () => {
    const meta = document.createElement("meta")
    meta.name = codeDefaultDirectoryMetaName
    meta.content = "/data/app/onescience"
    document.head.append(meta)

    expect(configuredCodeDefaultDirectory()).toBe("/data/app/onescience")

    meta.remove()
    expect(configuredCodeDefaultDirectory()).toBe(fallbackCodeDefaultDirectory)
    expect(configuredCodeDefaultDirectory(document, { onecode_extra_path: "/data/hanmk/privated_data" })).toBe(
      "/data/hanmk/privated_data/case",
    )
    expect(configuredCodeDefaultDirectory(document, { onecode_extra_path: "/data" })).toBe("/data/case")
    expect(codeDefaultDirectoryForExtraPath("/data")).toBe("/data/case")

    const extraMeta = document.createElement("meta")
    extraMeta.name = onecodeExtraPathMetaName
    extraMeta.content = "/data/hanmk/privated_data"
    document.head.append(extraMeta)
    expect(configuredCodeDefaultDirectory()).toBe("/data/hanmk/privated_data/case")
    extraMeta.remove()
  })

  test("prioritizes recent workspaces for /code preload", () => {
    expect(
      codeWorkspaceRecentProjects([
        { worktree: "/old", time: { updated: 10 } },
        { worktree: "/new", time: { created: 30 } },
        { worktree: "/mid", time: { updated: 20 } },
      ]).map((project) => project.worktree),
    ).toEqual(["/new", "/mid", "/old"])
  })

  test("keeps the embedded workspace session sidebar available", async () => {
    const appSource = await Bun.file(new URL("./app.tsx", import.meta.url)).text()
    const css = await appCss()

    expect(appSource).toContain("os-workspace-session-embed")
    expect(appSource).not.toContain('<Layout embeddedCode routePrefix="/workspace">')
    expect(appSource).toContain("Workbench already owns left-nav/chrome")
    expect(appSource).toContain("sync.session.ensureListed(directory, sessionID)")
    expect(appSource).toContain("notification.session.markViewed(sessionID)")
    expect(css).toContain('.os-workspace-session-embed [data-component="sidebar-nav-desktop"]')
    expect(css).toContain('.os-code-embed [data-component="sidebar-nav-desktop"]')
  })

  test("themes embedded /code without affecting standalone opencode", async () => {
    const css = await appCss()
    expect(css).toContain(".os-code-embed {")
    expect(css).toContain("--os-code-shell:")
    expect(css).toContain('.os-code-embed [data-component="code-project-tree"]')
    expect(css).toContain('.os-code-embed [data-component="sidebar-nav-desktop"]')
    expect(css).toContain(".os-code-embed main")
    expect(css).toContain('.os-code-embed [data-session-shell] > [data-session-chrome]')
    expect(css).toContain("padding-top: 0 !important;")
    expect(css).toContain("padding-left: 0 !important;")
    expect(css).toContain("padding-right: 0 !important;")
    expect(css).toContain('.os-code-embed [data-session-conversation]')
    expect(css).toContain("margin-top: 0;")
    expect(css).toContain(".os-code-embed [data-session-shell] > [data-session-chrome] > .flex")
    expect(css).toContain("gap: 0 !important;")
    expect(css).toContain('.os-code-embed #file-tree-panel [data-component="tabs"][data-scope="filetree"] > [data-slot="tabs-list"]')
    const fileTreeTabs = css.slice(
      css.indexOf('.os-code-embed #file-tree-panel [data-component="tabs"][data-scope="filetree"] > [data-slot="tabs-list"]'),
      css.indexOf('.os-code-embed [data-component="code-project-tree"] .text-text-weak'),
    )
    expect(fileTreeTabs).toContain("height: 48px !important;")
    expect(fileTreeTabs).not.toContain("height: auto")
    expect(fileTreeTabs).toContain("padding-top: 0 !important;")
    expect(fileTreeTabs).toContain("padding-bottom: 0 !important;")
    expect(css).not.toContain(':not(.os-code-embed) [data-component="code-project-tree"]')
  })

  test("uses the compact opencode sidebar inside workspace session embed", async () => {
    const appSource = await Bun.file(new URL("./app.tsx", import.meta.url)).text()
    const layoutSource = await Bun.file(new URL("./pages/layout.tsx", import.meta.url)).text()
    const sidebarShellSource = await Bun.file(new URL("./pages/layout/sidebar-shell.tsx", import.meta.url)).text()
    const titlebarSource = await Bun.file(new URL("./components/titlebar.tsx", import.meta.url)).text()

    expect(appSource).toContain('<DirectoryLayout prefix="/workspace">')
    expect(appSource).toContain("os-workspace-session-embed")
    expect(appSource).toContain("Workbench already owns left-nav")
    expect(layoutSource).toContain("embeddedCode?: boolean")
    expect(layoutSource).toContain("routePrefix?: string")
    expect(layoutSource).toContain("<Titlebar embeddedCode={props.embeddedCode} />")
    expect(titlebarSource).toContain("embeddedCode?: boolean")
    expect(titlebarSource).toContain("!props.embeddedCode")
    expect(sidebarShellSource).toContain('data-component="sidebar-project-select"')
    expect(sidebarShellSource).toContain("!props.embeddedCode")
    expect(layoutSource).toContain("CodeProjectTree")
    expect(layoutSource).toContain('layout.fileTree.setTab("all")')
    expect(layoutSource).toContain("layout.review.close()")
    expect(layoutSource).toContain("layoutReady()")
  })

  test("keeps titlebar session and terminal actions available when desktop sidebar is open", async () => {
    const titlebarSource = await Bun.file(new URL("./components/titlebar.tsx", import.meta.url)).text()

    expect(titlebarSource).not.toContain('"opacity-0 duration-120 ease-in delay-0 pointer-events-none": layout.sidebar.opened()')
    expect(titlebarSource).not.toContain('disabled={layout.sidebar.opened()}')
    expect(titlebarSource).not.toContain('tabIndex={layout.sidebar.opened() ? -1 : undefined}')
    expect(titlebarSource).not.toContain('"-translate-x-[36px]": layout.sidebar.opened() && !!params.dir')
  })

  test("offers destructive project delete with confirmation from project menus", async () => {
    const layoutSource = await Bun.file(new URL("./pages/layout.tsx", import.meta.url)).text()
    const sidebarProjectSource = await Bun.file(new URL("./pages/layout/sidebar-project.tsx", import.meta.url)).text()
    const sidebarCodeTreeSource = await Bun.file(new URL("./pages/layout/sidebar-code-tree.tsx", import.meta.url)).text()

    expect(layoutSource).toContain("purgeProjectSessionState")
    expect(layoutSource).toContain("DialogDeleteProject")
    expect(layoutSource).toContain("showDeleteProjectDialog")
    expect(layoutSource).toContain("requestProjectRemove")
    expect(layoutSource).toContain("disconnectLiveRemoteWorkspace")
    expect(layoutSource).toContain("removeLeftoverRemoteWorkspaces")
    expect(layoutSource).toContain("hasArchivedProjectRoots")
    expect(layoutSource).toContain("closeProject(directory)")
    expect(layoutSource).toContain("sidebar.project.delete.hasArchived")
    expect(sidebarProjectSource).toContain('data-action="project-delete"')
    expect(sidebarProjectSource).toContain('props.language.t("sidebar.project.delete")')
    expect(sidebarCodeTreeSource).toContain('data-action="project-delete"')
    expect(sidebarCodeTreeSource).toContain('language.t("sidebar.project.delete")')
    expect(sidebarCodeTreeSource).not.toContain('data-action="project-copy-path"')
    expect(sidebarCodeTreeSource).not.toContain("sidebar.project.removeFromView")
  })

  test("lets /code project menus open a new session in that project directory", async () => {
    const sidebarCodeTreeSource = await Bun.file(new URL("./pages/layout/sidebar-code-tree.tsx", import.meta.url)).text()

    expect(sidebarCodeTreeSource).toContain('data-action="project-new-session"')
    expect(sidebarCodeTreeSource).toContain("openNewSessionInProject(project.worktree)")
    expect(sidebarCodeTreeSource).toContain("markCodeNewSessionIntent(slug)")
    expect(sidebarCodeTreeSource).toContain("navigate(`${props.routePrefix}/${slug}/session`)")
    expect(sidebarCodeTreeSource).toContain('language.t("command.session.new")')
    expect(sidebarCodeTreeSource).not.toContain('data-action="project-environment"')
    expect(sidebarCodeTreeSource).not.toContain("openProjectEnvironment")
    expect(sidebarCodeTreeSource).not.toContain('language.t("sidebar.project.environment")')
    expect(sidebarCodeTreeSource).not.toContain("DialogProjectEnvironment")
    expect(sidebarCodeTreeSource).toContain("Show when={!isDefault()}")
  })

  test("loads /code sidebar sessions via /global/session without instance bootstrap", async () => {
    const sidebarCodeTreeSource = await Bun.file(new URL("./pages/layout/sidebar-code-tree.tsx", import.meta.url)).text()
    const globalSyncSource = await Bun.file(new URL("./context/global-sync.tsx", import.meta.url)).text()
    const childStoreSource = await Bun.file(new URL("./context/global-sync/child-store.ts", import.meta.url)).text()
    const bootstrapSource = await Bun.file(new URL("./context/global-sync/bootstrap.ts", import.meta.url)).text()
    const pageLayoutSource = await Bun.file(new URL("./pages/layout.tsx", import.meta.url)).text()
    const layoutContextSource = await Bun.file(new URL("./context/layout.tsx", import.meta.url)).text()
    const useProvidersSource = await Bun.file(new URL("./hooks/use-providers.ts", import.meta.url)).text()
    const promptInputSource = await Bun.file(new URL("./components/prompt-input.tsx", import.meta.url)).text()
    const globalSessionListSource = await Bun.file(new URL("./utils/global-session-list.ts", import.meta.url)).text()
    const helper = sidebarCodeTreeSource.slice(sidebarCodeTreeSource.indexOf("const SessionBlock"))

    expect(helper).toContain("globalSync.project.loadSessions")
    expect(helper).toContain("bootstrap: false")
    expect(helper).toContain("sortedRootSessions(store, props.sortNow(), props.directory)")
    expect(helper).toContain("isPresetCaseSessionId")
    expect(helper).toContain("Never fall back to unfiltered store.session")
    expect(helper).toContain("!store.sessionListReady && count() === 0")
    expect(helper).toContain("paintSkeleton")
    expect(helper).toContain("setTimeout(() => setPaintSkeleton(true), 150)")
    expect(helper).not.toContain("bootstrap: true")
    expect(helper).not.toContain("useIsFetching")
    expect(helper).not.toContain("createSessionListReady")
    expect(sidebarCodeTreeSource).toContain("For each={treeProjects()}")
    expect(globalSyncSource).toContain("listGlobalSessions")
    expect(globalSyncSource).toContain("/global/session")
    expect(globalSyncSource).toContain("retry: false")
    expect(globalSyncSource).toContain("providersEnabled")
    expect(globalSyncSource).toContain("ensureProviders")
    expect(globalSyncSource).toContain("silent: true")
    expect(globalSyncSource).toContain("platformAuthSessionUpdatedEvent")
    expect(globalSyncSource).toContain("toast.provider.catalogLoading")
    expect(globalSyncSource).toContain("ensureQueryData")
    expect(globalSyncSource).toContain("shouldToastProviderCatalog")
    expect(globalSyncSource).toContain("shouldJoinProviderCatalogFetch")
    expect(globalSyncSource).toContain("providersLoading")
    expect(globalSyncSource).toContain("raceProviderCatalogWait")
    expect(globalSyncSource).toContain("Await global /provider only")
    expect(globalSyncSource).not.toContain("Promise.all(queries)")
    const localSource = await Bun.file(new URL("./context/local.tsx", import.meta.url)).text()
    expect(localSource).toContain("onescienceModelDisplayName")
    expect(localSource).toContain("onescienceProviderDisplayName")
    expect(localSource).toContain("shouldKeepSavedModel")
    expect(localSource).toContain("modelPicked")
    expect(localSource).toContain("isWeakerAutomaticDefault")
    expect(promptInputSource).toContain("model catalog is prefetched after login")
    expect(bootstrapSource).toContain("providerCatalogStaleTime")
    expect(bootstrapSource).toContain("Empty success (login/auth race) is immediately stale")
    expect(globalSyncSource).not.toContain("requestIdleCallback(enable")
    expect(bootstrapSource).toContain("shouldAutoFetchGlobalProviders")
    expect(bootstrapSource).toContain("return false")
    expect(pageLayoutSource).not.toMatch(/ensureProviders\s*\(/)
    expect(pageLayoutSource).toContain("Do not auto-fetch multi-MB /provider")
    expect(pageLayoutSource).toContain("Do not refetch multi-MB /provider on directory change")
    expect(pageLayoutSource).not.toContain('refetchQueries({ queryKey: [key, "providers"] })')
    expect(pageLayoutSource).toContain("Defer touchCode")
    expect(pageLayoutSource).toContain("requestIdleCallback(touch")
    const directoryLayoutSource = await Bun.file(new URL("./pages/directory-layout.tsx", import.meta.url)).text()
    expect(directoryLayoutSource).toContain("Do not createResource(session.sync) here")
    expect(directoryLayoutSource).not.toContain("await sync.session.sync(id)")
    expect(globalSyncSource).toContain("One list fetch is enough for sidebar scroll")
    expect(globalSyncSource).not.toContain("for (let attempt = 0; attempt < 40; attempt++)")
    expect(globalSyncSource).toContain("writeSidebarSessionSnapshot")
    expect(globalSessionListSource).toContain("authenticatedFetch")
    expect(childStoreSource).toContain("enabled: false")
    expect(childStoreSource).toContain("readSidebarSessionSnapshot")
    expect(bootstrapSource).toContain("Defer multi-MB /provider")
    expect(bootstrapSource).toContain("Do not fetch /provider here")
    expect(layoutContextSource).toContain("void globalSync.project.loadSessions(root)")
    expect(layoutContextSource).toContain("Kick only the default session list early")
    expect(layoutContextSource).not.toContain("for (const project of serverProjects())")
    expect(useProvidersSource).toContain("bootstrap: false")
    expect(promptInputSource).toContain("sidebarDataEnabled")
    expect(pageLayoutSource).toContain('globalSync.child(dir, { bootstrap: false })')
    expect(pageLayoutSource).not.toMatch(/currentSessions[\s\S]*bootstrap:\s*true/)
    const syncSource = await Bun.file(new URL("./context/sync.tsx", import.meta.url)).text()
    expect(syncSource).toContain('globalSync.child(sdk.directory, { bootstrap: false })')
    expect(syncSource).toContain("queueMicrotask(() => {")
    expect(syncSource).toContain("if (!globalSync.bootstrapped) return")
    expect(syncSource).toContain("isSshFileTreePending(directory)")
    expect(syncSource).toContain('runtimeEnvironmentFor(directory).kind === "ssh"')
    expect(syncSource).toContain("serverRuntimeEnvironmentFor(directory)?.kind !== \"local\"")
    expect(syncSource).toContain("projectAllowsRemoteEnvironment(directory)")
    expect(syncSource).toContain("bare new-session composer")
    expect(syncSource).toContain("empty keepalive shell")
    expect(syncSource).toContain("becameBound")
    expect(syncSource).toContain("forceDirectoryBootstrap")
    expect(syncSource).toContain('globalSync.child(directory, { bootstrap: true })')
    expect(syncSource).not.toContain("if (!sessionID) return")
    expect(syncSource).toMatch(/async status\(\)[\s\S]*?isSshFileTreePending\(sdk\.directory\)/)
    expect(syncSource).toMatch(/async status\(\)[\s\S]*?bootstrap:\s*false/)
    expect(syncSource).toContain("session sync failed")
    expect(syncSource).toContain("isSessionNotFoundError(error)")
    expect(syncSource).not.toContain("requestIdleCallback(run")
    expect(globalSyncSource).toContain("children.child(directory, { bootstrap: false })")
    expect(globalSyncSource).toContain("Never instance-bootstrap from listing")
    expect(globalSyncSource).toContain("forceDirectoryBootstrap")
    expect(globalSyncSource).toContain("Leaf bootstrap even when status is already \"complete\"")
    expect(globalSyncSource).toContain("if (isSshFileTreePending(directory)) return")
    const homeWorkbenchSource = await Bun.file(new URL("./workbench/home.tsx", import.meta.url)).text()
    expect(homeWorkbenchSource).toContain("isWorkspaceSessionPath(location.pathname)")
    expect(homeWorkbenchSource).toContain("loggedIn() && !sessionOpen()")
    expect(homeWorkbenchSource).toContain("remounts a second copy when touchCode")
    const appKeepaliveSource = await Bun.file(new URL("./app.tsx", import.meta.url)).text()
    expect(appKeepaliveSource).toContain("Defer touchCode")
    expect(appKeepaliveSource).toContain("requestIdleCallback(touch")
    expect(appKeepaliveSource).toContain("server.projects.touchCode(directory)")
    const permissionSource = await Bun.file(new URL("./context/permission.tsx", import.meta.url)).text()
    expect(permissionSource).toContain('globalSync.child(directory, { bootstrap: false })')
    expect(permissionSource).not.toMatch(/globalSync\.child\([a-zA-Z.]+\)\s*$/m)
    expect(permissionSource).not.toMatch(/globalSync\.child\([a-zA-Z.]+\)\s*\n/)
    const sidebarItemsSource = await Bun.file(new URL("./pages/layout/sidebar-items.tsx", import.meta.url)).text()
    expect(sidebarItemsSource).toContain('globalSync.child(props.session.directory, { bootstrap: false })')
    const projectExecutionSource = await Bun.file(
      new URL("./components/onescience/project-execution.ts", import.meta.url),
    ).text()
    expect(projectExecutionSource).toContain("Missing execution must NOT stamp server-local")
    expect(projectExecutionSource).toContain("if (!env) continue")
    expect(projectExecutionSource).not.toContain("env ?? { kind: \"local\" }")
    const workspaceRoutingSource = await Bun.file(
      new URL("../../opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts", import.meta.url),
    ).text()
    expect(workspaceRoutingSource).toContain("Intentionally no leftover-live steal")
    expect(workspaceRoutingSource).not.toContain("resolveLiveSshWorkspaceByDirectory(")
    expect(workspaceRoutingSource).toContain("reconnect: false")
    expect(workspaceRoutingSource).not.toContain("?? sessionWorkspaceID")
    const sharedWorkspaceRoutingSource = await Bun.file(
      new URL("../../opencode/src/server/shared/workspace-routing.ts", import.meta.url),
    ).text()
    expect(sharedWorkspaceRoutingSource).toContain('{ path: "/experimental/session", action: "local" }')
    expect(sharedWorkspaceRoutingSource).toContain('{ method: "DELETE", path: "/project/current", exact: true, action: "local" }')
    const projectRemoveSource = await Bun.file(
      new URL("../../opencode/src/server/routes/instance/httpapi/handlers/project.ts", import.meta.url),
    ).text()
    expect(projectRemoveSource).toContain("workspaceSvc.list(project, directory)")
    expect(projectRemoveSource).toContain('Effect.timeout("8 seconds")')
    const sshConnectivitySource = await Bun.file(
      new URL("./components/onescience/use-registered-ssh-connectivity.ts", import.meta.url),
    ).text()
    expect(sshConnectivitySource).toContain("ensureOpenSshDiskHydrated")
    expect(sshConnectivitySource).toContain("never auto-fetch /targets on session cold start")
    expect(sshConnectivitySource).not.toContain("requestIdleCallback(run, { timeout: 8000 })")
    expect(sshConnectivitySource).toContain("Reuse the same disk payload")
    const bootstrapSourceForTargets = await Bun.file(new URL("./context/global-sync/bootstrap.ts", import.meta.url)).text()
    expect(bootstrapSourceForTargets).toContain("openSshDiskInflight")
    expect(bootstrapSourceForTargets).toContain("disk?: Config[\"ssh\"]")
    expect(bootstrapSourceForTargets).toContain("Do not await /global/ssh/targets here")
    expect(bootstrapSourceForTargets).toContain("controller.abort()")
    expect(bootstrapSourceForTargets).toContain("isWorkspaceSessionPath(window.location.pathname)")
    expect(bootstrapSourceForTargets).toContain("20_000")
    expect(bootstrapSourceForTargets).toContain("5_000")
    expect(bootstrapSourceForTargets).toContain("applyConfirmedTenantMaps(data)")
    expect(bootstrapSourceForTargets).not.toContain("return enrichConfigSshFromOpenSsh({ config: data, serverUrl })")
    expect(bootstrapSourceForTargets).toContain("isSshFileTreePending(input.directory)")
    expect(bootstrapSourceForTargets).toContain("unconfirmedRemoteCapable")
    expect(bootstrapSourceForTargets).toContain("serverRuntimeEnvironmentFor(input.directory)?.kind !== \"local\"")
    expect(layoutContextSource).toContain("isWorkspaceHomePath(window.location.pathname)")
    expect(layoutContextSource).toContain("Defer control-plane writes")
    const leftNavSource = await Bun.file(new URL("./workbench/left-nav.tsx", import.meta.url)).text()
    expect(leftNavSource).toContain("Only warm default + the active session directory")
    expect(leftNavSource).toContain("activeDirectory()")
    const sessionBarSource = await Bun.file(
      new URL("./components/onescience/SessionEnvironmentBar.tsx", import.meta.url),
    ).text()
    expect(sessionBarSource).toContain("if (!boundWorkspaceID(directory)) return")
    expect(sessionBarSource).toContain("lastKnownWorkspaceID")
    expect(sessionBarSource).toContain("ensureOpenSshDiskHydrated(globalSDK.url, queryClient)")
    expect(sessionBarSource).toContain("if (!globalSync.bootstrapped) return")
    const fileSource = await Bun.file(new URL("./context/file.tsx", import.meta.url)).text()
    expect(fileSource).toContain("if (!globalSync.bootstrapped) return Promise.resolve([])")
    const appSource = await Bun.file(new URL("./app.tsx", import.meta.url)).text()
    const keepAlive = appSource.slice(
      appSource.indexOf("const WorkspaceSessionPanelActive = () => {"),
      appSource.indexOf("const WorkbenchShellRoute = (routeProps"),
    )
    expect(keepAlive).toContain("void sync.project.loadSessions(directory)")
    expect(keepAlive).toContain("layout.projects.open(directory, { unlessHidden: true })")
    expect(keepAlive).not.toContain("project.current")
    expect(keepAlive).not.toContain("preloadGhostty")
  })

  test("paints workspace sessions from the URL without blanking the main pane", async () => {
    const appSource = await Bun.file(new URL("./app.tsx", import.meta.url)).text()
    const pageLayoutSource = await Bun.file(new URL("./pages/layout.tsx", import.meta.url)).text()
    const sessionSource = await Bun.file(new URL("./pages/session.tsx", import.meta.url)).text()
    const oneScienceSource = await Bun.file(new URL("./pages/onescience.tsx", import.meta.url)).text()
    const syncSource = await Bun.file(new URL("./context/sync.tsx", import.meta.url)).text()
    const keepAlive = appSource.slice(
      appSource.indexOf("const WorkspaceSessionPanelActive = () => {"),
      appSource.indexOf("const WorkbenchShellRoute = (routeProps"),
    )
    const shell = oneScienceSource.slice(
      oneScienceSource.indexOf("export function WorkspaceShell"),
      oneScienceSource.indexOf("function useCodePromptHref"),
    )
    expect(keepAlive).toContain("void sync.project.loadSessions(directory)")
    expect(keepAlive).toContain("when={sessionReady()}")
    expect(keepAlive).toContain("sync.bootstrapped")
    expect(syncSource).toContain("isWorkbenchSharedCaseBrowse(directory, sessionID)")
    expect(syncSource).toContain("left the workbench session pane blank")
    expect(syncSource).toContain("Existing session IDs still need ready=true")
    expect(syncSource).toContain("markChildReady")
    expect(keepAlive).not.toContain('fallback={<WorkbenchHomePage />}')
    expect(appSource).toContain("isCodeNewSessionIntent(params.dir)")
    expect(appSource).toContain("Leftover project-click URLs")
    expect(appSource).toContain("never keep painting private session messages")
    expect(appSource).toContain("Logged out (e.g. cleared cache)")
    expect(appSource).toContain("isWorkbenchSharedCaseBrowse(directory, params.id)")
    expect(sessionSource).toContain("isWorkspaceSessionPath(location.pathname)")
    expect(sessionSource).toContain("Overlay session URLs must keep the pane")
    expect(sessionSource).toContain("boundWorkspaceID(directory)")
    expect(sessionSource).toContain("F5 clears the live wrk_*")
    expect(sessionSource).toContain("workspaceID ? { force: true }")
    expect(syncSource).toContain('`${key}\\n${bindKey}`')
    expect(syncSource).toContain("bindAtStart")
    expect(syncSource).toContain("Session page re-syncs transcript when boundWorkspaceID appears")
    expect(sessionSource).not.toContain("workspaceSessionHref(directory)")
    expect(pageLayoutSource).not.toContain("when={!autoselecting.loading}")
    expect(pageLayoutSource).toContain("{props.children}")
    expect(pageLayoutSource).not.toContain("{autoselecting() ?? \"\"}")
    expect(sessionSource).not.toContain("{sessionSync() ?? \"\"}")
    expect(pageLayoutSource).toContain("Do not read this resource in JSX")
    expect(sessionSource).toContain("Do not read this resource in JSX")
    const promptInputSource = await Bun.file(new URL("./components/prompt-input.tsx", import.meta.url)).text()
    expect(promptInputSource).toContain("Do not read createResource in JSX")
    expect(promptInputSource).not.toContain("(promptReady(), null)")
    expect(appSource).toContain("Keep the workspace shell mounted across authenticated navigations")
    expect(appSource).toContain("allowedRoute() !== \"\"")
    expect(appSource).not.toContain("allowedRoute() === route()")
    expect(appSource).toContain("WorkspaceSessionPanel")
    expect(appSource).toContain("clearStoredCapabilityPrefill(lastSessionDir, lastSessionID)")
    expect(appSource).not.toContain("clearStoredWorkspacePrompt(lastSessionDir, lastSessionID)")
    expect(shell).toContain("const collapsed = createMemo(() => onCodeRoute() || userCollapsed())")
    expect(shell).toContain("if (onCodeRoute()) return")
    expect(shell).toContain('"os-workspace-code": onCodeRoute()')
    expect(shell).not.toContain("setCollapsed(location.pathname.startsWith(\"/code\"))")
    expect(shell).not.toContain("<Suspense fallback=")
    const workbenchShellRoute = appSource.slice(
      appSource.indexOf("const WorkbenchShellRoute = (routeProps"),
      appSource.indexOf("return (", appSource.indexOf("const WorkbenchShellRoute = (routeProps")),
    )
    expect(workbenchShellRoute).not.toContain("<Suspense fallback=")
    expect(workbenchShellRoute).toContain("<WorkbenchShell>")
    expect(appSource).toContain("startupHealthCheck.latest === true")
    expect(appSource).not.toContain("startupHealthCheck() === true")
  })

  test("treats preset case ids as shared-case browse even when the directory aliases", () => {
    const esm2 = PRESET_CASE_SESSION_IDS[1]
    expect(isWorkbenchSharedCaseBrowse("/tmp/unrelated", esm2)).toBe(true)
    expect(isWorkbenchSharedCaseBrowse("/data/case")).toBe(true)
    expect(isWorkbenchSharedCaseBrowse("/tmp/unrelated", "ses_not_a_preset")).toBe(false)
    expect(isSharedCasesSessionPath(`/workspace/${base64Encode("/tmp/unrelated")}/session/${esm2}`)).toBe(true)
  })

  test("does not treat personal workspace case forks as official catalog browse", () => {
    const esm2 = PRESET_CASE_SESSION_IDS[1]
    const personalCase = "/data/guest_data/workspaces/liu0218dong-0cc8f29e/case"
    expect(isWorkbenchSharedCaseBrowse(personalCase, "ses_forked_not_preset")).toBe(false)
    expect(isWorkbenchSharedCaseBrowse(personalCase, esm2)).toBe(true)
  })

  test("falls back to the configured default when no recent workspace exists", async () => {
    const appSource = await Bun.file(new URL("./app.tsx", import.meta.url)).text()
    const homeSource = await Bun.file(new URL("./pages/home.tsx", import.meta.url)).text()
    const oneScienceSource = await Bun.file(new URL("./pages/onescience.tsx", import.meta.url)).text()

    expect(appSource).toContain("codeEntryWorkspaceDirectory")
    expect(appSource).toContain("sync.bootstrapped")
    expect(appSource).not.toContain("allowFallbackWorkspace")
    expect(homeSource).not.toContain("allowFallbackWorkspace")
    expect(homeSource).toContain("sync.bootstrapped")
    expect(homeSource).toContain("codeEntryWorkspaceDirectory")
    expect(oneScienceSource).toContain("codeEntryWorkspaceDirectory")
    expect(oneScienceSource).toContain("server.projects.lastCode()")
    expect(oneScienceSource).not.toContain("if (path) server.projects.touch(path)")
    expect(homeSource).not.toContain("codeWorkspaceDirectory(sync.data.path, recent())")
    expect(oneScienceSource).not.toContain("codeWorkspaceDirectory(sync.data.path, recent())")
    expect(appSource).toContain("server.projects.lastCode()")
    expect(appSource).toContain("server.projects.touchCode(")
    expect(appSource).toContain("workspaceDevelopmentEntryHref")
    expect(appSource).toContain("CodeWorkspaceEntryRedirect")
    expect(oneScienceSource).toContain("developmentEntryHref()")
    expect(oneScienceSource).not.toContain("codeHref() === \"/code\"")
    expect(homeSource).toContain("server.projects.lastCode()")
  })

  test("uses workspace directory dialog for platform accounts when opening projects", async () => {
    const homeSource = await Bun.file(new URL("./pages/home.tsx", import.meta.url)).text()
    const layoutSource = await Bun.file(new URL("./pages/layout.tsx", import.meta.url)).text()
    const directoryDialogSource = await Bun.file(new URL("./components/dialog-select-directory.tsx", import.meta.url)).text()
    const createFolderSource = await Bun.file(new URL("./components/dialog-create-project-folder.tsx", import.meta.url)).text()
    const projectPickerSource = await Bun.file(new URL("./utils/project-picker.ts", import.meta.url)).text()

    expect(homeSource).toContain("shouldUseNativeProjectPicker")
    expect(layoutSource).toContain("shouldUseNativeProjectPicker")
    expect(homeSource).toContain("hasPlatformSession: !!storedPlatformAuthSession()")
    expect(layoutSource).toContain("hasPlatformSession: !!storedPlatformAuthSession()")
    expect(layoutSource).toContain("isDefaultPlatformProject(storedPlatformAuthSession(), directory)")
    expect(projectPickerSource).toContain("return input.hasNativePicker && input.isLocalServer && !input.hasPlatformSession")
    expect(directoryDialogSource).toContain("defaultPlatformWorkspaceDirectory(storedPlatformAuthSession())")
    expect(directoryDialogSource).toContain("if (accountRoot) return accountRoot")
    expect(directoryDialogSource).toContain("apiRoot: browseRoot")
    expect(directoryDialogSource).toContain("relativeProjectDataPath(args.apiRoot(), key)")
    expect(directoryDialogSource).toContain("isWithinProjectDataRoot(project.worktree, root)")
    expect(directoryDialogSource).toContain("isDefaultPlatformProject(session, project.worktree)")
    expect(directoryDialogSource).toContain("isDefaultProjectWorktree(project.worktree)")
    expect(directoryDialogSource).toContain("sidebar「未分类」")
    expect(directoryDialogSource).toContain("fall back to control-plane catalog")
    expect(directoryDialogSource).toContain("filterPlatformAccountProjects(sync.data.project, session)")
    expect(directoryDialogSource).toContain("if (storedPlatformAuthSession()) return undefined")
    expect(createFolderSource).toContain("defaultPlatformWorkspaceDirectory(storedPlatformAuthSession())")
    expect(createFolderSource).toContain("setRuntimeEnvironmentFor(directory, env())")
    expect(createFolderSource).toContain("dialog.project.createFolder.environment")
    expect(createFolderSource).toContain("dialog.project.createFolder.nameAsFolder")
    expect(createFolderSource).toContain("dialog.project.createFolder.nameRemote")
    expect(createFolderSource).toContain("dialog.project.createFolder.nameRemoteHint")
    expect(createFolderSource).not.toContain("dialog.project.createFolder.nameLocked")
    expect(createFolderSource).not.toContain("disabled={nameLocked()}")
    expect(createFolderSource).toContain("disabled={!!busy()}")
    expect(createFolderSource).toContain("if (v === store.remotePath) return")
    expect(createFolderSource).not.toContain("dialog.project.createFolder.environmentHint")
    expect(createFolderSource.indexOf('language.t("dialog.project.createFolder.environment")')).toBeLessThan(
      createFolderSource.indexOf('language.t("dialog.project.createFolder.name")'),
    )
    const editProjectSource = await Bun.file(new URL("./components/dialog-edit-project.tsx", import.meta.url)).text()
    expect(editProjectSource).toContain("remoteWorkspaceFor(props.project.worktree)")
    expect(editProjectSource).toContain('env.kind === "ssh" && remote')
  })

  test("open-project picker scrolls only the folder list", async () => {
    const css = await Bun.file(new URL("./index.css", import.meta.url)).text()
    const bodyStart = css.indexOf('.os-client-project-picker[data-slot="dialog-content"] [data-slot="dialog-body"] {')
    const listStart = css.indexOf(".os-client-project-picker-list [data-slot=\"list-scroll\"] {")

    expect(bodyStart).toBeGreaterThan(-1)
    expect(listStart).toBeGreaterThan(-1)
    expect(css.slice(bodyStart, bodyStart + 180)).toMatch(/overflow:\s*hidden/)
    expect(css.slice(listStart, listStart + 420)).toContain("max-height: min(20rem, 40vh)")
    expect(css.slice(listStart, listStart + 420)).not.toContain("max-height: min(22rem, 48vh)")
  })

  test("links root page GitHub and Gitee entries to the OneScience GitHub organization", async () => {
    const homeSource = await Bun.file(new URL("./pages/home.tsx", import.meta.url)).text()

    expect(homeSource).toContain('const oneScienceGithubHref = "https://github.com/onescience-ai/"')
    expect(homeSource).toContain('href={oneScienceGithubHref}')
    expect(homeSource).toContain('{ label: "GitHub", href: oneScienceGithubHref }')
    expect(homeSource).toContain('{ label: "Gitee", href: oneScienceGithubHref }')
  })

  test("uses OneScience wording in the Chinese prompt placeholder", async () => {
    const zh = await Bun.file(new URL("./i18n/zh.ts", import.meta.url)).text()

    expect(zh).toContain('"prompt.placeholder.normal": \'使用 OneScience {{example}}\'')
    expect(zh).toContain('"prompt.placeholder.simple": "使用 OneScience..."')
    expect(zh).not.toContain("随便问点什么")
  })

  test("does not apply standalone panel chrome to embedded /code main content", async () => {
    const layoutSource = await Bun.file(new URL("./pages/layout.tsx", import.meta.url)).text()

    expect(layoutSource).toContain(
      '"size-full min-w-0 overflow-hidden flex flex-col items-start contain-strict bg-background-weak": true',
    )
    expect(layoutSource).not.toContain(
      '"size-full overflow-x-hidden flex flex-col items-start contain-strict border-t border-border-weak-base bg-background-base xl:border-l xl:rounded-t-[12px]": true',
    )
  })

  test("keeps embedded /code chrome flush for coding space", async () => {
    const css = await appCss()
    const sidebar = css.slice(
      css.indexOf('.os-code-embed [data-component="sidebar-nav-desktop"] {'),
      css.indexOf('.os-code-embed [data-component="code-project-tree"] {'),
    )
    const main = css.slice(css.indexOf(".os-code-embed main {"), css.indexOf(".os-code-embed main > *"))

    expect(sidebar).toContain("padding: 0;")
    expect(sidebar).toContain("border: 0;")
    expect(sidebar).toContain("border-radius: 0;")
    expect(sidebar).toContain("box-shadow: none;")
    expect(main).toContain("margin: 0;")
    expect(main).toContain("border: 0 !important;")
    expect(main).toContain("border-radius: 0 !important;")
    expect(main).toContain("box-shadow: none;")
    expect(main).not.toContain("margin: 0.7rem")
    expect(main).not.toContain("margin: 0 0.7rem")
  })

  test("clips embedded /code at the outer shell", async () => {
    const css = await appCss()
    expect(css).toContain(".os-code-embed {")
    expect(css).toContain("overflow: hidden;")
  })

  test("scopes Inter / Noto / JetBrains typography to /code and skill manager only", async () => {
    const css = await appCss()
    const embed = css.slice(css.indexOf(".os-code-embed {"), css.indexOf("html[data-color-scheme=\"dark\"] .os-code-embed {"))
    const settings = await Bun.file(new URL("./context/settings.tsx", import.meta.url)).text()
    expect(css).toContain('font-family: "Inter"')
    expect(css).toContain('font-family: "Noto Sans SC"')
    expect(css).toContain("/assets/fonts/inter-400.woff2")
    expect(css).toContain("/assets/fonts/noto-sc-400.woff2")
    expect(embed).toContain("--font-family-sans:")
    expect(embed).toContain('"Inter", "Noto Sans SC"')
    expect(embed).toContain("--font-family-mono:")
    expect(embed).toContain('"JetBrainsMono Nerd Font Mono"')
    expect(embed).toContain("font-family: var(--font-family-sans);")
    expect(embed).toContain("-webkit-font-smoothing: antialiased;")
    expect(css).toContain(".os-code-embed button,")
    expect(css).toContain(".os-code-embed pre code,")
    expect(css).toContain("font-family: var(--font-family-mono);")
    expect(css).toContain('.os-code-embed [data-component="markdown"] :not(pre) > code {')
    expect(css).toContain("font-family: var(--font-family-sans);")
    expect(css).toContain(".os-skill-manager-dialog")
    expect(css).toContain('"Inter", "Noto Sans SC"')
    // Global root / portal overlays must stay on system UI fonts.
    expect(settings).toContain(
      'const sansFallback = \'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif\'',
    )
    expect(settings).not.toContain('"Inter", "Noto Sans SC"')
    expect(css).not.toContain("/* Portals mount outside .os-code-embed")
  })

  test("keeps the app root padding inside its viewport height", async () => {
    const html = await Bun.file(new URL("../index.html", import.meta.url)).text()
    expect(html).toContain('<div id="root" class="flex flex-col h-dvh p-px box-border"></div>')
  })

  test("keeps embedded opencode navigation under /code", async () => {
    const layoutSource = await Bun.file(new URL("./pages/layout.tsx", import.meta.url)).text()
    const sidebarItemsSource = await Bun.file(new URL("./pages/layout/sidebar-items.tsx", import.meta.url)).text()
    const sidebarWorkspaceSource = await Bun.file(new URL("./pages/layout/sidebar-workspace.tsx", import.meta.url)).text()
    const dialogForkSource = await Bun.file(new URL("./components/dialog-fork.tsx", import.meta.url)).text()
    const dialogSelectFileSource = await Bun.file(new URL("./components/dialog-select-file.tsx", import.meta.url)).text()

    expect(layoutSource).toContain("const sessionHref =")
    expect(layoutSource).toContain("routePrefix,")
    expect(sidebarItemsSource).toContain("routePrefix?: string")
    expect(sidebarItemsSource).toContain("`${props.routePrefix ?? \"\"}/${props.slug}/session")
    expect(sidebarWorkspaceSource).toContain("routePrefix: string")
    expect(sidebarWorkspaceSource).toContain("`${props.ctx.routePrefix}/${slug()}/session`")
    expect(dialogForkSource).toContain("sessionHrefForPath(location.pathname")
    expect(dialogSelectFileSource).toContain("sessionHrefForPath(location.pathname")
  })

  test("shows archived sessions from the /code workspace menu", async () => {
    const layoutSource = await Bun.file(new URL("./pages/layout.tsx", import.meta.url)).text()
    const workspaceSource = await Bun.file(new URL("./pages/layout/sidebar-workspace.tsx", import.meta.url)).text()
    const sidebarCodeTreeSource = await Bun.file(new URL("./pages/layout/sidebar-code-tree.tsx", import.meta.url)).text()
    const zh = await Bun.file(new URL("./i18n/zh.ts", import.meta.url)).text()

    expect(layoutSource).toContain("function DialogArchivedSessions")
    expect(layoutSource).toContain("archived: true")
    expect(layoutSource).toContain("roots: true")
    expect(layoutSource).toContain("sessionHref(session.directory, session.id)")
    expect(layoutSource).toContain("showArchivedSessionsDialog")
    expect(layoutSource).toContain("showArchivedSessionsDialog={workspaceSidebarCtx.showArchivedSessionsDialog}")
    expect(workspaceSource).toContain("showArchivedSessionsDialog")
    expect(workspaceSource).toContain('data-action="workspace-archived-sessions-inline"')
    expect(workspaceSource).toContain('data-action="workspace-archived-sessions"')
    expect(sidebarCodeTreeSource).toContain("showArchivedSessionsDialog")
    expect(sidebarCodeTreeSource).toContain('data-action="workspace-archived-sessions-inline"')
    expect(sidebarCodeTreeSource).toContain('data-component="sidebar-archived-sessions-control"')
    expect(sidebarCodeTreeSource).toContain("props.showArchivedSessionsDialog()")
    expect(sidebarCodeTreeSource).toContain('name="archive"')
    expect(sidebarCodeTreeSource).not.toContain("showArchivedSessionsDialog(activeDirectory())")
    expect(layoutSource).toContain("...(props.directory ? { directory: props.directory } : {})")
    expect(zh).toContain('"session.archived.title": "已归档会话"')
    expect(zh).toContain('"session.archived.hint": "查看已归档的会话"')
    expect(zh).toContain('"session.archived.empty": "暂无已归档会话"')
    expect(workspaceSource).toContain("session.archived.hint")
    expect(workspaceSource).toContain('data-action="workspace-archived-sessions-inline"')
    expect(workspaceSource).toContain("border-border-weak-base")
  })

  test("redirects legacy opencode session routes into /code", async () => {
    const appSource = await Bun.file(new URL("./app.tsx", import.meta.url)).text()
    const notificationSource = await Bun.file(new URL("./context/notification.tsx", import.meta.url)).text()

    expect(appSource).toContain("function LegacyCodeSessionRedirect")
    expect(appSource).toContain("codeSlugSessionHref(params.dir, params.id)")
    expect(appSource).toContain('<Route path="/:dir/session/:id?" component={LegacyCodeSessionRedirect} />')
    expect(appSource).toContain('<Route path="/:dir" component={LegacyCodeWorkspaceRedirect} />')
    expect(notificationSource).toContain("codeSessionHref(directory, sessionID)")
    expect(notificationSource).not.toContain("`/${base64Encode(directory)}/session")
  })

  test("shows configured SSH targets and opens a shorter add SSH path", async () => {
    const statusPopover = await Bun.file(new URL("./components/status-popover-body.tsx", import.meta.url)).text()
    const sshDialog = await Bun.file(new URL("./components/ssh-config-panel.tsx", import.meta.url)).text()
    const zh = await Bun.file(new URL("./i18n/zh.ts", import.meta.url)).text()

    expect(statusPopover).toContain("sshItems")
    expect(statusPopover).toContain('openSshDialog("add")')
    expect(statusPopover).toContain('<x.DialogSelectSsh initialMode={mode} />')
    expect(statusPopover).toContain('language.t("dialog.ssh.addButton")')
    expect(sshDialog).toContain('props.initialMode === "add" ? "__new__" : undefined')
    expect(sshDialog).toContain('"/global/ssh/config"')
    expect(sshDialog).toContain("requestRemove")
    expect(sshDialog).toContain("attemptSave")
    expect(sshDialog).toContain("identityLocked")
    expect(zh).toContain('"dialog.server.ssh.add": "新增 SSH 配置"')
    expect(zh).toContain("dialog.ssh.usage.blocked.delete")
  })

  test("exposes opencode settings without help in the outer workspace sidebar footer", async () => {
    const oneScienceSource = await Bun.file(new URL("./pages/onescience.tsx", import.meta.url)).text()
    const navGroupsSource = oneScienceSource.slice(oneScienceSource.indexOf("const workspaceNavGroups"))

    expect(oneScienceSource).toContain('data-action="workspace-settings"')
    expect(oneScienceSource).not.toContain('data-action="workspace-help"')
    expect(oneScienceSource).toContain('from "@/components/dialog-settings"')
    expect(oneScienceSource).toContain("openWorkspaceSettings")
    expect(oneScienceSource).toContain("<DialogSettings />")
    expect(oneScienceSource).not.toContain("opencode.ai/desktop-feedback")
    expect(navGroupsSource).not.toContain('label: "设置"')
    expect(await appCss()).toContain(".os-sidebar-footer")
  })

  test("embeds the OneScience demo video with an explicit HTTPS Bilibili player URL", async () => {
    const oneScienceSource = await Bun.file(new URL("./pages/onescience.tsx", import.meta.url)).text()

    expect(oneScienceSource).toContain('src="https://player.bilibili.com/player.html?bvid=BV187V96qEF1&page=1"')
    expect(oneScienceSource).not.toContain('src="//player.bilibili.com/player.html')
  })

  test("keeps OneSkills in the workspace sidebar navigation", async () => {
    const oneScienceSource = await Bun.file(new URL("./pages/onescience.tsx", import.meta.url)).text()
    const navGroupsSource = oneScienceSource.slice(oneScienceSource.indexOf("const workspaceNavGroups"))

    expect(navGroupsSource).toContain('{ label: "OneSkills", href: "/skills", icon: "skills" }')
    expect(navGroupsSource.indexOf('href: "/workspace"')).toBeLessThan(navGroupsSource.indexOf('href: "/skills"'))
    expect(navGroupsSource.indexOf('href: "/skills"')).toBeLessThan(navGroupsSource.indexOf('label: "OneHub"'))
    expect(oneScienceSource).toContain('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.5-3.5a5.8 5.8 0 0 1-7.6 7.6l-6.8 6.8a2.1 2.1 0 0 1-3-3l6.8-6.8a5.8 5.8 0 0 1 7.6-7.6z" />')
  })

  test("desktop workbench shell keeps OneHub as second nav section and skips marketing home", async () => {
    const oneScienceSource = await Bun.file(new URL("./pages/onescience.tsx", import.meta.url)).text()
    const desktopNav = oneScienceSource.slice(oneScienceSource.indexOf("const desktopWorkbenchNavGroups"))

    expect(oneScienceSource).toContain('fallback={<Navigate href="/workspace" />}')
    expect(oneScienceSource).toContain('platform.platform !== "desktop"')
    expect(oneScienceSource).toContain('platform.platform === "desktop" ? desktopWorkbenchNavGroups : workspaceNavGroups')
    expect(desktopNav).toContain('{ label: "工作台", href: "/workspace", icon: "home" }')
    expect(desktopNav).toContain('{ label: "科研开发", href: "/workspace", icon: "code" }')
    expect(desktopNav.indexOf('icon: "code"')).toBeLessThan(desktopNav.indexOf('label: "OneHub"'))
    expect(desktopNav).toContain('{ label: "模型库", href: "/models", icon: "model" }')
    expect(desktopNav).toContain('{ label: "OneSkills", href: "/skills", icon: "skills" }')
  })

  test("uses a compact OneScience workspace sidebar", async () => {
    const css = await appCss()

    expect(css).toContain("width: 12.8rem;")
    expect(css).toContain("min-height: 3.25rem;")
    expect(css).toContain("padding: 0.32rem 0.4rem;")
    expect(css).toContain("padding: 0.34rem 0.46rem;")
    expect(css).toContain("font-size: 0.8rem;")
    expect(css).toContain("width: 1rem;")
  })

  test("folds datasets models and apps into OneHub navigation", async () => {
    const oneScienceSource = await Bun.file(new URL("./pages/onescience.tsx", import.meta.url)).text()
    const navGroupsSource = oneScienceSource.slice(oneScienceSource.indexOf("const workspaceNavGroups"))
    const css = await appCss()

    expect(navGroupsSource).toContain('label: "OneHub"')
    expect(navGroupsSource).toContain('items: [')
    expect(navGroupsSource).toContain('{ label: "数据集", href: "/datasets", icon: "database" }')
    expect(navGroupsSource).toContain('{ label: "模型库", href: "/models", icon: "model" }')
    expect(navGroupsSource).toContain('{ label: "应用库", href: "/apps", icon: "apps" }')
    expect(oneScienceSource).toContain('const [openNavGroups, setOpenNavGroups]')
    expect(oneScienceSource).toContain('aria-expanded={isGroupOpen(item)}')
    expect(css).toContain(".os-sidebar-subnav")
    expect(css).toContain(".os-sidebar-link-sub")
    expect(navGroupsSource.indexOf('href: "/primitives"')).toBeLessThan(navGroupsSource.indexOf('label: "OneHub"'))
  })

  test("folds frameworks and operators into OneInfra without parent active state", async () => {
    const oneScienceSource = await Bun.file(new URL("./pages/onescience.tsx", import.meta.url)).text()
    const navGroupsSource = oneScienceSource.slice(oneScienceSource.indexOf("const workspaceNavGroups"))

    expect(navGroupsSource).toContain('label: "OneInfra"')
    expect(navGroupsSource).toContain('{ label: "AI框架", href: "/frameworks", icon: "framework" }')
    expect(navGroupsSource).toContain('{ label: "算子", href: "/operators", icon: "operator" }')
    expect(oneScienceSource).toContain('classList={{ "os-sidebar-link": true, "os-sidebar-link-fold": true }}')
    expect(oneScienceSource).not.toContain('"os-sidebar-link-fold": true, "is-active": active()')
    expect(navGroupsSource.indexOf('label: "OneHub"')).toBeLessThan(navGroupsSource.indexOf('label: "OneInfra"'))
    expect(navGroupsSource.indexOf('label: "OneInfra"')).toBeLessThan(navGroupsSource.indexOf('href: "/cases"'))
  })

  test("allows manually folding the active OneInfra navigation group", async () => {
    const oneScienceSource = await Bun.file(new URL("./pages/onescience.tsx", import.meta.url)).text()

    expect(oneScienceSource).toContain('import { For, Show, batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack, type JSX } from "solid-js"')
    expect(oneScienceSource).toContain("untrack(() => openNavGroups().includes(activeGroup.label))")
  })

  test("keeps collapsed workspace navigation height layout unchanged", async () => {
    const css = await appCss()
    const oneScienceSource = await Bun.file(new URL("./pages/onescience.tsx", import.meta.url)).text()

    expect(css).toMatch(/\.os-sidebar-link \{[^}]*padding: 0\.34rem 0\.46rem;/)
    expect(css).toMatch(/\.os-sidebar-link \{[^}]*min-height: 2\.5rem;/)
    expect(css).not.toMatch(/\.os-workspace-collapsed \.os-sidebar-link \{[^}]*padding-inline:/)
    expect(css).not.toMatch(/\.os-workspace-collapsed \.os-sidebar-subnav \{[^}]*display: none;/)
    expect(oneScienceSource).toContain('const isGroupOpen = (item: WorkspaceNavItem) => "items" in item && openNavGroups().includes(item.label)')
  })

  test("uses complete collapsed workspace buttons with aligned icons", async () => {
    const css = await appCss()

    expect(css).toMatch(/\.os-workspace-collapsed \.os-sidebar-group \{[^}]*justify-items: stretch;/)
    expect(css).toMatch(/\.os-workspace-collapsed \.os-sidebar-fold \{[^}]*width: 100%;/)
    expect(css).toMatch(/\.os-workspace-collapsed \.os-sidebar-link \{[^}]*width: 100%;[^}]*box-sizing: border-box;[^}]*justify-content: center;[^}]*gap: 0;/)
    expect(css).toMatch(/\.os-workspace-collapsed \.os-sidebar-link > \.os-sidebar-icon \{[^}]*margin-inline: auto;/)
    expect(css).toMatch(/\.os-workspace-collapsed \.os-sidebar-link-fold \{[^}]*width: 100%;/)
    expect(css).toMatch(/\.os-workspace-collapsed \.os-sidebar-link-fold \[data-component="icon"\] \{[^}]*display: none;/)
  })

  test("expands collapsed workspace sidebar from grouped navigation buttons", async () => {
    const oneScienceSource = await Bun.file(new URL("./pages/onescience.tsx", import.meta.url)).text()

    expect(oneScienceSource).toContain("const activateNavGroup = (label: string) => {")
    expect(oneScienceSource).toContain("if (onCodeRoute()) {")
    expect(oneScienceSource).toContain("setUserCollapsed(false)")
    expect(oneScienceSource).toContain("onClick={() => activateNavGroup(item.label)}")
  })

  test("keeps Data Management workflow actions interactive and readable", async () => {
    const oneScienceSource = await Bun.file(new URL("./pages/onescience.tsx", import.meta.url)).text()
    const css = await appCss()

    expect(oneScienceSource).toContain("export function DataManagementPage()")
    expect(oneScienceSource).toContain("已迁移到能力中心的 OneData")
    expect(oneScienceSource).toContain("打开 OneData")
    expect(oneScienceSource).toContain('workspaceCapabilitiesCategoryHref("onedata")')
    expect(css).toContain(".os-data-intake-page")
  })

  test("designs Data Management as an AI Ready intake workflow", async () => {
    const oneScienceSource = await Bun.file(new URL("./pages/onescience.tsx", import.meta.url)).text()

    expect(oneScienceSource).toContain("export function DataManagementPage()")
    expect(oneScienceSource).toContain("旧版 AI Ready 项目流已停用")
    expect(oneScienceSource).toContain("打开 OneData")
    expect(oneScienceSource).not.toContain("提交给智能体")
    expect(oneScienceSource).not.toContain("发布到 OneHub")
  })

  test("redirects legacy workbench resource routes into capabilities", async () => {
    const appSource = await Bun.file(new URL("./app.tsx", import.meta.url)).text()
    const oneScienceSource = await Bun.file(new URL("./pages/onescience.tsx", import.meta.url)).text()
    const navGroupsSource = oneScienceSource.slice(oneScienceSource.indexOf("const workspaceNavGroups"))

    expect(appSource).toContain("function LegacyWorkbenchRedirect")
    expect(appSource).toContain('<Route path="/tasks" component={LegacyWorkbenchRedirect} />')
    expect(appSource).toContain('<Route path="/data-management" component={LegacyWorkbenchRedirect} />')
    expect(appSource).toContain('<Route path="/models" component={LegacyWorkbenchRedirect} />')
    expect(appSource).toContain("function CodeWorkspaceEntryRedirect")
    expect(appSource).toContain("function CodeWorkspaceEntryRoute")
    expect(appSource).toContain("function LegacyCodeToWorkspaceRedirect")
    expect(appSource).toContain('<Route path={oneScienceRoutes.code} component={CodeWorkspaceEntryRoute} />')
    expect(oneScienceSource).toContain("export function TasksPage()")
    expect(oneScienceSource).toContain("export function DataManagementPage()")
    expect(oneScienceSource).toContain("已迁移到能力中心的 OneData")
    expect(oneScienceSource).toContain("打开 OneData")
    expect(navGroupsSource).toContain('{ label: "科研开发", href: "/workspace", icon: "code" }')
    expect(navGroupsSource).not.toContain('{ label: "数据管理", href: "/data-management", icon: "data-management" }')
    expect(navGroupsSource).not.toContain('{ label: "任务管理", href: "/tasks", icon: "tasks" }')
    expect(navGroupsSource.indexOf('icon: "code"')).toBeLessThan(navGroupsSource.indexOf('href: "/skills"'))
    expect(await appCss()).toContain(".os-management-layout")
  })

  test("shows environment popover with MCP and advanced backend connection", async () => {
    const statusPopoverSource = await Bun.file(new URL("./components/status-popover-body.tsx", import.meta.url)).text()
    const statusTriggerSource = await Bun.file(new URL("./components/status-popover.tsx", import.meta.url)).text()
    const serverDialogSource = await Bun.file(new URL("./components/dialog-select-server.tsx", import.meta.url)).text()
    const titlebarSource = await Bun.file(new URL("./components/titlebar.tsx", import.meta.url)).text()
    const zh = await Bun.file(new URL("./i18n/zh.ts", import.meta.url)).text()

    expect(statusPopoverSource).not.toContain('value="onescience"')
    expect(statusPopoverSource).not.toContain("sync.data.config.onescience")
    expect(statusPopoverSource).not.toContain("oneScienceRuntimeModes")
    expect(statusPopoverSource).not.toContain('value="lsp"')
    expect(statusPopoverSource).not.toContain('value="plugins"')
    expect(statusPopoverSource).toContain('defaultValue="mcp"')
    expect(statusPopoverSource).toContain('value="mcp"')
    expect(statusPopoverSource).toContain('value="ssh"')
    expect(statusPopoverSource).not.toContain('value="servers"')
    expect(statusPopoverSource).toContain('language.t("status.popover.tab.ssh")')
    expect(statusPopoverSource).not.toContain("mcpConnected()")
    expect(statusPopoverSource).not.toContain("sshItems().length > 0 ?")
    expect(statusPopoverSource).toContain('icon="plus-small"')
    expect(statusPopoverSource).not.toContain('language.t("status.popover.action.manageMcp")')
    expect(statusPopoverSource).not.toContain("openMcpResources")
    expect(statusPopoverSource).not.toContain("workspaceResourcesHref")
    expect(statusPopoverSource).toContain('language.t("status.popover.action.manageSsh")')
    expect(statusPopoverSource).toContain("os-ssh-dialog-stack")
    expect(statusPopoverSource).toContain("<x.DialogSelectSsh initialMode={mode} />")
    expect(statusPopoverSource).not.toContain("DialogSelectMcp")
    expect(statusPopoverSource).not.toContain('language.t("dialog.mcp.addButton")')
    expect(statusPopoverSource).toContain('openSshDialog("add")')
    expect(statusPopoverSource.indexOf('value="mcp"')).toBeLessThan(statusPopoverSource.indexOf('value="ssh"'))

    expect(statusTriggerSource).toContain('language.t("status.popover.trigger")')
    expect(statusTriggerSource).toContain("text-12-regular")
    expect(statusTriggerSource).toContain("text-text-strong")

    expect(serverDialogSource).not.toContain('store.group === "ssh"')
    expect(serverDialogSource).not.toContain('store.group === "mcp"')
    expect(serverDialogSource).not.toContain("grid-cols-3")
    expect(serverDialogSource).toContain('language.t("dialog.server.description")')

    expect(titlebarSource).toContain("openDelay={300}")
    expect(titlebarSource).toContain("openDelay={2000}")

    expect(zh).toContain('"status.popover.trigger": "集成管理"')
    expect(zh).toContain('"dialog.server.title": "后端连接"')
    expect(zh).toContain('"dialog.server.add.button": "添加后端地址"')
  })

  test("adds a status bar skill manager for global and project skills", async () => {
    const sessionHeaderSource = await Bun.file(new URL("./components/session/session-header.tsx", import.meta.url)).text()
    const sidebarCodeTreeSource = await Bun.file(new URL("./pages/layout/sidebar-code-tree.tsx", import.meta.url)).text()
    const skillDialogSource = await Bun.file(new URL("./components/skill-manager-dialog.tsx", import.meta.url)).text()
    const skillManagementSource = await Bun.file(new URL("./pages/onescience-skill-management.tsx", import.meta.url)).text()
    const skillScopeSource = await Bun.file(new URL("./pages/onescience-skill-scope.ts", import.meta.url)).text()
    const css = await appCss()

    expect(sessionHeaderSource).toContain('import { SkillManagerDialog } from "../skill-manager-dialog"')
    expect(sessionHeaderSource).not.toContain('data-component="titlebar-skill-manager-control"')
    expect(sessionHeaderSource).not.toContain("<StatusPopover")
    expect(sidebarCodeTreeSource).toContain('data-component="sidebar-skill-manager-control"')
    expect(sidebarCodeTreeSource).toContain('data-component="sidebar-integration-control"')
    expect(sidebarCodeTreeSource).toContain("<StatusPopover")
    expect(sidebarCodeTreeSource).toContain("<SDKProvider directory={activeDirectory}>")
    expect(sidebarCodeTreeSource).toContain("<SyncProvider>")
    expect(sidebarCodeTreeSource).toContain('dialog.show(() => <SkillManagerDialog directory={activeDirectory()} />')
    expect(sessionHeaderSource).toContain('aria-pressed={view().reviewPanel.opened()}')
    expect(sessionHeaderSource).toContain('aria-pressed={layout.fileTree.opened()}')
    expect(sessionHeaderSource).not.toContain('aria-expanded={view().reviewPanel.opened()}')
    expect(sessionHeaderSource).toContain('dialog.show(() => <SkillManagerDialog directory={projectDirectory()} initialTab={initialTab} />')
    expect(skillDialogSource).toContain('sdk.client.app.skills({ directory: props.directory })')
    expect(skillDialogSource).toContain('useGlobalSync')
    expect(skillDialogSource).not.toContain('setInterval')
    expect(skillDialogSource).toContain('splitSkillScopes(skills(), projectRoot(), globalRoot(), pathInfo(), repos())')
    expect(skillDialogSource).toContain('listUserUploadedSkills(skills(), projectRoot(), globalRoot(), pathInfo())')
    expect(skillDialogSource).toContain('canDeleteUserSkill')
    expect(skillDialogSource).toContain('projectSkills()')
    expect(skillDialogSource).toContain('globalSkills()')
    expect(skillDialogSource).toContain("SKILL_LIST_PAGE_SIZE")
    expect(skillDialogSource).toContain("CapabilityPager")
    expect(skillDialogSource).toContain("os-skill-manager-card-popover")
    expect(skillDialogSource).toContain("onCreated={() => void load(true)}")
    expect(skillManagementSource).toContain("已上传技能")
    expect(skillManagementSource).toContain("尚未上传自定义技能。")
    expect(skillScopeSource).toContain("isAccountUserSkillLocation")
    expect(skillScopeSource).toContain("ProjectSkillStoragePath.isProjectSkillLocation")
    expect(css).toContain('.os-skill-manager-dialog')
    expect(css).toContain('.os-skill-manager-grid')
    expect(css).toContain('.os-skill-manager-card-popover')
    expect(css).toContain('.os-skill-manager-pager')
    expect(css).toContain('.os-skill-uploaded-copy')
    expect(css).toContain('grid-template-rows: auto auto minmax(0, 1fr);')
    expect(css).toContain('min-height: 0;')
  })

  test("keeps prompt model selector jsx valid", async () => {
    const promptSource = await Bun.file(new URL("./components/prompt-input.tsx", import.meta.url)).text()
    const modelDialogSource = await Bun.file(new URL("./components/dialog-select-model.tsx", import.meta.url)).text()

    expect(promptSource).not.toContain("<ProviderIcon\n                              <ProviderIcon")
    expect(promptSource).toContain('data-action="prompt-model"')
    expect(promptSource).toContain('dialog.show(() => <x.DialogSelectModel model={local.model} />)')
    expect(modelDialogSource).toContain("ensureProviders({ silent: true })")
    expect(modelDialogSource).toContain("setCatalogSettled(true)")
    expect(modelDialogSource).not.toContain("providersFetched")
    expect(modelDialogSource).not.toContain(".then(() => setCatalogReady(true))")
  })

  test("exposes AI primitives before datasets in the workspace navigation", async () => {
    const appSource = await Bun.file(new URL("./app.tsx", import.meta.url)).text()
    const oneScienceSource = await Bun.file(new URL("./pages/onescience.tsx", import.meta.url)).text()
    const primitivesSource = await Bun.file(new URL("./pages/onescience-primitives.ts", import.meta.url)).text()
    const primitiveUseDialogSource = await Bun.file(new URL("./pages/onescience-primitive-use-dialog.tsx", import.meta.url)).text()
    const navGroupsSource = oneScienceSource.slice(oneScienceSource.indexOf("const workspaceNavGroups"))

    expect(appSource).toContain('<Route path="/primitives" component={LegacyWorkbenchRedirect} />')
    expect(oneScienceSource).toContain('import { primitiveCategoryLabel, primitivePage, primitiveTypeFilters } from "./onescience-primitives"')
    expect(oneScienceSource).toContain('import { PrimitiveUseDialog } from "./onescience-primitive-use-dialog"')
    expect(oneScienceSource).toContain("export function PrimitivesPage()")
    expect(oneScienceSource).toContain('{ label: "AI原语", href: "/primitives", icon: "primitives" }')
    expect(navGroupsSource.indexOf('href: "/skills"')).toBeLessThan(navGroupsSource.indexOf('href: "/primitives"'))
    expect(navGroupsSource.indexOf('href: "/primitives"')).toBeLessThan(navGroupsSource.indexOf('label: "OneHub"'))
    expect(primitivesSource).toContain('title: "AI原语"')
    expect(primitivesSource).toContain('filters: primitiveTypeFilters.map((filter) => filter.label)')
    expect(primitivesSource).toContain('label: "数据集原语", category: "dataset"')
    expect(primitivesSource).toContain('label: "模型原语", category: "model"')
    expect(primitivesSource).toContain('label: "模型训练原语", category: "model-training"')
    expect(primitivesSource).toContain('label: "模型推理原语", category: "model-inference"')
    expect(primitivesSource).toContain('label: "模型组件原语", category: "model-component"')
    expect(primitivesSource).toContain('label: "数据处理原语", category: "data-processing"')
    expect(primitivesSource).toContain('label: "评估指标原语", category: "evaluation"')
    expect(primitivesSource).toContain('label: "应用原语", category: "app"')
    expect(primitivesSource).toContain('label: "代码资产原语", category: "code-asset"')
    expect(primitivesSource).toContain("内置原语随 onecode 发布物固化")
    expect(primitivesSource).not.toContain("primitive-data-earth-era5-loader")
    expect(primitivesSource).not.toContain("primitive-model-aurora-runner")
    expect(primitivesSource).not.toContain("function primitive(id: string")
    expect(primitivesSource).toContain("items: [] as const")
    expect(primitiveUseDialogSource).toContain("export function PrimitiveUseDialog")
    expect(primitiveUseDialogSource).toContain("primitiveUseScenarios")
    expect(primitiveUseDialogSource).toContain("提交到科研开发")
    expect(oneScienceSource).toContain("openModelScopeSession(text)")
  })

  test("keeps primitive production separate from OneSkills agent registration", async () => {
    const appSource = await Bun.file(new URL("./app.tsx", import.meta.url)).text()
    const oneScienceSource = await Bun.file(new URL("./pages/onescience.tsx", import.meta.url)).text()
    const primitiveCreateDialogSource = await Bun.file(new URL("./components/onescience/PrimitiveCreateDialog.tsx", import.meta.url)).text()

    expect(appSource).toContain('<Route path="/primitives" component={LegacyWorkbenchRedirect} />')
    expect(oneScienceSource).toContain("function PrimitiveWorkspacePage()")
    expect(oneScienceSource).toContain("function PrimitiveCatalogPanel")
    expect(oneScienceSource).toContain("function PrimitiveFactoryPanel")
    expect(oneScienceSource).toContain("function AgentRegistryPanel")
    expect(oneScienceSource).toContain("export function SkillsPage()")
    expect(oneScienceSource).not.toContain("function SkillPrimitiveNames")
    expect(oneScienceSource).toContain("function SkillsDynamicPage")
    expect(oneScienceSource).toContain("listOneScienceSkills")
    expect(oneScienceSource).not.toContain('<AgentRegistryPanel title="可使用原语" />')
    expect(oneScienceSource).not.toContain("<SkillsAgentRegistrySection />")
    expect(oneScienceSource).toContain('tab=catalog')
    expect(oneScienceSource).toContain('tab=factory')
    expect(oneScienceSource).not.toContain('tab=registry')
    expect(oneScienceSource).toContain('原语目录')
    expect(oneScienceSource).toContain('原语工厂')
    expect(oneScienceSource).not.toContain('Agent 可调用原语')
    expect(oneScienceSource).not.toContain('<AgentRegistryPanel />\n        </Show>')
    expect(oneScienceSource).not.toContain('href="/skills">OneSkills 资源</A>')
    expect(oneScienceSource).not.toContain('export function PrimitivesPage() {\n  return <ResourcePage page="primitives" />\n}')
    expect(primitiveCreateDialogSource).toContain("props.serverUrl")
    expect(primitiveCreateDialogSource).toContain("/experimental/onescience/primitive")
    expect(primitiveCreateDialogSource).not.toContain("/api/experimental")
  })

  test("uses a clear send button in the workspace prompt", async () => {
    const oneScienceSource = await Bun.file(new URL("./pages/onescience.tsx", import.meta.url)).text()
    const css = await appCss()

    expect(oneScienceSource).not.toContain(">AI 输入框<")
    expect(oneScienceSource).toContain('aria-label="AI 输入框"')
    expect(oneScienceSource).toContain('class="os-button os-button-primary os-prompt-submit"')
    expect(oneScienceSource).toContain(">发送</button>")
    expect(oneScienceSource).not.toContain('<Icon name="enter" />')
    expect(css).toContain(".os-prompt-submit")
    expect(css).toContain("color: #ffffff !important;")
  })

  test("auto-submits workspace prompts after entering /code", async () => {
    const sessionSource = await Bun.file(new URL("./pages/session.tsx", import.meta.url)).text()

    expect(sessionSource).toContain("const [queuedPromptSubmit, setQueuedPromptSubmit]")
    expect(sessionSource).toContain("setQueuedPromptSubmit(true)")
    expect(sessionSource).toContain("codePanelVisible()")
    expect(sessionSource).toContain("urlPromptParam()")
    expect(sessionSource).toContain("[prompt.ready(), params.id, urlPromptParam()] as const")
    expect(sessionSource).toContain("shouldKeepWorkspacePrompt")
    expect(sessionSource).toContain("codePanelVisible()")
    expect(sessionSource).toContain("discardWorkspaceScopedPrefill")
    expect(sessionSource).toContain("scopeChanged")
    expect(sessionSource).toContain("clearPrefillComposerIfNeeded")
    expect(sessionSource).not.toContain("isStaleAppliedHandoffPrompt")
    expect(sessionSource).toContain("takeSessionHandoffDraft")
    expect(sessionSource).toContain("sessionHandoffRevision")
    expect(sessionSource).toContain("markSessionHandoffDraftApplied")
    expect(sessionSource).toContain("clearPrefillComposerIfNeeded")
    expect(sessionSource).toContain("clearPrefillComposerIfNeeded(prompt, dir, sessionID")
    expect(sessionSource).toContain("untrack(() =>")
    expect(sessionSource).toContain(
      "[codePanelVisible(), params.dir, params.id, urlPromptParam(), sessionHandoffRevision()] as const",
    )
    expect(sessionSource).toContain(
      "[prompt.ready(), params.id, params.dir, urlPromptParam(), sessionHandoffRevision(), codePanelVisible()] as const",
    )
    expect(sessionSource).toContain("if (!ready || !dir || !visible) return")
    expect(sessionSource).toContain('querySelector<HTMLButtonElement>(\'[data-action="prompt-submit"]\')')
    expect(sessionSource).toContain("!local.model.current() || !local.agent.current()")
    expect(sessionSource).toContain("submit.click()")
  })

  test("capability and model prefill writers share leave-clear handoff drafts", async () => {
    const wizard = await Bun.file(new URL("./workbench/capabilities/wizard.tsx", import.meta.url)).text()
    const install = await Bun.file(new URL("./workbench/capabilities/install.ts", import.meta.url)).text()
    const oneskills = await Bun.file(new URL("./workbench/capabilities/oneskills-panel.tsx", import.meta.url)).text()
    const modelDevelop = await Bun.file(new URL("./pages/model-develop.ts", import.meta.url)).text()
    const layout = await Bun.file(new URL("./pages/layout.tsx", import.meta.url)).text()
    const app = await Bun.file(new URL("./app.tsx", import.meta.url)).text()
    const session = await Bun.file(new URL("./pages/session.tsx", import.meta.url)).text()
    const workspacePrompt = await Bun.file(new URL("./pages/session/workspace-prompt.ts", import.meta.url)).text()

    for (const source of [wizard, install, oneskills, modelDevelop, layout]) {
      expect(source).toContain("pushSessionHandoffDraft")
    }
    expect(layout).not.toContain("setSessionHandoff(slug, { prompt: link.prompt })")
    expect(app).toContain("clearStoredCapabilityPrefill(lastSessionDir, lastSessionID)")
    expect(app).not.toContain("clearStoredWorkspacePrompt(lastSessionDir, lastSessionID)")
    expect(session).toContain("clearPrefillComposerIfNeeded")
    expect(session).toContain("discardWorkspaceScopedPrefill(prompt, dir)")
    expect(workspacePrompt).toContain("export function discardWorkspaceScopedPrefill")
    expect(workspacePrompt).toContain("export function clearStoredCapabilityPrefill")
    expect(workspacePrompt).toContain("export function clearPrefillComposerIfNeeded")
    expect(workspacePrompt).toContain("export function isPrefillComposerContent")
  })

  test("catches up a stalled busy transcript without skipping pending assistants", async () => {
    const timelineSource = await Bun.file(new URL("./pages/session/message-timeline.tsx", import.meta.url)).text()
    const syncSource = await Bun.file(new URL("./context/sync.tsx", import.meta.url)).text()
    const sdkSource = await Bun.file(new URL("./context/global-sdk.tsx", import.meta.url)).text()

    expect(timelineSource).toContain('if (!id || status.type !== "busy") return')
    expect(timelineSource).not.toContain("pendingAssistant")
    expect(timelineSource).toContain("liveTranscriptEpoch(sessionMessages(), sync.data.part)")
    expect(timelineSource).toContain("Promise.allSettled([sync.session.sync(id, { force: true }), sync.session.status()])")
    expect(timelineSource).toContain("window.setInterval")
    expect(timelineSource).toContain('event.details.type !== "server.connected"')
    expect(syncSource).toContain("async status()")
    expect(syncSource).toContain("mergeSessionStatusMap")
    expect(syncSource).toContain("keepRicherParts")
    expect(syncSource).toContain('from "./sync-merge"')
    expect(timelineSource).toContain('sync.set("session_status", id, { type: "idle" })')
    expect(timelineSource).toContain("sessionMessagesLookComplete(sessionMessages())")
    expect(timelineSource).not.toContain('sessionMessages().some((item) => item.role === "assistant")')
    expect(sdkSource).toContain("remapRemoteEventDirectory")
    expect(sdkSource).toContain("bindRemoteSessionDirectory")
    expect(sdkSource).toContain("mapSyncEventToUiEvent")
    expect(sdkSource).toContain("enqueue(directory, mapped)")
  })

  test("renders session retry status instead of an empty timeline row", async () => {
    const timelineSource = await Bun.file(new URL("./pages/session/message-timeline.tsx", import.meta.url)).text()
    expect(timelineSource).toContain("<SessionRetry status={sessionStatus()} show />")
  })

  test("clips the session header title at 40 characters with a styled tooltip", async () => {
    const timelineSource = await Bun.file(new URL("./pages/session/message-timeline.tsx", import.meta.url)).text()
    expect(timelineSource).toContain("SessionTitleLabel")
    expect(timelineSource).toContain('tag="h1"')
    expect(timelineSource).toContain('slot="session-title-child"')
    expect(timelineSource).toContain("max-w-[42em]")
    expect(timelineSource).toContain('placement="bottom-start"')
    expect(timelineSource).not.toContain("max-w-[18rem]")
    expect(timelineSource).not.toContain("title={childTitle()}")
  })

  test("routes model develop actions through the code workspace with modelscope handoff", async () => {
    const oneScienceSource = await Bun.file(new URL("./pages/onescience.tsx", import.meta.url)).text()
    const modelDevelopSource = await Bun.file(new URL("./pages/model-develop.ts", import.meta.url)).text()
    const appInstallSource = await Bun.file(new URL("./pages/app-install.ts", import.meta.url)).text()
    const catalogSource = await Bun.file(new URL("./pages/modelscope-catalog.ts", import.meta.url)).text()
    const handoffSource = await Bun.file(new URL("./pages/session/handoff.ts", import.meta.url)).text()
    const datasetDialogSource = await Bun.file(new URL("./components/onescience/DatasetDownloadDialog.tsx", import.meta.url)).text()
    const sessionBarSource = await Bun.file(new URL("./components/onescience/SessionEnvironmentBar.tsx", import.meta.url)).text()
    const remoteWorkspaceSource = await Bun.file(new URL("./components/onescience/remote-workspace.ts", import.meta.url)).text()
    const sessionSource = await Bun.file(new URL("./pages/session.tsx", import.meta.url)).text()
    const envSelectSource = await Bun.file(new URL("./components/onescience/RuntimeEnvironmentSelect.tsx", import.meta.url)).text()
    const promptInputSource = await Bun.file(new URL("./components/prompt-input.tsx", import.meta.url)).text()
    const submitSource = await Bun.file(new URL("./components/prompt-input/submit.ts", import.meta.url)).text()
    const composerSource = await Bun.file(new URL("./pages/session/composer/session-composer-region.tsx", import.meta.url)).text()
    const createFolderSource = await Bun.file(new URL("./components/dialog-create-project-folder.tsx", import.meta.url)).text()
    const projectEnvDialogSource = await Bun.file(new URL("./components/dialog-project-environment.tsx", import.meta.url)).text()
    const sidebarCodeTreeSource = await Bun.file(new URL("./pages/layout/sidebar-code-tree.tsx", import.meta.url)).text()
    const style = await Bun.file(new URL("./index.css", import.meta.url)).text()
    const pagesLayoutSource = await Bun.file(new URL("./pages/layout.tsx", import.meta.url)).text()
    const remoteMarkerSource = await Bun.file(
      new URL("../../ui/src/components/runtime-environment-marker.ts", import.meta.url),
    ).text()

    expect(oneScienceSource).toContain("useModelScopeSessionNavigate")
    expect(oneScienceSource).toContain('props.item.action === "开发"')
    expect(oneScienceSource).toContain('props.item.action === "下载"')
    expect(oneScienceSource).toContain("showAppInstallAction")
    expect(oneScienceSource).toContain("openInstall")
    expect(oneScienceSource).toContain("appInstallPrompt")
    expect(oneScienceSource).toContain("appInstallPromptTemplate")
    expect(appInstallSource).toContain("modelScopeTaskPromptHeader")
    expect(appInstallSource).toContain("远端")
    expect(oneScienceSource).toContain("modelScopeModelId")
    expect(oneScienceSource).toContain("modelScopeDatasetId")
    expect(oneScienceSource).toContain("operatorImportDisabled")
    expect(modelDevelopSource).toContain("prepareCodeSessionHandoff")
    expect(modelDevelopSource).toContain("pushSessionHandoffDraft")
    expect(oneScienceSource).toContain("DatasetDownloadDialog")
    expect(oneScienceSource).not.toContain("downloadCondaEnv")
    expect(oneScienceSource).toContain("useOpenSshTargetMap")
    expect(datasetDialogSource).not.toContain("conda 环境")
    expect(datasetDialogSource).toContain("os-download-env-row")
    expect(datasetDialogSource).not.toContain("os-download-conda-query")
    expect(oneScienceSource).not.toContain("fetchCondaEnvs")
    expect(oneScienceSource).toContain("DatasetDownloadCancelDialog")
    expect(oneScienceSource).toContain("DatasetDownloadDeleteDialog")
    expect(oneScienceSource).toContain("setDownloadDeleteKeys([])")
    expect(oneScienceSource).toContain("正在下载 ·")
    expect(datasetDialogSource).toContain("请选择要删除")
    expect(datasetDialogSource).toContain("os-download-copy-item")
    expect(datasetDialogSource).not.toContain("data-conda")
    expect(datasetDialogSource).not.toContain("os-download-conda-combobox")
    expect(datasetDialogSource).not.toContain("手动填写 / 留空用默认")
    expect(datasetDialogSource).not.toContain("可选，留空用默认 modelscope")
    expect(datasetDialogSource).toContain("os-download-path-hint")
    expect(datasetDialogSource).toContain("datasetSizeBlocking")
    expect(datasetDialogSource).toContain("spaceInsufficient")
    expect(datasetDialogSource).toContain("spaceUnknown")
    expect(datasetDialogSource).toContain("可用空间不足，无法下载该数据集")
    expect(datasetDialogSource).toContain("无法获取远端可用空间，暂不可下载")
    expect(datasetDialogSource).toContain("无法从魔搭获取数据集大小，暂不可下载")
    expect(style).toContain(".os-dataset-download-info[data-insufficient]")
    expect(style).toContain(".os-dataset-download-info[data-unknown]")
    expect(datasetDialogSource).toContain("正在删除所选副本")
    expect(datasetDialogSource).toContain("该数据集已下载到多个环境")
    expect(oneScienceSource).toContain("listDatasetDownloadCopies")
    expect(oneScienceSource).toContain("downloadedCopies={datasetDownloadCopies}")
    expect(envSelectSource).toContain("os-env-option-badge")
    expect(envSelectSource).toContain("已下载")
    expect(envSelectSource).toContain("datasetCopyStatusForEnv")
    expect(style).toContain(".os-env-option-badge")
    expect(style).toContain(".os-env-select-group")
    expect(catalogSource).toContain("export const modelScopeModels")
    expect(catalogSource).toContain("export const modelScopeDatasets")
    expect(handoffSource).toContain("pushSessionHandoffDraft")
    expect(handoffSource).toContain("takeSessionHandoffDraft")
    expect(handoffSource).toContain("markSessionHandoffDraftApplied")
    expect(handoffSource).toContain("sessionHandoffRevision")
    expect(handoffSource).toContain("condaEnv")
    expect(modelDevelopSource).toContain("modelScopeCacheFollowup")
    expect(modelDevelopSource).toContain("conda activate")
    expect(modelDevelopSource).not.toContain("下载到 ${relativePath}")
    expect(sessionBarSource).toContain("连接")
    expect(sessionBarSource).toContain("os-session-project")
    expect(sessionBarSource).toContain("os-session-project-path")
    expect(sessionBarSource).toContain("os-session-project-switch")
    expect(sessionBarSource).toContain("DialogSelectDirectory")
    expect(sessionBarSource).toContain("DialogCreateProjectFolder")
    expect(sessionBarSource).toContain("pushSessionHandoffDraft")
    expect(sessionBarSource).toContain("workspacePromptText")
    expect(sessionBarSource).toContain("markCodeNewSessionIntent")
    expect(sessionBarSource).toContain("sshTestPayload(target)")
    expect(sessionBarSource).toContain("accountId: storedPlatformAuthSession()?.account.id")
    expect(sessionBarSource).toContain("workspaceClientError")
    expect(sessionBarSource).toContain("onFocus={(event) => event.currentTarget.select()}")
    expect(style).toContain(".os-session-project-path")
    expect(style).toContain(".os-session-project-rows")
    expect(style).toContain('.os-session-project-card[data-kind="remote"]')
    expect(sessionBarSource).toContain('data-kind={displayEnv().kind === "ssh" ? "remote" : undefined}')
    expect(sessionBarSource).not.toContain(">远端路径<")
    expect(sessionBarSource).toContain("displayRemotePath")
    expect(sessionBarSource).toContain("projectPath")
    expect(sessionBarSource).toContain("projectLabel")
    expect(sessionBarSource).not.toContain(">执行环境<")
    expect(sessionBarSource).not.toContain(">当前项目<")
    expect(sessionBarSource).not.toContain("os-session-project-kicker")
    expect(sessionBarSource).toContain('data-role="env"')
    expect(sessionBarSource).toContain('data-role="project"')
    expect(sessionBarSource.indexOf('data-role="env"')).toBeLessThan(sessionBarSource.indexOf('data-role="project"'))
    expect(style).toContain('.os-session-project-row[data-role="env"]')
    expect(style).toContain("flex-wrap: wrap")
    expect(sessionBarSource).toContain("runtimeEnvironmentLabel(displayEnv())")
    expect(sessionBarSource).toContain("os-session-env-line")
    expect(sessionBarSource).not.toContain("DialogAlignProjectEnvironment")
    expect(sessionBarSource).not.toContain("session.environment.align")
    expect(sessionBarSource).not.toContain("openAlign")
    expect(sessionBarSource).toContain("copyTextToClipboard")
    expect(sessionBarSource).toContain("os-session-project-copy")
    expect(sessionBarSource).not.toContain("RuntimeEnvironmentSelect")
    expect(sessionBarSource).not.toContain("setSessionCondaEnvFor")
    expect(sessionBarSource).toContain("os-session-conda-query")
    expect(style).toContain("[data-slot=\"dropdown-menu-radio-item\"][data-checked]")
    expect(style).toContain("border-color: #d7dbe1")
    expect(style).toContain(".os-download-copy-item[data-selected]")
    expect(style).toContain(".os-session-env-line")
    expect(style).toContain(".os-session-project-copy")
    expect(style).toContain(".os-session-project-card[data-fill]")
    expect(style).toContain('html[data-color-scheme="dark"] .os-code-embed .os-session-project-value')
    expect(style).toContain('html[data-color-scheme="dark"] .os-code-embed .os-session-env-tag')
    expect(sessionBarSource).toContain("os-session-conda-query")
    expect(sessionBarSource).toContain('? "取消检测" : "检测"')
    expect(sessionBarSource).toContain("取消检测")
    expect(sessionBarSource).toContain("sshPreflightProgressKey")
    expect(sessionBarSource).toContain("preflightSshWorkspace")
    expect(sessionBarSource).toContain("检测进度")
    expect(sessionBarSource).toContain("fromPreflight(initialPreflightSteps())")
    expect(sessionBarSource).not.toContain("fetchCondaEnvs")
    expect(sessionBarSource).not.toContain("hideScnet")
    expect(sessionBarSource).toContain("AUTO_DISCONNECT_RETRY_MS")
    expect(sessionBarSource).not.toContain("detachCurrentSession")
    expect(sessionBarSource).not.toContain("切回本地超时")
    expect(sessionBarSource).not.toContain("autoDisconnectTried")
    expect(sessionBarSource).not.toContain("if (env.kind === \"local\")")
    expect(sessionBarSource).toContain("取消检测")
    expect(sessionBarSource).toContain("取消连接")
    expect(createFolderSource).toContain("abortSshConnect")
    expect(createFolderSource).toContain("cancelConnecting")
    expect(createFolderSource).toContain("abort.abort()")
    expect(createFolderSource).toContain("timedOut")
    expect(createFolderSource).toContain("SSH_CONNECT_TIMEOUT_MESSAGE")
    expect(sessionBarSource).toContain("abortSshConnect")
    expect(sessionBarSource).toContain("已手动取消")
    expect(sessionBarSource).toContain("os-session-preflight")
    expect(sessionBarSource).toContain("os-session-preflight-close")
    expect(sessionBarSource).toContain("关闭检测结果")
    expect(sessionBarSource).toContain("关闭连接进度")
    expect(sessionBarSource).toContain("fetchSshConnectProgress")
    expect(sessionBarSource).toContain("progressKey")
    expect(sessionBarSource).toContain("连接进度")
    expect(sessionBarSource).toContain('item.status === "ok" ? "true"')
    expect(sessionBarSource).toContain('item.status === "current" ? "…"')
    expect(sessionBarSource).toContain("envKeyOf(env)")
    expect(sessionBarSource).not.toContain('.join("  ·  ")')
    expect(sessionBarSource).toContain("fromConnect(initialConnectSteps())")
    expect(sessionBarSource).toContain("mergeConnectProgress")
    expect(sessionBarSource).not.toContain("等待健康检查")
    expect(remoteWorkspaceSource).toContain("确认服务已启动")
    expect(remoteWorkspaceSource).toContain("初始化远端环境")
    expect(remoteWorkspaceSource).toContain('id: "init"')
    expect(remoteWorkspaceSource).toContain("同步会话")
    expect(remoteWorkspaceSource).toContain("检测执行条件")
    expect(remoteWorkspaceSource).toContain('id: "preflight"')
    expect(remoteWorkspaceSource).toContain("export function mergeConnectProgress")
    expect(remoteWorkspaceSource).toContain("SSH_CONNECT_TIMEOUT_MS = 360_000")
    expect(remoteWorkspaceSource).toContain("SSH_CONNECT_TIMEOUT_MESSAGE")
    expect(sessionBarSource).not.toContain("fromPreflightLive(initialPreflightSteps())")
    expect(style).toContain(".os-session-preflight")
    expect(style).toContain('.os-session-preflight[data-ok="true"]')
    expect(style).toContain('.os-session-preflight[data-ok="false"]')
    expect(style).toContain('.os-session-preflight[data-ok="pending"]')
    expect(style).toContain('[data-ok="skip"]')
    expect(style).toContain('[data-ok="current"]')
    expect(style).toContain(".os-session-preflight-error")
    expect(sessionBarSource).toContain('class="os-session-preflight-detail select-text"')
    expect(sessionBarSource).toContain("item.detail && item.status !== \"ok\"")
    expect(createFolderSource).toContain("item.detail && item.status !== \"ok\"")
    expect(sessionBarSource).toContain("os-session-preflight-error select-text")
    expect(pagesLayoutSource).toContain("[&_.os-session-preflight]:select-text")
    const connectFn = sessionBarSource.slice(
      sessionBarSource.indexOf("const connect = async"),
      sessionBarSource.indexOf("const disconnect = async"),
    )
    expect(connectFn.indexOf("workspace.warp")).toBeGreaterThan(-1)
    expect(connectFn.indexOf("workspace.warp")).toBeLessThan(connectFn.indexOf("waitForWorkspaceFileList"))
    expect(connectFn.indexOf("waitForWorkspaceFileList")).toBeLessThan(connectFn.indexOf("setRemoteWorkspaceFor"))
    expect(connectFn).toContain("正在等待文件服务")
    expect(connectFn).toContain("fileWaitConnectSteps")
    expect(connectFn).not.toContain("leaf file list after connect still settling")
    expect(connectFn).not.toContain("远端已连接，文件服务稍后刷新")
    expect(connectFn).toMatch(/workspace[\s\S]*\.remove\(/)
    expect(connectFn).toContain("wantedTarget")
    expect(connectFn).toContain("abortSshConnect")
    expect(connectFn).toContain("SSH_CONNECT_TIMEOUT_MESSAGE")
    expect(sessionBarSource).toContain("abort?.abort()")
    expect(connectFn).toContain("已取消远端连接")
    expect(connectFn).toContain("canWarpSession")
    expect(connectFn).toContain("远端已连接，会话同步稍后重试")
    expect(connectFn).toContain("workspace warp after connect failed")
    expect(connectFn).not.toContain("clearSessionBusy")
    expect(sessionBarSource).toContain("clearSessionBusy")
    expect(promptInputSource).toContain("sshSendBlocked")
    expect(promptInputSource).toContain("useRuntimeEnvironment")
    expect(promptInputSource).toContain("请先连接远端")
    expect(sessionBarSource).toContain("DISCONNECT_TIMEOUT_MS")
    expect(sessionBarSource).toContain("断开远端超时")
    expect(sessionBarSource).not.toContain("已解除本地绑定")
    expect(sessionBarSource).toContain("!envMismatch()")
    expect(sessionBarSource).toContain("!envMismatch() && sshSelected()")
    expect(sessionBarSource).toContain("!envMismatch() && connected()")
    expect(sessionBarSource).toContain("isRemoteWorkspaceConnected")
    expect(sessionBarSource).toContain("hydrateProjectRuntimeEnvironment")
    expect(sessionBarSource).toContain("applyServerRuntimeEnvironment(directory, { kind: \"local\" })")
    expect(sessionBarSource).toContain("applyServerRemoteWorkspace")
    expect(sessionBarSource).toContain("markRemoteWorkspaceUserStopped")
    expect(sessionBarSource).toContain("clearRemoteWorkspaceUserStopped")
    expect(sessionBarSource).toContain("isRemoteWorkspaceUserStopped")
    expect(sessionBarSource).not.toContain("userStoppedRemote")
    expect(remoteWorkspaceSource).toContain('if (row.status && row.status !== "connected") return []')
    expect(sessionBarSource).toContain("displayName(project)")
    expect(sessionBarSource).toContain("useGlobalSDK")
    expect(sessionBarSource).toContain('type !== "workspace.status"')
    expect(sessionBarSource).toContain("Welcome home has no session — skip status-event reconcile storm")
    expect(sessionBarSource).toContain("lastKnownWorkspaceID")
    expect(sessionBarSource).toContain("isRemoteWorkspaceUserStopped(directory)")
    expect(sessionBarSource).toContain("F5 clears the in-memory live id")
    expect(sessionBarSource).toContain("reconcileFromServer(directory, wanted, false)")
    expect(sessionBarSource).toContain("experimental.workspace.list")
    expect(sessionBarSource).toContain("experimental.workspace.status")
    expect(remoteWorkspaceSource).toContain("STOPPED_STORAGE_KEY")
    expect(remoteWorkspaceSource).toContain("onescience.remote-workspace.stopped.v1")
    expect(remoteWorkspaceSource).toContain("export function applyServerRemoteWorkspace")
    expect(remoteWorkspaceSource).toContain("export function lastKnownWorkspaceID")
    expect(remoteWorkspaceSource).toContain("remoteHttpErrorMessage")
    expect(remoteWorkspaceSource).not.toContain("JSON.stringify(data)")
    expect(sessionBarSource).not.toContain("restoreProjectRuntimeEnvironment")
    expect(sessionBarSource).not.toContain("sshEvidenceFromBinding")
    expect(sessionBarSource).toContain("SSH_CONNECT_TIMEOUT_MS")
    expect(sessionBarSource).toContain("sessionWorkspaceID === current.workspaceID")
    const disconnectFn = sessionBarSource.slice(
      sessionBarSource.indexOf("const disconnect = async"),
      sessionBarSource.indexOf('if (runtime.env().kind === "scnet")'),
    )
    expect(disconnectFn.indexOf("finally")).toBeGreaterThan(-1)
    expect(disconnectFn.indexOf("setRemoteWorkspaceFor")).toBeGreaterThan(-1)
    expect(disconnectFn.indexOf("setRemoteWorkspaceFor")).toBeLessThan(disconnectFn.indexOf("finally"))
    expect(disconnectFn).toContain("断开失败")
    expect(disconnectFn).toContain("sync.session.sync(sessionID, { force: true })")
    expect(sessionBarSource).toContain("disabled={!!busy()}")
    expect(envSelectSource).toContain("disabled?: boolean")
    expect(envSelectSource).toContain("disabled={disabled()}")
    expect(envSelectSource).toContain("hideScnet")
    expect(sessionSource).toContain("currentOpenSshTargetMap")
    expect(sessionSource).not.toContain("shouldApplySessionRuntimeEnvironment")
    expect(sessionSource).not.toContain("appliedRuntimeEnvFor")
    expect(sessionSource).not.toContain("setRuntimeEnvironmentFor(dir, resolved.env)")
    expect(remoteMarkerSource).not.toContain('return { kind: "local" }')
    expect(submitSource).toContain("sendEnvironmentMeta")
    expect(submitSource).toContain("environment: sendEnvironmentMeta")
    expect(submitSource).toContain("setSessionBoundEnvironmentFor")
    expect(submitSource).toContain("session.environment.mismatch")
    expect(submitSource).toContain("remoteModelNotReady")
    expect(composerSource).toContain("environmentMismatch")
    expect(composerSource).toContain("session.environment.mismatch")
    expect(composerSource).toContain("remoteDisconnected")
    expect(composerSource).toContain("loggedOut")
    expect(createFolderSource).toContain("RuntimeEnvironmentSelect")
    expect(createFolderSource).toContain("setRuntimeEnvironmentFor(directory, env())")
    expect(createFolderSource).toContain("persistProjectExecutionMarker")
    expect(createFolderSource).toContain("persistProjectExecutionToControlPlane")
    expect(createFolderSource).toContain("waitForWorkspaceFileList")
    expect(createFolderSource).toContain("fileWaitConnectSteps")
    expect(createFolderSource).toContain("正在等待文件服务")
    expect(createFolderSource).not.toContain("远端已连接，文件服务稍后刷新")
    expect(createFolderSource).toContain("连接远端")
    expect(createFolderSource).toContain("os-session-preflight-list")
    expect(createFolderSource).toContain("pollRemoteProgress")
    expect(createFolderSource).toContain("检测进度")
    expect(createFolderSource).toContain("连接进度")
    expect(createFolderSource).toContain("previewDefaultRemotePath")
    expect(createFolderSource).toContain("remotePathFocused")
    expect(createFolderSource).toContain("selectionStart")
    expect(createFolderSource).toContain("event.preventDefault()")
    expect(createFolderSource).not.toContain("remotePathEditing")
    expect(createFolderSource).not.toContain("readOnly={!remotePathEditing()}")
    expect(createFolderSource).toContain("remotePathDirty")
    expect(createFolderSource).toContain("dialog.project.createFolder.remotePathReset")
    expect(createFolderSource).not.toContain("dialog.project.createFolder.remotePathEdit")
    expect(createFolderSource).toContain("allocateLocalIdentityName")
    expect(createFolderSource).toContain("uniqueIfExists")
    expect(createFolderSource).toContain("dialog.project.createFolder.localIdentityUnique")
    expect(createFolderSource).toContain("if (!remoteSelected() && nameConflict()) return false")
    expect(createFolderSource).toContain("disabled={!!busy()}")
    expect(projectEnvDialogSource).toContain("setRuntimeEnvironmentFor(props.directory, env())")
    expect(projectEnvDialogSource).toContain("dialog.project.environment.disconnectWarning")
    expect(projectEnvDialogSource).toContain("DialogAlignProjectEnvironment")
    expect(projectEnvDialogSource).toContain("os-session-align-dialog")
    expect(style).toContain("[data-component=\"dialog\"]:has(.os-session-align-dialog) [data-slot=\"dialog-container\"]")
    expect(style).toContain("html:has(.os-client-workbench) [data-component=\"dialog-overlay\"]:not([data-permission-modal])")
    expect(style).toContain(".os-session-conda-query:hover:not(:disabled)")
    expect(style).toContain("background: #ad2830")
    expect(promptInputSource).toContain("os-prompt-placeholder")
    expect(style).toContain(".os-code-embed .os-prompt-placeholder")
    expect(style).toContain("caret-color: var(--os-code-text, #0d0d0d)")
    expect(style).toContain("cursor: text")
    expect(style).not.toContain('url("/assets/cursor-text.png")')
    expect(style).toContain("color-scheme: light")
    expect(sidebarCodeTreeSource).not.toContain("DialogProjectEnvironment")
    expect(sessionSource).toContain("sessionCondaEnvRevision")
    expect(sessionSource).toContain("handoffRenderKey")
    expect(sessionSource).toContain("sameHandoffPrompt")
    expect(submitSource).not.toContain("navigate(defaultProjectSessionHref()")
    expect(submitSource).toContain("environmentMeta")
    expect(submitSource).toContain("onSessionMissing")
    expect(submitSource).toContain("isTransientRemoteError")
    expect(submitSource).toContain("session.get")
    expect(sessionSource).toContain("onSessionMissing")
    expect(remoteMarkerSource).toContain("远端 ·")
    expect(remoteMarkerSource).toContain("【环境信息】")
    expect(remoteMarkerSource).toContain("lastMessageRuntimeEnvironment")
  })
})
