import type { Message, Session } from "@opencode-ai/sdk/v2/client"
import { showToast } from "@opencode-ai/ui/toast"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { Binary } from "@opencode-ai/core/util/binary"
import { useLocation, useNavigate } from "@solidjs/router"
import { useRouteParams } from "@/hooks/use-route-params"
import { batch, type Accessor } from "solid-js"
import type { FileSelection } from "@/context/file"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useLocal } from "@/context/local"
import { usePermission } from "@/context/permission"
import {
  type ContextItem,
  type ImageAttachmentPart,
  isAttachmentReady,
  isAttachmentUploading,
  type Prompt,
  usePrompt,
} from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { codeSessionHref } from "@/app-routes"
import { clearCodeNewSessionIntent } from "@/code-session-navigation"
import { clearWorkspacePrompt } from "@/pages/session/workspace-prompt"
import { Identifier } from "@/utils/id"
import { Worktree as WorktreeState } from "@/utils/worktree"
import { workspaceSessionHref } from "@/workbench/routes"
import { buildRequestParts } from "./build-request-parts"
import {
  clearTransientAttachmentsFromPrompt,
  collectTransientAttachmentUrls,
  materializePromptAttachments,
} from "./attachment-cache"
import { setCursorPosition } from "./editor-dom"
import { resolveSkillCommand } from "./skill-command"
import { formatServerError, isSessionNotFoundError } from "@/utils/server-errors"
import { isPlatformAuthRequired, storedPlatformAuthSession } from "@/utils/platform-auth"
import { requirePersonalSpace } from "@/workbench/require-auth"
import {
  inferSessionBoundEnvironment,
  markRuntimeEnvironmentInjected,
  resolveRuntimeEnvironmentSnapshot,
  runtimeEnvironmentFor,
  runtimeEnvironmentInjection,
  sessionBoundEnvironmentFor,
  sessionCondaEnvFor,
  sessionEnvironmentMismatch,
  setSessionBoundEnvironmentFor,
  useRuntimeEnvironment,
} from "@/components/onescience/runtime-environment"
import type { SshTargetOption } from "@/components/onescience/execution-location"
import { currentOpenSshTargetMap } from "@/components/onescience/use-registered-ssh-connectivity"
import { boundWorkspaceID, isTransientRemoteLeafError, remoteWorkspaceFor } from "@/components/onescience/remote-workspace"

type PendingPrompt = {
  abort: AbortController
  cleanup: VoidFunction
}

const pending = new Map<string, PendingPrompt>()

export type FollowupDraft = {
  sessionID: string
  sessionDirectory: string
  prompt: Prompt
  context: (ContextItem & { key: string })[]
  agent: string
  model: { providerID: string; modelID: string }
  variant?: string
}

type FollowupSendInput = {
  client: ReturnType<typeof useSDK>["client"]
  globalSync: ReturnType<typeof useGlobalSync>
  sync: ReturnType<typeof useSync>
  language: ReturnType<typeof useLanguage>
  draft: FollowupDraft
  messageID?: string
  optimisticBusy?: boolean
  environment?: {
    scope: string
    resolve: () => { key: string; header: string } | undefined
    snapshot?: () => { kind: string; targetName?: string; serverName?: string }
  }
  before?: () => Promise<boolean> | boolean
  onSessionMissing?: () => Promise<boolean>
  onRequestStarted?: () => void
}

const draftText = (prompt: Prompt) => prompt.map((part) => ("content" in part ? part.content : "")).join("")

const draftImages = (prompt: Prompt) => prompt.filter((part): part is ImageAttachmentPart => part.type === "image")

