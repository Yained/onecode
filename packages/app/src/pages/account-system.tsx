import type { JSX } from "solid-js"
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Mark } from "@opencode-ai/ui/logo"
import { showToast } from "@opencode-ai/ui/toast"
import {
  changePlatformPassword,
  clearPlatformAuthSession,
  defaultPlatformProjectDirectory,
  deletePlatformAccount,
  fetchRegistrationGate,
  loginPlatformAccount,
  platformAuthCancelTarget,
  platformAuthRedirectTarget,
  registerPlatformAccount,
  resetPlatformPassword,
  requestPlatformPasswordReset,
  requestPlatformRegistrationEmail,
  resolvePlatformAuthSession,
  storePlatformAuthSession,
  storedPlatformAuthToken,
  type PlatformAuthSession,
} from "@/utils/platform-auth"
import { clearPendingAction } from "@/workbench/pending-action"

type AuthFormState = {
  name: string
  email: string
  password: string
  confirmPassword: string
  inviteCode?: string
  emailCode?: string
  submitting: boolean
  requestingCode?: boolean
  requestHint?: string
  cooldownUntil?: number
  error: string
  lockedUntil?: number
}

type PasswordFormState = {
  currentPassword: string
  newPassword: string
  confirmPassword: string
  submitting: boolean
  error: string
  success: string
}

export function LoginPage() {
  const platform = usePlatform()
  const navigate = useNavigate()
  const [nowTick, setNowTick] = createSignal(Date.now())
  const [form, setForm] = createStore<AuthFormState>({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    submitting: false,
    error: "",
  })

  onMount(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 250)
    onCleanup(() => window.clearInterval(timer))
  })

  const lockSec = createMemo(() => {
    const until = form.lockedUntil
    if (typeof until !== "number") return 0
    return Math.max(0, Math.ceil((until - nowTick()) / 1000))
  })
  const locked = createMemo(() => lockSec() > 0)

  // Drop stale lock copy once the countdown finishes (error text is a frozen "N 秒").
  createEffect(() => {
    const until = form.lockedUntil
    if (typeof until !== "number") return
    if (until > nowTick()) return
    setForm({ lockedUntil: undefined, error: "" })
  })

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    if (locked()) {
      setForm("error", `尝试次数过多，请在 ${lockSec()} 秒后重试`)
      return
    }
    if (!form.email.trim() || !form.password) {
      setForm("error", "请输入账户/邮箱和密码")
      return
    }
    setForm({ submitting: true, error: "" })
    try {
      await storePlatformAuthSession(await loginPlatformAccount({ email: form.email.trim(), password: form.password }), platform.storage)
      // Soft navigate — location.assign forces a full app reload and feels very slow.
      navigate(platformAuthRedirectTarget(location.search), { replace: true })
      return
    } catch (error) {
      const retryAfterMs = error instanceof Error && "retryAfterMs" in error ? Number((error as Error & { retryAfterMs?: number }).retryAfterMs) : undefined
      setForm({
        error: error instanceof Error ? error.message : "登录失败，请稍后重试",
        submitting: false,
        lockedUntil: typeof retryAfterMs === "number" && retryAfterMs > 0 ? Date.now() + retryAfterMs : undefined,
      })
    }
  }

  return (
    <AuthPageShell mode="login">
      <form class="os-auth-form" onSubmit={submit}>
        <label>
          <span>账户 / 邮箱</span>
          <input
            value={form.email}
            onInput={(event) => setForm("email", event.currentTarget.value)}
            autocomplete="username"
            placeholder="账户名或注册邮箱"
            disabled={form.submitting || locked()}
          />
        </label>
        <label>
          <span>密码</span>
          <input
            value={form.password}
            onInput={(event) => setForm("password", event.currentTarget.value)}
            autocomplete="current-password"
            type="password"
            placeholder="输入密码"
            disabled={form.submitting || locked()}
          />
        </label>
        <Show when={form.error || locked()}>
          <p class="os-auth-error">
            {locked() ? `尝试次数过多，请在 ${lockSec()} 秒后重试` : form.error}
          </p>
        </Show>
        <button disabled={form.submitting || locked()} type="submit" class="os-button os-button-primary os-auth-submit">
          {form.submitting ? "正在登录..." : locked() ? `请 ${lockSec()} 秒后重试` : "登录"}
        </button>
      </form>
      <div class="os-auth-links">
        <span>还没有账号？</span>
        <a href={`/register${location.search}`}>创建账号</a>
        <span class="os-auth-link-separator" aria-hidden="true" />
        <a href={`/forgot-password${location.search}`}>忘记密码？</a>
      </div>
    </AuthPageShell>
  )
}

