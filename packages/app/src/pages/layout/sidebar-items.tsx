import type { Session } from "@opencode-ai/sdk/v2/client"
import { Avatar } from "@opencode-ai/ui/avatar"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { getFilename } from "@opencode-ai/core/util/path"
import { A } from "@solidjs/router"
import { useRouteParams } from "@/hooks/use-route-params"
import { type Accessor, createMemo, For, type JSX, Match, Show, Switch } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { getAvatarColors, type LocalProject, useLayout } from "@/context/layout"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { sessionTitle } from "@/utils/session-title"
import { SessionTitleLabel } from "@/workbench/session-title-label"
import { isSharedCasesPath, storedPlatformAuthSession } from "@/utils/platform-auth"
import { markCodeNewSessionIntent } from "@/code-session-navigation"
import { sessionPermissionRequest } from "../session/composer/session-request-tree"
import { childSessionOnPath, hasProjectPermissions } from "./helpers"

const OPENCODE_PROJECT_ID = "4b0ea68d7af9a6031a7ffda7ad66e0cb83315750"

export function getProjectAvatarSource(id?: string, icon?: { color?: string; url?: string; override?: string }) {
  if (id === OPENCODE_PROJECT_ID) return "/favicon.svg"
  if (icon?.override) return icon?.override
  if (icon?.color) return undefined
  return icon?.url
}

export const ProjectIcon = (props: {
  project: LocalProject
  class?: string
  notify?: boolean
  working?: boolean
}): JSX.Element => {
  const globalSync = useGlobalSync()
  const notification = useNotification()
  const permission = usePermission()
  const dirs = createMemo(() => [props.project.worktree, ...(props.project.sandboxes ?? [])])
  const unseenCount = createMemo(() =>
    dirs().reduce((total, directory) => total + notification.project.unseenCount(directory), 0),
  )
  const hasError = createMemo(() => dirs().some((directory) => notification.project.unseenHasError(directory)))
  const hasPermissions = createMemo(() =>
    dirs().some((directory) => {
      const [store] = globalSync.child(directory, { bootstrap: false })
      return hasProjectPermissions(store.permission, (item) => !permission.autoResponds(item, directory))
    }),
  )
  const notify = createMemo(() => props.notify && (hasPermissions() || unseenCount() > 0))
  const name = createMemo(() => props.project.name || getFilename(props.project.worktree))

  return (
    <div class={`relative size-8 shrink-0 rounded ${props.class ?? ""}`}>
      <div class="size-full rounded overflow-clip">
        <Avatar
          fallback={name()}
          src={getProjectAvatarSource(props.project.id, props.project.icon)}
          {...getAvatarColors(props.project.icon?.color)}
          class="size-full rounded"
          classList={{ "badge-mask": notify() }}
        />
      </div>
      <Show when={notify()}>
        <div
          classList={{
            "absolute top-px right-px size-1.5 rounded-full z-10": true,
            "bg-surface-warning-strong": hasPermissions(),
            "bg-icon-critical-base": !hasPermissions() && hasError(),
            "bg-text-interactive-base": !hasPermissions() && !hasError(),
          }}
        />
      </Show>
      <Show when={props.working}>
        <div class="absolute bottom-px right-px size-3 rounded-full bg-background-base z-10 flex items-center justify-center">
          <Spinner class="size-[9px]" />
        </div>
      </Show>
    </div>
  )
}

export type SessionItemProps = {
  session: Session
  list: Session[]
  navList?: Accessor<Session[]>
  routePrefix?: string
  slug: string
  mobile?: boolean
  dense?: boolean
  showTooltip?: boolean
  showChild?: boolean
  level?: number
  sidebarExpanded: Accessor<boolean>
  clearHoverProjectSoon: () => void
  prefetchSession: (session: Session, priority?: "high" | "low") => void
  archiveSession: (session: Session) => Promise<void>
  showDeleteSessionDialog: (session: Session) => void
  /** When true, hide delete/archive controls (official shared cases). */
  readOnlyActions?: boolean
}

const SESSION_BUSY_SPINNER_COLOR = "var(--os-primary, #AD2830)"

