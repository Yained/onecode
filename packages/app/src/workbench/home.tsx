import { Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { A, useLocation, useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { PromptInput } from "@/components/prompt-input"
import { SessionEnvironmentBar } from "@/components/onescience/SessionEnvironmentBar"
import { useWorkbenchProjectDirectory } from "@/workbench/current-project"
import { CommentsProvider } from "@/context/comments"
import { FileProvider } from "@/context/file"
import { LocalProvider } from "@/context/local"
import { PromptProvider } from "@/context/prompt"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider } from "@/context/sync"
import { RouteParamsProvider } from "@/hooks/use-route-params"
import {
  platformAuthLoggingOutEvent,
  platformAuthSessionUpdatedEvent,
  platformWorkspaceCacheClearedEvent,
  storedPlatformAuthSession,
} from "@/utils/platform-auth"
import { isSshFileTreePending, remoteWorkspaceRevision } from "@/components/onescience/remote-workspace"
import { runtimeEnvironmentRevision } from "@/components/onescience/runtime-environment"
import { consumePendingAction } from "@/workbench/pending-action"
import { requirePersonalSpace } from "@/workbench/require-auth"
import { isWorkspaceSessionPath } from "@/workbench/routes"
import { WorkbenchWelcomeTerminalHost } from "@/workbench/terminal-host"

export function WorkbenchHomePage() {
  const location = useLocation()
  const homeDirectory = useWorkbenchProjectDirectory()
  const [authEpoch, setAuthEpoch] = createSignal(0)
  const loggedIn = createMemo(() => {
    authEpoch()
    return !!storedPlatformAuthSession()
  })
  // Session keepalive mounts its own SDK/Sync/File tree. Keeping the welcome
  // prompt stack alive on /session/... remounts a second copy when touchCode
  // flips lastCode (remote-first freeze: welcome hero stuck, Network 0 kB).
  const sessionOpen = createMemo(() => isWorkspaceSessionPath(location.pathname))

  const directory = createMemo(() => {
    if (!loggedIn()) return ""
    return homeDirectory()
  })

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

    const action = consumePendingAction()
    if (action?.type !== "prompt") return
    queueMicrotask(() => document.querySelector<HTMLElement>('[data-component="prompt-input"]')?.focus())
  })

  return (
    <div class="os-client-chat-page os-client-welcome-chat">
      <section class="os-client-chat-stage is-empty">
        <div class="os-client-chat-hero">
          <img class="os-client-logo" src="/assets/onescience/onescience-logo.png" alt="OneScience" />
          <h1>全流程科研模型生成平台</h1>
          <p>从需求、数据、模型、skills 到运行环境，把科研工作组织成可执行的客户端任务。</p>
        </div>
      </section>

      <Show
        when={loggedIn() && !sessionOpen()}
        fallback={
          <Show when={!loggedIn()}>
            <div class="os-client-welcome-prompt-empty" role="region" aria-label="登录提示">
              <div class="os-client-welcome-login-card">
                <div class="os-client-welcome-login-copy">
                  <strong>登录后开始对话</strong>
                  <p>使用个人工作区与 Agent 协作，管理项目、会话与科研任务。</p>
                </div>
                <A
                  href={`/login?redirect=${encodeURIComponent("/workspace")}`}
                  class="os-client-welcome-login-cta"
                >
                  去登录
                </A>
              </div>
            </div>
          </Show>
        }
      >
        <Show
          when={directory()}
          fallback={
            <div class="os-client-welcome-prompt-empty">
              <p>正在准备工作区…</p>
            </div>
          }
        >
          {(dir) => <WorkbenchHomePromptRoot directory={dir()} />}
        </Show>
      </Show>
    </div>
  )
}

function WorkbenchHomePromptRoot(props: { directory: string }) {
  const params = createMemo(() => ({
    dir: base64Encode(props.directory),
    id: undefined as string | undefined,
  }))

  return (
    <RouteParamsProvider params={params}>
      <SDKProvider directory={() => props.directory}>
        <SyncProvider>
          <FileProvider>
            <PromptProvider>
              <CommentsProvider>
                <LocalProvider>
                  <WorkbenchHomePromptDock directory={() => props.directory} />
                </LocalProvider>
              </CommentsProvider>
            </PromptProvider>
          </FileProvider>
        </SyncProvider>
      </SDKProvider>
    </RouteParamsProvider>
  )
}

function WorkbenchHomePromptDock(props: { directory: () => string }) {
  const navigate = useNavigate()
  const remoteDisconnected = createMemo(() => {
    runtimeEnvironmentRevision()
    remoteWorkspaceRevision()
    const directory = props.directory()
    if (!directory) return false
    return isSshFileTreePending(directory)
  })

  const gatePersonalSpace = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return
    if (!target.closest('[data-action="prompt-attach"], [data-action="prompt-submit"]')) return
    if (storedPlatformAuthSession()) return
    event.preventDefault()
    event.stopPropagation()
    requirePersonalSpace({
      navigate,
      action: { type: "prompt", prompt: "" },
      isLoggedIn: false,
    })
  }

  return (
    <>
      <WorkbenchWelcomeTerminalHost />
      <div
        class="os-client-welcome-prompt os-code-embed"
        data-component="session-prompt-dock"
        onClick={gatePersonalSpace}
      >
        <SessionEnvironmentBar directory={props.directory} />
        <Show when={!remoteDisconnected()}>
          <PromptInput />
        </Show>
      </div>
    </>
  )
}