export function RegisterPage() {
  const platform = usePlatform()
  const navigate = useNavigate()
  const [inviteRequired, setInviteRequired] = createSignal(false)
  const [emailVerificationRequired, setEmailVerificationRequired] = createSignal(false)
  const [emailCodeOptional, setEmailCodeOptional] = createSignal(false)
  const [nowTick, setNowTick] = createSignal(Date.now())
  const [form, setForm] = createStore<AuthFormState>({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    inviteCode: "",
    emailCode: "",
    submitting: false,
    requestingCode: false,
    requestHint: "",
    cooldownUntil: 0,
    error: "",
  })

  onMount(() => {
    void fetchRegistrationGate()
      .then((gate) => {
        setInviteRequired(Boolean(gate.inviteRequired))
        setEmailVerificationRequired(Boolean(gate.emailVerificationRequired))
      })
      .catch(() => {
        setInviteRequired(false)
        setEmailVerificationRequired(false)
      })
    const timer = window.setInterval(() => setNowTick(Date.now()), 250)
    onCleanup(() => window.clearInterval(timer))
  })

  const cooldownSec = createMemo(() => Math.max(0, Math.ceil(((form.cooldownUntil ?? 0) - nowTick()) / 1000)))
  const onCooldown = createMemo(() => cooldownSec() > 0)

  const requestCode = async () => {
    if (form.requestingCode || form.submitting || onCooldown()) return
    const emailError = validateEmailClient(form.email)
    if (emailError) {
      setForm({ error: emailError, requestHint: "" })
      return
    }
    setForm({ requestingCode: true, error: "", requestHint: "" })
    try {
      const result = await requestPlatformRegistrationEmail({ email: form.email.trim() })
      const retryAfterMs =
        typeof result.retryAfterMs === "number" && result.retryAfterMs > 0 ? result.retryAfterMs : 60_000
      if (result.smtpUnreachable) {
        setEmailCodeOptional(true)
        setForm({
          requestingCode: false,
          requestHint: "无法连接邮件服务器，本次注册无需填写验证码。找回密码仍须邮件验证，收不到验证码请联系管理员。",
          error: "",
          cooldownUntil: Date.now() + retryAfterMs,
        })
        return
      }
      setEmailCodeOptional(false)
      setForm({
        requestingCode: false,
        requestHint: "验证码已发送，请查收邮箱后填入下方。",
        error: "",
        cooldownUntil: Date.now() + retryAfterMs,
      })
    } catch (error) {
      const retryAfterMs =
        error instanceof Error && "retryAfterMs" in error
          ? Number((error as Error & { retryAfterMs?: number }).retryAfterMs)
          : undefined
      setForm({
        requestingCode: false,
        error: error instanceof Error ? error.message : "发送验证码失败，请稍后重试",
        requestHint: "",
        ...(typeof retryAfterMs === "number" && retryAfterMs > 0
          ? { cooldownUntil: Date.now() + retryAfterMs }
          : {}),
      })
    }
  }

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!form.name.trim() || !form.email.trim() || !form.password) {
      setForm("error", "请输入账户、邮箱和密码")
      return
    }
    const accountError = validateAccountSlugClient(form.name)
    if (accountError) {
      setForm("error", accountError)
      return
    }
    const emailError = validateEmailClient(form.email)
    if (emailError) {
      setForm("error", emailError)
      return
    }
    if (inviteRequired() && !(form.inviteCode ?? "").trim()) {
      setForm("error", "请填写邀请码")
      return
    }
    if (emailVerificationRequired() && !emailCodeOptional() && !(form.emailCode ?? "").trim()) {
      setForm("error", "请填写邮箱验证码")
      return
    }
    if (form.password.length < 8) {
      setForm("error", "密码至少需要 8 位")
      return
    }
    if (form.password !== form.confirmPassword) {
      setForm("error", "两次输入的密码不一致")
      return
    }
    setForm({ submitting: true, error: "" })
    try {
      await storePlatformAuthSession(
        await registerPlatformAccount({
          name: form.name.trim().toLowerCase(),
          email: form.email.trim(),
          password: form.password,
          ...(form.inviteCode?.trim() ? { inviteCode: form.inviteCode.trim() } : {}),
          ...(emailVerificationRequired() && form.emailCode?.trim()
            ? { emailCode: form.emailCode.trim() }
            : {}),
        }),
        platform.storage,
      )
      // Soft navigate — location.assign forces a full app reload and feels very slow.
      navigate(platformAuthRedirectTarget(location.search), { replace: true })
    } catch (error) {
      setForm("error", error instanceof Error ? error.message : "注册失败，请稍后重试")
      setForm("submitting", false)
    }
  }

  return (
    <AuthPageShell mode="register">
      <form class="os-auth-form" onSubmit={submit}>
        <label>
          <span>账户</span>
          <input
            value={form.name}
            onInput={(event) => setForm("name", event.currentTarget.value)}
            autocomplete="username"
            spellcheck={false}
            placeholder="例如 researcher01"
          />
          <small class="os-auth-hint">
            用作登录标识及个人工作区目录名称。长度 3–32 个字符，须以小写字母开头，仅可包含小写字母、数字、点（.）、下划线（_）与连字符（-）。
          </small>
        </label>
        <label>
          <span>邮箱</span>
          <input
            value={form.email}
            onInput={(event) => {
              setForm("email", event.currentTarget.value)
              setEmailCodeOptional(false)
            }}
            autocomplete="email"
            inputmode="email"
            placeholder="name@example.com"
            disabled={form.submitting || form.requestingCode}
          />
          <small class="os-auth-hint">用于账号找回与系统通知，亦可作为登录凭证。</small>
        </label>
        <Show when={emailVerificationRequired()}>
          <div class="os-auth-email-verify">
            <button
              type="button"
              class="os-button os-button-secondary os-auth-submit"
              disabled={form.requestingCode || form.submitting || onCooldown() || !form.email.trim()}
              onClick={() => void requestCode()}
            >
              {form.requestingCode
                ? "正在发送..."
                : onCooldown()
                  ? `重新发送 (${cooldownSec()}s)`
                  : "发送验证码"}
            </button>
            <Show when={form.requestHint}>
              <p class={emailCodeOptional() ? "os-auth-hint" : "os-account-success"}>{form.requestHint}</p>
            </Show>
            <label>
              <span>{emailCodeOptional() ? "邮箱验证码（可不填）" : "邮箱验证码"}</span>
              <input
                value={form.emailCode ?? ""}
                onInput={(event) => setForm("emailCode", event.currentTarget.value)}
                autocomplete="one-time-code"
                spellcheck={false}
                placeholder={emailCodeOptional() ? "邮件服务器不可达，可留空" : "输入邮件中的验证码"}
                disabled={form.submitting}
              />
            </label>
          </div>
        </Show>
        <Show when={inviteRequired()}>
          <label>
            <span>邀请码</span>
            <input
              value={form.inviteCode ?? ""}
              onInput={(event) => setForm("inviteCode", event.currentTarget.value)}
              autocomplete="one-time-code"
              spellcheck={false}
              placeholder="请输入邀请码"
            />
            <small class="os-auth-hint">当前已开启注册审核，需填写有效邀请码才能注册。</small>
          </label>
        </Show>
        <label>
          <span>密码</span>
          <input
            value={form.password}
            onInput={(event) => setForm("password", event.currentTarget.value)}
            autocomplete="new-password"
            type="password"
            placeholder="至少 8 位"
          />
        </label>
        <label>
          <span>确认密码</span>
          <input
            value={form.confirmPassword}
            onInput={(event) => setForm("confirmPassword", event.currentTarget.value)}
            autocomplete="new-password"
            type="password"
            placeholder="再次输入密码"
          />
        </label>
        <Show when={form.error}>
          <p class="os-auth-error">{form.error}</p>
        </Show>
        <button disabled={form.submitting} type="submit" class="os-button os-button-primary os-auth-submit">
          {form.submitting ? "正在创建..." : "创建账号"}
        </button>
      </form>
      <div class="os-auth-links">
        <span>已有账号？</span>
        <a href={`/login${location.search}`}>去登录</a>
      </div>
    </AuthPageShell>
  )
}

