import { A, useLocation, useNavigate } from "@solidjs/router"
import { Mark } from "@opencode-ai/ui/logo"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { Binary } from "@opencode-ai/core/util/binary"
import { base64Encode } from "@opencode-ai/core/util/encode"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, untrack, type JSX } from "solid-js"
import { produce } from "solid-js/store"
import { markCodeNewSessionIntent } from "@/code-session-navigation"
import { DialogCreateProjectFolder } from "@/components/dialog-create-project-folder"
import { DialogEditProject } from "@/components/dialog-edit-project"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { DialogSettings } from "@/components/dialog-settings"
import { setRemoteWorkspaceFor } from "@/components/onescience/remote-workspace"
import {
  disconnectLiveRemoteWorkspace,
  hasArchivedProjectRoots,
  liveRemoteWorkspaceID,
  removeLeftoverRemoteWorkspaces,
  requestProjectRemove,
  sessionUsesLiveRemote,
} from "@/utils/delete-project"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { dropSessionCaches } from "@/context/global-sync/session-cache"
import { clearSessionPrefetch } from "@/context/global-sync/session-prefetch"
import { useLayout, type LocalProject } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { displayName, errorMessage, sortedRootSessions } from "@/pages/layout/helpers"
import { isPresetCaseSessionId, sortPresetCaseSessions } from "@/pages/preset-cases"
import { decode64 } from "@/utils/base64"
import { pathKey } from "@/utils/path-key"
import {
  canWritePlatformPath,
  defaultPlatformProjectDirectory,
  filterPlatformAccountProjects,
  isDefaultPlatformProject,
  isSharedCasesPath,
  platformAuthLoggingOutEvent,
  platformAuthSessionUpdatedEvent,
  platformWorkspaceCacheClearedEvent,
  sharedCasesRoot,
  storedPlatformAuthSession,
} from "@/utils/platform-auth"
import { shouldUseNativeProjectPicker } from "@/utils/project-picker"
import { displaySessionTitle, firstUserMessageText, sessionTitle } from "@/utils/session-title"
import { requirePersonalSpace } from "@/workbench/require-auth"
import { SessionTitleLabel } from "@/workbench/session-title-label"
import { SessionContextMenuContent, MENU_CONTENT_CLASS } from "@/workbench/session-context-menu"
import { capabilityCatalogHref } from "@/workbench/capabilities/selection"
import {
  casesQueryValue,
  isWorkspaceHomePath,
  shellBrandHref,
  shellBrandName,
  workspaceDocsHref,
  workspaceHomeHref,
  workspaceResourcesHref,
  workspaceSessionHref,
  workspaceSkillsHref,
} from "@/workbench/routes"

const SHARED_CASES_PREVIEW_LIMIT = 4
const SHARED_CASES_SESSION_FETCH_LIMIT = 200
const RECENT_SESSIONS_PREVIEW_LIMIT = 4
/** Ignore dismiss from the same click that opened the menu (focusin / leftover pointer). */
const MENU_OPEN_GUARD_MS = 400

