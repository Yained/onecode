import { For, Match, Show, Switch, batch, createEffect, createMemo, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { useLocation } from "@solidjs/router"
import { Tabs } from "@opencode-ai/ui/tabs"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Mark } from "@opencode-ai/ui/logo"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import type { SnapshotFileDiff, VcsFileDiff } from "@opencode-ai/sdk/v2"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"
import { useDialog } from "@opencode-ai/ui/context/dialog"

import FileTree from "@/components/file-tree"
import { SessionContextUsage } from "@/components/session-context-usage"
import { SessionContextTab, SessionArtifactsTab, SortableTab, FileVisual, useSessionArtifacts } from "@/components/session"
import { useCommand } from "@/context/command"
import { useFile, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { decode64 } from "@/utils/base64"
import { isSharedCasesPath, storedPlatformAuthSession } from "@/utils/platform-auth"
import { resolveArtifactFilePath } from "@/utils/artifact-image-url"
import { createFileTabListSync } from "@/pages/session/file-tab-scroll"
import { FileTabContent } from "@/pages/session/file-tabs"
import {
  createOpenBuiltinSessionTab,
  createOpenSessionFileTab,
  createSessionTabChangeHandler,
  createSessionTabs,
  getTabReorderIndex,
  type Sizing,
} from "@/pages/session/helpers"
import { setSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import { isWorkspaceSessionPath } from "@/workbench/routes"

type RenderDiff = (SnapshotFileDiff & { file: string }) | VcsFileDiff

function renderDiff(value: SnapshotFileDiff | VcsFileDiff): value is RenderDiff {
  return typeof value.file === "string"
}

export function SessionSidePanel(props: {
  canReview: () => boolean
  diffs: () => (SnapshotFileDiff | VcsFileDiff)[]
  diffsReady: () => boolean
  empty: () => string
  hasReview: () => boolean
  reviewCount: () => number
  reviewPanel: () => JSX.Element
  activeDiff?: string
  focusReviewDiff: (path: string) => void
  reviewSnap: boolean
  reviewSessionWidth: () => string
  size: Sizing
  onSyncFiles: () => void
  onOpenFile?: (path: string) => void
}) {
  const layout = useLayout()
  const location = useLocation()
  const platform = usePlatform()
  const settings = useSettings()
  const sync = useSync()
  const sdk = useSDK()
  const file = useFile()
  const language = useLanguage()
  const command = useCommand()
  const dialog = useDialog()
  const { sessionKey, tabs, view, params } = useSessionLayout()

  const isDesktop = createMediaQuery("(min-width: 768px)")
  const workbenchEmbed = createMemo(() => isWorkspaceSessionPath(location.pathname))
  const sharedReadonly = createMemo(() =>
    isSharedCasesPath(storedPlatformAuthSession(), decode64(params.dir) ?? sdk.directory),
  )
  const shown = createMemo(
    () =>
      !workbenchEmbed() &&
      !sharedReadonly() &&
      (platform.platform !== "desktop" ||
        import.meta.env.VITE_OPENCODE_CHANNEL !== "beta" ||
        settings.general.showFileTree()),
  )

  createEffect(() => {
    if (!sharedReadonly() && !workbenchEmbed()) return
    if (layout.fileTree.opened()) layout.fileTree.close()
    if (workbenchEmbed() && view().reviewPanel.opened()) view().reviewPanel.close()
  })

  const reviewOpen = createMemo(() => !workbenchEmbed() && isDesktop() && view().reviewPanel.opened())
  const fileOpen = createMemo(() => isDesktop() && shown() && layout.fileTree.opened())
  const open = createMemo(() => reviewOpen() || fileOpen())
  const reviewTab = createMemo(() => isDesktop())
  const panelWidth = createMemo(() => {
    if (!open()) return "0px"
    if (reviewOpen()) return `calc(100% - ${props.reviewSessionWidth()})`
    return `${layout.fileTree.width()}px`
  })
  const treeWidth = createMemo(() => (fileOpen() ? `${layout.fileTree.width()}px` : "0px"))

  const diffs = createMemo(() => props.diffs().filter(renderDiff))
  const diffFiles = createMemo(() => diffs().map((d) => d.file))
  const kinds = createMemo(() => {
    const merge = (a: "add" | "del" | "mix" | undefined, b: "add" | "del" | "mix") => {
      if (!a) return b
      if (a === b) return a
      return "mix" as const
    }

    const normalize = (p: string) => p.replaceAll("\\\\", "/").replace(/\/+$/, "")

    const out = new Map<string, "add" | "del" | "mix">()
    for (const diff of diffs()) {
      const file = normalize(diff.file)
      const kind = diff.status === "added" ? "add" : diff.status === "deleted" ? "del" : "mix"

      out.set(file, kind)

      const parts = file.split("/")
      for (const [idx] of parts.slice(0, -1).entries()) {
        const dir = parts.slice(0, idx + 1).join("/")
        if (!dir) continue
        out.set(dir, merge(out.get(dir), kind))
      }
    }
    return out
  })

  const empty = (msg: string) => (
    <div class="h-full flex flex-col">
      <div class="h-6 shrink-0" aria-hidden />
      <div class="flex-1 pb-64 flex items-center justify-center text-center">
        <div class="text-12-regular text-text-weak">{msg}</div>
      </div>
    </div>
  )

  const nofiles = createMemo(() => {
    const state = file.tree.state("")
    if (!state?.loaded) return false
    return file.tree.children("").length === 0
  })

  const normalizeTab = (tab: string) => tab

  const openReviewPanel = () => {
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
  }

  const openFileTab = createOpenSessionFileTab({
    normalizeTab,
    openTab: tabs().open,
    pathFromTab: file.pathFromTab,
    loadFile: file.load,
    openReviewPanel,
    setActive: tabs().setActive,
  })

  const openBuiltinTab = createOpenBuiltinSessionTab({
    openTab: tabs().open,
    setActive: tabs().setActive,
    openReviewPanel,
  })

  const handleTabChange = createSessionTabChangeHandler({
    openBuiltinTab,
    openFileTab,
  })

  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: reviewTab,
    hasReview: props.canReview,
  })
  const contextOpen = tabState.contextOpen
  const openedTabs = tabState.openedTabs
  const activeTab = tabState.activeTab
  const activeFileTab = tabState.activeFileTab
  const artifacts = useSessionArtifacts()
  const sessionStatus = createMemo(() => (params.id ? (sync.data.session_status[params.id]?.type ?? "idle") : "idle"))

  let artifactSwitchState = { session: "", seen: new Set<string>() }

  createEffect(() => {
    const session = sessionKey()
    const items = artifacts()
    const status = sessionStatus()

    if (session !== artifactSwitchState.session) {
      artifactSwitchState = { session, seen: new Set(items.map((item) => item.id)) }
      return
    }

    if (status !== "idle" || items.length === 0) return
    if (!view().reviewPanel.opened()) return

    const hasNew = items.some((item) => !artifactSwitchState.seen.has(item.id))
    for (const item of items) artifactSwitchState.seen.add(item.id)
    if (!hasNew) return

    batch(() => {
      void tabs().open("artifacts")
      tabs().setActive("artifacts")
    })
  })

  const fileTreeTab = () => layout.fileTree.tab()

  const setFileTreeTabValue = (value: string) => {
    if (value !== "changes" && value !== "all") return
    layout.fileTree.setTab(value)
  }

  const refreshFileTree = () => {
    void file.tree.refreshAll()
  }

  const openProjectUpload = () => {
    const directory = sdk.directory
    if (!directory?.trim()) return
    if (isSharedCasesPath(storedPlatformAuthSession(), directory)) return
    void import("@/components/dialog-project-upload").then((mod) => {
      dialog.show(() => (
        <mod.DialogProjectUpload
          directory={directory}
          onUploaded={() => {
            void file.tree.refreshAll()
          }}
        />
      ))
    })
  }

  const showAllFiles = () => {
    if (fileTreeTab() !== "changes") return
    layout.fileTree.setTab("all")
  }

  const openFilePath = (path: string) => {
    if (props.onOpenFile) {
      props.onOpenFile(path)
      return
    }
    batch(() => {
      openReviewPanel()
      showAllFiles()
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
      await file.load(resolved, { force: true })
      openFileTab(file.tab(resolved))
    })()
  }

  createEffect(() => {
    const tab = activeFileTab()
    if (!tab) return
    const path = file.pathFromTab(tab)
    if (path) void file.load(path)
  })

  const [store, setStore] = createStore({
    activeDraggable: undefined as string | undefined,
  })

  const handleDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeDraggable", id)
  }

  const handleDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return

    const currentTabs = tabs().all()
    const toIndex = getTabReorderIndex(currentTabs, draggable.id.toString(), droppable.id.toString())
    if (toIndex === undefined) return
    tabs().move(draggable.id.toString(), toIndex)
  }

  const handleDragEnd = () => {
    setStore("activeDraggable", undefined)
  }

  createEffect(() => {
    if (!file.ready()) return

    setSessionHandoff(sessionKey(), {
      files: tabs()
        .all()
        .reduce<Record<string, SelectedLineRange | null>>((acc, tab) => {
          const path = file.pathFromTab(tab)
          if (!path) return acc

          const selected = file.selectedLines(path)
          acc[path] =
            selected && typeof selected === "object" && "start" in selected && "end" in selected
              ? (selected as SelectedLineRange)
              : null

          return acc
        }, {}),
    })
  })

  return (
    <Show when={isDesktop() && !workbenchEmbed()}>
      <aside
        id="review-panel"
        data-session-chrome
        aria-label={language.t("session.panel.reviewAndFiles")}
        aria-hidden={!open()}
        inert={!open()}
        class="relative min-w-0 self-stretch flex shrink-0 overflow-hidden bg-background-weak"
        classList={{
          "pointer-events-none": !open(),
          "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
            !props.size.active() && !props.reviewSnap,
        }}
        style={{ width: panelWidth() }}
      >
        <Show when={open()}>
          <div class="size-full flex">
            <Show when={reviewOpen()}>
              <div class="relative min-w-0 h-full flex-1 overflow-hidden bg-background-weak">
              <div class="size-full min-w-0 h-full bg-background-weak">
                <DragDropProvider
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragOver={handleDragOver}
                  collisionDetector={closestCenter}
                >
                  <DragDropSensors />
                  <ConstrainDragYAxis />
                  <Tabs value={activeTab()} onChange={handleTabChange} class="flex flex-col h-full min-h-0">
                    <div class="sticky top-0 shrink-0 flex">
                      <Tabs.List
                        ref={(el: HTMLDivElement) => {
                          const stop = createFileTabListSync({ el, contextOpen })
                          onCleanup(stop)
                        }}
                      >
                        <Show when={reviewTab() && props.canReview()}>
                          <Tabs.Trigger value="review">
                            <div class="flex items-center gap-1.5">
                              <div>{language.t("session.tab.review")}</div>
                              <Show when={props.hasReview()}>
                                <div>{props.reviewCount()}</div>
                              </Show>
                            </div>
                          </Tabs.Trigger>
                        </Show>
                        <Show when={contextOpen()}>
                          <Tabs.Trigger
                            value="context"
                            closeButton={
                              <TooltipKeybind
                                title={language.t("common.closeTab")}
                                keybind={command.keybind("tab.close")}
                                placement="bottom"
                                gutter={10}
                              >
                                <IconButton
                                  icon="close-small"
                                  variant="ghost"
                                  class="h-5 w-5"
                                  onClick={() => tabs().close("context")}
                                  aria-label={language.t("common.closeTab")}
                                />
                              </TooltipKeybind>
                            }
                            hideCloseButton
                            onMiddleClick={() => tabs().close("context")}
                          >
                            <div class="flex items-center gap-2">
                              <SessionContextUsage variant="indicator" />
                              <div>{language.t("session.tab.context")}</div>
                            </div>
                          </Tabs.Trigger>
                        </Show>
                        <Tabs.Trigger
                          value="artifacts"
                          closeButton={
                            <TooltipKeybind
                              title={language.t("common.closeTab")}
                              keybind={command.keybind("tab.close")}
                              placement="bottom"
                              gutter={10}
                            >
                              <IconButton
                                icon="close-small"
                                variant="ghost"
                                class="h-5 w-5"
                                onClick={() => tabs().close("artifacts")}
                                aria-label={language.t("common.closeTab")}
                              />
                            </TooltipKeybind>
                          }
                          hideCloseButton
                          onMiddleClick={() => tabs().close("artifacts")}
                        >
                          <div class="flex items-center gap-1.5">
                            <div>{language.t("session.tab.artifacts")}</div>
                            <Show when={artifacts().length > 0}>
                              <div>{artifacts().length}</div>
                            </Show>
                          </div>
                        </Tabs.Trigger>
                        <SortableProvider ids={openedTabs()}>
                          <For each={openedTabs()}>{(tab) => <SortableTab tab={tab} onTabClose={tabs().close} />}</For>
                        </SortableProvider>
                        <div class="bg-background-weak h-full shrink-0 sticky right-0 z-10 flex items-center justify-center pr-3">
                          <TooltipKeybind
                            title={language.t("command.file.open")}
                            keybind={command.keybind("file.open")}
                            class="flex items-center"
                          >
                            <IconButton
                              icon="plus-small"
                              variant="ghost"
                              iconSize="large"
                              class="!rounded-md"
                              onClick={() => {
                                void import("@/components/dialog-select-file").then((x) => {
                                  dialog.show(() => <x.DialogSelectFile mode="files" onOpenFile={showAllFiles} />)
                                })
                              }}
                              aria-label={language.t("command.file.open")}
                            />
                          </TooltipKeybind>
                        </div>
                      </Tabs.List>
                    </div>

                    <div class="flex-1 min-h-0 overflow-hidden flex flex-col">
                      <Show when={reviewTab() && props.canReview() && activeTab() === "review"}>
                        <div class="flex flex-col flex-1 min-h-0 overflow-hidden contain-strict">{props.reviewPanel()}</div>
                      </Show>

                      <Show when={activeTab() === "empty"}>
                        <div class="relative pt-2 flex-1 min-h-0 overflow-hidden contain-strict">
                          <div class="h-full px-6 pb-42 -mt-4 flex flex-col items-center justify-center text-center gap-6">
                            <Mark class="w-14 opacity-10" />
                            <div class="text-14-regular text-text-weak max-w-56">
                              {language.t("session.files.selectToOpen")}
                            </div>
                          </div>
                        </div>
                      </Show>

                      <Show when={activeTab() === "context"}>
                        <div class="relative pt-2 flex-1 min-h-0 overflow-hidden contain-strict">
                          <SessionContextTab />
                        </div>
                      </Show>

                      <Show when={activeTab() === "artifacts"}>
                        <SessionArtifactsTab onOpenFile={openFilePath} />
                      </Show>

                      <For each={openedTabs()}>
                        {(tab) => (
                          <Show when={activeTab() === tab}>
                            <FileTabContent tab={tab} />
                          </Show>
                        )}
                      </For>
                    </div>
                  </Tabs>
                  <DragOverlay>
                    <Show when={store.activeDraggable} keyed>
                      {(tab) => {
                        const path = file.pathFromTab(tab)
                        return (
                          <div data-component="tabs-drag-preview">
                            <Show when={path}>{(p) => <FileVisual active path={p()} />}</Show>
                          </div>
                        )
                      }}
                    </Show>
                  </DragOverlay>
                  </DragDropProvider>
                </div>
              </div>
            </Show>

            <Show when={shown()}>
              <div
                id="file-tree-panel"
                data-session-chrome
                aria-hidden={!fileOpen()}
                inert={!fileOpen()}
                class="relative min-w-0 h-full shrink-0 overflow-hidden bg-background-weak"
                classList={{
                  "pointer-events-none": !fileOpen(),
                  "transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
                    !props.size.active(),
                }}
                style={{ width: treeWidth() }}
              >
                <div
                  class="h-full flex flex-col overflow-hidden bg-background-weak group/filetree"
                  classList={{ "border-l border-border-weaker-base": reviewOpen() }}
                >
                  <Tabs
                    variant="pill"
                    value={fileTreeTab()}
                    onChange={setFileTreeTabValue}
                    class="h-full"
                    data-scope="filetree"
                  >
                    <Tabs.List class="gap-1">
                      <Tabs.Trigger value="changes" class="flex-1 min-w-0" classes={{ button: "w-full" }}>
                        {props.reviewCount()}{" "}
                        {language.t(
                          props.reviewCount() === 1 ? "session.review.change.one" : "session.review.change.other",
                        )}
                      </Tabs.Trigger>
                      <Tabs.Trigger value="all" class="flex-1 min-w-0" classes={{ button: "w-full" }}>
                        {language.t("session.files.all")}
                      </Tabs.Trigger>
                      <Tooltip value={language.t("session.files.upload")} class="shrink-0">
                        <IconButton
                          icon="cloud-upload"
                          variant="ghost"
                          size="normal"
                          aria-label={language.t("session.files.upload")}
                          disabled={isSharedCasesPath(storedPlatformAuthSession(), sdk.directory)}
                          onClick={openProjectUpload}
                        />
                      </Tooltip>
                      <Tooltip value={language.t("session.files.refresh")} class="shrink-0">
                        <IconButton
                          icon="refresh"
                          variant="ghost"
                          size="normal"
                          aria-label={language.t("session.files.refresh")}
                          onClick={refreshFileTree}
                        />
                      </Tooltip>
                      <TooltipKeybind
                        title={language.t("session.files.sync")}
                        keybind={command.keybind("fileTree.sync")}
                        class="shrink-0"
                      >
                        <IconButton
                          icon="reset"
                          variant="ghost"
                          size="normal"
                          aria-label={language.t("session.files.sync")}
                          onClick={() => props.onSyncFiles()}
                        />
                      </TooltipKeybind>
                    </Tabs.List>
                    <Tabs.Content value="changes" class="bg-background-weak px-3 py-0">
                      <Switch>
                        <Match when={props.hasReview() || !props.diffsReady()}>
                          <Show
                            when={props.diffsReady()}
                            fallback={
                              <div class="px-2 py-2 text-12-regular text-text-weak">
                                {language.t("common.loading")}
                                {language.t("common.loading.ellipsis")}
                              </div>
                            }
                          >
                            <FileTree
                              path=""
                              class="pt-3"
                              allowed={diffFiles()}
                              kinds={kinds()}
                              draggable={false}
                              active={props.activeDiff}
                              onFileClick={(node) => props.focusReviewDiff(node.path)}
                            />
                          </Show>
                        </Match>
                      </Switch>
                    </Tabs.Content>
                    <Tabs.Content value="all" class="bg-background-weak px-3 py-0">
                      <Switch>
                        <Match when={nofiles()}>{empty(language.t("session.files.empty"))}</Match>
                        <Match when={true}>
                          <FileTree
                            path=""
                            class="pt-3"
                            modified={diffFiles()}
                            kinds={kinds()}
                            onFileClick={(node) => openFileTab(file.tab(node.path))}
                          />
                        </Match>
                      </Switch>
                    </Tabs.Content>
                  </Tabs>
                </div>
                <Show when={fileOpen()}>
                  <div onPointerDown={() => props.size.start()}>
                    <ResizeHandle
                      direction="horizontal"
                      edge="start"
                      size={layout.fileTree.width()}
                      min={200}
                      max={480}
                      onResize={(width) => {
                        props.size.touch()
                        layout.fileTree.resize(width)
                      }}
                    />
                  </div>
                </Show>
              </div>
            </Show>
          </div>
        </Show>
      </aside>
    </Show>
  )
}