export function ForgotPasswordPage() {
  const navigate = useNavigate()
  const initialToken =
    typeof location !== "undefined" ? new URLSearchParams(location.search).get("token")?.trim() ?? "" : ""
  const adminLinkMode = Boolean(initialToken)
  const [nowTick, setNowTick] = createSignal(Date.now())
  const [form, setForm] = createStore({
    email: "",
    token: initialToken,
    newPassword: "",
    confirmPassword: "",
    requesting: false,
    submitting: false,
    error: "",
    success: "",
    requestHint: "",
    cooldownUntil: 0,
  })

  onMount(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 250)
    onCleanup(() => window.clearInterval(timer))
  })

  const cooldownSec = createMemo(() => Math.max(0, Math.ceil((form.cooldownUntil - nowTick()) / 1000)))
  const onCooldown = createMemo(() => cooldownSec() > 0)

  const requestCode = async () => {
    if (form.requesting || form.submitting || onCooldown()) return
    if (!form.email.trim()) {
      setForm({ error: "请输入账号邮箱", success: "", requestHint: "" })
      return
    }
    setForm({ requesting: true, error: "", success: "", requestHint: "" })
    try {
      const result = await requestPlatformPasswordReset({ email: form.email.trim() })
      const retryAfterMs =
        typeof result.retryAfterMs === "number" && result.retryAfterMs > 0 ? result.retryAfterMs : 60_000
      setForm({
        requesting: false,
        requestHint: "若该邮箱已注册，验证码将发送至邮箱。请查收后在下方完成重置。",
        error: "",
        cooldownUntil: Date.now() + retryAfterMs,
      })
    } catch (error) {
      const retryAfterMs =
        error instanceof Error && "retryAfterMs" in error
          ? Number((error as Error & { retryAfterMs?: number }).retryAfterMs)
          : undefined
      setForm({
        requesting: false,
        error: error instanceof Error ? error.message : "发送验证码失败，请稍后重试",
        requestHint: "",
        ...(typeof retryAfterMs === "number" && retryAfterMs > 0
          ? { cooldownUntil: Date.now() + retryAfterMs }
          : {}),
      })
    }
  }

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!form.token.trim()) {
      setForm({ error: "请输入邮件验证码", success: "" })
      return
    }
    if (form.newPassword.length < 8) {
      setForm({ error: "新密码至少需要 8 位", success: "" })
      return
    }
    if (form.newPassword !== form.confirmPassword) {
      setForm({ error: "两次输入的新密码不一致", success: "" })
      return
    }
    setForm({ submitting: true, error: "", success: "" })
    try {
      await resetPlatformPassword({
        token: form.token.trim(),
        newPassword: form.newPassword,
      })
      setForm({
        submitting: false,
        error: "",
        success: "密码已重置，请使用新密码登录",
        newPassword: "",
        confirmPassword: "",
      })
      const params = new URLSearchParams(location.search)
      params.delete("token")
      const query = params.toString()
      window.setTimeout(() => navigate(`/login${query ? `?${query}` : ""}`, { replace: true }), 1200)
    } catch (error) {
      setForm({
        submitting: false,
        error: error instanceof Error ? error.message : "重置密码失败，请稍后重试",
        success: "",
      })
    }
  }

  return (
    <AuthPageShell mode="forgot-password">
      <Show
        when={!adminLinkMode}
        fallback={
          <p class="os-auth-hint" style={{ margin: "0 0 0.35rem" }}>
            请设置新密码以完成重置。
          </p>
        }
      >
        <p class="os-auth-hint" style={{ margin: "0 0 0.35rem" }}>
          通过注册邮箱获取验证码后重置密码。若无法收到邮件，请联系管理员。
        </p>
      </Show>

      <Show when={!adminLinkMode}>
        <form
          class="os-auth-form"
          onSubmit={(event) => {
            event.preventDefault()
            void requestCode()
          }}
        >
          <label>
            <span>账号邮箱</span>
            <input
              value={form.email}
              onInput={(event) => setForm("email", event.currentTarget.value)}
              autocomplete="email"
              inputmode="email"
              placeholder="name@example.com"
              disabled={form.requesting || form.submitting}
            />
          </label>
          <button
            disabled={form.requesting || form.submitting || onCooldown() || !form.email.trim()}
            type="submit"
            class="os-button os-button-secondary os-auth-submit"
          >
            {form.requesting
              ? "正在发送..."
              : onCooldown()
                ? `重新发送 (${cooldownSec()}s)`
                : "获取验证码"}
          </button>
          <Show when={form.requestHint}>
            <p class="os-account-success">{form.requestHint}</p>
          </Show>
        </form>
      </Show>

      <form class="os-auth-form" onSubmit={submit}>
        <Show when={!adminLinkMode}>
          <label>
            <span>邮件验证码</span>
            <input
              value={form.token}
              onInput={(event) => setForm("token", event.currentTarget.value)}
              autocomplete="one-time-code"
              placeholder="输入邮件中的验证码"
              disabled={form.submitting}
            />
          </label>
        </Show>
        <label>
          <span>新密码</span>
          <input
            value={form.newPassword}
            onInput={(event) => setForm("newPassword", event.currentTarget.value)}
            autocomplete="new-password"
            type="password"
            placeholder="至少 8 位"
            disabled={form.submitting}
          />
        </label>
        <label>
          <span>确认新密码</span>
          <input
            value={form.confirmPassword}
            onInput={(event) => setForm("confirmPassword", event.currentTarget.value)}
            autocomplete="new-password"
            type="password"
            placeholder="再次输入新密码"
            disabled={form.submitting}
          />
        </label>
        <Show when={form.error}>
          <p class="os-auth-error">{form.error}</p>
        </Show>
        <Show when={form.success}>
          <p class="os-account-success">{form.success}</p>
        </Show>
        <button disabled={form.submitting} type="submit" class="os-button os-button-primary os-auth-submit">
          {form.submitting ? "正在重置..." : "重置密码"}
        </button>
      </form>

      <div class="os-auth-links">
        <a href={`/login${location.search}`}>返回登录</a>
        <span class="os-auth-link-separator" aria-hidden="true" />
        <a href={`/register${location.search}`}>创建账号</a>
      </div>
    </AuthPageShell>
  )
}

