import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import type { Prompt } from "@/context/prompt"
import { cacheTransientAttachment, clearTransientAttachmentsFromPrompt } from "./attachment-cache"

let createPromptSubmit: typeof import("./submit").createPromptSubmit
let sendFollowupDraft: typeof import("./submit").sendFollowupDraft

const createdClients: string[] = []
const createdSessions: string[] = []
const enabledAutoAccept: Array<{ sessionID: string; directory: string }> = []
const optimistic: Array<{
  directory?: string
  sessionID?: string
  message: {
    agent: string
    model: { providerID: string; modelID: string }
    variant?: string
  }
}> = []
const optimisticSeeded: boolean[] = []
const storedSessions: Record<string, Array<{ id: string; title?: string }>> = {}
const promoted: Array<{ directory: string; sessionID: string }> = []
const sentShell: string[] = []
const syncedDirectories: string[] = []
const navigations: string[] = []
const submitEvents: string[] = []

let params: { id?: string } = {}
let pathname = "/code/workspace/session"
let selected = "/repo/worktree-a"
let variant: string | undefined
let modelInput = { text: true, image: true, audio: false, video: false, pdf: true }
const toasts: Array<{ title: string; description?: string }> = []
const promptAsyncCalls: string[] = []

let boundRemoteWorkspaceID: string | undefined
const promptValue: Prompt = [{ type: "text", content: "ls", start: 0, end: 2 }]

const clientFor = (directory: string) => {
  createdClients.push(directory)
  return {
    session: {
      create: async () => {
        createdSessions.push(directory)
        return {
          data: {
            id: `session-${createdSessions.length}`,
            title: `New session ${createdSessions.length}`,
          },
        }
      },
      get: async ({ sessionID }: { sessionID: string }) => ({
        data: { id: sessionID },
      }),
      shell: async () => {
        sentShell.push(directory)
        return { data: undefined }
      },
      prompt: async () => ({ data: undefined }),
      promptAsync: async () => {
        submitEvents.push("promptAsync")
        promptAsyncCalls.push("promptAsync")
        return { data: undefined }
      },
      command: async () => ({ data: undefined }),
      abort: async () => ({ data: undefined }),
    },
    experimental: {
      workspace: {
        warp: async () => {
          submitEvents.push("warp")
          return { data: undefined }
        },
      },
    },
    worktree: {
      create: async () => ({ data: { directory: `${directory}/new` } }),
    },
  }
}

