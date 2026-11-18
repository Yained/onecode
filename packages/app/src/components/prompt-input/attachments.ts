import { createSignal, onMount } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { showToast } from "@opencode-ai/ui/toast"
import { usePrompt, type ContentPart } from "@/context/prompt"
import { useLanguage } from "@/context/language"
import { deleteProjectFile, normalizeLocalRelativePath, uploadProjectFile } from "@/utils/project-upload"
import { uuid } from "@/utils/uuid"
import { attachmentMime } from "./files"
import { normalizePaste, pasteMode } from "./paste"

export type PromptUploadItem = {
  id: string
  filename: string
  size: number
  status: "uploading" | "success" | "error"
  progress: number
  message?: string
  path?: string
}

type PromptAttachmentsInput = {
  serverUrl: string
  directory: string
  /** Remote SSH leaf id; required so /file/upload is proxied off the control plane. */
  workspaceID?: () => string | undefined
  onUploadCountChange?: (count: number) => void
  onUploadItemsChange?: (items: PromptUploadItem[]) => void
  editor: () => HTMLDivElement | undefined
  isDialogActive: () => boolean
  setDraggingType: (type: "file" | "@mention" | null) => void
  focusEditor: () => void
  addPart: (part: ContentPart) => boolean
  readClipboardImage?: () => Promise<File | null>
}

type UploadFailure = {
  filename: string
  message?: string
  cancelled?: boolean
}

type UploadResult =
  | {
      ok: true
    }
  | {
      ok: false
      failure: UploadFailure
    }

const UPLOAD_DIR = "uploads"
const MAX_UPLOAD_PATH_ATTEMPTS = 100
/** Dialog upload hard limit (project-tree upload keeps its own larger backend cap). */
export const PROMPT_UPLOAD_MAX_BYTES = 100 * 1024 * 1024
const MAX_UPLOAD_FAILURE_DETAILS = 3

function mimeKind(type: string) {
  return type.split(";", 1)[0]?.trim().toLowerCase() ?? ""
}

async function uploadMime(file: File) {
  return (await attachmentMime(file).catch(() => undefined)) ?? (mimeKind(file.type) || "application/octet-stream")
}

function uploadBaseName(file: File) {
  const name = file.name.replace(/\\/g, "/").split("/").filter(Boolean).at(-1)?.trim()
  if (!name) return "file"
  return normalizeLocalRelativePath(name)?.split("/").at(-1) ?? "file"
}

function suffixName(name: string, attempt: number) {
  if (attempt === 1) return name
  const dot = name.lastIndexOf(".")
  if (dot <= 0) return `${name}-${attempt}`
  return `${name.slice(0, dot)}-${attempt}${name.slice(dot)}`
}

function uploadDisplayName(file: File) {
  return file.name || "file"
}

function fileFromFolderPick(file: File) {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath?.trim()
  return !!relative && relative.includes("/")
}

function dataTransferHasDirectory(dataTransfer: DataTransfer | null | undefined) {
  const items = dataTransfer?.items
  if (!items?.length) return false
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (!item || item.kind !== "file") continue
    const entry = item.webkitGetAsEntry?.()
    if (entry?.isDirectory) return true
  }
  return false
}

function clipboardHasDirectory(clipboardData: DataTransfer | null | undefined) {
  return dataTransferHasDirectory(clipboardData)
}

function isAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError"
}

async function uploadUniqueProjectFile(
  input: Pick<PromptAttachmentsInput, "serverUrl" | "directory" | "workspaceID">,
  file: File,
  signal?: AbortSignal,
  onPathAttempt?: (path: string) => void,
) {
  const base = uploadBaseName(file)
  for (let attempt = 1; attempt <= MAX_UPLOAD_PATH_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new DOMException("Upload cancelled", "AbortError")
    const path = normalizeLocalRelativePath(`${UPLOAD_DIR}/${suffixName(base, attempt)}`)
    if (!path) continue
    onPathAttempt?.(path)
    const result = await uploadProjectFile(input.serverUrl, input.directory, {
      path,
      file,
      overwrite: false,
      signal,
      workspaceID: input.workspaceID?.(),
    })
    if (result.status === "written") return result.path
  }
  throw new Error("Could not find an unused upload path")
}