export function AccountCenterPage() {
  const platform = usePlatform()
  const navigate = useNavigate()
  const language = useLanguage()
  const dialog = useDialog()
  const [state, setState] = createStore<{
    session?: PlatformAuthSession
    loading: boolean
    error: string
  }>({
    loading: true,
    error: "",
  })
  const [passwordForm, setPasswordForm] = createStore<PasswordFormState>({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
    submitting: false,
    error: "",
    success: "",
  })

  onMount(() => {
    const token = storedPlatformAuthToken()
    if (!token) {
      setState({ loading: false, error: "当前未登录" })
      return
    }
    void resolvePlatformAuthSession(token)
      .then((session) => setState({ session, loading: false, error: "" }))
      .catch((error) => setState({ loading: false, error: error instanceof Error ? error.message : "会话已失效" }))
  })

  const goLogin = () => {
    if (platform.platform === "desktop") {
      navigate("/login", { replace: true })
      return
    }
    location.assign("/login")
  }

  const logout = () => {
    void clearPlatformAuthSession(platform.storage).finally(() => goLogin())
  }

  const deleteAccount = async () => {
    try {
      await deletePlatformAccount()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("account.deleteAccount.toast.success"),
      })
      await clearPlatformAuthSession(platform.storage)
      goLogin()
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("account.deleteAccount.toast.error"),
        description: error instanceof Error ? error.message : "请稍后重试",
      })
    }
  }

  const changePassword = async (event: SubmitEvent, session: PlatformAuthSession) => {
    event.preventDefault()
    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      setPasswordForm({ error: "请输入当前密码和新密码", success: "" })
      return
    }
    if (passwordForm.newPassword.length < 8) {
      setPasswordForm({ error: "新密码至少需要 8 位", success: "" })
      return
    }
    if (passwordForm.currentPassword === passwordForm.newPassword) {
      setPasswordForm({ error: "新密码不能与当前密码相同", success: "" })
      return
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordForm({ error: "两次输入的新密码不一致", success: "" })
      return
    }
    setPasswordForm({ submitting: true, error: "", success: "" })
    try {
      await changePlatformPassword({
        accountId: session.account.id,
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      })
      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
        submitting: false,
        error: "",
        success: "密码已更新，下次登录请使用新密码",
      })
    } catch (error) {
      setPasswordForm({
        submitting: false,
        error: error instanceof Error ? error.message : "修改密码失败，请稍后重试",
        success: "",
      })
    }
  }

  return (
    <main class="os-account-page">
      <div class="os-account-shell">
        <Show
          when={!state.loading}
          fallback={
            <section class="os-account-loading">
              <strong>正在加载账号信息</strong>
              <span>请稍候</span>
            </section>
          }
        >
          <Show
            when={state.session}
            fallback={
              <section class="os-account-empty-state">
                <strong>{state.error || "当前未登录"}</strong>
                <span>登录后可以查看账号资料和开发空间。</span>
                <a
                  href={`/login?redirect=${encodeURIComponent("/account")}`}
                  class="os-button os-button-primary"
                >
                  去登录
                </a>
              </section>
            }
          >
            {(session) => (
              <>
                <header class="os-account-header">
                  <div class="os-account-identity">
                    <div class="os-account-avatar">{accountInitials(session().account.name, session().account.email)}</div>
                    <div>
                      <span class="os-account-kicker">账号中心</span>
                      <h1>{session().account.name}</h1>
                      <p>{session().account.email}</p>
                    </div>
                  </div>
                  <div class="os-account-actions">
                    <span class="os-account-status">{accountStatusLabel(session().account.status)}</span>
                    <a href="/code" class="os-button os-button-secondary">
                      进入科研开发
                    </a>
                    <button type="button" class="os-button os-button-danger" onClick={logout}>
                      退出登录
                    </button>
                    <button
                      type="button"
                      class="os-button os-button-danger"
                      onClick={() =>
                        dialog.show(() => <DeleteAccountDialog onConfirm={deleteAccount} />)
                      }
                    >
                      {language.t("account.deleteAccount.button")}
                    </button>
                  </div>
                </header>

                <section class="os-account-workspace-hero">
                  <div class="os-account-workspace-hero-copy">
                    <span class="os-account-kicker">默认项目</span>
                    <strong>default</strong>
                    <p>{language.t("account.defaultProject.description")}</p>
                  </div>
                  <div class="os-account-workspace-hero-meta">
                    <code title={primaryProjectPath(session())}>{primaryProjectPath(session()) || "未分配"}</code>
                  </div>
                </section>

                <section class="os-account-content-grid">
                  <section class="os-account-panel">
                    <div class="os-account-panel-head">
                      <strong>基本资料</strong>
                      <span
                        class="os-account-session-expiry"
                        title="这是当前浏览器登录会话的有效期（约 14 天），不是账号本身到期。重新登录即可续期，账号与工作区数据不受影响。"
                      >
                        登录会话 {expiresInText(session().expiresAt)}失效
                      </span>
                    </div>
                    <p class="os-account-session-expiry-note">
                      提示：上方倒计时是登录会话有效期，重新登录即可续期；账号与工作区数据不会因此删除。
                    </p>
                    <dl class="os-account-field-grid">
                      <div>
                        <dt>账户</dt>
                        <dd>{session().account.name}</dd>
                      </div>
                      <div>
                        <dt>邮箱</dt>
                        <dd>{session().account.email}</dd>
                      </div>
                      <div>
                        <dt>创建时间</dt>
                        <dd>{formatDateTime(session().account.timeCreated)}</dd>
                      </div>
                      <div>
                        <dt>默认入口</dt>
                        <dd>科研开发工作台</dd>
                      </div>
                    </dl>
                  </section>

                  <section class="os-account-panel">
                    <div class="os-account-panel-head">
                      <strong>修改密码</strong>
                      <span>本地账号</span>
                    </div>
                    <form class="os-account-password-form" onSubmit={(event) => changePassword(event, session())}>
                      <label>
                        <span>当前密码</span>
                        <input
                          value={passwordForm.currentPassword}
                          onInput={(event) => setPasswordForm("currentPassword", event.currentTarget.value)}
                          autocomplete="current-password"
                          type="password"
                          placeholder="输入当前密码"
                        />
                      </label>
                      <label>
                        <span>新密码</span>
                        <input
                          value={passwordForm.newPassword}
                          onInput={(event) => setPasswordForm("newPassword", event.currentTarget.value)}
                          autocomplete="new-password"
                          type="password"
                          placeholder="至少 8 位"
                        />
                      </label>
                      <label>
                        <span>确认新密码</span>
                        <input
                          value={passwordForm.confirmPassword}
                          onInput={(event) => setPasswordForm("confirmPassword", event.currentTarget.value)}
                          autocomplete="new-password"
                          type="password"
                          placeholder="再次输入新密码"
                        />
                      </label>
                      <Show when={passwordForm.error}>
                        <p class="os-auth-error">{passwordForm.error}</p>
                      </Show>
                      <Show when={passwordForm.success}>
                        <p class="os-account-success">{passwordForm.success}</p>
                      </Show>
                      <button disabled={passwordForm.submitting} type="submit" class="os-button os-button-danger os-auth-submit">
                        {passwordForm.submitting ? "正在更新..." : "更新密码"}
                      </button>
                    </form>
                  </section>
                </section>
              </>
            )}
          </Show>
        </Show>
      </div>
    </main>
  )
}

