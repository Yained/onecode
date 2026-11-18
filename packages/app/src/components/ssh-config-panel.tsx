import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { List } from "@opencode-ai/ui/list"
import { Select } from "@opencode-ai/ui/select"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { useMutation, useQueryClient } from "@tanstack/solid-query"
import { createMemo, createSignal, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import {
  buildSshMapFromOpenSshDisk,
  fetchManagedOpenSshDisk,
  hydrateSshFromOpenSshTargets,
  rememberConfirmedTenantMapWrite,
} from "@/context/global-sync/bootstrap"
import { authTokenFromCredentials } from "@/utils/server"
import { storedPlatformAuthSession, storedPlatformAuthToken } from "@/utils/platform-auth"
import {
  sshConnectivityLabel,
} from "@/components/onescience/execution-location"
import { localizeSshConnectivityMessage } from "@/components/onescience/ssh-connectivity"
import {
  managedSshMapGeneration,
  rememberManagedSshMap,
  useRegisteredSshConnectivity,
} from "@/components/onescience/use-registered-ssh-connectivity"
import {
  buildSshConfigEntry,
  emptySshConfigForm,
  parseOpenSshConfig,
  resolveImportedKeyIssue,
  resolveSshConfigForEdit,
  firstInvalidSshFormField,
  validateSshConfigForm,
  type ImportedKeyIssue,
  type SshConfigForm,
  type SshFormFocusField,
  visibleSshAuthType,
} from "@/components/dialog-select-ssh-form"
import { applySshKnownHostsIgnore, isMostlyKnownHostsNoise, isPublicKeyAuthFailure } from "@/components/onescience/ssh-known-hosts"
import { runtimeEnvironmentRevision } from "@/components/onescience/runtime-environment"
import {
  cascadeClientSshTarget,
  formatSshTargetProjectNames,
  listSshTargetProjects,
  sshConfigIdentity,
  sshDisableRequested,
  sshFormIdentity,
  sshIdentityChanged,
  sshTargetUsageRevision,
} from "@/components/onescience/ssh-target-usage"
import type { Config } from "@opencode-ai/sdk/v2/client"

type SshConfirm =
  | { kind: "blocked"; title: string; body: string }
  | { kind: "delete"; name: string; body: string }
  | { kind: "save"; body: string }

const authOptions = ["key", "password"] as const

type SshTestResult = {
  success: boolean
  message: string
  stdout?: string
  stderr?: string
}

type KeyIssue = ImportedKeyIssue

export function SshConfigPanel(
  props: { variant?: "dialog" | "page"; initialMode?: "add"; onClose?: () => void } = {},
) {
  const variant = () => props.variant ?? "dialog"
  const dialog = useDialog()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const queryClient = useQueryClient()
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServer()
  const [store, setStore] = createStore({
    form: emptySshConfigForm(),
    importText: "",
    editing: (props.initialMode === "add" ? "__new__" : undefined) as string | undefined,
    error: "",
    keyMissing: false,
    keyIssue: undefined as KeyIssue | undefined,
    pickIdentityOpen: false,
    testResult: undefined as SshTestResult | undefined,
  })
  const [confirm, setConfirm] = createSignal<SshConfirm>()

  // Same source as Integration popover: OpenSSH disk list, not a possibly incomplete config.ssh pin.
  const [sshFromDisk, setSshFromDisk] = createSignal<Config["ssh"] | undefined>()
  const fieldEls: Partial<Record<SshFormFocusField, HTMLElement | undefined>> = {}
  let identityFileInput: HTMLInputElement | undefined

  function bindField(field: SshFormFocusField) {
    return (el: HTMLDivElement | undefined) => {
      fieldEls[field] = el
    }
  }

  function focusInvalidField() {
    const field = firstInvalidSshFormField(store.form)
    if (!field) return
    queueMicrotask(() => {
      const el = fieldEls[field]
      el?.scrollIntoView({ block: "center", behavior: "smooth" })
      el?.querySelector<HTMLElement>("[data-slot=input-input], input, textarea")?.focus()
    })
  }

  onMount(() => {
    const generation = managedSshMapGeneration()
    void (async () => {
      const disk = await fetchManagedOpenSshDisk(globalSDK.url)
      // Save/delete may have landed a newer map while this open-dialog fetch was in flight.
      if (generation !== managedSshMapGeneration()) return
      if (disk !== undefined) {
        setSshFromDisk(disk)
        rememberManagedSshMap(disk)
      }
      await hydrateSshFromOpenSshTargets({
        serverUrl: globalSDK.url,
        queryClient,
        disk,
      }).catch(() => undefined)
    })()
  })

  const items = createMemo(() => {
    const map = sshFromDisk() ?? globalSync.data.config.ssh ?? {}
    return Object.entries(map)
      .map(([name, config]) => ({ name, config }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  const isFormMode = createMemo(() => !!store.editing)
  const invalidField = createMemo(() => (store.error ? firstInvalidSshFormField(store.form) : undefined))
  const sshMap = createMemo(() => sshFromDisk() ?? globalSync.data.config.ssh)
  const sshConnectivity = useRegisteredSshConnectivity({ ssh: sshMap })
  const connectivityByName = createMemo(() => sshConnectivity.byName())
  const connectivityLoading = () => sshConnectivity.loading()
  const editingUsage = createMemo(() => {
    sshTargetUsageRevision()
    runtimeEnvironmentRevision()
    if (!store.editing || store.editing === "__new__") return []
    return usageFor(store.editing)
  })
  const identityLocked = createMemo(() => editingUsage().some((item) => item.connected))
  const identityLockedLabel = createMemo(() => formatSshTargetProjectNames(editingUsage().filter((item) => item.connected)))

  const closeDialog = () => {
    if (props.onClose) {
      props.onClose()
      return
    }
    dialog.close()
  }

  const formTitle = createMemo(() => {
    if (!isFormMode()) return language.t("dialog.ssh.title")
    return store.editing === "__new__" ? language.t("dialog.ssh.addTitle") : language.t("dialog.ssh.editTitle")
  })

  const save = useMutation(() => ({
    mutationFn: async () => {
      const entry = buildSshConfigEntry(store.form)
      const invalid = validateSshConfigForm(store.form)
      if (invalid) {
        setStore("error", language.t(`dialog.ssh.${invalid}`))
        focusInvalidField()
        return
      }
      const before = buildSshMapFromOpenSshDisk(sshFromDisk() ?? {}, {
        ssh: globalSync.data.config.ssh,
      } as Config)
      const next = { ...before }
      const previousName = store.editing && store.editing !== "__new__" ? store.editing : undefined
      const renameDirectories = previousName && previousName !== entry.name
        ? usageFor(previousName).map((item) => item.directory)
        : []
      if (previousName && previousName !== entry.name) delete next[previousName]
      next[entry.name] = entry.value
      const accountId = storedPlatformAuthSession()?.account.id
      // Pin before network I/O so dispose-driven bootstrap cannot wipe the list mid-save.
      rememberConfirmedTenantMapWrite({ accountId, ssh: next })
      try {
        // /global/ssh/config dual-writes product config; updateConfig keeps the query cache in sync.
        await postGlobalJson<{ path: string }>("/global/ssh/config", {
          name: entry.name,
          previousName,
          config: entry.value,
        })
        await globalSync.updateConfig({ ssh: next })
      } catch (error) {
        // Roll back the optimistic pin so failed saves cannot ghost into Integration UI.
        rememberConfirmedTenantMapWrite({ accountId, ssh: before })
        throw error
      }
      if (previousName && previousName !== entry.name) {
        cascadeClientSshTarget(previousName, entry.name, renameDirectories)
      }
      setSshFromDisk(next)
      rememberManagedSshMap(next)
      resetForm()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("dialog.ssh.toast.saved"),
      })
    },
    onError: (err) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))

  const remove = useMutation(() => ({
    mutationFn: async (name: string) => {
      const before = buildSshMapFromOpenSshDisk(sshFromDisk() ?? {}, {
        ssh: globalSync.data.config.ssh,
      } as Config)
      const next = { ...before }
      delete next[name]
      const accountId = storedPlatformAuthSession()?.account.id
      rememberConfirmedTenantMapWrite({ accountId, ssh: next })
      try {
        await postGlobalJson<{ path: string }>("/global/ssh/config/remove", { name })
        await globalSync.updateConfig({ ssh: next })
        setSshFromDisk(next)
        rememberManagedSshMap(next)
      } catch (error) {
        rememberConfirmedTenantMapWrite({ accountId, ssh: before })
        throw error
      }
    },
    onSuccess: () => {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("dialog.ssh.toast.removed"),
      })
    },
    onError: (err) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))

  const fixKnownHosts = useMutation(() => ({
    mutationFn: async (name: string) => {
      const current = globalSync.data.config.ssh?.[name]
      if (!current || typeof current !== "object" || !("host" in current) || !("remotePath" in current)) {
        throw new Error(language.t("dialog.ssh.fixKnownHosts.missing"))
      }
      const before = buildSshMapFromOpenSshDisk(sshFromDisk() ?? {}, {
        ssh: globalSync.data.config.ssh,
      } as Config)
      const nextEntry = {
        ...current,
        options: applySshKnownHostsIgnore(
          (current as { options?: Record<string, string> }).options,
        ),
      }
      const next = { ...before, [name]: nextEntry }
      const accountId = storedPlatformAuthSession()?.account.id
      rememberConfirmedTenantMapWrite({ accountId, ssh: next })
      try {
        await postGlobalJson<{ path: string }>("/global/ssh/config", {
          name,
          config: nextEntry,
        })
        await globalSync.updateConfig({ ssh: next })
        await sshConnectivity.probeOne(name)
      } catch (error) {
        rememberConfirmedTenantMapWrite({ accountId, ssh: before })
        throw error
      }
    },
    onSuccess: () => {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("dialog.ssh.fixKnownHosts.done"),
      })
    },
    onError: (err) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))

  const fixPublicKey = useMutation(() => ({
    mutationFn: async (name: string) => {
      const current = globalSync.data.config.ssh?.[name]
      if (!current || typeof current !== "object" || !("host" in current) || !("remotePath" in current)) {
        throw new Error(language.t("dialog.ssh.fixPublicKey.missing"))
      }
      const keyPath =
        current.auth?.type === "key" && current.auth.keyPath?.trim() ? current.auth.keyPath.trim() : ""
      if (!keyPath) {
        startEdit(name)
        throw new Error(language.t("dialog.ssh.fixPublicKey.needKey"))
      }
      const check = await postGlobalJson<{ exists: boolean; keyPath: string }>("/global/ssh/identity/check", {
        keyPath,
      })
      if (!check.exists) {
        startEdit(name)
        throw new Error(language.t("dialog.ssh.fixPublicKey.missingFile", { path: keyPath }))
      }
      const before = { ...(globalSync.data.config.ssh ?? {}) }
      const nextEntry = {
        ...current,
        auth: { type: "key" as const, keyPath },
        options: {
          ...applySshKnownHostsIgnore((current as { options?: Record<string, string> }).options),
          IdentitiesOnly: "yes",
          PasswordAuthentication: "no",
        },
      }
      const next = { ...before, [name]: nextEntry }
      const accountId = storedPlatformAuthSession()?.account.id
      rememberConfirmedTenantMapWrite({ accountId, ssh: next })
      try {
        await postGlobalJson<{ path: string }>("/global/ssh/config", {
          name,
          config: nextEntry,
        })
        await globalSync.updateConfig({ ssh: next })
        // ssh/test re-chmods the identity file before connecting.
        const result = await postGlobalJson<SshTestResult>("/global/ssh/test", { config: nextEntry })
        await sshConnectivity.probeOne(name)
        if (!result.success) {
          startEdit(name)
          throw new Error(
            language.t("dialog.ssh.fixPublicKey.stillDenied", {
              path: keyPath,
              detail: result.message,
            }),
          )
        }
        return result
      } catch (error) {
        rememberConfirmedTenantMapWrite({ accountId, ssh: before })
        throw error
      }
    },
    onSuccess: () => {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("dialog.ssh.fixPublicKey.done"),
      })
    },
    onError: (err) => {
      showToast({
        variant: "error",
        title: language.t("dialog.ssh.fixPublicKey.failed"),
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))

  const test = useMutation(() => ({
    mutationFn: async () => {
      const invalid = validateSshConfigForm(store.form)
      if (invalid) {
        setStore("error", language.t(`dialog.ssh.${invalid}`))
        setStore("testResult", undefined)
        focusInvalidField()
        throw new Error(language.t(`dialog.ssh.${invalid}`))
      }
      const entry = buildSshConfigEntry(store.form)
      const result = await postGlobalJson<SshTestResult>("/global/ssh/test", {
        config: entry.value,
      })
      setStore("testResult", result)
      if (!result.success) {
        showToast({
          variant: "error",
          title: language.t("dialog.ssh.test.failed"),
          description: redactDisplayedSshText(result.message, [store.form.hostName]),
        })
        return
      }
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("dialog.ssh.test.passed"),
          description: redactDisplayedSshText(
          result.message || language.t("dialog.ssh.test.description"),
          [store.form.hostName],
        ),
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      setStore("testResult", {
        success: false,
        message,
      })
      showToast({
        variant: "error",
        title: language.t("dialog.ssh.test.failed"),
        description: redactDisplayedSshText(message, [store.form.hostName]),
      })
    },
  }))

  const uploadIdentity = useMutation(() => ({
    mutationFn: async (file: File) =>
      postGlobalJson<{ keyPath: string }>("/global/ssh/identity", {
        name: file.name,
        content: await file.text(),
      }),
    onSuccess: (result) => {
      setForm({ authType: "key", keyPath: result.keyPath })
      setStore("keyMissing", false)
      setStore("keyIssue", undefined)
      setStore("pickIdentityOpen", false)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("dialog.ssh.identity.uploaded"),
        description: result.keyPath,
      })
    },
    onError: (err) => {
      showToast({
        variant: "error",
        title: language.t("dialog.ssh.identity.uploadFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))

  function usageFor(name: string) {
    return listSshTargetProjects({
      sshName: name,
      projects: globalSync.data.project,
    })
  }

  function blockConfirm(title: string, body: string) {
    setConfirm({ kind: "blocked", title, body })
  }

  function attemptSave() {
    const invalid = validateSshConfigForm(store.form)
    if (invalid) {
      setStore("error", language.t(`dialog.ssh.${invalid}`))
      focusInvalidField()
      return
    }
    if (store.editing && store.editing !== "__new__") {
      const usage = usageFor(store.editing)
      const connected = usage.filter((item) => item.connected)
      const previous = sshConfigIdentity(
        resolveSshConfigForEdit(store.editing, items().find((item) => item.name === store.editing)?.config, sshFromDisk(), globalSync.data.config.ssh),
      )
      const next = sshFormIdentity(store.form)
      const renamed = store.form.name.trim() !== store.editing
      const identity = sshIdentityChanged(previous, next)
      const disabling = sshDisableRequested(previous, next)
      if (connected.length && (renamed || identity || disabling)) {
        const projects = formatSshTargetProjectNames(connected)
        const body = renamed
          ? language.t("dialog.ssh.usage.blocked.rename", { name: store.editing, projects })
          : disabling
            ? language.t("dialog.ssh.usage.blocked.disable", { name: store.editing, projects })
            : language.t("dialog.ssh.usage.blocked.identity", { name: store.editing, projects })
        blockConfirm(language.t("dialog.ssh.usage.blocked.title"), body)
        return
      }
      if (usage.length && (renamed || identity || disabling)) {
        const projects = formatSshTargetProjectNames(usage)
        const parts = [
          renamed ? language.t("dialog.ssh.usage.confirm.rename", { from: store.editing, to: store.form.name.trim(), projects }) : "",
          identity ? language.t("dialog.ssh.usage.confirm.identity", { projects }) : "",
          disabling ? language.t("dialog.ssh.usage.confirm.disable", { projects }) : "",
        ].filter(Boolean)
        setConfirm({ kind: "save", body: parts.join("\n\n") })
        return
      }
    }
    save.mutate()
  }

  function requestRemove(name: string) {
    const usage = usageFor(name)
    if (usage.length) {
      const projects = formatSshTargetProjectNames(usage)
      const body = language.t("dialog.ssh.usage.blocked.delete.bound", { name, projects })
      blockConfirm(language.t("dialog.ssh.usage.blocked.delete.title"), body)
      showToast({
        variant: "error",
        icon: "warning",
        title: language.t("dialog.ssh.usage.blocked.delete.title"),
        description: body,
      })
      return
    }
    setConfirm({
      kind: "delete",
      name,
      body: language.t("dialog.ssh.usage.confirm.delete.empty", { name }),
    })
  }

  function confirmAction() {
    const current = confirm()
    setConfirm(undefined)
    if (!current) return
    if (current.kind === "delete") remove.mutate(current.name)
    if (current.kind === "save") save.mutate()
  }

  function resetForm() {
    setStore({
      form: emptySshConfigForm(),
      importText: "",
      editing: undefined,
      error: "",
      keyMissing: false,
      keyIssue: undefined,
      pickIdentityOpen: false,
      testResult: undefined,
    })
  }

  function startAdd() {
    setStore({
      form: emptySshConfigForm(),
      importText: "",
      editing: "__new__",
      error: "",
      keyMissing: false,
      keyIssue: undefined,
      pickIdentityOpen: false,
      testResult: undefined,
    })
  }

  function startEdit(name: string, listed?: unknown) {
    const config = resolveSshConfigForEdit(name, listed, sshFromDisk(), globalSync.data.config.ssh)
    if (!config) {
      showToast({
        variant: "error",
        title: language.t("dialog.ssh.error.missingConfig"),
      })
      return
    }
    setStore({
      editing: name,
      error: "",
      importText: "",
      keyMissing: false,
      keyIssue: undefined,
      pickIdentityOpen: false,
      testResult: undefined,
      form: {
        name,
        hostName: config.hostName ?? config.host ?? "",
        username: config.username ?? "",
        remotePath: config.remotePath ?? "",
        port: config.port ? String(config.port) : "",
        keyPath: config.auth?.type === "key" ? (config.auth.keyPath ?? "") : "",
        password: config.auth?.type === "password" ? (config.auth.password ?? "") : "",
        authType: visibleSshAuthType(config.auth?.type),
        options: Object.entries(config.options ?? {})
          .map(([key, value]) => `${key}=${value}`)
          .join("\n"),
      },
    })
  }

  function setForm(patch: Partial<SshConfigForm>) {
    setStore("form", patch)
    setStore("error", "")
    setStore("testResult", undefined)
    if ("keyPath" in patch || ("authType" in patch && patch.authType !== "key")) {
      setStore("keyMissing", false)
      setStore("keyIssue", undefined)
      setStore("pickIdentityOpen", false)
    }
  }

  function applyKeyIssue(issue: KeyIssue) {
    setStore("keyMissing", true)
    setStore("keyIssue", issue)
  }

  function promptPickIdentity(issue: KeyIssue) {
    applyKeyIssue(issue)
    setStore("pickIdentityOpen", true)
  }

  function openIdentityFilePicker() {
    identityFileInput?.click()
  }

  function markKeyIssue(issue: KeyIssue, opts?: { toastVariant?: "default" | "error" }) {
    applyKeyIssue(issue)
    const title =
      issue === "needsUpload"
        ? language.t("dialog.ssh.identity.needsUploadTitle")
        : issue === "notFound"
          ? language.t("dialog.ssh.identity.notFoundTitle")
          : language.t("dialog.ssh.identity.missingTitle")
    const description =
      issue === "needsUpload"
        ? language.t("dialog.ssh.identity.needsUploadDescription")
        : issue === "notFound"
          ? language.t("dialog.ssh.identity.notFoundDescription")
          : issue === "empty"
            ? language.t("dialog.ssh.identity.missingEmpty")
            : issue === "unverified"
              ? language.t("dialog.ssh.identity.missingUnverified")
              : issue === "localPathOnServer"
                ? language.t("dialog.ssh.identity.missingLocalPath")
                : language.t("dialog.ssh.identity.missingDescription")
    showToast({
      variant: opts?.toastVariant ?? (issue === "needsUpload" ? "default" : "error"),
      icon: "warning",
      title,
      description,
    })
  }

  async function verifyImportedKey(keyPath: string) {
    const trimmed = keyPath.trim()
    const desktop = platform.platform === "desktop"

    const early = resolveImportedKeyIssue({ keyPath: trimmed, desktop })
    if (early === "empty") {
      markKeyIssue(early)
      return
    }
    if (early === "localPathOnServer") {
      promptPickIdentity(early)
      return
    }

    try {
      const result = await postGlobalJson<{ exists: boolean; keyPath: string }>("/global/ssh/identity/check", {
        keyPath: trimmed,
      })
      const issue = resolveImportedKeyIssue({ keyPath: trimmed, desktop, exists: result.exists })
      if (!issue) {
        setStore("keyMissing", false)
        setStore("keyIssue", undefined)
        setStore("pickIdentityOpen", false)
        return
      }
      promptPickIdentity(issue)
    } catch {
      promptPickIdentity(resolveImportedKeyIssue({ keyPath: trimmed, desktop, checkFailed: true }) ?? "unverified")
    }
  }

  async function ingestImportedKey(keyPath: string) {
    const trimmed = keyPath.trim()
    try {
      const result = await postGlobalJson<{
        exists: boolean
        ingested: boolean
        keyPath: string
        reason?: "empty" | "windows" | "notFound" | "invalid"
      }>("/global/ssh/identity/ingest", { keyPath: trimmed })
      if (result.exists && result.keyPath) {
        setForm({ authType: "key", keyPath: result.keyPath })
        setStore("keyMissing", false)
        setStore("keyIssue", undefined)
        setStore("pickIdentityOpen", false)
        if (result.ingested) {
          showToast({
            variant: "success",
            icon: "circle-check",
            title: language.t("dialog.ssh.identity.ingested"),
          })
        }
        return
      }
      if (result.reason === "windows") {
        promptPickIdentity("localPathOnServer")
        return
      }
      if (result.reason === "empty") {
        markKeyIssue("empty")
        return
      }
      if (result.reason === "notFound" || result.reason === "invalid") {
        promptPickIdentity("serverMissing")
        return
      }
    } catch {
      // Fall through to the existence check / upload prompt.
    }
    await verifyImportedKey(trimmed)
  }

  function importOpenSshConfig() {
    const parsed = Object.fromEntries(
      Object.entries(parseOpenSshConfig(store.importText)).filter((entry) => entry[1] !== undefined),
    ) as Partial<SshConfigForm>
    const patch: Partial<SshConfigForm> = { ...parsed, authType: "key" }
    setForm(patch)
    setStore("importText", "")
    const keyPath = (patch.keyPath ?? "").trim()
    if (!keyPath) {
      setStore("keyMissing", false)
      setStore("keyIssue", undefined)
      setStore("pickIdentityOpen", false)
    } else {
      // Always try a silent server ingest first (including Windows IdentityFile paths).
      // If the key is not on the OneCode host, prompt the user to pick and upload it.
      void ingestImportedKey(keyPath)
    }
    if (firstInvalidSshFormField(store.form)) {
      focusInvalidField()
    }
  }

  const testDisabled = createMemo(() => save.isPending || test.isPending)

  function testConfig() {
    if (testDisabled()) return
    test.mutate()
  }

  async function postGlobalJson<T>(path: string, body: unknown) {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    const current = server.current
    if (current?.http.password) {
      headers.Authorization = `Basic ${authTokenFromCredentials({
        username: current.http.username,
        password: current.http.password,
      })}`
    }
    const platformToken = storedPlatformAuthToken()
    if (platformToken) headers["x-platform-auth-token"] = platformToken
    const response = await fetch(`${globalSDK.url}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
    const text = await response.text()
    const contentType = response.headers.get("content-type") ?? ""
    if (contentType.includes("text/html") || /^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text)) {
      throw new Error(language.t("dialog.ssh.test.serverMissing"))
    }
    const data = contentType.includes("application/json") && text ? (JSON.parse(text) as unknown) : undefined
    if (response.ok) return data as T
    const message = jsonErrorMessage(data)
    if (message) throw new Error(message)
    throw new Error(stripHtml(text).trim() || response.statusText)
  }

  function jsonErrorMessage(data: unknown) {
    if (!data || typeof data !== "object") return
    const record = data as Record<string, unknown>
    if (typeof record.message === "string" && record.message.trim()) return record.message
    const inner = record.data
    if (inner && typeof inner === "object") {
      const message = (inner as { message?: unknown }).message
      if (typeof message === "string" && message.trim()) return message
    }
  }

  function stripHtml(value: string) {
    return value.replace(/<[^>]*>/g, " ")
  }

  function redactDisplayedSshText(text: string, secrets: Array<string | undefined>) {
    const tokens = secrets
      .map((value) => value?.trim())
      .filter((value): value is string => !!value)
      .sort((a, b) => b.length - a.length)
    let out = text
    for (const token of tokens) out = out.split(token).join("[redacted]")
    return out.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[redacted]")
  }

  function sshTestDetails(result: SshTestResult) {
    const raw = [
      `${language.t("dialog.ssh.test.detail.message")}: ${localizeSshConnectivityMessage(result.message)}`,
      result.stderr ? `${language.t("dialog.ssh.test.detail.stderr")}:\n${result.stderr}` : undefined,
      result.stdout ? `${language.t("dialog.ssh.test.detail.stdout")}:\n${result.stdout}` : undefined,
    ]
      .filter((line) => line !== undefined)
      .join("\n\n")
    return redactDisplayedSshText(raw, [store.form.hostName])
  }

  const panel = (
    <Show
        when={isFormMode()}
        fallback={
          <div class="os-wb-ssh-list-shell">
            <List
              search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
              emptyMessage={language.t("dialog.ssh.empty")}
              items={items}
              key={(x) => x.name}
              filterKeys={["name"]}
              class="os-wb-ssh-list flex-1 min-h-0"
            >
              {(i) => {
                const connectivity = () => connectivityByName()[i.name]
                const rowProbing = () => sshConnectivity.probing(i.name) || connectivity()?.connectivity === "testing"
                const rowDisabled = () => "enabled" in i.config && i.config.enabled === false
                return (
                <div class="os-wb-ssh-row">
                  <div
                    class="flex items-center gap-2 min-w-0 flex-1 cursor-pointer"
                    role="button"
                    tabIndex={0}
                    onClick={() => startEdit(i.name, i.config)}
                    onKeyDown={(event: KeyboardEvent) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        startEdit(i.name, i.config)
                      }
                    }}
                  >
                    <span
                      class="os-ssh-connectivity-dot shrink-0"
                      data-state={
                        rowProbing()
                          ? "testing"
                          : connectivityLoading() && !connectivity()
                            ? "testing"
                            : (connectivity()?.connectivity ?? "idle")
                      }
                      aria-hidden="true"
                    />
                    <div class="flex flex-col min-w-0">
                      <div class="flex items-center gap-2 min-w-0">
                        <span class="os-wb-ssh-row-title">{i.name}</span>
                        <span class="os-wb-ssh-row-badge">
                          {"host" in i.config && i.config.enabled === false
                            ? language.t("dialog.ssh.status.disabled")
                            : language.t("dialog.ssh.status.enabled")}
                        </span>
                        <Show when={connectivity()}>
                          {(target) => (
                            <span class="os-wb-ssh-row-meta">
                              · {sshConnectivityLabel(target().connectivity)}
                            </span>
                          )}
                        </Show>
                        <Show when={connectivityLoading() && !connectivity()}>
                          <span class="os-wb-ssh-row-meta">· 检测中...</span>
                        </Show>
                      </div>
                      <Show when={"host" in i.config ? i.config.remotePath : undefined}>
                        {(remotePath) => (
                          <span class="os-wb-ssh-row-path">{remotePath()}</span>
                        )}
                      </Show>
                      <Show when={connectivity()?.connectivityMessage && connectivity()?.connectivity !== "connected"}>
                        <pre class="os-wb-ssh-row-error">
                          {redactDisplayedSshText(connectivity()?.connectivityMessage ?? "", [
                            "host" in i.config ? i.config.host : undefined,
                            "hostName" in i.config ? i.config.hostName : undefined,
                          ])}
                        </pre>
                      </Show>
                      <Show
                        when={
                          connectivity()?.connectivity === "failed" &&
                          isMostlyKnownHostsNoise(connectivity()?.connectivityMessage)
                        }
                      >
                        <Button
                          variant="secondary"
                          size="small"
                          class="self-start mt-1 h-7 px-2"
                          disabled={fixKnownHosts.isPending || connectivityLoading()}
                          onClick={(event: MouseEvent) => {
                            event.stopPropagation()
                            fixKnownHosts.mutate(i.name)
                          }}
                        >
                          {fixKnownHosts.isPending && fixKnownHosts.variables === i.name
                            ? language.t("dialog.ssh.fixKnownHosts.running")
                            : language.t("dialog.ssh.fixKnownHosts.action")}
                        </Button>
                      </Show>
                      <Show
                        when={
                          connectivity()?.connectivity === "failed" &&
                          isPublicKeyAuthFailure(connectivity()?.connectivityMessage)
                        }
                      >
                        <Button
                          variant="secondary"
                          size="small"
                          class="self-start mt-1 h-7 px-2"
                          disabled={fixPublicKey.isPending || connectivityLoading()}
                          onClick={(event: MouseEvent) => {
                            event.stopPropagation()
                            fixPublicKey.mutate(i.name)
                          }}
                        >
                          {fixPublicKey.isPending && fixPublicKey.variables === i.name
                            ? language.t("dialog.ssh.fixPublicKey.running")
                            : language.t("dialog.ssh.fixPublicKey.action")}
                        </Button>
                      </Show>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="small"
                    class="shrink-0 h-7 px-2"
                    disabled={connectivityLoading() || rowProbing() || rowDisabled()}
                    onClick={(event: MouseEvent) => {
                      event.stopPropagation()
                      void sshConnectivity.probeOne(i.name)
                    }}
                    onPointerDown={(event: PointerEvent) => event.stopPropagation()}
                  >
                    {rowProbing()
                      ? language.t("dialog.ssh.connectivity.itemRunning")
                      : language.t("dialog.ssh.connectivity.itemAction")}
                  </Button>
                  <DropdownMenu modal={false}>
                    <DropdownMenu.Trigger
                      as={IconButton}
                      icon="dot-grid"
                      variant="ghost"
                      class="shrink-0 size-8"
                      onClick={(e: MouseEvent) => e.stopPropagation()}
                      onPointerDown={(e: PointerEvent) => e.stopPropagation()}
                    />
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content class="mt-1">
                        <DropdownMenu.Item
                          onSelect={() => startEdit(i.name, i.config)}
                          onPointerDown={(event: PointerEvent) => {
                            event.stopPropagation()
                            startEdit(i.name, i.config)
                          }}
                        >
                          <DropdownMenu.ItemLabel>{language.t("common.edit")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          onSelect={() => void sshConnectivity.probeOne(i.name)}
                          disabled={connectivityLoading() || rowProbing() || rowDisabled()}
                        >
                          <DropdownMenu.ItemLabel>
                            {language.t("dialog.ssh.connectivity.action")}
                          </DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <Show
                          when={
                            connectivity()?.connectivity === "failed" &&
                            isMostlyKnownHostsNoise(connectivity()?.connectivityMessage)
                          }
                        >
                          <DropdownMenu.Item
                            onSelect={() => fixKnownHosts.mutate(i.name)}
                            disabled={fixKnownHosts.isPending}
                          >
                            <DropdownMenu.ItemLabel>
                              {language.t("dialog.ssh.fixKnownHosts.action")}
                            </DropdownMenu.ItemLabel>
                          </DropdownMenu.Item>
                        </Show>
                        <Show
                          when={
                            connectivity()?.connectivity === "failed" &&
                            isPublicKeyAuthFailure(connectivity()?.connectivityMessage)
                          }
                        >
                          <DropdownMenu.Item
                            onSelect={() => fixPublicKey.mutate(i.name)}
                            disabled={fixPublicKey.isPending}
                          >
                            <DropdownMenu.ItemLabel>
                              {language.t("dialog.ssh.fixPublicKey.action")}
                            </DropdownMenu.ItemLabel>
                          </DropdownMenu.Item>
                        </Show>
                        <DropdownMenu.Separator />
                        <DropdownMenu.Item
                          onSelect={() => requestRemove(i.name)}
                          class="text-text-on-critical-base hover:bg-surface-critical-weak"
                        >
                          <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu>
                </div>
                )
              }}
            </List>
            <div class="os-wb-ssh-toolbar">
              <button
                type="button"
                class="os-wb-ssh-action"
                disabled={connectivityLoading() || items().length === 0}
                onClick={() => void sshConnectivity.probe()}
              >
                {connectivityLoading()
                  ? (sshConnectivity.progressLabel() || language.t("dialog.ssh.connectivity.running"))
                  : language.t("dialog.ssh.connectivity.action")}
              </button>
              <button type="button" class="os-wb-ssh-action os-wb-ssh-action-primary" onClick={startAdd}>
                {language.t("dialog.ssh.addButton")}
              </button>
            </div>
          </div>
        }
      >
        <div class="os-wb-ssh-form-shell relative">
          <button type="button" class="os-wb-ssh-form-back" onClick={resetForm}>
            ← 返回列表
          </button>
          <div class="min-h-0 flex-1 overflow-y-auto pr-1">
            <div class="os-wb-ssh-form-card">
              <Show when={identityLocked()}>
                <p class="text-12-regular text-text-weak leading-snug">
                  {language.t("dialog.ssh.usage.connectedBanner", { projects: identityLockedLabel() })}
                </p>
              </Show>
              <div class="os-wb-ssh-form-import">
                <TextField
                  multiline
                  label={language.t("dialog.ssh.import")}
                  description={language.t("dialog.ssh.importDescription")}
                  placeholder={language.t("dialog.ssh.importPlaceholder")}
                  value={store.importText}
                  disabled={save.isPending || identityLocked()}
                  onChange={(importText) => setStore("importText", importText)}
                  class="min-h-20 font-mono text-12-regular"
                />
                <button
                  type="button"
                  class="os-wb-ssh-action self-start"
                  onClick={importOpenSshConfig}
                  disabled={save.isPending || identityLocked() || !store.importText.trim()}
                >
                  {language.t("dialog.ssh.importAction")}
                </button>
              </div>
              <div ref={bindField("name")}>
                <TextField
                  required
                  label={language.t("dialog.ssh.name")}
                  description={language.t("dialog.ssh.nameDescription")}
                  value={store.form.name}
                  disabled={save.isPending || identityLocked()}
                  validationState={invalidField() === "name" ? "invalid" : "valid"}
                  error={invalidField() === "name" ? store.error : undefined}
                  autofocus
                  onChange={(name) => setForm({ name })}
                />
              </div>
              <div class="grid grid-cols-2 gap-2 min-w-0">
                <div ref={bindField("hostName")}>
                  <TextField
                    required
                    label={language.t("dialog.ssh.hostName")}
                    placeholder={language.t("dialog.ssh.hostNamePlaceholder")}
                    description={language.t("dialog.ssh.hostNameDescription")}
                    value={store.form.hostName}
                    disabled={save.isPending || identityLocked()}
                    validationState={invalidField() === "hostName" ? "invalid" : "valid"}
                    error={invalidField() === "hostName" ? store.error : undefined}
                    onChange={(hostName) => setForm({ hostName })}
                  />
                </div>
                <div ref={bindField("username")}>
                  <TextField
                    required
                    label={language.t("dialog.ssh.username")}
                    placeholder={language.t("dialog.ssh.usernamePlaceholder")}
                    description={language.t("dialog.ssh.usernameDescription")}
                    value={store.form.username}
                    disabled={save.isPending || identityLocked()}
                    validationState={invalidField() === "username" ? "invalid" : "valid"}
                    error={invalidField() === "username" ? store.error : undefined}
                    onChange={(username) => setForm({ username })}
                  />
                </div>
              </div>
              <div class="grid grid-cols-2 gap-2 min-w-0">
                <div ref={bindField("port")}>
                  <TextField
                    required
                    label={language.t("dialog.ssh.port")}
                    placeholder="22"
                    value={store.form.port}
                    disabled={save.isPending || identityLocked()}
                    validationState={invalidField() === "port" ? "invalid" : "valid"}
                    error={invalidField() === "port" ? store.error : undefined}
                    onChange={(port) => setForm({ port })}
                  />
                </div>
              </div>
              <TextField
                label={language.t("dialog.ssh.remotePath")}
                placeholder="/work/user/project"
                description={language.t("dialog.ssh.remotePathDescription")}
                value={store.form.remotePath}
                disabled={save.isPending}
                onChange={(remotePath) => setForm({ remotePath })}
              />
              <div class="grid grid-cols-2 gap-2 min-w-0">
                <div class="flex flex-col gap-1">
                  <span class="text-12-regular text-text-base">{language.t("dialog.ssh.auth")}</span>
                  <Select
                    options={[...authOptions]}
                    current={store.form.authType}
                    value={(x) => x}
                    label={(x) => language.t(`dialog.ssh.auth.${x}`)}
                    onSelect={(authType) => {
                      if (identityLocked() || !authType) return
                      setForm({ authType })
                    }}
                    disabled={save.isPending || identityLocked()}
                    variant="secondary"
                    size="large"
                    class="justify-between"
                  />
                  <p class="text-11-regular text-text-weak leading-snug">
                    {language.t(`dialog.ssh.auth.${store.form.authType}Description`)}
                  </p>
                </div>
              </div>
              <Show when={store.form.authType === "password"}>
                <div ref={bindField("password")}>
                  <TextField
                    required
                    type="password"
                    autocomplete="new-password"
                    label={language.t("dialog.ssh.password")}
                    placeholder={language.t("dialog.ssh.passwordPlaceholder")}
                    description={language.t("dialog.ssh.passwordHint")}
                    value={store.form.password}
                    disabled={save.isPending || identityLocked()}
                    validationState={invalidField() === "password" ? "invalid" : "valid"}
                    error={invalidField() === "password" ? store.error : undefined}
                    onChange={(password) => setForm({ password })}
                  />
                </div>
              </Show>
              <Show when={store.form.authType === "key"}>
                <div ref={bindField("keyPath")} class="flex min-w-0 flex-col gap-1.5">
                  <div class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
                    <TextField
                      required
                      label={language.t("dialog.ssh.keyPath")}
                      placeholder={language.t("dialog.ssh.keyPathPlaceholder")}
                      value={store.form.keyPath}
                      disabled={save.isPending || identityLocked()}
                      validationState={invalidField() === "keyPath" ? "invalid" : "valid"}
                      error={invalidField() === "keyPath" ? store.error : undefined}
                      onChange={(keyPath) => setForm({ keyPath })}
                      class="min-w-0"
                    />
                    <label class="shrink-0">
                      <input
                        ref={(el) => {
                          identityFileInput = el
                        }}
                        type="file"
                        class="sr-only"
                        disabled={save.isPending || identityLocked() || uploadIdentity.isPending}
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0]
                          event.currentTarget.value = ""
                          if (file) uploadIdentity.mutate(file)
                        }}
                      />
                      <span class="inline-flex h-8 cursor-pointer items-center whitespace-nowrap rounded-md border border-border-weak-base px-3 text-12-medium text-text-base hover:bg-surface-base-hover">
                        {uploadIdentity.isPending
                          ? language.t("dialog.ssh.identity.uploading")
                          : language.t("dialog.ssh.identity.upload")}
                      </span>
                    </label>
                  </div>
                  <p class="text-11-regular text-text-weak leading-snug">{language.t("dialog.ssh.identity.hint")}</p>
                  <Show when={store.keyMissing || (store.form.authType === "key" && !store.form.keyPath.trim())}>
                    <p class="text-11-regular text-text-critical-base leading-snug">
                      {store.keyIssue === "needsUpload"
                        ? language.t("dialog.ssh.identity.needsUploadInline")
                        : store.keyIssue === "notFound"
                          ? language.t("dialog.ssh.identity.notFoundInline")
                          : language.t("dialog.ssh.identity.missingInline")}
                    </p>
                  </Show>
                </div>
              </Show>
              <TextField
                multiline
                label={language.t("dialog.ssh.options")}
                placeholder="StrictHostKeyChecking=no"
                value={store.form.options}
                disabled={save.isPending}
                onChange={(options) => setForm({ options })}
              />
              <Show when={store.testResult}>
                {(result) => (
                  <div
                    classList={{
                      "border-border-success-base bg-surface-success-weak": result().success,
                      "border-border-critical-base bg-surface-critical-weak": !result().success,
                    }}
                    class="rounded-md border p-3 flex flex-col gap-2"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <span class="text-13-medium text-text-strong">
                        {result().success
                          ? language.t("dialog.ssh.test.passed")
                          : language.t("dialog.ssh.test.failed")}
                      </span>
                      <span class="text-11-regular text-text-weaker">
                        {store.form.name || store.form.remotePath}
                      </span>
                    </div>
                    <pre class="max-h-44 overflow-auto whitespace-pre-wrap rounded bg-surface-base p-2 font-mono text-11-regular text-text-base">
                      {sshTestDetails(result())}
                    </pre>
                  </div>
                )}
              </Show>
            </div>
          </div>
          <div class="os-wb-ssh-form-actions">
            <button type="button" class="os-wb-ssh-action" disabled={testDisabled()} onClick={testConfig}>
              {test.isPending ? language.t("dialog.ssh.test.running") : language.t("dialog.ssh.test.action")}
            </button>
            <button type="button" class="os-wb-ssh-action" disabled={save.isPending} onClick={resetForm}>
              {language.t("common.cancel")}
            </button>
            <button
              type="button"
              class="os-wb-ssh-action os-wb-ssh-action-primary"
              disabled={save.isPending}
              onClick={attemptSave}
            >
              {save.isPending ? language.t("common.saving") : language.t("common.save")}
            </button>
          </div>
          <Show when={store.pickIdentityOpen}>
            <div
              class="absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-4"
              role="presentation"
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="ssh-pick-identity-title"
                class="os-wb-ssh-identity-prompt flex w-full max-w-md flex-col gap-3 p-5"
              >
                <h3 id="ssh-pick-identity-title" class="text-14-medium text-text-strong">
                  {language.t("dialog.ssh.identity.pickPromptTitle")}
                </h3>
                <p class="text-12-regular text-text-weak leading-snug">
                  {language.t("dialog.ssh.identity.pickPromptDescription")}
                </p>
                <Show when={store.form.keyPath.trim()}>
                  <p class="break-all rounded bg-surface-base p-2 font-mono text-11-regular text-text-base">
                    {store.form.keyPath}
                  </p>
                </Show>
                <div class="os-wb-ssh-toolbar pt-1">
                  <button type="button" class="os-wb-ssh-action" onClick={() => setStore("pickIdentityOpen", false)}>
                    {language.t("dialog.ssh.identity.pickPromptLater")}
                  </button>
                  <button
                    type="button"
                    class="os-wb-ssh-action os-wb-ssh-action-primary"
                    disabled={save.isPending || uploadIdentity.isPending}
                    onClick={openIdentityFilePicker}
                  >
                    {uploadIdentity.isPending
                      ? language.t("dialog.ssh.identity.uploading")
                      : language.t("dialog.ssh.identity.pickPromptAction")}
                  </button>
                </div>
              </div>
            </div>
          </Show>
        </div>
      </Show>
  )

  const body = (
    <div class="os-wb-ssh-panel relative" data-mode={isFormMode() ? "form" : "list"} data-variant={variant()}>
      {panel}
      <Show when={confirm()}>
        {(current) => {
          const state = current()
          const title =
            state.kind === "blocked"
              ? state.title
              : state.kind === "delete"
                ? language.t("dialog.ssh.usage.confirm.delete.title")
                : language.t("dialog.ssh.usage.confirm.save")
          return (
          <div
            class="absolute inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
            role="presentation"
            onClick={() => setConfirm(undefined)}
          >
            <div
              role="dialog"
              aria-modal="true"
              class="os-wb-ssh-identity-prompt flex w-full max-w-md flex-col gap-3 p-5"
              onClick={(event) => event.stopPropagation()}
            >
              <h3 class="text-14-medium text-text-strong">{title}</h3>
              <p class="text-12-regular text-text-weak leading-snug whitespace-pre-wrap">{state.body}</p>
              <div class="os-wb-ssh-toolbar pt-1">
                <Show when={state.kind !== "blocked"}>
                  <button type="button" class="os-wb-ssh-action" onClick={() => setConfirm(undefined)}>
                    {language.t("common.cancel")}
                  </button>
                </Show>
                <button
                  type="button"
                  class="os-wb-ssh-action os-wb-ssh-action-primary"
                  onClick={() => (state.kind === "blocked" ? setConfirm(undefined) : confirmAction())}
                >
                  {state.kind === "blocked" ? language.t("dialog.ssh.usage.ok") : language.t("common.confirm")}
                </button>
              </div>
            </div>
          </div>
          )
        }}
      </Show>
    </div>
  )

  if (variant() === "page") return body

  return (
    <Dialog
      size="large"
      title={formTitle()}
      description={!isFormMode() ? language.t("dialog.ssh.description") : undefined}
      class="os-wb-ssh-dialog overflow-hidden [&_[data-slot=dialog-body]]:min-h-0 [&_[data-slot=dialog-body]]:overflow-hidden"
      action={props.onClose ? (
        <IconButton
          icon="close"
          variant="ghost"
          onClick={closeDialog}
          aria-label={language.t("ui.common.close")}
        />
      ) : undefined}
    >
      {body}
    </Dialog>
  )
}
