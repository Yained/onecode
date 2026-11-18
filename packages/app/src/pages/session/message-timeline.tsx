import {
  For,
  createEffect,
  createMemo,
  on,
  onCleanup,
  onMount,
  Show,
  Index,
  type Accessor,
  type JSX,
  createSignal,
} from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createVirtualizer, defaultRangeExtractor } from "@tanstack/solid-virtual"
import { useLocation, useNavigate } from "@solidjs/router"
import { useMutation } from "@tanstack/solid-query"
import { Button } from "@opencode-ai/ui/button"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Dialog } from "@opencode-ai/ui/dialog"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { Spinner } from "@opencode-ai/ui/spinner"
import {
  ContextToolGroup,
  Message,
  MessageDivider,
  Part as MessagePart,
  type UserActions,
} from "@opencode-ai/ui/message-part"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { SessionRetry } from "@opencode-ai/ui/session-retry"
import { TextField } from "@opencode-ai/ui/text-field"
import type { Message as MessageType, Part as PartType, ToolPart, UserMessage } from "@opencode-ai/sdk/v2"
import { showToast } from "@opencode-ai/ui/toast"
import { getFilename } from "@opencode-ai/core/util/path"
import { Popover as KobaltePopover } from "@kobalte/core/popover"
import { shouldMarkBoundaryGesture, normalizeWheelDelta } from "@/pages/session/message-gesture"
import { SessionContextUsage } from "@/components/session-context-usage"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useSessionKey } from "@/pages/session/session-layout"
import { useGlobalSDK } from "@/context/global-sdk"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { firstUserMessageText, sessionTitle } from "@/utils/session-title"
import { SessionTitleLabel } from "@/workbench/session-title-label"
import { liveTranscriptEpoch, sessionMessagesLookComplete } from "@/utils/session-status"
import { makeTimer } from "@solid-primitives/timer"
import { sessionHrefForPath } from "@/app-routes"
import { isSharedCasesPath, storedPlatformAuthSession } from "@/utils/platform-auth"
import {
  disconnectLiveRemoteWorkspace,
  liveRemoteWorkspaceID,
  sessionUsesLiveRemote,
} from "@/utils/delete-project"
import { scheduleConnectedMeasure } from "@/pages/session/timeline/measure"
import { observeElementOffsetReconnectAware } from "@/pages/session/timeline/observe-element-offset"
import { createTimelineProjection } from "@/pages/session/timeline/projection"
import { MessageComment, TimelineRow, type SummaryDiff } from "@/pages/session/timeline/rows"
import { filterVirtualIndexes } from "@/pages/session/timeline/virtual-items"

const SESSION_BUSY_SPINNER_COLOR = "var(--os-primary, #AD2830)"
/** Prefer underestimate: overestimate + min-height leaves large blank gaps between short rows. */
const TIMELINE_FALLBACK_ITEM_SIZE = 72
const TIMELINE_CONTEXT_ESTIMATE = 40
const TIMELINE_USER_ESTIMATE = 96

const MODEL_TURN_ERROR_I18N: Record<string, "ui.message.connectionInterrupted" | "ui.message.streamStalled" | "ui.message.requestTimedOut"> =
  {
    "Provider connection was interrupted": "ui.message.connectionInterrupted",
    "Model stream stalled": "ui.message.streamStalled",
    "Model request timed out": "ui.message.requestTimedOut",
  }

function estimateTimelineRowSize(row: TimelineRow.TimelineRow | undefined) {
  if (!row) return TIMELINE_FALLBACK_ITEM_SIZE
  if (row._tag === "UserMessage") return TIMELINE_USER_ESTIMATE
  // Collapsed「已探索 N 次」rows are a single line — do not reserve tool-card height.
  if (row._tag === "AssistantPart" && row.group.type === "context") return TIMELINE_CONTEXT_ESTIMATE
  return TIMELINE_FALLBACK_ITEM_SIZE
}
const emptyMessages: MessageType[] = []
const emptyParts: PartType[] = []
const emptyTools: ToolPart[] = []
const idle = { type: "idle" as const }

type TimelineRowByTag<T extends TimelineRow.TimelineRow["_tag"]> = Extract<TimelineRow.TimelineRow, { _tag: T }>
type FramedTimelineRow = Exclude<TimelineRow.TimelineRow, { _tag: "TurnGap" }>

const partDefaultOpen = (part: PartType, shell = false, edit = false) => {
  if (part.type !== "tool") return
  if (part.tool === "bash") return shell
  if (part.tool === "edit" || part.tool === "write" || part.tool === "apply_patch") return edit
}

const taskDescription = (part: PartType, sessionID: string) => {
  if (part.type !== "tool" || part.tool !== "task") return
  const metadata = "metadata" in part.state ? part.state.metadata : undefined
  if (metadata?.sessionId !== sessionID) return
  const value = part.state.input?.description
  if (typeof value === "string" && value) return value
}

const boundaryTarget = (root: HTMLElement, target: EventTarget | null) => {
  const current = target instanceof Element ? target : undefined
  const nested = current?.closest("[data-scrollable]")
  if (!nested || nested === root) return root
  if (!(nested instanceof HTMLElement)) return root
  return nested
}

const markBoundaryGesture = (input: {
  root: HTMLDivElement
  target: EventTarget | null
  delta: number
  onMarkScrollGesture: (target?: EventTarget | null) => void
}) => {
  const target = boundaryTarget(input.root, input.target)
  if (target === input.root) {
    input.onMarkScrollGesture(input.root)
    return
  }
  if (
    shouldMarkBoundaryGesture({
      delta: input.delta,
      scrollTop: target.scrollTop,
      scrollHeight: target.scrollHeight,
      clientHeight: target.clientHeight,
    })
  ) {
    input.onMarkScrollGesture(input.root)
  }
}