function DeleteAccountDialog(props: { onConfirm: () => Promise<void> }) {
  const language = useLanguage()
  const dialog = useDialog()
  const [state, setState] = createStore({ submitting: false, error: "" })

  const onConfirm = async () => {
    setState({ submitting: true, error: "" })
    try {
      await props.onConfirm()
      dialog.close()
    } catch (error) {
      setState({ submitting: false, error: error instanceof Error ? error.message : language.t("account.deleteAccount.toast.error") })
    }
  }

  return (
    <Dialog title={language.t("account.deleteAccount.title")} fit transition>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <p class="text-14-regular text-text-strong">{language.t("account.deleteAccount.description")}</p>
        <Show when={state.error}>
          <p class="os-auth-error">{state.error}</p>
        </Show>
        <div class="flex justify-end gap-2">
          <button type="button" class="os-button os-button-secondary" onClick={() => dialog.close()} disabled={state.submitting}>
            {language.t("common.cancel")}
          </button>
          <button type="button" class="os-button os-button-danger" onClick={onConfirm} disabled={state.submitting}>
            {state.submitting ? "注销中..." : language.t("account.deleteAccount.confirm")}
          </button>
        </div>
      </div>
    </Dialog>
  )
}

function AuthPageShell(props: { mode: "login" | "register" | "forgot-password"; children: JSX.Element }) {
  const navigate = useNavigate()

  const dismiss = () => {
    clearPendingAction()
    // Soft navigate — location.assign forces a full app reload and feels very slow.
    navigate(platformAuthCancelTarget(location.search), { replace: true })
  }

  return (
    <main class="os-auth-page">
      <section class="os-auth-shell" data-mode={props.mode}>
        <button type="button" class="os-auth-dismiss" onClick={dismiss} aria-label="关闭并返回浏览">
          <span aria-hidden="true">×</span>
        </button>
        <section class="os-auth-panel">
          <a class="os-auth-brand" href="/">
            <Mark />
          </a>
          {props.children}
          <div class="os-auth-links">
            <button type="button" class="os-auth-link-button" onClick={dismiss}>
              暂不登录，继续浏览
            </button>
          </div>
        </section>
      </section>
    </main>
  )
}