export function createPromptAttachments(input: PromptAttachmentsInput) {
  const prompt = usePrompt()
  const language = useLanguage()
  const [uploadCount, setUploadCount] = createSignal(0)
  const [uploadItems, setUploadItems] = createSignal<PromptUploadItem[]>([])
  const pendingFiles = new Map<string, File>()
  const controllers = new Map<string, AbortController>()
  const cancelled = new Set<string>()

  const publishItems = (items: PromptUploadItem[]) => {
    setUploadItems(items)
    input.onUploadItemsChange?.(items)
  }

  const updateUploadCount = (next: (count: number) => number) => {
    setUploadCount((count) => {
      const value = next(count)
      input.onUploadCountChange?.(value)
      return value
    })
  }

  const patchItem = (id: string, patch: Partial<PromptUploadItem>) => {
    publishItems(uploadItems().map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  const removeItem = (id: string) => {
    pendingFiles.delete(id)
    controllers.delete(id)
    cancelled.delete(id)
    publishItems(uploadItems().filter((item) => item.id !== id))
  }

  const failureDescription = (failures: UploadFailure[]) => {
    const fallback = language.t("prompt.toast.attachmentUploadFailed.description")
    if (failures.length === 0) return fallback
    if (failures.length === 1) return failures[0]?.message || fallback

    const details = failures
      .slice(0, MAX_UPLOAD_FAILURE_DETAILS)
      .map((failure) => `${failure.filename}: ${failure.message || fallback}`)
      .join("\n")
    const more =
      failures.length > MAX_UPLOAD_FAILURE_DETAILS
        ? "\n" +
          language.t("prompt.toast.attachmentUploadFailed.more", {
            count: String(failures.length - MAX_UPLOAD_FAILURE_DETAILS),
          })
        : ""
    return language.t("prompt.toast.attachmentUploadFailed.multiple", {
      count: String(failures.length),
      details: details + more,
    })
  }

  const uploadFailed = (failures: UploadFailure[]) => {
    const visible = failures.filter((failure) => !failure.cancelled)
    if (visible.length === 0) return
    showToast({
      title: language.t("prompt.toast.attachmentUploadFailed.title"),
      description: failureDescription(visible),
    })
  }

  const folderRejected = () => {
    showToast({
      title: language.t("prompt.toast.folderNotAllowed.title"),
      description: language.t("prompt.toast.folderNotAllowed.description"),
    })
  }

  const removeAttachment = (id: string) => {
    const current = prompt.current()
    const next = current.filter((part) => part.type !== "image" || part.id !== id)
    prompt.set(next, prompt.cursor())
  }

  const deleteUploadedPath = async (path: string | undefined) => {
    if (!path) return
    try {
      await deleteProjectFile(input.serverUrl, input.directory, path, input.workspaceID?.())
    } catch {
      // Best-effort cleanup for cancelled in-flight uploads.
    }
  }

  const add = async (file: File, existingId?: string): Promise<UploadResult> => {
    if (!input.editor()) return { ok: false, failure: { filename: uploadDisplayName(file) } }
    if (fileFromFolderPick(file)) {
      return {
        ok: false,
        failure: {
          filename: uploadDisplayName(file),
          message: language.t("prompt.toast.folderNotAllowed.description"),
        },
      }
    }
    if (file.size > PROMPT_UPLOAD_MAX_BYTES) {
      return {
        ok: false,
        failure: {
          filename: uploadDisplayName(file),
          message: language.t("prompt.toast.attachmentTooLarge.description", {
            limit: "100",
            size: String(Math.max(1, Math.ceil(file.size / (1024 * 1024)))),
          }),
        },
      }
    }

    const id = existingId ?? uuid()
    const filename = uploadDisplayName(file)
    pendingFiles.set(id, file)
    cancelled.delete(id)
    const controller = new AbortController()
    controllers.set(id, controller)

    if (!existingId) {
      publishItems([
        ...uploadItems(),
        {
          id,
          filename,
          size: file.size,
          status: "uploading",
          progress: 0,
        },
      ])
    } else {
      patchItem(id, { status: "uploading", progress: 0, message: undefined, path: undefined })
    }

    updateUploadCount((count) => count + 1)
    let writtenPath: string | undefined
    let attemptedPath: string | undefined
    try {
      const mime = await uploadMime(file)
      const path = await uploadUniqueProjectFile(input, file, controller.signal, (next) => {
        attemptedPath = next
      })
      writtenPath = path

      if (cancelled.has(id) || controller.signal.aborted) {
        // Cancelled mid-upload: remove anything that already landed on disk.
        await deleteUploadedPath(path)
        removeItem(id)
        return { ok: false, failure: { filename, cancelled: true } }
      }

      const part = {
        type: "file" as const,
        path,
        content: "@" + path,
        start: 0,
        end: 0,
        mime,
        filename: file.name || path.split("/").at(-1),
      }
      input.focusEditor()
      if (!input.addPart(part)) {
        prompt.set([...prompt.current(), part], prompt.cursor())
      }
      // Keep the row so the user can hide progress UI without affecting @ / project files.
      patchItem(id, { status: "success", progress: 100, path })
      return { ok: true }
    } catch (error) {
      if (cancelled.has(id) || isAbortError(error) || controller.signal.aborted) {
        await deleteUploadedPath(writtenPath ?? attemptedPath)
        removeItem(id)
        return { ok: false, failure: { filename, cancelled: true } }
      }
      const message = error instanceof Error ? error.message : undefined
      patchItem(id, { status: "error", progress: 0, message })
      return {
        ok: false,
        failure: {
          filename,
          message,
        },
      }
    } finally {
      controllers.delete(id)
      updateUploadCount((count) => Math.max(0, count - 1))
    }
  }

  const addAttachment = async (file: File) => {
    if (fileFromFolderPick(file)) {
      folderRejected()
      return false
    }
    const result = await add(file)
    if (!result.ok) uploadFailed([result.failure])
    return result.ok
  }

  const addAttachments = async (files: File[], toast = true) => {
    if (files.some(fileFromFolderPick)) {
      if (toast) folderRejected()
      return false
    }
    const results = await Promise.all(files.map((file) => add(file)))
    const failures = results.flatMap((result) => (result.ok ? [] : [result.failure]))
    if (failures.length > 0 && toast) uploadFailed(failures)
    return results.some((result) => result.ok)
  }

  const retryUpload = async (id: string) => {
    const file = pendingFiles.get(id)
    if (!file) return false
    const result = await add(file, id)
    if (!result.ok) uploadFailed([result.failure])
    return result.ok
  }

  const dismissUpload = (id: string) => {
    // Success/error: hide progress only (keep project file + @).
    // Uploading: abort; if the file already landed, add() deletes it after abort.
    cancelled.add(id)
    controllers.get(id)?.abort()
    removeItem(id)
  }

  const clearUploadItems = () => {
    for (const controller of controllers.values()) controller.abort()
    controllers.clear()
    pendingFiles.clear()
    cancelled.clear()
    publishItems([])
    setUploadCount(0)
    input.onUploadCountChange?.(0)
  }

  const handlePaste = async (event: ClipboardEvent) => {
    const clipboardData = event.clipboardData
    if (!clipboardData) return

    event.preventDefault()
    event.stopPropagation()

    if (clipboardHasDirectory(clipboardData)) {
      folderRejected()
      return
    }

    const files = Array.from(clipboardData.items).flatMap((item) => {
      if (item.kind !== "file") return []
      const file = item.getAsFile()
      return file ? [file] : []
    })

    if (files.length > 0) {
      await addAttachments(files)
      return
    }

    const plainText = clipboardData.getData("text/plain") ?? ""

    // Desktop: Browser clipboard has no images and no text, try platform's native clipboard for images
    if (input.readClipboardImage && !plainText) {
      const file = await input.readClipboardImage()
      if (file) {
        await addAttachment(file)
        return
      }
    }

    if (!plainText) return

    const text = normalizePaste(plainText)

    const put = () => {
      if (input.addPart({ type: "text", content: text, start: 0, end: 0 })) return true
      input.focusEditor()
      return input.addPart({ type: "text", content: text, start: 0, end: 0 })
    }

    if (pasteMode(text) === "manual") {
      put()
      return
    }

    const inserted = typeof document.execCommand === "function" && document.execCommand("insertText", false, text)
    if (inserted) return

    put()
  }

  const handleGlobalDragOver = (event: DragEvent) => {
    if (input.isDialogActive()) return

    event.preventDefault()
    const hasFiles = event.dataTransfer?.types.includes("Files")
    const hasText = event.dataTransfer?.types.includes("text/plain")
    if (hasFiles) {
      input.setDraggingType("file")
    } else if (hasText) {
      input.setDraggingType("@mention")
    }
  }

  const handleGlobalDragLeave = (event: DragEvent) => {
    if (input.isDialogActive()) return
    if (!event.relatedTarget) {
      input.setDraggingType(null)
    }
  }

  const handleGlobalDrop = async (event: DragEvent) => {
    if (input.isDialogActive()) return

    event.preventDefault()
    input.setDraggingType(null)

    if (dataTransferHasDirectory(event.dataTransfer)) {
      folderRejected()
      return
    }

    const dropped = event.dataTransfer?.files
    if (dropped?.length) {
      await addAttachments(Array.from(dropped))
      return
    }

    const plainText = event.dataTransfer?.getData("text/plain")
    const filePrefix = "file:"
    if (plainText?.startsWith(filePrefix)) {
      const filePath = plainText.slice(filePrefix.length)
      input.focusEditor()
      input.addPart({ type: "file", path: filePath, content: "@" + filePath, start: 0, end: 0 })
      return
    }
  }

  onMount(() => {
    makeEventListener(document, "dragover", handleGlobalDragOver)
    makeEventListener(document, "dragleave", handleGlobalDragLeave)
    makeEventListener(document, "drop", handleGlobalDrop)
  })

  return {
    addAttachment,
    addAttachments,
    removeAttachment,
    handlePaste,
    uploading: () => uploadCount() > 0,
    uploadItems,
    retryUpload,
    dismissUpload,
    clearUploadItems,
  }
}
