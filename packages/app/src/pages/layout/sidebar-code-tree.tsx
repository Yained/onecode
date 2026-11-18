import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, untrack, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { decode64 } from "@/utils/base64"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { showToast } from "@opencode-ai/ui/toast"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { markCodeNewSessionIntent } from "@/code-session-navigation"
import { StatusPopover } from "@/components/status-popover"
import { SkillManagerDialog } from "@/components/skill-manager-dialog"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { type LocalProject } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { SDKProvider } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { SyncProvider } from "@/context/sync"
import { pathKey } from "@/utils/path-key"
import {
  canWritePlatformPath,
  defaultPlatformProjectDirectory,
  defaultPlatformWorkspaceDirectory,
  isDefaultPlatformProject,
  isSharedCasesPath,
  sharedCasesRoot,
  storedPlatformAuthSession,
} from "@/utils/platform-auth"
import { PRESET_CASE_SESSION_IDS, isPresetCaseSessionId, sortPresetCaseSessions } from "@/pages/preset-cases"
import { displayName, sortedRootSessions } from "./helpers"
import { NewSessionItem, SessionItem, SessionSkeleton, type SessionItemProps } from "./sidebar-items"

export type CodeProjectTreeProps = {
  projects: Accessor<LocalProject[]>
  current: Accessor<LocalProject | undefined>
  defaultDirectory: Accessor<string>
  sortNow: Accessor<number>
  mobile?: boolean
  routePrefix: string
  sessionProps: Omit<SessionItemProps, "session" | "list" | "slug" | "mobile" | "dense" | "showChild">
  sidebarHovering: Accessor<boolean>
  navigateToProject: (directory: string) => void
  closeProject: (directory: string) => void
  deleteProject: (project: LocalProject) => void
  chooseProject: () => void
  showArchivedSessionsDialog: (directory?: string) => void
  setScrollContainerRef?: (el: HTMLDivElement | undefined, mobile?: boolean) => void
}

const SHARED_CASES_SESSION_FETCH_LIMIT = 200
const SHARED_CASES_PREVIEW_LIMIT = 5

