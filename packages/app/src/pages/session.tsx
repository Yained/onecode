import type { Project, UserMessage } from "@opencode-ai/sdk/v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createQuery, skipToken, useMutation, useQueryClient } from "@tanstack/solid-query"
import {
  batch,
  onCleanup,
  Show,
  Match,
  Switch,
  createMemo,
  createEffect,
  createComputed,
  on,
  onMount,
  untrack,
  createResource,
  createSignal,
} from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createMediaQuery } from "@solid-primitives/media"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useLocal } from "@/context/local"
import { selectionFromLines, useFile, type FileSelection, type SelectedLineRange } from "@/context/file"
import { createStore } from "solid-js/store"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Select } from "@opencode-ai/ui/select"
import { Tabs } from "@opencode-ai/ui/tabs"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { previewSelectedLines } from "@opencode-ai/ui/pierre/selection-bridge"
import { Button } from "@opencode-ai/ui/button"
import { showEphemeralToast, showToast } from "@opencode-ai/ui/toast"
import { checksum, base64Encode } from "@opencode-ai/core/util/encode"
import { useSearchParams, useLocation, useNavigate } from "@solidjs/router"
import { codeSessionHref } from "@/app-routes"
import { NewSessionView, SessionHeader } from "@/components/session"
import { useComments } from "@/context/comments"
import { getSessionPrefetch, SESSION_PREFETCH_TTL } from "@/context/global-sync/session-prefetch"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { useTerminal } from "@/context/terminal"
import { type FollowupDraft, sendFollowupDraft } from "@/components/prompt-input/submit"
import {
  handoffRenderKey,
  resolveRuntimeEnvironmentSnapshot,
  runtimeEnvironmentInjection,
  runtimeEnvironmentRevision,
  sessionCondaEnvFor,
  sessionCondaEnvRevision,
} from "@/components/onescience/runtime-environment"
import type { SshTargetOption } from "@/components/onescience/execution-location"
import { currentOpenSshTargetMap } from "@/components/onescience/use-registered-ssh-connectivity"
import { boundWorkspaceID, lastKnownWorkspaceID, isRemoteWorkspaceUserStopped, remoteWorkspaceRevision } from "@/components/onescience/remote-workspace"
import { createSessionComposerState, SessionComposerRegion } from "@/pages/session/composer"
import {
  clearAppliedHandoffTemplate,
  getAppliedHandoffTemplate,
  getSessionHandoff,
  discardSessionHandoffDraft,
  hasSessionHandoffDraft,
  markSessionHandoffDraftApplied,
  sessionHandoffRevision,
  setAppliedHandoffTemplate,
  takeSessionHandoffDraft,
} from "@/pages/session/handoff"
import { markCodeNewSessionIntent } from "@/code-session-navigation"
import { codePanelVisible } from "@/pages/session/code-panel"
import {
  clearPrefillComposerIfNeeded,
  clearStoredCapabilityPrefill,
  clearWorkspacePrompt,
  discardWorkspaceScopedPrefill,
  sameHandoffPrompt,
  workspacePromptText,
} from "@/pages/session/workspace-prompt"
import {
  consumeScenarioWorkflowOpenOnSubmit,
  openRightDock,
} from "@/workbench/right-dock"
import {
  acknowledgeScenarioAssistant,
  beginScenarioRuntimeInstall,
  bindScenarioRunSession,
  confirmScenarioNextStep,
  getScenarioRun,
  handleScenarioRunIdle,
  markScenarioRunStarted,
  registerScenarioContinueHandler,
  resumeScenarioRunAfterParams,
  scenarioRunFieldDefs,
  scenarioRunRevision,
  seedScenarioSessionTitle,
  updateScenarioRunValues,
} from "@/workbench/capabilities/scenario-run"
import { ScenarioMissingParamsDialog } from "@/workbench/capabilities/scenario-missing-params-dialog"
import { ScenarioMissingRuntimeDialog } from "@/workbench/capabilities/scenario-missing-runtime-dialog"
import { ScenarioStepParamsDialog } from "@/workbench/capabilities/scenario-step-params-dialog"
import { scenarioFieldKey } from "@/workbench/capabilities/scenario-catalog"
import {
  createOpenReviewFile,
  createSessionTabs,
  createSizing,
  focusTerminalById,
  shouldFocusTerminalOnKeyDown,
} from "@/pages/session/helpers"
import { MessageTimeline } from "@/pages/session/message-timeline"
import { type DiffStyle, SessionReviewTab, type SessionReviewTabProps } from "@/pages/session/review-tab"
import { useSessionLayout } from "@/pages/session/session-layout"
import { syncSessionModel } from "@/pages/session/session-model-helpers"
import { SessionSidePanel } from "@/pages/session/session-side-panel"
import { TerminalPanel } from "@/pages/session/terminal-panel"
import { useSessionCommands } from "@/pages/session/use-session-commands"
import { useSessionHashScroll } from "@/pages/session/use-session-hash-scroll"
import { syncWorkspaceFiles as refreshWorkspaceFiles } from "@/pages/session/sync-workspace-files"
import { Identifier } from "@/utils/id"
import { firstUserMessageText, isFirstMessageServerTitle, sessionTitle } from "@/utils/session-title"
import { resolveArtifactFilePath } from "@/utils/artifact-image-url"
import { decode64 } from "@/utils/base64"
import { FileOpenProvider } from "@opencode-ai/ui/context"
import { diffs as list } from "@/utils/diffs"
import { Persist, persisted } from "@/utils/persist"
import { extractPromptFromParts } from "@/utils/prompt"
import { same } from "@/utils/same"
import { formatServerError, isSessionNotFoundError } from "@/utils/server-errors"
import { isWorkspaceSessionPath } from "@/workbench/routes"
import { WorkbenchTerminalPortal } from "@/workbench/terminal-host"

const emptyUserMessages: UserMessage[] = []
type FollowupItem = FollowupDraft & { id: string }
type FollowupEdit = Pick<FollowupItem, "id" | "prompt" | "context">
const emptyFollowups: FollowupItem[] = []

type ChangeMode = "git" | "branch" | "turn"
type VcsMode = "git" | "branch"

type SessionHistoryWindowInput = {
  sessionID: () => string | undefined
  messagesReady: () => boolean
  loaded: () => number
  visibleUserMessages: () => UserMessage[]
  historyMore: () => boolean
  historyLoading: () => boolean
  /** Approx JSON size of the last history page (chars). Fat pages abort multi-page drain. */
  lastHistoryPageChars: () => number
  loadMore: (sessionID: string) => Promise<void>
  /** Clear pagination cursor when older pages have no earlier visible user turns. */
  markComplete: (sessionID: string) => void
  userScrolled: () => boolean
  scroller: () => HTMLDivElement | undefined
}

/**
 * Session history data loader for the virtualized timeline.
 *
 * DOM windowing is handled by @tanstack/solid-virtual in MessageTimeline.
 * This helper only paginates message data from the server and preserves
 * scroll position when older pages are prepended.
 */
