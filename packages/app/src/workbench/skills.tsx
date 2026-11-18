import { A, useLocation, useNavigate } from "@solidjs/router"
import { createMemo, createSignal, For, Show, onCleanup, onMount } from "solid-js"
import { skillManagerTabs, SkillManagerPanel } from "@/components/skill-manager-dialog"
import { useServer } from "@/context/server"
import {
  defaultPlatformProjectDirectory,
  personalWorkspaceDirectory,
  platformAuthLoggingOutEvent,
  platformAuthSessionUpdatedEvent,
  platformWorkspaceCacheClearedEvent,
  storedPlatformAuthSession,
} from "@/utils/platform-auth"
import type { SkillManagerTab } from "@/pages/onescience-skill-management"
import { workspaceSkillsHref } from "@/workbench/routes"

function tabFromSearch(search: string): SkillManagerTab | undefined {
  const value = new URLSearchParams(search).get("tab")
  if (value === "list" || value === "repo" || value === "upload") return value
}

export function WorkbenchSkillsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const server = useServer()
  const [authEpoch, setAuthEpoch] = createSignal(0)
  const loggedIn = createMemo(() => {
    authEpoch()
    return !!storedPlatformAuthSession()
  })
  const loginRequired = createMemo(() => !loggedIn())
  const [tab, setTab] = createSignal<SkillManagerTab>(tabFromSearch(location.search) ?? "list")

  const directory = createMemo(() => {
    authEpoch()
    const session = storedPlatformAuthSession()
    if (!session) return ""
    return (
      personalWorkspaceDirectory(session, server.projects.lastCode()) ||
      defaultPlatformProjectDirectory(session) ||
      ""
    )
  })

  const selectTab = (next: SkillManagerTab) => {
    setTab(next)
    // Keep tab in the URL so login cancel / left-nav auth gates restore the same skills view.
    navigate(workspaceSkillsHref(next), { replace: true })
  }

  onMount(() => {
    const bump = () => setAuthEpoch((value) => value + 1)
    window.addEventListener(platformAuthLoggingOutEvent, bump)
    window.addEventListener(platformAuthSessionUpdatedEvent, bump)
    window.addEventListener(platformWorkspaceCacheClearedEvent, bump)
    onCleanup(() => {
      window.removeEventListener(platformAuthLoggingOutEvent, bump)
      window.removeEventListener(platformAuthSessionUpdatedEvent, bump)
      window.removeEventListener(platformWorkspaceCacheClearedEvent, bump)
    })
  })

  const activeTab = () => skillManagerTabs.find((item) => item.id === tab()) ?? skillManagerTabs[0]

  return (
    <div class="os-client-capability-page os-client-skills-page">
      <section class="os-client-capability-selector" aria-label="技能设置">
        <div class="os-client-capability-current-domain">
          <span>技能设置：</span>
          <strong>{activeTab().label}</strong>
          <small>{activeTab().hint}</small>
        </div>
        <Show when={loginRequired()}>
          <p class="os-client-skills-login-hint">
            登录后可同步个人空间技能。{" "}
            <A href={`/login?redirect=${encodeURIComponent(workspaceSkillsHref(tab()))}`}>去登录</A>
          </p>
        </Show>
        <div
          class="os-client-capability-tabs os-client-skills-tabs"
          role="tablist"
          aria-label="技能管理视图"
        >
          <For each={skillManagerTabs}>
            {(item) => (
              <button
                type="button"
                classList={{ "is-active": tab() === item.id }}
                aria-pressed={tab() === item.id}
                onClick={() => selectTab(item.id)}
              >
                <strong>{item.label}</strong>
                <small>{item.hint}</small>
              </button>
            )}
          </For>
        </div>
      </section>

      <div class="os-client-capability-page-body">
        <SkillManagerPanel
          directory={loginRequired() ? undefined : directory() || undefined}
          loginRequired={loginRequired()}
          tab={tab()}
          onTabChange={selectTab}
          variant="page-body"
        />
      </div>
    </div>
  )
}