beforeAll(async () => {
  const rootClient = clientFor("/repo/main")

  mock.module("@solidjs/router", () => ({
    useLocation: () => ({ get pathname() { return pathname } }),
    useNavigate: () => (href: string) => {
      submitEvents.push("navigate")
      navigations.push(href)
    },
    useParams: () => params,
  }))

  mock.module("@/app-routes", () => ({
    codeSessionHref: (directory: string, sessionID: string) => `/code/${directory}/session/${sessionID}`,
    defaultProjectSessionHref: () => "/code/default/session/default",
    persistableWorkspacePath: (path: string | undefined) => path,
  }))

  mock.module("@/code-session-navigation", () => ({
    clearCodeNewSessionIntent: () => undefined,
  }))

  mock.module("@/pages/session/workspace-prompt", () => ({
    clearWorkspacePrompt: () => undefined,
  }))

  mock.module("@/components/onescience/remote-workspace", () => ({
    boundWorkspaceID: () => boundRemoteWorkspaceID,
    remapRemoteEventDirectory: (directory: string) => directory,
    bindRemoteSessionDirectory: (payload: unknown) => payload,
    remoteWorkspaceRevision: () => 0,
    remoteWorkspaceFor: () => undefined,
    isTransientRemoteLeafError: () => false,
    setRemoteWorkspaceFor: () => undefined,
  }))

  mock.module("@/components/onescience/runtime-environment", () => ({
    useRuntimeEnvironment: () => ({
      env: () => ({ kind: "local" }),
    }),
    resolveRuntimeEnvironmentSnapshot: () => ({
      env: { kind: "local" },
      scnet: { available: false, configured: false, connected: false, detail: "" },
    }),
    runtimeEnvironmentFor: () => ({ kind: "local" }),
    runtimeEnvironmentInjection: () => undefined,
    inferSessionBoundEnvironment: () => undefined,
    sessionBoundEnvironmentFor: () => undefined,
    sessionEnvironmentMismatch: () => false,
    setSessionBoundEnvironmentFor: () => undefined,
    sessionCondaEnvFor: () => "",
    markRuntimeEnvironmentInjected: () => undefined,
  }))

  mock.module("@opencode-ai/sdk/v2/client", () => ({
    createOpencodeClient: (input: { directory: string }) => {
      createdClients.push(input.directory)
      return clientFor(input.directory)
    },
  }))

  mock.module("@opencode-ai/ui/toast", () => ({
    showToast: (input: { title: string; description?: string }) => {
      toasts.push(input)
      return 0
    },
  }))

  mock.module("@opencode-ai/core/util/encode", () => ({
    base64Encode: (value: string) => value,
    base64Decode: (value: string) => value,
    checksum: (value: string) => value,
  }))

  mock.module("@/context/local", () => ({
    useLocal: () => ({
      model: {
        current: () => ({
          id: "model",
          name: "Test Model",
          provider: { id: "provider" },
          capabilities: { input: modelInput, reasoning: false },
        }),
        variant: { current: () => variant },
      },
      agent: {
        current: () => ({ name: "agent" }),
      },
      session: {
        promote(directory: string, sessionID: string) {
          promoted.push({ directory, sessionID })
        },
      },
    }),
  }))

  mock.module("@/context/permission", () => ({
    usePermission: () => ({
      enableAutoAccept(sessionID: string, directory: string) {
        enabledAutoAccept.push({ sessionID, directory })
      },
    }),
  }))

  mock.module("@/context/prompt", () => ({
    isAttachmentReady: () => true,
    isAttachmentUploading: () => false,
    usePrompt: () => ({
      current: () => promptValue,
      reset: () => undefined,
      set: () => undefined,
      context: {
        add: () => undefined,
        remove: () => undefined,
        items: () => [],
      },
    }),
  }))

  mock.module("@/context/layout", () => ({
    useLayout: () => ({
      handoff: {
        setTabs: () => undefined,
      },
    }),
  }))

  mock.module("@/context/sdk", () => ({
    useSDK: () => {
      const sdk = {
        directory: "/repo/main",
        client: rootClient,
        url: "http://localhost:4096",
        createClient(opts: any) {
          return clientFor(opts.directory)
        },
      }
      return sdk
    },
  }))

  mock.module("@/context/sync", () => ({
    useSync: () => ({
      data: { command: [] },
      session: {
        optimistic: {
          add: (value: {
            directory?: string
            sessionID?: string
            message: { agent: string; model: { providerID: string; modelID: string; variant?: string } }
          }) => {
            optimistic.push(value)
            optimisticSeeded.push(
              !!value.directory &&
                !!value.sessionID &&
                !!storedSessions[value.directory]?.find((item) => item.id === value.sessionID)?.title,
            )
          },
          remove: () => undefined,
        },
      },
      set: () => undefined,
    }),
  }))

  mock.module("@/context/global-sync", () => ({
    useGlobalSync: () => ({
      child: (directory: string) => {
        syncedDirectories.push(directory)
        storedSessions[directory] ??= []
        return [
          { session: storedSessions[directory] },
          (...args: unknown[]) => {
            if (args[0] !== "session") return
            const next = args[1]
            if (typeof next === "function") {
              storedSessions[directory] = next(storedSessions[directory]) as Array<{ id: string; title?: string }>
              return
            }
            if (Array.isArray(next)) {
              storedSessions[directory] = next as Array<{ id: string; title?: string }>
            }
          },
        ]
      },
    }),
    loadMcpQuery: () => ({ queryKey: ["mcp"], queryFn: async () => ({}) }),
  }))

  mock.module("@/context/global-sync/bootstrap", () => ({
    fetchManagedOpenSshDisk: async () => undefined,
    hydrateSshFromOpenSshTargets: () => undefined,
  }))

  mock.module("@/context/platform", () => ({
    usePlatform: () => ({
      fetch: fetch,
    }),
  }))

  mock.module("@/context/language", () => ({
    useLanguage: () => ({
      t: (key: string) => key,
    }),
  }))

  const mod = await import("./submit")
  createPromptSubmit = mod.createPromptSubmit
  sendFollowupDraft = mod.sendFollowupDraft
})