function SidebarMoreMenu(props: {
  menuKey: string
  openKey: () => string
  setOpenKey: (key: string) => void
  openedAt: () => number
  triggerClass: string
  label: string
  children: JSX.Element
}) {
  let trigger: HTMLButtonElement | undefined
  const open = () => props.openKey() === props.menuKey
  const toggle = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (open()) props.setOpenKey("")
    else props.setOpenKey(props.menuKey)
  }
  return (
    <DropdownMenu
      modal={false}
      preventScroll={false}
      gutter={6}
      placement="bottom-end"
      open={open()}
      getAnchorRect={() => trigger?.getBoundingClientRect()}
      onOpenChange={(next) => {
        if (next) {
          if (!open()) props.setOpenKey(props.menuKey)
          return
        }
        if (Date.now() - props.openedAt() < MENU_OPEN_GUARD_MS) return
        props.setOpenKey("")
      }}
    >
      <button
        ref={(el) => {
          trigger = el
        }}
        type="button"
        class={props.triggerClass}
        aria-label={props.label}
        aria-expanded={open()}
        aria-haspopup="menu"
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onPointerUp={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onClick={toggle}
      >
        ...
      </button>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          class={MENU_CONTENT_CLASS}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onFocusOutside={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            const target = event.target
            if (target instanceof Node && trigger?.contains(target)) {
              event.preventDefault()
              return
            }
            if (Date.now() - props.openedAt() < MENU_OPEN_GUARD_MS) {
              event.preventDefault()
            }
          }}
          onPointerDown={(event: PointerEvent) => event.stopPropagation()}
        >
          {props.children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}

export function WorkbenchLeftNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const language = useLanguage()
  const layout = useLayout()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const platform = usePlatform()
  const server = useServer()
  const dialog = useDialog()
  const [authEpoch, setAuthEpoch] = createSignal(0)
  const loggedIn = createMemo(() => {
    authEpoch()
    return !!storedPlatformAuthSession()
  })
  const homeActive = () => isWorkspaceHomePath(location.pathname)
  const newSessionDirectory = () => {
    const session = storedPlatformAuthSession()
    const defaultDirectory = defaultPlatformProjectDirectory(session)
    const current = activeDirectory()
    if (!current) return defaultDirectory
    if (isSharedCasesPath(session, current)) return defaultDirectory
    if (canWritePlatformPath(session, current)) return current
    return defaultDirectory
  }
  const newSessionHref = () => {
    const directory = newSessionDirectory()
    return directory ? workspaceSessionHref(directory) : workspaceHomeHref()
  }
  const newSessionActive = () => {
    const directory = newSessionDirectory()
    if (!directory) return homeActive()
    // Highlight only when we are on the bare new-session surface for the resolved
    // project, and that project is the one the user is currently focused on in the
    // sidebar. Otherwise clicking a project row keeps the project selected without
    // also lighting up the top-level 「新建会话」.
    if (activeSessionId()) return false
    const selected = selectedProject() || activeDirectory()
    return selected === directory && location.pathname.startsWith(workspaceSessionHref(directory))
  }
  const capabilitiesHref = () => {
    location.pathname
    location.search
    return capabilityCatalogHref()
  }
  const capabilitiesActive = () => location.pathname.startsWith("/workspace/capabilities")
  const skillsActive = () => location.pathname.startsWith("/workspace/skills")
  const resourcesActive = () => location.pathname.startsWith("/workspace/resources")
  const docsActive = () => location.pathname.startsWith("/workspace/docs")
  const [sharedCasesOpen, setSharedCasesOpen] = createSignal(true)
  const [sharedCasesExpanded, setSharedCasesExpanded] = createSignal(false)
  const [recentExpanded, setRecentExpanded] = createSignal(false)
  const [openMore, setOpenMoreState] = createSignal("")
  let menuOpenedAt = 0
  const setOpenMore = (key: string) => {
    if (key) menuOpenedAt = Date.now()
    setOpenMoreState(key)
  }
  const menuOpenedAtMs = () => menuOpenedAt

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

  const accountProjects = createMemo(() =>
    filterPlatformAccountProjects(layout.projects.list(), storedPlatformAuthSession()),
  )
  // Auto-created `default` is a session bucket, not a user-facing project.
  const projects = createMemo(() =>
    accountProjects().filter((project) => !isDefaultPlatformProject(storedPlatformAuthSession(), project.worktree)),
  )
  const defaultDirectory = createMemo(() => defaultPlatformProjectDirectory(storedPlatformAuthSession())?.trim() || "")

  const sharedDirectory = createMemo(() => sharedCasesRoot(storedPlatformAuthSession())?.trim() || "")

  const activeDirectory = createMemo(() => {
    const slug = /^\/workspace\/([^/]+)\/session/.exec(location.pathname)?.[1]
    if (!slug) return ""
    return decode64(slug) ?? ""
  })

  const activeSessionId = () => /\/session\/([^/?#]+)/.exec(location.pathname)?.[1]
  const [selectedProject, setSelectedProject] = createSignal("")

  createEffect(() => {
    const directory = activeDirectory()
    if (directory) setSelectedProject(directory)
  })

  const projectActive = (project: LocalProject) => {
    const directory = selectedProject() || activeDirectory()
    if (!directory) return false
    const key = pathKey(directory)
    if (pathKey(project.worktree) === key) return true
    return project.sandboxes?.some((sandbox) => pathKey(sandbox) === key) ?? false
  }

  createEffect(() => {
    if (!loggedIn()) return
    // Only warm default + the active session directory. Loading every restored
    // worktree + sandbox at once saturates HTTP/1.1 and freezes /workspace clicks.
    // Expand / click paths call loadSessions for other projects on demand.
    const directories = [defaultDirectory(), activeDirectory()].filter(
      (directory, index, all) => directory.length > 0 && all.indexOf(directory) === index,
    )
    for (const directory of directories) {
      untrack(() => {
        void globalSync.project.loadSessions(directory)
      })
    }
  })

  createEffect(() => {
    // Shared cases (limit 200) — defer until not on bare welcome home.
    if (isWorkspaceHomePath(location.pathname)) return
    const directory = sharedDirectory()
    if (!directory) return
    const [store, setStore] = globalSync.child(directory, { bootstrap: false })
    if ((store.limit ?? 0) < SHARED_CASES_SESSION_FETCH_LIMIT) {
      setStore("limit", SHARED_CASES_SESSION_FETCH_LIMIT)
    }
    untrack(() => {
      void globalSync.project.loadSessions(directory)
    })
  })

  // 「未分类」就是自动创建的 default 项目（会话存在 default 目录下）。
  const recentSessions = createMemo(() => {
    const directory = defaultDirectory()
    if (!directory) return []
    const [store] = globalSync.child(directory, { bootstrap: false })
    return sortedRootSessions(store, Date.now(), directory).map((session) => ({ session, directory }))
  })

  const visibleRecent = createMemo(() => {
    if (recentExpanded()) return recentSessions()
    return recentSessions().slice(0, RECENT_SESSIONS_PREVIEW_LIMIT)
  })

  const canExpandRecent = createMemo(
    () => !recentExpanded() && recentSessions().length > RECENT_SESSIONS_PREVIEW_LIMIT,
  )

  const canCollapseRecent = createMemo(
    () => recentExpanded() && recentSessions().length > RECENT_SESSIONS_PREVIEW_LIMIT,
  )

  const sharedCases = createMemo(() => {
    const directory = sharedDirectory()
    if (!directory) return []
    const [store] = globalSync.child(directory, { bootstrap: false })
    return sortPresetCaseSessions(
      sortedRootSessions(store, Date.now(), directory).filter((session) => isPresetCaseSessionId(session.id)),
    )
  })

  const visibleSharedCases = createMemo(() => {
    if (!sharedCasesOpen()) return []
    if (sharedCasesExpanded()) return sharedCases()
    return sharedCases().slice(0, SHARED_CASES_PREVIEW_LIMIT)
  })

  const canExpandSharedCases = createMemo(
    () => sharedCasesOpen() && !sharedCasesExpanded() && sharedCases().length > SHARED_CASES_PREVIEW_LIMIT,
  )

  const canCollapseSharedCases = createMemo(
    () => sharedCasesOpen() && sharedCasesExpanded() && sharedCases().length > SHARED_CASES_PREVIEW_LIMIT,
  )

  // Marketing / legacy `?cases=` and preset session routes: expand 默认案例 and open the target session.
  createEffect(() => {
    const cases = casesQueryValue(location.search)
    const sessionId = activeSessionId()
    const focusId = cases && cases !== "open" ? cases : isPresetCaseSessionId(sessionId) ? sessionId : undefined
    if (cases || focusId) setSharedCasesOpen(true)
    if (focusId) {
      const index = sharedCases().findIndex((session) => session.id === focusId)
      if (index >= SHARED_CASES_PREVIEW_LIMIT) setSharedCasesExpanded(true)
    }
    if (!cases || cases === "open") return
    const directory = sharedDirectory()
    if (!directory) return
    if (sessionId === cases) return
    navigate(workspaceSessionHref(directory, cases), { replace: true })
  })

  function selectProject(directory: string) {
    setSelectedProject(directory)
    layout.projects.open(directory)
    // Stay on the current page. Navigating to /workspace/:dir/session remounts
    // the session/welcome provider tree and freezes clicks (SSH env bar + Session).
    queueMicrotask(() => {
      void globalSync.project.loadSessions(directory)
    })
  }

  function openProject(directory: string, navigateAfter = true) {
    setSelectedProject(directory)
    if (navigateAfter) {
      navigate(workspaceSessionHref(directory))
      queueMicrotask(() => {
        layout.projects.open(directory)
        server.projects.touchCode(directory)
      })
      return
    }
    layout.projects.open(directory)
    server.projects.touchCode(directory)
  }

  function createProjectFolder() {
    dialog.show(() => <DialogCreateProjectFolder onCreated={(directory) => openProject(directory)} />)
  }

  function renameProject(project: LocalProject) {
    dialog.show(() => <DialogEditProject project={project} />)
  }

  function removeProjectFromView(project: LocalProject) {
    const directory = project.worktree
    if (isDefaultPlatformProject(storedPlatformAuthSession(), directory)) return

    const list = projects()
    const key = pathKey(directory)
    const index = list.findIndex((item) => pathKey(item.worktree) === key)
    if (index === -1) return

    const active = projectActive(project)
    layout.projects.close(directory)
    if (pathKey(selectedProject()) === key) {
      const next = list[index + 1] ?? list[index - 1]
      setSelectedProject(next?.worktree ?? "")
    }
    if (active && activeDirectory() && pathKey(activeDirectory()) === key) {
      navigate("/workspace")
    }
  }

  function purgeDeletedProjectState(directory: string) {
    const [child, setChild] = globalSync.child(directory, { bootstrap: false })
    const ids = child.session.map((session) => session.id)
    clearSessionPrefetch(directory, ids)
    globalSync.session.setActive(directory, undefined)
    setChild(
      produce((draft) => {
        dropSessionCaches(draft, ids)
        draft.session = []
      }),
    )
    setRemoteWorkspaceFor(directory, undefined)
    globalSync.set(
      "project",
      produce((draft) => {
        const index = draft.findIndex((item) => pathKey(item.worktree) === pathKey(directory))
        if (index >= 0) draft.splice(index, 1)
      }),
    )
  }

  async function deleteProject(project: LocalProject) {
    if (isDefaultPlatformProject(storedPlatformAuthSession(), project.worktree)) return false
    const directory = project.worktree
    const list = projects()
    const key = pathKey(directory)
    const index = list.findIndex((item) => pathKey(item.worktree) === key)
    const active = projectActive(project)

    const archived = await hasArchivedProjectRoots(globalSDK.client, directory)
    if (archived) {
      showToast({
        title: language.t("sidebar.project.delete.failed"),
        description: language.t("sidebar.project.delete.hasArchived"),
      })
      return false
    }

    const [child] = globalSync.child(directory, { bootstrap: false })
    const remoteSessionIDs = (child.session ?? [])
      .filter((session) => sessionUsesLiveRemote({ directory, workspaceID: session.workspaceID }))
      .map((session) => session.id)
    if (liveRemoteWorkspaceID(directory) || remoteSessionIDs.length > 0) {
      const disconnected = await disconnectLiveRemoteWorkspace(
        globalSDK.client,
        directory,
        remoteSessionIDs.length > 0 ? remoteSessionIDs : (child.session ?? []).map((session) => session.id),
      )
      if (!disconnected.ok) {
        showToast({
          title: language.t("sidebar.project.delete.failed"),
          description: errorMessage(disconnected.error, language.t("sidebar.project.delete.disconnectFailed")),
        })
        return false
      }
    }

    await removeLeftoverRemoteWorkspaces(globalSDK.client, directory)

    const result = await requestProjectRemove(globalSDK.client, directory)
    if (!result.ok) {
      showToast({
        title: language.t("sidebar.project.delete.failed"),
        description: errorMessage(result.error, language.t("common.requestFailed")),
      })
      return false
    }

    purgeDeletedProjectState(directory)
    layout.projects.close(directory)
    if (active) {
      const next = index >= 0 ? (list[index + 1] ?? list[index - 1]) : undefined
      setSelectedProject(next?.worktree ?? "")
      if (activeDirectory()) navigate("/workspace")
    }
    return true
  }

  function DialogDeleteProject(props: { project: LocalProject }) {
    const name = createMemo(() => displayName(props.project))
    const [deleting, setDeleting] = createSignal(false)
    const [archivedBlock, setArchivedBlock] = createSignal<"checking" | "blocked" | "ok">("ok")

    onMount(() => {
      void hasArchivedProjectRoots(globalSDK.client, props.project.worktree).then((blocked) => {
        setArchivedBlock(blocked ? "blocked" : "ok")
      })
    })

    const handleDelete = async () => {
      if (deleting() || archivedBlock() !== "ok") return
      setDeleting(true)
      const ok = await deleteProject(props.project)
      setDeleting(false)
      if (!ok) return
      dialog.close()
    }

    return (
      <Dialog title={language.t("sidebar.project.delete.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <span class="text-14-regular text-text-strong">
            {archivedBlock() === "blocked"
              ? language.t("sidebar.project.delete.hasArchived")
              : language.t("sidebar.project.delete.confirm", { name: name() })}
          </span>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" disabled={deleting()} onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Show when={archivedBlock() !== "blocked"}>
              <Button
                variant="primary"
                size="large"
                disabled={deleting() || archivedBlock() === "checking"}
                onClick={() => void handleDelete()}
              >
                {deleting() ? language.t("sidebar.project.delete.busy") : language.t("sidebar.project.delete.button")}
              </Button>
            </Show>
          </div>
        </div>
      </Dialog>
    )
  }

  function confirmDeleteProject(project: LocalProject) {
    if (isDefaultPlatformProject(storedPlatformAuthSession(), project.worktree)) return
    dialog.show(() => <DialogDeleteProject project={project} />)
  }

  async function chooseProject() {
    const nativePicker = platform.openDirectoryPickerDialog
    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        result.forEach((directory, index) => openProject(directory, index === 0))
        return
      }
      if (result) openProject(result)
    }

    if (
      nativePicker &&
      shouldUseNativeProjectPicker({
        hasNativePicker: !!nativePicker,
        isLocalServer: !!server.isLocal(),
        hasPlatformSession: !!storedPlatformAuthSession(),
      })
    ) {
      const result = await nativePicker({
        title: language.t("command.project.open"),
        multiple: true,
      })
      resolve(result)
      return
    }

    dialog.show(
      () => (
        <DialogSelectDirectory
          multiple={true}
          onSelect={resolve}
          onCreateFolder={createProjectFolder}
        />
      ),
      () => resolve(null),
    )
  }

  function openNewProject() {
    if (
      !requirePersonalSpace({
        navigate,
        action: { type: "install", resourceId: "__project__" },
        isLoggedIn: loggedIn(),
      })
    ) {
      return
    }
    void chooseProject()
  }

  function openNewTask() {
    if (
      !requirePersonalSpace({
        navigate,
        action: { type: "install", resourceId: "__task__" },
        isLoggedIn: loggedIn(),
      })
    ) {
      return
    }

    const directory = defaultPlatformProjectDirectory(storedPlatformAuthSession())
    if (!directory) return

    markCodeNewSessionIntent(base64Encode(directory))
    openProject(directory)
    navigate(workspaceSessionHref(directory))
  }

  function openNewSessionInProject(directory: string) {
    if (
      !requirePersonalSpace({
        navigate,
        action: { type: "install", resourceId: "__task__" },
        isLoggedIn: loggedIn(),
      })
    ) {
      return
    }
    markCodeNewSessionIntent(base64Encode(directory))
    openProject(directory)
  }

  function writableDirectory(directory: string) {
    const session = storedPlatformAuthSession()
    if (isSharedCasesPath(session, directory)) return false
    return canWritePlatformPath(session, directory)
  }

  function openProjectUpload(directory: string) {
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

  function leaveSessionIfActive(session: Session) {
    if (activeSessionId() !== session.id) return
    const directory = activeDirectory()
    if (!directory) {
      navigate("/workspace")
      return
    }
    navigate(workspaceSessionHref(directory))
  }

  function removeSessionFromStore(directory: string, sessionID: string) {
    const [, setStore] = globalSync.child(directory, { bootstrap: false })
    setStore(
      produce((draft) => {
        const match = Binary.search(draft.session, sessionID, (item) => item.id)
        if (!match.found) return
        const removed = draft.session[match.index]
        draft.session.splice(match.index, 1)
        if (removed && !removed.parentID) draft.sessionTotal = Math.max(0, draft.sessionTotal - 1)
      }),
    )
  }

  async function archiveRecentSession(session: Session) {
    removeSessionFromStore(session.directory, session.id)
    leaveSessionIfActive(session)
    const ok = await globalSDK.client.session
      .update({
        directory: session.directory,
        sessionID: session.id,
        time: { archived: Date.now() },
      })
      .then(() => true)
      .catch((err) => {
        showToast({
          title: language.t("common.archive"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return false
      })
    if (!ok) void globalSync.project.loadSessions(session.directory)
  }

  async function deleteRecentSession(session: Session) {
    const directory = session.directory
    if (sessionUsesLiveRemote(session) || liveRemoteWorkspaceID(directory)) {
      const disconnected = await disconnectLiveRemoteWorkspace(globalSDK.client, directory, [session.id])
      if (!disconnected.ok) {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(disconnected.error, language.t("session.delete.disconnectFailed")),
        })
        return false
      }
    }
    const result = await globalSDK.client.session
      .delete({ sessionID: session.id, directory })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return false
      })
    if (!result) return false
    removeSessionFromStore(directory, session.id)
    leaveSessionIfActive(session)
    return true
  }

  function DialogDeleteRecentSession(props: { session: Session }) {
    const name = createMemo(() => sessionLabel(props.session))
    const [deleting, setDeleting] = createSignal(false)
    const handleDelete = async () => {
      if (deleting()) return
      setDeleting(true)
      const ok = await deleteRecentSession(props.session)
      setDeleting(false)
      if (ok) dialog.close()
    }
    return (
      <Dialog title={language.t("session.delete.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <span class="text-14-regular text-text-strong">
            {language.t("session.delete.confirm", { name: name() })}
          </span>
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

  function confirmDeleteRecentSession(session: Session) {
    dialog.show(() => <DialogDeleteRecentSession session={session} />)
  }

  function projectSessions(directory: string) {
    const [store] = globalSync.child(directory, { bootstrap: false })
    return sortedRootSessions(store, Date.now(), directory).map((session) => ({ session, directory }))
  }

  function sessionLabel(session: Session) {
    const [store] = globalSync.child(session.directory, { bootstrap: false })
    return displaySessionTitle({
      title: session.title,
      fallbackText: firstUserMessageText(session.id, store.message, store.part),
      emptyLabel: language.t("command.session.new"),
    })
  }

  function confirmMoveSession(session: Session, targetDirectory: string) {
    if (pathKey(session.directory) === pathKey(targetDirectory)) return
    if (!isDefaultPlatformProject(storedPlatformAuthSession(), session.directory)) {
      showToast({
        title: language.t("session.move.failed.title"),
        description: language.t("session.move.failed.onlyDefault"),
      })
      return
    }
    if (isDefaultPlatformProject(storedPlatformAuthSession(), targetDirectory)) {
      showToast({
        title: language.t("session.move.failed.title"),
        description: language.t("session.move.failed.onlyDefault"),
      })
      return
    }

    const projectName = displayName({ worktree: targetDirectory })
    dialog.show(() => (
      <Dialog title={language.t("session.move.confirm.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <span class="text-14-regular text-text-strong">
            {language.t("session.move.confirm.description", { project: projectName })}
          </span>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={() => {
                void moveSession(session, targetDirectory).then((ok) => {
                  if (ok) dialog.close()
                })
              }}
            >
              {language.t("session.move.confirm.action")}
            </Button>
          </div>
        </div>
      </Dialog>
    ))
  }

  async function moveSession(session: Session, targetDirectory: string) {
    const sourceDirectory = session.directory
    const ok = await globalSDK.client.session
      .update({
        directory: session.directory,
        sessionID: session.id,
        moveTo: targetDirectory,
      })
      .then(() => true)
      .catch((err) => {
        showToast({
          title: language.t("session.move.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return false
      })
    if (!ok) return false
    removeSessionFromStore(sourceDirectory, session.id)
    layout.projects.open(targetDirectory)
    server.projects.touchCode(targetDirectory)
    void globalSync.project.loadSessions(sourceDirectory)
    void globalSync.project.loadSessions(targetDirectory)
    if (activeSessionId() === session.id) {
      navigate(workspaceSessionHref(targetDirectory, session.id))
      return true
    }
    showToast({
      title: language.t("session.move.success.title"),
      description: language.t("session.move.success.description", {
        project: displayName({ worktree: targetDirectory }),
      }),
    })
    return true
  }

  function openSettings() {
    dialog.show(() => <DialogSettings tab="account" />)
  }

  return (
    <aside class="os-sidebar">
      <div
        class="os-sidebar-brand"
        {...(platform.platform === "desktop" ? { "data-tauri-drag-region": true } : {})}
      >
        <A href={shellBrandHref(platform.platform)} class="os-sidebar-brand-link">
          <Mark class="os-sidebar-brand-mark" />
          <span class="os-sidebar-label">{shellBrandName(platform.platform)}</span>
        </A>
      </div>
      <nav class="os-sidebar-nav">
        <div class="os-sidebar-nav-scroll">
          <div class="os-sidebar-group os-client-capability-group">
            <A
              href={newSessionHref()}
              class="os-sidebar-link"
              classList={{ "is-active": newSessionActive() }}
              onClick={() => {
                const directory = newSessionDirectory()
                if (!directory) return
                markCodeNewSessionIntent(base64Encode(directory))
                layout.projects.open(directory)
              }}
            >
              <svg class="os-sidebar-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span class="os-sidebar-label">新建会话</span>
            </A>
            <A
              href={capabilitiesHref()}
              class="os-sidebar-link"
              classList={{ "is-active": capabilitiesActive() }}
            >
              <svg class="os-sidebar-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 5h5v5H5z" />
                <path d="M14 5h5v5h-5z" />
                <path d="M5 14h5v5H5z" />
                <path d="M14 14h5v5h-5z" />
              </svg>
              <span class="os-sidebar-label">能力中心</span>
            </A>
            <A
              href={workspaceSkillsHref()}
              class="os-sidebar-link"
              classList={{ "is-active": skillsActive() }}
            >
              <svg class="os-sidebar-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.5-3.5a5.8 5.8 0 0 1-7.6 7.6l-6.8 6.8a2.1 2.1 0 0 1-3-3l6.8-6.8a5.8 5.8 0 0 1 7.6-7.6z" />
              </svg>
              <span class="os-sidebar-label">skills设置</span>
            </A>
            <A
              href={workspaceResourcesHref()}
              class="os-sidebar-link"
              classList={{ "is-active": resourcesActive() }}
            >
              <svg class="os-sidebar-icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="4" width="18" height="6" rx="1.5" />
                <rect x="3" y="14" width="18" height="6" rx="1.5" />
                <path d="M7 7h.01" />
                <path d="M7 17h.01" />
              </svg>
              <span class="os-sidebar-label">资源配置</span>
            </A>
          </div>

          <div class="os-sidebar-group os-client-list-section">
            <div class="os-client-section-title">
              <span>项目</span>
              <span class="os-client-section-actions">
                <button
                  type="button"
                  aria-label="新建项目"
                  classList={{ "is-muted": !loggedIn() }}
                  onClick={openNewProject}
                >
                  +
                </button>
              </span>
            </div>
            <div class="os-client-project-list">
              <Show
                when={loggedIn() && projects().length > 0}
                fallback={
                  <Show when={loggedIn()}>
                    <p class="os-client-empty-hint">暂无项目，点击 + 打开目录</p>
                  </Show>
                }
              >
                <For each={projects().map((item) => item.worktree)}>
                  {(worktree) => {
                    const project = () => projects().find((item) => item.worktree === worktree)
                    return (
                    <Show when={project()}>
                    {(current) => (
                    <div class="os-client-project-block">
                      <div
                        class="os-client-project-row"
                        classList={{
                          "is-active": projectActive(current()),
                          "is-menu-open": openMore() === `project:${worktree}`,
                        }}
                      >
                        <button
                          type="button"
                          class="os-client-project-item"
                          classList={{ "is-active": projectActive(current()) }}
                          onClick={() => selectProject(worktree)}
                        >
                          {displayName(current())}
                        </button>
                        <SidebarMoreMenu
                          menuKey={`project:${worktree}`}
                          openKey={openMore}
                          setOpenKey={setOpenMore}
                          openedAt={menuOpenedAtMs}
                          triggerClass="os-client-project-more"
                          label={language.t("common.moreOptions")}
                        >
                          <DropdownMenu.Item
                            data-action="project-new-session"
                            class="os-client-session-menu-item"
                            onSelect={() => openNewSessionInProject(worktree)}
                          >
                            <Icon name="new-session" size="small" class="os-client-session-menu-icon" />
                            <DropdownMenu.ItemLabel class="os-client-session-menu-label">
                              {language.t("command.session.new")}
                            </DropdownMenu.ItemLabel>
                          </DropdownMenu.Item>
                          <Show when={writableDirectory(worktree)}>
                            <DropdownMenu.Item
                              data-action="project-upload"
                              class="os-client-session-menu-item"
                              onSelect={() => openProjectUpload(worktree)}
                            >
                              <Icon name="cloud-upload" size="small" class="os-client-session-menu-icon" />
                              <DropdownMenu.ItemLabel class="os-client-session-menu-label">
                                {language.t("command.project.upload")}
                              </DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                          </Show>
                          <DropdownMenu.Item
                            data-action="project-rename"
                            class="os-client-session-menu-item"
                            onSelect={() => {
                              const next = project()
                              if (next) renameProject(next)
                            }}
                          >
                            <Icon name="edit" size="small" class="os-client-session-menu-icon" />
                            <DropdownMenu.ItemLabel class="os-client-session-menu-label">
                              {language.t("common.rename")}
                            </DropdownMenu.ItemLabel>
                          </DropdownMenu.Item>
                          <DropdownMenu.Separator class="os-client-session-menu-separator" />
                          <DropdownMenu.Item
                            data-action="project-remove-from-view"
                            class="os-client-session-menu-item"
                            onSelect={() => {
                              const next = project()
                              if (next) removeProjectFromView(next)
                            }}
                          >
                            <Icon name="close-small" size="small" class="os-client-session-menu-icon" />
                            <DropdownMenu.ItemLabel class="os-client-session-menu-label">
                              {language.t("sidebar.project.removeFromView")}
                            </DropdownMenu.ItemLabel>
                          </DropdownMenu.Item>
                          <DropdownMenu.Item
                            data-action="project-delete"
                            class="os-client-session-menu-item is-danger"
                            onSelect={() => {
                              const next = project()
                              if (next) confirmDeleteProject(next)
                            }}
                          >
                            <Icon name="trash" size="small" class="os-client-session-menu-icon" />
                            <DropdownMenu.ItemLabel class="os-client-session-menu-label">
                              {language.t("sidebar.project.delete")}
                            </DropdownMenu.ItemLabel>
                          </DropdownMenu.Item>
                        </SidebarMoreMenu>
                      </div>
                      <Show when={projectActive(current())}>
                        <div class="os-client-project-sessions">
                          <For each={projectSessions(worktree).map((task) => task.session.id)}>
                            {(sessionID) => {
                              const task = () =>
                                projectSessions(worktree).find((item) => item.session.id === sessionID)
                              return (
                              <Show when={task()}>
                              {(currentTask) => (
                              <div
                                class="os-client-session-row"
                                classList={{
                                  "is-active": activeSessionId() === sessionID,
                                  "is-menu-open": openMore() === `session:${sessionID}`,
                                }}
                              >
                                <A
                                  href={workspaceSessionHref(currentTask().directory, sessionID)}
                                  class="os-client-task-item"
                                  classList={{ "is-active": activeSessionId() === sessionID }}
                                  data-session-id={sessionID}
                                >
                                  <span class="os-client-task-main">
                                    <SessionTitleLabel full={sessionLabel(currentTask().session)} />
                                  </span>
                                </A>
                                <SidebarMoreMenu
                                  menuKey={`session:${sessionID}`}
                                  openKey={openMore}
                                  setOpenKey={setOpenMore}
                                  openedAt={menuOpenedAtMs}
                                  triggerClass="os-client-session-more"
                                  label={language.t("common.moreOptions")}
                                >
                                  <SessionContextMenuContent
                                    currentDirectory={currentTask().directory}
                                    projects={projects}
                                    onArchive={() => void archiveRecentSession(currentTask().session)}
                                    onDelete={() => confirmDeleteRecentSession(currentTask().session)}
                                    onMove={(target) => confirmMoveSession(currentTask().session, target)}
                                    onNewProject={openNewProject}
                                  />
                                </SidebarMoreMenu>
                              </div>
                              )}
                              </Show>
                              )
                            }}
                          </For>
                        </div>
                      </Show>
                    </div>
                    )}
                    </Show>
                    )
                  }}
                </For>
              </Show>
            </div>
            <Show when={!loggedIn()}>
              <p class="os-client-empty-hint">登录后同步个人空间</p>
            </Show>
          </div>

          <div class="os-sidebar-group os-client-list-section">
            <div class="os-client-section-title">
              <span>未分类</span>
              <span class="os-client-section-actions">
                <button
                  type="button"
                  aria-label="新建会话"
                  classList={{ "is-muted": !loggedIn() }}
                  onClick={openNewTask}
                >
                  +
                </button>
              </span>
            </div>
            <div class="os-client-task-list">
              <Show
                when={loggedIn() && recentSessions().length > 0}
                fallback={
                  <Show when={loggedIn()}>
                    <p class="os-client-empty-hint">暂无未分类会话，点击 + 新建</p>
                  </Show>
                }
              >
                <div
                  class="os-client-task-list-scroll"
                  data-expanded={recentExpanded() ? "true" : "false"}
                >
                  <For each={visibleRecent().map((task) => task.session.id)}>
                    {(sessionID) => {
                      const task = () => visibleRecent().find((item) => item.session.id === sessionID)
                      return (
                      <Show when={task()}>
                      {(currentTask) => (
                      <div
                        class="os-client-session-row"
                        classList={{
                          "is-active": activeSessionId() === sessionID,
                          "is-menu-open": openMore() === `recent:${sessionID}`,
                        }}
                      >
                        <A
                          href={workspaceSessionHref(currentTask().directory, sessionID)}
                          class="os-client-task-item"
                          classList={{ "is-active": activeSessionId() === sessionID }}
                          data-session-id={sessionID}
                        >
                          <span class="os-client-task-main">
                            <SessionTitleLabel full={sessionLabel(currentTask().session)} />
                          </span>
                        </A>
                        <SidebarMoreMenu
                          menuKey={`recent:${sessionID}`}
                          openKey={openMore}
                          setOpenKey={setOpenMore}
                          openedAt={menuOpenedAtMs}
                          triggerClass="os-client-session-more"
                          label={language.t("common.moreOptions")}
                        >
                          <SessionContextMenuContent
                            currentDirectory={currentTask().directory}
                            projects={projects}
                            onArchive={() => void archiveRecentSession(currentTask().session)}
                            onDelete={() => confirmDeleteRecentSession(currentTask().session)}
                            onMove={(target) => confirmMoveSession(currentTask().session, target)}
                            onNewProject={openNewProject}
                          />
                        </SidebarMoreMenu>
                      </div>
                      )}
                      </Show>
                      )
                    }}
                  </For>
                </div>
                <Show when={canExpandRecent()}>
                  <button
                    type="button"
                    class="os-client-task-more"
                    data-action="recent-expand"
                    onClick={() => setRecentExpanded(true)}
                  >
                    展开更多
                  </button>
                </Show>
                <Show when={canCollapseRecent()}>
                  <button
                    type="button"
                    class="os-client-task-more"
                    data-action="recent-collapse"
                    onClick={() => setRecentExpanded(false)}
                  >
                    收起
                  </button>
                </Show>
              </Show>
            </div>
            <Show when={!loggedIn()}>
              <p class="os-client-empty-hint">登录后查看未分类会话</p>
            </Show>
          </div>
        </div>

        <Show when={sharedDirectory()}>
          <section class="os-sidebar-group os-client-shared-cases" data-section="shared-cases">
            <button
              type="button"
              class="os-client-shared-cases-toggle"
              data-action="shared-cases-toggle"
              aria-expanded={sharedCasesOpen()}
              onClick={() => setSharedCasesOpen((open) => !open)}
            >
              <span class="os-client-shared-cases-chevron" data-open={sharedCasesOpen() ? "true" : "false"} aria-hidden="true" />
              <span>{language.t("sidebar.section.sharedCases")}</span>
            </button>
            <Show when={sharedCasesOpen()}>
              <div class="os-client-shared-cases-list">
                <Show
                  when={visibleSharedCases().length > 0}
                  fallback={<p class="os-client-empty-hint">暂无默认案例</p>}
                >
                  <For each={visibleSharedCases()}>
                    {(session) => (
                      <A
                        href={workspaceSessionHref(sharedDirectory(), session.id)}
                        class="os-client-task-item"
                        classList={{ "is-active": activeSessionId() === session.id }}
                        data-session-id={session.id}
                      >
                        <span class="os-client-task-main">
                          <SessionTitleLabel full={sessionTitle(session.title) ?? session.id} />
                        </span>
                      </A>
                    )}
                  </For>
                </Show>
                <Show when={canExpandSharedCases()}>
                  <button
                    type="button"
                    class="os-client-shared-cases-more"
                    data-action="shared-cases-expand"
                    onClick={() => setSharedCasesExpanded(true)}
                  >
                    展开更多
                  </button>
                </Show>
                <Show when={canCollapseSharedCases()}>
                  <button
                    type="button"
                    class="os-client-shared-cases-more"
                    data-action="shared-cases-collapse"
                    onClick={() => setSharedCasesExpanded(false)}
                  >
                    收起
                  </button>
                </Show>
              </div>
            </Show>
          </section>
        </Show>
      </nav>
      <div class="os-sidebar-footer">
        <div class="os-sidebar-footer-actions">
          <A
            href={workspaceDocsHref()}
            class="os-sidebar-footer-action"
            classList={{ "is-active": docsActive() }}
          >
            <svg class="os-sidebar-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 4h7l3 3v13H7z" />
              <path d="M14 4v4h4" />
              <path d="M10 12h5" />
              <path d="M10 16h5" />
            </svg>
            <span class="os-sidebar-label">帮助</span>
          </A>
          <button type="button" class="os-sidebar-footer-action" onClick={openSettings}>
            <svg class="os-sidebar-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
              <path d="M12 3.5v2" />
              <path d="M12 18.5v2" />
              <path d="m5.6 5.6 1.4 1.4" />
              <path d="m17 17 1.4 1.4" />
              <path d="M3.5 12h2" />
              <path d="M18.5 12h2" />
              <path d="m5.6 18.4 1.4-1.4" />
              <path d="m17 7 1.4-1.4" />
            </svg>
            <span class="os-sidebar-label">设置</span>
          </button>
        </div>
      </div>
    </aside>
  )
}