const SessionBlock = (props: {
  directory: string
  sortNow: Accessor<number>
  mobile?: boolean
  routePrefix: string
  sessionProps: CodeProjectTreeProps["sessionProps"]
  indent?: boolean
  emptyLabel?: boolean
  previewLimit?: number
  /** When set, only these session IDs are shown (official preset catalog). */
  allowIds?: readonly string[]
  readOnlyActions?: boolean
}): JSX.Element => {
  const globalSync = useGlobalSync()
  const language = useLanguage()
  // Do not bootstrap here — child-store auto /provider fetches stall HTTP/1.1 and delay
  // /global/session. loadSessions uses /global/session (SQLite only).
  const [store, setStore] = globalSync.child(props.directory, { bootstrap: false })
  const [expandedList, setExpandedList] = createSignal(false)
  const slug = createMemo(() => base64Encode(props.directory))
  const sessions = createMemo(() => {
    // Filter by the sidebar directory, not store.path.directory (empty until path query finishes).
    const matched = sortedRootSessions(store, props.sortNow(), props.directory)
    // Never fall back to unfiltered store.session — when path matching is empty (loading /
    // alias mismatch), that leaked shared-catalog rows into personal 「case」 projects.
    if (props.allowIds?.length) {
      const allowed = new Set(props.allowIds)
      return sortPresetCaseSessions(matched.filter((session) => allowed.has(session.id)))
    }
    // Official preset IDs belong only under 默认案例展示; personal projects keep scoped forks.
    return matched.filter((session) => !isPresetCaseSessionId(session.id))
  })
  const count = createMemo(() => sessions().length)
  const previewLimit = () => props.previewLimit
  const visibleSessions = createMemo(() => {
    const limit = previewLimit()
    if (!limit || expandedList()) return sessions()
    return sessions().slice(0, limit)
  })
  const hasServerMore = createMemo(() => !props.allowIds?.length && store.sessionTotal > count())
  const hasPreviewMore = createMemo(() => {
    const limit = previewLimit()
    return !!limit && !expandedList() && count() > limit
  })
  const canExpand = createMemo(() => hasPreviewMore() || hasServerMore())
  const canCollapse = createMemo(() => !!previewLimit() && expandedList() && count() > (previewLimit() ?? 0))
  // Prefer rows as soon as count > 0 (including local snapshot). Delay skeleton so a fast
  // /global/session never paints pulse bars → content (the visible "flash").
  const loading = () => !store.sessionListReady && count() === 0
  const [paintSkeleton, setPaintSkeleton] = createSignal(false)
  createEffect(() => {
    if (!loading()) {
      setPaintSkeleton(false)
      return
    }
    const timer = setTimeout(() => setPaintSkeleton(true), 150)
    onCleanup(() => clearTimeout(timer))
  })
  const loadMore = async () => {
    setStore("limit", (limit) => (limit ?? 0) + 5)
    await globalSync.project.loadSessions(props.directory)
  }
  const revealMore = async () => {
    if (hasPreviewMore()) {
      setExpandedList(true)
      return
    }
    setExpandedList(true)
    if (hasServerMore()) await loadMore()
  }
  const collapseList = () => setExpandedList(false)
  const pad = () => (props.indent ? "pl-4" : "")

  createEffect(() => {
    const directory = props.directory
    if (!directory) return
    untrack(() => {
      void globalSync.project.loadSessions(directory)
    })
  })

  createEffect(() => {
    if (!props.allowIds?.length) return
    if ((store.limit ?? 0) >= SHARED_CASES_SESSION_FETCH_LIMIT) return
    setStore("limit", SHARED_CASES_SESSION_FETCH_LIMIT)
    void globalSync.project.loadSessions(props.directory)
  })

  return (
    <div class="flex flex-col gap-0.5">
      <Show when={paintSkeleton()}>
        <div class={pad()}>
          <SessionSkeleton count={Math.min(previewLimit() ?? 3, 3)} />
        </div>
      </Show>
      <Show when={!loading() && count() === 0 && props.emptyLabel}>
        <div class={`pr-2 py-1 text-13-regular text-text-weak ${props.indent ? "pl-8" : "pl-2"}`}>
          {language.t("sidebar.project.noSessions")}
        </div>
      </Show>
      <For each={visibleSessions()}>
        {(session) => (
          <div class={pad()}>
            <SessionItem
              {...props.sessionProps}
              session={session}
              list={sessions()}
              routePrefix={props.routePrefix}
              slug={slug()}
              mobile={props.mobile}
              dense
              showChild
              readOnlyActions={props.readOnlyActions}
            />
          </div>
        )}
      </For>
      <Show when={canExpand()}>
        <div class={pad()}>
          <button
            type="button"
            data-action="session-load-more"
            class="flex w-full items-center justify-center rounded-lg py-2 text-icon-base transition-colors hover:bg-surface-raised-base-hover hover:text-text-strong"
            aria-label={language.t("common.loadMore")}
            title={language.t("common.loadMore")}
            onClick={(e) => {
              void revealMore()
              ;(e.currentTarget as HTMLButtonElement).blur()
            }}
          >
            <Icon name="chevron-down" size="small" class="text-current" />
          </button>
        </div>
      </Show>
      <Show when={canCollapse() && !canExpand()}>
        <div class={pad()}>
          <button
            type="button"
            data-action="session-collapse-preview"
            class="flex w-full items-center justify-center rounded-lg py-2 text-icon-base transition-colors hover:bg-surface-raised-base-hover hover:text-text-strong"
            aria-label={language.t("session.todo.collapse")}
            title={language.t("session.todo.collapse")}
            onClick={(e) => {
              collapseList()
              ;(e.currentTarget as HTMLButtonElement).blur()
            }}
          >
            <Icon name="chevron-down" size="small" class="rotate-180 text-current" />
          </button>
        </div>
      </Show>
    </div>
  )
}

