import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useLocation } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { FileProvider } from "@/context/file"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider } from "@/context/sync"
import { RouteParamsProvider } from "@/hooks/use-route-params"
import { decode64 } from "@/utils/base64"
import { WorkbenchDirectoryPane } from "@/workbench/file-pane"
import { useWorkbenchProjectDirectory } from "@/workbench/current-project"
import {
  rightDockOpenRequest,
  rightDockRequestedPane,
  type RightDockPane,
} from "@/workbench/right-dock"
import { resolveScenarioRun, scenarioRunRevision } from "@/workbench/capabilities/scenario-run"
import { isWorkspaceSessionPath, workspaceSessionRouteParams } from "@/workbench/routes"
import { WorkbenchTodoPane } from "@/workbench/todo-pane"

const paneOptions = [
  { id: "directory", label: "目录" },
  { id: "viz", label: "可视化组件" },
  { id: "todo", label: "待办" },
] as const satisfies ReadonlyArray<{ id: RightDockPane; label: string }>

type PaneId = (typeof paneOptions)[number]["id"]

export function WorkbenchRightPanel() {
  const location = useLocation()
  const homeDirectory = useWorkbenchProjectDirectory()
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [activePane, setActivePane] = createSignal<PaneId | undefined>()
  let root: HTMLDivElement | undefined

  const sessionParams = createMemo(() => workspaceSessionRouteParams(location.pathname))
  const sessionDirectory = createMemo(() => {
    const slug = sessionParams()?.dir
    if (!slug) return ""
    return decode64(slug) ?? ""
  })
  const inSession = createMemo(() => isWorkspaceSessionPath(location.pathname) && !!sessionDirectory())
  const projectDirectory = createMemo(() => sessionDirectory() || homeDirectory())
  const projectDirParam = createMemo(() => sessionParams()?.dir || (projectDirectory() ? base64Encode(projectDirectory()) : ""))
  const hasProject = createMemo(() => !!projectDirectory() && !!projectDirParam())
  const scenarioActive = createMemo(() => {
    scenarioRunRevision()
    const dir = sessionParams()?.dir
    if (!dir) return false
    const run = resolveScenarioRun(dir, sessionParams()?.id)
    if (!run) return false
    return run.phase !== "done" && run.phase !== "stopped"
  })

  onMount(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuOpen()) return
      if (root?.contains(event.target as Node)) return
      setMenuOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    onCleanup(() => document.removeEventListener("pointerdown", onPointerDown))
  })

  createEffect((wasSession?: boolean) => {
    const now = inSession()
    if (now && !wasSession && !activePane()) setActivePane("directory")
    return now
  })

  createEffect(() => {
    const request = rightDockOpenRequest()
    if (!request) return
    const pane = rightDockRequestedPane()
    if (!pane) return
    setActivePane(pane)
    setMenuOpen(false)
  })

  const openPane = (id: PaneId) => {
    setActivePane(id)
    setMenuOpen(false)
  }

  const closePane = () => {
    // Leaving 目录/可视化 should not drop an in-progress scenario todo list.
    if (scenarioActive() && activePane() !== "todo") {
      setActivePane("todo")
      return
    }
    setActivePane(undefined)
  }

  return (
    <aside class="os-client-right-sidebar os-client-right-dock">
      <div class="os-client-right-toolbar" ref={root}>
        <div class="os-client-right-add-menu">
          <button
            type="button"
            class="os-client-right-add-button"
            classList={{ "is-open": menuOpen() }}
            aria-label="打开页面"
            aria-expanded={menuOpen()}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span class="os-client-right-add-icon" aria-hidden="true" />
          </button>
          <Show when={menuOpen()}>
            <div class="os-client-right-add-dropdown" role="menu">
              <For each={[...paneOptions]}>
                {(item) => (
                  <button type="button" role="menuitem" onClick={() => openPane(item.id)}>
                    {item.label}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
      <div class="os-client-right-dock-body">
        <Show
          when={activePane()}
          fallback={
            <section class="os-client-right-empty">
              <strong>尚未打开页面</strong>
              <p>点击 + 打开目录、可视化组件或待办；在会话中可从目录点文件到右侧编辑。</p>
            </section>
          }
        >
          {(pane) => (
            <Switch>
              <Match when={pane() === "directory"}>
                <Show
                  when={hasProject()}
                  fallback={
                    <section class="os-client-right-pane-stub">
                      <header>
                        <strong>目录</strong>
                        <button type="button" onClick={closePane}>
                          关闭
                        </button>
                      </header>
                      <p>请先打开项目或任务后再查看目录。</p>
                    </section>
                  }
                >
                  <RouteParamsProvider
                    params={() => ({
                      dir: projectDirParam(),
                      id: sessionParams()?.id,
                    })}
                  >
                    <SDKProvider directory={() => projectDirectory()}>
                      <SyncProvider>
                        <FileProvider>
                          <WorkbenchDirectoryPane onClose={closePane} />
                        </FileProvider>
                      </SyncProvider>
                    </SDKProvider>
                  </RouteParamsProvider>
                </Show>
              </Match>
              <Match when={pane() === "todo"}>
                <Show
                  when={sessionParams()?.dir}
                  fallback={
                    <section class="os-client-right-pane-stub">
                      <header>
                        <strong>待办</strong>
                        <button type="button" onClick={() => setActivePane(undefined)}>
                          关闭
                        </button>
                      </header>
                      <p>请先打开项目或任务后再查看待办。</p>
                    </section>
                  }
                >
                  {(dir) => (
                    <WorkbenchTodoPane
                      directoryKey={dir()}
                      sessionID={sessionParams()?.id}
                      onClose={() => setActivePane(undefined)}
                    />
                  )}
                </Show>
              </Match>
              <Match when={pane() === "viz"}>
                <section class="os-client-right-pane-stub">
                  <header>
                    <strong>可视化组件</strong>
                    <button type="button" onClick={closePane}>
                      关闭
                    </button>
                  </header>
                  <p>请从「目录」中打开 `.html` / `.md` / `.csv` / `.pdf` / `.xyz` 文件查看可视化预览；后续版本将提供独立可视化入口。</p>
                </section>
              </Match>
            </Switch>
          )}
        </Show>
      </div>
    </aside>
  )
}
