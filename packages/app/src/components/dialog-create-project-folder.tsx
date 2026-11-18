import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { useMutation } from "@tanstack/solid-query"
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { errorMessage } from "@/pages/layout/helpers"
import { listProjectDataDirectories } from "@/utils/project-data-dirs"
import { defaultPlatformWorkspaceDirectory, storedPlatformAuthSession } from "@/utils/platform-auth"
import { resolveProjectFolderPath, sanitizeProjectFolderPath, allocateLocalIdentityName } from "@/utils/project-folder"
import { RuntimeEnvironmentSelect } from "@/components/onescience/RuntimeEnvironmentSelect"
import {
  defaultRuntimeEnvironment,
  setRuntimeEnvironmentFor,
  type RuntimeEnvironment,
} from "@/components/onescience/runtime-environment"
import { persistProjectExecutionMarker, persistProjectExecutionToControlPlane } from "@/components/onescience/project-execution"
import { sshTestPayload } from "@/components/onescience/execution-location"
import { useRegisteredSshConnectivity } from "@/components/onescience/use-registered-ssh-connectivity"
import {
  fetchSshConnectProgress,
  abortSshConnect,
  initialConnectSteps,
  initialPreflightSteps,
  mergeConnectProgress,
  previewDefaultRemotePath,
  preflightSshWorkspace,
  remoteProjectSlug,
  setRemoteWorkspaceFor,
  fileWaitConnectSteps,
  sshConnectProgressKey,
  waitForWorkspaceFileList,
  sshPreflightProgressKey,
  SSH_CONNECT_TIMEOUT_MS,
  SSH_CONNECT_TIMEOUT_MESSAGE,
  type ConnectProgressStep,
} from "@/components/onescience/remote-workspace"

type MkdirFailure = {
  error: unknown
  status?: number
}