function accountInitials(name: string, email: string) {
  return (name.trim() || email.trim() || "OS").slice(0, 2).toUpperCase()
}

function accountStatusLabel(status: string) {
  if (status === "active") return "正常"
  if (status === "frozen") return "已冻结"
  if (status === "limited") return "已限流"
  if (status === "pending") return "待激活"
  return status || "未知"
}

function workspaceRoleLabel(role?: string) {
  if (role === "owner") return "空间所有者"
  if (role === "admin") return "空间管理员"
  if (role === "viewer") return "只读成员"
  return "成员"
}

function primaryProjectPath(session: PlatformAuthSession) {
  return defaultPlatformProjectDirectory(session) ?? ""
}

function formatDateTime(value?: number) {
  if (!value) return "未记录"
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(normalizeTimestamp(value)))
}

function expiresInText(expiresAt: number) {
  const hours = Math.ceil(Math.max(0, normalizeTimestamp(expiresAt) - Date.now()) / 3_600_000)
  if (hours <= 0) return "已"
  if (hours < 24) return `${hours} 小时后`
  return `${Math.ceil(hours / 24)} 天后`
}

/** Client-side mirror of server account-slug rules (folder-safe login name). */
function validateAccountSlugClient(input: string) {
  const slug = input.trim().toLowerCase()
  if (!slug) return "请填写账户名"
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(slug)) {
    return "账户名须为 3–32 位，以小写字母开头，仅含小写字母、数字、点、下划线或连字符"
  }
  if (slug.includes("..") || slug.endsWith(".") || slug.startsWith(".")) {
    return "账户名不能以点开头/结尾，也不能包含连续的点"
  }
  return ""
}

function validateEmailClient(input: string) {
  const email = input.trim().toLowerCase()
  if (!email) return "请填写有效邮箱"
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return "请填写有效邮箱"
  return ""
}

function formatRetryAfter(ms: number) {
  const seconds = Math.max(1, Math.ceil(ms / 1000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  return "1 小时"
}

function normalizeTimestamp(value: number) {
  return value < 10_000_000_000 ? value * 1_000 : value
}
