import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import type { ContentPart } from "@/context/prompt"
import { attachmentMime } from "./files"
import { pasteMode } from "./paste"

type DragKind = "file" | "@mention" | null
type ListenerType = "dragover" | "dragleave" | "drop"
type Listener = (event: unknown) => unknown
type Toast = { title: string; description?: string }
type UploadCall = {
  url: string
  path: string
  overwrite: string
  filename: string
  method?: string
}

let createPromptAttachments: typeof import("./attachments").createPromptAttachments
let promptParts: ContentPart[] = []
let listeners: Partial<Record<ListenerType, Listener>> = {}
let toasts: Toast[] = []
let uploadCalls: UploadCall[] = []
let deleteCalls: string[] = []
let uploadResponder: (call: UploadCall) => Response | Promise<Response> = uploadWritten

const strings: Record<string, string> = {
  "prompt.toast.attachmentUploadFailed.title": "File upload failed",
  "prompt.toast.attachmentUploadFailed.description": "The file could not be uploaded.",
  "prompt.toast.attachmentUploadFailed.multiple": "{{count}} files failed to upload:\n{{details}}",
  "prompt.toast.attachmentUploadFailed.more": "and {{count}} more",
  "prompt.toast.attachmentTooLarge.description": "Dialog uploads are limited to {{limit}}MB (this file is about {{size}}MB).",
  "prompt.toast.folderNotAllowed.title": "Folders are not supported here",
  "prompt.toast.folderNotAllowed.description": "The chat input only accepts files. Upload folders from the project panel (⋯ → upload).",
}

function translate(key: string, params?: Record<string, string>) {
  return (strings[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => params?.[name] ?? "")
}

function uploadWritten(call: UploadCall) {
  return new Response(JSON.stringify({ path: call.path, status: "written" }), { status: 200 })
}

function uploadSkipped(call: UploadCall) {
  return new Response(JSON.stringify({ path: call.path, status: "skipped" }), { status: 200 })
}

function uploadRejected(message: string) {
  return new Response(JSON.stringify({ message }), { status: 400 })
}

function uploadPath(init?: RequestInit) {
  if (!(init?.body instanceof FormData)) throw new Error("expected FormData upload")
  return String(init.body.get("path"))
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function setup(input?: { addPart?: (part: ContentPart) => boolean }) {
  let draggingType: DragKind = null
  const uploadCounts: number[] = []
  const api = createPromptAttachments({
    serverUrl: "http://127.0.0.1:4096",
    directory: "D:/repo",
    onUploadCountChange: (count) => uploadCounts.push(count),
    editor: () => ({}) as HTMLDivElement,
    isDialogActive: () => false,
    setDraggingType: (type) => {
      draggingType = type
    },
    focusEditor: () => undefined,
    addPart:
      input?.addPart ??
      ((part) => {
        promptParts.push(part)
        return true
      }),
  })

  return {
    api,
    uploadCounts,
    get draggingType() {
      return draggingType
    },
  }
}

function filePart(index: number) {
  const part = promptParts[index]
  if (part?.type !== "file") throw new Error("expected file part")
  return part
}

function pasteFileEvent(file: File, text = "") {
  return {
    clipboardData: {
      items: [
        {
          kind: "file",
          getAsFile: () => file,
        },
      ],
      getData: (type: string) => (type === "text/plain" ? text : ""),
    },
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  } as unknown as ClipboardEvent
}

function dragOverEvent(types: string[]) {
  return {
    dataTransfer: { types },
    preventDefault: () => undefined,
  } as unknown as DragEvent
}

function dropEvent(files: File[], text = "") {
  return {
    dataTransfer: {
      files: files as unknown as FileList,
      getData: (type: string) => (type === "text/plain" ? text : ""),
    },
    preventDefault: () => undefined,
  } as unknown as DragEvent
}

beforeAll(async () => {
  if (typeof document === "undefined") {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { execCommand: () => false },
    })
  }

  mock.module("solid-js", () => ({
    createSignal: <T,>(initial: T) => {
      let value = initial
      return [
        () => value,
        (next: T | ((current: T) => T)) => {
          value = typeof next === "function" ? (next as (current: T) => T)(value) : next
          return value
        },
      ] as const
    },
    onMount: (fn: () => void) => fn(),
  }))

  mock.module("@solid-primitives/event-listener", () => ({
    makeEventListener: (_target: unknown, type: ListenerType, listener: Listener) => {
      listeners[type] = listener
      return () => undefined
    },
  }))

  mock.module("@opencode-ai/ui/toast", () => ({
    showToast: (input: Toast) => {
      toasts.push(input)
    },
  }))

  mock.module("@/context/prompt", () => ({
    usePrompt: () => ({
      current: () => promptParts,
      cursor: () => 0,
      set: (next: ContentPart[]) => {
        promptParts = next
      },
    }),
  }))

  mock.module("@/context/language", () => ({
    useLanguage: () => ({
      t: translate,
    }),
  }))

  mock.module("@/utils/platform-auth", () => ({
    storedPlatformAuthToken: () => null,
  }))

  mock.module("@/utils/authenticated-fetch", () => ({
    authenticatedFetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase()
      if (method === "DELETE") {
        const url = new URL(requestUrl(input))
        const path = url.searchParams.get("path") ?? ""
        deleteCalls.push(path)
        return new Response(JSON.stringify({ path, status: "deleted" }), { status: 200 })
      }
      if (!(init?.body instanceof FormData)) throw new Error("expected FormData upload")
      const blob = init.body.get("file")
      const call = {
        url: requestUrl(input),
        path: uploadPath(init),
        overwrite: String(init.body.get("overwrite")),
        filename: blob instanceof File ? blob.name : "",
        method,
      }
      uploadCalls.push(call)
      return uploadResponder(call)
    },
  }))

  createPromptAttachments = (await import("./attachments")).createPromptAttachments
})

