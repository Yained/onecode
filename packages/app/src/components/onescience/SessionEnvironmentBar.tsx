import { For, Show, createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Icon } from "@opencode-ai/ui/icon"
import { copyTextToClipboard } from "@opencode-ai/ui/clipboard"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { DialogCreateProjectFolder } from "@/components/dialog-create-project-folder"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import {
  applyServerRuntimeEnvironment,
  envKeyOf,
  inferSessionBoundEnvironment,
  projectAllowsRemoteEnvironment,
  runtimeEnvironmentFor,
  runtimeEnvironmentLabel,
  runtimeEnvironmentRevision,
  serverRuntimeEnvironmentFor,
  sessionBoundEnvironmentRevision,
  sessionEnvironmentMismatch,
  useRuntimeEnvironment,
} from "@/components/onescience/runtime-environment"
import {
  hydrateProjectRuntimeEnvironment,
  persistProjectExecutionMarker,
  persistProjectExecutionToControlPlane,
  projectExecutionHydrateClientFromSdk,
  resolveProjectRemotePath,
} from "@/components/onescience/project-execution"
import { useServer } from "@/context/server"
import { useSDK } from "@/context/sdk"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { usePrompt } from "@/context/prompt"
import { useSync } from "@/context/sync"
import { useRouteParams } from "@/hooks/use-route-params"
import { markCodeNewSessionIntent } from "@/code-session-navigation"
import { pushSessionHandoffDraft } from "@/pages/session/handoff"
import { workspacePromptText } from "@/pages/session/workspace-prompt"
import { moveScenarioRun } from "@/workbench/capabilities/scenario-run"
import { openRightDock } from "@/workbench/right-dock"
import { isWorkspaceHomePath, workspaceSessionHref } from "@/workbench/routes"
import { storedPlatformAuthSession } from "@/utils/platform-auth"
import { pathKey } from "@/utils/path-key"
import { displayName } from "@/pages/layout/helpers"
import { shouldUseNativeProjectPicker } from "@/utils/project-picker"
import {
  fetchSshConnectProgress,
  abortSshConnect,
  initialConnectSteps,
  initialPreflightSteps,
  mergeConnectProgress,
  applyServerRemoteWorkspace,
  boundWorkspaceID,
  clearRemoteWorkspaceUserStopped,
  isRemoteWorkspaceConnected,
  isRemoteWorkspaceUserStopped,
  lastKnownWorkspaceID,
  markRemoteWorkspaceUserStopped,
  preflightSshWorkspace,
  remoteProjectSlug,
  remoteWorkspaceFor,
  remoteWorkspaceRevision,
  setRemoteWorkspaceFor,
  fileWaitConnectSteps,
  sshConnectProgressKey,
  waitForWorkspaceFileList,
  sshPreflightProgressKey,
  SSH_CONNECT_TIMEOUT_MS,
  SSH_CONNECT_TIMEOUT_MESSAGE,
  type ConnectProgressStep,
} from "@/components/onescience/remote-workspace"
import { sshTestPayload } from "@/components/onescience/execution-location"
import { ensureOpenSshDiskHydrated } from "@/components/onescience/use-registered-ssh-connectivity"
import { useQueryClient } from "@tanstack/solid-query"

const AUTO_DISCONNECT_RETRY_MS = 15_000
const DISCONNECT_TIMEOUT_MS = 45_000

function withTimeout<T>(promise: Promise<T>, ms: number, message: string, abort?: AbortController) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise.finally(() => {
      if (timer !== undefined) clearTimeout(timer)
    }),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(message))
        abort?.abort()
      }, ms)
    }),
  ])
}

function isAbortError(err: unknown) {
  if (!err || typeof err !== "object") return false
  const record = err as { name?: unknown; message?: unknown }
  if (record.name === "AbortError") return true
  const message = typeof record.message === "string" ? record.message : ""
  return /aborted|abort/i.test(message)
}

function workspaceClientError(err: unknown, fallback: string) {
  if (err && typeof err === "object") {
    const record = err as {
      data?: { message?: unknown }
      error?: { data?: { message?: unknown }; message?: unknown }
      message?: unknown
    }
    const nested =
      (typeof record.data?.message === "string" && record.data.message) ||
      (typeof record.error?.data?.message === "string" && record.error.data.message) ||
      (typeof record.error?.message === "string" && record.error.message)
    if (nested && nested.trim()) return nested.trim()
  }
  if (err instanceof Error && err.message.trim()) return err.message.trim()
  return fallback
}

function fromSteps(
  steps: ConnectProgressStep[],
  error: string | undefined,
  titles: { live: string; fail: string },
) {
  const failed = Boolean(error) || steps.some((item) => item.status === "fail")
  const checks =
    failed && !steps.some((item) => item.status === "fail")
      ? steps.map((item) => (item.status === "current" ? { ...item, status: "fail" as const } : item))
      : steps
  return {
    title: failed ? titles.fail : titles.live,
    tone: failed ? ("fail" as const) : checks.every((item) => item.status === "ok") ? ("ok" as const) : ("pending" as const),
    checks,
    error,
  }
}

