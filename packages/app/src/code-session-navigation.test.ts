import { describe, expect, test, beforeEach } from "bun:test"
import { codeSessionHref } from "./app-routes"
import {
  isCodeNewSessionIntent,
  markCodeNewSessionIntent,
  rememberCodeSessionNavigation,
  resetCodeSessionNavigationForTest,
  resolveCodeDevelopmentEntryHref,
} from "./code-session-navigation"

const workspace = "/data/work/my_proj"
const sessionHref = codeSessionHref(workspace, "ses_abc")
const slug = sessionHref.split("/")[2]!

describe("code session navigation", () => {
  beforeEach(() => {
    resetCodeSessionNavigationForTest()
    localStorage.clear()
  })

  test("restores the last workspace without auto-opening the session", () => {
    rememberCodeSessionNavigation(sessionHref)

    expect(
      resolveCodeDevelopmentEntryHref({
        pathname: "/home",
        search: "",
        hash: "",
        path: { directory: "/repo" },
        recent: [{ worktree: workspace }],
        lastCodeWorkspace: workspace,
      }),
    ).toBe(codeSessionHref(workspace))
  })

  test("opens a blank new session instead of restoring a previous session", () => {
    rememberCodeSessionNavigation(sessionHref)
    markCodeNewSessionIntent(slug)

    expect(
      resolveCodeDevelopmentEntryHref({
        pathname: "/skills",
        search: "",
        hash: "",
        path: { directory: "/repo" },
        recent: [{ worktree: workspace }],
        lastCodeWorkspace: workspace,
      }),
    ).toBe(codeSessionHref(workspace))
  })

  test("does not auto-open remembered session when entering development", () => {
    const caseHref = codeSessionHref(workspace, "ses_case")
    rememberCodeSessionNavigation(caseHref)

    expect(
      resolveCodeDevelopmentEntryHref({
        pathname: "/",
        search: "",
        hash: "",
        path: { directory: "/repo" },
        recent: [{ worktree: workspace }],
        lastCodeWorkspace: workspace,
      }),
    ).toBe(codeSessionHref(workspace))
  })

  test("does not remember shared-cases browse routes as restore targets", () => {
    const accountSession = {
      token: "t",
      expiresAt: Date.now() + 60_000,
      account: { id: "a", email: "a@b.c", name: "a", status: "active", timeCreated: 1 },
      workspaces: [
        {
          id: "w1",
          slug: "my",
          name: "my",
          defaultEnvPath: workspace,
          role: "admin",
        },
      ],
      capabilities: { terminal: true, sharedCasesRoot: "/data/case" },
    }
    localStorage.setItem("onecode.settings.dat:platformAuthSession", JSON.stringify(accountSession))
    localStorage.setItem("onecode.settings.dat:platformAuthToken", accountSession.token)
    const sharedHref = codeSessionHref("/data/case", "ses_shared")
    rememberCodeSessionNavigation(sessionHref)
    rememberCodeSessionNavigation(sharedHref)

    expect(
      resolveCodeDevelopmentEntryHref({
        pathname: "/home",
        search: "",
        hash: "",
        path: { directory: "/repo" },
        recent: [{ worktree: workspace }],
        lastCodeWorkspace: workspace,
        accountSession,
      }),
    ).toBe(codeSessionHref(workspace))
  })

  test("keeps the active code route while already in development", () => {
    expect(
      resolveCodeDevelopmentEntryHref({
        pathname: sessionHref,
        search: "",
        hash: "",
        path: { directory: "/repo" },
        recent: [{ worktree: workspace }],
        lastCodeWorkspace: workspace,
      }),
    ).toBe(sessionHref)
  })

  test("tracks explicit new-session intent for the workspace composer", () => {
    expect(isCodeNewSessionIntent(slug)).toBe(false)
    markCodeNewSessionIntent(slug)
    expect(isCodeNewSessionIntent(slug)).toBe(true)
  })
})