export async function sendFollowupDraft(input: FollowupSendInput) {
  const mismatch = sessionEnvironmentMismatch(
    inferSessionBoundEnvironment({
      sessionID: input.draft.sessionID,
      messages: input.sync.data.message?.[input.draft.sessionID] ?? [],
      partsByMessage: input.sync.data.part,
      sessionWorkspaceID: input.sync.session.get?.(input.draft.sessionID)?.workspaceID,
      binding: remoteWorkspaceFor(input.draft.sessionDirectory),
    }),
    runtimeEnvironmentFor(input.draft.sessionDirectory),
  )
  if (mismatch) {
    showToast({ title: input.language.t("session.environment.mismatch") })
    return false
  }

  const rawText = draftText(input.draft.prompt)
  const [, setStore] = input.globalSync.child(input.draft.sessionDirectory, { bootstrap: false })

  const setBusy = () => {
    if (!input.optimisticBusy) return
    setStore("session_status", input.draft.sessionID, { type: "busy" })
  }

  const setIdle = () => {
    if (!input.optimisticBusy) return
    setStore("session_status", input.draft.sessionID, { type: "idle" })
  }

  const wait = async () => {
    const ok = await input.before?.()
    if (ok === false) return false
    return true
  }

  const unavailableAttachmentToast = () => {
    showToast({
      title: input.language.t("prompt.toast.attachmentUnavailable.title"),
      description: input.language.t("prompt.toast.attachmentUnavailable.description"),
    })
  }

  const materialize = async () => {
    const prepared = await materializePromptAttachments(input.draft.prompt)
    if (prepared) return prepared
    setIdle()
    unavailableAttachmentToast()
    return undefined
  }

  // Slash/skill commands are parsed from the raw text and never carry an environment header —
  // prepending it would break command recognition, and commands are not agent tasks.
  const skillCommand = resolveSkillCommand({
    text: rawText,
    skills: input.draft.context.flatMap((item) =>
      item.type === "skill" ? [{ name: item.name, title: item.title }] : [],
    ),
    commands: input.sync.data.command,
  })
  const [head, ...tail] = rawText.split(" ")
  const cmd = skillCommand?.command ?? (head?.startsWith("/") ? head.slice(1) : undefined)
  const argumentsText = skillCommand?.arguments ?? tail.join(" ")
  if (cmd && input.sync.data.command.find((item) => item.name === cmd)) {
    setBusy()
    try {
      if (!(await wait())) {
        setIdle()
        return false
      }

      const prepared = await materialize()
      if (!prepared) return false
      const images = draftImages(prepared.prompt)
      await input.client.session.command({
        sessionID: input.draft.sessionID,
        command: cmd,
        arguments: argumentsText,
        agent: input.draft.agent,
        model: `${input.draft.model.providerID}/${input.draft.model.modelID}`,
        variant: input.draft.variant,
        parts: images.map((attachment) => ({
          id: Identifier.ascending("part"),
          type: "file" as const,
          mime: attachment.mime,
          url: attachment.dataUrl,
          filename: attachment.filename,
        })),
      })
      clearTransientAttachmentsFromPrompt(input.draft.prompt)
      return true
    } catch (err) {
      setIdle()
      throw err
    }
  }

  const messageID = input.messageID ?? Identifier.ascending("message")

  const createSendRequest = (preparedPrompt: Prompt) => {
    const images = draftImages(preparedPrompt)
    const base = {
      prompt: preparedPrompt,
      context: input.draft.context.flatMap((item) => (item.type === "file" ? [item] : [])),
      images,
      sessionID: input.draft.sessionID,
      messageID,
      sessionDirectory: input.draft.sessionDirectory,
    }
    // The optimistic view shows the user's text as-is; the environment header is only
    // baked into the actual request, resolved at send time (after wait()/materialize()).
    const { optimisticParts } = buildRequestParts({ ...base, text: rawText })

    const runtimeEnv = input.environment?.snapshot?.()
    const environmentMeta =
      runtimeEnv?.kind === "ssh" && runtimeEnv.targetName
        ? { kind: "ssh" as const, targetName: runtimeEnv.targetName }
        : runtimeEnv?.kind === "scnet"
          ? {
              kind: "scnet" as const,
              ...(runtimeEnv.serverName ? { name: runtimeEnv.serverName } : {}),
            }
          : { kind: "local" as const }
    const message = {
      id: messageID,
      sessionID: input.draft.sessionID,
      role: "user" as const,
      time: { created: Date.now() },
      agent: input.draft.agent,
      model: { ...input.draft.model, variant: input.draft.variant },
      ...(environmentMeta ? { environment: environmentMeta } : {}),
    } as Message

    return {
      add: () =>
        input.sync.session.optimistic.add({
          directory: input.draft.sessionDirectory,
          sessionID: input.draft.sessionID,
          message,
          parts: optimisticParts,
        }),
      request: async () => {
        const environment = input.environment?.resolve()
        const text = environment?.header ? `${environment.header}\n\n${rawText}` : rawText
        const { requestParts } = buildRequestParts({ ...base, text })
        const sendEnv = input.environment?.snapshot?.()
        const sendEnvironmentMeta =
          sendEnv?.kind === "ssh" && sendEnv.targetName
            ? { kind: "ssh" as const, targetName: sendEnv.targetName }
            : sendEnv?.kind === "scnet"
              ? {
                  kind: "scnet" as const,
                  ...(sendEnv.serverName ? { name: sendEnv.serverName } : {}),
                }
              : environmentMeta
        const sendPrompt = () =>
          input.client.session.promptAsync({
            sessionID: input.draft.sessionID,
            agent: input.draft.agent,
            model: input.draft.model,
            messageID,
            parts: requestParts,
            variant: input.draft.variant,
            ...(sendEnvironmentMeta ? { environment: sendEnvironmentMeta } : {}),
          })
        const isTransientSendError = (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err ?? "")
          return (
            /Transport error|ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|network/i.test(message) ||
            isTransientRemoteLeafError(message)
          )
        }
        let result!: Awaited<ReturnType<typeof sendPrompt>>
        for (let attempt = 0; ; attempt++) {
          try {
            result = await sendPrompt()
            break
          } catch (err) {
            if (isSessionNotFoundError(err) && input.onSessionMissing) {
              if (attempt >= 4) throw err
              const recovered = await input.onSessionMissing()
              if (!recovered) throw err
              continue
            }
            if (!isTransientSendError(err) || attempt >= 4) throw err
            await new Promise((resolve) => setTimeout(resolve, Math.min(2000, 250 * 2 ** attempt)))
          }
        }
        if (environment && input.environment) {
          markRuntimeEnvironmentInjected(input.environment.scope, environment.key)
        }
        return result
      },
    }
  }

  const remove = () =>
    input.sync.session.optimistic.remove({
      directory: input.draft.sessionDirectory,
      sessionID: input.draft.sessionID,
      messageID,
    })

  if (collectTransientAttachmentUrls(input.draft.prompt).length === 0) {
    const sendRequest = createSendRequest(input.draft.prompt)
    batch(() => {
      setBusy()
      sendRequest.add()
    })

    try {
      if (!(await wait())) {
        batch(() => {
          setIdle()
          remove()
        })
        return false
      }

      const request = sendRequest.request()
      input.onRequestStarted?.()
      await request
      return true
    } catch (err) {
      batch(() => {
        setIdle()
        remove()
      })
      throw err
    }
  }

  try {
    setBusy()
    if (!(await wait())) {
      setIdle()
      return false
    }

    const prepared = await materialize()
    if (!prepared) return false
    const sendRequest = createSendRequest(prepared.prompt)

    batch(() => {
      sendRequest.add()
    })

    const request = sendRequest.request()
    input.onRequestStarted?.()
    await request
    clearTransientAttachmentsFromPrompt(input.draft.prompt)
    return true
  } catch (err) {
    batch(() => {
      setIdle()
      remove()
    })
    throw err
  }
}