beforeEach(() => {
  createdClients.length = 0
  createdSessions.length = 0
  enabledAutoAccept.length = 0
  optimistic.length = 0
  optimisticSeeded.length = 0
  promoted.length = 0
  params = {}
  sentShell.length = 0
  syncedDirectories.length = 0
  selected = "/repo/worktree-a"
  variant = undefined
  modelInput = { text: true, image: true, audio: false, video: false, pdf: true }
  toasts.length = 0
  promptAsyncCalls.length = 0
  navigations.length = 0
  submitEvents.length = 0
  boundRemoteWorkspaceID = undefined
  pathname = "/code/workspace/session"
  for (const key of Object.keys(storedSessions)) delete storedSessions[key]
})

describe("prompt submit worktree selection", () => {
  test("reads the latest worktree accessor value per submit", async () => {
    const submit = createPromptSubmit({
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "shell",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)
    selected = "/repo/worktree-b"
    await submit.handleSubmit(event)

    expect(createdClients).toEqual(["/repo/worktree-a", "/repo/worktree-b"])
    expect(createdSessions).toEqual(["/repo/worktree-a", "/repo/worktree-b"])
    expect(sentShell).toEqual(["/repo/worktree-a", "/repo/worktree-b"])
    expect(syncedDirectories).toEqual(["/repo/worktree-a", "/repo/worktree-a", "/repo/worktree-b", "/repo/worktree-b"])
    expect(promoted).toEqual([
      { directory: "/repo/worktree-a", sessionID: "session-1" },
      { directory: "/repo/worktree-b", sessionID: "session-2" },
    ])
    expect(syncedDirectories).toEqual(["/repo/worktree-a", "/repo/worktree-a", "/repo/worktree-b", "/repo/worktree-b"])
  })

  test("applies auto-accept to newly created sessions", async () => {
    const submit = createPromptSubmit({
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => true,
      mode: () => "shell",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)

    expect(enabledAutoAccept).toEqual([{ sessionID: "session-1", directory: "/repo/worktree-a" }])
  })

  test("includes the selected variant on optimistic prompts", async () => {
    params = { id: "session-1" }
    variant = "high"

    const submit = createPromptSubmit({
      info: () => ({ id: "session-1" }),
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)

    expect(optimistic).toHaveLength(1)
    expect(optimistic[0]).toMatchObject({
      message: {
        agent: "agent",
        model: { providerID: "provider", modelID: "model", variant: "high" },
      },
    })
  })

  test("seeds new sessions before optimistic prompts are added", async () => {
    const submit = createPromptSubmit({
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)

    expect(storedSessions["/repo/worktree-a"]).toEqual([{ id: "session-1", title: "New session 1" }])
    expect(optimisticSeeded).toEqual([true])
  })

  test("navigates to a new session before sending the prompt", async () => {
    promptAsyncCalls.length = 0

    const submit = createPromptSubmit({
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => "main",
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(promptAsyncCalls).toEqual(["promptAsync"])
    expect(navigations).toEqual(["/code//repo/main/session/session-1"])
    expect(optimistic).toHaveLength(1)
    expect(submitEvents.indexOf("navigate")).toBeLessThan(submitEvents.indexOf("promptAsync"))
  })

  test("warps to the remote workspace after showing the optimistic prompt", async () => {
    boundRemoteWorkspaceID = "wrk_remote"

    const submit = createPromptSubmit({
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => "main",
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(optimistic).toHaveLength(1)
    expect(submitEvents.indexOf("navigate")).toBeLessThan(submitEvents.indexOf("warp"))
    expect(submitEvents.indexOf("warp")).toBeLessThan(submitEvents.indexOf("promptAsync"))
  })

  test("skips warp when the session is already on the bound workspace", async () => {
    boundRemoteWorkspaceID = "wrk_remote"
    params = { id: "session-1" }

    const submit = createPromptSubmit({
      info: () => ({ id: "session-1", workspaceID: "wrk_remote" }),
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(submitEvents).not.toContain("warp")
    expect(promptAsyncCalls).toEqual(["promptAsync"])
  })

  test("sends pdf attachments even when the selected model metadata lacks pdf", async () => {
    params = { id: "session-1" }
    modelInput = { text: true, image: true, audio: false, video: false, pdf: false }

    const submit = createPromptSubmit({
      info: () => ({ id: "session-1" }),
      imageAttachments: () => [
        {
          type: "image",
          id: "attachment-1",
          filename: "paper.pdf",
          mime: "application/pdf",
          dataUrl: "data:application/pdf;base64,abc",
        },
      ],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(toasts).toEqual([])
    expect(promptAsyncCalls).toEqual(["promptAsync"])
    expect(optimistic).toHaveLength(1)
  })
})

const isFileRequestPart = (part: unknown): part is { type: "file"; url: string; mime: string } => {
  if (!part || typeof part !== "object") return false
  if (!("type" in part) || part.type !== "file") return false
  return "url" in part && typeof part.url === "string" && "mime" in part && typeof part.mime === "string"
}

const transientPrompt = (url: string, text = "summarize") =>
  [
    { type: "text", content: text, start: 0, end: text.length },
    {
      type: "image",
      id: "attachment-1",
      filename: "large.txt",
      mime: "text/plain",
      dataUrl: url,
      uploadStatus: "ready",
    },
  ] satisfies Prompt

const sendInput = (input: {
  prompt: Prompt
  commands?: Array<{ name: string }>
  promptAsync?: (request: { parts: unknown[] }) => Promise<unknown>
  command?: (request: { parts: unknown[] }) => Promise<unknown>
}) =>
  ({
    client: {
      session: {
        promptAsync: input.promptAsync ?? (async () => ({ data: undefined })),
        command: input.command ?? (async () => ({ data: undefined })),
      },
    },
    globalSync: {
      child: () => [undefined, () => undefined],
    },
    sync: {
      data: { command: input.commands ?? [] },
      session: {
        optimistic: {
          add: () => undefined,
          remove: () => undefined,
        },
      },
    },
    language: {
      t: (key: string) => key,
    },
    draft: {
      sessionID: "session-1",
      sessionDirectory: "/repo/main",
      prompt: input.prompt,
      context: [],
      agent: "agent",
      model: { providerID: "provider", modelID: "model" },
    },
  }) as unknown as Parameters<typeof sendFollowupDraft>[0]

describe("sendFollowupDraft transient attachments", () => {
  test("materializes transient attachments for prompt sends", async () => {
    const url = cacheTransientAttachment(new File(["hello"], "large.txt", { type: "text/plain" }), "text/plain")
    const prompt = transientPrompt(url)
    const requests: Array<{ parts: unknown[] }> = []

    await sendFollowupDraft(
      sendInput({
        prompt,
        promptAsync: async (request) => {
          requests.push(request)
          return { data: undefined }
        },
      }),
    )

    expect(requests).toHaveLength(1)
    expect(requests[0]?.parts.find(isFileRequestPart)?.url.startsWith("data:text/plain;base64,")).toBe(true)
    clearTransientAttachmentsFromPrompt(prompt)
  })

  test("materializes transient attachments for command sends", async () => {
    const url = cacheTransientAttachment(new File(["hello"], "large.txt", { type: "text/plain" }), "text/plain")
    const prompt = transientPrompt(url, "/summarize now")
    const requests: Array<{ parts: unknown[] }> = []

    await sendFollowupDraft(
      sendInput({
        prompt,
        commands: [{ name: "summarize" }],
        command: async (request) => {
          requests.push(request)
          return { data: undefined }
        },
      }),
    )

    expect(requests).toHaveLength(1)
    expect(requests[0]?.parts.find(isFileRequestPart)?.url.startsWith("data:text/plain;base64,")).toBe(true)
    clearTransientAttachmentsFromPrompt(prompt)
  })
})

describe("sendFollowupDraft remote session recovery", () => {
  test("retries promptAsync after warping when the leaf is missing the session", async () => {
    let calls = 0
    let recovered = 0
    await sendFollowupDraft({
      ...sendInput({
        prompt: [{ type: "text", content: "ls", start: 0, end: 2 }],
        promptAsync: async () => {
          calls += 1
          if (calls === 1) throw new Error("Session not found: ses_missing")
          return { data: undefined }
        },
      }),
      onSessionMissing: async () => {
        recovered += 1
        return true
      },
    })
    expect(calls).toBe(2)
    expect(recovered).toBe(1)
  })
})
