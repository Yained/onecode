import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { A, useLocation, useNavigate } from "@solidjs/router"
import { useSpring } from "@opencode-ai/ui/motion-spring"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLayout } from "@/context/layout"
import { PromptInput } from "@/components/prompt-input"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { useServer } from "@/context/server"
import { useSync } from "@/context/sync"
import { useGlobalSync } from "@/context/global-sync"
import { getSessionHandoff, setSessionHandoff } from "@/pages/session/handoff"
import { useSessionKey } from "@/pages/session/session-layout"
import { SessionPermissionDock } from "@/pages/session/composer/session-permission-dock"
import { SessionQuestionDock } from "@/pages/session/composer/session-question-dock"
import { SessionFollowupDock } from "@/pages/session/composer/session-followup-dock"
import { SessionRevertDock } from "@/pages/session/composer/session-revert-dock"
import type { SessionComposerState } from "@/pages/session/composer/session-composer-state"
import { SessionTodoDock } from "@/pages/session/composer/session-todo-dock"
import type { FollowupDraft } from "@/components/prompt-input/submit"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { configuredCodeDefaultDirectory, isSharedCodeCatalogDirectory, sessionHrefForPath } from "@/app-routes"
import { decode64 } from "@/utils/base64"
import {
  canWritePlatformPath,
  isDefaultProjectWorktree,
  platformAuthLoggingOutEvent,
  platformAuthSessionUpdatedEvent,
  platformWorkspaceCacheClearedEvent,
  storedPlatformAuthSession,
} from "@/utils/platform-auth"
import { consumePendingAction, peekPendingAction } from "@/workbench/pending-action"
import {
  requestSharedCaseFork,
  SharedCaseForkBanner,
  SharedCaseForkConfirmDialog,
} from "@/pages/onescience-case-fork"
import { SessionEnvironmentBar } from "@/components/onescience/SessionEnvironmentBar"
import { SessionRawDataChips } from "@/pages/session/composer/session-raw-data-chips"
import {
  inferSessionBoundEnvironment,
  runtimeEnvironmentFor,
  runtimeEnvironmentRevision,
  sessionBoundEnvironmentRevision,
  sessionEnvironmentMismatch,
} from "@/components/onescience/runtime-environment"
import { remoteWorkspaceFor, remoteWorkspaceRevision, boundWorkspaceID } from "@/components/onescience/remote-workspace"