export const CodeProjectTree = (props: CodeProjectTreeProps): JSX.Element => {
  const language = useLanguage()
  const dialog = useDialog()
  const navigate = useNavigate()
  const platform = usePlatform()
  const settings = useSettings()
  const params = useParams()
  const globalSync = useGlobalSync()
  const defaultDirectory = createMemo(() => props.defaultDirectory())
  const sharedDirectory = createMemo(() => {
    const root = sharedCasesRoot(storedPlatformAuthSession())?.trim()
    if (root) return root
    return defaultDirectory()
  })
  const currentWorktree = createMemo(() => props.current()?.worktree)
  const writableDirectory = (directory: string | undefined) => {
    if (!directory?.trim()) return false
    const session = storedPlatformAuthSession()
    if (isSharedCasesPath(session, directory)) return false
    return canWritePlatformPath(session, directory)
  }
  // 「新建会话」必须落在可写个人工作区；绝不能落到共享 case（只读）或 defaultDirectory。
  const newSessionDirectory = createMemo(() => {
    const current = currentWorktree()
    if (writableDirectory(current)) return current!
    const routeDir = decode64(params.dir) ?? ""
    if (writableDirectory(routeDir)) return routeDir
    const personal = defaultPlatformProjectDirectory(storedPlatformAuthSession())?.trim()
    if (personal && writableDirectory(personal)) return personal
    // Do not fall back to shared-cases / configured default — that produces a read-only "new session".
    return ""
  })
  const newSessionSlug = createMemo(() => {
    const directory = newSessionDirectory()
    return directory ? base64Encode(directory) : ""
  })
  const activeDirectory = createMemo(() => {
    const current = currentWorktree()
    if (writableDirectory(current)) return current!
    const next = newSessionDirectory()
    if (next) return next
    const personal = defaultPlatformProjectDirectory(storedPlatformAuthSession())?.trim()
    if (personal) return personal
    return defaultDirectory()
  })
  const formatPath = (worktree: string) => {
    const home = globalSync.data.path.home
    if (!home || !worktree.startsWith(home)) return worktree
    return `~${worktree.slice(home.length)}`
  }
  const isDesktopBeta = platform.platform === "desktop" && import.meta.env.VITE_OPENCODE_CHANNEL === "beta"
  const showStatus = createMemo(() => !isDesktopBeta || settings.general.showStatus())
  // Route may be under shared cases while 「当前」 project stays personal.
  const onSharedCases = createMemo(() => {
    const routeDir = decode64(params.dir) ?? ""
    if (routeDir && isSharedCasesPath(storedPlatformAuthSession(), routeDir)) return true
    return false
  })
  const defaultWorkspaceDirectory = createMemo(() => defaultPlatformWorkspaceDirectory(storedPlatformAuthSession())?.trim())
  const treeProjects = createMemo(() =>
    props.projects().filter((project) => {
      const key = pathKey(project.worktree)
      if (key === pathKey(defaultDirectory())) return false
      if (key === pathKey(sharedDirectory())) return false
      const workspaceRoot = defaultWorkspaceDirectory()
      if (workspaceRoot && key === pathKey(workspaceRoot)) return false
      if (isSharedCasesPath(storedPlatformAuthSession(), project.worktree)) return false
      return true
    }),
  )
  const [expanded, setExpanded] = createStore<Record<string, boolean>>({})
  const [sharedCasesOpen, setSharedCasesOpen] = createSignal(true)
  const openSkillManager = () => {
    dialog.show(() => <SkillManagerDialog directory={activeDirectory()} />)
  }
  const openProjectUpload = (directory: string) => {
    if (!writableDirectory(directory)) {
      showToast({
        title: language.t("dialog.project.upload.failed"),
        description: language.t("dialog.project.upload.destinationHint"),
        variant: "error",
      })
      return
    }
    void import("@/components/dialog-project-upload").then((mod) => {
      dialog.show(() => <mod.DialogProjectUpload directory={directory} />)
    })
  }
  const openNewSessionInProject = (directory: string) => {
    const slug = base64Encode(directory)
    setExpanded(pathKey(directory), true)
    markCodeNewSessionIntent(slug)
    navigate(`${props.routePrefix}/${slug}/session`)
  }

  // Always track the 「当前」 personal project — including 主空间. Skipping the default
  // workspace previously left 主空间 collapsed, so open chats never appeared underneath.
  const selectedKey = createMemo(() => {
    const current = currentWorktree()
    if (!current) return
    return pathKey(current)
  })

  createEffect(
    on(selectedKey, (key) => {
      if (!key) return
      // Accordion: switching projects collapses every other folder so only the
      // active session list stays visible.
      untrack(() => {
        for (const existing of Object.keys(expanded)) {
          if (existing !== key) setExpanded(existing, false)
        }
      })
      setExpanded(key, true)
    }),
  )

  createEffect(() => {
    if (onSharedCases()) setSharedCasesOpen(true)
  })

  const isExpanded = (worktree: string) => {
    const key = pathKey(worktree)
    // Keep the current project open so its sessions stay visible under 「当前」/主空间.
    if (selectedKey() === key) return true
    if (expanded[key] !== undefined) return expanded[key]
    return false
  }

  const toggleExpanded = (worktree: string) => {
    const key = pathKey(worktree)
    // Current project stays expanded; toggling it would hide the active session list.
    if (selectedKey() === key) return
    setExpanded(key, !isExpanded(worktree))
  }

  return (
    <div
      ref={(el) => props.setScrollContainerRef?.(el, props.mobile)}
      class="size-full flex flex-col min-h-0 gap-6 overflow-y-auto no-scrollbar [overflow-anchor:none] px-1.5 py-3"
      data-component="code-project-tree"
    >
      <section class="shrink-0 flex flex-col gap-0.5">
        <Show when={newSessionSlug()}>
          <NewSessionItem
            routePrefix={props.routePrefix}
            slug={newSessionSlug()}
            mobile={props.mobile}
            dense
            sidebarExpanded={props.sessionProps.sidebarExpanded}
            clearHoverProjectSoon={props.sessionProps.clearHoverProjectSoon}
          />
        </Show>
        <Show when={activeDirectory()}>
          <div
            data-component="sidebar-skill-manager-control"
            class="group/session relative w-full min-w-0 rounded-lg cursor-default transition-colors pl-2 pr-2 hover:bg-surface-raised-base-hover [&:has(:focus-visible)]:bg-surface-raised-base-hover"
          >
            <button
              type="button"
              class="flex items-center gap-2 min-w-0 w-full py-0.5 text-left bg-transparent border-0 shadow-none cursor-default focus:outline-none"
              onClick={() => openSkillManager()}
              aria-label="技能管理"
            >
              <div class="shrink-0 size-6 flex items-center justify-center">
                <Icon name="models" size="small" class="text-icon-weak" />
              </div>
              <span class="text-14-regular text-text-strong min-w-0 flex-1 truncate">技能管理</span>
            </button>
          </div>
        </Show>
        <Show when={showStatus() && activeDirectory()}>
          <SDKProvider directory={activeDirectory}>
            <SyncProvider>
              <div
                data-component="sidebar-integration-control"
                class="group/session relative w-full min-w-0 rounded-lg cursor-default transition-colors pl-2 pr-2 hover:bg-surface-raised-base-hover [&:has(:focus-visible)]:bg-surface-raised-base-hover"
              >
                <StatusPopover dense />
              </div>
            </SyncProvider>
          </SDKProvider>
        </Show>
        <div
          data-component="sidebar-archived-sessions-control"
          class="group/session relative w-full min-w-0 rounded-lg cursor-default transition-colors pl-2 pr-2 hover:bg-surface-raised-base-hover [&:has(:focus-visible)]:bg-surface-raised-base-hover"
        >
          <button
            type="button"
            data-action="workspace-archived-sessions-inline"
            class="flex items-center gap-2 min-w-0 w-full py-0.5 text-left bg-transparent border-0 shadow-none cursor-default focus:outline-none"
            onClick={() => props.showArchivedSessionsDialog()}
            aria-label={language.t("session.archived.title")}
          >
            <div class="shrink-0 size-6 flex items-center justify-center">
              <Icon name="archive" size="small" class="text-icon-weak" />
            </div>
            <span class="text-14-regular text-text-strong min-w-0 flex-1 truncate">
              {language.t("session.archived.title")}
            </span>
          </button>
        </div>
      </section>

      <section
        data-slot="code-sidebar-section"
        data-section="shared-cases"
        class="shrink-0 flex flex-col gap-2 pt-5 order-2"
      >
        <div class="flex items-center justify-between gap-1 px-1">
          <button
            type="button"
            data-action="shared-cases-toggle"
            class="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-left text-12-medium text-text-weak transition-colors hover:bg-surface-raised-base-hover hover:text-text-strong"
            aria-expanded={sharedCasesOpen()}
            aria-label={
              sharedCasesOpen() ? language.t("session.todo.collapse") : language.t("session.todo.expand")
            }
            onClick={() => setSharedCasesOpen((open) => !open)}
          >
            <Icon
              name={sharedCasesOpen() ? "chevron-down" : "chevron-right"}
              size="small"
              class="shrink-0 text-icon-weak"
            />
            <span class="min-w-0 truncate">{language.t("sidebar.section.sharedCases")}</span>
          </button>
        </div>
        <Show when={sharedCasesOpen()}>
          <div class="min-w-0">
            <SessionBlock
              directory={sharedDirectory()}
              sortNow={props.sortNow}
              mobile={props.mobile}
              routePrefix={props.routePrefix}
              sessionProps={props.sessionProps}
              emptyLabel
              previewLimit={SHARED_CASES_PREVIEW_LIMIT}
              allowIds={PRESET_CASE_SESSION_IDS}
              readOnlyActions
            />
          </div>
        </Show>
      </section>

      <section
        data-slot="code-sidebar-section"
        class="flex min-h-0 flex-1 flex-col gap-2 pt-5 pb-3 order-1"
      >
        <div class="flex items-center justify-between gap-2 px-1">
          <div class="px-1 text-12-medium text-text-weak">{language.t("sidebar.section.projects")}</div>
          <Tooltip value={language.t("command.project.open")} placement="top">
            <IconButton
              icon="plus-line"
              variant="ghost"
              class="size-6 rounded-md"
              data-action="project-open"
              aria-label={language.t("command.project.open")}
              onClick={props.chooseProject}
            />
          </Tooltip>
        </div>
        <div class="flex flex-col gap-0.5">
          <Show when={treeProjects().length > 0}>
            <For each={treeProjects()}>
              {(project) => {
                const current = () => {
                  const worktree = currentWorktree()
                  if (!worktree) return false
                  // Keep personal 「当前」 even while the route browses a shared case chat.
                  return pathKey(worktree) === pathKey(project.worktree)
                }
                const open = () => isExpanded(project.worktree)
                const isDefault = () => isDefaultPlatformProject(storedPlatformAuthSession(), project.worktree)
                return (
                  <div class="flex flex-col gap-1 min-w-0">
                    <div
                      data-current-project={current() ? "true" : undefined}
                      class="group/code-project relative flex items-center gap-0.5 min-w-0 rounded-lg py-1.5 pl-1 pr-2 transition-colors"
                      classList={{
                        "bg-surface-base-active": current(),
                        "hover:bg-surface-raised-base-hover": !current(),
                      }}
                    >
                      <button
                        type="button"
                        class="shrink-0 size-6 flex items-center justify-center rounded-md text-icon-base hover:bg-surface-base-hover"
                        data-action="project-toggle"
                        data-project={base64Encode(project.worktree)}
                        aria-expanded={open()}
                        aria-label={open() ? language.t("session.todo.collapse") : language.t("session.todo.expand")}
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleExpanded(project.worktree)
                        }}
                      >
                        <Icon name="folder" size="small" class="text-icon-base" />
                      </button>
                      <Tooltip
                        placement="bottom"
                        gutter={4}
                        openDelay={350}
                        value={formatPath(project.worktree)}
                        class="flex flex-1 min-w-0"
                        contentStyle={{
                          "max-width": "240px",
                          "background-color": "var(--surface-raised-strong)",
                          color: "var(--text-weak)",
                          border: "1px solid var(--border-weak-base)",
                          "box-shadow": "var(--shadow-xxs-border)",
                          "font-family": "var(--font-family-mono)",
                          "font-size": "11px",
                          "font-weight": "400",
                          "line-height": "1.45",
                          "word-break": "break-all",
                          padding: "5px 8px",
                        }}
                      >
                        <button
                          type="button"
                          class="flex flex-1 items-center gap-2 min-w-0 text-left focus:outline-none"
                          data-action="project-switch"
                          data-project={base64Encode(project.worktree)}
                          aria-current={current() ? "page" : undefined}
                          onClick={() => {
                            if (!open()) setExpanded(pathKey(project.worktree), true)
                            // Always navigate so a stale session from another project cannot remain visible
                            // when this project is already the active worktree.
                            props.navigateToProject(project.worktree)
                          }}
                        >
                          <span class="text-13-medium text-text-strong truncate">{displayName(project)}</span>
                        </button>
                      </Tooltip>
                      <div
                        class="shrink-0 flex items-center transition-opacity"
                        classList={{
                          "opacity-100": current() || props.mobile,
                          "opacity-0 group-hover/code-project:opacity-100 group-focus-within/code-project:opacity-100":
                            !current() && !props.mobile,
                        }}
                      >
                        <DropdownMenu modal={!props.sidebarHovering()}>
                          <DropdownMenu.Trigger
                            as={IconButton}
                            icon="more-horizontal"
                            variant="ghost"
                            class="size-6 rounded-md"
                            aria-label={language.t("common.moreOptions")}
                          />
                          <DropdownMenu.Portal>
                            <DropdownMenu.Content class="mt-1 min-w-48">
                              <DropdownMenu.Item
                                data-action="project-new-session"
                                onSelect={() => openNewSessionInProject(project.worktree)}
                              >
                                <div class="flex items-center gap-2">
                                  <Icon name="new-session" size="small" class="text-icon-base" />
                                  <DropdownMenu.ItemLabel>{language.t("command.session.new")}</DropdownMenu.ItemLabel>
                                </div>
                              </DropdownMenu.Item>
                              <Show when={writableDirectory(project.worktree)}>
                                <DropdownMenu.Item
                                  data-action="project-upload"
                                  onSelect={() => openProjectUpload(project.worktree)}
                                >
                                  <div class="flex items-center gap-2">
                                    <Icon name="cloud-upload" size="small" class="text-icon-base" />
                                    <DropdownMenu.ItemLabel>
                                      {language.t("command.project.upload")}
                                    </DropdownMenu.ItemLabel>
                                  </div>
                                </DropdownMenu.Item>
                              </Show>
                              <Show when={!isDefault()}>
                                <DropdownMenu.Item
                                  data-action="project-delete"
                                  onSelect={() => props.deleteProject(project)}
                                >
                                  <div class="flex items-center gap-2">
                                    <Icon name="close-small" size="small" class="text-icon-base" />
                                    <DropdownMenu.ItemLabel>
                                      {language.t("sidebar.project.delete")}
                                    </DropdownMenu.ItemLabel>
                                  </div>
                                </DropdownMenu.Item>
                              </Show>
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu>
                      </div>
                    </div>
                    <Show when={open()}>
                      <SessionBlock
                        directory={project.worktree}
                        sortNow={props.sortNow}
                        mobile={props.mobile}
                        routePrefix={props.routePrefix}
                        sessionProps={props.sessionProps}
                        indent
                        emptyLabel
                      />
                    </Show>
                  </div>
                )
              }}
            </For>
          </Show>
        </div>
      </section>
    </div>
  )
}