function createSessionHistoryWindow(input: SessionHistoryWindowInput) {
  const prefetchCooldownMs = 400
  const prefetchNoGrowthLimit = 2
  /**
   * Click walks older pages until the previous user turn, but with hard budgets.
   * Tiny history payloads still freeze when one AlphaFold turn has hundreds of
   * Shell rows — each page rebuilds the timeline projection on the main thread.
   * Fat pages (old backend) also abort the multi-page drain.
   */
  const openProbePageLimit = 1
  const clickDrainPageLimit = 4
  /** Stop mid-turn drain after this many newly merged messages; click again to continue. */
  const clickDrainMessageLimit = 24
  /** Abort multi-page drain when a single history page exceeds this (raw JSON). */
  const fatHistoryPageChars = 250_000

  const [state, setState] = createStore({
    prefetchUntil: 0,
    prefetchNoGrowth: 0,
    bootstrapAttempts: 0,
    orphanDrainAttempts: 0,
    /** True while probing whether older pages contain a real earlier user turn. */
    probingEarlier: false,
  })

  // Kept for hash-scroll API compatibility; virtualization mounts by viewport.
  const turnStart = createMemo(() => 0)
  const setTurnStart = (_start: number) => {}

  const renderedUserMessages = createMemo(() => input.visibleUserMessages(), emptyUserMessages, {
    equals: same,
  })

  const probingEarlier = createMemo(() => state.probingEarlier)

  const preserveScroll = async (task: () => Promise<void>) => {
    const el = input.scroller()
    if (!el) {
      await task()
      return
    }
    const beforeTop = el.scrollTop
    const beforeHeight = el.scrollHeight
    await task()
    // Wait for virtualizer prepend + ResizeObserver measures. Adjusting scroll on the
    // first frame (while rows still use 72px estimates) leaves absolute rows overlapping
    // until a full refresh remounts with correct sizes.
    const settle = () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve())
        })
      })
    await settle()
    let delta = el.scrollHeight - beforeHeight
    if (delta <= 0) {
      // Measures may land one frame later — try once more before giving up.
      await settle()
      delta = el.scrollHeight - beforeHeight
    }
    if (delta <= 0) return
    el.scrollTop = beforeTop + delta
  }

  const fetchOlderMessages = async (opts?: {
    prefetch?: boolean
    /** Open-time light probe — never markComplete if budget exhausted with cursor left. */
    openProbe?: boolean
    /** User click / bootstrap — may markComplete when no earlier user turn appears. */
    drain?: boolean
  }) => {
    const id = input.sessionID()
    if (!id) return
    if (!input.historyMore() || input.historyLoading()) return

    if (opts?.prefetch) {
      const now = Date.now()
      if (state.prefetchUntil > now) return
      if (state.prefetchNoGrowth >= prefetchNoGrowthLimit) return
      setState("prefetchUntil", now + prefetchCooldownMs)
    }

    const beforeVisible = input.visibleUserMessages().length
    let loaded = input.loaded()
    let added = 0
    const maxPages = opts?.prefetch
      ? 1
      : opts?.openProbe
        ? openProbePageLimit
        : clickDrainPageLimit
    let pages = 0

    await preserveScroll(async () => {
      while (pages < maxPages) {
        pages += 1
        const hadMore = input.historyMore()
        await input.loadMore(id)
        if (input.sessionID() !== id) return

        const nextLoaded = input.loaded()
        const raw = nextLoaded - loaded
        added += raw
        loaded = nextLoaded
        const growth = input.visibleUserMessages().length - beforeVisible

        // Stop when a new user turn appears (the conversation step the user expects).
        if (growth > 0) break
        if (raw <= 0 && !input.historyMore()) break
        // Empty cursor advance (true orphans): keep walking on drain clicks.
        if (raw <= 0 && hadMore && input.historyMore()) {
          if (!opts?.drain) break
          continue
        }
        if (raw <= 0) break
        if (opts?.prefetch || opts?.openProbe) break
        // drain: continue through mid-turn assistants within a hard budget.
        if (!opts?.drain) break
        if (!input.historyMore()) break
        if (added >= clickDrainMessageLimit) break
        // Old backends still ship multi-MB Shell dumps — stop before the next page.
        if (input.lastHistoryPageChars() > fatHistoryPageChars) break
        // Yield so「正在加载…」can paint and Chromium can process input between pages.
        await new Promise<void>((resolve) => setTimeout(resolve, 32))
      }
    })

    // Do not markComplete after a drain that only merged mid-turn assistants —
    // cursor exhaustion alone clears「加载更早」.
    if (opts?.prefetch) {
      setState("prefetchNoGrowth", added > 0 ? 0 : state.prefetchNoGrowth + 1)
    } else if (added > 0 && state.prefetchNoGrowth) {
      setState("prefetchNoGrowth", 0)
    }
  }

  const loadAndReveal = async () => {
    // Explicit button: walk back to the previous user turn (thumbnailized shells).
    await fetchOlderMessages({ drain: true })
  }

  const fillViewport = () => {
    // Disabled: autofilling older history when the viewport is short re-triggers the
    // same freeze path as scroll-up on AlphaFold/Protein sessions.
  }

  const onScrollerScroll = () => {
    // Disabled: scrolling near the top used to prefetch older pages and hang Chromium
    // ("正在加载更早的消息…" → page unresponsive). Load earlier only via the button.
  }

  const bootstrapEmptyTurnLimit = 0

  // Disabled: auto-pulling older pages on assistant-only open races「加载更早」and
  // freezes AlphaFold sessions. Newest-page open already renders assistants; the
  // user walks backward explicitly.
  createEffect(
    on(
      () =>
        [
          input.sessionID(),
          input.messagesReady(),
          input.visibleUserMessages().length,
          input.historyMore(),
          input.historyLoading(),
          state.bootstrapAttempts,
        ] as const,
      ([id, ready, users, more, loading, attempts]) => {
        if (!id || !ready || loading || users > 0 || !more) return
        if (attempts >= bootstrapEmptyTurnLimit) return
        setState("bootstrapAttempts", attempts + 1)
        // Bootstrap needs a user root; allow markComplete only after several empty attempts
        // via the attempt counter, not a 64-page open storm.
        void fetchOlderMessages({ openProbe: true })
      },
      { defer: true },
    ),
  )

  // Disabled: auto-draining older pages when a user turn is already visible re-opens
  // the AlphaFold freeze path (multi-page merge on open). Load earlier is click-only.
  createEffect(
    on(
      () => input.sessionID(),
      () => {
        setState({
          prefetchUntil: 0,
          prefetchNoGrowth: 0,
          bootstrapAttempts: 0,
          orphanDrainAttempts: 0,
          probingEarlier: false,
        })
      },
      { defer: true },
    ),
  )

  return {
    turnStart,
    setTurnStart,
    renderedUserMessages,
    probingEarlier,
    loadAndReveal,
    fillViewport,
    onScrollerScroll,
  }
}

