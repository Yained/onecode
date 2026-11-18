import { Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import FileTree from "@/components/file-tree"
import {
  CsvFilePreview,
  HtmlFilePreview,
  MarkdownFilePreview,
  PdfFilePreview,
  XyzFilePreview,
  filePreviewKind,
  isHtmlPath,
  isPdfPath,
  isXyzPath,
  type FileSourceEditor,
} from "@/components/file-preview"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import {
  boundWorkspaceID,
  isSshFileTreePending,
  isTransientRemoteLeafError,
  remoteWorkspaceFor,
  remoteWorkspaceRevision,
} from "@/components/onescience/remote-workspace"
import { runtimeEnvironmentFor, runtimeEnvironmentRevision } from "@/components/onescience/runtime-environment"

function fileName(path: string) {
  const parts = path.replace(/\\/g, "/").split("/")
  return parts[parts.length - 1] || path
}

export function WorkbenchDirectoryPane(props: {
  onClose: () => void
}) {
  const file = useFile()
  const sdk = useSDK()
  const language = useLanguage()
  const [view, setView] = createSignal<"tree" | "editor">("tree")
  const [activePath, setActivePath] = createSignal<string | undefined>()
  const [draft, setDraft] = createSignal("")
  const [dirty, setDirty] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [previewRevision, setPreviewRevision] = createSignal(0)
  let textarea: HTMLTextAreaElement | undefined

  const rootState = createMemo(() => file.tree.state(""))
  const rootChildren = createMemo(() => file.tree.children(""))
  const kind = createMemo(() => filePreviewKind(activePath()))
  const sshPending = createMemo(() => {
    remoteWorkspaceRevision()
    runtimeEnvironmentRevision()
    const directory = sdk.directory
    if (!directory) return false
    return isSshFileTreePending(directory)
  })
  const rootLabel = createMemo(() => {
    remoteWorkspaceRevision()
    runtimeEnvironmentRevision()
    const directory = sdk.directory
    if (directory && runtimeEnvironmentFor(directory).kind === "ssh") {
      // Remote projects are fully remote: show B's path even after 断开.
      // Never surface A's identity folder (`/data/.../workspaces/...`).
      const remote = remoteWorkspaceFor(directory)?.remotePath?.trim()
      return remote || "未连接远端"
    }
    return directory
  })

  const ensureRootListed = (force = false) => {
    if (!sdk.directory || sshPending()) return
    void (force ? file.tree.refresh("") : file.tree.list(""))
  }

  onMount(() => {
    // FileProvider resets the tree in its own effect; list after that settles.
    queueMicrotask(() => ensureRootListed(true))
  })

  createEffect(() => {
    const directory = sdk.directory
    if (!directory || view() !== "tree" || sshPending()) return
    const state = rootState()
    if (state?.loading || state?.loaded || state?.error) return
    void file.tree.list("")
  })

  createEffect(
    on(
      () => boundWorkspaceID(sdk.directory) ?? "",
      () => {
        if (view() !== "tree") return
        ensureRootListed(true)
      },
    ),
  )

  createEffect(() => {
    if (view() !== "tree" || sshPending()) return
    const err = rootState()?.error
    if (!err || !isTransientRemoteLeafError(err)) return
    const directory = sdk.directory
    if (!directory || !boundWorkspaceID(directory)) return
    const timer = window.setTimeout(() => ensureRootListed(true), 2000)
    onCleanup(() => clearTimeout(timer))
  })

  const state = createMemo(() => {
    const path = activePath()
    if (!path) return
    return file.get(path)
  })

  const contents = createMemo(() => state()?.content?.content ?? "")
  const loaded = createMemo(() => !!state()?.loaded)
  const loading = createMemo(() => !!state()?.loading)
  const error = createMemo(() => state()?.error)

  // Same as old pane: any decoded text file can be edited/saved (including html/md/csv/xyz).
  const canEdit = createMemo(() => {
    const current = state()
    if (!current?.loaded) return false
    if (current.content?.type !== "text") return false
    if (current.content.encoding === "base64") return false
    if (isPdfPath(activePath())) return false
    return true
  })

  const plainEditor = createMemo(() => canEdit() && kind() === "text")

  const editSource = createMemo<FileSourceEditor | undefined>(() => {
    if (!canEdit() || plainEditor()) return
    return {
      draft,
      setDraft: (value) => {
        setDraft(value)
        setDirty(true)
      },
      textareaRef: (el) => {
        textarea = el
      },
      class: "os-client-right-files-textarea",
    }
  })

  const renderSource = (source: string) => (
    <pre class="os-client-right-files-preview whitespace-pre-wrap break-all p-3 text-12-regular m-0">{source}</pre>
  )

  createEffect(() => {
    const path = activePath()
    if (!path) return
    void file.load(path)
  })

  createEffect(
    on(
      activePath,
      () => {
        setDirty(false)
        setDraft(loaded() ? contents() : "")
        setPreviewRevision(0)
      },
      { defer: false },
    ),
  )

  createEffect(() => {
    if (!loaded() || dirty()) return
    setDraft(contents())
  })

  const save = async () => {
    const path = activePath()
    if (!path || saving() || !dirty() || !canEdit()) return
    setSaving(true)
    try {
      await file.write(path, draft())
      setDirty(false)
      if (isHtmlPath(path)) setPreviewRevision((value) => value + 1)
    } finally {
      setSaving(false)
    }
  }

  createEffect(() => {
    if (typeof window === "undefined") return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return
      if (!textarea?.contains(document.activeElement) && document.activeElement !== textarea) return
      event.preventDefault()
      void save()
    }
    makeEventListener(window, "keydown", onKeyDown)
  })

  const openFile = (path: string) => {
    setActivePath(path)
    setView("editor")
  }

  return (
    <section class="os-client-right-files" data-view={view()}>
      <header class="os-client-right-files-header">
        <Show
          when={view() === "editor"}
          fallback={
            <>
              <strong>目录</strong>
              <div class="os-client-right-files-actions">
                <button
                  type="button"
                  aria-label="刷新"
                  onClick={() => {
                    ensureRootListed(true)
                    void file.tree.refreshAll()
                  }}
                >
                  刷新
                </button>
                <button type="button" onClick={props.onClose}>
                  关闭
                </button>
              </div>
            </>
          }
        >
          <button type="button" class="os-client-right-files-back" onClick={() => setView("tree")}>
            ← 返回目录
          </button>
          <span class="os-client-right-files-title" title={activePath()}>
            {activePath() ? fileName(activePath()!) : ""}
          </span>
          <div class="os-client-right-files-actions">
            <Show when={canEdit()}>
              <button type="button" disabled={!dirty() || saving()} onClick={() => void save()}>
                {saving() ? language.t("common.saving") : language.t("common.save")}
              </button>
            </Show>
            <button type="button" onClick={props.onClose}>
              关闭
            </button>
          </div>
        </Show>
      </header>

      <Show when={view() === "tree"}>
        <div class="os-client-right-files-tree">
          <p class="os-client-right-files-root" title={rootLabel()}>
            {rootLabel()}
          </p>
          <Show when={sshPending()}>
            <p class="os-client-right-files-hint">SSH 未连接，目录显示远端路径。请先在项目栏连接远端。</p>
          </Show>
          <Show when={!sshPending() && rootState()?.loading && rootChildren().length === 0}>
            <p class="os-client-right-files-hint">正在加载目录…</p>
          </Show>
          <Show when={!sshPending() && rootState()?.error}>
            {(err) => (
              <p class="os-client-right-files-hint">
                加载失败：
                {isTransientRemoteLeafError(err()) ? "远端文件服务尚未就绪，请稍后点刷新" : err()}
              </p>
            )}
          </Show>
          <Show when={!sshPending() && rootState()?.loaded && rootChildren().length === 0 && !rootState()?.error}>
            <p class="os-client-right-files-hint">该目录为空</p>
          </Show>
          <Show when={!sshPending()}>
            <div class="os-client-right-files-tree-scroll">
              <FileTree
                path=""
                class="os-client-right-file-tree"
                nodeClass="os-client-right-file-node"
                active={activePath()}
                draggable={false}
                onFileClick={(node) => openFile(node.path)}
              />
            </div>
          </Show>
        </div>
      </Show>

      <Show when={view() === "editor"}>
        <div class="os-client-right-files-editor">
          <Show when={dirty()}>
            <div class="os-client-right-files-unsaved">{language.t("session.file.unsaved")}</div>
          </Show>
          <Show when={loading() && !loaded()}>
            <p class="os-client-right-files-hint">{language.t("common.loading")}…</p>
          </Show>
          <Show when={error()}>{(err) => <p class="os-client-right-files-hint">{err()}</p>}</Show>

          <Show when={loaded()}>
            <Switch>
              <Match when={isHtmlPath(activePath())}>
                <HtmlFilePreview
                  path={activePath}
                  contents={contents}
                  renderSource={renderSource}
                  editSource={editSource()}
                  previewRevision={previewRevision}
                  chrome="workbench"
                />
              </Match>
              <Match when={kind() === "markdown"}>
                <MarkdownFilePreview
                  path={activePath}
                  contents={contents}
                  renderSource={renderSource}
                  editSource={editSource()}
                  chrome="workbench"
                />
              </Match>
              <Match when={kind() === "csv"}>
                <CsvFilePreview
                  path={activePath}
                  contents={contents}
                  renderSource={renderSource}
                  editSource={editSource()}
                  chrome="workbench"
                />
              </Match>
              <Match when={isPdfPath(activePath())}>
                <PdfFilePreview path={activePath} chrome="workbench" />
              </Match>
              <Match when={isXyzPath(activePath())}>
                <XyzFilePreview
                  path={activePath}
                  contents={contents}
                  renderSource={renderSource}
                  editSource={editSource()}
                  chrome="workbench"
                />
              </Match>
              <Match when={plainEditor()}>
                <textarea
                  ref={textarea}
                  class="os-client-right-files-textarea"
                  value={draft()}
                  onInput={(event) => {
                    setDraft(event.currentTarget.value)
                    setDirty(true)
                  }}
                  spellcheck={false}
                  autocapitalize="off"
                  autocomplete="off"
                  autocorrect="off"
                />
              </Match>
              <Match when={true}>
                <pre class="os-client-right-files-preview">{contents() || "（二进制或不支持预览的文件）"}</pre>
              </Match>
            </Switch>
          </Show>
        </div>
      </Show>
    </section>
  )
}
