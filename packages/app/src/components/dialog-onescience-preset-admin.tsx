import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { copyTextToClipboard } from "@opencode-ai/ui/clipboard"
import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"
import { DialogSelectServer } from "@/components/dialog-select-server"

type ConfigView = {
  baseURL: string
  modelID: string
  modelName: string
  providerName: string
  hasApiKey: boolean
}

type LoginResult = {
  ok: boolean
  token?: string
  lockedUntil?: number
  retryAfterMs?: number
  failures?: number
}

type ModelsResponse = {
  ok: boolean
  models?: string[]
  kind?: "auth" | "network" | "http" | "timeout"
  message?: string
  status?: number
}

type PlatformAccountItem = {
  id: string
  email: string
  name: string
  status: string
  timeCreated: number
}

type PasswordResetCredential = {
  accountId: string
  resetToken: string
  expiresAt: number
  accountName: string
  accountEmail: string
}

type RegistrationConfigView = {
  inviteRequired: boolean
  fixedInvite?: { code: string; expiresAt: number; ttlDays?: number }
  randomInvites: Array<{ code: string; expiresAt: number; usedAt?: number }>
}

type Step = "password" | "menu" | "model" | "users" | "credential" | "mail" | "registration" | "backends"

function formatRetry(ms: number) {
  const total = Math.max(1, Math.ceil(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

export function DialogOnesciencePresetAdmin(props?: { initialStep?: Step; initialToken?: string }) {
  const dialog = useDialog()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const server = useServer()

  const [step, setStep] = createSignal<Step>(props?.initialStep ?? (props?.initialToken ? "menu" : "password"))
  const [token, setToken] = createSignal(props?.initialToken ?? "")
  const [busy, setBusy] = createSignal(false)
  const [password, setPassword] = createSignal("")
  const [lockedUntil, setLockedUntil] = createSignal(0)
  const [now, setNow] = createSignal(Date.now())
  const [form, setForm] = createStore({
    baseURL: "",
    modelID: "",
    modelName: "",
    providerName: "",
    apiKey: "",
    hasApiKey: false,
  })
  const [mailForm, setMailForm] = createStore({
    host: "",
    port: "587",
    secure: false,
    user: "",
    from: "",
    pass: "",
    hasPassword: false,
    configured: false,
    source: "none" as "env" | "file" | "mixed" | "none" | "builtin",
    testTo: "",
  })
  const [discoveredModels, setDiscoveredModels] = createSignal<string[]>([])
  const [queryPending, setQueryPending] = createSignal(false)
  const [queryError, setQueryError] = createSignal<string>()
  const [accounts, setAccounts] = createSignal<PlatformAccountItem[]>([])
  const [accountsLoading, setAccountsLoading] = createSignal(false)
  const [selectedAccountId, setSelectedAccountId] = createSignal<string>()
  const [credential, setCredential] = createSignal<PasswordResetCredential>()
  const [registration, setRegistration] = createStore({
    inviteRequired: false,
    fixedCode: "",
    fixedTtlDays: 30 as 7 | 14 | 30,
    fixedExpiresAt: 0,
    randomInvites: [] as Array<{ code: string; expiresAt: number; usedAt?: number }>,
    lastRandomCode: "",
    lastRandomExpiresAt: 0,
  })

  const retryAfterMs = createMemo(() => Math.max(0, lockedUntil() - now()))
  const locked = createMemo(() => retryAfterMs() > 0)
  const discoveredCount = createMemo(() => discoveredModels().length)
  const selectedAccount = createMemo(() => accounts().find((item) => item.id === selectedAccountId()))

  createEffect(() => {
    if (!locked()) return
    const id = window.setInterval(() => setNow(Date.now()), 250)
    onCleanup(() => window.clearInterval(id))
  })

  createEffect(() => {
    void requestJson<{ lockedUntil?: number }>("/global/onescience-preset/status", { method: "GET" })
      .then((status) => {
        if (status.lockedUntil && status.lockedUntil > Date.now()) {
          setLockedUntil(status.lockedUntil)
          setNow(Date.now())
        }
      })
      .catch(() => undefined)
  })

  const title = createMemo(() => {
    if (step() === "model") return language.t("settings.providers.onescience.admin.menu.model")
    if (step() === "mail") return language.t("settings.providers.onescience.admin.menu.mail")
    if (step() === "registration") return language.t("settings.providers.onescience.admin.menu.registration")
    if (step() === "backends") return language.t("settings.providers.onescience.admin.menu.backends")
    if (step() === "users" || step() === "credential") {
      return language.t("settings.providers.onescience.admin.menu.users")
    }
    return language.t("settings.providers.onescience.admin.title")
  })

  // Marker classes size dialog-container via CSS (:has). Putting max-width only on
  // dialog-content leaves the default 640px transparent shell visible on the right.
  const dialogClass = createMemo(() =>
    step() === "users" || step() === "credential" || step() === "mail" || step() === "registration" || step() === "backends"
      ? "os-onescience-admin-dialog os-onescience-admin-dialog--wide w-full"
      : "os-onescience-admin-dialog os-onescience-admin-dialog--narrow w-full",
  )

  async function requestJson<T>(path: string, init: { method: string; body?: unknown }) {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    const current = server.current
    if (current?.http.password) {
      headers.Authorization = `Basic ${authTokenFromCredentials({
        username: current.http.username,
        password: current.http.password,
      })}`
    }
    const response = await fetch(`${globalSDK.url}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    const text = await response.text()
    const data = text ? (JSON.parse(text) as unknown) : undefined
    if (!response.ok) {
      const message =
        data && typeof data === "object" && "message" in data ? String((data as { message: unknown }).message) : text
      throw new Error(message || response.statusText)
    }
    return data as T
  }

  async function refreshProviders() {
    await globalSDK.client.global.dispose().catch(() => undefined)
    await globalSync.reload()
  }

  async function loadConfig(adminToken: string) {
    const cfg = await requestJson<ConfigView>("/global/onescience-preset/admin/config", {
      method: "POST",
      body: { token: adminToken },
    })
    setForm({
      baseURL: cfg.baseURL,
      modelID: cfg.modelID,
      modelName: cfg.modelName,
      providerName: cfg.providerName,
      apiKey: "",
      hasApiKey: cfg.hasApiKey,
    })
  }

  async function login() {
    if (busy() || locked()) return
    setBusy(true)
    try {
      const result = await requestJson<LoginResult>("/global/onescience-preset/admin/login", {
        method: "POST",
        body: { password: password() },
      })
      if (!result.ok || !result.token) {
        if (result.lockedUntil && result.lockedUntil > Date.now()) {
          setLockedUntil(result.lockedUntil)
          setNow(Date.now())
          showToast({
            title: language.t("settings.providers.onescience.admin.passwordLocked", {
              time: formatRetry(result.lockedUntil - Date.now()),
            }),
          })
        } else {
          showToast({ title: language.t("settings.providers.onescience.admin.passwordInvalid") })
        }
        return
      }
      setLockedUntil(0)
      setToken(result.token)
      setPassword("")
      setStep("menu")
    } catch (err) {
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }

  function openBackends() {
    setStep("backends")
  }

  async function openModel() {
    if (busy()) return
    setBusy(true)
    try {
      await loadConfig(token())
      setDiscoveredModels([])
      setQueryError(undefined)
      setStep("model")
    } catch (err) {
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }

  async function openUsers() {
    if (busy()) return
    setBusy(true)
    setAccountsLoading(true)
    setSelectedAccountId(undefined)
    setCredential(undefined)
    try {
      const result = await requestJson<{ items: PlatformAccountItem[] }>("/global/onescience-preset/admin/accounts", {
        method: "POST",
        body: { token: token() },
      })
      setAccounts(result.items ?? [])
      setStep("users")
    } catch (err) {
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setAccountsLoading(false)
      setBusy(false)
    }
  }

  async function refreshAccounts() {
    const result = await requestJson<{ items: PlatformAccountItem[] }>("/global/onescience-preset/admin/accounts", {
      method: "POST",
      body: { token: token() },
    })
    setAccounts(result.items ?? [])
  }

  function applyRegistrationView(cfg: RegistrationConfigView) {
    setRegistration({
      inviteRequired: cfg.inviteRequired,
      fixedCode: cfg.fixedInvite?.code ?? "",
      fixedTtlDays: ([7, 14, 30].includes(Number(cfg.fixedInvite?.ttlDays))
        ? Number(cfg.fixedInvite?.ttlDays)
        : 30) as 7 | 14 | 30,
      fixedExpiresAt: cfg.fixedInvite?.expiresAt ?? 0,
      randomInvites: cfg.randomInvites ?? [],
    })
  }

  async function openRegistration() {
    if (busy()) return
    setBusy(true)
    try {
      const cfg = await requestJson<RegistrationConfigView>("/global/onescience-preset/admin/registration/config", {
        method: "POST",
        body: { token: token() },
      })
      applyRegistrationView(cfg)
      setRegistration({ lastRandomCode: "", lastRandomExpiresAt: 0 })
      setStep("registration")
    } catch (err) {
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }

  async function saveRegistration() {
    if (busy()) return
    setBusy(true)
    try {
      const cfg = await requestJson<RegistrationConfigView>("/global/onescience-preset/admin/registration/config", {
        method: "PATCH",
        body: {
          token: token(),
          inviteRequired: registration.inviteRequired,
          fixedCode: registration.fixedCode.trim() || undefined,
          fixedTtlDays: registration.fixedTtlDays,
          clearFixedInvite: !registration.fixedCode.trim(),
        },
      })
      applyRegistrationView(cfg)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.providers.onescience.admin.registration.saved"),
      })
    } catch (err) {
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }

  async function createRandomInviteCode() {
    if (busy()) return
    setBusy(true)
    try {
      const result = await requestJson<{ code: string; expiresAt: number }>(
        "/global/onescience-preset/admin/registration/random-invite",
        {
          method: "POST",
          body: { token: token() },
        },
      )
      setRegistration({
        lastRandomCode: result.code,
        lastRandomExpiresAt: result.expiresAt,
      })
      const cfg = await requestJson<RegistrationConfigView>("/global/onescience-preset/admin/registration/config", {
        method: "POST",
        body: { token: token() },
      })
      applyRegistrationView(cfg)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.providers.onescience.admin.registration.randomCreated"),
      })
    } catch (err) {
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }

  async function setSelectedAccountStatus(status: "active" | "frozen") {
    const account = selectedAccount()
    if (!account || busy()) return
    setBusy(true)
    try {
      await requestJson<PlatformAccountItem>("/global/onescience-preset/admin/accounts/status", {
        method: "POST",
        body: { token: token(), accountId: account.id, status },
      })
      await refreshAccounts()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t(
          status === "frozen"
            ? "settings.providers.onescience.admin.users.frozen"
            : "settings.providers.onescience.admin.users.unfrozen",
        ),
      })
    } catch (err) {
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }

  async function deleteSelectedAccount() {
    const account = selectedAccount()
    if (!account || busy()) return
    const confirmed = window.confirm(
      language.t("settings.providers.onescience.admin.users.deleteConfirm", {
        name: account.name,
        email: account.email,
      }),
    )
    if (!confirmed) return
    setBusy(true)
    try {
      await requestJson<boolean>("/global/onescience-preset/admin/accounts/delete", {
        method: "POST",
        body: { token: token(), accountId: account.id },
      })
      setSelectedAccountId(undefined)
      await refreshAccounts()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.providers.onescience.admin.users.deleted"),
      })
    } catch (err) {
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }

  function accountStatusLabel(status: string) {
    if (status === "active") return language.t("settings.providers.onescience.admin.users.status.active")
    if (status === "frozen") return language.t("settings.providers.onescience.admin.users.status.frozen")
    if (status === "limited") return language.t("settings.providers.onescience.admin.users.status.limited")
    return status
  }

  async function openMail() {
    if (busy()) return
    setBusy(true)
    try {
      const cfg = await requestJson<{
        host: string
        port: number
        secure: boolean
        user: string
        from: string
        testTo: string
        hasPassword: boolean
        configured: boolean
        source: "env" | "file" | "mixed" | "none" | "builtin"
      }>("/global/onescience-preset/admin/mail/config", {
        method: "POST",
        body: { token: token() },
      })
      setMailForm({
        host: cfg.host,
        port: String(cfg.port || 587),
        secure: cfg.secure,
        user: cfg.user,
        from: cfg.from,
        pass: "",
        hasPassword: cfg.hasPassword,
        configured: cfg.configured,
        source: cfg.source,
        // Prefill only a previously saved test recipient — never SMTP user/from.
        testTo: cfg.testTo?.trim() || "",
      })
      setStep("mail")
    } catch (err) {
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }

  async function saveMail() {
    if (busy()) return
    setBusy(true)
    try {
      const cfg = await requestJson<{
        host: string
        port: number
        secure: boolean
        user: string
        from: string
        testTo: string
        hasPassword: boolean
        configured: boolean
        source: "env" | "file" | "mixed" | "none" | "builtin"
      }>("/global/onescience-preset/admin/mail/config", {
        method: "PATCH",
        body: {
          token: token(),
          testTo: mailForm.testTo.trim(),
        },
      })
      if (!cfg.configured) {
        showToast({
          title: language.t("common.requestFailed"),
          description: language.t("settings.providers.onescience.admin.mail.needPass"),
        })
        return
      }
      setMailForm({
        host: cfg.host,
        port: String(cfg.port || 587),
        secure: cfg.secure,
        user: cfg.user,
        from: cfg.from,
        pass: "",
        hasPassword: cfg.hasPassword,
        configured: cfg.configured,
        source: cfg.source,
        testTo: cfg.testTo?.trim() || "",
      })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.providers.onescience.admin.mail.saved"),
      })
    } catch (err) {
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }

  async function testMail() {
    if (busy() || !mailForm.testTo.trim()) return
    setBusy(true)
    try {
      const port = Number(mailForm.port)
      const result = await requestJson<{ ok: boolean; error?: string }>("/global/onescience-preset/admin/mail/test", {
        method: "POST",
        body: {
          token: token(),
          to: mailForm.testTo.trim(),
          host: mailForm.host.trim() || undefined,
          port: Number.isFinite(port) && port > 0 ? port : undefined,
          secure: mailForm.secure,
          user: mailForm.user.trim() || undefined,
          from: mailForm.from.trim() || undefined,
          // Blank password means "use server/env auth"; typed value overrides for this test only.
          pass: mailForm.pass.trim() || undefined,
        },
      })
      if (!result.ok) {
        showToast({
          title: language.t("common.requestFailed"),
          description: result.error || language.t("common.requestFailed"),
        })
        return
      }
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.providers.onescience.admin.mail.testSent"),
      })
    } catch (err) {
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }

  async function generateCredential() {
    const account = selectedAccount()
    if (!account || busy()) return
    setBusy(true)
    try {
      const result = await requestJson<{ accountId: string; resetToken: string; expiresAt: number }>(
        "/global/onescience-preset/admin/password-reset",
        {
          method: "POST",
          body: { token: token(), accountId: account.id },
        },
      )
      setCredential({
        accountId: result.accountId,
        resetToken: result.resetToken,
        expiresAt: result.expiresAt,
        accountName: account.name,
        accountEmail: account.email,
      })
      setStep("credential")
    } catch (err) {
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }

  function resetPath(resetToken: string) {
    return `/forgot-password?token=${encodeURIComponent(resetToken)}`
  }

  function resetUrl(resetToken: string) {
    if (typeof window === "undefined") return resetPath(resetToken)
    return `${window.location.origin}${resetPath(resetToken)}`
  }

  async function copyText(
    value: string,
    successKey:
      | "settings.providers.onescience.admin.resetPassword.copiedCode"
      | "settings.providers.onescience.admin.resetPassword.copiedLink"
      | "settings.providers.onescience.admin.registration.copiedCode",
  ) {
    if (await copyTextToClipboard(value)) {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t(successKey),
      })
      return
    }
    showToast({
      title: language.t("toast.session.share.copyFailed.title"),
    })
  }

  function formatExpiry(expiresAt: number) {
    try {
      return new Date(expiresAt).toLocaleString()
    } catch {
      return String(expiresAt)
    }
  }

  function goBackFromSubstep() {
    if (step() === "credential") {
      setCredential(undefined)
      setStep("users")
      return
    }
    setStep("menu")
  }

  function selectDiscoveredModel(id: string) {
    setForm("modelID", id)
    if (!form.modelName.trim()) setForm("modelName", id)
  }

  async function queryModels() {
    if (queryPending()) return
    setQueryError(undefined)

    const baseURL = form.baseURL.trim()
    if (!baseURL || !/^https?:\/\//.test(baseURL)) {
      setQueryError(language.t("settings.providers.onescience.admin.models.query.needURL"))
      return
    }

    const apiKey = form.apiKey.trim() || undefined
    if (!apiKey && !form.hasApiKey) {
      setQueryError(language.t("settings.providers.onescience.admin.models.query.needKey"))
      return
    }

    setQueryPending(true)
    try {
      const data = await requestJson<ModelsResponse>("/global/provider/models", {
        method: "POST",
        body: {
          baseURL,
          apiKey,
          providerID: !apiKey && form.hasApiKey ? "onescience" : undefined,
        },
      })

      if (!data?.ok) {
        const kind = data?.kind
        const message = data?.message
        if (kind === "auth") {
          throw new Error(message || language.t("provider.custom.error.probe.auth"))
        }
        if (kind === "timeout") {
          throw new Error(message || language.t("provider.custom.error.probe.timeout"))
        }
        if (kind === "network") {
          throw new Error(message || language.t("provider.custom.error.probe.network"))
        }
        throw new Error(message || language.t("provider.custom.error.probe.failed"))
      }

      const models = data.models ?? []
      setDiscoveredModels(models)
      if (models.length === 0) {
        setQueryError(language.t("settings.providers.onescience.admin.models.query.empty"))
      }
    } catch (err) {
      setDiscoveredModels([])
      const message = err instanceof Error ? err.message : String(err)
      setQueryError(message)
      showToast({
        title: language.t("settings.providers.onescience.admin.models.query.failed"),
        description: message,
      })
    } finally {
      setQueryPending(false)
    }
  }

  async function save() {
    if (busy()) return
    setBusy(true)
    try {
      const cfg = await requestJson<ConfigView>("/global/onescience-preset/admin/config", {
        method: "PATCH",
        body: {
          token: token(),
          baseURL: form.baseURL,
          modelID: form.modelID,
          modelName: form.modelName,
          providerName: form.providerName,
          apiKey: form.apiKey || undefined,
        },
      })
      setForm({
        baseURL: cfg.baseURL,
        modelID: cfg.modelID,
        modelName: cfg.modelName,
        providerName: cfg.providerName,
        apiKey: "",
        hasApiKey: cfg.hasApiKey,
      })
      await refreshProviders()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.providers.onescience.admin.saved"),
      })
      setStep("menu")
    } catch (err) {
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    if (busy()) return
    setBusy(true)
    try {
      const cfg = await requestJson<ConfigView>("/global/onescience-preset/admin/reset", {
        method: "POST",
        body: { token: token() },
      })
      setForm({
        baseURL: cfg.baseURL,
        modelID: cfg.modelID,
        modelName: cfg.modelName,
        providerName: cfg.providerName,
        apiKey: "",
        hasApiKey: cfg.hasApiKey,
      })
      await refreshProviders()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.providers.onescience.admin.reset"),
      })
    } catch (err) {
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={
        step() === "model" ||
        step() === "users" ||
        step() === "credential" ||
        step() === "mail" ||
        step() === "registration" ||
        step() === "backends" ? (
          <div class="flex items-center gap-2 min-w-0">
            <IconButton
              tabIndex={-1}
              icon="arrow-left"
              variant="ghost"
              onClick={() => goBackFromSubstep()}
              aria-label={language.t("common.goBack")}
            />
            <span class="truncate">{title()}</span>
          </div>
        ) : (
          title()
        )
      }
      description={step() === "password" ? language.t("settings.providers.onescience.admin.passwordHint") : undefined}
      fit
      transition
      class={dialogClass()}
    >
      <div class="w-full px-5 pb-5 flex flex-col gap-4">
        <Switch>
          <Match when={step() === "password"}>
            <TextField
              autofocus
              type="password"
              label={language.t("settings.providers.onescience.admin.password")}
              value={password()}
              onChange={setPassword}
              placeholder={language.t("settings.providers.onescience.admin.passwordPlaceholder")}
              disabled={locked()}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter" && password().trim() && !busy() && !locked()) void login()
              }}
            />
            <Show when={locked()}>
              <p class="text-12-regular text-text-weak">
                {language.t("settings.providers.onescience.admin.passwordLocked", {
                  time: formatRetry(retryAfterMs()),
                })}
              </p>
            </Show>
            <div class="flex justify-end pt-1">
              <Button
                variant="primary"
                disabled={busy() || locked() || !password().trim()}
                onClick={() => void login()}
              >
                {language.t("settings.providers.onescience.admin.unlock")}
              </Button>
            </div>
          </Match>

          <Match when={step() === "menu"}>
            <p class="text-14-regular text-text-base">{language.t("settings.providers.onescience.admin.menu.hint")}</p>
            <div class="flex flex-col rounded-lg border border-border-weak-base overflow-hidden">
              <button
                type="button"
                class="flex items-center justify-between gap-3 w-full px-3.5 py-3 text-left hover:bg-surface-base-hover transition-colors disabled:opacity-50 border-b border-border-weak-base"
                disabled={busy()}
                onClick={() => void openModel()}
              >
                <div class="flex flex-col gap-0.5 min-w-0">
                  <span class="text-14-medium text-text-strong">
                    {language.t("settings.providers.onescience.admin.menu.model")}
                  </span>
                  <span class="text-12-regular text-text-weak">
                    {language.t("settings.providers.onescience.admin.menu.model.description")}
                  </span>
                </div>
                <Icon name="chevron-right" size="small" class="shrink-0 text-icon-base" />
              </button>
              <button
                type="button"
                class="flex items-center justify-between gap-3 w-full px-3.5 py-3 text-left hover:bg-surface-base-hover transition-colors disabled:opacity-50 border-b border-border-weak-base"
                disabled={busy()}
                onClick={() => void openMail()}
              >
                <div class="flex flex-col gap-0.5 min-w-0">
                  <span class="text-14-medium text-text-strong">
                    {language.t("settings.providers.onescience.admin.menu.mail")}
                  </span>
                  <span class="text-12-regular text-text-weak">
                    {language.t("settings.providers.onescience.admin.menu.mail.description")}
                  </span>
                </div>
                <Icon name="chevron-right" size="small" class="shrink-0 text-icon-base" />
              </button>
              <button
                type="button"
                class="flex items-center justify-between gap-3 w-full px-3.5 py-3 text-left hover:bg-surface-base-hover transition-colors disabled:opacity-50 border-b border-border-weak-base"
                disabled={busy()}
                onClick={() => openBackends()}
              >
                <div class="flex flex-col gap-0.5 min-w-0">
                  <span class="text-14-medium text-text-strong">
                    {language.t("settings.providers.onescience.admin.menu.backends")}
                  </span>
                  <span class="text-12-regular text-text-weak">
                    {language.t("settings.providers.onescience.admin.menu.backends.description")}
                  </span>
                </div>
                <Icon name="chevron-right" size="small" class="shrink-0 text-icon-base" />
              </button>
              <button
                type="button"
                class="flex items-center justify-between gap-3 w-full px-3.5 py-3 text-left hover:bg-surface-base-hover transition-colors disabled:opacity-50 border-b border-border-weak-base"
                disabled={busy()}
                onClick={() => void openUsers()}
              >
                <div class="flex flex-col gap-0.5 min-w-0">
                  <span class="text-14-medium text-text-strong">
                    {language.t("settings.providers.onescience.admin.menu.users")}
                  </span>
                  <span class="text-12-regular text-text-weak">
                    {language.t("settings.providers.onescience.admin.menu.users.description")}
                  </span>
                </div>
                <Icon name="chevron-right" size="small" class="shrink-0 text-icon-base" />
              </button>
              <button
                type="button"
                class="flex items-center justify-between gap-3 w-full px-3.5 py-3 text-left hover:bg-surface-base-hover transition-colors disabled:opacity-50"
                disabled={busy()}
                onClick={() => void openRegistration()}
              >
                <div class="flex flex-col gap-0.5 min-w-0">
                  <span class="text-14-medium text-text-strong">
                    {language.t("settings.providers.onescience.admin.menu.registration")}
                  </span>
                  <span class="text-12-regular text-text-weak">
                    {language.t("settings.providers.onescience.admin.menu.registration.description")}
                  </span>
                </div>
                <Icon name="chevron-right" size="small" class="shrink-0 text-icon-base" />
              </button>
            </div>
            <div class="flex justify-end pt-1">
              <Button variant="ghost" disabled={busy()} onClick={() => dialog.close()}>
                {language.t("common.close")}
              </Button>
            </div>
          </Match>

          <Match when={step() === "users"}>
            <p class="text-14-regular text-text-base">
              {language.t("settings.providers.onescience.admin.users.hint")}
            </p>
            <Show
              when={!accountsLoading()}
              fallback={<p class="text-13-regular text-text-weak">{language.t("common.loading")}</p>}
            >
              <Show
                when={accounts().length > 0}
                fallback={
                  <p class="text-13-regular text-text-weak">
                    {language.t("settings.providers.onescience.admin.users.empty")}
                  </p>
                }
              >
                <div class="flex flex-col gap-1 max-h-[min(40vh,280px)] overflow-y-auto rounded-lg border border-border-weak-base p-1.5">
                  <For each={accounts()}>
                    {(account) => {
                      const selected = () => selectedAccountId() === account.id
                      return (
                        <button
                          type="button"
                          class="flex w-full min-w-0 items-start gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-surface-raised-base-hover data-[selected=true]:bg-surface-base-active"
                          data-selected={selected() ? "true" : undefined}
                          onClick={() => setSelectedAccountId(account.id)}
                        >
                          <span
                            class="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-border-weak-base"
                            classList={{ "border-border-strong-base": selected() }}
                            aria-hidden="true"
                          >
                            <Show when={selected()}>
                              <span class="size-2 rounded-full bg-text-strong" />
                            </Show>
                          </span>
                          <span class="min-w-0 flex-1 flex flex-col gap-0.5">
                            <span class="flex items-center gap-2 min-w-0">
                              <span class="text-14-medium text-text-strong break-all">{account.name}</span>
                              <span class="text-11-regular text-text-weak shrink-0">
                                {accountStatusLabel(account.status)}
                              </span>
                            </span>
                            <span class="text-12-regular text-text-weak break-all">{account.email}</span>
                          </span>
                        </button>
                      )
                    }}
                  </For>
                </div>
              </Show>
            </Show>
            <div class="flex flex-wrap justify-end gap-2 pt-1">
              <Button variant="ghost" disabled={busy()} onClick={() => setStep("menu")}>
                {language.t("common.goBack")}
              </Button>
              <Show when={selectedAccount()?.status === "frozen"}>
                <Button
                  variant="secondary"
                  disabled={busy() || !selectedAccountId()}
                  onClick={() => void setSelectedAccountStatus("active")}
                >
                  {language.t("settings.providers.onescience.admin.users.unfreeze")}
                </Button>
              </Show>
              <Show when={selectedAccount()?.status !== "frozen"}>
                <Button
                  variant="secondary"
                  disabled={busy() || !selectedAccountId()}
                  onClick={() => void setSelectedAccountStatus("frozen")}
                >
                  {language.t("settings.providers.onescience.admin.users.freeze")}
                </Button>
              </Show>
              <Button
                variant="secondary"
                disabled={busy() || !selectedAccountId()}
                onClick={() => void generateCredential()}
              >
                {language.t("settings.providers.onescience.admin.resetPassword.generate")}
              </Button>
              <Button
                variant="primary"
                disabled={busy() || !selectedAccountId()}
                onClick={() => void deleteSelectedAccount()}
              >
                {language.t("settings.providers.onescience.admin.users.delete")}
              </Button>
            </div>
          </Match>

          <Match when={step() === "credential"}>
            <Show when={credential()}>
              {(item) => (
                <>
                  <p class="text-14-regular text-text-base">
                    {language.t("settings.providers.onescience.admin.resetPassword.credentialHint", {
                      name: item().accountName,
                      email: item().accountEmail,
                    })}
                  </p>
                  <div class="flex flex-col gap-3 rounded-lg border border-border-weak-base p-3.5 bg-background-base">
                    <div class="flex flex-col gap-1 min-w-0">
                      <span class="text-12-medium text-text-weak">
                        {language.t("settings.providers.onescience.admin.resetPassword.code")}
                      </span>
                      <code class="text-16-medium text-text-strong tracking-wide break-all">{item().resetToken}</code>
                    </div>
                    <div class="flex flex-col gap-1 min-w-0">
                      <span class="text-12-medium text-text-weak">
                        {language.t("settings.providers.onescience.admin.resetPassword.link")}
                      </span>
                      <code class="text-12-regular text-text-strong break-all">{resetUrl(item().resetToken)}</code>
                    </div>
                    <p class="text-12-regular text-text-weak m-0">
                      {language.t("settings.providers.onescience.admin.resetPassword.expires", {
                        time: formatExpiry(item().expiresAt),
                      })}
                    </p>
                    <p class="text-12-regular text-text-critical-base m-0">
                      {language.t("settings.providers.onescience.admin.resetPassword.once")}
                    </p>
                  </div>
                  <div class="flex flex-wrap justify-end gap-2 pt-1">
                    <Button
                      variant="secondary"
                      disabled={busy()}
                      onClick={() =>
                        void copyText(
                          item().resetToken,
                          "settings.providers.onescience.admin.resetPassword.copiedCode",
                        )
                      }
                    >
                      {language.t("settings.providers.onescience.admin.resetPassword.copyCode")}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy()}
                      onClick={() =>
                        void copyText(
                          resetUrl(item().resetToken),
                          "settings.providers.onescience.admin.resetPassword.copiedLink",
                        )
                      }
                    >
                      {language.t("settings.providers.onescience.admin.resetPassword.copyLink")}
                    </Button>
                    <Button variant="primary" disabled={busy()} onClick={() => dialog.close()}>
                      {language.t("common.close")}
                    </Button>
                  </div>
                </>
              )}
            </Show>
          </Match>

          <Match when={step() === "mail"}>
            <p class="text-14-regular text-text-base">{language.t("settings.providers.onescience.admin.mail.hint")}</p>
            <div class="flex flex-col gap-3 max-h-[min(60vh,480px)] overflow-y-auto pr-0.5">
              <TextField
                label={language.t("settings.providers.onescience.admin.mail.host")}
                value={mailForm.host}
                onChange={(value) => setMailForm("host", value)}
                placeholder="smtp.example.com"
              />
              <TextField
                label={language.t("settings.providers.onescience.admin.mail.port")}
                value={mailForm.port}
                onChange={(value) => setMailForm("port", value)}
                placeholder="587"
              />
              <label class="flex items-center gap-2 text-14-regular text-text-strong">
                <input
                  type="checkbox"
                  checked={mailForm.secure}
                  onChange={(event) => setMailForm("secure", event.currentTarget.checked)}
                />
                {language.t("settings.providers.onescience.admin.mail.secure")}
              </label>
              <TextField
                label={language.t("settings.providers.onescience.admin.mail.user")}
                value={mailForm.user}
                onChange={(value) => setMailForm("user", value)}
              />
              <TextField
                label={language.t("settings.providers.onescience.admin.mail.from")}
                value={mailForm.from}
                onChange={(value) => setMailForm("from", value)}
                placeholder="OneCode <noreply@example.com>"
              />
              <TextField
                type="password"
                label={language.t("settings.providers.onescience.admin.mail.pass")}
                value={mailForm.pass}
                onChange={(value) => setMailForm("pass", value)}
                placeholder={
                  mailForm.hasPassword
                    ? language.t("settings.providers.onescience.admin.mail.passKeep")
                    : language.t("settings.providers.onescience.admin.mail.passPlaceholder")
                }
              />
              <TextField
                label={language.t("settings.providers.onescience.admin.mail.testTo")}
                value={mailForm.testTo}
                onChange={(value) => setMailForm("testTo", value)}
                placeholder="name@example.com"
              />
            </div>
            <div class="flex flex-wrap justify-end gap-2 pt-1">
              <Button variant="ghost" disabled={busy()} onClick={() => setStep("menu")}>
                {language.t("common.goBack")}
              </Button>
              <Button variant="secondary" disabled={busy() || !mailForm.testTo.trim()} onClick={() => void testMail()}>
                {language.t("settings.providers.onescience.admin.mail.test")}
              </Button>
              <Button variant="primary" disabled={busy()} onClick={() => void saveMail()}>
                {language.t("common.save")}
              </Button>
            </div>
          </Match>

          <Match when={step() === "registration"}>
            <p class="text-14-regular text-text-base">
              {language.t("settings.providers.onescience.admin.registration.hint")}
            </p>
            <div class="flex flex-col gap-3 max-h-[min(60vh,480px)] overflow-y-auto pr-0.5">
              <label class="flex items-center gap-2 text-14-regular text-text-base">
                <input
                  type="checkbox"
                  checked={registration.inviteRequired}
                  onChange={(event) => setRegistration("inviteRequired", event.currentTarget.checked)}
                />
                {language.t("settings.providers.onescience.admin.registration.inviteRequired")}
              </label>
              <TextField
                label={language.t("settings.providers.onescience.admin.registration.fixedCode")}
                value={registration.fixedCode}
                onChange={(value) => setRegistration("fixedCode", value)}
                placeholder={language.t("settings.providers.onescience.admin.registration.fixedCodePlaceholder")}
              />
              <div class="flex flex-col gap-1.5">
                <span class="text-12-medium text-text-weak">
                  {language.t("settings.providers.onescience.admin.registration.fixedTtl")}
                </span>
                <div class="flex flex-wrap gap-2">
                  <For each={[7, 14, 30] as const}>
                    {(days) => (
                      <Button
                        size="small"
                        variant={registration.fixedTtlDays === days ? "primary" : "secondary"}
                        disabled={busy()}
                        onClick={() => setRegistration("fixedTtlDays", days)}
                      >
                        {language.t("settings.providers.onescience.admin.registration.ttlDays", {
                          days: String(days),
                        })}
                      </Button>
                    )}
                  </For>
                </div>
                <Show when={registration.fixedExpiresAt > 0}>
                  <p class="text-12-regular text-text-weak m-0">
                    {language.t("settings.providers.onescience.admin.registration.fixedExpires", {
                      time: formatExpiry(registration.fixedExpiresAt),
                    })}
                  </p>
                </Show>
              </div>
              <div class="flex flex-col gap-2 rounded-lg border border-border-weak-base p-3">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-13-medium text-text-strong">
                    {language.t("settings.providers.onescience.admin.registration.randomTitle")}
                  </span>
                  <Button size="small" variant="secondary" disabled={busy()} onClick={() => void createRandomInviteCode()}>
                    {language.t("settings.providers.onescience.admin.registration.randomCreate")}
                  </Button>
                </div>
                <p class="text-12-regular text-text-weak m-0">
                  {language.t("settings.providers.onescience.admin.registration.randomHint")}
                </p>
                <Show when={registration.lastRandomCode}>
                  <div class="flex flex-col gap-1">
                    <code class="text-14-medium text-text-strong tracking-wide break-all">
                      {registration.lastRandomCode}
                    </code>
                    <span class="text-12-regular text-text-weak">
                      {language.t("settings.providers.onescience.admin.registration.randomExpires", {
                        time: formatExpiry(registration.lastRandomExpiresAt),
                      })}
                    </span>
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={busy()}
                      onClick={() =>
                        void copyText(
                          registration.lastRandomCode,
                          "settings.providers.onescience.admin.registration.copiedCode",
                        )
                      }
                    >
                      {language.t("settings.providers.onescience.admin.registration.copyCode")}
                    </Button>
                  </div>
                </Show>
                <Show when={registration.randomInvites.length > 0}>
                  <div class="flex flex-col gap-1 max-h-28 overflow-y-auto">
                    <For each={registration.randomInvites}>
                      {(item) => (
                        <div class="flex items-center justify-between gap-2 text-12-regular text-text-weak">
                          <code class="text-text-strong break-all">{item.code}</code>
                          <span class="shrink-0">{formatExpiry(item.expiresAt)}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>
            <div class="flex justify-end gap-2 pt-1">
              <Button variant="ghost" disabled={busy()} onClick={() => setStep("menu")}>
                {language.t("common.goBack")}
              </Button>
              <Button variant="primary" disabled={busy()} onClick={() => void saveRegistration()}>
                {language.t("common.save")}
              </Button>
            </div>
          </Match>

          <Match when={step() === "backends"}>
            <DialogSelectServer embedded />
          </Match>

          <Match when={step() === "model"}>
            <div class="flex flex-col gap-4 max-h-[min(60vh,480px)] overflow-y-auto pr-0.5">
              <TextField
                label={language.t("settings.providers.onescience.admin.providerName")}
                value={form.providerName}
                onChange={(value) => setForm("providerName", value)}
              />
              <TextField
                label={language.t("settings.providers.onescience.admin.baseURL")}
                value={form.baseURL}
                onChange={(value) => setForm("baseURL", value)}
              />
              <div class="flex flex-col gap-2">
                <TextField
                  label={language.t("settings.providers.onescience.admin.modelID")}
                  value={form.modelID}
                  onChange={(value) => setForm("modelID", value)}
                />
                <div class="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="small"
                    variant="secondary"
                    disabled={queryPending()}
                    onClick={() => void queryModels()}
                  >
                    {queryPending()
                      ? language.t("settings.providers.onescience.admin.models.query.loading")
                      : language.t("settings.providers.onescience.admin.models.query")}
                  </Button>
                </div>
                <Show when={queryError()}>
                  <p class="text-12-regular text-text-critical-base">{queryError()}</p>
                </Show>
                <Show when={discoveredCount() > 0}>
                  <div
                    class="flex flex-col gap-1 max-h-56 overflow-y-auto rounded-md border border-border-weak-base p-1.5 bg-background-base"
                    role="listbox"
                    aria-label={language.t("settings.providers.onescience.admin.models.query")}
                  >
                    <For each={discoveredModels()}>
                      {(id) => {
                        const selected = () => form.modelID === id
                        return (
                          <button
                            type="button"
                            role="option"
                            aria-selected={selected()}
                            data-selected={selected() ? "true" : undefined}
                            class="flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-raised-base-hover data-[selected=true]:bg-surface-base-active"
                            onClick={() => selectDiscoveredModel(id)}
                          >
                            <span
                              class="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-border-weak-base text-icon-base"
                              classList={{
                                "border-border-strong-base": selected(),
                              }}
                              aria-hidden="true"
                            >
                              <Show when={selected()}>
                                <span class="size-2 rounded-full bg-text-strong" />
                              </Show>
                            </span>
                            <span class="min-w-0 flex-1 text-13-regular text-text-strong break-all">{id}</span>
                          </button>
                        )
                      }}
                    </For>
                  </div>
                </Show>
              </div>
              <TextField
                label={language.t("settings.providers.onescience.admin.modelName")}
                value={form.modelName}
                onChange={(value) => setForm("modelName", value)}
              />
              <TextField
                type="password"
                label={language.t("settings.providers.onescience.admin.apiKey")}
                value={form.apiKey}
                onChange={(value) => setForm("apiKey", value)}
                placeholder={
                  form.hasApiKey
                    ? language.t("settings.providers.onescience.admin.apiKeyKeep")
                    : language.t("settings.providers.onescience.admin.apiKeyPlaceholder")
                }
              />
            </div>
            <div class="flex gap-2 justify-end pt-1">
              <Button variant="ghost" disabled={busy()} onClick={() => void reset()}>
                {language.t("settings.providers.onescience.admin.resetAction")}
              </Button>
              <Button variant="primary" disabled={busy()} onClick={() => void save()}>
                {language.t("common.save")}
              </Button>
            </div>
          </Match>
        </Switch>
      </div>
    </Dialog>
  )
}