export function MessageTimeline(props: {
  mobileChanges: boolean
  mobileFallback: JSX.Element
  actions?: UserActions
  scroll: { overflow: boolean; bottom: boolean; jump: boolean }
  onResumeScroll: () => void
  setScrollRef: (el: HTMLDivElement | undefined) => void
  onScheduleScrollState: (el: HTMLDivElement) => void
  onAutoScrollHandleScroll: () => void
  onMarkScrollGesture: (target?: EventTarget | null) => void
  hasScrollGesture: () => boolean
  onUserScroll: () => void
  onTurnBackfillScroll: () => void
  onAutoScrollInteraction: (event: MouseEvent) => void
  centered: boolean
  setContentRef: (el: HTMLDivElement) => void
  historyMore: boolean
  historyLoading: boolean
  onLoadEarlier: () => void
  /** All loaded user turns — virtualization decides what mounts in the DOM. */
  userMessages: UserMessage[]
  anchor: (id: string) => string
}) {
  let touchGesture: number | undefined

  const navigate = useNavigate()
  const globalSDK = useGlobalSDK()
  const sdk = useSDK()
  const sync = useSync()
  const settings = useSettings()
  const dialog = useDialog()
  const language = useLanguage()
  const location = useLocation()
  const { params, sessionKey } = useSessionKey()
  const platform = usePlatform()

  const sessionID = createMemo(() => params.id)
  const sessionMessages = createMemo(() => {
    const id = sessionID()
    if (!id) return emptyMessages
    return sync.data.message[id] ?? emptyMessages
  })
  const sessionStatus = createMemo(() => {
    const id = sessionID()
    if (!id) return idle
    return sync.data.session_status[id] ?? idle
  })
  const working = createMemo(() => sessionStatus().type !== "idle")
  const [timeoutDone, setTimeoutDone] = createSignal(true)
  const workingStatus = createMemo<"hidden" | "showing" | "hiding">((prev) => {
    if (working()) return "showing"
    if (prev === "showing" || !timeoutDone()) return "hiding"
    return "hidden"
  })

  createEffect(() => {
    if (workingStatus() !== "hiding") return
    setTimeoutDone(false)
    makeTimer(() => setTimeoutDone(true), 260, setTimeout)
  })

  const BUSY_SYNC_MS = 3_000

  createEffect(() => {
    const id = sessionID()
    const status = sessionStatus()
    if (!id || status.type !== "busy") return

    // Leaf GET /session/status can stay busy after the answer is already in
    // the transcript (idle SSE dropped, then switch-away/switch-back).
    // Require the latest turn to look complete — a trailing user message means
    // a follow-up is still in flight even if an older assistant exists.
    if (sessionMessagesLookComplete(sessionMessages())) {
      sync.set("session_status", id, { type: "idle" })
      return
    }

    // Healthy SSE (including text deltas) resets this timer. A pending assistant
    // used to skip REST catch-up entirely, so a dropped event stream froze the
    // timeline until F5. Only poll after the live transcript stalls.
    liveTranscriptEpoch(sessionMessages(), sync.data.part)

    const timer = window.setInterval(() => {
      void Promise.allSettled([sync.session.sync(id, { force: true }), sync.session.status()])
    }, BUSY_SYNC_MS)
    onCleanup(() => window.clearInterval(timer))
  })

  createEffect(() => {
    const id = sessionID()
    if (!id) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsub = globalSDK.event.listen((event) => {
      if (event.details.type !== "server.connected") return
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        void Promise.allSettled([sync.session.sync(id, { force: true }), sync.session.status()])
      }, 250)
    })
    onCleanup(() => {
      if (timer !== undefined) clearTimeout(timer)
      unsub()
    })
  })

  const info = createMemo(() => {
    const id = sessionID()
    if (!id) return
    return sync.session.get(id)
  })
  const titleValue = createMemo(() => info()?.title)
  const shareUrl = createMemo(() => info()?.share?.url)
  const shareEnabled = createMemo(() => sync.data.config.share !== "disabled")
  const parentID = createMemo(() => info()?.parentID)
  const parent = createMemo(() => {
    const id = parentID()
    if (!id) return
    return sync.session.get(id)
  })
  const parentMessages = createMemo(() => {
    const id = parentID()
    if (!id) return emptyMessages
    return sync.data.message[id] ?? emptyMessages
  })
  const parentTitle = createMemo(() => sessionTitle(parent()?.title) ?? language.t("command.session.new"))
  const getMsgParts = (msgId: string) => sync.data.part[msgId] ?? emptyParts
  const getMsgPart = (messageID: string, partID: string) => getMsgParts(messageID).find((part) => part.id === partID)
  const firstUserText = createMemo(() => {
    const id = sessionID()
    if (!id) return
    return firstUserMessageText(id, sync.data.message, sync.data.part)
  })
  const titleLabel = createMemo(() => {
    const fromServer = sessionTitle(titleValue())
    // Before the title model finishes, show the first user message. CSS truncates the header.
    if (fromServer) return fromServer
    const first = firstUserText()?.replace(/\s+/g, " ").trim()
    if (first) return first
    return language.t("command.session.new")
  })
  const childTaskDescription = createMemo(() => {
    const id = sessionID()
    if (!id) return
    return parentMessages()
      .flatMap((message) => getMsgParts(message.id))
      .map((part) => taskDescription(part, id))
      .findLast((value): value is string => !!value)
  })
  const childTitle = createMemo(() => {
    if (!parentID()) return titleLabel() ?? ""
    const description = childTaskDescription()
    if (description) return description
    const value = titleLabel()?.replace(/\s+\(@[^)]+ subagent\)$/, "")
    if (value) return value
    return language.t("command.session.new")
  })
  const showHeader = createMemo(() => !!(titleValue() || parentID()))
  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement>()

  const projectedMessages = createMemo(() => {
    const visible = new Set(props.userMessages.map((message) => message.id))
    const messages = sessionMessages()
    // Shared/default cases sometimes hydrate assistant pages before user roots.
    // If we filter those assistants out, the timeline stays blank even though
    // "加载更早的消息" is shown. Pass messages through until a user turn exists.
    if (visible.size === 0) {
      return messages.filter((message) => message.role === "user" || message.role === "assistant")
    }
    return messages.filter((message) => {
      if (message.role === "user") return visible.has(message.id)
      if (message.role === "assistant") return visible.has(message.parentID)
      return false
    })
  })

  const projection = createTimelineProjection({
    messages: sessionMessages,
    userMessages: () => props.userMessages,
    sessionMessages: projectedMessages,
    parts: getMsgParts,
    status: sessionStatus,
    showReasoningSummaries: settings.general.showReasoningSummaries,
    inlineComments: () => false,
  })
  const activeMessageID = projection.activeMessageID
  const lastAssistantGroupKey = projection.lastAssistantGroupKey
  const messageByID = projection.messageByID
  const messageLastRowIndex = projection.messageLastRowIndex
  const timelineRowByKey = projection.rowByKey
  const timelineRows = projection.rows

  const virtualizer = createVirtualizer({
    get count() {
      return timelineRows().length
    },
    getScrollElement: () => scrollEl() ?? null,
    observeElementOffset: observeElementOffsetReconnectAware,
    estimateSize: (index) => estimateTimelineRowSize(timelineRows()[index]),
    overscan: 16,
    getItemKey: (index) => {
      const row = timelineRows()[index]
      if (!row) return `removed:${index}`
      return TimelineRow.key(row)
    },
    rangeExtractor: (range) => {
      const id = activeMessageID()
      // Match upstream: only pin the last row of the active turn. Pinning the
      // whole turn defeats virtualization while the agent streams tools/text,
      // which freezes titlebar chrome (terminal / review) during output.
      const active = id ? (messageLastRowIndex().get(id) ?? -1) : -1
      const indexes = defaultRangeExtractor(range)
      return filterVirtualIndexes(
        [...new Set([...indexes, ...(active < 0 ? [] : [active])])].sort((a, b) => a - b),
        range.count,
      )
    },
  })
  // Key For by stable row keys (not VirtualItem object identity). Streaming inserts
  // otherwise reuse the wrong row component — e.g. many "思考中" ghosts and blank tools.
  const virtualItemByKey = createMemo(
    () => new Map(virtualizer.getVirtualItems().map((item) => [item.key, item] as const)),
  )
  const virtualRowKeys = createMemo(() => virtualizer.getVirtualItems().map((item) => item.key as string))

  // Bump to ask mounted rows to remasure. Do NOT call virtualizer.measure() here —
  // that clears the size cache and falls back to estimates, which left huge blank
  // gaps after「加载更早」when estimates were larger than collapsed tool rows.
  const [layoutEpoch, setLayoutEpoch] = createSignal(0)
  let settleTimer: number | undefined
  const settleVirtualLayout = () => {
    // Debounce: each prepend used to double-bump epoch and remasure every visible
    // row twice — that alone could freeze after many「加载更早」clicks.
    if (settleTimer !== undefined) window.clearTimeout(settleTimer)
    settleTimer = window.setTimeout(() => {
      settleTimer = undefined
      requestAnimationFrame(() => setLayoutEpoch((value) => value + 1))
    }, 48)
  }
  onCleanup(() => {
    if (settleTimer !== undefined) window.clearTimeout(settleTimer)
  })

  // Remeasure when the projected row set changes (history prepend / new turns / streaming parts).
  createEffect(
    on(
      () => [sessionKey(), timelineRows().length] as const,
      () => {
        settleVirtualLayout()
      },
    ),
  )

  // After「加载更早」finishes, force another settle — length may already have updated
  // while historyLoading was true, leaving stale tops until refresh.
  createEffect(
    on(
      () => props.historyLoading,
      (loading, prev) => {
        if (prev !== true || loading) return
        settleVirtualLayout()
      },
    ),
  )

  // When a run finishes, re-fetch once so the final answer matches server state
  // (SSE can leave a partial text part until refresh otherwise).
  createEffect(
    on(
      () => sessionStatus().type,
      (type, prev) => {
        const id = sessionID()
        if (!id) return
        if (prev !== "busy" || type === "busy") return
        void sync.session.sync(id, { force: true }).finally(() => {
          settleVirtualLayout()
        })
      },
    ),
  )

  const workingTurn = (userMessageID: string) =>
    activeMessageID() === userMessageID && sessionStatus().type !== "idle"

  const renderAssistantPartGroup = (row: Accessor<TimelineRowByTag<"AssistantPart">>) => {
    if (row().group.type === "context") {
      const parts = createMemo(() => {
        const group = row().group
        if (group.type !== "context") return emptyTools
        return group.refs
          .map((ref) => getMsgPart(ref.messageID, ref.partID))
          .filter((part): part is ToolPart => part?.type === "tool")
      })

      return (
        <ContextToolGroup
          parts={parts()}
          busy={
            workingTurn(row().userMessageID) && lastAssistantGroupKey().get(row().userMessageID) === row().group.key
          }
        />
      )
    }

    const message = createMemo(() => {
      const group = row().group
      if (group.type !== "part") return
      return messageByID().get(group.ref.messageID)
    })
    const part = createMemo(() => {
      const group = row().group
      if (group.type !== "part") return
      return getMsgPart(group.ref.messageID, group.ref.partID)
    })
    const defaultOpen = createMemo(() => {
      const item = part()
      if (!item) return
      return partDefaultOpen(item, settings.general.shellToolPartsExpanded(), settings.general.editToolPartsExpanded())
    })

    return (
      <Show when={message()}>
        {(message) => (
          <Show when={part()}>
            {(part) => (
              <MessagePart part={part()} message={message()} defaultOpen={defaultOpen()} />
            )}
          </Show>
        )}
      </Show>
    )
  }

  function TimelineRowFrame(input: { row: Accessor<FramedTimelineRow>; children: JSX.Element }) {
    const anchor = () => {
      const row = input.row()
      return row._tag === "CommentStrip" || (row._tag === "UserMessage" && row.anchor)
    }
    const previousAssistantPart = () => {
      const row = input.row()
      return row._tag === "AssistantPart" && row.previousAssistantPart
    }

    return (
      <div
        id={anchor() ? props.anchor(input.row().userMessageID) : undefined}
        data-message-id={input.row().userMessageID}
        data-timeline-row={input.row()._tag}
        classList={{
          "min-w-0 w-full max-w-full": true,
          "md:max-w-200 2xl:max-w-[1000px]": props.centered,
          "md:mx-auto": props.centered,
          "pt-3": previousAssistantPart(),
        }}
      >
        <div data-component="session-turn" class="min-w-0 w-full relative" style={{ height: "auto" }}>
          {input.children}
        </div>
      </div>
    )
  }

  const renderTimelineRow = (row: Accessor<TimelineRow.TimelineRow>) => {
    switch (row()._tag) {
      case "TurnGap":
        return <div data-timeline-row="TurnGap" aria-hidden="true" class="h-6" />
      case "CommentStrip": {
        const commentStripRow = row as Accessor<TimelineRowByTag<"CommentStrip">>
        const comments = createMemo(() =>
          getMsgParts(commentStripRow().userMessageID).flatMap((part) => MessageComment.fromPart(part) ?? []),
        )
        return (
          <TimelineRowFrame row={commentStripRow}>
            <div class="w-full px-4 md:px-5 pb-2">
              <div class="ml-auto max-w-[82%] overflow-x-auto no-scrollbar">
                <div class="flex w-max min-w-full justify-end gap-2">
                  <Index each={comments()}>
                    {(comment) => (
                      <div class="shrink-0 max-w-[260px] rounded-[6px] border border-border-weak-base bg-background-stronger px-2.5 py-2">
                        <div class="flex items-center gap-1.5 min-w-0 text-11-medium text-text-strong">
                          <FileIcon node={{ path: comment().path, type: "file" }} class="size-3.5 shrink-0" />
                          <span class="truncate">{getFilename(comment().path)}</span>
                          <Show when={comment().selection}>
                            {(selection) => (
                              <span class="shrink-0 text-text-weak">
                                {selection().startLine === selection().endLine
                                  ? `:${selection().startLine}`
                                  : `:${selection().startLine}-${selection().endLine}`}
                              </span>
                            )}
                          </Show>
                        </div>
                        <div class="pt-1 text-12-regular text-text-strong whitespace-pre-wrap break-words">
                          {comment().comment}
                        </div>
                      </div>
                    )}
                  </Index>
                </div>
              </div>
            </div>
          </TimelineRowFrame>
        )
      }
      case "UserMessage": {
        const userMessageRow = row as Accessor<TimelineRowByTag<"UserMessage">>
        const message = createMemo(() => {
          const m = messageByID().get(userMessageRow().userMessageID)
          if (m?.role === "user") return m
        })
        return (
          <TimelineRowFrame row={userMessageRow}>
            <Show when={message()}>
              {(message) => (
                <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
                  <div data-slot="session-turn-message-content" aria-live="off">
                    <Message
                      message={message()}
                      parts={getMsgParts(userMessageRow().userMessageID)}
                      actions={props.actions}
                    />
                  </div>
                </div>
              )}
            </Show>
          </TimelineRowFrame>
        )
      }
      case "TurnDivider": {
        const turnDividerRow = row as Accessor<TimelineRowByTag<"TurnDivider">>
        return (
          <TimelineRowFrame row={turnDividerRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <div data-slot="session-turn-compaction">
                <MessageDivider
                  label={language.t(
                    turnDividerRow().label === "compaction" ? "ui.messagePart.compaction" : "ui.message.interrupted",
                  )}
                />
              </div>
            </div>
          </TimelineRowFrame>
        )
      }
      case "AssistantPart": {
        const assistantPartRow = row as Accessor<TimelineRowByTag<"AssistantPart">>
        return (
          <TimelineRowFrame row={assistantPartRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <div
                data-slot="session-turn-assistant-content"
              >
                {renderAssistantPartGroup(assistantPartRow)}
              </div>
            </div>
          </TimelineRowFrame>
        )
      }
      case "Thinking": {
        const thinkingRow = row as Accessor<TimelineRowByTag<"Thinking">>
        return (
          <TimelineRowFrame row={thinkingRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <div data-slot="session-turn-thinking" class="text-14-regular text-text-weak">
                {language.t("ui.sessionTurn.status.thinking")}
                <Show when={!settings.general.showReasoningSummaries() && thinkingRow().reasoningHeading}>
                  <span class="ml-2 text-text-base">{thinkingRow().reasoningHeading}</span>
                </Show>
              </div>
            </div>
          </TimelineRowFrame>
        )
      }
      case "Retry":
        return (
          <TimelineRowFrame row={row as Accessor<TimelineRowByTag<"Retry">>}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <SessionRetry status={sessionStatus()} show />
            </div>
          </TimelineRowFrame>
        )
      case "DiffSummary": {
        const diffSummaryRow = row as Accessor<TimelineRowByTag<"DiffSummary">>
        const diffs = createMemo(() => diffSummaryRow().diffs)
        return (
          <TimelineRowFrame row={diffSummaryRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <div data-slot="session-turn-diffs" class="flex flex-col gap-1 py-1">
                <span class="text-12-medium text-text-weak">
                  {`${diffs().length} ${language.t("ui.sessionTurn.diffs.changed")}`}
                </span>
                <Index each={diffs()}>
                  {(diff: () => SummaryDiff) => (
                    <div class="flex items-center gap-1.5 min-w-0 text-12-regular text-text-base">
                      <FileIcon node={{ path: diff().file, type: "file" }} class="size-3.5 shrink-0" />
                      <span class="truncate">{getFilename(diff().file)}</span>
                    </div>
                  )}
                </Index>
              </div>
            </div>
          </TimelineRowFrame>
        )
      }
      case "Error": {
        const errorRow = row as Accessor<TimelineRowByTag<"Error">>
        return (
          <TimelineRowFrame row={errorRow}>
            <div data-slot="session-turn-message-container" class="w-full px-4 md:px-5">
              <div class="rounded-[6px] border border-border-weak-base bg-background-stronger px-3 py-2 text-13-regular text-text-strong whitespace-pre-wrap break-words">
                {MODEL_TURN_ERROR_I18N[errorRow().text]
                  ? language.t(MODEL_TURN_ERROR_I18N[errorRow().text]!)
                  : errorRow().text}
              </div>
            </div>
          </TimelineRowFrame>
        )
      }
    }
  }

  function TimelineRowView(viewProps: { row: TimelineRow.TimelineRow }) {
    return renderTimelineRow(() => viewProps.row)
  }

  function VirtualTimelineRow(rowProps: { rowKey: string }) {
    const [element, setElement] = createSignal<HTMLDivElement>()
    const item = createMemo(() => virtualItemByKey().get(rowProps.rowKey))
    const row = createMemo(() => timelineRowByKey().get(rowProps.rowKey))

    // Any content that can change height without changing the row key.
    const contentFingerprint = createMemo(() => {
      const value = row()
      if (!value) return ""
      if (value._tag === "UserMessage") {
        const parts = getMsgParts(value.userMessageID)
        return `user:${value.userMessageID}:${parts.map((part) => ("text" in part ? String(part.text?.length ?? 0) : part.id)).join(",")}`
      }
      if (value._tag === "Thinking") {
        return `thinking:${value.userMessageID}:${value.reasoningHeading ?? ""}:${sessionStatus().type}`
      }
      if (value._tag !== "AssistantPart" || value.group.type !== "part") {
        return `${value._tag}:${sessionStatus().type}`
      }
      const part = getMsgPart(value.group.ref.messageID, value.group.ref.partID)
      if (!part) return value.group.key
      if (part.type === "text" || part.type === "reasoning") {
        const accum = sync.data.part_text_accum_delta?.[part.id]
        return `${part.id}:${(accum ?? part.text ?? "").length}`
      }
      if (part.type === "tool") {
        const output =
          part.state.status === "completed" || part.state.status === "error"
            ? String(("output" in part.state && part.state.output?.length) || 0)
            : part.state.status
        return `${part.id}:${part.state.status}:${output}`
      }
      return part.id
    })

    const measure = () => {
      const node = element()
      const virtualItem = item()
      if (!node?.isConnected || !virtualItem) return
      scheduleConnectedMeasure(node, (el) => {
        // Measure the content node only — never the absolute wrapper (its min-height
        // equals the current estimate and would lock in oversized blank gaps).
        virtualizer.measureElement(el)
        const next = Math.ceil(Math.max(el.scrollHeight, el.getBoundingClientRect().height))
        const current = virtualItem.size
        if (Math.abs(next - current) > 1) virtualizer.resizeItem(virtualItem.index, next)
      })
    }

    onMount(() => measure())

    createEffect(
      on(
        () => {
          const virtualItem = item()
          const value = row()
          return [virtualItem?.index, value ? TimelineRow.key(value) : "", contentFingerprint(), layoutEpoch()] as const
        },
        () => measure(),
        { defer: true },
      ),
    )

    createEffect(() => {
      const node = element()
      if (!node || typeof ResizeObserver === "undefined") return
      const observer = new ResizeObserver(() => measure())
      observer.observe(node)
      onCleanup(() => observer.disconnect())
    })

    return (
      <Show when={item()}>
        {(virtualItem) => (
          <Show when={row()}>
            {(timelineRow) => (
              <div
                data-timeline-key={rowProps.rowKey}
                data-timeline-row-tag={timelineRow()._tag}
                style={{
                  position: "absolute",
                  top: `${virtualItem().start}px`,
                  left: "0",
                  width: "100%",
                  // Never clip content to the virtualizer estimate — that truncated user bubbles
                  // and hid live shell/thinking rows when measurement lagged.
                  "min-height": `${virtualItem().size}px`,
                }}
              >
                <div
                  ref={(value) => {
                    setElement(value)
                    if (value) measure()
                  }}
                  data-index={virtualItem().index}
                  classList={{
                    "min-w-0 w-full max-w-full": true,
                    "md:max-w-200 2xl:max-w-[1000px]": props.centered,
                  }}
                >
                  <TimelineRowView row={timelineRow()} />
                </div>
              </div>
            )}
          </Show>
        )}
      </Show>
    )
  }

  const [title, setTitle] = createStore({
    draft: "",
    editing: false,
    menuOpen: false,
    pendingRename: false,
    pendingShare: false,
  })
  let titleRef: HTMLInputElement | undefined

  const [share, setShare] = createStore({
    open: false,
    dismiss: null as "escape" | "outside" | null,
  })

  let more: HTMLButtonElement | undefined

  const viewShare = () => {
    const url = shareUrl()
    if (!url) return
    platform.openLink(url)
  }

  const errorMessage = (err: unknown) => {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { message?: string } }).data
      if (data?.message) return data.message
    }
    if (err instanceof Error) return err.message
    return language.t("common.requestFailed")
  }

  const shareMutation = useMutation(() => ({
    mutationFn: (id: string) => globalSDK.client.session.share({ sessionID: id, directory: sdk.directory }),
    onError: (err) => {
      console.error("Failed to share session", err)
    },
  }))

  const unshareMutation = useMutation(() => ({
    mutationFn: (id: string) => globalSDK.client.session.unshare({ sessionID: id, directory: sdk.directory }),
    onError: (err) => {
      console.error("Failed to unshare session", err)
    },
  }))

  const titleMutation = useMutation(() => ({
    mutationFn: (input: { id: string; title: string }) =>
      sdk.client.session.update({ sessionID: input.id, title: input.title }),
    onSuccess: (_, input) => {
      sync.set(
        produce((draft) => {
          const index = draft.session.findIndex((s) => s.id === input.id)
          if (index !== -1) draft.session[index].title = input.title
        }),
      )
      setTitle("editing", false)
    },
    onError: (err) => {
      showToast({
        title: language.t("common.requestFailed"),
        description: errorMessage(err),
      })
    },
  }))

  const shareSession = () => {
    const id = sessionID()
    if (!id || shareMutation.isPending) return
    if (!shareEnabled()) return
    shareMutation.mutate(id)
  }

  const unshareSession = () => {
    const id = sessionID()
    if (!id || unshareMutation.isPending) return
    if (!shareEnabled()) return
    unshareMutation.mutate(id)
  }

  createEffect(
    on(
      sessionKey,
      () =>
        setTitle({
          draft: "",
          editing: false,
          menuOpen: false,
          pendingRename: false,
          pendingShare: false,
        }),
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => [parentID(), childTaskDescription()] as const,
      ([id, description]) => {
        if (!id || description) return
        if (sync.data.message[id] !== undefined) return
        void sync.session.sync(id)
      },
      { defer: true },
    ),
  )

  const openTitleEditor = () => {
    if (!sessionID() || parentID()) return
    setTitle({ editing: true, draft: titleLabel() ?? "" })
    requestAnimationFrame(() => {
      titleRef?.focus()
      titleRef?.select()
    })
  }

  const closeTitleEditor = () => {
    if (titleMutation.isPending) return
    setTitle("editing", false)
  }

  const saveTitleEditor = () => {
    const id = sessionID()
    if (!id) return
    if (titleMutation.isPending) return

    const next = title.draft.trim()
    if (!next || next === (titleLabel() ?? "")) {
      setTitle("editing", false)
      return
    }

    titleMutation.mutate({ id, title: next })
  }

  const navigateAfterSessionRemoval = (sessionID: string, parentID?: string, nextSessionID?: string) => {
    if (params.id !== sessionID) return
    if (!params.dir) return
    if (parentID) {
      navigate(sessionHrefForPath(location.pathname, params.dir, parentID))
      return
    }
    if (nextSessionID) {
      navigate(sessionHrefForPath(location.pathname, params.dir, nextSessionID))
      return
    }
    navigate(sessionHrefForPath(location.pathname, params.dir))
  }

  const archiveSession = async (sessionID: string) => {
    const session = sync.session.get(sessionID)
    if (!session) return
    if (isSharedCasesPath(storedPlatformAuthSession(), session.directory || sdk.directory)) {
      showToast({
        title: language.t("common.archive"),
        description: "官方默认案例不可归档，可从案例页恢复缺失会话。",
      })
      return
    }

    const sessions = sync.data.session ?? []
    const index = sessions.findIndex((s) => s.id === sessionID)
    const nextSession = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])

    await sdk.client.session
      .update({ sessionID, time: { archived: Date.now() } })
      .then(() => {
        sync.set(
          produce((draft) => {
            const index = draft.session.findIndex((s) => s.id === sessionID)
            if (index !== -1) draft.session.splice(index, 1)
          }),
        )
        navigateAfterSessionRemoval(sessionID, session.parentID, nextSession?.id)
      })
      .catch((err) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(err),
        })
      })
  }

  const deleteSession = async (sessionID: string) => {
    const session = sync.session.get(sessionID)
    if (!session) return false
    if (isSharedCasesPath(storedPlatformAuthSession(), session.directory || sdk.directory)) {
      showToast({
        title: language.t("session.delete.failed.title"),
        description: "官方默认案例不可删除，可从案例页恢复缺失会话。",
      })
      return false
    }

    const sessions = (sync.data.session ?? []).filter((s) => !s.parentID && !s.time?.archived)
    const index = sessions.findIndex((s) => s.id === sessionID)
    const nextSession = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])

    const directory = session.directory || sdk.directory
    if (sessionUsesLiveRemote({ directory, workspaceID: session.workspaceID }) || liveRemoteWorkspaceID(directory)) {
      const disconnected = await disconnectLiveRemoteWorkspace(globalSDK.client, directory, [sessionID])
      if (!disconnected.ok) {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(disconnected.error),
        })
        return false
      }
    }

    const result = await sdk.client.session
      .delete({ sessionID })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(err),
        })
        return false
      })

    if (!result) return false

    sync.set(
      produce((draft) => {
        const removed = new Set<string>([sessionID])

        const byParent = new Map<string, string[]>()
        for (const item of draft.session) {
          const parentID = item.parentID
          if (!parentID) continue
          const existing = byParent.get(parentID)
          if (existing) {
            existing.push(item.id)
            continue
          }
          byParent.set(parentID, [item.id])
        }

        const stack = [sessionID]
        while (stack.length) {
          const parentID = stack.pop()
          if (!parentID) continue

          const children = byParent.get(parentID)
          if (!children) continue

          for (const child of children) {
            if (removed.has(child)) continue
            removed.add(child)
            stack.push(child)
          }
        }

        draft.session = draft.session.filter((s) => !removed.has(s.id))
      }),
    )

    navigateAfterSessionRemoval(sessionID, session.parentID, nextSession?.id)
    return true
  }

  const navigateParent = () => {
    const id = parentID()
    if (!id) return
    if (!params.dir) return
    navigate(sessionHrefForPath(location.pathname, params.dir, id))
  }

  function DialogDeleteSession(props: { sessionID: string }) {
    const name = createMemo(
      () => sessionTitle(sync.session.get(props.sessionID)?.title) ?? language.t("command.session.new"),
    )
    const [deleting, setDeleting] = createSignal(false)
    const handleDelete = async () => {
      if (deleting()) return
      setDeleting(true)
      const ok = await deleteSession(props.sessionID)
      setDeleting(false)
      if (ok) dialog.close()
    }

    return (
      <Dialog title={language.t("session.delete.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              {language.t("session.delete.confirm", { name: name() })}
            </span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" disabled={deleting()} onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" disabled={deleting()} onClick={() => void handleDelete()}>
              {deleting() ? language.t("session.delete.busy") : language.t("session.delete.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  return (
    <Show
      when={!props.mobileChanges}
      fallback={<div class="relative h-full overflow-hidden">{props.mobileFallback}</div>}
    >
      <div class="relative w-full h-full min-w-0">
        <div
          class="absolute left-1/2 -translate-x-1/2 bottom-6 z-[60] pointer-events-none transition-all duration-200 ease-out"
          classList={{
            "opacity-100 translate-y-0 scale-100": props.scroll.overflow && props.scroll.jump,
            "opacity-0 translate-y-2 scale-95 pointer-events-none": !props.scroll.overflow || !props.scroll.jump,
          }}
        >
          <button
            class="pointer-events-auto flex items-center justify-center w-10 h-8 bg-transparent border-none cursor-pointer p-0 group"
            onClick={props.onResumeScroll}
          >
            <div
              class="flex items-center justify-center w-8 h-6 rounded-[6px] border border-border-weaker-base bg-[color-mix(in_srgb,var(--surface-raised-stronger-non-alpha)_80%,transparent)] backdrop-blur-[0.75px] transition-colors group-hover:border-[var(--border-weak-base)] group-hover:[--icon-base:var(--icon-hover)]"
              style={{
                "box-shadow":
                  "0 51px 60px 0 rgba(0,0,0,0.10), 0 15px 18px 0 rgba(0,0,0,0.12), 0 6.386px 7.513px 0 rgba(0,0,0,0.12), 0 2.31px 2.717px 0 rgba(0,0,0,0.20)",
              }}
            >
              <Icon name="arrow-down-to-line" size="small" />
            </div>
          </button>
        </div>
        <ScrollView
          viewportRef={(el) => {
            setScrollEl(el)
            props.setScrollRef(el)
          }}
          onWheel={(e) => {
            const root = e.currentTarget
            const delta = normalizeWheelDelta({
              deltaY: e.deltaY,
              deltaMode: e.deltaMode,
              rootHeight: root.clientHeight,
            })
            if (!delta) return
            markBoundaryGesture({ root, target: e.target, delta, onMarkScrollGesture: props.onMarkScrollGesture })
          }}
          onTouchStart={(e) => {
            touchGesture = e.touches[0]?.clientY
          }}
          onTouchMove={(e) => {
            const next = e.touches[0]?.clientY
            const prev = touchGesture
            touchGesture = next
            if (next === undefined || prev === undefined) return

            const delta = prev - next
            if (!delta) return

            const root = e.currentTarget
            markBoundaryGesture({ root, target: e.target, delta, onMarkScrollGesture: props.onMarkScrollGesture })
          }}
          onTouchEnd={() => {
            touchGesture = undefined
          }}
          onTouchCancel={() => {
            touchGesture = undefined
          }}
          onPointerDown={(e) => {
            if (e.target !== e.currentTarget) return
            props.onMarkScrollGesture(e.currentTarget)
          }}
          onScroll={(e) => {
            props.onScheduleScrollState(e.currentTarget)
            props.onTurnBackfillScroll()
            if (!props.hasScrollGesture()) return
            props.onUserScroll()
            props.onAutoScrollHandleScroll()
            props.onMarkScrollGesture(e.currentTarget)
          }}
          onClick={props.onAutoScrollInteraction}
          class="relative min-w-0 w-full h-full"
          style={{
            "--session-title-height": showHeader() ? "40px" : "0px",
            "--sticky-accordion-top": showHeader() ? "48px" : "0px",
          }}
        >
          <div ref={props.setContentRef} class="min-w-0 w-full">
            <Show when={showHeader()}>
              <div
                data-session-title
                classList={{
                  "sticky top-0 z-30 bg-[linear-gradient(to_bottom,var(--os-code-surface,var(--background-stronger))_48px,transparent)]": true,
                  relative: true,
                  "w-full": true,
                  "pb-4": true,
                  // Pin to the floating conversation's top-left; do not center with message body.
                  "pl-4 pr-3 md:pl-5 md:pr-4": true,
                }}
              >
                <div class="h-12 w-full flex items-center justify-between gap-2">
                  <div class="flex items-center gap-1 min-w-0 flex-1 pr-3">
                    <div class="flex items-center min-w-0 grow-1 overflow-hidden">
                      <Show when={parentID()}>
                        <button
                          type="button"
                          data-slot="session-title-parent"
                          class="min-w-0 max-w-[40%] truncate text-14-medium text-text-weak transition-colors hover:text-text-base"
                          onClick={navigateParent}
                        >
                          {parentTitle()}
                        </button>
                        <span
                          data-slot="session-title-separator"
                          class="px-2 text-14-medium text-text-weak"
                          aria-hidden="true"
                        >
                          /
                        </span>
                      </Show>
                      <div
                        class="shrink-0 flex items-center justify-center overflow-hidden transition-[width,margin] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                        style={{
                          width: working() ? "16px" : "0px",
                          "margin-right": working() ? "8px" : "0px",
                        }}
                        aria-hidden="true"
                      >
                        <Show when={workingStatus() !== "hidden"}>
                          <div
                            class="transition-opacity duration-200 ease-out"
                            classList={{ "opacity-0": workingStatus() === "hiding" }}
                          >
                            <Spinner class="size-4" style={{ color: SESSION_BUSY_SPINNER_COLOR }} />
                          </div>
                        </Show>
                      </div>
                      <Show when={childTitle() || title.editing}>
                        <Show
                          when={title.editing}
                          fallback={
                            <SessionTitleLabel
                              full={childTitle()}
                              tag="h1"
                              slot="session-title-child"
                              fit
                              placement="bottom-start"
                              class="block min-w-0 max-w-[42em] truncate text-16-medium text-text-strong"
                              onDblClick={openTitleEditor}
                            />
                          }
                        >
                          <InlineInput
                            ref={(el) => {
                              titleRef = el
                            }}
                            data-slot="session-title-child"
                            value={title.draft}
                            disabled={titleMutation.isPending}
                            class="text-16-medium text-text-strong grow-1 min-w-0 rounded-[6px] pl-1 -ml-1"
                            style={{ "--inline-input-shadow": "var(--shadow-xs-border-select)" }}
                            onInput={(event) => setTitle("draft", event.currentTarget.value)}
                            onKeyDown={(event) => {
                              event.stopPropagation()
                              if (event.key === "Enter") {
                                event.preventDefault()
                                void saveTitleEditor()
                                return
                              }
                              if (event.key === "Escape") {
                                event.preventDefault()
                                closeTitleEditor()
                              }
                            }}
                            onBlur={closeTitleEditor}
                          />
                        </Show>
                      </Show>
                    </div>
                  </div>
                  <Show when={sessionID()} keyed>
                    {(id) => (
                      <div class="shrink-0 flex items-center gap-3">
                        <SessionContextUsage placement="bottom" />
                        <Show when={!parentID()}>
                          <DropdownMenu
                            gutter={4}
                            placement="bottom-end"
                            open={title.menuOpen}
                            onOpenChange={(open) => {
                              setTitle("menuOpen", open)
                              if (open) return
                            }}
                          >
                            <DropdownMenu.Trigger
                              as={IconButton}
                              icon="dot-grid"
                              variant="ghost"
                              class="size-6 rounded-md data-[expanded]:bg-surface-base-active"
                              classList={{
                                "bg-surface-base-active": share.open || title.pendingShare,
                              }}
                              aria-label={language.t("common.moreOptions")}
                              aria-expanded={title.menuOpen || share.open || title.pendingShare}
                              ref={(el: HTMLButtonElement) => {
                                more = el
                              }}
                            />
                            <DropdownMenu.Portal>
                              <DropdownMenu.Content
                                style={{ "min-width": "104px" }}
                                onCloseAutoFocus={(event) => {
                                  if (title.pendingRename) {
                                    event.preventDefault()
                                    setTitle("pendingRename", false)
                                    openTitleEditor()
                                    return
                                  }
                                  if (title.pendingShare) {
                                    event.preventDefault()
                                    requestAnimationFrame(() => {
                                      setShare({ open: true, dismiss: null })
                                      setTitle("pendingShare", false)
                                    })
                                  }
                                }}
                              >
                                <DropdownMenu.Item
                                  onSelect={() => {
                                    setTitle("pendingRename", true)
                                    setTitle("menuOpen", false)
                                  }}
                                >
                                  <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
                                </DropdownMenu.Item>
                                <Show when={shareEnabled()}>
                                  <DropdownMenu.Item
                                    onSelect={() => {
                                      setTitle({ pendingShare: true, menuOpen: false })
                                    }}
                                  >
                                    <DropdownMenu.ItemLabel>
                                      {language.t("session.share.action.share")}
                                    </DropdownMenu.ItemLabel>
                                  </DropdownMenu.Item>
                                </Show>
                                <Show when={!isSharedCasesPath(storedPlatformAuthSession(), sdk.directory)}>
                                  <DropdownMenu.Item onSelect={() => void archiveSession(id)}>
                                    <DropdownMenu.ItemLabel>{language.t("common.archive")}</DropdownMenu.ItemLabel>
                                  </DropdownMenu.Item>
                                  <DropdownMenu.Separator />
                                  <DropdownMenu.Item
                                    onSelect={() => dialog.show(() => <DialogDeleteSession sessionID={id} />)}
                                  >
                                    <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                                  </DropdownMenu.Item>
                                </Show>
                              </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                          </DropdownMenu>

                          <KobaltePopover
                            open={share.open}
                            anchorRef={() => more}
                            placement="bottom-end"
                            gutter={4}
                            modal={false}
                            onOpenChange={(open) => {
                              if (open) setShare("dismiss", null)
                              setShare("open", open)
                            }}
                          >
                            <KobaltePopover.Portal>
                              <KobaltePopover.Content
                                data-component="popover-content"
                                style={{ "min-width": "320px" }}
                                onEscapeKeyDown={(event) => {
                                  setShare({ dismiss: "escape", open: false })
                                  event.preventDefault()
                                  event.stopPropagation()
                                }}
                                onPointerDownOutside={() => {
                                  setShare({ dismiss: "outside", open: false })
                                }}
                                onFocusOutside={() => {
                                  setShare({ dismiss: "outside", open: false })
                                }}
                                onCloseAutoFocus={(event) => {
                                  if (share.dismiss === "outside") event.preventDefault()
                                  setShare("dismiss", null)
                                }}
                              >
                                <div class="flex flex-col p-3">
                                  <div class="flex flex-col gap-1">
                                    <div class="text-13-medium text-text-strong">
                                      {language.t("session.share.popover.title")}
                                    </div>
                                    <div class="text-12-regular text-text-weak">
                                      {shareUrl()
                                        ? language.t("session.share.popover.description.shared")
                                        : language.t("session.share.popover.description.unshared")}
                                    </div>
                                  </div>
                                  <div class="mt-3 flex flex-col gap-2">
                                    <Show
                                      when={shareUrl()}
                                      fallback={
                                        <Button
                                          size="large"
                                          variant="primary"
                                          class="w-full"
                                          onClick={shareSession}
                                          disabled={shareMutation.isPending}
                                        >
                                          {shareMutation.isPending
                                            ? language.t("session.share.action.publishing")
                                            : language.t("session.share.action.publish")}
                                        </Button>
                                      }
                                    >
                                      <div class="flex flex-col gap-2">
                                        <TextField
                                          value={shareUrl() ?? ""}
                                          readOnly
                                          copyable
                                          copyKind="link"
                                          tabIndex={-1}
                                          class="w-full"
                                        />
                                        <div class="grid grid-cols-2 gap-2">
                                          <Button
                                            size="large"
                                            variant="secondary"
                                            class="w-full shadow-none border border-border-weak-base"
                                            onClick={unshareSession}
                                            disabled={unshareMutation.isPending}
                                          >
                                            {unshareMutation.isPending
                                              ? language.t("session.share.action.unpublishing")
                                              : language.t("session.share.action.unpublish")}
                                          </Button>
                                          <Button
                                            size="large"
                                            variant="primary"
                                            class="w-full"
                                            onClick={viewShare}
                                            disabled={unshareMutation.isPending}
                                          >
                                            {language.t("session.share.action.view")}
                                          </Button>
                                        </div>
                                      </div>
                                    </Show>
                                  </div>
                                </div>
                              </KobaltePopover.Content>
                            </KobaltePopover.Portal>
                          </KobaltePopover>
                        </Show>
                      </div>
                    )}
                  </Show>
                </div>
              </div>
            </Show>
            <div
              role="log"
              data-slot="session-turn-list"
              class="flex flex-col items-start justify-start pb-16 transition-[margin]"
              classList={{
                "w-full": true,
                "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered,
                "mt-0.5": props.centered,
                "mt-0": !props.centered,
              }}
            >
              <Show when={props.historyMore}>
                <div class="w-full flex justify-center">
                  <Button
                    variant="ghost"
                    size="large"
                    class="text-12-medium opacity-50"
                    disabled={props.historyLoading}
                    onClick={props.onLoadEarlier}
                  >
                    {props.historyLoading
                      ? language.t("session.messages.loadingEarlier")
                      : language.t("session.messages.loadEarlier")}
                  </Button>
                </div>
              </Show>
              <Show when={timelineRows().length === 0 && (props.historyLoading || props.historyMore)}>
                <div class="w-full px-6 py-16 text-center text-13-regular text-text-weak">
                  {props.historyLoading
                    ? language.t("session.messages.loadingEarlier")
                    : language.t("session.messages.loadEarlier")}
                </div>
              </Show>
              <div class="relative w-full" style={{ height: `${Math.max(virtualizer.getTotalSize(), 0)}px` }}>
                <For each={virtualRowKeys()}>{(rowKey) => <VirtualTimelineRow rowKey={rowKey} />}</For>
                            </div>
            </div>
          </div>
        </ScrollView>
      </div>
    </Show>
  )
}