function fromConnect(steps: ConnectProgressStep[], error?: string) {
  return fromSteps(steps, error, { live: "连接进度", fail: "连接失败" })
}

function fromPreflight(steps: ConnectProgressStep[], error?: string) {
  return fromSteps(steps, error, { live: "检测进度", fail: "检测失败" })
}

function projectName(directory: string) {
  const parts = directory.replaceAll("\\", "/").split("/").filter(Boolean)
  return parts[parts.length - 1] ?? directory
}

function copyPath(value: string, labels: { ok: string; fail: string }) {
  void copyTextToClipboard(value).then((ok) => {
    showToast({
      title: ok ? labels.ok : labels.fail,
      ...(ok ? { variant: "success" as const } : {}),
    })
  })
}

function PathCopyButton(props: { value: string; label: string; copied: string; failed: string }) {
  return (
    <button
      type="button"
      class="os-session-project-copy"
      aria-label={props.label}
      title={props.label}
      onClick={() => copyPath(props.value, { ok: props.copied, fail: props.failed })}
    >
      <Icon name="copy" size="small" />
    </button>
  )
}

export function SessionEnvironmentBar(props: { directory: Accessor<string> }) {
  const server = useServer()
  const sdk = useSDK()
  const globalSDK = useGlobalSDK()
  const queryClient = useQueryClient()
  const globalSync = useGlobalSync()
  const sync = useSync()
  const dialog = useDialog()
  const language = useLanguage()
  const layout = useLayout()
  const platform = usePlatform()
  const prompt = usePrompt()
  const navigate = useNavigate()
  const params = useRouteParams()
  const name = createMemo(() => projectName(props.directory()))
  const runtime = useRuntimeEnvironment(props.directory)
  const hydrateAttempted = new Set<string>()
  const binding = createMemo(() => {
    remoteWorkspaceRevision()
    return remoteWorkspaceFor(props.directory())
  })
  const projectID = createMemo(() => {
    const directory = props.directory()
    if (!directory) return undefined
    const key = pathKey(directory)
    return globalSync.data.project.find((project) => {
      if (pathKey(project.worktree) === key) return true
      return project.sandboxes?.some((sandbox) => pathKey(sandbox) === key)
    })?.id
  })
  const projectExecution = createMemo(() => {
    const directory = props.directory()
    if (!directory) return undefined
    const key = pathKey(directory)
    const project = globalSync.data.project.find((item) => {
      if (pathKey(item.worktree) === key) return true
      return item.sandboxes?.some((sandbox) => pathKey(sandbox) === key)
    })
    // SDK Project type lags the control-plane schema; execution is present at runtime.
    return (project as { execution?: unknown } | undefined)?.execution
  })
  const resolvedRemotePath = createMemo(() => {
    remoteWorkspaceRevision()
    const directory = props.directory()
    if (!directory) return undefined
    return resolveProjectRemotePath({
      directory,
      bindingPath: remoteWorkspaceFor(directory)?.remotePath,
      execution: projectExecution(),
    })
  })

  const [busy, setBusy] = createSignal<"preflight" | "connect" | "disconnect" | undefined>()
  const [banner, setBanner] = createSignal<{
    title: string
    tone: "ok" | "fail" | "pending"
    checks: Array<{ id: string; message: string; status: "pending" | "current" | "ok" | "fail" | "skip"; detail?: string }>
    error?: string
  }>()
  const [disconnectFailedAt, setDisconnectFailedAt] = createSignal<Record<string, number>>({})
  const [retryTick, setRetryTick] = createSignal(0)
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let connectGen = 0
  let connectAbort: AbortController | undefined
  let preflightGen = 0
  let preflightAbort: AbortController | undefined

  const clearRetryTimer = () => {
    if (retryTimer === undefined) return
    clearTimeout(retryTimer)
    retryTimer = undefined
  }

  const scheduleRetry = (wait: number) => {
    if (retryTimer !== undefined) return
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      setRetryTick(Date.now())
    }, Math.max(wait, 0))
  }

  onCleanup(() => {
    clearRetryTimer()
    connectAbort?.abort()
    preflightAbort?.abort()
  })

  const cancelRemoteWork = () => {
    const kind = busy()
    if (kind === "preflight") {
      preflightAbort?.abort()
      preflightAbort = undefined
      preflightGen += 1
      const steps = banner()?.checks ?? []
      setBusy(undefined)
      setBanner({
        title: "检测已取消",
        tone: "fail",
        checks: steps.map((item) =>
          item.status === "current" ? { ...item, status: "fail" as const } : item,
        ),
        error: "已手动取消",
      })
      return
    }
    if (kind !== "connect") {
      setBanner(undefined)
      return
    }
    connectAbort?.abort()
    connectAbort = undefined
    connectGen += 1
    const directory = props.directory()
    const envNow = runtime.env()
    const current = server.current
    if (directory && envNow.kind === "ssh" && current) {
      void abortSshConnect({
        globalUrl: current.http.url,
        key: sshConnectProgressKey(envNow.targetName, directory),
        auth: current.http.password
          ? { username: current.http.username, password: current.http.password }
          : undefined,
      })
    }
    const steps = banner()?.checks ?? []
    setBusy(undefined)
    setBanner({
      title: "连接已取消",
      tone: "fail",
      checks: steps.map((item) =>
        item.status === "current" ? { ...item, status: "fail" as const } : item,
      ),
      error: "已手动取消",
    })
    showToast({
      title: "已取消连接",
      description: "远端清理可能仍在后台进行，可稍后再试",
    })
  }

  const openProjectWithPrompt = (directory: string) => {
    const next = directory.trim()
    if (!next) return
    if (pathKey(next) === pathKey(props.directory())) return

    const text = workspacePromptText(prompt.current())
    const skillItem = prompt.context.items().find((item) => item.type === "skill")
    const skill =
      skillItem && skillItem.type === "skill"
        ? { name: skillItem.name, title: skillItem.title }
        : undefined
    const fromSlug = base64Encode(props.directory())
    const slug = base64Encode(next)
    if (text.trim() || skill) {
      pushSessionHandoffDraft(slug, text, skill ? { skill } : undefined)
    }
    // Keep scenario workflow with the moved prompt when switching project directory.
    if (moveScenarioRun(fromSlug, slug)) {
      openRightDock("todo")
    }
    markCodeNewSessionIntent(slug)
    layout.projects.open(next)
    server.projects.touchCode(next)
    navigate(workspaceSessionHref(next))
  }

  const createProjectFolder = () => {
    dialog.show(() => <DialogCreateProjectFolder onCreated={(directory) => openProjectWithPrompt(directory)} />)
  }

  async function chooseProject() {
    const nativePicker = platform.openDirectoryPickerDialog
    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        const first = result[0]
        if (first) openProjectWithPrompt(first)
        return
      }
      if (result) openProjectWithPrompt(result)
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

  const clearSessionBusy = () => {
    const sessionID = params.id
    const directory = props.directory()
    if (!sessionID || !directory) return
    const [, setStore] = globalSync.child(directory, { bootstrap: false })
    setStore("session_status", sessionID, { type: "idle" })
  }

  const sshSelected = () => runtime.env().kind === "ssh"
  const connected = () => {
    const current = binding()
    const env = runtime.env()
    return env.kind === "ssh" && current?.targetName === env.targetName && isRemoteWorkspaceConnected(current)
  }
  const sessionEnv = createMemo(() => {
    sessionBoundEnvironmentRevision()
    const sessionID = params.id
    if (!sessionID) return undefined
    return inferSessionBoundEnvironment({
      sessionID,
      messages: sync.data.message[sessionID] ?? [],
      partsByMessage: sync.data.part,
      sessionWorkspaceID: sync.session.get(sessionID)?.workspaceID,
      binding: binding(),
    })
  })
  const displayEnv = createMemo(() => runtime.env())
  const displayRemotePath = createMemo(() => {
    const env = displayEnv()
    if (env.kind !== "ssh") return undefined
    return resolvedRemotePath()
  })
  const projectPath = createMemo(() => {
    if (displayEnv().kind !== "ssh") return props.directory()
    return displayRemotePath() ?? ""
  })
  const projectLabel = createMemo(() => {
    const directory = props.directory()
    const project = layout.projects.list().find((item) => pathKey(item.worktree) === pathKey(directory))
    if (project) return displayName(project)
    return name()
  })
  const envMismatch = createMemo(() => sessionEnvironmentMismatch(sessionEnv(), runtime.env()))
  const copyLabels = () => ({
    label: language.t("session.environment.copy"),
    copied: language.t("session.environment.copied"),
    failed: language.t("session.environment.copyFailed"),
  })

  const detect = async () => {
    const env = runtime.env()
    const directory = props.directory()
    if (env.kind !== "ssh" || !directory) return
    if (busy() === "preflight") {
      cancelRemoteWork()
      return
    }
    if (busy()) return
    await ensureOpenSshDiskHydrated(globalSDK.url, queryClient).catch(() => undefined)
    const target = runtime.sshTarget()
    if (!target) {
      setBanner({
        title: "检测失败",
        tone: "fail",
        checks: [],
        error: "未找到 SSH 目标配置，请重新选择后再检测",
      })
      return
    }
    const current = server.current
    if (!current) {
      setBanner({
        title: "检测失败",
        tone: "fail",
        checks: [],
        error: "当前没有可用的控制面连接",
      })
      return
    }
    const wantedTarget = env.targetName
    const gen = ++preflightGen
    const progressKey = sshPreflightProgressKey(wantedTarget, directory)
    preflightAbort?.abort()
    const abort = new AbortController()
    preflightAbort = abort
    setBusy("preflight")
    setBanner(fromPreflight(initialPreflightSteps()))
    const auth = current.http.password
      ? { username: current.http.username, password: current.http.password }
      : undefined
    let stopped = false
    const pollTimer = setInterval(() => {
      if (stopped) return
      void fetchSshConnectProgress({ globalUrl: current.http.url, key: progressKey, auth })
        .then((steps) => {
          if (stopped || steps.length === 0) return
          setBanner((prev) => (prev ? fromPreflight(steps) : prev))
        })
        .catch(() => undefined)
    }, 500)
    try {
      const rememberedPath = resolvedRemotePath()
      const result = await preflightSshWorkspace({
        globalUrl: current.http.url,
        directory,
        target,
        accountId: storedPlatformAuthSession()?.account.id,
        remotePath: rememberedPath,
        progressKey,
        auth,
        signal: abort.signal,
      })
      if (gen !== preflightGen) return
      setBanner({
        title: result.ok ? "检测结果" : "检测失败",
        tone: result.ok ? "ok" : "fail",
        checks: result.checks.map((item) => ({
          id: item.id,
          message: item.message,
          status: (item.skipped ? "skip" : item.ok ? "ok" : "fail") as "ok" | "fail" | "skip",
          detail: item.detail,
        })),
      })
      if (result.ok && result.remotePath.trim()) {
        const currentBinding = remoteWorkspaceFor(directory)
        setRemoteWorkspaceFor(directory, {
          workspaceID: currentBinding?.workspaceID ?? "",
          targetName: wantedTarget,
          remotePath: result.remotePath.trim(),
        })
      }
    } catch (err) {
      if (gen !== preflightGen || isAbortError(err)) return
      const message = workspaceClientError(err, "预检失败")
      const steps = await fetchSshConnectProgress({ globalUrl: current.http.url, key: progressKey, auth }).catch(
        () => [],
      )
      setBanner(fromPreflight(steps.length ? steps : initialPreflightSteps(), message))
      showToast({ title: "检测失败", description: message.split("\n")[0] })
    } finally {
      stopped = true
      clearInterval(pollTimer)
      if (preflightAbort === abort) preflightAbort = undefined
      if (gen === preflightGen) setBusy(undefined)
    }
  }

  const connect = async () => {
    const env = runtime.env()
    const directory = props.directory()
    if (env.kind !== "ssh" || !directory) return
    if (busy() === "connect") {
      cancelRemoteWork()
      return
    }
    if (busy()) return
    await ensureOpenSshDiskHydrated(globalSDK.url, queryClient).catch(() => undefined)
    const target = runtime.sshTarget()
    if (!target) {
      setBanner({
        title: "连接失败",
        tone: "fail",
        checks: [],
        error: "未找到 SSH 目标配置，请重新选择后再连接",
      })
      return
    }
    const current = server.current
    const wantedTarget = env.targetName
    const gen = ++connectGen
    const progressKey = sshConnectProgressKey(wantedTarget, directory)
    connectAbort?.abort()
    const abort = new AbortController()
    connectAbort = abort
    setBusy("connect")
    setBanner(fromConnect(initialConnectSteps()))
    clearRemoteWorkspaceUserStopped(directory)
    let workspaceID: string | undefined
    let bound = false
    let warped = false
    let stopped = false
    let pollTimer: ReturnType<typeof setInterval> | undefined
    const auth = current?.http.password
      ? { username: current.http.username, password: current.http.password }
      : undefined
    if (current) {
      pollTimer = setInterval(() => {
        if (stopped) return
        void fetchSshConnectProgress({ globalUrl: current.http.url, key: progressKey, auth })
          .then((steps) => {
            if (stopped || steps.length === 0) return
            setBanner((prev) => (prev ? fromConnect(mergeConnectProgress(steps)) : prev))
          })
          .catch(() => undefined)
      }, 500)
    }
    try {
      const stale = () => {
        const now = runtime.env()
        return gen !== connectGen || now.kind !== "ssh" || now.targetName !== wantedTarget
      }
      const discardCreated = async (id: string) => {
        if (warped && params.id) {
          await sdk.client.experimental.workspace
            .warp({
              directory,
              id: null,
              sessionID: params.id,
              copyChanges: false,
            })
            .catch(() => undefined)
        }
        await sdk.client.experimental.workspace
          .remove({
            id,
            directory,
          })
          .catch(() => undefined)
      }
      const rememberedPath = resolvedRemotePath()
      await persistProjectExecutionMarker(
        (input) => sdk.client.file.write(input),
        directory,
        env,
        rememberedPath,
      ).catch(() => undefined)
      const created = await withTimeout(
        sdk.client.experimental.workspace.create(
          {
            directory,
            type: "ssh-node",
            branch: null,
            extra: {
              sshTarget: wantedTarget,
              accountId: storedPlatformAuthSession()?.account.id,
              projectSlug: remoteProjectSlug(directory),
              localDirectory: directory,
              ssh: sshTestPayload(target),
              progressKey,
              ...(rememberedPath ? { remotePath: rememberedPath } : {}),
            },
          },
          { signal: abort.signal },
        ),
        SSH_CONNECT_TIMEOUT_MS,
        SSH_CONNECT_TIMEOUT_MESSAGE,
        abort,
      )
      workspaceID = created.data?.id
      if (!workspaceID) throw new Error("创建远端 workspace 失败")
      if (stale()) {
        await discardCreated(workspaceID)
        stopped = true
        setBanner(undefined)
        showToast({ title: "已取消远端连接", description: "运行环境已切换" })
        return
      }
      const sessionID = params.id
      const messages = sessionID ? (sync.data.message[sessionID] ?? []) : []
      const sessionEnv = sessionID
        ? inferSessionBoundEnvironment({
            sessionID,
            messages,
            partsByMessage: sync.data.part,
            sessionWorkspaceID: sync.session.get(sessionID)?.workspaceID,
            binding: remoteWorkspaceFor(directory),
          })
        : undefined
      const canWarpSession = !sessionEnv || envKeyOf(sessionEnv) === envKeyOf(runtime.env())
      if (sessionID && canWarpSession) {
        // Leaf may still be NFS/SQLite-busy after /file is up; sync/replay Transport
        // errors must not undo a successful SSH connect (serve+tunnel already live).
        try {
          await sdk.client.experimental.workspace.warp({
            directory,
            id: workspaceID,
            sessionID,
            copyChanges: false,
          })
          warped = true
        } catch (warpErr) {
          const detail = workspaceClientError(warpErr, "同步会话失败")
          console.warn("workspace warp after connect failed", detail)
          showToast({
            title: "远端已连接，会话同步稍后重试",
            description: detail.split("\n")[0],
          })
        }
      }
      if (stale()) {
        await discardCreated(workspaceID)
        stopped = true
        setBanner(undefined)
        showToast({ title: "已取消远端连接", description: "运行环境已切换" })
        return
      }
      // Tunnel probe is not enough: the workbench talks A→proxy→leaf. Bind only
      // after that path can list files, otherwise 已连接 + 发送秒消失.
      stopped = true
      if (pollTimer !== undefined) {
        clearInterval(pollTimer)
        pollTimer = undefined
      }
      const markFileWait = (detail: string) => {
        setBanner(fromConnect(fileWaitConnectSteps(detail)))
      }
      markFileWait("正在等待文件服务")
      const probe = sdk.createClient({
        directory,
        throwOnError: true,
        experimental_workspaceID: workspaceID,
      })
      await waitForWorkspaceFileList({
        list: () => probe.file.list({ path: "" }),
        abort: abort.signal,
        onDetail: markFileWait,
      })
      if (stale()) {
        await discardCreated(workspaceID)
        setBanner(undefined)
        showToast({ title: "已取消远端连接", description: "运行环境已切换" })
        return
      }
      setRemoteWorkspaceFor(directory, {
        workspaceID,
        targetName: wantedTarget,
        ...(typeof created.data?.directory === "string" && created.data.directory.trim()
          ? { remotePath: created.data.directory.trim() }
          : {}),
      })
      bound = true
      const connectedPath =
        typeof created.data?.directory === "string" && created.data.directory.trim()
          ? created.data.directory.trim()
          : undefined
      if (current) {
        void persistProjectExecutionToControlPlane({
          globalUrl: current.http.url,
          directory,
          projectID: projectID(),
          env,
          remotePath: connectedPath,
          auth: current.http.password
            ? { username: current.http.username, password: current.http.password }
            : undefined,
        })
      }
      void persistProjectExecutionMarker(
        (input) => sdk.client.file.write(input),
        directory,
        env,
        connectedPath,
      ).catch(() => undefined)
      stopped = true
      setBanner(undefined)
      showToast({ title: "已连接远端", description: wantedTarget })
    } catch (err) {
      if (current) {
        void abortSshConnect({
          globalUrl: current.http.url,
          key: progressKey,
          auth,
        })
      }
      if (workspaceID && !bound) {
        await sdk.client.experimental.workspace
          .remove({
            id: workspaceID,
            directory,
          })
          .catch(() => undefined)
      }
      if (gen !== connectGen || isAbortError(err)) {
        stopped = true
        return
      }
      const message = workspaceClientError(err, "连接远端失败")
      const steps = current
        ? await fetchSshConnectProgress({ globalUrl: current.http.url, key: progressKey, auth }).catch(() => [])
        : []
      stopped = true
      setBanner(fromConnect(steps.length ? mergeConnectProgress(steps) : initialConnectSteps(), message))
      showToast({ title: "连接远端失败", description: message.split("\n")[0] })
    } finally {
      stopped = true
      if (pollTimer !== undefined) clearInterval(pollTimer)
      if (connectAbort === abort) connectAbort = undefined
      if (gen === connectGen) setBusy(undefined)
    }
  }

  const disconnect = async () => {
    const directory = props.directory()
    const current = binding()
    if (!directory || !current) return false
    if (!current.workspaceID) return true
    setBusy("disconnect")
    try {
      const sessionID = params.id
      const sessionWorkspaceID = sessionID ? sync.session.get(sessionID)?.workspaceID : undefined
      if (sessionID && sessionWorkspaceID === current.workspaceID) {
        await withTimeout(
          sdk.client.experimental.workspace
            .warp({
              directory,
              id: null,
              sessionID,
              copyChanges: false,
            })
            .catch(() => undefined),
          8_000,
          "断开远端超时",
        ).catch(() => undefined)
      }
      await withTimeout(
        sdk.client.experimental.workspace.remove({
          id: current.workspaceID,
          directory,
        }),
        DISCONNECT_TIMEOUT_MS,
        "断开远端超时",
      )
      showToast({ title: "已断开远端" })
      markRemoteWorkspaceUserStopped(directory)
      setRemoteWorkspaceFor(directory, {
        workspaceID: "",
        targetName: current.targetName,
        ...(current.remotePath?.trim() ? { remotePath: current.remotePath.trim() } : {}),
      })
      if (sessionID) void sync.session.sync(sessionID, { force: true }).catch(() => undefined)
      return true
    } catch (err) {
      const message = workspaceClientError(err, "断开失败")
      setBanner({
        title: "断开失败",
        tone: "fail",
        checks: [],
        error: message,
      })
      showToast({ title: "断开失败", description: message.split("\n")[0] })
      return false
    } finally {
      clearSessionBusy()
      setBusy(undefined)
    }
  }

  const persistRestored = (directory: string, env: { kind: "ssh"; targetName: string }, remotePath?: string) => {
    const path = remotePath?.trim() || remoteWorkspaceFor(directory)?.remotePath
    void persistProjectExecutionMarker((input) => sdk.client.file.write(input), directory, env, path).catch(
      () => undefined,
    )
    const current = server.current
    if (!current) return
    void persistProjectExecutionToControlPlane({
      globalUrl: current.http.url,
      directory,
      projectID: projectID(),
      env,
      remotePath: path,
      auth: current.http.password
        ? { username: current.http.username, password: current.http.password }
        : undefined,
    })
  }

  createEffect(() => {
    const directory = props.directory()
    runtimeEnvironmentRevision()
    if (!globalSync.bootstrapped) return
    if (!directory || runtimeEnvironmentFor(directory).kind === "ssh") return
    // Welcome first paint: skip marker file.read so cold /workspace keeps HTTP free.
    if (typeof window !== "undefined" && isWorkspaceHomePath(window.location.pathname)) return
    const key = pathKey(directory)
    if (hydrateAttempted.has(key)) return
    hydrateAttempted.add(key)
    void hydrateProjectRuntimeEnvironment(directory, projectExecutionHydrateClientFromSdk(sdk, directory)).then(
      (restored) => {
        if (restored?.env.kind === "ssh") {
          persistRestored(directory, restored.env, restored.remotePath)
          return
        }
        // No marker: stamp confirmed local so SyncProvider can bootstrap. Leaving the
        // server map empty kept kind as *default* local and still blocked/confused the
        // unbound-remote gate (cache-clear first remote open freeze).
        if (projectAllowsRemoteEnvironment(directory) && !serverRuntimeEnvironmentFor(directory)) {
          applyServerRuntimeEnvironment(directory, { kind: "local" })
        }
      },
    )
  })

  const reconcileFromServer = async (directory: string, wanted: string, clearIfAbsent: boolean) => {
    const [listed, status] = await Promise.all([
      sdk.client.experimental.workspace.list({ directory }),
      sdk.client.experimental.workspace.status({ directory }),
    ])
    const now = runtime.env()
    if (now.kind !== "ssh" || now.targetName !== wanted) return undefined
    if (busy()) return undefined
    if (isRemoteWorkspaceUserStopped(directory)) {
      // User clicked 断开. Leftover serve / sibling workspace rows must not
      // flip the bar back to 已连接 until they click 连接.
      return applyServerRemoteWorkspace(directory, {
        targetName: wanted,
        list: [],
        status: [],
        clearIfAbsent: true,
      })
    }
    return applyServerRemoteWorkspace(directory, {
      targetName: wanted,
      list: listed.data ?? [],
      status: status.data ?? [],
      clearIfAbsent,
    })
  }

  // Source of truth is A's list+status, not the browser cache. Reconcile on
  // open, after connect/disconnect busy clears, and when the tab is shown.
  createEffect(() => {
    const directory = props.directory()
    const env = runtime.env()
    const currentBusy = busy()
    if (!directory || env.kind !== "ssh") return
    if (currentBusy) return
    // Welcome home has no session — skip SSH reconcile storm on cache-clear F5.
    if (!params.id) return
    if (!storedPlatformAuthSession()) return
    // F5 clears the in-memory live id. Restore from A's list+status when we still
    // remember a wrk_* for this project. Skip only a true cold start (no cache)
    // or an explicit 断开 — those used to freeze the tab on list+status.
    if (
      !boundWorkspaceID(directory) &&
      (!lastKnownWorkspaceID(directory) || isRemoteWorkspaceUserStopped(directory))
    ) {
      return
    }
    const wanted = env.targetName
    let cancelled = false
    void (async () => {
      for (let i = 0; i < 3; i++) {
        if (cancelled) return
        try {
          const live = await reconcileFromServer(directory, wanted, i === 2)
          if (cancelled) return
          if (live) return
        } catch {
          if (cancelled) return
        }
        await new Promise((resolve) => setTimeout(resolve, 800))
      }
    })()
    const onVisible = () => {
      if (document.visibilityState !== "visible") return
      if (busy()) return
      if (!boundWorkspaceID(directory)) return
      void reconcileFromServer(directory, wanted, true).catch(() => undefined)
    }
    document.addEventListener("visibilitychange", onVisible)
    onCleanup(() => {
      cancelled = true
      document.removeEventListener("visibilitychange", onVisible)
    })
  })

  createEffect(() => {
    const directory = props.directory()
    const env = runtime.env()
    if (!directory || env.kind !== "ssh") return
    // Welcome home has no session — skip status-event reconcile storm that remounts
    // workbench and freezes clicks after cache-clear F5.
    if (!params.id) return
    if (!storedPlatformAuthSession()) return
    if (!boundWorkspaceID(directory)) return
    const wanted = env.targetName
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsub = globalSDK.event.listen((event) => {
      const type = event.details.type
      if (type !== "workspace.status" && type !== "server.connected") return
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        if (busy()) return
        if (!boundWorkspaceID(directory)) return
        // Status can flicker empty during retunnel/health blips. Clearing
        // boundWorkspaceID here remounts the whole workbench and can freeze
        // the tab — only clear on mount/visibility reconcile, not every event.
        void reconcileFromServer(directory, wanted, false).catch(() => undefined)
      }, 250)
    })
    onCleanup(() => {
      if (timer !== undefined) clearTimeout(timer)
      unsub()
    })
  })

  createEffect(() => {
    if (runtime.env().kind === "scnet") runtime.setEnv({ kind: "local" })
  })

  createEffect((previous: string | undefined) => {
    const env = runtime.env()
    const key = envKeyOf(env)
    if (previous !== undefined && previous !== key) {
      connectAbort?.abort()
      connectAbort = undefined
      connectGen += 1
      preflightAbort?.abort()
      preflightAbort = undefined
      preflightGen += 1
      setBusy(undefined)
      setBanner(undefined)
    }
    return key
  })

  createEffect(() => {
    const env = runtime.env()
    const current = binding()
    retryTick()
    if (!current || busy()) return
    if (!current.workspaceID) return
    if (env.kind === "ssh" && env.targetName === current.targetName) {
      clearRetryTimer()
      if (Object.keys(disconnectFailedAt()).length) setDisconnectFailedAt({})
      return
    }
    const last = disconnectFailedAt()[current.workspaceID]
    if (last && Date.now() - last < AUTO_DISCONNECT_RETRY_MS) {
      scheduleRetry(AUTO_DISCONNECT_RETRY_MS - (Date.now() - last))
      return
    }
    void disconnect().then((ok) => {
      if (ok) {
        setDisconnectFailedAt((prev) => {
          if (!(current.workspaceID in prev)) return prev
          const next = { ...prev }
          delete next[current.workspaceID]
          return next
        })
        return
      }
      setDisconnectFailedAt((prev) => ({ ...prev, [current.workspaceID]: Date.now() }))
      scheduleRetry(AUTO_DISCONNECT_RETRY_MS)
    })
  })

  return (
    <Show when={props.directory()}>
      <div class="mt-3 mb-1.5 px-1">
        <div class="os-session-project">
          <div class="os-session-project-rows">
            <div class="os-session-project-row" data-role="env">
              <div class="os-session-env-line">
                <div class="os-session-project-card">
                  <Show when={envMismatch()}>
                    <span class="os-session-env-tag">{language.t("session.environment.session")}</span>
                  </Show>
                  <span class="os-session-project-value">{runtimeEnvironmentLabel(displayEnv())}</span>
                </div>
                <Show when={envMismatch()}>
                  <div class="os-session-project-card">
                    <span class="os-session-env-tag">{language.t("session.environment.project")}</span>
                    <span class="os-session-project-value">{runtimeEnvironmentLabel(runtime.env())}</span>
                  </div>
                </Show>
                <Show when={!envMismatch() && sshSelected() && !connected()}>
                  <button
                    type="button"
                    class="os-session-conda-query"
                    disabled={busy() === "connect" || busy() === "disconnect"}
                    onClick={() => void detect()}
                  >
                    {busy() === "preflight" ? "取消检测" : "检测"}
                  </button>
                  <button
                    type="button"
                    class="os-session-conda-query"
                    disabled={busy() === "disconnect" || busy() === "preflight"}
                    onClick={() => void connect()}
                  >
                    {busy() === "connect" ? "取消连接" : "连接"}
                  </button>
                </Show>
                <Show when={!envMismatch() && connected()}>
                  <span class="text-11-regular text-text-success">已连接</span>
                </Show>
                <Show when={!envMismatch() && connected()}>
                  <button
                    type="button"
                    class="os-session-conda-query"
                    disabled={!!busy()}
                    onClick={() => void disconnect()}
                  >
                    {busy() === "disconnect" ? "断开中..." : "断开"}
                  </button>
                </Show>
              </div>
            </div>
            <div class="os-session-project-row" data-role="project">
              <div
                class="os-session-project-card"
                data-fill
                data-interactive
                data-kind={displayEnv().kind === "ssh" ? "remote" : undefined}
              >
                <Icon name="folder" size="small" class="os-session-project-icon" />
                <span class="os-session-project-name">{projectLabel()}</span>
                <Show
                  when={projectPath()}
                  fallback={
                    <Show when={displayEnv().kind === "ssh"}>
                      <span class="os-session-project-value text-text-weak">未连接</span>
                    </Show>
                  }
                >
                  {(path) => (
                    <>
                      <input
                        type="text"
                        class="os-session-project-path select-text"
                        value={path()}
                        readonly
                        spellcheck={false}
                        title={path()}
                        onFocus={(event) => event.currentTarget.select()}
                        onClick={(event) => event.currentTarget.select()}
                      />
                      <PathCopyButton value={path()} {...copyLabels()} />
                    </>
                  )}
                </Show>
                <button
                  type="button"
                  class="os-session-project-switch"
                  aria-label={language.t("command.project.open")}
                  title={language.t("command.project.open")}
                  onClick={() => void chooseProject()}
                >
                  切换
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Show when={banner()}>
        {(current) => (
          <div
            class="os-session-preflight"
            data-ok={current().tone === "ok" ? "true" : current().tone === "fail" ? "false" : "pending"}
          >
            <div class="os-session-preflight-head">
              <span>{current().title}</span>
              <button
                type="button"
                class="os-session-preflight-close"
                aria-label={
                  busy() === "connect"
                    ? "取消连接"
                    : busy() === "preflight"
                      ? "取消检测"
                      : current().title.includes("连接")
                        ? "关闭连接进度"
                        : current().title.includes("检测")
                          ? "关闭检测结果"
                          : "关闭提示"
                }
                title={busy() === "connect" ? "取消连接" : busy() === "preflight" ? "取消检测" : undefined}
                onClick={() => cancelRemoteWork()}
              >
                <Icon name="close" size="small" />
              </button>
            </div>
            <Show when={current().checks.length}>
              <ul class="os-session-preflight-list">
                <For each={current().checks}>
                  {(item) => (
                    <li
                      class="os-session-preflight-item"
                      data-ok={item.status === "ok" ? "true" : item.status === "fail" ? "false" : item.status}
                    >
                      <span class="os-session-preflight-mark">
                        {item.status === "ok" ? "✓" : item.status === "fail" ? "✗" : item.status === "current" ? "…" : ""}
                      </span>
                      <span class="os-session-preflight-text select-text">{item.message}</span>
                      <Show when={item.detail && item.status !== "ok"}>
                        <input
                          type="text"
                          class="os-session-preflight-detail select-text"
                          value={item.detail}
                          size={Math.max(item.detail?.length ?? 8, 8)}
                          readonly
                          spellcheck={false}
                          title={item.detail}
                          onFocus={(event) => event.currentTarget.select()}
                          onClick={(event) => event.currentTarget.select()}
                        />
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <Show when={current().error}>
              <p class="os-session-preflight-error select-text">{current().error}</p>
            </Show>
          </div>
        )}
      </Show>
    </Show>
  )
}