export function SessionComposerRegion(props: {
  state: SessionComposerState
  ready: boolean
  centered: boolean
  inputRef: (el: HTMLDivElement) => void
  newSessionWorktree: string
  onNewSessionWorktreeReset: () => void
  onSubmit: () => void
  onResponseSubmit: () => void
  followup?: {
    queue: () => boolean
    items: { id: string; text: string }[]
    sending?: string
    edit?: { id: string; prompt: FollowupDraft["prompt"]; context: FollowupDraft["context"] }
    onQueue: (draft: FollowupDraft) => void
    onAbort: () => void
    onSend: (id: string) => void
    onEdit: (id: string) => void
    onEditLoaded: () => void
  }
  revert?: {
    items: { id: string; text: string }[]
    restoring?: string
    disabled?: boolean
    onRestore: (id: string) => void
  }
  setPromptDockRef: (el: HTMLDivElement) => void
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const layout = useLayout()
  const dialog = useDialog()
  const prompt = usePrompt()
  const language = useLanguage()
  const server = useServer()
  const globalSync = useGlobalSync()
  const route = useSessionKey()
  const sync = useSync()
  const view = layout.view(route.sessionKey)
  const [forking, setForking] = createSignal(false)
  const [authEpoch, setAuthEpoch] = createSignal(0)

  const handoffPrompt = createMemo(() => getSessionHandoff(route.sessionKey())?.prompt)
  const info = createMemo(() => (route.params.id ? sync.session.get(route.params.id) : undefined))
  const parentID = createMemo(() => info()?.parentID)
  const child = createMemo(() => !!parentID())
  const projectDirectory = createMemo(() => decode64(route.params.dir) ?? "")
  const sharedReadonly = createMemo(() =>
    isSharedCodeCatalogDirectory(
      projectDirectory(),
      storedPlatformAuthSession(),
      configuredCodeDefaultDirectory(document, globalSync.data.path),
    ),
  )
  const loggedOut = createMemo(() => {
    authEpoch()
    return !storedPlatformAuthSession()
  })
  const composerBlocked = createMemo(() => {
    if (loggedOut()) return true
    const session = storedPlatformAuthSession()
    if (!session) return true
    const directory = projectDirectory()
    if (isDefaultProjectWorktree(directory)) return false
    return sharedReadonly() || !canWritePlatformPath(session, directory)
  })
  const environmentMismatch = createMemo(() => {
    runtimeEnvironmentRevision()
    sessionBoundEnvironmentRevision()
    remoteWorkspaceRevision()
    const directory = projectDirectory()
    const sessionID = route.params.id
    if (!directory || !sessionID) return false
    const messages = sync.data.message[sessionID] ?? []
    return sessionEnvironmentMismatch(
      inferSessionBoundEnvironment({
        sessionID,
        messages,
        partsByMessage: sync.data.part,
        sessionWorkspaceID: sync.session.get(sessionID)?.workspaceID,
        binding: remoteWorkspaceFor(directory),
      }),
      runtimeEnvironmentFor(directory),
    )
  })
  const remoteDisconnected = createMemo(() => {
    runtimeEnvironmentRevision()
    remoteWorkspaceRevision()
    const directory = projectDirectory()
    if (!directory) return false
    return runtimeEnvironmentFor(directory).kind === "ssh" && !boundWorkspaceID(directory)
  })
  const showComposer = createMemo(() => !props.state.blocked() || child())

  const showForkConfirm = (onConfirm: () => Promise<void>) => {
    dialog.show(() => (
      <SharedCaseForkConfirmDialog
        onConfirm={async () => {
          setForking(true)
          try {
            await onConfirm()
          } finally {
            setForking(false)
          }
        }}
      />
    ))
  }

  const requestFork = () => {
    requestSharedCaseFork({
      sessionId: route.params.id,
      serverUrl: server.current?.http.url,
      redirect: `${location.pathname}${location.search}${location.hash}`,
      navigate,
      openProject: (directory) => layout.projects.open(directory),
      showConfirm: showForkConfirm,
    })
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

    const action = peekPendingAction()
    if (action?.type !== "fork") return
    if (action.sessionId !== route.params.id) return
    if (!storedPlatformAuthSession()) return
    consumePendingAction()
    queueMicrotask(() => requestFork())
  })

  const previewPrompt = () =>
    prompt
      .current()
      .map((part) => {
        if (part.type === "file") return `[file:${part.path}]`
        if (part.type === "agent") return `@${part.name}`
        if (part.type === "image") return `[image:${part.filename}]`
        return part.content
      })
      .join("")
      .trim()

  createEffect(() => {
    if (!prompt.ready()) return
    setSessionHandoff(route.sessionKey(), { prompt: previewPrompt() })
  })

  const [store, setStore] = createStore({
    ready: false,
    height: 320,
    body: undefined as HTMLDivElement | undefined,
  })
  let timer: number | undefined
  let frame: number | undefined

  const clear = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timer = undefined
    }
    if (frame !== undefined) {
      cancelAnimationFrame(frame)
      frame = undefined
    }
  }

  createEffect(() => {
    route.sessionKey()
    const ready = props.ready
    const delay = 140

    clear()
    setStore("ready", false)
    if (!ready) return

    frame = requestAnimationFrame(() => {
      frame = undefined
      timer = window.setTimeout(() => {
        setStore("ready", true)
        timer = undefined
      }, delay)
    })
  })

  onCleanup(clear)

  const open = createMemo(() => store.ready && props.state.dock() && !props.state.closing())
  const progress = useSpring(() => (open() ? 1 : 0), { visualDuration: 0.3, bounce: 0 })
  const value = createMemo(() => Math.max(0, Math.min(1, progress())))
  const dock = createMemo(() => (store.ready && props.state.dock()) || value() > 0.001)
  const rolled = createMemo(() => (props.revert?.items.length ? props.revert : undefined))
  const lift = createMemo(() => (rolled() ? 18 : 36 * value()))
  const full = createMemo(() => Math.max(78, store.height))

  const openParent = () => {
    const id = parentID()
    if (!id) return
    if (!route.params.dir) return
    navigate(sessionHrefForPath(location.pathname, route.params.dir, id))
  }

  createEffect(() => {
    const el = store.body
    if (!el) return
    const update = () => setStore("height", el.getBoundingClientRect().height)
    createResizeObserver(store.body, update)
    update()
  })

  return (
    <div
      ref={props.setPromptDockRef}
      data-component="session-prompt-dock"
      class="shrink-0 w-full pb-3 flex flex-col justify-center items-center bg-background-stronger pointer-events-none"
    >
      <div
        classList={{
          "w-full px-3 pointer-events-auto": true,
          "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered,
        }}
      >
        <Show when={props.state.questionRequest()} keyed>
          {(request) => (
            <div>
              <SessionQuestionDock request={request} onSubmit={props.onResponseSubmit} />
            </div>
          )}
        </Show>

        <Show when={props.state.permissionRequest()} keyed>
          {(request) => (
            <div>
              <SessionPermissionDock
                request={request}
                responding={props.state.permissionResponding()}
                onDecide={(response) => {
                  props.onResponseSubmit()
                  props.state.decide(response)
                }}
              />
            </div>
          )}
        </Show>

        <Show when={showComposer()}>
          <Show
            when={prompt.ready()}
            fallback={
              <>
                <Show when={rolled()} keyed>
                  {(revert) => (
                    <div class="pb-2">
                      <SessionRevertDock
                        items={revert.items}
                        restoring={revert.restoring}
                        disabled={revert.disabled}
                        onRestore={revert.onRestore}
                      />
                    </div>
                  )}
                </Show>
                <div class="w-full min-h-32 md:min-h-40 rounded-md border border-border-weak-base bg-background-base/50 px-4 py-3 text-text-weak whitespace-pre-wrap pointer-events-none">
                  {handoffPrompt() || language.t("prompt.loading")}
                </div>
              </>
            }
          >
            <Show when={dock()}>
              <div
                classList={{
                  "overflow-hidden": true,
                  "pointer-events-none": value() < 0.98,
                }}
                style={{
                  "max-height": `${full() * value()}px`,
                }}
              >
                <div ref={(el) => setStore("body", el)}>
                  <SessionTodoDock
                    sessionID={route.params.id}
                    todos={props.state.todos()}
                    collapsed={view.todoCollapsed.get()}
                    onToggle={() => view.todoCollapsed.set(!view.todoCollapsed.get())}
                    collapseLabel={language.t("session.todo.collapse")}
                    expandLabel={language.t("session.todo.expand")}
                    dockProgress={value()}
                  />
                </div>
              </div>
            </Show>
            <Show when={rolled()} keyed>
              {(revert) => (
                <div
                  style={{
                    "margin-top": `${-36 * value()}px`,
                  }}
                >
                  <SessionRevertDock
                    items={revert.items}
                    restoring={revert.restoring}
                    disabled={revert.disabled}
                    onRestore={revert.onRestore}
                  />
                </div>
              )}
            </Show>
            <div
              classList={{
                "relative z-10": true,
              }}
              style={{
                "margin-top": `${-lift()}px`,
              }}
            >
              <Show when={props.followup?.items.length && !environmentMismatch()}>
                <SessionFollowupDock
                  items={props.followup!.items}
                  sending={props.followup!.sending}
                  onSend={props.followup!.onSend}
                  onEdit={props.followup!.onEdit}
                />
              </Show>
              <Show
                when={child()}
                fallback={
                  <Show
                    when={sharedReadonly()}
                    fallback={
                      <>
                        <Show when={loggedOut()}>
                          <div class="os-client-welcome-prompt-empty" role="region" aria-label="登录提示">
                            <div class="os-client-welcome-login-card">
                              <div class="os-client-welcome-login-copy">
                                <strong>登录后开始对话</strong>
                                <p>使用个人工作区与 Agent 协作，管理项目、会话与科研任务。</p>
                              </div>
                              <A
                                href={`/login?redirect=${encodeURIComponent(`${location.pathname}${location.search}${location.hash}`)}`}
                                class="os-client-welcome-login-cta"
                              >
                                去登录
                              </A>
                            </div>
                          </div>
                        </Show>
                        <Show when={!loggedOut() && !props.state.blocked() && !composerBlocked()}>
                          <SessionEnvironmentBar directory={projectDirectory} />
                          <Show when={environmentMismatch()}>
                            <div class="w-full rounded-[12px] border border-border-weak-base bg-background-base p-3 text-16-regular text-text-weak">
                              {language.t("session.environment.mismatch")}
                            </div>
                          </Show>
                          <Show when={!remoteDisconnected() && !environmentMismatch()}>
                            <PromptInput
                              ref={props.inputRef}
                              prepend={<SessionRawDataChips />}
                              newSessionWorktree={props.newSessionWorktree}
                              onNewSessionWorktreeReset={props.onNewSessionWorktreeReset}
                              edit={props.followup?.edit}
                              onEditLoaded={props.followup?.onEditLoaded}
                              shouldQueue={props.followup?.queue}
                              onQueue={props.followup?.onQueue}
                              onAbort={props.followup?.onAbort}
                              onSubmit={props.onSubmit}
                            />
                          </Show>
                        </Show>
                      </>
                    }
                  >
                    <SharedCaseForkBanner
                      inputRef={props.inputRef}
                      disabled={!route.params.id}
                      busy={forking()}
                      onFork={requestFork}
                    />
                  </Show>
                }
              >
                <div
                  ref={props.inputRef}
                  class="w-full rounded-[12px] border border-border-weak-base bg-background-base p-3 text-16-regular text-text-weak"
                >
                  <span>{language.t("session.child.promptDisabled")} </span>
                  <Show when={parentID()}>
                    <button
                      type="button"
                      class="text-text-base transition-colors hover:text-text-strong"
                      onClick={openParent}
                    >
                      {language.t("session.child.backToParent")}
                    </button>
                  </Show>
                </div>
              </Show>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  )
}
