import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { boundWorkspaceID } from "@/components/onescience/remote-workspace"
import {
  collectLocalUploadEntries,
  fetchProjectDiskSpace,
  findUploadSizeLimitError,
  formatUploadBytes,
  MAX_UPLOAD_ENTRIES,
  PREVIEW_UPLOAD_ENTRIES,
  sumUploadBytes,
  uploadProjectFile,
  uploadRootLabel,
  type LocalUploadEntry,
} from "@/utils/project-upload"

export function DialogProjectUpload(props: {
  directory: string
  onUploaded?: () => void
  /** Absolute server paths that were written or skipped (already present). */
  onUploadedPaths?: (paths: string[]) => void
  /** Optional relative prefix under the project directory, e.g. `onedata`. */
  pathPrefix?: string
  title?: string
  destinationLabel?: string
  destinationHint?: string
  /** Allow editing the absolute upload directory (OneData host uploads). */
  allowEditDestination?: boolean
  /** Reject a single file larger than this (browser upload UX). */
  maxFileBytes?: number
  /** Reject a selection whose total size exceeds this. */
  maxTotalBytes?: number
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const server = useServer()
  const globalSync = useGlobalSync()

  const [entries, setEntries] = createSignal<LocalUploadEntry[]>([])
  const [selectionTruncated, setSelectionTruncated] = createSignal(false)
  const [overwrite, setOverwrite] = createSignal(false)
  const [availableBytes, setAvailableBytes] = createSignal<number | undefined>()
  const [diskLoading, setDiskLoading] = createSignal(true)
  const [uploading, setUploading] = createSignal(false)
  const [progress, setProgress] = createSignal({ done: 0, total: 0, written: 0, skipped: 0, failed: 0 })
  const [error, setError] = createSignal("")

  let fileInput: HTMLInputElement | undefined
  let folderInput: HTMLInputElement | undefined

  const pathPrefix = () => {
    const raw = props.pathPrefix?.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
    return raw || undefined
  }

  const defaultDestination = () => {
    const base = props.directory.replace(/\/+$/, "")
    const prefix = pathPrefix()
    return prefix ? `${base}/${prefix}` : base
  }

  const [destinationDir, setDestinationDir] = createSignal(defaultDestination())

  createEffect(() => {
    setDestinationDir(defaultDestination())
  })

  const withPrefix = (relative: string) => {
    if (props.allowEditDestination) return relative
    const prefix = pathPrefix()
    return prefix ? `${prefix}/${relative}` : relative
  }

  const uploadDirectory = () =>
    props.allowEditDestination
      ? destinationDir().replace(/\/+$/, "") || defaultDestination()
      : props.directory.replace(/\/+$/, "")

  const workspaceID = () => boundWorkspaceID(uploadDirectory())

  const absolutePath = (relative: string) => `${uploadDirectory()}/${relative.replace(/^\/+/, "")}`

  const displayDirectory = createMemo(() => {
    const home = globalSync.data.path.home
    const directory = uploadDirectory()
    if (home && directory.startsWith(home)) return `~${directory.slice(home.length)}`
    return directory
  })

  const destinationOutsideProject = createMemo(() => {
    if (!props.allowEditDestination) return false
    const base = props.directory.replace(/\/+$/, "")
    const target = uploadDirectory()
    return !(target === base || target.startsWith(`${base}/`))
  })

  const totalBytes = createMemo(() => sumUploadBytes(entries()))
  const folderRoot = createMemo(() => uploadRootLabel(entries()))
  const sizeLimitError = createMemo(() =>
    findUploadSizeLimitError(entries(), {
      maxFileBytes: props.maxFileBytes,
      maxTotalBytes: props.maxTotalBytes,
    }),
  )
  const spaceInsufficient = createMemo(() => {
    const available = availableBytes()
    if (available === undefined || available <= 0) return false
    return totalBytes() > available
  })
  const canUpload = createMemo(
    () =>
      entries().length > 0 &&
      !uploading() &&
      !spaceInsufficient() &&
      !sizeLimitError() &&
      Boolean(uploadDirectory()),
  )
  const previewEntries = createMemo(() => entries().slice(0, PREVIEW_UPLOAD_ENTRIES))
  const showFileList = createMemo(() => entries().length > 0 && !folderRoot())

  const sizeLimitMessage = (limit = sizeLimitError()) => {
    if (!limit) return ""
    if (limit.kind === "file") {
      return language.t("dialog.project.upload.fileTooLarge", {
        path: limit.path,
        size: formatUploadBytes(limit.size),
        max: formatUploadBytes(limit.max),
      })
    }
    return language.t("dialog.project.upload.totalTooLarge", {
      size: formatUploadBytes(limit.size),
      max: formatUploadBytes(limit.max),
    })
  }

  createEffect(() => {
    const directory = uploadDirectory()
    const http = server.current?.http
    if (!directory || !http) {
      setDiskLoading(false)
      return
    }
    let cancelled = false
    setDiskLoading(true)
    void fetchProjectDiskSpace(http.url, directory, workspaceID())
      .then((data) => {
        if (cancelled) return
        setAvailableBytes(data.availableBytes)
      })
      .catch(() => {
        if (cancelled) return
        setAvailableBytes(undefined)
      })
      .finally(() => {
        if (!cancelled) setDiskLoading(false)
      })
    return () => {
      cancelled = true
    }
  })

  const applyFiles = (list: FileList | null) => {
    if (!list?.length) return
    setError("")
    const collected = collectLocalUploadEntries(list)
    setEntries(collected.entries)
    setSelectionTruncated(collected.truncated)
    const limit = findUploadSizeLimitError(collected.entries, {
      maxFileBytes: props.maxFileBytes,
      maxTotalBytes: props.maxTotalBytes,
    })
    if (limit) {
      setError(sizeLimitMessage(limit))
      return
    }
    if (collected.truncated) {
      setError(
        language.t("dialog.project.upload.tooManyFiles", {
          max: String(MAX_UPLOAD_ENTRIES),
          selected: String(collected.totalSelected),
        }),
      )
    }
  }

  const runUpload = async () => {
    const http = server.current?.http
    if (!http || !canUpload()) return
    const selected = entries()
    const directory = uploadDirectory()
    setUploading(true)
    setError("")
    setProgress({ done: 0, total: selected.length, written: 0, skipped: 0, failed: 0 })

    let written = 0
    let skipped = 0
    let failed = 0
    const failures: string[] = []
    const uploadedPaths: string[] = []
    for (let index = 0; index < selected.length; index += 1) {
      const entry = selected[index]!
      const relative = withPrefix(entry.path)
      try {
        const result = await uploadProjectFile(http.url, directory, {
          path: relative,
          file: entry.file,
          overwrite: overwrite(),
          workspaceID: workspaceID(),
        })
        if (result.status === "written") written += 1
        else skipped += 1
        uploadedPaths.push(absolutePath(result.path || relative))
      } catch (err) {
        failed += 1
        const message = err instanceof Error ? err.message : language.t("dialog.project.upload.failed")
        if (failures.length < 3) failures.push(`${entry.path}: ${message}`)
      }
      setProgress({ done: index + 1, total: selected.length, written, skipped, failed })
    }

    setUploading(false)
    if (failed === 0) {
      showToast({
        title: language.t("toast.project.upload.success", {
          written: String(written),
          skipped: String(skipped),
        }),
      })
      props.onUploadedPaths?.(uploadedPaths)
      props.onUploaded?.()
      dialog.close()
      return
    }

    setError(
      [
        language.t("dialog.project.upload.partialFailed", {
          written: String(written),
          skipped: String(skipped),
          failed: String(failed),
        }),
        ...failures,
      ].join("\n"),
    )
    if (written > 0 || skipped > 0) {
      props.onUploadedPaths?.(uploadedPaths)
      props.onUploaded?.()
    }
  }

  return (
    <Dialog fit class="os-project-upload-dialog">
      <div class="os-upload-dialog os-download-dialog os-project-upload-panel">
        <div class="os-upload-head">
          <div>
            <div class="os-eyebrow">{language.t("dialog.project.upload.eyebrow")}</div>
            <h2>{props.title ?? language.t("command.project.upload")}</h2>
          </div>
          <button
            type="button"
            class="os-button os-button-secondary os-button-square"
            disabled={uploading()}
            aria-label={language.t("common.cancel")}
            onClick={() => dialog.close()}
          >
            ×
          </button>
        </div>

        <div class="os-project-upload-body">
          <div class="os-download-env-field">
            <span class="os-field-label">
              {props.destinationLabel ?? language.t("dialog.project.upload.destinationLabel")}
            </span>
            <Show
              when={props.allowEditDestination}
              fallback={<code class="os-project-upload-path">{displayDirectory()}/</code>}
            >
              <input
                class="os-project-upload-path-input"
                value={destinationDir()}
                disabled={uploading()}
                spellcheck={false}
                onInput={(event) => setDestinationDir(event.currentTarget.value)}
              />
            </Show>
            <p class="os-section-copy">
              {props.destinationHint ?? language.t("dialog.project.upload.destinationHint")}
            </p>
            <Show when={destinationOutsideProject()}>
              <p class="os-project-upload-warn">{language.t("dialog.project.upload.destinationRisk")}</p>
            </Show>
          </div>

          <div class="os-project-upload-picks">
            <button
              type="button"
              class="os-button os-button-secondary"
              disabled={uploading()}
              onClick={() => fileInput?.click()}
            >
              {language.t("dialog.project.upload.pickFiles")}
            </button>
            <button
              type="button"
              class="os-button os-button-secondary"
              disabled={uploading()}
              onClick={() => folderInput?.click()}
            >
              {language.t("dialog.project.upload.pickFolder")}
            </button>
            <input
              ref={(el) => {
                fileInput = el
              }}
              type="file"
              class="hidden"
              multiple
              onChange={(event) => {
                applyFiles(event.currentTarget.files)
                event.currentTarget.value = ""
              }}
            />
            <input
              ref={(el) => {
                folderInput = el
                if (el) el.setAttribute("webkitdirectory", "")
              }}
              type="file"
              class="hidden"
              multiple
              onChange={(event) => {
                applyFiles(event.currentTarget.files)
                event.currentTarget.value = ""
              }}
            />
          </div>

          <Show when={entries().length > 0}>
            <div class="os-project-upload-summary" role="status">
              <strong>
                {folderRoot()
                  ? language.t("dialog.project.upload.folderSummary", {
                      folder: folderRoot()!,
                      count: String(entries().length),
                      size: formatUploadBytes(totalBytes()),
                    })
                  : language.t("dialog.project.upload.summary", {
                      count: String(entries().length),
                      size: formatUploadBytes(totalBytes()),
                    })}
              </strong>
              <Show when={selectionTruncated()}>
                <p class="os-project-upload-warn">
                  {language.t("dialog.project.upload.truncatedHint", { max: String(MAX_UPLOAD_ENTRIES) })}
                </p>
              </Show>
              <Show when={folderRoot()}>
                <p class="os-section-copy">{language.t("dialog.project.upload.folderHint")}</p>
              </Show>
              <Show when={showFileList()}>
                <ul class="os-project-upload-file-list">
                  <For each={previewEntries()}>{(entry) => <li class="truncate">{entry.path}</li>}</For>
                </ul>
                <Show when={entries().length > previewEntries().length}>
                  <p class="os-section-copy">
                    {language.t("dialog.project.upload.moreFiles", {
                      count: String(entries().length - previewEntries().length),
                    })}
                  </p>
                </Show>
              </Show>
            </div>
          </Show>

          <p class="os-section-copy">
            {language.t("dialog.project.upload.diskSpace", {
              space: diskLoading() ? language.t("common.loading") : formatUploadBytes(availableBytes()),
            })}
          </p>
          <Show when={spaceInsufficient()}>
            <p class="os-project-upload-error" role="alert">
              {language.t("dialog.project.upload.diskInsufficient")}
            </p>
          </Show>
          <Show when={sizeLimitError() && !error()}>
            <p class="os-project-upload-error" role="alert">
              {sizeLimitMessage()}
            </p>
          </Show>

          <label class="os-project-upload-overwrite">
            <input
              type="checkbox"
              checked={overwrite()}
              disabled={uploading()}
              onChange={(event) => setOverwrite(event.currentTarget.checked)}
            />
            <span>{language.t("dialog.project.upload.overwrite")}</span>
          </label>

          <Show when={uploading()}>
            <p class="os-section-copy">
              {language.t("dialog.project.upload.progress", {
                done: String(progress().done),
                total: String(progress().total),
              })}
            </p>
          </Show>

          <Show when={error()}>
            <p class="os-project-upload-error" role="alert">
              {error()}
            </p>
          </Show>
        </div>

        <div class="os-upload-actions">
          <button type="button" class="os-button os-button-secondary" disabled={uploading()} onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </button>
          <button
            type="button"
            class="os-button os-button-primary"
            disabled={!canUpload()}
            onClick={() => void runUpload()}
          >
            {uploading() ? language.t("dialog.project.upload.uploading") : language.t("dialog.project.upload.confirm")}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