beforeEach(() => {
  promptParts = []
  listeners = {}
  toasts = []
  uploadCalls = []
  deleteCalls = []
  uploadResponder = uploadWritten
})

describe("attachmentMime", () => {
  test("keeps PDFs when the browser reports the mime", async () => {
    const file = new File(["%PDF-1.7"], "guide.pdf", { type: "application/pdf" })
    expect(await attachmentMime(file)).toBe("application/pdf")
  })

  test("normalizes structured text types to text/plain", async () => {
    const file = new File(['{"ok":true}\n'], "data.json", { type: "application/json" })
    expect(await attachmentMime(file)).toBe("text/plain")
  })

  test("accepts text files even with a misleading browser mime", async () => {
    const file = new File(["export const x = 1\n"], "main.ts", { type: "video/mp2t" })
    expect(await attachmentMime(file)).toBe("text/plain")
  })

  test("returns undefined for unknown binary files", async () => {
    const file = new File([Uint8Array.of(0, 255, 1, 2)], "blob.bin", { type: "application/octet-stream" })
    expect(await attachmentMime(file)).toBeUndefined()
  })
})

describe("pasteMode", () => {
  test("uses native paste for short single-line text", () => {
    expect(pasteMode("hello world")).toBe("native")
  })

  test("uses manual paste for multiline text", () => {
    expect(
      pasteMode(`{
  "ok": true
}`),
    ).toBe("manual")
    expect(pasteMode("a\r\nb")).toBe("manual")
  })

  test("uses manual paste for large text", () => {
    expect(pasteMode("x".repeat(8000))).toBe("manual")
  })
})