type PromptSubmitInput = {
  info: Accessor<{ id: string } | undefined>
  imageAttachments: Accessor<ImageAttachmentPart[]>
  commentCount: Accessor<number>
  autoAccept: Accessor<boolean>
  mode: Accessor<"normal" | "shell">
  working: Accessor<boolean>
  editor: () => HTMLDivElement | undefined
  queueScroll: () => void
  promptLength: (prompt: Prompt) => number
  addToHistory: (prompt: Prompt, mode: "normal" | "shell") => void
  resetHistoryNavigation: () => void
  setMode: (mode: "normal" | "shell") => void
  setPopover: (popover: "at" | "slash" | null) => void
  newSessionWorktree?: Accessor<string | undefined>
  onNewSessionWorktreeReset?: () => void
  shouldQueue?: Accessor<boolean>
  onQueue?: (draft: FollowupDraft) => void
  onAbort?: () => void
  onSubmit?: () => void
}

type CommentItem = {
  path: string
  selection?: FileSelection
  comment?: string
  commentID?: string
  commentOrigin?: "review" | "file"
  preview?: string
}

export function createPromptSubmit(input: PromptSubmitInput) {
  const location = useLocation()
  const navigate = useNavigate()
  const sdk = useSDK()
  const sync = useSync()
  const globalSync = useGlobalSync()
  const local = useLocal()
  const permission = usePermission()
  const prompt = usePrompt()
  const layout = useLayout()
  const language = useLanguage()
  const params = useRouteParams()
  const runtime = useRuntimeEnvironment(() => sdk.directory)
  let submitting = false

  // The environment lookup key must stay the page's project directory (sdk.directory) —
  // execution environment is bound to the project, not a session worktree.
  const environmentFor = (sessionDirectory: string, sessionID: string) => ({
    scope: `${sessionDirectory}:${sessionID}`,
    snapshot: () => runtime.env(),
    resolve: () => {
      try {
        const snapshot = resolveRuntimeEnvironmentSnapshot({
          directory: sdk.directory,
          ssh: currentOpenSshTargetMap(globalSync.data?.config?.ssh) as Record<string, SshTargetOption> | undefined,
          mcp: sync.data?.mcp,
        })
        return runtimeEnvironmentInjection({
          scope: `${sessionDirectory}:${sessionID}`,
          env: snapshot.env,
          ctx: {
            directory: sdk.directory,
            sshTarget: snapshot.sshTarget,
            scnet: snapshot.scnet,
            condaEnv: sessionCondaEnvFor(sdk.directory, snapshot.env),
          },
        })
      } catch {
        return undefined
      }
    },
  })

  const errorMessage = (err: unknown) => {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { message?: string } }).data
      if (data?.message) return data.message
    }
    if (err instanceof Error) return err.message
    return language.t("common.requestFailed")
  }

  const abort = async () => {
    const sessionID = params.id
    if (!sessionID) return Promise.resolve()

    globalSync.todo.set(sessionID, [])
    const [, setStore] = globalSync.child(sdk.directory, { bootstrap: false })
    setStore("todo", sessionID, [])
    // Optimistic idle so the UI leaves "thinking" even if session.status SSE is delayed/lost.
    setStore("session_status", sessionID, { type: "idle" })

    input.onAbort?.()

    const queued = pending.get(sessionID)
    if (queued) {
      queued.abort.abort()
      queued.cleanup()
      pending.delete(sessionID)
    }
    // Always ask the server to cancel — pending worktree wait may race a started run.
    return sdk.client.session
      .abort({
        sessionID,
      })
      .catch(() => {})
  }

  const restoreCommentItems = (items: CommentItem[]) => {
    for (const item of items) {
      prompt.context.add({
        type: "file",
        path: item.path,
        selection: item.selection,
        comment: item.comment,
        commentID: item.commentID,
        commentOrigin: item.commentOrigin,
        preview: item.preview,
      })
    }
  }

  const removeCommentItems = (items: { key: string }[]) => {
    for (const item of items) {
      prompt.context.remove(item.key)
    }
  }

  const clearContext = () => {
    for (const item of prompt.context.items()) {
      prompt.context.remove(item.key)
    }
  }

  const seed = (dir: string, info: Session) => {
    const [, setStore] = globalSync.child(dir, { bootstrap: false })
    setStore("session", (list: Session[]) => {
      const result = Binary.search(list, info.id, (item) => item.id)
      const next = [...list]
      if (result.found) {
        next[result.index] = info
        return next
      }
      next.splice(result.index, 0, info)
      return next
    })
  }

  const handleSubmit = async (event: Event) => {
    event.preventDefault()

    // Platform deployments write sessions under the signed-in account — never create/prompt while logged out.
    if (
      isPlatformAuthRequired() &&
      !storedPlatformAuthSession() &&
      !requirePersonalSpace({
        navigate,
        action: { type: "prompt", prompt: "" },
        isLoggedIn: false,
        redirect: location.pathname.startsWith("/") ? `${location.pathname}${location.search}${location.hash}` : "/workspace",
      })
    ) {
      return
    }

    const currentPrompt = prompt.current()
    const text = currentPrompt.map((part) => ("content" in part ? part.content : "")).join("")
    const images = input.imageAttachments().slice()
    const mode = input.mode()

    if (currentPrompt.some((part) => part.type === "image" && isAttachmentUploading(part))) {
      showToast({
        title: language.t("prompt.toast.attachmentsUploading.title"),
        description: language.t("prompt.toast.attachmentsUploading.description"),
      })
      return
    }

    if (
      mode !== "shell" &&
      currentPrompt.some((part) => part.type === "image" && part.uploadStatus !== "uploading" && !isAttachmentReady(part))
    ) {
      showToast({
        title: language.t("prompt.toast.attachmentUnavailable.title"),
        description: language.t("prompt.toast.attachmentUnavailable.description"),
      })
      return
    }

    if (text.trim().length === 0 && images.length === 0 && input.commentCount() === 0) {
      if (input.working()) void abort()
      return
    }

    const currentModel = local.model.current()
    const currentAgent = local.agent.current()
    const variant = local.model.variant.current()
    if (!currentModel || !currentAgent) {
      const sshBound = runtime.env().kind === "ssh" && Boolean(boundWorkspaceID(sdk.directory))
      showToast({
        title: language.t(sshBound ? "prompt.toast.remoteModelNotReady.title" : "prompt.toast.modelAgentRequired.title"),
        description: language.t(
          sshBound ? "prompt.toast.remoteModelNotReady.description" : "prompt.toast.modelAgentRequired.description",
        ),
      })
      return
    }

    const projectDirectory = sdk.directory
    if (params.id) {
      const messages = sync.data.message?.[params.id] ?? []
      if (
        sessionEnvironmentMismatch(
          inferSessionBoundEnvironment({
            sessionID: params.id,
            messages,
            partsByMessage: sync.data.part,
            sessionWorkspaceID: sync.session.get?.(params.id)?.workspaceID,
            binding: remoteWorkspaceFor(projectDirectory),
          }),
          runtime.env(),
        )
      ) {
        showToast({
          title: language.t("session.environment.mismatch"),
        })
        return
      }
    }

    if (submitting) return
    submitting = true
    let persistLock = false
    try {
    input.addToHistory(currentPrompt, mode)
    input.resetHistoryNavigation()

    const isNewSession = !params.id
    const shouldAutoAccept = isNewSession && input.autoAccept()
    const remoteWorkspaceID = boundWorkspaceID(projectDirectory)
    if (runtime.env().kind === "ssh" && !remoteWorkspaceID) {
      showToast({
        title: "请先连接远端",
        description: "已选择 SSH 目标，请先点击「检测」并「连接远端」。",
      })
      return
    }
    const worktreeSelection = remoteWorkspaceID ? "main" : input.newSessionWorktree?.() || "main"
    let newSessionHref: string | undefined

    let sessionDirectory = projectDirectory
    let client = sdk.client

    if (isNewSession) {
      if (worktreeSelection === "create") {
        const createdWorktree = await client.worktree
          .create({ directory: projectDirectory })
          .then((x) => x.data)
          .catch((err) => {
            showToast({
              title: language.t("prompt.toast.worktreeCreateFailed.title"),
              description: errorMessage(err),
            })
            return undefined
          })

        if (!createdWorktree?.directory) {
          showToast({
            title: language.t("prompt.toast.worktreeCreateFailed.title"),
            description: language.t("common.requestFailed"),
          })
          return
        }
        WorktreeState.pending(createdWorktree.directory)
        sessionDirectory = createdWorktree.directory
      }

      if (worktreeSelection !== "main" && worktreeSelection !== "create") {
        sessionDirectory = worktreeSelection
      }

      if (sessionDirectory !== projectDirectory) {
        client = sdk.createClient({
          directory: sessionDirectory,
          throwOnError: true,
          experimental_workspaceID: remoteWorkspaceID,
        })
        globalSync.child(sessionDirectory, { bootstrap: false })
      }

      input.onNewSessionWorktreeReset?.()
    }

    let session = input.info()
    if (!session && isNewSession) {
      const created = await client.session
        .create()
        .then((x) => x.data ?? undefined)
        .catch((err) => {
          showToast({
            title: language.t("prompt.toast.sessionCreateFailed.title"),
            description: errorMessage(err),
          })
          return undefined
        })
      if (created) {
        seed(sessionDirectory, created)
        session = created
        if (shouldAutoAccept) permission.enableAutoAccept(session.id, sessionDirectory)
        local.session.promote(sessionDirectory, session.id)
        layout.handoff.setTabs(base64Encode(sessionDirectory), session.id)
        newSessionHref = location.pathname.startsWith("/workspace")
          ? workspaceSessionHref(sessionDirectory, session.id)
          : location.pathname.startsWith("/code/")
            ? codeSessionHref(sessionDirectory, session.id)
            : `/${base64Encode(sessionDirectory)}/session/${session.id}`
      }
    }
    if (!session) {
      showToast({
        title: language.t("prompt.toast.promptSendFailed.title"),
        description: language.t("prompt.toast.promptSendFailed.description"),
      })
      return
    }

    const sessionID = session.id
    if (!sessionBoundEnvironmentFor(sessionID)) {
      setSessionBoundEnvironmentFor(sessionID, runtime.env())
    }
    let sessionWorkspaceID: string | null = (session as { workspaceID?: string | null }).workspaceID ?? null

    const isTransientRemoteError = (err: unknown) => {
      const message = errorMessage(err)
      return (
        /Transport error|ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|network/i.test(message) ||
        isTransientRemoteLeafError(message)
      )
    }

    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

    const warpToRemote = async () => {
      if (!remoteWorkspaceID) return
      let lastErr: unknown
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await client.experimental.workspace.warp({
            directory: projectDirectory,
            id: remoteWorkspaceID,
            sessionID,
            copyChanges: false,
          })
          sessionWorkspaceID = remoteWorkspaceID
          return
        } catch (err) {
          lastErr = err
          if (!isTransientRemoteError(err) || attempt === 4) {
            const error = new Error(errorMessage(err))
            error.name = "RemoteWarpError"
            throw error
          }
          await sleep(Math.min(2000, 250 * 2 ** attempt))
        }
      }
      const error = new Error(errorMessage(lastErr))
      error.name = "RemoteWarpError"
      throw error
    }

    const warpIfNeeded = async () => {
      if (!remoteWorkspaceID) return
      if (sessionWorkspaceID === remoteWorkspaceID) return
      const latest = await client.session.get({ sessionID }).catch(() => undefined)
      const fromServer = latest?.data?.workspaceID ?? null
      if (fromServer === remoteWorkspaceID) {
        sessionWorkspaceID = remoteWorkspaceID
        return
      }
      await warpToRemote()
    }

    const model = {
      modelID: currentModel.id,
      providerID: currentModel.provider.id,
    }
    const agent = currentAgent.name
    const context = prompt.context.items().slice()
    const draft: FollowupDraft = {
      sessionID,
      sessionDirectory,
      prompt: currentPrompt,
      context,
      agent,
      model,
      variant,
    }

    const clearInput = () => {
      prompt.reset(undefined, { preserveAttachments: true })
      if (isNewSession && params.dir) {
        clearCodeNewSessionIntent(params.dir)
        clearWorkspacePrompt(prompt, params.dir)
      }
      input.setMode("normal")
      input.setPopover(null)
    }

    const restoreInput = () => {
      prompt.set(currentPrompt, input.promptLength(currentPrompt))
      input.setMode(mode)
      input.setPopover(null)
      requestAnimationFrame(() => {
        const editor = input.editor()
        if (!editor) return
        editor.focus()
        setCursorPosition(editor, input.promptLength(currentPrompt))
        input.queueScroll()
      })
    }

    const restoreSkillItems = (items: Extract<ContextItem, { type: "skill" }>[]) => {
      for (const item of items) {
        prompt.context.add({
          type: "skill",
          name: item.name,
          title: item.title,
        })
      }
    }

    if (!isNewSession && mode === "normal" && input.shouldQueue?.()) {
      input.onQueue?.(draft)
      clearContext()
      clearInput()
      return
    }

    input.onSubmit?.()

    const materializeAttachments = async () => {
      const prepared = await materializePromptAttachments(currentPrompt)
      if (prepared) return prepared
      showToast({
        title: language.t("prompt.toast.attachmentUnavailable.title"),
        description: language.t("prompt.toast.attachmentUnavailable.description"),
      })
      return undefined
    }

    if (mode === "shell") {
      try {
        await warpIfNeeded()
      } catch (err) {
        showToast({
          title: "无法切换到远端",
          description: errorMessage(err),
        })
        return
      }
      clearInput()
      client.session
        .shell({
          sessionID,
          agent,
          model,
          command: text,
        })
        .then(() => clearTransientAttachmentsFromPrompt(currentPrompt))
        .catch((err) => {
          showToast({
            title: language.t("prompt.toast.shellSendFailed.title"),
            description: errorMessage(err),
          })
          restoreInput()
        })
      if (newSessionHref) navigate(newSessionHref)
      return
    }

    const skillItems = context.flatMap((item) => (item.type === "skill" ? [item] : []))
    const skillCommand = resolveSkillCommand({
      text,
      skills: skillItems,
      commands: sync.data.command,
    })
    if (skillItems.length > 0 && !skillCommand) {
      showToast({
        title: language.t("prompt.toast.commandSendFailed.title"),
        description: language.t("prompt.toast.skillUnavailable.description"),
      })
      return
    }
    if (skillCommand) {
      const prepared = await materializeAttachments()
      if (!prepared) return
      try {
        await warpIfNeeded()
      } catch (err) {
        showToast({
          title: "无法切换到远端",
          description: errorMessage(err),
        })
        return
      }
      removeCommentItems(skillItems)
      clearInput()
      client.session
        .command({
          sessionID,
          command: skillCommand.command,
          arguments: skillCommand.arguments,
          agent,
          model: `${model.providerID}/${model.modelID}`,
          variant,
          parts: draftImages(prepared.prompt).map((attachment) => ({
            id: Identifier.ascending("part"),
            type: "file" as const,
            mime: attachment.mime,
            url: attachment.dataUrl,
            filename: attachment.filename,
          })),
        })
        .then(() => clearTransientAttachmentsFromPrompt(currentPrompt))
        .catch((err) => {
          showToast({
            title: language.t("prompt.toast.commandSendFailed.title"),
            description: formatServerError(err, language.t, language.t("common.requestFailed")),
          })
          restoreSkillItems(skillItems)
          restoreInput()
        })
      if (newSessionHref) navigate(newSessionHref)
      return
    }

    if (text.startsWith("/")) {
      const [cmdName, ...args] = text.split(" ")
      const commandName = cmdName.slice(1)
      const customCommand = sync.data.command.find((c) => c.name === commandName)
      if (customCommand) {
        const prepared = await materializeAttachments()
        if (!prepared) return
        try {
          await warpIfNeeded()
        } catch (err) {
          showToast({
            title: "无法切换到远端",
            description: errorMessage(err),
          })
          return
        }
        clearInput()
        client.session
          .command({
            sessionID,
            command: commandName,
            arguments: args.join(" "),
            agent,
            model: `${model.providerID}/${model.modelID}`,
            variant,
            parts: draftImages(prepared.prompt).map((attachment) => ({
              id: Identifier.ascending("part"),
              type: "file" as const,
              mime: attachment.mime,
              url: attachment.dataUrl,
              filename: attachment.filename,
            })),
          })
          .then(() => clearTransientAttachmentsFromPrompt(currentPrompt))
          .catch((err) => {
            showToast({
              title: language.t("prompt.toast.commandSendFailed.title"),
              description: formatServerError(err, language.t, language.t("common.requestFailed")),
            })
            restoreInput()
          })
        if (newSessionHref) navigate(newSessionHref)
        return
      }
    }

    const commentItems = context.flatMap((item) =>
      item.type === "file" && item.comment?.trim()
        ? [
            {
              key: item.key,
              path: item.path,
              selection: item.selection,
              comment: item.comment,
              commentID: item.commentID,
              commentOrigin: item.commentOrigin,
              preview: item.preview,
            },
          ]
        : [],
    )
    const messageID = Identifier.ascending("message")

    const removeOptimisticMessage = () => {
      sync.session.optimistic.remove({
        directory: sessionDirectory,
        sessionID,
        messageID,
      })
    }

    removeCommentItems(commentItems)
    clearInput()
    if (newSessionHref) navigate(newSessionHref)

    const waitForWorktree = async () => {
      const worktree = WorktreeState.get(sessionDirectory)
      if (!worktree || worktree.status !== "pending") return true

      if (sessionDirectory === projectDirectory) {
        sync.set("session_status", sessionID, { type: "busy" })
      }

      const controller = new AbortController()
      const cleanup = () => {
        if (sessionDirectory === projectDirectory) {
          sync.set("session_status", sessionID, { type: "idle" })
        }
        removeOptimisticMessage()
        restoreCommentItems(commentItems)
        restoreInput()
      }

      pending.set(sessionID, { abort: controller, cleanup })

      const abortWait = new Promise<Awaited<ReturnType<typeof WorktreeState.wait>>>((resolve) => {
        if (controller.signal.aborted) {
          resolve({ status: "failed", message: "aborted" })
          return
        }
        controller.signal.addEventListener(
          "abort",
          () => {
            resolve({ status: "failed", message: "aborted" })
          },
          { once: true },
        )
      })

      const timeoutMs = 5 * 60 * 1000
      const timer = { id: undefined as number | undefined }
      const timeout = new Promise<Awaited<ReturnType<typeof WorktreeState.wait>>>((resolve) => {
        timer.id = window.setTimeout(() => {
          resolve({
            status: "failed",
            message: language.t("workspace.error.stillPreparing"),
          })
        }, timeoutMs)
      })

      const result = await Promise.race([WorktreeState.wait(sessionDirectory), abortWait, timeout]).finally(() => {
        if (timer.id === undefined) return
        clearTimeout(timer.id)
      })
      pending.delete(sessionID)
      if (controller.signal.aborted) return false
      if (result.status === "failed") throw new Error(result.message)
      return true
    }

    persistLock = true
    const send = sendFollowupDraft({
      client,
      sync,
      globalSync,
      language,
      draft,
      messageID,
      optimisticBusy: sessionDirectory === projectDirectory,
      environment: environmentFor(sessionDirectory, sessionID),
      before: async () => {
        await warpIfNeeded()
        return waitForWorktree()
      },
      onSessionMissing: async () => {
        if (!remoteWorkspaceID) return false
        try {
          await warpToRemote()
          return true
        } catch {
          return false
        }
      },
    }).catch((err) => {
      pending.delete(sessionID)
      if (sessionDirectory === projectDirectory) {
        sync.set("session_status", sessionID, { type: "idle" })
      }
      showToast({
        title: err instanceof Error && err.name === "RemoteWarpError"
          ? "无法切换到远端"
          : language.t("prompt.toast.promptSendFailed.title"),
        description: errorMessage(err),
      })
      removeOptimisticMessage()
      restoreCommentItems(commentItems)
      restoreInput()
    }).finally(() => {
      submitting = false
    })
    void send
    } finally {
      if (!persistLock) submitting = false
    }
  }

  return {
    abort,
    handleSubmit,
  }
}