const SessionRow = (props: {
  session: Session
  routePrefix?: string
  slug: string
  mobile?: boolean
  dense?: boolean
  isWorking: Accessor<boolean>
  hasPermissions: Accessor<boolean>
  hasError: Accessor<boolean>
  unseenCount: Accessor<number>
  clearHoverProjectSoon: () => void
  sidebarOpened: Accessor<boolean>
  warmPress: () => void
  warmFocus: () => void
  titleHover?: boolean
}): JSX.Element => {
  const language = useLanguage()
  const fullTitle = () => sessionTitle(props.session.title) ?? language.t("command.session.new")

  return (
    <A
      href={`${props.routePrefix ?? ""}/${props.slug}/session/${props.session.id}`}
      class={`flex items-center gap-2 min-w-0 w-full text-left bg-transparent focus:outline-none ${props.dense ? "py-0.5" : "py-1"}`}
      activeClass="active"
      onPointerDown={props.warmPress}
      onFocus={props.warmFocus}
      onClick={() => {
        if (props.sidebarOpened()) return
        props.clearHoverProjectSoon()
      }}
    >
      <Show when={props.isWorking() || props.hasPermissions() || props.hasError() || props.unseenCount() > 0}>
        <div class="shrink-0 size-6 flex items-center justify-center" style={{ color: SESSION_BUSY_SPINNER_COLOR }}>
          <Switch>
            <Match when={props.isWorking()}>
              <Spinner class="size-[15px]" />
            </Match>
            <Match when={props.hasPermissions()}>
              <div class="size-1.5 rounded-full bg-surface-warning-strong" />
            </Match>
            <Match when={props.hasError()}>
              <div class="size-1.5 rounded-full bg-text-diff-delete-base" />
            </Match>
            <Match when={props.unseenCount() > 0}>
              <div class="size-1.5 rounded-full bg-text-interactive-base" />
            </Match>
          </Switch>
        </div>
      </Show>
      <SessionTitleLabel
        full={fullTitle()}
        hover={props.titleHover}
        class="text-14-regular text-text-strong min-w-0 flex-1 truncate"
      />
    </A>
  )
}

export const SessionItem = (props: SessionItemProps): JSX.Element => {
  const params = useRouteParams()
  const layout = useLayout()
  const language = useLanguage()
  const notification = useNotification()
  const permission = usePermission()
  const globalSync = useGlobalSync()
  const unseenCount = createMemo(() => notification.session.unseenCount(props.session.id))
  const hasError = createMemo(() => notification.session.unseenHasError(props.session.id))
  const [sessionStore] = globalSync.child(props.session.directory, { bootstrap: false })
  const hasPermissions = createMemo(() => {
    return !!sessionPermissionRequest(sessionStore.session, sessionStore.permission, props.session.id, (item) => {
      return !permission.autoResponds(item, props.session.directory)
    })
  })
  const isWorking = createMemo(() => {
    if (hasPermissions()) return false
    return sessionStore.session_working(props.session.id)
  })
  const tooltip = createMemo(() => props.showTooltip ?? (props.mobile || !props.sidebarExpanded()))
  const currentChild = createMemo(() => {
    if (!props.showChild) return
    return childSessionOnPath(sessionStore.session, props.session.id, params.id)
  })

  const warm = (span: number, priority: "high" | "low") => {
    const nav = props.navList?.()
    const list = nav?.some((item) => item.id === props.session.id && item.directory === props.session.directory)
      ? nav
      : props.list

    // Never prefetch *this* session on pointerdown/focus. AlphaFold-sized transcripts
    // race navigation with a multi-page hydrate and freeze the shell before paint.
    // Neighbors stay warm for quick session switching among small chats.
    const idx = list.findIndex((item) => item.id === props.session.id && item.directory === props.session.directory)
    if (idx === -1) return

    for (let step = 1; step <= span; step++) {
      const next = list[idx + step]
      if (next) props.prefetchSession(next, step === 1 ? "high" : priority)

      const prev = list[idx - step]
      if (prev) props.prefetchSession(prev, step === 1 ? "high" : priority)
    }
  }

  // Create a fresh row per Show branch — reusing one JSX node across when/fallback
  // throws HierarchyRequestError when sidebarExpanded (and thus tooltip()) flips.
  const row = () => (
    <SessionRow
      session={props.session}
      routePrefix={props.routePrefix}
      slug={props.slug}
      mobile={props.mobile}
      dense={props.dense}
      isWorking={isWorking}
      hasPermissions={hasPermissions}
      hasError={hasError}
      unseenCount={unseenCount}
      clearHoverProjectSoon={props.clearHoverProjectSoon}
      sidebarOpened={layout.sidebar.opened}
      warmPress={() => warm(2, "high")}
      warmFocus={() => warm(2, "high")}
      titleHover={!tooltip()}
    />
  )

  return (
    <>
      <div
        data-session-id={props.session.id}
        class="group/session relative w-full min-w-0 rounded-lg cursor-default pr-10 transition-colors hover:bg-surface-raised-base-hover [&:has(:focus-visible)]:bg-surface-raised-base-hover has-[[data-expanded]]:bg-surface-raised-base-hover has-[.active]:bg-surface-base-active has-[.active]:hover:bg-surface-base-active"
        style={{ "padding-left": `${8 + (props.level ?? 0) * 16}px` }}
      >
        <div class="flex min-w-0 items-center gap-1">
          <div class="min-w-0 flex-1">
            <Show
              when={!tooltip()}
              fallback={
                <Tooltip
                  placement={props.mobile ? "bottom" : "right"}
                  value={
                    <span class="os-client-session-title-tip">
                      {sessionTitle(props.session.title) ?? language.t("command.session.new")}
                    </span>
                  }
                  gutter={10}
                  class="min-w-0 w-full"
                  contentClass="os-client-session-title-tooltip"
                >
                  {row()}
                </Tooltip>
              }
            >
              {row()}
            </Show>
          </div>

          <Show when={!props.level && !props.readOnlyActions && !isSharedCasesPath(storedPlatformAuthSession(), props.session.directory)}>
            <div
              class="absolute right-1 top-1/2 z-10 -translate-y-1/2 flex items-center gap-0.5 transition-opacity"
              classList={{
                "opacity-100 pointer-events-auto": !!props.mobile,
                "opacity-0 pointer-events-none": !props.mobile,
                "group-hover/session:opacity-100 group-hover/session:pointer-events-auto": true,
                "group-focus-within/session:opacity-100 group-focus-within/session:pointer-events-auto": true,
              }}
            >
              <Tooltip value={language.t("common.delete")} placement="top">
                <IconButton
                  icon="trash"
                  variant="ghost"
                  class="size-6 rounded-md"
                  data-action="session-delete"
                  aria-label={language.t("common.delete")}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    props.showDeleteSessionDialog(props.session)
                  }}
                />
              </Tooltip>
              <Tooltip value={language.t("common.archive")} placement="top">
                <IconButton
                  icon="archive"
                  variant="ghost"
                  class="size-6 rounded-md"
                  data-action="session-archive"
                  aria-label={language.t("common.archive")}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    void props.archiveSession(props.session)
                  }}
                />
              </Tooltip>
            </div>
          </Show>
        </div>
      </div>
      <Show when={currentChild()} keyed>
        {(child) => (
          <div class="w-full">
            <SessionItem {...props} session={child} level={(props.level ?? 0) + 1} />
          </div>
        )}
      </Show>
    </>
  )
}