describe("createPromptAttachments", () => {
  test("uploads arbitrary binary files as project file parts", async () => {
    const input = setup()
    const ok = await input.api.addAttachment(
      new File([Uint8Array.of(0, 255, 1, 2)], "blob.bin", { type: "application/octet-stream" }),
    )

    expect(ok).toBe(true)
    expect(uploadCalls.map((call) => call.path)).toEqual(["uploads/blob.bin"])
    expect(uploadCalls[0]?.overwrite).toBe("false")
    expect(filePart(0)).toMatchObject({
      type: "file",
      path: "uploads/blob.bin",
      content: "@uploads/blob.bin",
      mime: "application/octet-stream",
      filename: "blob.bin",
    })
    expect(input.api.uploading()).toBe(false)
  })

  test("uploads images, PDFs, and text files instead of creating image data URL parts", async () => {
    const input = setup()

    await input.api.addAttachments([
      new File(["png"], "chart.png", { type: "image/png" }),
      new File(["%PDF-1.7"], "paper.pdf", { type: "application/pdf" }),
      new File(["# notes"], "notes.md", { type: "text/markdown" }),
    ])

    expect(promptParts.map((part) => part.type)).toEqual(["file", "file", "file"])
    expect(promptParts.map((_, index) => filePart(index).path)).toEqual([
      "uploads/chart.png",
      "uploads/paper.pdf",
      "uploads/notes.md",
    ])
    expect(promptParts.map((_, index) => filePart(index).mime)).toEqual([
      "image/png",
      "application/pdf",
      "text/plain",
    ])
  })

  test("uploads pasted unicode markdown files with filename metadata", async () => {
    const input = setup()
    const file = new File(["# 需求分析"], "AI科学训练超节点需求分析.md", { type: "text/markdown" })

    await input.api.handlePaste(pasteFileEvent(file))

    expect(uploadCalls.map((call) => call.path)).toEqual(["uploads/AI科学训练超节点需求分析.md"])
    expect(filePart(0)).toMatchObject({
      path: "uploads/AI科学训练超节点需求分析.md",
      mime: "text/plain",
      filename: "AI科学训练超节点需求分析.md",
    })
  })

  test("global drop uploads real files before considering file URI text", async () => {
    const input = setup()
    const file = new File(["# 需求分析"], "AI科学训练超节点需求分析.md", { type: "text/markdown" })

    await listeners.drop?.(
      dropEvent([file], "file:///D:/Documents/众智行动/AI科学训练超节点需求分析.md"),
    )

    expect(promptParts).toHaveLength(1)
    expect(filePart(0).path).toBe("uploads/AI科学训练超节点需求分析.md")
    expect(filePart(0).path).not.toContain("D:/Documents")
    expect(uploadCalls.map((call) => call.path)).toEqual(["uploads/AI科学训练超节点需求分析.md"])
    expect(input.draggingType).toBe(null)
  })

  test("retries upload paths with suffixes when overwrite false is skipped", async () => {
    uploadResponder = (call) => (call.path === "uploads/existing.txt" ? uploadSkipped(call) : uploadWritten(call))
    const input = setup()

    const ok = await input.api.addAttachment(new File(["new"], "existing.txt", { type: "text/plain" }))

    expect(ok).toBe(true)
    expect(uploadCalls.map((call) => call.path)).toEqual(["uploads/existing.txt", "uploads/existing-2.txt"])
    expect(filePart(0).path).toBe("uploads/existing-2.txt")
  })

  test("shows backend error details for a single upload failure", async () => {
    uploadResponder = () => uploadRejected("Access denied: path escapes project directory")
    const input = setup()

    const ok = await input.api.addAttachment(new File(["x"], "blocked.txt", { type: "text/plain" }))

    expect(ok).toBe(false)
    expect(promptParts).toEqual([])
    expect(toasts).toEqual([
      {
        title: "File upload failed",
        description: "Access denied: path escapes project directory",
      },
    ])
    expect(input.api.uploading()).toBe(false)
  })

  test("shows a batch failure summary while keeping successful uploads", async () => {
    uploadResponder = (call) =>
      call.path === "uploads/ok.txt" ? uploadWritten(call) : uploadRejected(`failed ${call.path}`)
    const input = setup()

    const ok = await input.api.addAttachments([
      new File(["ok"], "ok.txt", { type: "text/plain" }),
      new File(["one"], "one.txt", { type: "text/plain" }),
      new File(["two"], "two.txt", { type: "text/plain" }),
    ])

    expect(ok).toBe(true)
    expect(promptParts).toHaveLength(1)
    expect(filePart(0).path).toBe("uploads/ok.txt")
    expect(toasts).toHaveLength(1)
    expect(toasts[0]?.description).toContain("2 files failed to upload")
    expect(toasts[0]?.description).toContain("one.txt: failed uploads/one.txt")
    expect(toasts[0]?.description).toContain("two.txt: failed uploads/two.txt")
  })

  test("rejects files larger than 100MB without uploading", async () => {
    const input = setup()
    const file = {
      name: "big.bin",
      type: "application/octet-stream",
      size: 100 * 1024 * 1024 + 1,
    } as unknown as File

    const ok = await input.api.addAttachment(file)

    expect(ok).toBe(false)
    expect(uploadCalls).toEqual([])
    expect(promptParts).toEqual([])
    expect(toasts[0]).toEqual({
      title: "File upload failed",
      description: "Dialog uploads are limited to 100MB (this file is about 101MB).",
    })
    expect(input.api.uploading()).toBe(false)
  })

  test("rejects folder drops without uploading", async () => {
    const input = setup()
    const event = {
      preventDefault() {},
      dataTransfer: {
        items: [
          {
            kind: "file",
            webkitGetAsEntry: () => ({ isDirectory: true, isFile: false }),
          },
        ],
        files: [],
        getData: () => "",
      },
    }

    await listeners.drop?.(event)

    expect(uploadCalls).toEqual([])
    expect(promptParts).toEqual([])
    expect(toasts[0]?.title).toBe("Folders are not supported here")
  })

  test("rejects files that come from a folder pick", async () => {
    const input = setup()
    const file = new File(["nested"], "nested.txt", { type: "text/plain" })
    Object.defineProperty(file, "webkitRelativePath", { value: "folder/nested.txt" })

    const ok = await input.api.addAttachment(file)

    expect(ok).toBe(false)
    expect(uploadCalls).toEqual([])
    expect(toasts[0]?.title).toBe("Folders are not supported here")
    expect(toasts[0]?.description).toContain("only accepts files")
  })

  test("dismissing a successful upload only hides the progress row", async () => {
    const input = setup()
    const ok = await input.api.addAttachment(new File(["hello"], "note.txt", { type: "text/plain" }))

    expect(ok).toBe(true)
    expect(promptParts).toHaveLength(1)
    expect(input.api.uploadItems()).toEqual([
      expect.objectContaining({
        filename: "note.txt",
        status: "success",
        path: "uploads/note.txt",
      }),
    ])

    input.api.dismissUpload(input.api.uploadItems()[0]!.id)

    expect(input.api.uploadItems()).toEqual([])
    expect(promptParts).toEqual([
      expect.objectContaining({
        type: "file",
        path: "uploads/note.txt",
        content: "@uploads/note.txt",
      }),
    ])
    expect(deleteCalls).toEqual([])
  })

  test("cancelling an in-flight upload deletes the file if it already landed", async () => {
    const input = setup()
    let release!: (response: Response) => void
    uploadResponder = () =>
      new Promise<Response>((resolve) => {
        release = resolve
      })

    const pending = input.api.addAttachment(new File(["hello"], "mid.txt", { type: "text/plain" }))
    // Let uploadUniqueProjectFile reach the pending fetch (path already chosen).
    for (let i = 0; i < 10 && !release; i += 1) await Promise.resolve()
    expect(typeof release).toBe("function")

    const item = input.api.uploadItems()[0]
    expect(item?.status).toBe("uploading")
    input.api.dismissUpload(item!.id)

    // Even if the server already wrote the file, cancellation cleans it up.
    release!(new Response(JSON.stringify({ path: "uploads/mid.txt", status: "written" }), { status: 200 }))
    const ok = await pending

    expect(ok).toBe(false)
    expect(promptParts).toEqual([])
    expect(input.api.uploadItems()).toEqual([])
    expect(deleteCalls).toEqual(["uploads/mid.txt"])
  })

  test("uses file drag state when files and text are both present", () => {
    const input = setup()

    listeners.dragover?.(dragOverEvent(["text/plain", "Files"]))

    expect(input.draggingType).toBe("file")
  })
})