export default function Page() {
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const local = useLocal()
  const file = useFile()
  const sync = useSync()
  const queryClient = useQueryClient()
  const dialog = useDialog()
  const language = useLanguage()
  const sdk = useSDK()
  const settings = useSettings()
  const prompt = usePrompt()

  // Intentionally keyed by the page's project directory (sdk.directory), matching the
  // project-level execution environment — not the per-session worktree directory.
  const environmentSnapshot = () => {
    const snapshot = resolveRuntimeEnvironmentSnapshot({
      directory: sdk.directory,
      ssh: currentOpenSshTargetMap(globalSync.data.config?.ssh) as Record<string, SshTargetOption> | undefined,
      mcp: sync.data.mcp,
    })
    const condaEnv = sessionCondaEnvFor(sdk.directory, snapshot.env)
    return {
      ...snapshot,
      ...(condaEnv ? { condaEnv } : {}),
    }
  }

  const environmentFor = (sessionDirectory: string, sessionID: string) => ({
    scope: `${sessionDirectory}:${sessionID}`,
    resolve: () => {
      try {
        const snapshot = environmentSnapshot()
        return runtimeEnvironmentInjection({
          scope: `${sessionDirectory}:${sessionID}`,
          env: snapshot.env,
          ctx: {
            directory: sdk.directory,
            sshTarget: snapshot.sshTarget,
            scnet: snapshot.scnet,
            condaEnv: snapshot.condaEnv,
          },
        })
      } catch {
        return undefined
      }
    },
  })
  const comments = useComments()
  const terminal = useTerminal()
  const [searchParams, setSearchParams] = useSearchParams<{ prompt?: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const [queuedPromptSubmit, setQueuedPromptSubmit] = createSignal(false)
  const { params, sessionKey, tabs, view } = useSessionLayout()

  const urlPromptParam = () => searchParams.prompt ?? new URLSearchParams(location.search).get("prompt") ?? undefined

  createEffect(
    on(
      () => [prompt.ready(), params.id, urlPromptParam()] as const,
      ([ready, sessionID, text]) => {
        if (!ready || sessionID || !text) return
        prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
        setQueuedPromptSubmit(true)
        setSearchParams({ ...searchParams, prompt: undefined }, { replace: true })
      },
    ),
  )

  const shouldKeepWorkspacePrompt = (dir: string, urlPrompt: string | undefined) => {
    if (urlPrompt) return true
    if (hasSessionHandoffDraft(dir)) return true
    return false
  }

  onCleanup(() => {
    const dir = params.dir
    if (!dir) return
    clearPrefillComposerIfNeeded(prompt, dir, params.id)
  })

  // Clear prefill on leave / re-enter, and when switching dir or session id while the
  // panel stays mounted (visibility-only clears missed workspace Persist leftovers).
  createEffect(
    on(
      () => [codePanelVisible(), params.dir, params.id, urlPromptParam(), sessionHandoffRevision()] as const,
      ([visible, dir, sessionID, urlPrompt], prev) => {
        if (!dir) return
        const wasVisible = prev?.[0]
        const prevDir = prev?.[1]
        const prevSessionID = prev?.[2]
        const visibilityChanged = wasVisible !== visible
        const scopeChanged = prev !== undefined && (prevDir !== dir || prevSessionID !== sessionID)

        if (!visible) {
          if (!visibilityChanged && prev !== undefined) return
          if (!sessionID) {
            const hasUnsentPrefill = untrack(() => {
              const hasSkillPrefill = prompt.context.items().some((item) => item.type === "skill")
              return (
                hasSessionHandoffDraft(dir)
                || workspacePromptText(prompt.current()).trim().length > 0
                || hasSkillPrefill
                || !!urlPrompt
              )
            })
            if (hasUnsentPrefill) {
              markCodeNewSessionIntent(dir)
            }
          }
          clearPrefillComposerIfNeeded(prompt, dir, sessionID, { urlPrompt })
          return
        }

        if (!visibilityChanged && !scopeChanged) return

        // Fresh handoff / URL prompt: keep composer so apply effect can fill it.
        if (shouldKeepWorkspacePrompt(dir, urlPrompt)) return

        // New-session surface without a fresh draft: drop prefill only; keep user drafts.
        if (!sessionID) {
          clearPrefillComposerIfNeeded(prompt, dir, undefined, { urlPrompt })
          return
        }

        // Opened an existing session: drop workspace-scoped prefill only so a later
        // "new session" does not restore the capability prompt from Persist.
        discardWorkspaceScopedPrefill(prompt, dir)
      },
    ),
  )

  createEffect(
    on(
      // Apply handoff only while the code panel is visible.
      () => [prompt.ready(), params.id, params.dir, urlPromptParam(), sessionHandoffRevision(), codePanelVisible()] as const,
      ([ready, sessionID, dir, urlPrompt, _revision, visible]) => {
        if (!ready || !dir || !visible) return
        const draft = takeSessionHandoffDraft(dir)
        if (!draft) return
        // URL ?prompt= wins; otherwise apply handoff on both new and existing sessions.
        if (urlPrompt) {
          discardSessionHandoffDraft(dir)
          return
        }
        let text = draft.prompt
        if (draft.template) {
          const snapshot = environmentSnapshot()
          text = draft.template(snapshot.env, snapshot)
          setAppliedHandoffTemplate(dir, {
            template: draft.template,
            renderedText: text,
            envKey: handoffRenderKey(snapshot.env, snapshot),
          })
        }
        prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
        for (const item of prompt.context.items()) {
          if (item.type === "skill") prompt.context.remove(item.key)
        }
        if (draft.skill) {
          prompt.context.add({
            type: "skill",
            name: draft.skill.name,
            title: draft.skill.title,
          })
        }
        markSessionHandoffDraftApplied(dir, draft.draftSeq)
      },
    ),
  )

  // Re-render a template-based handoff prompt when the runtime environment, conda env,
  // or SSH target map changes, but only while the user has not edited the rendered text.
  createEffect(
    on(
      () =>
        [
          prompt.ready(),
          params.dir,
          params.id,
          runtimeEnvironmentRevision(),
          sessionCondaEnvRevision(),
          sessionHandoffRevision(),
          currentOpenSshTargetMap(globalSync.data.config?.ssh),
        ] as const,
      ([ready, dir, sessionID]) => {
        if (!ready || !dir || sessionID) return
        const applied = getAppliedHandoffTemplate(dir)
        if (!applied) return
        const snapshot = environmentSnapshot()
        const key = handoffRenderKey(snapshot.env, snapshot)
        if (key === applied.envKey) return
        const currentText = workspacePromptText(prompt.current())
        if (!sameHandoffPrompt(currentText, applied.renderedText)) {
          clearAppliedHandoffTemplate(dir)
          return
        }
        const text = applied.template(snapshot.env, snapshot)
        prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
        setAppliedHandoffTemplate(dir, { template: applied.template, renderedText: text, envKey: key })
      },
    ),
  )

  const [ui, setUi] = createStore({
    pendingMessage: undefined as string | undefined,
    reviewSnap: false,
    scrollGesture: 0,
    scroll: {
      overflow: false,
      bottom: true,
      jump: false,
    },
  })

  const composer = createSessionComposerState()

  const workspaceKey = createMemo(() => params.dir ?? "")
  const workspaceTabs = createMemo(() => layout.tabs(workspaceKey))

  createEffect(
    on(
      () => params.id,
      (id, prev) => {
        if (!id) return
        if (prev) return

        const pending = layout.handoff.tabs()
        if (!pending) return
        if (Date.now() - pending.at > 60_000) {
          layout.handoff.clearTabs()
          return
        }

        if (pending.id !== id) return
        layout.handoff.clearTabs()
        if (pending.dir !== (params.dir ?? "")) return

        const from = workspaceTabs().tabs()
        if (from.all.length === 0 && !from.active) return

        const current = tabs().tabs()
        if (current.all.length > 0 || current.active) return

        const all = normalizeTabs(from.all)
        const active = from.active ? normalizeTab(from.active) : undefined
        tabs().setAll(all)
        tabs().setActive(active && all.includes(active) ? active : all[0])

        workspaceTabs().setAll([])
        workspaceTabs().setActive(undefined)
      },
      { defer: true },
    ),
  )

  const isDesktop = createMediaQuery("(min-width: 768px)")
  const size = createSizing()
  const workbenchEmbed = createMemo(() => isWorkspaceSessionPath(location.pathname))
  const desktopReviewOpen = createMemo(() => !workbenchEmbed() && isDesktop() && view().reviewPanel.opened())
  const desktopFileTreeOpen = createMemo(() => !workbenchEmbed() && isDesktop() && layout.fileTree.opened())
  const desktopSidePanelOpen = createMemo(() => desktopReviewOpen() || desktopFileTreeOpen())
  const reviewSessionWidth = createMemo(
    () => `min(${layout.session.width()}px, max(320px, 45%))`,
  )
  const sessionPanelWidth = createMemo(() => {
    if (!desktopSidePanelOpen()) return "100%"
    if (desktopReviewOpen()) return reviewSessionWidth()
    return `calc(100% - ${layout.fileTree.width()}px)`
  })
  const centered = createMemo(() => isDesktop() && !desktopReviewOpen())

  createEffect(() => {
    if (!workbenchEmbed()) return
    if (layout.fileTree.opened()) layout.fileTree.close()
    if (view().reviewPanel.opened()) view().reviewPanel.close()
  })

  function normalizeTab(tab: string) {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }

  function normalizeTabs(list: string[]) {
    const seen = new Set<string>()
    const next: string[] = []
    for (const item of list) {
      const value = normalizeTab(item)
      if (seen.has(value)) continue
      seen.add(value)
      next.push(value)
    }
    return next
  }

  const openReviewPanel = () => {
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
  }

  const expandFileTreeParents = (path: string) => {
    const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "")
    const parts = normalized.split("/").filter(Boolean)
    if (parts.length <= 1) return
    // Absolute unix paths keep a leading empty segment via normalize helpers elsewhere;
    // tree keys are project-relative, so skip drive roots when expanding.
    let acc = ""
    const start = /^[A-Za-z]:$/.test(parts[0] ?? "") ? 1 : 0
    for (let i = start; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : (parts[i] ?? "")
      if (acc) file.tree.expand(acc)
    }
  }

  const openWorkspaceFile = (path: string) => {
    if (workbenchEmbed()) return
    batch(() => {
      openReviewPanel()
      if (!layout.fileTree.opened()) layout.fileTree.open()
      if (layout.fileTree.tab() !== "all") layout.fileTree.setTab("all")
    })
    void (async () => {
      const directory = decode64(params.dir) ?? sdk.directory
      const resolved = await resolveArtifactFilePath({
        sdk: sdk.client,
        directory,
        filePath: path,
      })
      expandFileTreeParents(resolved)
      await file.load(resolved, { force: true })
      const tab = file.tab(resolved)
      void tabs().open(tab)
      tabs().setActive(tab)
    })()
  }

  const info = createMemo(() => (params.id ? sync.session.get(params.id) : undefined))
  const isChildSession = createMemo(() => !!info()?.parentID)
  const diffs = createMemo(() => (params.id ? list(sync.data.session_diff[params.id]) : []))
  const canReview = createMemo(() => !!sync.project)
  const reviewTab = createMemo(() => isDesktop())
  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: reviewTab,
    hasReview: canReview,
  })
  const activeTab = tabState.activeTab
  const activeFileTab = tabState.activeFileTab
  const revertMessageID = createMemo(() => info()?.revert?.messageID)
  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))
  const messagesReady = createMemo(() => {
    const id = params.id
    if (!id) return true
    // Newest-page open may be assistant-only until the user clicks「加载更早」.
    return sync.data.message[id] !== undefined
  })
  const historyMore = createMemo(() => {
    const id = params.id
    if (!id) return false
    return sync.session.history.more(id)
  })
  const historyLoading = createMemo(() => {
    const id = params.id
    if (!id) return false
    return sync.session.history.loading(id)
  })
  const userMessages = createMemo(
    () =>
      (messages().filter((m) => m.role === "user") as UserMessage[]).slice().sort((a, b) => {
        const at = a.time?.created ?? 0
        const bt = b.time?.created ?? 0
        if (at !== bt) return at - bt
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      }),
    emptyUserMessages,
    { equals: same },
  )
  const visibleUserMessages = createMemo(
    () => {
      const revert = revertMessageID()
      if (!revert) return userMessages()
      return userMessages().filter((m) => m.id < revert)
    },
    emptyUserMessages,
    {
      equals: same,
    },
  )
  const lastUserMessage = createMemo(() => visibleUserMessages().at(-1))

  createEffect(() => {
    const tab = activeFileTab()
    if (!tab) return

    const path = file.pathFromTab(tab)
    if (path) void file.load(path)
  })

  createEffect(
    on(
      () => lastUserMessage()?.id,
      () => {
        const msg = lastUserMessage()
        if (!msg) return
        syncSessionModel(local, msg)
      },
    ),
  )

  createEffect(
    on(
      () => ({ dir: params.dir, id: params.id }),
      (next, prev) => {
        if (!prev) return
        if (next.dir === prev.dir && next.id === prev.id) return
        if (prev.id && !next.id) local.session.reset()
      },
      { defer: true },
    ),
  )

  const [store, setStore] = createStore({
    messageId: undefined as string | undefined,
    mobileTab: "session" as "session" | "changes",
    changes: "git" as ChangeMode,
    newSessionWorktree: "main",
    deferRender: false,
  })

  const [followup, setFollowup] = persisted(
    Persist.workspace(sdk.directory, "followup", ["followup.v1"]),
    createStore<{
      items: Record<string, FollowupItem[] | undefined>
      failed: Record<string, string | undefined>
      paused: Record<string, boolean | undefined>
      edit: Record<string, FollowupEdit | undefined>
    }>({
      items: {},
      failed: {},
      paused: {},
      edit: {},
    }),
  )

  createComputed((prev) => {
    const key = sessionKey()
    if (key !== prev) {
      setStore("deferRender", true)
      requestAnimationFrame(() => {
        setTimeout(() => setStore("deferRender", false), 0)
      })
    }
    return key
  }, sessionKey())

  let reviewFrame: number | undefined
  let refreshFrame: number | undefined
  let refreshTimer: number | undefined
  let todoFrame: number | undefined
  let todoTimer: number | undefined
  let diffFrame: number | undefined
  let diffTimer: number | undefined

  createComputed((prev) => {
    const open = desktopReviewOpen()
    if (prev === undefined || prev === open) return open

    if (reviewFrame !== undefined) cancelAnimationFrame(reviewFrame)
    setUi("reviewSnap", true)
    reviewFrame = requestAnimationFrame(() => {
      reviewFrame = undefined
      setUi("reviewSnap", false)
    })
    return open
  }, desktopReviewOpen())

  const turnDiffs = createMemo(() => list(lastUserMessage()?.summary?.diffs))
  const nogit = createMemo(() => !!sync.project && sync.project.vcs !== "git")
  const changesOptions = createMemo<ChangeMode[]>(() => {
    const list: ChangeMode[] = []
    if (sync.project?.vcs === "git") list.push("git")
    if (
      sync.project?.vcs === "git" &&
      sync.data.vcs?.branch &&
      sync.data.vcs?.default_branch &&
      sync.data.vcs.branch !== sync.data.vcs.default_branch
    ) {
      list.push("branch")
    }
    list.push("turn")
    return list
  })
  const mobileChanges = createMemo(() => !isDesktop() && store.mobileTab === "changes")
  const wantsReview = createMemo(() =>
    isDesktop()
      ? desktopFileTreeOpen() || (desktopReviewOpen() && activeTab() === "review")
      : store.mobileTab === "changes",
  )
  const vcsMode = createMemo<VcsMode | undefined>(() => {
    if (store.changes === "git" || store.changes === "branch") return store.changes
  })
  const vcsKey = createMemo(
    () => ["session-vcs", sdk.directory, sync.data.vcs?.branch ?? "", sync.data.vcs?.default_branch ?? ""] as const,
  )
  const vcsQuery = createQuery(() => {
    const mode = vcsMode()
    const enabled = wantsReview() && sync.project?.vcs === "git"

    return {
      queryKey: [...vcsKey(), mode] as const,
      enabled,
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: 60 * 1000,
      queryFn: mode
        ? () =>
            sdk.client.vcs
              .diff({ mode })
              .then((result) => list(result.data))
              .catch((error) => {
                console.debug("[session-review] failed to load vcs diff", { mode, error })
                return []
              })
        : skipToken,
    }
  })
  const refreshVcs = () => void queryClient.invalidateQueries({ queryKey: vcsKey() })
  const syncWorkspaceFiles = () =>
    refreshWorkspaceFiles({
      refreshTree: () => file.tree.refresh(""),
      refreshVcs,
      refreshSessionDiff: params.id ? () => void sync.session.diff(params.id!, { force: true }) : undefined,
    })
  const reviewDiffs = () => {
    if (store.changes === "git" || store.changes === "branch")
      // avoids suspense
      return vcsQuery.isFetched ? (vcsQuery.data ?? []) : []
    return turnDiffs()
  }
  const reviewCount = () => reviewDiffs().length
  const hasReview = () => reviewCount() > 0
  const reviewReady = () => {
    if (store.changes === "git" || store.changes === "branch") return !vcsQuery.isPending
    return true
  }

  const newSessionWorktree = createMemo(() => {
    if (store.newSessionWorktree === "create") return "create"
    const project = sync.project
    if (project && sdk.directory !== project.worktree) return sdk.directory
    return "main"
  })

  const setActiveMessage = (message: UserMessage | undefined) => {
    messageMark = scrollMark
    setStore("messageId", message?.id)
  }

  const anchor = (id: string) => `message-${id}`

  const cursor = () => {
    const root = scroller
    if (!root) return store.messageId

    const box = root.getBoundingClientRect()
    const line = box.top + 100
    const list = [...root.querySelectorAll<HTMLElement>("[data-message-id]")]
      .map((el) => {
        const id = el.dataset.messageId
        if (!id) return

        const rect = el.getBoundingClientRect()
        return { id, top: rect.top, bottom: rect.bottom }
      })
      .filter((item): item is { id: string; top: number; bottom: number } => !!item)

    const shown = list.filter((item) => item.bottom > box.top && item.top < box.bottom)
    const hit = shown.find((item) => item.top <= line && item.bottom >= line)
    if (hit) return hit.id

    const near = [...shown].sort((a, b) => {
      const da = Math.abs(a.top - line)
      const db = Math.abs(b.top - line)
      if (da !== db) return da - db
      return a.top - b.top
    })[0]
    if (near) return near.id

    return list.filter((item) => item.top <= line).at(-1)?.id ?? list[0]?.id ?? store.messageId
  }

  function navigateMessageByOffset(offset: number) {
    const msgs = visibleUserMessages()
    if (msgs.length === 0) return

    const current = store.messageId && messageMark === scrollMark ? store.messageId : cursor()
    const base = current ? msgs.findIndex((m) => m.id === current) : msgs.length
    const currentIndex = base === -1 ? msgs.length : base
    const targetIndex = currentIndex + offset
    if (targetIndex < 0 || targetIndex > msgs.length) return

    if (targetIndex === msgs.length) {
      resumeScroll()
      return
    }

    autoScroll.pause()
    scrollToMessage(msgs[targetIndex], "auto")
  }

  function upsert(next: Project) {
    const list = globalSync.data.project
    sync.set("project", next.id)
    const idx = list.findIndex((item) => item.id === next.id)
    if (idx >= 0) {
      globalSync.set(
        "project",
        list.map((item, i) => (i === idx ? { ...item, ...next } : item)),
      )
      return
    }
    const at = list.findIndex((item) => item.id > next.id)
    if (at >= 0) {
      globalSync.set("project", [...list.slice(0, at), next, ...list.slice(at)])
      return
    }
    globalSync.set("project", [...list, next])
  }

  const gitMutation = useMutation(() => ({
    mutationFn: () => sdk.client.project.initGit(),
    onSuccess: (x) => {
      if (!x.data) return
      upsert(x.data)
    },
    onError: (err) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(err, language.t),
      })
    },
  }))

  function initGit() {
    if (gitMutation.isPending) return
    gitMutation.mutate()
  }

  let inputRef!: HTMLDivElement
  let promptSubmitTimer: number | undefined
  let promptDock: HTMLDivElement | undefined
  let dockHeight = 0
  let scroller: HTMLDivElement | undefined
  let content: HTMLDivElement | undefined
  let scrollMark = 0
  let messageMark = 0

  const scrollGestureWindowMs = 250

  const markScrollGesture = (target?: EventTarget | null) => {
    const root = scroller
    if (!root) return

    const el = target instanceof Element ? target : undefined
    const nested = el?.closest("[data-scrollable]")
    if (nested && nested !== root) return

    setUi("scrollGesture", Date.now())
  }

  const hasScrollGesture = () => Date.now() - ui.scrollGesture < scrollGestureWindowMs

  // Do not read this resource in JSX: that would suspend and blank the session pane.
  createResource(
    () => {
      remoteWorkspaceRevision()
      const directory = sdk.directory
      return [directory, params.id, boundWorkspaceID(directory) ?? "", lastKnownWorkspaceID(directory)] as const
    },
    async ([directory, id, workspaceID, lastKnown]) => {
      if (refreshFrame !== undefined) cancelAnimationFrame(refreshFrame)
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
      refreshFrame = undefined
      refreshTimer = undefined
      if (!id) return

      // F5 clears the live wrk_*. Reconcile will re-bind; do not treat A's empty
      // copy as the transcript or the pane stays blank until the next send.
      if (!workspaceID && lastKnown && !isRemoteWorkspaceUserStopped(directory)) {
        return
      }

      const cached = untrack(() => sync.data.message[id] !== undefined)
      const stale = !cached
        ? false
        : (() => {
            const info = getSessionPrefetch(directory, id)
            // Missing prefetch metadata is not "stale" — avoid stacking force sync on open.
            if (!info) return false
            return Date.now() - info.at > SESSION_PREFETCH_TTL
          })()

      refreshFrame = requestAnimationFrame(() => {
        refreshFrame = undefined
        refreshTimer = window.setTimeout(() => {
          refreshTimer = undefined
          if (params.id !== id) return
          untrack(() => {
            if (stale) void sync.session.sync(id, { force: true })
          })
        }, 0)
      })

      try {
        await sync.session.sync(id, workspaceID ? { force: true } : undefined)
        if (workspaceID) void sync.session.status()
      } catch (error) {
        if (!isSessionNotFoundError(error)) {
          // Dead/leftover SSH routing must not unmount the session chrome.
          console.error("session sync failed", error)
          return
        }
        // First remote send warps after navigate; the session is seeded locally
        // before the leaf has it. Keep the page instead of bouncing to /session.
        if (untrack(() => sync.session.get(id))) return
        const directory = decode64(params.dir) ?? sdk.directory
        // Overlay session URLs must keep the pane. Bouncing to bare /session hides
        // WorkspaceSessionPanel for personal case forks (not writable-as-catalog) and
        // leaves the workbench main area blank. Official cases are browse-only too.
        if (isWorkspaceSessionPath(location.pathname)) {
          console.error("session sync failed", error)
          return
        }
        // Same directory, drop the dead session id (e.g. deleted-then-recreated project).
        // Do not bounce to the account default project.
        const href = location.pathname.startsWith("/code/")
          ? codeSessionHref(directory)
          : `/${base64Encode(directory)}/session`
        navigate(href, { replace: true })
      }
    },
  )

  // After「加载更早」, the in-memory transcript can be huge. Drop it when leaving so
  // the next open remounts from the first page instead of rebuilding the full projection.
  // Bind directory at mount: on project switch, cleanup runs after the route (and
  // sdk.directory) already point at the next project — live directory would compact wrong.
  const boundDirectory = untrack(() => decode64(params.dir) ?? sdk.directory)
  let activeSessionID = untrack(() => params.id)
  createEffect(() => {
    activeSessionID = params.id
  })
  createEffect(
    on(
      () => params.id,
      (id, prev) => {
        if (prev && prev !== id) sync.session.history.compact(prev, boundDirectory)
      },
    ),
  )
  onCleanup(() => {
    if (activeSessionID) sync.session.history.compact(activeSessionID, boundDirectory)
  })

  createEffect(
    on(
      () => {
        const id = params.id
        return [
          sdk.directory,
          id,
          id ? (sync.data.session_status[id]?.type ?? "idle") : "idle",
          id ? composer.blocked() : false,
        ] as const
      },
      ([dir, id, status, blocked]) => {
        if (todoFrame !== undefined) cancelAnimationFrame(todoFrame)
        if (todoTimer !== undefined) window.clearTimeout(todoTimer)
        todoFrame = undefined
        todoTimer = undefined
        if (!id) return
        if (status === "idle" && !blocked) return
        const cached = untrack(() => sync.data.todo[id] !== undefined || globalSync.data.session_todo[id] !== undefined)

        todoFrame = requestAnimationFrame(() => {
          todoFrame = undefined
          todoTimer = window.setTimeout(() => {
            todoTimer = undefined
            if (sdk.directory !== dir || params.id !== id) return
            untrack(() => {
              void sync.session.todo(id, cached ? { force: true } : undefined)
            })
          }, 0)
        })
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => visibleUserMessages().at(-1)?.id,
      (lastId, prevLastId) => {
        if (lastId && prevLastId && lastId > prevLastId) {
          setStore("messageId", undefined)
        }
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      sessionKey,
      () => {
        setStore("messageId", undefined)
        setStore("changes", "git")
        setUi("pendingMessage", undefined)
      },
      { defer: true },
    ),
  )

  const stopVcs = sdk.event.listen((evt) => {
    if (evt.details.type !== "file.watcher.updated") return
    const props =
      typeof evt.details.properties === "object" && evt.details.properties
        ? (evt.details.properties as Record<string, unknown>)
        : undefined
    const file = typeof props?.file === "string" ? props.file : undefined
    if (!file || file.startsWith(".git/")) return
    refreshVcs()
  })
  onCleanup(stopVcs)

  createEffect(
    on(
      () => params.dir,
      (dir) => {
        if (!dir) return
        setStore("newSessionWorktree", "main")
      },
      { defer: true },
    ),
  )

  const selectionPreview = (path: string, selection: FileSelection) => {
    const content = file.get(path)?.content?.content
    if (!content) return undefined
    return previewSelectedLines(content, { start: selection.startLine, end: selection.endLine })
  }

  const addCommentToContext = (input: {
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
    origin?: "review" | "file"
  }) => {
    const selection = selectionFromLines(input.selection)
    const preview = input.preview ?? selectionPreview(input.file, selection)
    const saved = comments.add({
      file: input.file,
      selection: input.selection,
      comment: input.comment,
    })
    prompt.context.add({
      type: "file",
      path: input.file,
      selection,
      comment: input.comment,
      commentID: saved.id,
      commentOrigin: input.origin,
      preview,
    })
  }

  const updateCommentInContext = (input: {
    id: string
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
  }) => {
    comments.update(input.file, input.id, input.comment)
    prompt.context.updateComment(input.file, input.id, {
      comment: input.comment,
      ...(input.preview ? { preview: input.preview } : {}),
    })
  }

  const removeCommentFromContext = (input: { id: string; file: string }) => {
    comments.remove(input.file, input.id)
    prompt.context.removeComment(input.file, input.id)
  }

  const reviewCommentActions = createMemo(() => ({
    moreLabel: language.t("common.moreOptions"),
    editLabel: language.t("common.edit"),
    deleteLabel: language.t("common.delete"),
    saveLabel: language.t("common.save"),
  }))

  const isEditableTarget = (target: EventTarget | null | undefined) => {
    if (!(target instanceof HTMLElement)) return false
    return /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName) || target.isContentEditable
  }

  const deepActiveElement = () => {
    let current: Element | null = document.activeElement
    while (current instanceof HTMLElement && current.shadowRoot?.activeElement) {
      current = current.shadowRoot.activeElement
    }
    return current instanceof HTMLElement ? current : undefined
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    const path = event.composedPath()
    const target = path.find((item): item is HTMLElement => item instanceof HTMLElement)
    const activeElement = deepActiveElement()

    const protectedTarget = path.some(
      (item) => item instanceof HTMLElement && item.closest("[data-prevent-autofocus]") !== null,
    )
    if (protectedTarget || isEditableTarget(target)) return

    if (activeElement) {
      const isProtected = activeElement.closest("[data-prevent-autofocus]")
      const isInput = isEditableTarget(activeElement)
      if (isProtected || isInput) return
    }
    if (dialog.active) return

    if (activeElement === inputRef) {
      if (event.key === "Escape") inputRef?.blur()
      return
    }

    // Prefer the open terminal over the composer when it can take focus
    if (view().terminal.opened()) {
      const id = terminal.active()
      if (id && shouldFocusTerminalOnKeyDown(event) && focusTerminalById(id)) return
    }

    // Only treat explicit scroll keys as potential "user scroll" gestures.
    if (event.key === "PageUp" || event.key === "PageDown" || event.key === "Home" || event.key === "End") {
      markScrollGesture()
      return
    }

    if (event.key.length === 1 && event.key !== "Unidentified" && !(event.ctrlKey || event.metaKey)) {
      if (composer.blocked() || isChildSession()) return
      inputRef?.focus()
    }
  }

  createEffect(() => {
    const list = changesOptions()
    if (list.includes(store.changes)) return
    const next = list[0]
    if (!next) return
    setStore("changes", next)
  })

  createEffect(
    on(
      () => sync.data.session_status[params.id ?? ""]?.type,
      (next, prev) => {
        if (next !== "idle" || prev === undefined || prev === "idle") return
        refreshVcs()
      },
      { defer: true },
    ),
  )

  const fileTreeTab = () => layout.fileTree.tab()
  const setFileTreeTab = (value: "changes" | "all") => layout.fileTree.setTab(value)

  const [tree, setTree] = createStore({
    reviewScroll: undefined as HTMLDivElement | undefined,
    pendingDiff: undefined as string | undefined,
    activeDiff: undefined as string | undefined,
  })

  createEffect(
    on(
      sessionKey,
      () => {
        setTree({
          reviewScroll: undefined,
          pendingDiff: undefined,
          activeDiff: undefined,
        })
      },
      { defer: true },
    ),
  )

  const showAllFiles = () => {
    if (fileTreeTab() !== "changes") return
    setFileTreeTab("all")
  }

  const focusInput = () => {
    if (isChildSession()) return
    inputRef?.focus()
  }

  useSessionCommands({
    navigateMessageByOffset,
    setActiveMessage,
    focusInput,
    review: reviewTab,
    syncWorkspaceFiles,
  })

  const openReviewFile = createOpenReviewFile({
    showAllFiles,
    tabForPath: file.tab,
    openTab: tabs().open,
    setActive: tabs().setActive,
    loadFile: file.load,
  })

  const changesTitle = () => {
    if (!canReview()) {
      return null
    }

    const label = (option: ChangeMode) => {
      if (option === "git") return language.t("ui.sessionReview.title.git")
      if (option === "branch") return language.t("ui.sessionReview.title.branch")
      return language.t("ui.sessionReview.title.lastTurn")
    }

    return (
      <Select
        options={changesOptions()}
        current={store.changes}
        label={label}
        onSelect={(option) => option && setStore("changes", option)}
        variant="ghost"
        size="small"
        valueClass="text-14-medium"
      />
    )
  }

  const empty = (text: string) => (
    <div class="h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6">
      <div class="text-14-regular text-text-weak max-w-56">{text}</div>
    </div>
  )

  const createGit = (input: { emptyClass: string }) => (
    <div class={input.emptyClass}>
      <div class="flex flex-col gap-3">
        <div class="text-14-medium text-text-strong">{language.t("session.review.noVcs.createGit.title")}</div>
        <div class="text-14-regular text-text-base max-w-md" style={{ "line-height": "var(--line-height-normal)" }}>
          {language.t("session.review.noVcs.createGit.description")}
        </div>
      </div>
      <Button size="large" disabled={gitMutation.isPending} onClick={initGit}>
        {gitMutation.isPending
          ? language.t("session.review.noVcs.createGit.actionLoading")
          : language.t("session.review.noVcs.createGit.action")}
      </Button>
    </div>
  )

  const reviewEmptyText = createMemo(() => {
    if (store.changes === "git") return language.t("session.review.noUncommittedChanges")
    if (store.changes === "branch") return language.t("session.review.noBranchChanges")
    return language.t("session.review.noChanges")
  })

  const reviewEmpty = (input: { loadingClass: string; emptyClass: string }) => {
    if (store.changes === "git" || store.changes === "branch") {
      if (!reviewReady()) return <div class={input.loadingClass}>{language.t("session.review.loadingChanges")}</div>
      return empty(reviewEmptyText())
    }

    if (store.changes === "turn") {
      if (nogit()) return createGit(input)
      return empty(reviewEmptyText())
    }

    return (
      <div class={input.emptyClass}>
        <div class="text-14-regular text-text-weak max-w-56">{reviewEmptyText()}</div>
      </div>
    )
  }

  const reviewContent = (input: {
    diffStyle: DiffStyle
    onDiffStyleChange?: (style: DiffStyle) => void
    classes?: SessionReviewTabProps["classes"]
    loadingClass: string
    emptyClass: string
  }) => (
    <Show when={!store.deferRender}>
      <SessionReviewTab
        title={changesTitle()}
        empty={reviewEmpty(input)}
        diffs={reviewDiffs}
        view={view}
        diffStyle={input.diffStyle}
        onDiffStyleChange={input.onDiffStyleChange}
        onScrollRef={(el) => setTree("reviewScroll", el)}
        focusedFile={tree.activeDiff}
        onLineComment={(comment) => addCommentToContext({ ...comment, origin: "review" })}
        onLineCommentUpdate={updateCommentInContext}
        onLineCommentDelete={removeCommentFromContext}
        lineCommentActions={reviewCommentActions()}
        commentMentions={{
          items: file.searchFilesAndDirectories,
        }}
        comments={comments.all()}
        focusedComment={comments.focus()}
        onFocusedCommentChange={comments.setFocus}
        onViewFile={openReviewFile}
        classes={input.classes}
      />
    </Show>
  )

  const reviewPanel = () => (
    <div class="flex flex-col h-full overflow-hidden bg-background-weak contain-strict">
      <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
        {reviewContent({
          diffStyle: layout.review.diffStyle(),
          onDiffStyleChange: layout.review.setDiffStyle,
          loadingClass: "px-6 py-4 text-text-weak",
          emptyClass: "h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6",
        })}
      </div>
    </div>
  )

  createEffect(
    on(
      activeFileTab,
      (active) => {
        if (!active) return
        if (fileTreeTab() !== "changes") return
        showAllFiles()
      },
      { defer: true },
    ),
  )

  const reviewDiffId = (path: string) => {
    const sum = checksum(path)
    if (!sum) return
    return `session-review-diff-${sum}`
  }

  const reviewDiffTop = (path: string) => {
    const root = tree.reviewScroll
    if (!root) return

    const id = reviewDiffId(path)
    if (!id) return

    const el = document.getElementById(id)
    if (!(el instanceof HTMLElement)) return
    if (!root.contains(el)) return

    const a = el.getBoundingClientRect()
    const b = root.getBoundingClientRect()
    return a.top - b.top + root.scrollTop
  }

  const scrollToReviewDiff = (path: string) => {
    const root = tree.reviewScroll
    if (!root) return false

    const top = reviewDiffTop(path)
    if (top === undefined) return false

    view().setScroll("review", { x: root.scrollLeft, y: top })
    root.scrollTo({ top, behavior: "auto" })
    return true
  }

  const focusReviewDiff = (path: string) => {
    openReviewPanel()
    view().review.openPath(path)
    setTree({ activeDiff: path, pendingDiff: path })
  }

  createEffect(() => {
    const pending = tree.pendingDiff
    if (!pending) return
    if (!tree.reviewScroll) return
    if (!reviewReady()) return

    const attempt = (count: number) => {
      if (tree.pendingDiff !== pending) return
      if (count > 60) {
        setTree("pendingDiff", undefined)
        return
      }

      const root = tree.reviewScroll
      if (!root) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      if (!scrollToReviewDiff(pending)) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      const top = reviewDiffTop(pending)
      if (top === undefined) {
        requestAnimationFrame(() => attempt(count + 1))
        return
      }

      if (Math.abs(root.scrollTop - top) <= 1) {
        setTree("pendingDiff", undefined)
        return
      }

      requestAnimationFrame(() => attempt(count + 1))
    }

    requestAnimationFrame(() => attempt(0))
  })

  createEffect(() => {
    const id = params.id
    if (!id) return

    if (!wantsReview()) return
    if (sync.data.session_diff[id] !== undefined) return
    if (sync.status === "loading") return

    void sync.session.diff(id)
  })

  createEffect(
    on(
      () => [sessionKey(), wantsReview()] as const,
      ([key, wants]) => {
        if (diffFrame !== undefined) cancelAnimationFrame(diffFrame)
        if (diffTimer !== undefined) window.clearTimeout(diffTimer)
        diffFrame = undefined
        diffTimer = undefined
        if (!wants) return

        const id = params.id
        if (!id) return
        if (!untrack(() => sync.data.session_diff[id] !== undefined)) return

        diffFrame = requestAnimationFrame(() => {
          diffFrame = undefined
          diffTimer = window.setTimeout(() => {
            diffTimer = undefined
            if (sessionKey() !== key) return
            void sync.session.diff(id, { force: true })
          }, 0)
        })
      },
      { defer: true },
    ),
  )

  let treeDir: string | undefined
  createEffect(() => {
    const dir = sdk.directory
    if (!isDesktop()) return
    if (!layout.fileTree.opened()) return
    if (sync.status === "loading") return

    fileTreeTab()
    const refresh = treeDir !== dir
    treeDir = dir
    void (refresh ? file.tree.refresh("") : file.tree.list(""))
  })

  createEffect(
    on(
      () => sdk.directory,
      () => {
        const tab = activeFileTab()
        if (!tab) return
        const path = file.pathFromTab(tab)
        if (!path) return
        void file.load(path, { force: true })
      },
      { defer: true },
    ),
  )

  const autoScroll = createAutoScroll({
    working: () => true,
    overflowAnchor: "dynamic",
  })

  let scrollStateFrame: number | undefined
  let scrollStateTarget: HTMLDivElement | undefined
  let fillFrame: number | undefined

  const jumpThreshold = (el: HTMLDivElement) => Math.max(400, el.clientHeight)

  const updateScrollState = (el: HTMLDivElement) => {
    const max = el.scrollHeight - el.clientHeight
    const distance = max - el.scrollTop
    const overflow = max > 1
    const bottom = !overflow || distance <= 2
    const jump = overflow && distance > jumpThreshold(el)

    if (ui.scroll.overflow === overflow && ui.scroll.bottom === bottom && ui.scroll.jump === jump) return
    setUi("scroll", { overflow, bottom, jump })
  }

  const scheduleScrollState = (el: HTMLDivElement) => {
    scrollStateTarget = el
    if (scrollStateFrame !== undefined) return

    scrollStateFrame = requestAnimationFrame(() => {
      scrollStateFrame = undefined

      const target = scrollStateTarget
      scrollStateTarget = undefined
      if (!target) return

      updateScrollState(target)
    })
  }

  const resumeScroll = () => {
    setStore("messageId", undefined)
    autoScroll.forceScrollToBottom()
    clearMessageHash()

    const el = scroller
    if (el) scheduleScrollState(el)
  }

  // When the user returns to the bottom, treat the active message as "latest".
  createEffect(
    on(
      autoScroll.userScrolled,
      (scrolled) => {
        if (scrolled) return
        setStore("messageId", undefined)
        clearMessageHash()
      },
      { defer: true },
    ),
  )

  let fill = () => {}

  const setScrollRef = (el: HTMLDivElement | undefined) => {
    scroller = el
    autoScroll.scrollRef(el)
    if (!el) return
    scheduleScrollState(el)
    fill()
  }

  const markUserScroll = () => {
    scrollMark += 1
  }

  createResizeObserver(
    () => content,
    () => {
      const el = scroller
      if (el) scheduleScrollState(el)
      fill()
    },
  )

  const historyWindow = createSessionHistoryWindow({
    sessionID: () => params.id,
    messagesReady,
    loaded: () => messages().length,
    visibleUserMessages,
    historyMore,
    historyLoading,
    lastHistoryPageChars: () => (params.id ? sync.session.history.lastPageChars(params.id) : 0),
    loadMore: (sessionID) => sync.session.history.loadMore(sessionID),
    markComplete: (sessionID) => sync.session.history.markComplete(sessionID),
    userScrolled: autoScroll.userScrolled,
    scroller: () => scroller,
  })
  const showLoadEarlier = createMemo(() => historyMore() && !historyWindow.probingEarlier())

  fill = () => {
    if (fillFrame !== undefined) return

    fillFrame = requestAnimationFrame(() => {
      fillFrame = undefined

      if (!params.id || !messagesReady()) return
      if (autoScroll.userScrolled() || historyLoading()) return
      if (visibleUserMessages().length === 0) return

      const el = scroller
      if (!el) return
      if (el.scrollHeight > el.clientHeight + 1) return
      if (!historyMore()) return

      historyWindow.fillViewport()
    })
  }

  createEffect(
    on(
      () => [params.id, messagesReady()] as const,
      ([id, ready], prev) => {
        if (!id || !ready) return
        // Only pin to the end on first ready for this session — not after「加载更早」.
        if (prev && prev[0] === id && prev[1]) return
        requestAnimationFrame(() => autoScroll.forceScrollToBottom())
      },
    ),
  )

  createEffect(
    on(
      () =>
        [
          params.id,
          messagesReady(),
          historyMore(),
          historyLoading(),
          autoScroll.userScrolled(),
          visibleUserMessages().length,
        ] as const,
      ([id, ready, more, loading, scrolled]) => {
        if (!id || !ready || loading || scrolled) return
        if (!more) return
        fill()
      },
      { defer: true },
    ),
  )

  const draft = (id: string) =>
    extractPromptFromParts(sync.data.part[id] ?? [], {
      directory: sdk.directory,
      attachmentName: language.t("common.attachment"),
    })

  const line = (id: string) => {
    const text = draft(id)
      .map((part) => (part.type === "image" ? `[image:${part.filename}]` : part.content))
      .join("")
      .replace(/\s+/g, " ")
      .trim()
    if (text) return text
    return `[${language.t("common.attachment")}]`
  }

  const fail = (err: unknown) => {
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: formatServerError(err, language.t),
    })
  }

  const merge = (next: NonNullable<ReturnType<typeof info>>) =>
    sync.set("session", (list) => {
      const idx = list.findIndex((item) => item.id === next.id)
      if (idx < 0) return list
      const out = list.slice()
      out[idx] = next
      return out
    })

  const roll = (sessionID: string, next: NonNullable<ReturnType<typeof info>>["revert"]) =>
    sync.set("session", (list) => {
      const idx = list.findIndex((item) => item.id === sessionID)
      if (idx < 0) return list
      const out = list.slice()
      out[idx] = { ...out[idx], revert: next }
      return out
    })

  const busy = (sessionID: string) => sync.data.session_working(sessionID)

  const queuedFollowups = createMemo(() => {
    const id = params.id
    if (!id) return emptyFollowups
    return followup.items[id] ?? emptyFollowups
  })

  const editingFollowup = createMemo(() => {
    const id = params.id
    if (!id) return
    return followup.edit[id]
  })

  const followupMutation = useMutation(() => ({
    mutationFn: async (input: { sessionID: string; id: string; manual?: boolean }) => {
      const item = (followup.items[input.sessionID] ?? []).find((entry) => entry.id === input.id)
      if (!item) return

      if (input.manual) setFollowup("paused", input.sessionID, undefined)
      setFollowup("failed", input.sessionID, undefined)

      const ok = await sendFollowupDraft({
        client: sdk.client,
        sync,
        globalSync,
        language,
        draft: item,
        optimisticBusy: item.sessionDirectory === sdk.directory,
        environment: environmentFor(item.sessionDirectory, input.sessionID),
        onSessionMissing: async () => {
          const workspaceID = boundWorkspaceID(sdk.directory)
          if (!workspaceID) return false
          try {
            await sdk.client.experimental.workspace.warp({
              directory: sdk.directory,
              id: workspaceID,
              sessionID: input.sessionID,
              copyChanges: false,
            })
            return true
          } catch {
            return false
          }
        },
      }).catch((err) => {
        setFollowup("failed", input.sessionID, input.id)
        fail(err)
        return false
      })
      if (!ok) return

      setFollowup("items", input.sessionID, (items) => (items ?? []).filter((entry) => entry.id !== input.id))
      if (input.manual) resumeScroll()
    },
  }))

  const followupBusy = (sessionID: string) =>
    followupMutation.isPending && followupMutation.variables?.sessionID === sessionID

  const sendingFollowup = createMemo(() => {
    const id = params.id
    if (!id) return
    if (!followupBusy(id)) return
    return followupMutation.variables?.id
  })

  const queueEnabled = createMemo(() => {
    const id = params.id
    if (!id) return false
    return settings.general.followup() === "queue" && busy(id) && !composer.blocked() && !isChildSession()
  })

  const followupText = (item: FollowupDraft) => {
    const text = item.prompt
      .map((part) => {
        if (part.type === "image") return `[image:${part.filename}]`
        if (part.type === "file") return `[file:${part.path}]`
        if (part.type === "agent") return `@${part.name}`
        return part.content
      })
      .join("")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => !!line)

    if (text) return text
    return `[${language.t("common.attachment")}]`
  }

  const queueFollowup = (draft: FollowupDraft) => {
    setFollowup("items", draft.sessionID, (items) => [
      ...(items ?? []),
      { id: Identifier.ascending("message"), ...draft },
    ])
    setFollowup("failed", draft.sessionID, undefined)
    setFollowup("paused", draft.sessionID, undefined)
  }

  const followupDock = createMemo(() => queuedFollowups().map((item) => ({ id: item.id, text: followupText(item) })))

  const sendFollowup = (sessionID: string, id: string, opts?: { manual?: boolean }) => {
    if (sync.session.get(sessionID)?.parentID) return Promise.resolve()
    const item = (followup.items[sessionID] ?? []).find((entry) => entry.id === id)
    if (!item) return Promise.resolve()
    if (followupBusy(sessionID)) return Promise.resolve()

    return followupMutation.mutateAsync({ sessionID, id, manual: opts?.manual })
  }

  const editFollowup = (id: string) => {
    const sessionID = params.id
    if (!sessionID) return
    if (followupBusy(sessionID)) return

    const item = queuedFollowups().find((entry) => entry.id === id)
    if (!item) return

    setFollowup("items", sessionID, (items) => (items ?? []).filter((entry) => entry.id !== id))
    setFollowup("failed", sessionID, (value) => (value === id ? undefined : value))
    setFollowup("edit", sessionID, {
      id: item.id,
      prompt: item.prompt,
      context: item.context,
    })
  }

  const clearFollowupEdit = () => {
    const id = params.id
    if (!id) return
    setFollowup("edit", id, undefined)
  }

  const halt = (sessionID: string) => {
    if (!busy(sessionID)) return Promise.resolve()
    sync.set("session_status", sessionID, { type: "idle" })
    return sdk.client.session.abort({ sessionID }).catch(() => {})
  }

  const revertMutation = useMutation(() => ({
    mutationFn: async (input: { sessionID: string; messageID: string }) => {
      const prev = prompt.current().slice()
      const last = info()?.revert
      const value = draft(input.messageID)
      batch(() => {
        roll(input.sessionID, { messageID: input.messageID })
        prompt.set(value)
      })
      await halt(input.sessionID)
        .then(() => sdk.client.session.revert(input))
        .then((result) => {
          if (result.data) merge(result.data)
        })
        .catch((err) => {
          batch(() => {
            roll(input.sessionID, last)
            prompt.set(prev)
          })
          fail(err)
        })
    },
  }))

  const restoreMutation = useMutation(() => ({
    mutationFn: async (id: string) => {
      const sessionID = params.id
      if (!sessionID) return

      const next = userMessages().find((item) => item.id > id)
      const prev = prompt.current().slice()
      const last = info()?.revert

      batch(() => {
        roll(sessionID, next ? { messageID: next.id } : undefined)
        if (next) {
          prompt.set(draft(next.id))
          return
        }
        prompt.reset()
      })

      const task = !next
        ? halt(sessionID).then(() => sdk.client.session.unrevert({ sessionID }))
        : halt(sessionID).then(() =>
            sdk.client.session.revert({
              sessionID,
              messageID: next.id,
            }),
          )

      await task
        .then((result) => {
          if (result.data) merge(result.data)
        })
        .catch((err) => {
          batch(() => {
            roll(sessionID, last)
            prompt.set(prev)
          })
          fail(err)
        })
    },
  }))

  const reverting = createMemo(() => revertMutation.isPending || restoreMutation.isPending)
  const restoring = createMemo(() => (restoreMutation.isPending ? restoreMutation.variables : undefined))

  const revert = (input: { sessionID: string; messageID: string }) => {
    if (reverting()) return
    return revertMutation.mutateAsync(input)
  }

  const restore = (id: string) => {
    if (!params.id || reverting()) return
    return restoreMutation.mutateAsync(id)
  }

  const rolled = createMemo(() => {
    const id = revertMessageID()
    if (!id) return []
    return userMessages()
      .filter((item) => item.id >= id)
      .map((item) => ({ id: item.id, text: line(item.id) }))
  })

  const actions = { revert }

  createEffect(() => {
    const sessionID = params.id
    if (!sessionID) return

    const item = queuedFollowups()[0]
    if (!item) return
    if (followupBusy(sessionID)) return
    if (followup.failed[sessionID] === item.id) return
    if (followup.paused[sessionID]) return
    if (isChildSession()) return
    if (composer.blocked()) return
    if (busy(sessionID)) return

    void sendFollowup(sessionID, item.id)
  })

  createEffect(() => {
    const dir = params.dir
    const sessionID = params.id
    if (!dir || !sessionID) return
    onCleanup(
      registerScenarioContinueHandler((input) => {
        if (input.directoryKey !== dir) return
        const model = local.model.current()
        const agent = local.agent.current()
        if (!model || !agent) return
        const messages = sync.data.message[sessionID] ?? []
        const assistant = [...messages]
          .reverse()
          .find((item) => item.role === "assistant" && typeof item.time.completed === "number")
        if (assistant) acknowledgeScenarioAssistant(dir, assistant.id)
        queueFollowup({
          sessionID,
          sessionDirectory: sdk.directory,
          prompt: [{ type: "text", content: input.prompt, start: 0, end: input.prompt.length }],
          context: [],
          agent: agent.name,
          model: { providerID: model.provider.id, modelID: model.id },
          variant: local.model.variant.current(),
        })
      }),
    )
  })

  createEffect(() => {
    scenarioRunRevision()
    const dir = params.dir
    if (!dir) return
    // First landing after scenario create: open todo dock without waiting for Send.
    if (!getScenarioRun(dir)?.openOnSubmit) return
    consumeScenarioWorkflowOpenOnSubmit(dir)
    openRightDock("todo")
  })

  createEffect(() => {
    const dir = params.dir
    const sessionID = params.id
    if (!dir || !sessionID) return
    const run = getScenarioRun(dir)
    if (!run?.title.trim() || run.titleSeeded) return
    // Only replace after the title model fails. Failure writes the first message
    // (truncated to 100). A real summary does not match that string, so leave it.
    const current = sessionTitle(sync.session.get(sessionID)?.title)
    if (!current) return
    const first = firstUserMessageText(sessionID, sync.data.message, sync.data.part)
    if (!isFirstMessageServerTitle(current, first)) return
    seedScenarioSessionTitle(dir, sessionID, (title) => sdk.client.session.update({ sessionID, title }))
  })

  createEffect(() => {
    scenarioRunRevision()
    const dir = params.dir
    const sessionID = params.id
    if (!dir || !sessionID) return
    const run = getScenarioRun(dir)
    if (!run || run.phase !== "running") return
    bindScenarioRunSession(dir, sessionID)
    if (isChildSession()) return
    if (composer.blocked()) return
    if (busy(sessionID)) return
    if (followupBusy(sessionID)) return

    const messages = sync.data.message[sessionID] ?? []
    const assistant = [...messages]
      .reverse()
      .find((item) => item.role === "assistant" && typeof item.time.completed === "number")
    if (!assistant) return
    const text = (sync.data.part[assistant.id] ?? [])
      .map((part) => (part.type === "text" && "text" in part ? String(part.text ?? "") : ""))
      .join("\n")
      .trim()
    if (!text) return

    const result = handleScenarioRunIdle(dir, {
      assistantMessageID: assistant.id,
      assistantText: text,
    })

    if (result.action === "ignore") return

    if (result.action === "stop") {
      showEphemeralToast({ variant: "error", title: "场景工作流已暂停", description: result.reason })
      return
    }

    if (result.action === "done") {
      showEphemeralToast({ variant: "success", title: "场景工作流已全部完成" })
      return
    }

    if (result.action === "confirm_next") {
      showEphemeralToast({ title: "请确认下一步参数", description: result.stepName })
      dialog.show(() => (
        <ScenarioStepParamsDialog
          title="确认下一步参数"
          reason={`下一步「${result.stepName}」可按需调整参数，确认后将自动发送并执行。`}
          stepName={result.stepName}
          fields={result.fields}
          values={result.values}
          mode="confirm"
          firstDecision={result.firstDecision}
          onConfirm={(input) => {
            const confirmed = confirmScenarioNextStep(dir, input)
            if (!confirmed) return
            const model = local.model.current()
            const agent = local.agent.current()
            if (!model || !agent) return
            const messages = sync.data.message[sessionID] ?? []
            const latestAssistant = [...messages]
              .reverse()
              .find((item) => item.role === "assistant" && typeof item.time.completed === "number")
            if (latestAssistant) acknowledgeScenarioAssistant(dir, latestAssistant.id)
            queueFollowup({
              sessionID,
              sessionDirectory: sdk.directory,
              prompt: [{ type: "text", content: confirmed.prompt, start: 0, end: confirmed.prompt.length }],
              context: [],
              agent: agent.name,
              model: { providerID: model.provider.id, modelID: model.id },
              variant: local.model.variant.current(),
            })
            showEphemeralToast({
              title:
                input.mode === "auto"
                  ? `连续执行后续步骤：${confirmed.stepName}`
                  : `继续执行：${confirmed.stepName}`,
            })
          }}
        />
      ))
      return
    }

    if (result.action === "need_params") {
      const latest = getScenarioRun(dir)
      if (!latest) return
      const defs = scenarioRunFieldDefs(latest)
      const fields = result.keys.length
        ? defs.filter((field) => result.keys.includes(scenarioFieldKey(field)))
        : defs.filter((field) => !String(latest.values[scenarioFieldKey(field)] ?? "").trim())
      showEphemeralToast({ title: "需要补充参数", description: result.reason })
      dialog.show(() => (
        <ScenarioMissingParamsDialog
          reason={result.reason}
          fields={fields.length ? fields : defs}
          values={latest.values}
          onConfirm={(values) => {
            updateScenarioRunValues(dir, values)
            const resumed = resumeScenarioRunAfterParams(dir)
            if (!resumed) return
            const model = local.model.current()
            const agent = local.agent.current()
            if (!model || !agent) return
            const messages = sync.data.message[sessionID] ?? []
            const latestAssistant = [...messages]
              .reverse()
              .find((item) => item.role === "assistant" && typeof item.time.completed === "number")
            if (latestAssistant) acknowledgeScenarioAssistant(dir, latestAssistant.id)
            queueFollowup({
              sessionID,
              sessionDirectory: sdk.directory,
              prompt: [{ type: "text", content: resumed.prompt, start: 0, end: resumed.prompt.length }],
              context: [],
              agent: agent.name,
              model: { providerID: model.provider.id, modelID: model.id },
              variant: local.model.variant.current(),
            })
          }}
        />
      ))
      return
    }

    if (result.action === "need_runtime") {
      showEphemeralToast({ title: "缺少运行环境", description: result.reason })
      dialog.show(() => (
        <ScenarioMissingRuntimeDialog
          reason={result.reason}
          resourceIds={result.resourceIds}
          onConfirm={(resourceIds) => {
            const install = beginScenarioRuntimeInstall(dir, resourceIds)
            if (!install) return
            const model = local.model.current()
            const agent = local.agent.current()
            if (!model || !agent) return
            queueFollowup({
              sessionID,
              sessionDirectory: sdk.directory,
              prompt: [{ type: "text", content: install.prompt, start: 0, end: install.prompt.length }],
              context: [],
              agent: agent.name,
              model: { providerID: model.provider.id, modelID: model.id },
              variant: local.model.variant.current(),
            })
            showEphemeralToast({ title: `开始安装配置 ${install.label}` })
          }}
        />
      ))
      return
    }

    if (result.action === "install_runtime" || result.action === "retry_step") {
      const model = local.model.current()
      const agent = local.agent.current()
      if (!model || !agent) return
      queueFollowup({
        sessionID,
        sessionDirectory: sdk.directory,
        prompt: [{ type: "text", content: result.prompt, start: 0, end: result.prompt.length }],
        context: [],
        agent: agent.name,
        model: { providerID: model.provider.id, modelID: model.id },
        variant: local.model.variant.current(),
      })
      showEphemeralToast({
        title:
          result.action === "install_runtime"
            ? `继续安装配置 ${result.label}`
            : `环境就绪，重试：${result.stepName}`,
      })
      return
    }

    if (result.action !== "next") return
    const model = local.model.current()
    const agent = local.agent.current()
    if (!model || !agent) return
    queueFollowup({
      sessionID,
      sessionDirectory: sdk.directory,
      prompt: [{ type: "text", content: result.prompt, start: 0, end: result.prompt.length }],
      context: [],
      agent: agent.name,
      model: { providerID: model.provider.id, modelID: model.id },
      variant: local.model.variant.current(),
    })
    showEphemeralToast({ title: `自动进入下一步：${result.stepName}` })
  })

  createResizeObserver(
    () => promptDock,
    ({ height }) => {
      const next = Math.ceil(height)

      if (next === dockHeight) return

      const el = scroller
      const delta = next - dockHeight
      const stick = el
        ? !autoScroll.userScrolled() || el.scrollHeight - el.clientHeight - el.scrollTop < 10 + Math.max(0, delta)
        : false

      dockHeight = next

      if (stick) autoScroll.forceScrollToBottom()

      if (el) scheduleScrollState(el)
      fill()
    },
  )

  const { clearMessageHash, scrollToMessage } = useSessionHashScroll({
    sessionKey,
    sessionID: () => params.id,
    messagesReady,
    visibleUserMessages,
    historyMore,
    historyLoading,
    loadMore: (sessionID) => sync.session.history.loadMore(sessionID),
    turnStart: historyWindow.turnStart,
    currentMessageId: () => store.messageId,
    pendingMessage: () => ui.pendingMessage,
    setPendingMessage: (value) => setUi("pendingMessage", value),
    setActiveMessage,
    setTurnStart: historyWindow.setTurnStart,
    autoScroll,
    scroller: () => scroller,
    anchor,
    scheduleScrollState,
    consumePendingMessage: layout.pendingMessage.consume,
  })

  createEffect(
    on(
      () => params.id,
      (id) => {
        if (!id) requestAnimationFrame(() => inputRef?.focus())
      },
    ),
  )

  function submitQueuedPrompt() {
    if (!queuedPromptSubmit()) return
    const submit = inputRef?.closest("form")?.querySelector<HTMLButtonElement>('[data-action="prompt-submit"]')
    if (!submit || submit.disabled || !local.model.current() || !local.agent.current()) {
      promptSubmitTimer = window.setTimeout(submitQueuedPrompt, 50)
      return
    }
    setQueuedPromptSubmit(false)
    submit.click()
  }

  createEffect(() => {
    if (!queuedPromptSubmit()) return
    promptSubmitTimer = window.setTimeout(submitQueuedPrompt, 0)
  })

  onMount(() => {
    makeEventListener(document, "keydown", handleKeyDown)
  })

  onCleanup(() => {
    if (reviewFrame !== undefined) cancelAnimationFrame(reviewFrame)
    if (refreshFrame !== undefined) cancelAnimationFrame(refreshFrame)
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
    if (todoFrame !== undefined) cancelAnimationFrame(todoFrame)
    if (todoTimer !== undefined) window.clearTimeout(todoTimer)
    if (diffFrame !== undefined) cancelAnimationFrame(diffFrame)
    if (diffTimer !== undefined) window.clearTimeout(diffTimer)
    if (scrollStateFrame !== undefined) cancelAnimationFrame(scrollStateFrame)
    if (fillFrame !== undefined) cancelAnimationFrame(fillFrame)
    if (promptSubmitTimer !== undefined) window.clearTimeout(promptSubmitTimer)
  })

  return (
    <FileOpenProvider onOpenFile={openWorkspaceFile}>
    <div
      data-session-shell
      data-resizing={size.active() ? "" : undefined}
      class="relative bg-background-weak size-full overflow-hidden flex flex-col"
    >
      <SessionHeader />
      <div
        data-session-chrome
        class="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden bg-background-weak pt-3 px-3 pb-0"
      >
        <div
          class="flex-1 min-h-0 min-w-0 flex flex-col md:flex-row overflow-hidden"
          classList={{
            "gap-3": !desktopReviewOpen(),
          }}
        >
        <Show when={!isDesktop() && !!params.id}>
          <Tabs value={store.mobileTab} class="h-auto">
            <Tabs.List>
              <Tabs.Trigger
                value="session"
                class="!w-1/2 !max-w-none"
                classes={{ button: "w-full" }}
                onClick={() => setStore("mobileTab", "session")}
              >
                {language.t("session.tab.session")}
              </Tabs.Trigger>
              <Tabs.Trigger
                value="changes"
                class="!w-1/2 !max-w-none !border-r-0"
                classes={{ button: "w-full" }}
                onClick={() => setStore("mobileTab", "changes")}
              >
                {hasReview()
                  ? language.t("session.review.filesChanged", { count: reviewCount() })
                  : language.t("session.review.change.other")}
              </Tabs.Trigger>
            </Tabs.List>
          </Tabs>
        </Show>

        {/* Conversation column: rounded top only, floats on shared chrome */}
        <div
          data-session-conversation
          classList={{
            "@container relative shrink-0 flex flex-col min-h-0 min-w-0 flex-1 md:flex-none self-stretch overflow-hidden rounded-t-[24px] border border-b-0 border-border-weak-base bg-background-stronger shadow-[var(--shadow-md)]": true,
            "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
              !size.active() && !ui.reviewSnap,
          }}
          style={{
            width: sessionPanelWidth(),
          }}
        >
          <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div class="flex-1 min-h-0 overflow-hidden">
            <Switch>
              <Match when={params.id}>
                <Show
                  when={messagesReady()}
                  fallback={
                    <div class="h-full w-full flex flex-col gap-3 px-6 py-8" aria-busy="true">
                      <div class="h-4 w-2/5 rounded bg-surface-raised-base animate-pulse" />
                      <div class="h-4 w-3/5 rounded bg-surface-raised-base animate-pulse" />
                      <div class="h-4 w-1/3 rounded bg-surface-raised-base animate-pulse" />
                    </div>
                  }
                >
                  <MessageTimeline
                    mobileChanges={mobileChanges()}
                    mobileFallback={reviewContent({
                      diffStyle: "unified",
                      classes: {
                        root: "pb-8",
                        header: "px-4",
                        container: "px-4",
                      },
                      loadingClass: "px-4 py-4 text-text-weak",
                      emptyClass: "h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6",
                    })}
                    actions={actions}
                    scroll={ui.scroll}
                    onResumeScroll={resumeScroll}
                    setScrollRef={setScrollRef}
                    onScheduleScrollState={scheduleScrollState}
                    onAutoScrollHandleScroll={autoScroll.handleScroll}
                    onMarkScrollGesture={markScrollGesture}
                    hasScrollGesture={hasScrollGesture}
                    onUserScroll={markUserScroll}
                    onTurnBackfillScroll={historyWindow.onScrollerScroll}
                    onAutoScrollInteraction={autoScroll.handleInteraction}
                    centered={centered()}
                    setContentRef={(el) => {
                      content = el
                      autoScroll.contentRef(el)

                      const root = scroller
                      if (root) scheduleScrollState(root)
                    }}
                    historyMore={showLoadEarlier()}
                    historyLoading={historyLoading() || historyWindow.probingEarlier()}
                    onLoadEarlier={() => {
                      void historyWindow.loadAndReveal()
                    }}
                    userMessages={visibleUserMessages()}
                    anchor={anchor}
                  />
                </Show>
              </Match>
              <Match when={true}>
                <NewSessionView worktree={newSessionWorktree()} />
              </Match>
            </Switch>
          </div>

          <SessionComposerRegion
            state={composer}
            ready={!store.deferRender && messagesReady()}
            centered={centered()}
            inputRef={(el) => {
              inputRef = el
            }}
            newSessionWorktree={newSessionWorktree()}
            onNewSessionWorktreeReset={() => setStore("newSessionWorktree", "main")}
            onSubmit={() => {
              comments.clear()
              resumeScroll()
              const dir = params.dir
              if (!dir) return
              if (getScenarioRun(dir)) {
                markScenarioRunStarted(dir)
                openRightDock("todo")
                return
              }
              if (consumeScenarioWorkflowOpenOnSubmit(dir)) openRightDock("todo")
            }}
            onResponseSubmit={resumeScroll}
            followup={
              params.id && !isChildSession()
                ? {
                    queue: queueEnabled,
                    items: followupDock(),
                    sending: sendingFollowup(),
                    edit: editingFollowup(),
                    onQueue: queueFollowup,
                    onAbort: () => {
                      const id = params.id
                      if (!id) return
                      setFollowup("paused", id, true)
                    },
                    onSend: (id) => {
                      void sendFollowup(params.id!, id, { manual: true })
                    },
                    onEdit: editFollowup,
                    onEditLoaded: clearFollowupEdit,
                  }
                : undefined
            }
            revert={
              rolled().length > 0
                ? {
                    items: rolled(),
                    restoring: restoring(),
                    disabled: reverting(),
                    onRestore: restore,
                  }
                : undefined
            }
            setPromptDockRef={(el) => {
              promptDock = el
            }}
          />
          </div>

          <Show when={desktopReviewOpen()}>
            <div class="absolute inset-y-0 end-0 z-50" onPointerDown={() => size.start()}>
              <ResizeHandle
                direction="horizontal"
                size={layout.session.width()}
                min={450}
                max={typeof window === "undefined" ? 1000 : window.innerWidth * 0.45}
                onResize={(width) => {
                  size.touch()
                  layout.session.resize(width)
                }}
              />
            </div>
          </Show>
        </div>

        <Show when={!workbenchEmbed()}>
          <SessionSidePanel
            canReview={canReview}
            diffs={reviewDiffs}
            diffsReady={reviewReady}
            empty={reviewEmptyText}
            hasReview={hasReview}
            reviewCount={reviewCount}
            reviewPanel={reviewPanel}
            activeDiff={tree.activeDiff}
            focusReviewDiff={focusReviewDiff}
            reviewSnap={ui.reviewSnap}
            reviewSessionWidth={reviewSessionWidth}
            size={size}
            onSyncFiles={syncWorkspaceFiles}
            onOpenFile={openWorkspaceFile}
          />
        </Show>
        </div>

        {/* Workbench: portal into shell dock under mid+right. /code: inline under session chrome. */}
        <Show when={workbenchEmbed()} fallback={<TerminalPanel />}>
          <WorkbenchTerminalPortal />
        </Show>
      </div>
    </div>
    </FileOpenProvider>
  )
}