export function DialogCreateProjectFolder(props: { onCreated: (directory: string) => void }) {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const server = useServer()

  const [store, setStore] = createStore({ name: "", remotePath: "" })
  const [env, setEnv] = createSignal<RuntimeEnvironment>(defaultRuntimeEnvironment())
  const [remotePathCustomized, setRemotePathCustomized] = createSignal(false)
  const [remotePathFromDetect, setRemotePathFromDetect] = createSignal(false)
  const [remotePathFocused, setRemotePathFocused] = createSignal(false)
  const [busy, setBusy] = createSignal<"preflight" | "connect" | undefined>()
  let connectAbort: AbortController | undefined
  let connectProgressKey = ""
  const [banner, setBanner] = createSignal<{
    title: string
    tone: "ok" | "fail" | "pending"
    checks: Array<{ id: string; message: string; status: "pending" | "current" | "ok" | "fail" | "skip"; detail?: string }>
    error?: string
  }>()

  const dataRoot = createMemo(
    () =>
      defaultPlatformWorkspaceDirectory(storedPlatformAuthSession()) ||
      globalSync.data.path.project_data_root ||
      "/data",
  )
  const connectivity = useRegisteredSshConnectivity({ auto: () => false })

  function connectAuth() {
    const current = server.current
    if (!current) return undefined
    return current.http.password
      ? { username: current.http.username, password: current.http.password }
      : undefined
  }

  function cancelConnecting() {
    connectAbort?.abort()
    connectAbort = undefined
    const key = connectProgressKey
    const current = server.current
    if (key && current) {
      void abortSshConnect({
        globalUrl: current.http.url,
        key,
        auth: connectAuth(),
      })
    }
  }

  onCleanup(() => {
    if (busy() === "connect") cancelConnecting()
  })

  const preview = createMemo(() => {
    const resolved = resolveProjectFolderPath(store.name, dataRoot())
    if (!resolved) return `${dataRoot()}/`
    return `${resolved}/`
  })
  const identityDirectory = createMemo(() => resolveProjectFolderPath(store.name, dataRoot()) || "")
  const remoteSelected = createMemo(() => env().kind === "ssh")
  const sshTarget = createMemo(() => {
    const current = env()
    if (current.kind !== "ssh") return undefined
    return connectivity.targets().find((item) => item.name === current.targetName)
  })
  const defaultRemotePreview = createMemo(() =>
    previewDefaultRemotePath({
      accountId: storedPlatformAuthSession()?.account.id,
      projectName: store.name,
    }),
  )

  createEffect(() => {
    void store.name
    if (!remotePathCustomized()) setRemotePathFromDetect(false)
  })

  createEffect(() => {
    if (!remoteSelected()) return
    if (remotePathCustomized() || remotePathFromDetect() || remotePathFocused()) return
    const next = defaultRemotePreview()
    if (store.remotePath !== next) setStore("remotePath", next)
  })

  function remotePathDirty() {
    return store.remotePath.trim() !== defaultRemotePreview().trim()
  }

  function extraRemotePath() {
    if (!remotePathCustomized()) return undefined
    return store.remotePath.trim() || undefined
  }

  function restoreRemotePath() {
    setRemotePathCustomized(false)
    setRemotePathFromDetect(false)
    setStore("remotePath", defaultRemotePreview())
  }

  function pollRemoteProgress(
    key: string,
    liveTitle: string,
    merge: (steps: ConnectProgressStep[]) => ConnectProgressStep[] = (steps) => steps,
  ) {
    const current = server.current
    if (!current) return () => undefined
    const auth = current.http.password
      ? { username: current.http.username, password: current.http.password }
      : undefined
    let stopped = false
    const timer = setInterval(() => {
      if (stopped) return
      void fetchSshConnectProgress({ globalUrl: current.http.url, key, auth })
        .then((steps) => {
          if (stopped || steps.length === 0) return
          const checks = merge(steps)
          const failed = checks.some((item) => item.status === "fail")
          const done = checks.every((item) => item.status === "ok")
          setBanner((prev) =>
            prev
              ? {
                  ...prev,
                  title: failed ? prev.title : liveTitle,
                  tone: failed ? "fail" : done ? "ok" : "pending",
                  checks,
                }
              : prev,
          )
        })
        .catch(() => undefined)
    }, 500)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }

  const parentRelativePath = createMemo(() => parentPathForName(store.name))

  const [existing] = createResource(parentRelativePath, async (parent) => {
    const entries = await listProjectDataDirectories(globalSDK, parent)
    return entries
      .filter((entry) => !entry.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
  })

  const nameConflict = createMemo(() => hasNameConflict(store.name, existing()))

  const canSubmit = createMemo(() => {
    if (!sanitizeProjectFolderPath(store.name)) return false
    // Remote projects get a unique local identity folder on conflict; local create still blocks.
    if (!remoteSelected() && nameConflict()) return false
    return true
  })

  const existingTitle = createMemo(() => {
    const parent = parentRelativePath()
    if (!parent) return language.t("dialog.project.createFolder.existing.title")
    return language.t("dialog.project.createFolder.existing.inParent", { parent })
  })

  // A's project identity folder (name, sessions, .onescience-execution.json).
  // Remote files live on B; this path must not be shown as the file-tree root.
  // On name clash with a local project, allocate a uuid-suffixed folder instead of
  // writing into the existing one. Never changes the remote path on B.
  async function mkdirIdentity(opts?: { uniqueIfExists?: boolean }) {
    const requested = sanitizeProjectFolderPath(store.name)
    if (!requested) {
      throw { error: { _tag: "BadRequest" }, status: 400 } satisfies MkdirFailure
    }
    const siblings = (existing() ?? []).map((entry) => entry.name)
    let relative = opts?.uniqueIfExists ? allocateLocalIdentityName(requested, siblings) ?? requested : requested
    const first = await globalSDK.client.path.mkdir({ name: relative })
    if (first.data?.path) return first.data.path
    const existsLike = first.response?.status === 400 || (first.error as { _tag?: string } | undefined)?._tag === "BadRequest"
    if (opts?.uniqueIfExists && existsLike) {
      const retryName = allocateLocalIdentityName(requested, [...siblings, leafSegment(relative)])
      if (retryName && retryName !== relative) {
        const retry = await globalSDK.client.path.mkdir({ name: retryName })
        if (retry.data?.path) return retry.data.path
        throw { error: retry.error, status: retry.response?.status } satisfies MkdirFailure
      }
    }
    throw { error: first.error, status: first.response?.status } satisfies MkdirFailure
  }

  const createMutation = useMutation(() => ({
    mutationFn: async () => mkdirIdentity(),
    onSuccess: (directory) => {
      setRuntimeEnvironmentFor(directory, env())
      const display = store.name.trim()
      if (display) globalSync.project.meta(directory, { name: display })
      const current = server.current
      if (current) {
        void persistProjectExecutionToControlPlane({
          globalUrl: current.http.url,
          directory,
          env: env(),
          auth: current.http.password
            ? { username: current.http.username, password: current.http.password }
            : undefined,
        })
      }
      props.onCreated(directory)
      dialog.close()
    },
  }))

  const inlineError = createMemo(() => {
    if (createMutation.isError) {
      return resolveMkdirError(createMutation.error, language.t, store.name, nameConflict())
    }
    if (!remoteSelected() && nameConflict()) {
      return language.t("dialog.project.createFolder.error.exists", {
        name: leafSegment(store.name) || store.name.trim(),
      })
    }
  })

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    if (remoteSelected()) {
      void connectRemote()
      return
    }
    if (createMutation.isPending || !canSubmit()) return
    createMutation.mutate()
  }

  function isConflictEntry(name: string) {
    const leaf = leafSegment(store.name)
    if (!leaf) return false
    return name.toLowerCase() === leaf.toLowerCase()
  }

  async function runDetect() {
    const current = server.current
    const target = sshTarget()
    const envNow = env()
    if (envNow.kind !== "ssh" || !target || !current || !canSubmit()) return
    if (busy() === "preflight") return
    const directory = identityDirectory() || dataRoot()
    const progressKey = sshPreflightProgressKey(envNow.targetName, directory)
    setBusy("preflight")
    setBanner({
      title: "检测进度",
      tone: "pending",
      checks: initialPreflightSteps(),
    })
    const stopPoll = pollRemoteProgress(progressKey, "检测进度")
    try {
      const auth = current.http.password
        ? { username: current.http.username, password: current.http.password }
        : undefined
      const result = await preflightSshWorkspace({
        globalUrl: current.http.url,
        directory,
        target,
        accountId: storedPlatformAuthSession()?.account.id,
        remotePath: extraRemotePath(),
        progressKey,
        auth,
      })
      setBanner({
        title: "检测结果",
        tone: result.ok ? "ok" : "fail",
        checks: result.checks.map((item) => ({
          id: item.id,
          message: item.message,
          status: (item.skipped ? "skip" : item.ok ? "ok" : "fail") as "ok" | "fail" | "skip",
          detail: item.detail,
        })),
      })
      if (result.ok && result.remotePath.trim() && !remotePathCustomized()) {
        setRemotePathFromDetect(true)
        setStore("remotePath", result.remotePath.trim())
      }
    } catch (err) {
      setBanner({
        title: "检测失败",
        tone: "fail",
        checks: initialPreflightSteps(),
        error: err instanceof Error ? err.message : "预检失败",
      })
    } finally {
      stopPoll()
      setBusy(undefined)
    }
  }

  async function connectRemote() {
    const target = sshTarget()
    const envNow = env()
    if (envNow.kind !== "ssh" || !target || !canSubmit() || busy()) return
    setBusy("connect")
    setBanner({
      title: "连接进度",
      tone: "pending",
      checks: initialConnectSteps(),
    })
    let workspaceID: string | undefined
    let createdDirectory: string | undefined
    let stopPoll = () => undefined as void
    const abort = new AbortController()
    connectAbort = abort
    try {
      const directory = await mkdirIdentity({ uniqueIfExists: true })
      createdDirectory = directory
      setRuntimeEnvironmentFor(directory, envNow)
      const display = store.name.trim()
      if (display) globalSync.project.meta(directory, { name: display })
      await persistProjectExecutionMarker(
        (input) => globalSDK.createClient({ directory, throwOnError: true }).file.write(input),
        directory,
        envNow,
        extraRemotePath(),
      ).catch(() => undefined)
      const progressKey = sshConnectProgressKey(envNow.targetName, directory)
      connectProgressKey = progressKey
      stopPoll = pollRemoteProgress(progressKey, "连接进度", mergeConnectProgress)
      const created = await Promise.race([
        globalSDK.createClient({ directory, throwOnError: true }).experimental.workspace.create(
          {
            directory,
            type: "ssh-node",
            branch: null,
            extra: {
              sshTarget: envNow.targetName,
              accountId: storedPlatformAuthSession()?.account.id,
              projectSlug: remoteProjectSlug(directory),
              localDirectory: directory,
              ssh: sshTestPayload(target),
              progressKey,
              ...(extraRemotePath() ? { remotePath: extraRemotePath() } : {}),
            },
          },
          { signal: abort.signal },
        ),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(SSH_CONNECT_TIMEOUT_MESSAGE))
            abort.abort()
          }, SSH_CONNECT_TIMEOUT_MS)
        }),
      ])
      workspaceID = created.data?.id
      if (!workspaceID) throw new Error("创建远端 workspace 失败")
      stopPoll()
      setBanner({
        title: "连接进度",
        tone: "pending",
        checks: fileWaitConnectSteps("正在等待文件服务"),
      })
      const probe = globalSDK.createClient({
        directory,
        throwOnError: true,
        experimental_workspaceID: workspaceID,
      })
      await waitForWorkspaceFileList({
        list: () => probe.file.list({ path: "" }),
        abort: abort.signal,
        onDetail: (detail) => {
          setBanner({
            title: "连接进度",
            tone: "pending",
            checks: fileWaitConnectSteps(detail),
          })
        },
      })
      setRemoteWorkspaceFor(directory, {
        workspaceID,
        targetName: envNow.targetName,
        ...(typeof created.data?.directory === "string" && created.data.directory.trim()
          ? { remotePath: created.data.directory.trim() }
          : extraRemotePath()
            ? { remotePath: extraRemotePath() }
            : {}),
      })
      const current = server.current
      if (current) {
        void persistProjectExecutionToControlPlane({
          globalUrl: current.http.url,
          directory,
          env: envNow,
          remotePath:
            (typeof created.data?.directory === "string" && created.data.directory.trim()
              ? created.data.directory.trim()
              : extraRemotePath()) || undefined,
          auth: current.http.password
            ? { username: current.http.username, password: current.http.password }
            : undefined,
        })
      }
      const connectedPath =
        (typeof created.data?.directory === "string" && created.data.directory.trim()
          ? created.data.directory.trim()
          : extraRemotePath()) || undefined
      void persistProjectExecutionMarker(
        (input) =>
          globalSDK
            .createClient({ directory, throwOnError: true, experimental_workspaceID: workspaceID })
            .file.write(input),
        directory,
        envNow,
        connectedPath,
      ).catch(() => undefined)
      showToast({ title: "已连接远端", description: envNow.targetName })
      props.onCreated(directory)
      dialog.close()
    } catch (err) {
      const message = err instanceof Error ? err.message : ""
      const timedOut = /连接远端超时/.test(message)
      const aborted =
        !timedOut &&
        (abort.signal.aborted ||
          (err && typeof err === "object" && ((err as { name?: string }).name === "AbortError" || /aborted|已取消/i.test(String((err as { message?: string }).message)))))
      const directory = createdDirectory || identityDirectory() || dataRoot()
      // A partially-created local identity directory should not survive as a local project
      // when the remote connection never succeeded. Clean it up so the user can retry.
      if (createdDirectory) {
        await globalSDK.client.project
          .remove({ directory: createdDirectory })
          .catch(() => undefined)
        setRuntimeEnvironmentFor(createdDirectory, defaultRuntimeEnvironment())
        setRemoteWorkspaceFor(createdDirectory, undefined)
      }
      const current = server.current
      const key = connectProgressKey
      if (key && current) {
        void abortSshConnect({
          globalUrl: current.http.url,
          key,
          auth: connectAuth(),
        })
      }
      if (workspaceID) {
        await globalSDK
          .createClient({ directory, throwOnError: true })
          .experimental.workspace.remove({ id: workspaceID, directory })
          .catch(() => undefined)
      }
      if (aborted) {
        setBanner({
          title: "连接已取消",
          tone: "fail",
          checks: mergeConnectProgress(initialConnectSteps()),
          error: "已手动取消",
        })
        showToast({ title: "已取消连接", description: "远端进程正在清理" })
        return
      }
      const steps = server.current
        ? await fetchSshConnectProgress({
            globalUrl: server.current.http.url,
            key: sshConnectProgressKey(envNow.targetName, createdDirectory || identityDirectory() || dataRoot()),
            auth: server.current.http.password
              ? { username: server.current.http.username, password: server.current.http.password }
              : undefined,
          }).catch(() => [])
        : []
      setBanner({
        title: "连接失败",
        tone: "fail",
        checks: mergeConnectProgress(steps.length ? steps : initialConnectSteps()),
        error: err instanceof Error ? err.message : "连接远端失败",
      })
      showToast({ title: "连接远端失败", description: err instanceof Error ? err.message.split("\n")[0] : undefined })
    } finally {
      stopPoll()
      if (connectAbort === abort) connectAbort = undefined
      setBusy(undefined)
    }
  }

  return (
    <Dialog title={language.t("command.project.createFolder")} class="os-client-project-create w-full max-w-[480px] mx-auto">
      <form onSubmit={handleSubmit} class="os-client-project-create-form flex flex-col gap-5 p-5 pt-4">
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-2">
            <span class="text-14-medium text-text-strong">{language.t("dialog.project.createFolder.environment")}</span>
            <RuntimeEnvironmentSelect
              directory={dataRoot}
              value={env}
              onChange={setEnv}
              variant="field"
              hideScnet
              disabled={!!busy()}
            />
          </div>
          <TextField
            autofocus
            type="text"
            label={
              remoteSelected()
                ? language.t("dialog.project.createFolder.nameRemote")
                : language.t("dialog.project.createFolder.name")
            }
            placeholder={language.t("dialog.project.createFolder.placeholder")}
            value={store.name}
            disabled={!!busy()}
            onChange={(v) => setStore("name", v)}
          />
          <p class="os-client-project-create-path text-12-regular text-text-weak">
            {remoteSelected()
              ? language.t("dialog.project.createFolder.nameRemoteHint")
              : language.t("dialog.project.createFolder.nameAsFolder")}
          </p>
          <Show when={remoteSelected() && nameConflict()}>
            <p class="os-client-project-create-path text-12-regular text-text-weak">
              {language.t("dialog.project.createFolder.localIdentityUnique")}
            </p>
          </Show>
          <Show when={!remoteSelected()}>
            <p class="os-client-project-create-path text-12-regular text-text-weak">
              {language.t("dialog.project.createFolder.path", { path: preview() })}
            </p>
          </Show>
          <Show when={remoteSelected()}>
            <div class="os-client-project-create-remote-path">
              <TextField
                type="text"
                label={language.t("dialog.project.createFolder.remotePath")}
                placeholder={language.t("dialog.project.createFolder.remotePathPlaceholder")}
                value={store.remotePath}
                disabled={!!busy()}
                onFocus={() => setRemotePathFocused(true)}
                onBlur={() => setRemotePathFocused(false)}
                onKeyDown={(event: KeyboardEvent) => {
                  if (event.key !== "Backspace" && event.key !== "Delete") return
                  const target = event.target
                  const current = event.currentTarget
                  const el =
                    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
                      ? target
                      : current instanceof Element
                        ? current.querySelector("input, textarea")
                        : null
                  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return
                  const allSelected =
                    el.selectionStart === 0 && el.selectionEnd === el.value.length && el.value.length > 0
                  if (!allSelected) return
                  event.preventDefault()
                  setRemotePathCustomized(true)
                  setStore("remotePath", "")
                }}
                onChange={(v) => {
                  if (v === store.remotePath) return
                  setStore("remotePath", v)
                  setRemotePathCustomized(v.trim() !== defaultRemotePreview().trim())
                  if (!store.name.trim()) {
                    const leaf = leafSegment(v)
                    if (leaf) setStore("name", leaf)
                  }
                }}
              />
              <div class="os-client-project-create-remote-path-actions">
                <Show when={remotePathDirty() && !busy()}>
                  <Button type="button" variant="ghost" size="small" onClick={restoreRemotePath}>
                    {language.t("dialog.project.createFolder.remotePathReset")}
                  </Button>
                </Show>
              </div>
            </div>
          </Show>

          <Show when={!remoteSelected()}>
          <div class="os-client-project-create-existing">
            <p class="os-client-project-create-existing-title">{existingTitle()}</p>
            <Show when={existing.loading}>
              <p class="os-client-project-create-existing-empty">{language.t("common.loading")}</p>
            </Show>
            <Show when={!existing.loading && (existing() ?? []).length === 0}>
              <p class="os-client-project-create-existing-empty">{language.t("dialog.project.createFolder.existing.empty")}</p>
            </Show>
            <Show when={!existing.loading && (existing() ?? []).length > 0}>
              <ul class="os-client-project-create-existing-list">
                <For each={existing() ?? []}>
                  {(entry) => (
                    <li
                      class="os-client-project-create-existing-item"
                      classList={{ "is-conflict": isConflictEntry(entry.name) }}
                    >
                      <Icon name="folder" size="small" class="os-client-project-create-existing-icon" />
                      <span>{entry.name}</span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
          </Show>

          <Show when={banner()}>
            {(current) => (
              <div class="os-session-preflight" data-ok={current().tone === "ok" ? "true" : current().tone === "fail" ? "false" : "pending"}>
                <p class="os-session-preflight-head">{current().title}</p>
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

          <Show when={inlineError()}>
            {(message) => <p class="text-12-regular text-text-critical-base">{message()}</p>}
          </Show>
        </div>

        <div class="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="large"
            onClick={() => {
              if (busy() === "connect") cancelConnecting()
              dialog.close()
            }}
          >
            {language.t("common.cancel")}
          </Button>
          <Show when={remoteSelected()}>
            <div class="flex gap-2">
              <Button type="button" variant="ghost" size="large" disabled={!!busy() || !canSubmit()} onClick={() => void runDetect()}>
                {busy() === "preflight" ? "检测中..." : "检测"}
              </Button>
              <Button type="submit" variant="primary" size="large" disabled={!!busy() || !canSubmit()}>
                {busy() === "connect" ? "连接中..." : "连接远端"}
              </Button>
            </div>
          </Show>
          <Show when={!remoteSelected()}>
            <Button
              type="submit"
              variant="primary"
              size="large"
              disabled={createMutation.isPending || !canSubmit()}
            >
              {createMutation.isPending ? language.t("common.confirming") : language.t("common.confirm")}
            </Button>
          </Show>
        </div>
      </form>
    </Dialog>
  )
}

function parentPathForName(name: string) {
  const relative = sanitizeProjectFolderPath(name)
  if (!relative?.includes("/")) return ""
  return relative.split("/").slice(0, -1).join("/")
}

function leafSegment(name: string) {
  const relative = sanitizeProjectFolderPath(name)
  if (!relative) return ""
  return relative.split("/").at(-1) ?? ""
}

function hasNameConflict(name: string, existing: Array<{ name: string }> | undefined) {
  const leaf = leafSegment(name)
  if (!leaf || !existing?.length) return false
  const key = leaf.toLowerCase()
  return existing.some((entry) => entry.name.toLowerCase() === key)
}

function resolveMkdirError(
  error: unknown,
  t: (key: string, params?: Record<string, string | number>) => string,
  name: string,
  conflict: boolean,
) {
  const failure = error as MkdirFailure
  const status = failure?.status
  const payload = failure?.error ?? error

  if (conflict) {
    return t("dialog.project.createFolder.error.exists", { name: leafSegment(name) || name.trim() })
  }
  if (status === 403) return t("dialog.project.createFolder.error.permission")
  if (status && status >= 500) return t("dialog.project.createFolder.error.server", { status })

  if (payload && typeof payload === "object" && (payload as { _tag?: string })._tag === "BadRequest") {
    if (!sanitizeProjectFolderPath(name)) return t("dialog.project.createFolder.error.invalid")
    return t("dialog.project.createFolder.error.exists", { name: leafSegment(name) || name.trim() })
  }

  // Do not surface raw HTTP status lines such as "POST .../path/mkdir -> 400 Bad Request"
  // to the UI; map them to the same friendly messages we use for typed validation.
  const message = errorMessage(payload, "")
  if (message && message !== "missing path" && !/Bad Request|HTTP|POST|http:/i.test(message)) return message
  if (status === 400) {
    if (!sanitizeProjectFolderPath(name)) return t("dialog.project.createFolder.error.invalid")
    return t("dialog.project.createFolder.error.exists", { name: leafSegment(name) || name.trim() })
  }
  return t("dialog.project.createFolder.error.network")
}