export const NewSessionItem = (props: {
  routePrefix?: string
  slug: string
  mobile?: boolean
  dense?: boolean
  sidebarExpanded: Accessor<boolean>
  clearHoverProjectSoon: () => void
}): JSX.Element => {
  const layout = useLayout()
  // Match other OneScience sidebar rows (技能管理 etc.) — keep Chinese, ignore EN locale.
  const label = "新建会话"
  const tooltip = () => props.mobile || !props.sidebarExpanded()
  // Fresh node per Show branch — shared JSX across when/fallback breaks on sidebar toggle.
  const link = () => (
    <A
      href={`${props.routePrefix ?? ""}/${props.slug}/session`}
      end
      class={`flex items-center gap-2 min-w-0 w-full text-left bg-transparent focus:outline-none ${props.dense ? "py-0.5" : "py-1"}`}
      activeClass="active"
      onClick={() => {
        markCodeNewSessionIntent(props.slug)
        if (layout.sidebar.opened()) return
        props.clearHoverProjectSoon()
      }}
    >
      <div class="shrink-0 size-6 flex items-center justify-center">
        <Icon name="new-session" size="small" class="text-icon-weak" />
      </div>
      <span class="text-14-regular text-text-strong min-w-0 flex-1 truncate">{label}</span>
    </A>
  )

  return (
    <div
      data-new-session
      class="group/session relative w-full min-w-0 rounded-lg cursor-default transition-colors pl-2 pr-2 hover:bg-surface-raised-base-hover [&:has(:focus-visible)]:bg-surface-raised-base-hover has-[.active]:bg-surface-base-active has-[.active]:hover:bg-surface-base-active"
    >
      <Show
        when={!tooltip()}
        fallback={
          <Tooltip placement={props.mobile ? "bottom" : "right"} value={label} gutter={10} class="min-w-0 w-full">
            {link()}
          </Tooltip>
        }
      >
        {link()}
      </Show>
    </div>
  )
}

export const SessionSkeleton = (props: { count?: number }): JSX.Element => {
  const items = Array.from({ length: props.count ?? 4 }, (_, index) => index)
  return (
    <div class="flex flex-col gap-1">
      <For each={items}>
        {() => <div class="h-8 w-full rounded-md bg-surface-raised-base opacity-60 animate-pulse" />}
      </For>
    </div>
  )
}
