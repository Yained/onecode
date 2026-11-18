import { Database } from "@/storage/db"
import { deleteAccountCatalog } from "@/onescience/data-catalog-account"
import { and, desc, eq, isNull, like, or, sql } from "drizzle-orm"
import { Global } from "@opencode-ai/core/global"
import { OneCodeExtraPath } from "@opencode-ai/core/extra-path"
import { OneScienceCodeDefaultDirectory } from "@opencode-ai/core/onescience-code-default-directory"
import { Context, Schema } from "effect"
import { createHash, pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { which } from "@/util/which"
import {
  PlatformAccountTable,
  PlatformAuthIdentityTable,
  PlatformAuthSessionTable,
  PlatformPasswordCredentialTable,
  PlatformPasswordResetTokenTable,
  PlatformResourceQuotaTable,
  PlatformResourceUsageTable,
  PlatformWorkspaceMemberTable,
  PlatformWorkspaceTable,
} from "./platform-auth.sql"
import { ProjectTable } from "@/project/project.sql"
import { ProjectID } from "@/project/schema"
import { isMailAvailable, isMailConfigured, MAIL_NOT_CONFIGURED_MESSAGE, resolveMailConfig } from "@/messaging/mail-config"
import { isSmtpUnreachableError, sendMail } from "@/messaging/smtp"
import { assertAndConsumeInviteSync } from "./registration-config"

const SESSION_TTL = 1000 * 60 * 60 * 24 * 14
const DEFAULT_PROJECT_NAME = "default"
export const INVALID_CREDENTIALS_MESSAGE = "账号或密码错误"
export const ACCOUNT_FROZEN_MESSAGE = "账户被冻结，请联系管理员"
export const PASSWORD_RESET_UNAVAILABLE_MESSAGE = "密码找回功能完善中，暂不可用"
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000
export const PASSWORD_RESET_REQUEST_COOLDOWN_MS = 60_000
export const INVALID_RESET_TOKEN_MESSAGE = "重置码无效或已过期"
export const PASSWORD_RESET_RATE_LIMIT_MESSAGE = "请求过于频繁，请稍后再试"
export const REGISTRATION_EMAIL_TTL_MS = PASSWORD_RESET_TTL_MS
export const REGISTRATION_EMAIL_REQUEST_COOLDOWN_MS = PASSWORD_RESET_REQUEST_COOLDOWN_MS
export const INVALID_REGISTRATION_EMAIL_CODE_MESSAGE = "邮箱验证码无效或已过期"
export const REGISTRATION_EMAIL_REQUIRED_MESSAGE = "请先获取并填写邮箱验证码"
export const PASSWORD_RESET_SMTP_UNREACHABLE_MESSAGE = "无法连接邮件服务器，暂时无法发送重置验证码。收不到验证码则无法重置密码，请联系管理员。"
export const PROVISION_PASSWORD_MISMATCH_MESSAGE = "账号已存在但密码不匹配"
export const PROVISION_IDENTITY_CONFLICT_MESSAGE = "账号已存在但用户名或邮箱不一致"
export const PROVISION_TOKEN_REQUIRED_MESSAGE = "缺少 provision token"
export const PROVISION_TOKEN_INVALID_MESSAGE = "provision token 无效"
/** Request header for optional shared secret when `ONECODE_PROVISION_TOKEN` is set. */
export const PROVISION_TOKEN_HEADER = "x-onecode-provision-token"
const RESET_TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

export const AccountStatus = Schema.Union([
  Schema.Literal("active"),
  Schema.Literal("limited"),
  Schema.Literal("frozen"),
])
export type AccountStatus = typeof AccountStatus.Type
export const WorkspaceRole = Schema.Union([Schema.Literal("admin"), Schema.Literal("member")])

export const RegisterPayload = Schema.Struct({
  email: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  password: Schema.NonEmptyString,
  inviteCode: Schema.optional(Schema.String),
  /** Required when SMTP is available, unless a prior registration send timed out for this email. */
  emailCode: Schema.optional(Schema.String),
})
export type RegisterPayload = typeof RegisterPayload.Type

/** Embedded / platform provisioning: no invite or email verification gate. */
export const ProvisionPayload = Schema.Struct({
  email: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  password: Schema.NonEmptyString,
})
export type ProvisionPayload = typeof ProvisionPayload.Type

export const RequestRegistrationEmailPayload = Schema.Struct({
  email: Schema.NonEmptyString,
})
export type RequestRegistrationEmailPayload = typeof RequestRegistrationEmailPayload.Type

export const RegistrationEmailRequest = Schema.Struct({
  requested: Schema.Boolean,
  retryAfterMs: Schema.optional(Schema.Number),
  /** Set when SMTP connect/read timed out; register may omit emailCode for this email. */
  smtpUnreachable: Schema.optional(Schema.Boolean),
})
export type RegistrationEmailRequest = typeof RegistrationEmailRequest.Type

export const SetAccountStatusPayload = Schema.Struct({
  accountId: Schema.NonEmptyString,
  status: Schema.Union([Schema.Literal("active"), Schema.Literal("frozen")]),
})
export type SetAccountStatusPayload = typeof SetAccountStatusPayload.Type

export const AdminDeleteAccountPayload = Schema.Struct({
  accountId: Schema.NonEmptyString,
})
export type AdminDeleteAccountPayload = typeof AdminDeleteAccountPayload.Type

/** `email` accepts either the registered account name or email address. */
export const LoginPayload = Schema.Struct({
  email: Schema.NonEmptyString,
  password: Schema.NonEmptyString,
})
export type LoginPayload = typeof LoginPayload.Type

export const ChangePasswordPayload = Schema.Struct({
  accountId: Schema.NonEmptyString,
  currentPassword: Schema.NonEmptyString,
  newPassword: Schema.NonEmptyString,
})
export type ChangePasswordPayload = typeof ChangePasswordPayload.Type

export const RequestPasswordResetPayload = Schema.Struct({
  email: Schema.NonEmptyString,
})
export type RequestPasswordResetPayload = typeof RequestPasswordResetPayload.Type

export const PasswordResetRequest = Schema.Struct({
  requested: Schema.Boolean,
  resetToken: Schema.optional(Schema.String),
  expiresAt: Schema.optional(Schema.Number),
  retryAfterMs: Schema.optional(Schema.Number),
})
export type PasswordResetRequest = typeof PasswordResetRequest.Type

export const ResetPasswordPayload = Schema.Struct({
  token: Schema.NonEmptyString,
  newPassword: Schema.NonEmptyString,
})
export type ResetPasswordPayload = typeof ResetPasswordPayload.Type

export const AdminPasswordResetPayload = Schema.Struct({
  accountId: Schema.NonEmptyString,
})
export type AdminPasswordResetPayload = typeof AdminPasswordResetPayload.Type

export const AdminPasswordResetResult = Schema.Struct({
  accountId: Schema.String,
  resetToken: Schema.String,
  expiresAt: Schema.Number,
})
export type AdminPasswordResetResult = typeof AdminPasswordResetResult.Type

export const CreateUsagePayload = Schema.Struct({
  workspaceId: Schema.NonEmptyString,
  accountId: Schema.NonEmptyString,
  resourceType: Schema.NonEmptyString,
  amount: Schema.Number,
  unit: Schema.NonEmptyString,
  sourceId: Schema.optional(Schema.String),
  sourceType: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})
export type CreateUsagePayload = typeof CreateUsagePayload.Type

export const UpdateQuotaPayload = Schema.Struct({
  workspaceId: Schema.NonEmptyString,
  accountId: Schema.optional(Schema.String),
  cpuLimit: Schema.optional(Schema.Number),
  memoryLimitMb: Schema.optional(Schema.Number),
  gpuLimit: Schema.optional(Schema.Number),
  storageLimitMb: Schema.optional(Schema.Number),
  sessionLimit: Schema.optional(Schema.Number),
  monthlyTokenLimit: Schema.optional(Schema.Number),
  monthlyCostLimit: Schema.optional(Schema.Number),
})
export type UpdateQuotaPayload = typeof UpdateQuotaPayload.Type

export const Account = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
  status: Schema.String,
  avatarUrl: Schema.optional(Schema.String),
  timeCreated: Schema.Number,
  timeUpdated: Schema.optional(Schema.Number),
})
export type Account = typeof Account.Type

export const Workspace = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  defaultEnvPath: Schema.String,
  ownerAccountId: Schema.optional(Schema.String),
  role: Schema.optional(Schema.String),
})
export type Workspace = typeof Workspace.Type

export const AuthIdentity = Schema.Struct({
  id: Schema.String,
  provider: Schema.String,
  subject: Schema.String,
  accountId: Schema.String,
  email: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
})

export const Quota = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  accountId: Schema.optional(Schema.String),
  cpuLimit: Schema.optional(Schema.Number),
  memoryLimitMb: Schema.optional(Schema.Number),
  gpuLimit: Schema.optional(Schema.Number),
  storageLimitMb: Schema.optional(Schema.Number),
  sessionLimit: Schema.optional(Schema.Number),
  monthlyTokenLimit: Schema.optional(Schema.Number),
  monthlyCostLimit: Schema.optional(Schema.Number),
})

export const Usage = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  accountId: Schema.String,
  resourceType: Schema.String,
  amount: Schema.Number,
  unit: Schema.String,
  sourceId: Schema.optional(Schema.String),
  sourceType: Schema.optional(Schema.String),
  timeCreated: Schema.Number,
})

export const AuthSession = Schema.Struct({
  token: Schema.String,
  expiresAt: Schema.Number,
  account: Account,
  workspaces: Schema.Array(Workspace),
  capabilities: Schema.Struct({
    terminal: Schema.Boolean,
    terminalIsolation: Schema.optional(Schema.String),
    terminalUnavailableReason: Schema.optional(Schema.String),
    terminalUnavailableDetail: Schema.optional(Schema.String),
    terminalInstallFamily: Schema.optional(Schema.String),
    terminalInstallCommands: Schema.optional(Schema.Array(Schema.String)),
    sharedCasesRoot: Schema.optional(Schema.String),
  }),
})
export type AuthSession = typeof AuthSession.Type

/** Provision response: AuthSession plus whether a new account was created. */
export const ProvisionResult = Schema.Struct({
  ...AuthSession.fields,
  created: Schema.Boolean,
})
export type ProvisionResult = typeof ProvisionResult.Type

export type CurrentSessionInfo = {
  readonly session?: AuthSession
  readonly serverAdmin?: boolean
  readonly catalogToken?: { accountId: string; workspaceId: string }
}

export class CurrentSession extends Context.Service<CurrentSession, CurrentSessionInfo>()(
  "@opencode/PlatformAuth/CurrentSession",
) {}

export const AccountDetail = Schema.Struct({
  account: Account,
  identities: Schema.Array(AuthIdentity),
  workspaces: Schema.Array(Workspace),
  quotas: Schema.Array(Quota),
  usage: Schema.Array(Usage),
})

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

/** Basic RFC-ish email shape check used for register / reset / login identifiers with `@`. */
export function assertValidEmail(email: string) {
  const normalized = normalizeEmail(email)
  if (!normalized) throw new Error("请填写有效邮箱")
  // Keep intentionally simple: local@domain.tld, no spaces, one @.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("请填写有效邮箱")
  if (normalized.length > 254) throw new Error("请填写有效邮箱")
  return normalized
}

function now() {
  return Date.now()
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex")
  const iterations = 120_000
  const digest = pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex")
  return `pbkdf2-sha256$${iterations}$${salt}$${digest}`
}

function verifyPassword(password: string, stored: string) {
  const [scheme, iterationsRaw, salt, digest] = stored.split("$")
  if (scheme !== "pbkdf2-sha256" || !iterationsRaw || !salt || !digest) return false
  const computed = pbkdf2Sync(password, salt, Number(iterationsRaw), 32, "sha256")
  const expected = Buffer.from(digest, "hex")
  if (computed.length !== expected.length) return false
  return timingSafeEqual(computed, expected)
}

function sessionToken() {
  return randomBytes(32).toString("base64url")
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

export function normalizeResetToken(token: string) {
  return token.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
}

function generateResetToken() {
  const bytes = randomBytes(8)
  let out = ""
  for (const byte of bytes) out += RESET_TOKEN_ALPHABET[byte % RESET_TOKEN_ALPHABET.length]
  return `${out.slice(0, 4)}-${out.slice(4)}`
}

function formatResetToken(normalized: string) {
  if (normalized.length === 8) return `${normalized.slice(0, 4)}-${normalized.slice(4)}`
  return normalized
}

const ACCOUNT_SLUG_RE = /^[a-z][a-z0-9._-]{2,31}$/
const RESERVED_ACCOUNT_SLUGS = new Set([
  "admin",
  "administrator",
  "api",
  "case",
  "code",
  "data",
  "guest",
  "login",
  "null",
  "register",
  "root",
  "shared",
  "system",
  "testcase",
  "tmp",
  "undefined",
  "user",
  "workspace",
  "workspaces",
])

/** Normalize registration「账户」into a workspace directory slug (lowercase, folder-safe). */
export function normalizeAccountSlug(input: string) {
  return input.trim().toLowerCase()
}

/** Validate that an account can be used as a unique workspace folder name. */
export function assertValidAccountSlug(input: string): string {
  const slug = normalizeAccountSlug(input)
  if (!slug) throw new Error("请填写账户名")
  if (!ACCOUNT_SLUG_RE.test(slug)) {
    throw new Error("账户名须为 3–32 位，以小写字母开头，仅含小写字母、数字、点、下划线或连字符")
  }
  if (slug.includes("..") || slug.endsWith(".") || slug.startsWith(".")) {
    throw new Error("账户名不能以点开头/结尾，也不能包含连续的点")
  }
  if (RESERVED_ACCOUNT_SLUGS.has(slug)) {
    throw new Error("该账户名为系统保留名，请更换")
  }
  // Windows reserved device names (even on Linux hosts we avoid them for portability).
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/.test(slug)) {
    throw new Error("该账户名为系统保留名，请更换")
  }
  return slug
}

function joinWorkspaceDirectory(root: string, name: string) {
  const base = root.trim().replace(/\\/g, "/").replace(/\/+$/, "")
  if (!base) return name
  return `${base}/${name.replace(/^\/+/, "")}`
}

function defaultProjectDirectoryForWorkspace(workspace: Workspace) {
  return joinWorkspaceDirectory(workspace.defaultEnvPath, DEFAULT_PROJECT_NAME)
}

function createDefaultProjectForWorkspace(workspace: Workspace) {
  const projectDir = defaultProjectDirectoryForWorkspace(workspace)
  const projectId = ProjectID.make(`proj-${workspace.id}-default`)
  const created = now()
  try {
    fs.mkdirSync(projectDir, { recursive: true })
  } catch {
    // best-effort: directory may already exist
  }
  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectId,
        worktree: projectDir,
        vcs: null,
        name: DEFAULT_PROJECT_NAME,
        sandboxes: [],
        time_created: created,
        time_updated: created,
      })
      .onConflictDoUpdate({
        target: ProjectTable.id,
        set: {
          worktree: projectDir,
          name: DEFAULT_PROJECT_NAME,
          time_updated: created,
        },
      })
      .run()
  })
}

function removeWorkspaceDirectoryTree(directory: string) {
  try {
    fs.rmSync(directory, { recursive: true, force: true })
  } catch {
    // best-effort cleanup after failed registration
  }
}

function findAccountByLogin(identifier: string) {
  const raw = identifier.trim()
  if (!raw) return undefined
  if (raw.includes("@")) {
    const email = normalizeEmail(raw)
    return Database.use((db) =>
      db
        .select()
        .from(PlatformAccountTable)
        .where(and(eq(PlatformAccountTable.email, email), isNull(PlatformAccountTable.time_deleted)))
        .get(),
    )
  }
  const slug = normalizeAccountSlug(raw)
  return Database.use((db) =>
    db
      .select()
      .from(PlatformAccountTable)
      .where(and(sql`lower(${PlatformAccountTable.name}) = ${slug}`, isNull(PlatformAccountTable.time_deleted)))
      .get(),
  )
}

/**
 * Resolve ~/privated_data/workspaces without nesting when HOME was remapped into an
 * account workspace (terminal isolation sets HOME to the workspace root).
 */
function resolveHomeForWorkspaceFallback() {
  // Prefer HOME when set so sandboxed shells (and tests) are honored over os.homedir().
  // Do not path.resolve(): on Windows that turns "/data/..." into "D:/data/...".
  const raw = process.env.HOME?.trim() || os.homedir()
  return raw.replaceAll("\\", "/").replace(/\/+$/, "") || "/"
}

function fallbackWorkspaceEnvRoot() {
  const home = resolveHomeForWorkspaceFallback()
  const marker = "/privated_data/workspaces"
  const at = home.indexOf(marker)
  if (at >= 0) {
    // HOME is .../privated_data/workspaces[/slug[/.home|/project/...]]
    return home.slice(0, at + marker.length)
  }
  if (home.endsWith("/privated_data")) {
    return `${home}/workspaces`
  }
  return path.join(home, "privated_data", "workspaces").replaceAll("\\", "/")
}

/** Per-account workspace root: ONECODE_EXTRA_PATH/workspaces, else ~/privated_data/workspaces. */
export function workspaceEnvRoot() {
  const extra = OneCodeExtraPath.root()
  if (extra) return path.join(extra, "workspaces").replaceAll("\\", "/")
  return fallbackWorkspaceEnvRoot()
}

/** Per-account private assets root (skills, etc.): sibling of workspaces/. */
export function accountEnvRoot() {
  const extra = OneCodeExtraPath.root()
  if (extra) return path.join(extra, "accounts").replaceAll("\\", "/")
  return path.join(path.dirname(fallbackWorkspaceEnvRoot()), "accounts").replaceAll("\\", "/")
}

export function accountSkillsDir(accountId: string) {
  return path.join(accountEnvRoot(), accountId, "skills").replaceAll("\\", "/")
}

/** Per-account private tree root: accounts/{accountId}/ */
export function accountInstallRoot(accountId: string) {
  return path.join(accountEnvRoot(), accountId).replaceAll("\\", "/")
}

/** Per-account OneSkills release install: accounts/{accountId}/.opencode/oneskills */
export function accountOneskillsRoot(accountId: string) {
  return path.join(accountInstallRoot(accountId), ".opencode", "oneskills").replaceAll("\\", "/")
}

/** Remove leftover per-account OneSkills trees so they cannot shadow the shared install. */
export function removeAccountOneskillsInstalls() {
  const root = accountEnvRoot()
  if (!fs.existsSync(root)) return 0
  let removed = 0
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const target = accountOneskillsRoot(entry.name)
    if (!fs.existsSync(target)) continue
    fs.rmSync(target, { recursive: true, force: true })
    removed++
  }
  return removed
}

/** Resolve owning account from a workspace directory (or subdirectory). */
export function accountIdForDirectory(directory: string) {
  const normalized = path.resolve(directory).replaceAll("\\", "/")
  try {
    return Database.use((db) => {
      const workspaces = db
        .select()
        .from(PlatformWorkspaceTable)
        .where(isNull(PlatformWorkspaceTable.time_deleted))
        .all()
      const match = workspaces.find((workspace) => {
        const root = path.resolve(workspace.default_env_path).replaceAll("\\", "/")
        return normalized === root || normalized.startsWith(`${root}/`)
      })
      return match?.owner_account_id ?? undefined
    })
  } catch {
    // DB may be closed/reopening during test resetDatabase; treat as no account.
    return undefined
  }
}

export function authRequired() {
  const value = (process.env.OPENCODE_PLATFORM_AUTH_REQUIRED ?? process.env.ONECODE_PLATFORM_AUTH_REQUIRED ?? "")
    .trim()
    .toLowerCase()
  return value === "1" || value === "true" || value === "yes"
}

/** Lock after 3 consecutive failures for 5 seconds; cooldown expiry starts a fresh attempt window. */
export function loginLockoutMs(failures: number) {
  if (failures < 3) return 0
  return 5_000
}

export class LoginFailedError extends Error {
  readonly retryAfterMs?: number
  readonly lockedUntil?: number
  readonly failures?: number

  constructor(
    message: string,
    options?: {
      retryAfterMs?: number
      lockedUntil?: number
      failures?: number
    },
  ) {
    super(message)
    this.name = "LoginFailedError"
    this.retryAfterMs = options?.retryAfterMs
    this.lockedUntil = options?.lockedUntil
    this.failures = options?.failures
  }
}

type LoginLockState = {
  failures: number
  lockedUntil: number
}

type LoginLockStore = Record<string, LoginLockState>

function loginLockPath() {
  return path.join(Global.Path.data, "platform-login-lock.json")
}

function readLoginLockStore(): LoginLockStore {
  try {
    const raw = fs.readFileSync(loginLockPath(), "utf8")
    const parsed = JSON.parse(raw) as LoginLockStore
    if (!parsed || typeof parsed !== "object") return {}
    return parsed
  } catch {
    return {}
  }
}

function writeLoginLockStore(store: LoginLockStore) {
  fs.mkdirSync(path.dirname(loginLockPath()), { recursive: true })
  fs.writeFileSync(loginLockPath(), `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 })
}

function readLoginLock(email: string): LoginLockState {
  const entry = readLoginLockStore()[normalizeEmail(email)]
  if (!entry) return { failures: 0, lockedUntil: 0 }
  const failures = typeof entry.failures === "number" && entry.failures > 0 ? Math.floor(entry.failures) : 0
  const lockedUntil = typeof entry.lockedUntil === "number" ? entry.lockedUntil : 0
  // Cooldown finished — reset so the user gets another full attempt window.
  if (lockedUntil > 0 && lockedUntil <= now()) {
    writeLoginLock(email, { failures: 0, lockedUntil: 0 })
    return { failures: 0, lockedUntil: 0 }
  }
  return { failures, lockedUntil }
}

function writeLoginLock(email: string, next: LoginLockState) {
  const key = normalizeEmail(email)
  const store = readLoginLockStore()
  if (next.failures <= 0 && next.lockedUntil <= 0) {
    delete store[key]
  } else {
    store[key] = next
  }
  writeLoginLockStore(store)
}

function clearLoginLock(email: string) {
  writeLoginLock(email, { failures: 0, lockedUntil: 0 })
}

function assertLoginNotLocked(email: string) {
  const lock = readLoginLock(email)
  const current = now()
  if (lock.lockedUntil > current) {
    throw new LoginFailedError(`尝试次数过多，请在 ${formatRetryAfter(lock.lockedUntil - current)} 后重试`, {
      retryAfterMs: lock.lockedUntil - current,
      lockedUntil: lock.lockedUntil,
      failures: lock.failures,
    })
  }
}

function recordLoginFailure(email: string): never {
  const lock = readLoginLock(email)
  const failures = lock.failures + 1
  const wait = loginLockoutMs(failures)
  const lockedUntil = wait > 0 ? now() + wait : 0
  writeLoginLock(email, { failures, lockedUntil })
  if (wait > 0) {
    throw new LoginFailedError(`尝试次数过多，请在 ${formatRetryAfter(wait)} 后重试`, {
      retryAfterMs: wait,
      lockedUntil,
      failures,
    })
  }
  throw new LoginFailedError(INVALID_CREDENTIALS_MESSAGE, { failures })
}

function formatRetryAfter(ms: number) {
  const seconds = Math.max(1, Math.ceil(ms / 1000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  return "1 小时"
}

export function resolveSessionToken(token: string | undefined) {
  const value = token?.trim()
  if (!value) return
  try {
    return resolveSession(value)
  } catch {
    return
  }
}

export function workspaceRoots(session: AuthSession | undefined) {
  return session?.workspaces.map((workspace) => workspace.defaultEnvPath).filter((root) => root.trim().length > 0) ?? []
}

export function defaultWorkspace(session: AuthSession | undefined) {
  return session?.workspaces.find((workspace) => workspace.role === "admin") ?? session?.workspaces[0]
}

export function defaultWorkspaceRoot(session: AuthSession | undefined) {
  return defaultWorkspace(session)?.defaultEnvPath
}

/** Account `default` project directory — staging bucket for unorganized sessions. */
export function defaultProjectDirectory(session: AuthSession | undefined) {
  const workspace = defaultWorkspace(session)
  if (!workspace) return
  return defaultProjectDirectoryForWorkspace(workspace)
}

export function isDefaultProjectDirectory(session: AuthSession | undefined, target: string) {
  const root = defaultProjectDirectory(session)?.trim()
  if (!root || !target?.trim()) return false
  return normalizeComparablePath(path.resolve(root)) === normalizeComparablePath(path.resolve(target))
}

/**
 * Projects that may be hard-deleted (folder + DB). Blocks workspace root, default,
 * case, and anything outside the account workspace.
 */
export function assertDeletableAccountProject(session: AuthSession | undefined, directory: string) {
  if (!session) throw new Error("login required")
  const root = defaultWorkspaceRoot(session)?.trim()
  if (!root) throw new Error("workspace required")
  const target = path.resolve(directory).replaceAll("\\", "/").replace(/\/+$/, "")
  const base = path.resolve(root).replaceAll("\\", "/").replace(/\/+$/, "")
  if (!canAccessPath(session, target)) throw new Error("project permission denied")
  if (target === base) throw new Error("cannot delete workspace root")
  if (!target.startsWith(`${base}/`)) throw new Error("project outside workspace")
  const relative = target.slice(base.length + 1)
  if (relative === "default" || relative === "case") throw new Error("cannot delete reserved project")
  return target
}

/**
 * Ensure a writable account-workspace directory has a ProjectTable row.
 * UI can open folders that only exist on disk; session.moveTo requires a DB project.
 */
export function ensureAccountProject(session: AuthSession | undefined, directory: string) {
  if (!session) throw new Error("login required")
  if (!canWritePath(session, directory)) throw new Error("project permission denied")
  if (isSharedCasesPath(directory)) throw new Error("shared cases are read-only")

  const target = path.resolve(directory).replaceAll("\\", "/").replace(/\/+$/, "")
  const workspace = session.workspaces.find((item) => {
    const root = path.resolve(item.defaultEnvPath).replaceAll("\\", "/").replace(/\/+$/, "")
    return target === root || target.startsWith(`${root}/`)
  })
  if (!workspace) throw new Error("project outside workspace")

  const root = path.resolve(workspace.defaultEnvPath).replaceAll("\\", "/").replace(/\/+$/, "")
  const relative = target === root ? "" : target.slice(root.length + 1)
  const name = relative.split("/").filter(Boolean).at(-1) || DEFAULT_PROJECT_NAME

  try {
    fs.mkdirSync(target, { recursive: true })
  } catch {
    // best-effort: directory may already exist
  }

  return Database.use((db) => {
    const existing = db.select().from(ProjectTable).where(eq(ProjectTable.worktree, target)).get()
    if (existing) return existing

    const slug = (relative || DEFAULT_PROJECT_NAME)
      .replaceAll("\\", "/")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64)
    const projectId = ProjectID.make(`proj-${workspace.id}-${slug || "project"}`)
    const created = now()
    db.insert(ProjectTable)
      .values({
        id: projectId,
        worktree: target,
        vcs: null,
        name,
        sandboxes: [],
        time_created: created,
        time_updated: created,
      })
      .onConflictDoUpdate({
        target: ProjectTable.id,
        set: {
          worktree: target,
          name,
          time_updated: created,
        },
      })
      .run()
    return db.select().from(ProjectTable).where(eq(ProjectTable.worktree, target)).get()!
  })
}

export function defaultWorkspaceCaseDirectory(session: AuthSession | undefined) {
  const root = defaultWorkspaceRoot(session)
  if (!root) return
  return joinWorkspaceDirectory(root, "case")
}

/** Platform shared preset cases root (read-only for logged-in accounts). */
export function sharedCasesRoot() {
  const override = (process.env.ONECODE_SHARED_CASES_ROOT ?? process.env.OPENCODE_SHARED_CASES_ROOT ?? "").trim()
  if (override) return path.resolve(override)
  return path.resolve(OneScienceCodeDefaultDirectory.resolve())
}

export function isSharedCasesPath(target: string) {
  return isPathInsideRoot(sharedCasesRoot(), target)
}

export function isPathInsideRoot(root: string, target: string) {
  const resolvedRoot = normalizeComparablePath(path.resolve(root))
  const resolvedTarget = normalizeComparablePath(path.resolve(target))
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
}

function normalizeComparablePath(value: string) {
  if (process.platform !== "win32") return value
  return value.toLowerCase()
}

export function canAccessPath(session: AuthSession | undefined, target: string) {
  if (!session) return true
  if (isSharedCasesPath(target)) return true
  const roots = workspaceRoots(session)
  if (roots.length === 0) return false
  return roots.some((root) => isPathInsideRoot(root, target))
}

/** Longest matching account workspace root that contains this path. */
export function accountIdForPath(target: string) {
  if (!target?.trim()) return
  let best: { id: string; len: number } | undefined
  for (const account of listAccounts()) {
    for (const workspace of listWorkspacesForAccount(account.id)) {
      const root = workspace.defaultEnvPath?.trim()
      if (!root || !isPathInsideRoot(root, target)) continue
      const len = path.resolve(root).length
      if (!best || len > best.len) best = { id: account.id, len }
    }
  }
  return best?.id
}

/** Shared cases are readable by all logged-in users but not writable. */
export function canWritePath(session: AuthSession | undefined, target: string) {
  if (!session) return true
  if (isSharedCasesPath(target)) return false
  // Private / same-org deployments: writes are gated by OS permissions of the
  // OneCode process, not account workspace roots.
  void target
  return true
}

export function canUseTerminal(session: AuthSession | undefined) {
  if (!session) return true
  // terminalIsolationMode() already soft-falls back to native when sandbox
  // prerequisites are missing, so a defined mode means the terminal is usable.
  return Boolean(terminalIsolationMode())
}

/**
 * Isolation mode for platform-auth terminals.
 *
 * Defaults (when ONECODE_TERMINAL_ISOLATION unset) — compute availability first:
 * - Windows: native
 * - Inside a container / OCI runtime: native (outer runtime is the boundary)
 * - Bare metal with accelerator + docker: docker (isolation + GPU/DCU)
 * - Bare metal with accelerator, no docker: native (prefer usable GPU over bwrap isolation)
 * - Bare metal without accelerator + usable bwrap: bubblewrap (multi-tenant directory isolation)
 * - Bare metal without accelerator + no usable bwrap: native (shared host terminal, no hard block)
 *
 * When bubblewrap/docker is requested but unavailable, soft-fallback to native
 * so users still get a working shared terminal instead of a blocking error dialog.
 * Set ONECODE_TERMINAL_ISOLATION=disabled to fully disable platform terminals.
 */
export function terminalIsolationMode(): "native" | "bubblewrap" | "docker" | undefined {
  const desired = desiredTerminalIsolationMode()
  if (!desired) return
  if (desired === "native") return "native"
  if (desired === "bubblewrap") {
    if (bubblewrapAvailable()) return "bubblewrap"
    return "native"
  }
  if (desired === "docker") {
    if (dockerAvailable()) return "docker"
    return "native"
  }
  return
}

function desiredTerminalIsolationMode(): "native" | "bubblewrap" | "docker" | undefined {
  const raw = process.env.ONECODE_TERMINAL_ISOLATION ?? process.env.OPENCODE_TERMINAL_ISOLATION
  const value = raw?.trim().toLowerCase()
  if (value === "0" || value === "false" || value === "disabled" || value === "none") return
  if (value === "native") return "native"
  if (value === "bwrap" || value === "bubblewrap") return "bubblewrap"
  if (value === "docker" || value === "container") return "docker"
  if (value === "auto") return detectTerminalIsolationMode()
  if (value) return
  // Unset: platform-specific defaults.
  if (process.platform === "win32") return "native"
  if (looksLikeContainerRuntime()) return "native"
  return detectBareMetalTerminalIsolation()
}

function capabilities(session: AuthSession | undefined) {
  // Re-probe on each session snapshot so fixing Docker/host permissions + re-login
  // picks up a working bwrap/docker without requiring a full process restart.
  bubblewrapProbeCache.clear()
  dockerProbeCache.clear()
  const isolation = session ? terminalIsolationMode() : "native"
  const terminal = canUseTerminal(session)
  const hint = session && !terminal ? terminalUnavailableHint(isolation) : undefined
  return {
    terminal,
    ...(isolation ? { terminalIsolation: isolation } : {}),
    ...(hint?.reason ? { terminalUnavailableReason: hint.reason } : {}),
    ...(hint?.detail ? { terminalUnavailableDetail: hint.detail } : {}),
    ...(hint?.family ? { terminalInstallFamily: hint.family } : {}),
    ...(hint?.commands?.length ? { terminalInstallCommands: hint.commands } : {}),
    ...(session ? { sharedCasesRoot: sharedCasesRoot() } : {}),
  }
}

function looksLikeContainerRuntime() {
  const forced = process.env.ONECODE_CONTAINER_RUNTIME
  if (forced === "1" || forced === "true") return true
  if (forced === "0" || forced === "false") return false
  if (process.env.KUBERNETES_SERVICE_HOST || process.env.DOCKER_CONTAINER || process.env.container === "oci") return true
  try {
    if (fs.existsSync("/.dockerenv")) return true
    // Only trust PID 1 / self cgroup markers. Do NOT scan mountinfo for overlay/aufs:
    // bare-metal hosts that run Docker also mount overlay layers under /var/lib/docker,
    // which would false-positive and disable bubblewrap isolation for source/tgz deploys.
    const cgroup1 = readFileText("/proc/1/cgroup")
    const cgroupSelf = readFileText("/proc/self/cgroup")
    const containerMark = /docker|containerd|kubepods|libpod|lxc|podman|buildkit|garden|poc|systemd-nspawn/i
    return containerMark.test(cgroup1 + cgroupSelf)
  } catch {
    return false
  }
}

function readFileText(path: string) {
  try {
    return fs.readFileSync(path, "utf8")
  } catch {
    return ""
  }
}

function readSysctl(name: string) {
  try {
    return fs.readFileSync(`/proc/sys/${name.replace(/\./g, "/")}`, "utf8").trim()
  } catch {
    return
  }
}

function terminalUnavailableHint(isolation: ReturnType<typeof terminalIsolationMode>) {
  if (!isolation) {
    return {
      reason: "disabled",
      family: "unknown",
      commands: [
        "# 当前服务关闭了平台账号终端。如需开启，请在服务端设置：",
        "export ONECODE_TERMINAL_ISOLATION=bubblewrap",
      ],
    }
  }
  if (isolation === "native") return
  if (isolation === "bubblewrap") {
    const bwrap = bubblewrapBinary()
    const probe = lastBubblewrapProbe(bwrap)
    const installed = Boolean(resolveExecutable(bwrap))
    if (installed && !probe.ok) {
      const inContainer = looksLikeContainerRuntime()
      const userns = readSysctl("kernel.unprivileged_userns_clone")
      const apparmor = readSysctl("kernel.apparmor_restrict_unprivileged_userns")
      const bareMetalCommands = [
        "# bubblewrap 已安装，但探测失败。请用「带 bind」的完整探测：",
        "bwrap --unshare-all --share-net --die-with-parent --new-session --proc /proc --dev /dev --ro-bind-try /usr /usr --ro-bind-try /bin /bin --ro-bind-try /lib /lib --ro-bind-try /lib64 /lib64 --tmpfs /tmp -- /usr/bin/true; echo exit:$?",
        "# 检查内核限制（值为 0 时需开启）：",
        "cat /proc/sys/kernel/unprivileged_userns_clone",
        "cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || true",
        "# 临时开启（重启后失效）：",
        "sudo sysctl -w kernel.unprivileged_userns_clone=1",
        "sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0",
        "# GPU/DCU 且要用 docker：把运行账号加入 docker 组，勿用 sudo 跑 onecode：",
        "sudo usermod -aG docker \"$USER\"",
        "export ONECODE_TERMINAL_ISOLATION=docker",
        "# 无 GPU 的虚机请用 bubblewrap，不要选 docker。",
        "# 然后以普通用户重启 OneCode 并重新登录。",
      ]
      const containerCommands = [
        "# 容器内 bubblewrap 无法创建 namespace（常见原因：宿主机 AppArmor 限制）：",
        "docker run --security-opt seccomp=unconfined --security-opt apparmor=unconfined --cap-add=SYS_ADMIN ...",
        "# 测试：",
        "bwrap --unshare-all --share-net --die-with-parent --new-session --proc /proc --dev /dev --ro-bind-try /usr /usr --ro-bind-try /bin /bin --tmpfs /tmp -- /usr/bin/true; echo exit:$?",
        "# 单租户可临时关闭隔离：",
        "export ONECODE_TERMINAL_ISOLATION=native",
      ]
      return {
        reason: "bubblewrap-unusable",
        family: inContainer ? "docker" : "debian",
        detail: [
          probe.detail,
          userns !== undefined ? `unprivileged_userns_clone=${userns}` : "",
          apparmor !== undefined ? `apparmor_restrict_unprivileged_userns=${apparmor}` : "",
          inContainer ? "runtime=container" : "runtime=host",
        ]
          .filter(Boolean)
          .join(" | "),
        commands: inContainer ? containerCommands : bareMetalCommands,
      }
    }
    const install = bubblewrapInstallHint()
    return {
      reason: "bubblewrap-missing",
      family: install.family,
      detail: probe.detail,
      commands: [
        "# 请在运行 OneCode 的同一台机器上安装 bubblewrap，然后重启服务并重新登录：",
        ...install.commands,
      ],
    }
  }
  if (isolation === "docker") {
    const probe = lastDockerProbe()
    return {
      reason: "docker-missing",
      family: "unknown",
      detail: probe.detail,
      commands: [
        "# 当前终端隔离为 docker，但当前用户无法使用 Docker（未安装，或没有 docker.sock 权限）。",
        "# 无 GPU 的虚机请改用 bubblewrap：",
        "export ONECODE_TERMINAL_ISOLATION=bubblewrap",
        "# 有 GPU 且要用 docker 时，把运行 OneCode 的账号加入 docker 组后重新登录：",
        "sudo usermod -aG docker \"$USER\"",
        "docker info >/dev/null && echo docker-ok",
      ],
    }
  }
}

function bubblewrapInstallHint() {
  const release = readOsRelease()
  const id = `${release.ID ?? ""} ${release.ID_LIKE ?? ""}`.toLowerCase()
  if (/\b(debian|ubuntu|linuxmint|pop|raspbian)\b/.test(id)) {
    return {
      family: "debian",
      commands: ["sudo apt-get update && sudo apt-get install -y bubblewrap"],
    }
  }
  if (/\b(rhel|centos|fedora|rocky|almalinux|ol|amzn)\b/.test(id)) {
    return {
      family: "rhel",
      commands: [
        "sudo dnf install -y bubblewrap",
        "# CentOS 7 / 较旧系统：",
        "sudo yum install -y epel-release && sudo yum install -y bubblewrap",
      ],
    }
  }
  if (/\b(arch|manjaro)\b/.test(id)) {
    return {
      family: "arch",
      commands: ["sudo pacman -S --needed bubblewrap"],
    }
  }
  if (/\b(suse|opensuse)\b/.test(id)) {
    return {
      family: "suse",
      commands: ["sudo zypper install -y bubblewrap"],
    }
  }
  if (/\b(alpine)\b/.test(id)) {
    return {
      family: "alpine",
      commands: ["sudo apk add bubblewrap"],
    }
  }
  return {
    family: "unknown",
    commands: [
      "# Debian / Ubuntu",
      "sudo apt-get update && sudo apt-get install -y bubblewrap",
      "# RHEL / CentOS / Rocky / AlmaLinux",
      "sudo dnf install -y bubblewrap",
      "# 或: sudo yum install -y epel-release && sudo yum install -y bubblewrap",
      "# Arch",
      "sudo pacman -S --needed bubblewrap",
      "# Alpine",
      "sudo apk add bubblewrap",
    ],
  }
}

function readOsRelease() {
  try {
    const text = fs.readFileSync("/etc/os-release", "utf8")
    const values: Record<string, string> = {}
    for (const line of text.split("\n")) {
      const match = /^([A-Z_]+)=(.*)$/.exec(line.trim())
      if (!match) continue
      values[match[1]!] = match[2]!.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1")
    }
    return values
  } catch {
    return {}
  }
}

export function filterAccessibleProjects<T extends { worktree: string; sandboxes: string[] }>(
  session: AuthSession | undefined,
  projects: Iterable<T>,
) {
  if (!session) return Array.from(projects)
  return Array.from(projects).flatMap((project) => {
    if (!canAccessPath(session, project.worktree)) return []
    const sandboxes = project.sandboxes.filter((sandbox) => canAccessPath(session, sandbox))
    if (sandboxes.length === project.sandboxes.length) return [project]
    return [{ ...project, sandboxes } as T]
  })
}

export function resolveDirectoryForSession(session: AuthSession | undefined, requested?: string) {
  if (!session) return requested?.trim() ? path.resolve(requested) : process.cwd()
  const root = defaultWorkspaceRoot(session)
  if (!root) return
  if (!requested?.trim()) return path.resolve(root)
  // Honor the requested directory even outside the account workspace. Catalog
  // register / host uploads rely on OS permissions; shared-case writes stay blocked
  // by canWritePath.
  return path.resolve(requested)
}

function normalizeAccountStatus(status: string) {
  // Legacy rows used "disabled"; treat as frozen going forward.
  if (status === "disabled") return "frozen"
  return status
}

function accountFromRow(row: typeof PlatformAccountTable.$inferSelect): Account {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    status: normalizeAccountStatus(row.status),
    ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
    timeCreated: row.time_created,
    ...(row.time_updated ? { timeUpdated: row.time_updated } : {}),
  }
}

function workspaceFromRows(workspace: typeof PlatformWorkspaceTable.$inferSelect, member?: typeof PlatformWorkspaceMemberTable.$inferSelect): Workspace {
  return {
    id: workspace.id,
    slug: workspace.slug,
    name: workspace.name,
    defaultEnvPath: workspace.default_env_path,
    ...(workspace.owner_account_id ? { ownerAccountId: workspace.owner_account_id } : {}),
    ...(member ? { role: member.role } : {}),
  }
}

function quotaFromRow(row: typeof PlatformResourceQuotaTable.$inferSelect): typeof Quota.Type {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ...(row.account_id ? { accountId: row.account_id } : {}),
    ...(row.cpu_limit !== null ? { cpuLimit: row.cpu_limit } : {}),
    ...(row.memory_limit_mb !== null ? { memoryLimitMb: row.memory_limit_mb } : {}),
    ...(row.gpu_limit !== null ? { gpuLimit: row.gpu_limit } : {}),
    ...(row.storage_limit_mb !== null ? { storageLimitMb: row.storage_limit_mb } : {}),
    ...(row.session_limit !== null ? { sessionLimit: row.session_limit } : {}),
    ...(row.monthly_token_limit !== null ? { monthlyTokenLimit: row.monthly_token_limit } : {}),
    ...(row.monthly_cost_limit !== null ? { monthlyCostLimit: row.monthly_cost_limit } : {}),
  }
}

function usageFromRow(row: typeof PlatformResourceUsageTable.$inferSelect): typeof Usage.Type {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    accountId: row.account_id,
    resourceType: row.resource_type,
    amount: row.amount,
    unit: row.unit,
    ...(row.source_id ? { sourceId: row.source_id } : {}),
    ...(row.source_type ? { sourceType: row.source_type } : {}),
    timeCreated: row.time_created,
  }
}

function getAccount(accountId: string) {
  const row = Database.use((db) => db.select().from(PlatformAccountTable).where(and(eq(PlatformAccountTable.id, accountId), isNull(PlatformAccountTable.time_deleted))).get())
  if (!row) throw new Error("account not found")
  return accountFromRow(row)
}

function listWorkspacesForAccount(accountId: string) {
  return Database.use((db) => {
    const members = db.select().from(PlatformWorkspaceMemberTable).where(and(eq(PlatformWorkspaceMemberTable.account_id, accountId), isNull(PlatformWorkspaceMemberTable.time_deleted))).all()
    if (members.length === 0) return []
    const rows = db.select().from(PlatformWorkspaceTable).where(isNull(PlatformWorkspaceTable.time_deleted)).all()
    return members.flatMap((member) => {
      const workspace = rows.find((item) => item.id === member.workspace_id)
      return workspace ? [workspaceFromRows(workspace, member)] : []
    })
  })
}

function ensureWorkspaceDirectories(session: AuthSession): AuthSession {
  session.workspaces.forEach((workspace) => {
    fs.mkdirSync(workspace.defaultEnvPath, { recursive: true })
    fs.mkdirSync(joinWorkspaceDirectory(workspace.defaultEnvPath, "case"), { recursive: true })
    createDefaultProjectForWorkspace(workspace)
  })
  return { ...session, capabilities: capabilities(session) }
}

function detectTerminalIsolationMode() {
  if (looksLikeContainerRuntime()) return "native"
  return detectBareMetalTerminalIsolation()
}

/**
 * Bare-metal auto policy (compute first):
 * real accelerator + usable docker → docker
 * real accelerator, docker missing/unusable → native
 * no accelerator + usable bwrap → bubblewrap (even if docker is installed)
 * no accelerator + bwrap missing/unusable → native (shared terminal)
 */
function detectBareMetalTerminalIsolation(): "native" | "bubblewrap" | "docker" {
  if (acceleratorPassthroughWanted() && hostLooksLikeAcceleratorHost()) {
    if (dockerAvailable()) return "docker"
    return "native"
  }
  if (bubblewrapAvailable()) return "bubblewrap"
  return "native"
}

function acceleratorPassthroughWanted() {
  const gpu = (
    process.env.ONECODE_TERMINAL_SANDBOX_ACCEL ??
    process.env.ONECODE_TERMINAL_SANDBOX_GPU ??
    process.env.OPENCODE_TERMINAL_SANDBOX_GPU ??
    "1"
  )
    .trim()
    .toLowerCase()
  return !(gpu === "0" || gpu === "false" || gpu === "off" || gpu === "disabled" || gpu === "none")
}

/**
 * Detect discrete / compute accelerators.
 * Do NOT treat `/dev/dri` alone as enough — many VMs expose dri for virtio/iGPU
 * and would incorrectly prefer docker/native over bubblewrap.
 */
function hostLooksLikeAcceleratorHost() {
  const forced = process.env.ONECODE_ACCEL_HOST?.trim().toLowerCase()
  if (forced === "1" || forced === "true" || forced === "yes") return true
  if (forced === "0" || forced === "false" || forced === "no") return false
  try {
    for (const name of fs.readdirSync("/dev")) {
      if (name === "nvidia-caps" || name.startsWith("nvidia")) return true
      if (name === "kfd" || name === "mkfd") return true
      if (name === "dxg") return true
    }
  } catch {
    // ignore
  }
  return ["/dev/nvidiactl", "/dev/nvidia0", "/dev/kfd", "/dev/mkfd", "/dev/dxg"].some((item) => {
    try {
      return fs.existsSync(item)
    } catch {
      return false
    }
  })
}

function bubblewrapBinary() {
  const configured =
    process.env.ONECODE_BWRAP_PATH?.trim() || process.env.OPENCODE_BWRAP_PATH?.trim() || "bwrap"
  return resolveExecutable(configured) || configured
}

type BubblewrapProbe = { ok: boolean; detail?: string }
const bubblewrapProbeCache = new Map<string, BubblewrapProbe>()

function lastBubblewrapProbe(bwrap: string): BubblewrapProbe {
  return bubblewrapProbeCache.get(bwrap) ?? { ok: false, detail: "not probed" }
}

function bubblewrapAvailable() {
  const bwrap = bubblewrapBinary()
  const probeMode = (process.env.ONECODE_BWRAP_PROBE ?? "").trim().toLowerCase()
  const skipProbe = probeMode === "0" || probeMode === "false" || probeMode === "skip"
  // Tests can skip the unshare probe (and even a missing binary) the same way docker does.
  if (skipProbe) {
    bubblewrapProbeCache.set(bwrap, { ok: true })
    return true
  }
  if (process.platform === "win32") return false
  if (!resolveExecutable(bwrap)) {
    bubblewrapProbeCache.set(bwrap, {
      ok: false,
      detail: `bwrap not found (checked PATH and /usr/bin;/bin). ONECODE_BWRAP_PATH=${process.env.ONECODE_BWRAP_PATH ?? ""}`,
    })
    return false
  }
  return bubblewrapCanUnshare(bwrap)
}

/**
 * Keep in sync with terminal-sandbox.bwrapUnshareArgs().
 * Default --unshare-all --share-net: filesystem isolation + host network.
 * ONECODE_TERMINAL_SANDBOX_USERNS=0 skips user ns (needs privileges; not for sudo onecode).
 * ONECODE_TERMINAL_SANDBOX_SHARE_NET=0 also isolates the network namespace.
 */
function terminalSandboxUnshareArgs(): string[] {
  const force = (process.env.ONECODE_TERMINAL_SANDBOX_USERNS ?? "").trim().toLowerCase()
  const shareRaw = (process.env.ONECODE_TERMINAL_SANDBOX_SHARE_NET ?? "").trim().toLowerCase()
  const shareNet = !(
    shareRaw === "0" ||
    shareRaw === "false" ||
    shareRaw === "off" ||
    shareRaw === "none" ||
    shareRaw === "no"
  )
  if (force === "0" || force === "false" || force === "none" || force === "skip") {
    if (shareNet) return ["--unshare-pid", "--unshare-ipc", "--unshare-uts", "--unshare-cgroup"]
    return ["--unshare-pid", "--unshare-ipc", "--unshare-net", "--unshare-uts", "--unshare-cgroup"]
  }
  return shareNet ? ["--unshare-all", "--share-net"] : ["--unshare-all"]
}

/** Verify bwrap can actually create namespaces — PATH presence alone is not enough. */
function bubblewrapCanUnshare(bwrap: string) {
  const cached = bubblewrapProbeCache.get(bwrap)
  if (cached !== undefined) return cached.ok

  const bin = resolveExecutable(bwrap) || bwrap
  // Prefer an absolute busybox/coreutils path — a bare "true" fails inside the sandbox
  // when PATH is empty or /bin is a symlink-only tree (common on Ubuntu).
  const trueBin =
    resolveExecutable("true") ||
    ["/usr/bin/true", "/bin/true"].find((candidate) => fs.existsSync(candidate)) ||
    "true"
  const result = spawnSync(
    bin,
    [
      ...terminalSandboxUnshareArgs(),
      "--die-with-parent",
      "--new-session",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--ro-bind-try",
      "/usr",
      "/usr",
      "--ro-bind-try",
      "/bin",
      "/bin",
      "--ro-bind-try",
      "/lib",
      "/lib",
      "--ro-bind-try",
      "/lib64",
      "/lib64",
      "--tmpfs",
      "/tmp",
      "--",
      trueBin,
    ],
    {
      encoding: "utf8",
      timeout: 5_000,
      env: {
        PATH: [process.env.PATH, "/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin"]
          .filter(Boolean)
          .join(":"),
      },
    },
  )
  const ok = result.status === 0
  const detail = ok
    ? undefined
    : [result.stderr?.trim(), result.stdout?.trim(), result.error ? String(result.error) : "", `exit=${result.status}`]
        .filter(Boolean)
        .join(" | ")
        .slice(0, 500)
  bubblewrapProbeCache.set(bwrap, { ok, detail })
  if (!ok) {
    // Keep a process log line so operators can diagnose without the UI.
    console.warn(`[platform-auth] bubblewrap probe failed (${bin}): ${detail || "unknown error"}`)
  }
  return ok
}

type DockerProbe = { ok: boolean; detail?: string }
const dockerProbeCache = new Map<string, DockerProbe>()

function lastDockerProbe(): DockerProbe {
  const docker = process.env.ONECODE_DOCKER_PATH?.trim() || process.env.OPENCODE_DOCKER_PATH?.trim() || "docker"
  for (const key of [`${docker}::skip`, `${docker}::info`]) {
    const hit = dockerProbeCache.get(key)
    if (hit) return hit
  }
  return { ok: false, detail: "not probed" }
}

/** Binary exists is not enough — the service user must be able to talk to the Docker API. */
function dockerAvailable() {
  const docker = process.env.ONECODE_DOCKER_PATH?.trim() || process.env.OPENCODE_DOCKER_PATH?.trim() || "docker"
  const probeMode = process.env.ONECODE_DOCKER_PROBE?.trim().toLowerCase()
  const skipProbe = probeMode === "0" || probeMode === "false" || probeMode === "skip"
  const cacheKey = `${docker}::${skipProbe ? "skip" : "info"}`
  const cached = dockerProbeCache.get(cacheKey)
  if (cached !== undefined) return cached.ok

  const bin = resolveExecutable(docker)
  if (!bin) {
    dockerProbeCache.set(cacheKey, { ok: false, detail: `docker not found (ONECODE_DOCKER_PATH=${docker})` })
    return false
  }

  // Tests / air-gapped probes can skip the API check (binary presence only).
  if (skipProbe) {
    dockerProbeCache.set(cacheKey, { ok: true })
    return true
  }

  const result = spawnSync(bin, ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8",
    timeout: 5_000,
    env: process.env,
  })
  const ok = result.status === 0
  const detail = ok
    ? undefined
    : [result.stderr?.trim(), result.stdout?.trim(), result.error ? String(result.error) : "", `exit=${result.status}`]
        .filter(Boolean)
        .join(" | ")
        .slice(0, 500)
  dockerProbeCache.set(cacheKey, { ok, detail })
  if (!ok) {
    console.warn(
      `[platform-auth] docker not usable for terminal isolation (${bin}): ${detail || "unknown"}. ` +
        `Common cause: service user not in the docker group (permission denied on docker.sock).`,
    )
  }
  return ok
}

/** Resolve a binary even when the service PATH is minimal (systemd / Docker entrypoint). */
function resolveExecutable(cmd: string) {
  if (!cmd.trim()) return
  if (cmd.includes("/") || cmd.includes("\\")) return fs.existsSync(cmd) ? cmd : undefined
  const fromPath = which(cmd)
  if (fromPath) return fromPath
  for (const dir of ["/usr/bin", "/bin", "/usr/local/bin", "/usr/sbin", "/sbin"]) {
    const candidate = path.join(dir, cmd)
    if (fs.existsSync(candidate)) return candidate
  }
}

export function configuredProvisionToken() {
  return (process.env.ONECODE_PROVISION_TOKEN ?? process.env.OPENCODE_PROVISION_TOKEN ?? "").trim()
}

/** When `ONECODE_PROVISION_TOKEN` is set, require a matching header value. */
export function assertProvisionToken(headerValue: string | undefined) {
  const expected = configuredProvisionToken()
  if (!expected) return
  const actual = (headerValue ?? "").trim()
  if (!actual) throw new Error(PROVISION_TOKEN_REQUIRED_MESSAGE)
  const left = createHash("sha256").update(actual).digest()
  const right = createHash("sha256").update(expected).digest()
  if (!timingSafeEqual(left, right)) throw new Error(PROVISION_TOKEN_INVALID_MESSAGE)
}

/**
 * Create account + default workspace (no invite / email-code gates).
 * Caller is responsible for validating email/slug/password and uniqueness policy.
 */
function createAccountWithWorkspace(input: { email: string; slug: string; password: string }): AuthSession {
  const email = input.email
  const slug = input.slug
  const accountName = slug
  const accountID = `acct-${randomUUID()}`
  const workspaceID = `wrk-${randomUUID()}`
  const defaultEnvPath = joinWorkspaceDirectory(workspaceEnvRoot(), slug)
  const casePath = joinWorkspaceDirectory(defaultEnvPath, "case")
  const created = now()

  // Uniqueness checks before any side effects.
  Database.use((db) => {
    const emailTaken = db
      .select({ id: PlatformAccountTable.id })
      .from(PlatformAccountTable)
      .where(and(eq(PlatformAccountTable.email, email), isNull(PlatformAccountTable.time_deleted)))
      .get()
    if (emailTaken) throw new Error("该邮箱已注册")
    const accountTaken = db
      .select({ id: PlatformAccountTable.id })
      .from(PlatformAccountTable)
      .where(and(sql`lower(${PlatformAccountTable.name}) = ${slug}`, isNull(PlatformAccountTable.time_deleted)))
      .get()
    if (accountTaken) throw new Error("该账户名已被占用")
    const slugTaken = db
      .select({ id: PlatformWorkspaceTable.id })
      .from(PlatformWorkspaceTable)
      .where(and(eq(PlatformWorkspaceTable.slug, slug), isNull(PlatformWorkspaceTable.time_deleted)))
      .get()
    if (slugTaken) throw new Error("该账户名已被占用")
  })

  // Create directories first — if this fails, nothing is written to the database.
  // Non-recursive leaf mkdir fails when the path already exists (avoids races).
  try {
    fs.mkdirSync(workspaceEnvRoot(), { recursive: true })
    fs.mkdirSync(defaultEnvPath)
    fs.mkdirSync(casePath)
  } catch (cause) {
    const code = cause && typeof cause === "object" && "code" in cause ? String((cause as { code?: string }).code) : ""
    removeWorkspaceDirectoryTree(defaultEnvPath)
    if (code === "EEXIST") throw new Error("该账户对应的工作目录已存在，请更换账户名")
    throw new Error(cause instanceof Error ? `无法创建工作目录：${cause.message}` : "无法创建工作目录")
  }

  try {
    Database.transaction((db) => {
      const existing = db
        .select({ id: PlatformAccountTable.id })
        .from(PlatformAccountTable)
        .where(and(eq(PlatformAccountTable.email, email), isNull(PlatformAccountTable.time_deleted)))
        .get()
      if (existing) throw new Error("该邮箱已注册")
      const accountTaken = db
        .select({ id: PlatformAccountTable.id })
        .from(PlatformAccountTable)
        .where(and(sql`lower(${PlatformAccountTable.name}) = ${slug}`, isNull(PlatformAccountTable.time_deleted)))
        .get()
      if (accountTaken) throw new Error("该账户名已被占用")
      db.insert(PlatformAccountTable)
        .values({ id: accountID, email, name: accountName, status: "active", time_created: created })
        .run()
      db.insert(PlatformPasswordCredentialTable)
        .values({
          account_id: accountID,
          password_hash: hashPassword(input.password),
          password_updated_at: created,
          time_created: created,
        })
        .run()
      db.insert(PlatformAuthIdentityTable)
        .values({
          id: `aid-${randomUUID()}`,
          provider: "password",
          subject: email,
          account_id: accountID,
          email,
          name: accountName,
          time_created: created,
        })
        .run()
      db.insert(PlatformWorkspaceTable)
        .values({
          id: workspaceID,
          slug,
          name: `${accountName} 的开发空间`,
          default_env_path: defaultEnvPath,
          owner_account_id: accountID,
          time_created: created,
        })
        .run()
      db.insert(PlatformWorkspaceMemberTable)
        .values({
          id: `wmem-${randomUUID()}`,
          workspace_id: workspaceID,
          account_id: accountID,
          role: "admin",
          status: "active",
          time_created: created,
        })
        .run()
      db.insert(PlatformResourceQuotaTable)
        .values({
          id: `quota-${randomUUID()}`,
          workspace_id: workspaceID,
          account_id: accountID,
          cpu_limit: 4,
          memory_limit_mb: 16384,
          gpu_limit: 0,
          storage_limit_mb: 102400,
          session_limit: 4,
          monthly_token_limit: 1_000_000,
          monthly_cost_limit: 10,
          time_created: created,
        })
        .run()
    })
  } catch (cause) {
    removeWorkspaceDirectoryTree(defaultEnvPath)
    throw cause instanceof Error ? cause : new Error("注册失败，请稍后重试")
  }

  return createSession(accountID)
}

export function register(input: RegisterPayload) {
  assertAndConsumeInviteSync(input.inviteCode)
  const email = assertValidEmail(input.email)
  if (input.password.length < 8) throw new Error("密码至少需要 8 位")
  const slug = assertValidAccountSlug(input.name)
  if (isMailAvailable()) {
    consumeRegistrationEmailCode(email, input.emailCode)
  }
  return createAccountWithWorkspace({ email, slug, password: input.password })
}

/**
 * Idempotent account provisioning for embedded platforms (e.g. GV).
 * Skips invite code and registration email verification.
 * Duplicate create with the same name + email + password is a successful no-op.
 */
export function provision(input: ProvisionPayload): ProvisionResult {
  const email = assertValidEmail(input.email)
  if (input.password.length < 8) throw new Error("密码至少需要 8 位")
  const slug = assertValidAccountSlug(input.name)

  const byEmail = findAccountByLogin(email)
  const byName = findAccountByLogin(slug)

  if (byEmail || byName) {
    if (!byEmail || !byName || byEmail.id !== byName.id) {
      throw new Error(PROVISION_IDENTITY_CONFLICT_MESSAGE)
    }
    if (normalizeAccountStatus(byEmail.status) === "frozen") {
      throw new Error(ACCOUNT_FROZEN_MESSAGE)
    }
    const credential = Database.use((db) =>
      db.select().from(PlatformPasswordCredentialTable).where(eq(PlatformPasswordCredentialTable.account_id, byEmail.id)).get(),
    )
    if (!credential || !verifyPassword(input.password, credential.password_hash)) {
      throw new Error(PROVISION_PASSWORD_MISMATCH_MESSAGE)
    }
    return { ...createSession(byEmail.id), created: false }
  }

  return { ...createAccountWithWorkspace({ email, slug, password: input.password }), created: true }
}

export function login(input: LoginPayload) {
  const identifier = input.email.trim()
  const lockKey = identifier.includes("@") ? normalizeEmail(identifier) : normalizeAccountSlug(identifier)
  assertLoginNotLocked(lockKey)

  const row = findAccountByLogin(identifier)
  if (!row) {
    recordLoginFailure(lockKey)
  }
  if (normalizeAccountStatus(row.status) === "frozen") {
    throw new LoginFailedError(ACCOUNT_FROZEN_MESSAGE)
  }

  const credential = Database.use((db) =>
    db.select().from(PlatformPasswordCredentialTable).where(eq(PlatformPasswordCredentialTable.account_id, row.id)).get(),
  )
  if (!credential || !verifyPassword(input.password, credential.password_hash)) {
    recordLoginFailure(lockKey)
  }

  clearLoginLock(lockKey)
  return createSession(row.id)
}

export function createSession(accountID: string) {
  const token = sessionToken()
  const expiresAt = now() + SESSION_TTL
  Database.use((db) => db.insert(PlatformAuthSessionTable).values({ id: `pses-${randomUUID()}`, account_id: accountID, token_hash: tokenHash(token), expires_at: expiresAt, time_created: now() }).run())
  return ensureWorkspaceDirectories({
    token,
    expiresAt,
    account: getAccount(accountID),
    workspaces: listWorkspacesForAccount(accountID),
    capabilities: capabilities(undefined),
  })
}

export function resolveSession(token: string) {
  const row = Database.use((db) => db.select().from(PlatformAuthSessionTable).where(and(eq(PlatformAuthSessionTable.token_hash, tokenHash(token)), isNull(PlatformAuthSessionTable.time_revoked))).get())
  if (!row || row.expires_at < now()) throw new Error("session expired")
  const account = getAccount(row.account_id)
  if (account.status === "frozen") throw new Error("session expired")
  return ensureWorkspaceDirectories({
    token,
    expiresAt: row.expires_at,
    account,
    workspaces: listWorkspacesForAccount(row.account_id),
    capabilities: capabilities(undefined),
  })
}

export function changePassword(input: ChangePasswordPayload) {
  const credential = Database.use((db) => db.select().from(PlatformPasswordCredentialTable).where(eq(PlatformPasswordCredentialTable.account_id, input.accountId)).get())
  if (!credential || !verifyPassword(input.currentPassword, credential.password_hash)) throw new Error("invalid current password")
  const updated = now()
  Database.use((db) => db.update(PlatformPasswordCredentialTable).set({ password_hash: hashPassword(input.newPassword), password_updated_at: updated, time_updated: updated }).where(eq(PlatformPasswordCredentialTable.account_id, input.accountId)).run())
  return true
}

function revokeAccountSessions(accountId: string) {
  const updated = now()
  Database.use((db) =>
    db
      .update(PlatformAuthSessionTable)
      .set({ time_revoked: updated, time_updated: updated })
      .where(and(eq(PlatformAuthSessionTable.account_id, accountId), isNull(PlatformAuthSessionTable.time_revoked)))
      .run(),
  )
}

export function setAccountStatus(input: SetAccountStatusPayload) {
  getAccount(input.accountId)
  const updated = now()
  Database.use((db) =>
    db
      .update(PlatformAccountTable)
      .set({ status: input.status, time_updated: updated })
      .where(and(eq(PlatformAccountTable.id, input.accountId), isNull(PlatformAccountTable.time_deleted)))
      .run(),
  )
  if (input.status === "frozen") revokeAccountSessions(input.accountId)
  return getAccount(input.accountId)
}

export function deleteAccount(session: AuthSession) {
  return adminDeleteAccount({ accountId: session.account.id })
}

export function adminDeleteAccount(input: AdminDeleteAccountPayload) {
  const account = getAccount(input.accountId)
  setAccountStatus({ accountId: account.id, status: "frozen" })
  deleteAccountCatalog(account.id)

  const workspaces = listWorkspacesForAccount(account.id)
  const roots = workspaces.map((item) => item.defaultEnvPath).filter(Boolean)

  Database.transaction((db) => {
    for (const root of roots) {
      const exact = eq(ProjectTable.worktree, root)
      const under = like(ProjectTable.worktree, `${root}/%`)
      db.delete(ProjectTable).where(or(exact, under)).run()
    }

    db.delete(PlatformWorkspaceTable).where(eq(PlatformWorkspaceTable.owner_account_id, account.id)).run()
    db.delete(PlatformAccountTable).where(eq(PlatformAccountTable.id, account.id)).run()
  })

  for (const root of roots) {
    removeWorkspaceDirectoryTree(root)
  }

  return true
}

const passwordResetRequestAt = new Map<string, number>()
const registrationEmailRequestAt = new Map<string, number>()
const registrationEmailCodes = new Map<string, { tokenHash: string; expiresAt: number }>()
const registrationEmailSmtpSkip = new Map<string, { expiresAt: number }>()

function assertPasswordResetCooldown(email: string) {
  const key = normalizeEmail(email)
  const previous = passwordResetRequestAt.get(key) ?? 0
  const current = now()
  const elapsed = current - previous
  if (elapsed < PASSWORD_RESET_REQUEST_COOLDOWN_MS) {
    const retryAfterMs = PASSWORD_RESET_REQUEST_COOLDOWN_MS - elapsed
    throw new LoginFailedError(`请求过于频繁，请 ${Math.ceil(retryAfterMs / 1000)} 秒后再试`, {
      retryAfterMs,
    })
  }
  passwordResetRequestAt.set(key, current)
}

function assertRegistrationEmailCooldown(email: string) {
  const key = normalizeEmail(email)
  const previous = registrationEmailRequestAt.get(key) ?? 0
  const current = now()
  const elapsed = current - previous
  if (elapsed < REGISTRATION_EMAIL_REQUEST_COOLDOWN_MS) {
    const retryAfterMs = REGISTRATION_EMAIL_REQUEST_COOLDOWN_MS - elapsed
    throw new LoginFailedError(`请求过于频繁，请 ${Math.ceil(retryAfterMs / 1000)} 秒后再试`, {
      retryAfterMs,
    })
  }
  registrationEmailRequestAt.set(key, current)
}

export function resetPasswordResetCooldownForTest() {
  passwordResetRequestAt.clear()
}

export function resetRegistrationEmailStateForTest() {
  registrationEmailRequestAt.clear()
  registrationEmailCodes.clear()
  registrationEmailSmtpSkip.clear()
}

function issueRegistrationEmailCode(email: string) {
  const resetToken = generateResetToken()
  const normalized = normalizeResetToken(resetToken)
  registrationEmailCodes.set(email, {
    tokenHash: tokenHash(normalized),
    expiresAt: now() + REGISTRATION_EMAIL_TTL_MS,
  })
  return formatResetToken(normalized)
}

function grantRegistrationSmtpSkip(email: string) {
  registrationEmailSmtpSkip.set(email, { expiresAt: now() + REGISTRATION_EMAIL_TTL_MS })
}

function takeRegistrationSmtpSkip(email: string) {
  const skip = registrationEmailSmtpSkip.get(email)
  if (!skip) return false
  registrationEmailSmtpSkip.delete(email)
  return skip.expiresAt >= now()
}

function consumeRegistrationEmailCode(email: string, code: string | undefined) {
  const trimmed = (code ?? "").trim()
  if (!trimmed) {
    if (takeRegistrationSmtpSkip(email)) return
    throw new Error(REGISTRATION_EMAIL_REQUIRED_MESSAGE)
  }
  const normalized = normalizeResetToken(trimmed)
  if (!normalized) throw new Error(INVALID_REGISTRATION_EMAIL_CODE_MESSAGE)
  const entry = registrationEmailCodes.get(email)
  if (!entry || entry.expiresAt < now() || entry.tokenHash !== tokenHash(normalized)) {
    throw new Error(INVALID_REGISTRATION_EMAIL_CODE_MESSAGE)
  }
  registrationEmailCodes.delete(email)
  registrationEmailSmtpSkip.delete(email)
}

export async function requestRegistrationEmailCode(
  input: RequestRegistrationEmailPayload,
): Promise<RegistrationEmailRequest> {
  const email = assertValidEmail(input.email)

  if (!isMailAvailable()) throw new Error(MAIL_NOT_CONFIGURED_MESSAGE)
  const mail = await resolveMailConfig()
  if (!isMailConfigured(mail)) throw new Error(MAIL_NOT_CONFIGURED_MESSAGE)

  assertRegistrationEmailCooldown(email)

  const taken = Database.use((db) =>
    db
      .select({ id: PlatformAccountTable.id })
      .from(PlatformAccountTable)
      .where(and(eq(PlatformAccountTable.email, email), isNull(PlatformAccountTable.time_deleted)))
      .get(),
  )
  if (taken) throw new Error("该邮箱已注册")

  const code = issueRegistrationEmailCode(email)
  const minutes = Math.max(1, Math.round(REGISTRATION_EMAIL_TTL_MS / 60_000))
  try {
    await sendMail({
      to: email,
      subject: "OneCode 注册邮箱验证码",
      text:
        `您正在注册 OneCode 账号。\n\n` +
        `验证码：${code}\n` +
        `有效期：${minutes} 分钟\n\n` +
        `如非本人操作，请忽略本邮件。`,
    })
  } catch (error) {
    registrationEmailCodes.delete(email)
    if (isSmtpUnreachableError(error)) {
      grantRegistrationSmtpSkip(email)
      return {
        requested: false,
        smtpUnreachable: true,
        retryAfterMs: REGISTRATION_EMAIL_REQUEST_COOLDOWN_MS,
      }
    }
    throw error
  }

  registrationEmailSmtpSkip.delete(email)
  return { requested: true, retryAfterMs: REGISTRATION_EMAIL_REQUEST_COOLDOWN_MS }
}

function issuePasswordResetToken(accountId: string): AdminPasswordResetResult {
  const account = getAccount(accountId)
  const credential = Database.use((db) =>
    db.select().from(PlatformPasswordCredentialTable).where(eq(PlatformPasswordCredentialTable.account_id, account.id)).get(),
  )
  if (!credential) throw new Error("该账号未设置本地密码，无法生成重置凭证")

  const resetToken = generateResetToken()
  const normalized = normalizeResetToken(resetToken)
  const created = now()
  const expiresAt = created + PASSWORD_RESET_TTL_MS

  Database.transaction((db) => {
    db.update(PlatformPasswordResetTokenTable)
      .set({ time_used: created, time_updated: created })
      .where(
        and(
          eq(PlatformPasswordResetTokenTable.account_id, account.id),
          isNull(PlatformPasswordResetTokenTable.time_used),
        ),
      )
      .run()
    db.insert(PlatformPasswordResetTokenTable)
      .values({
        id: `prst-${randomUUID()}`,
        account_id: account.id,
        token_hash: tokenHash(normalized),
        expires_at: expiresAt,
        time_created: created,
      })
      .run()
  })

  return {
    accountId: account.id,
    resetToken: formatResetToken(normalized),
    expiresAt,
  }
}

export async function requestPasswordReset(input: RequestPasswordResetPayload): Promise<PasswordResetRequest> {
  const email = assertValidEmail(input.email)

  const mail = await resolveMailConfig()
  if (!isMailConfigured(mail)) throw new Error(MAIL_NOT_CONFIGURED_MESSAGE)

  assertPasswordResetCooldown(email)

  const row = findAccountByLogin(email)
  if (row) {
    const credential = Database.use((db) =>
      db.select().from(PlatformPasswordCredentialTable).where(eq(PlatformPasswordCredentialTable.account_id, row.id)).get(),
    )
    if (credential) {
      const issued = issuePasswordResetToken(row.id)
      const minutes = Math.max(1, Math.round(PASSWORD_RESET_TTL_MS / 60_000))
      try {
        await sendMail({
          to: row.email,
          subject: "OneCode 密码重置验证码",
          text:
            `您正在重置 OneCode 账号密码。\n\n` +
            `验证码：${issued.resetToken}\n` +
            `有效期：${minutes} 分钟\n\n` +
            `如非本人操作，请忽略本邮件。`,
        })
      } catch (error) {
        if (isSmtpUnreachableError(error)) {
          throw new Error(PASSWORD_RESET_SMTP_UNREACHABLE_MESSAGE)
        }
        throw error
      }
    }
  }

  return { requested: true, retryAfterMs: PASSWORD_RESET_REQUEST_COOLDOWN_MS }
}

export function createAdminPasswordReset(input: AdminPasswordResetPayload): AdminPasswordResetResult {
  return issuePasswordResetToken(input.accountId)
}

export function resetPassword(input: ResetPasswordPayload): boolean {
  if (input.newPassword.length < 8) throw new Error("密码至少需要 8 位")
  const normalized = normalizeResetToken(input.token)
  if (!normalized) throw new Error(INVALID_RESET_TOKEN_MESSAGE)

  const row = Database.use((db) =>
    db
      .select()
      .from(PlatformPasswordResetTokenTable)
      .where(eq(PlatformPasswordResetTokenTable.token_hash, tokenHash(normalized)))
      .get(),
  )
  if (!row || row.time_used != null || row.expires_at < now()) throw new Error(INVALID_RESET_TOKEN_MESSAGE)

  const credential = Database.use((db) =>
    db.select().from(PlatformPasswordCredentialTable).where(eq(PlatformPasswordCredentialTable.account_id, row.account_id)).get(),
  )
  if (!credential) throw new Error("该账号未设置本地密码")

  const updated = now()
  Database.transaction((db) => {
    db.update(PlatformPasswordCredentialTable)
      .set({
        password_hash: hashPassword(input.newPassword),
        password_updated_at: updated,
        time_updated: updated,
      })
      .where(eq(PlatformPasswordCredentialTable.account_id, row.account_id))
      .run()
    db.update(PlatformPasswordResetTokenTable)
      .set({ time_used: updated, time_updated: updated })
      .where(eq(PlatformPasswordResetTokenTable.id, row.id))
      .run()
    db.update(PlatformAuthSessionTable)
      .set({ time_revoked: updated, time_updated: updated })
      .where(and(eq(PlatformAuthSessionTable.account_id, row.account_id), isNull(PlatformAuthSessionTable.time_revoked)))
      .run()
  })
  return true
}

export function listAccounts() {
  return Database.use((db) => db.select().from(PlatformAccountTable).where(isNull(PlatformAccountTable.time_deleted)).orderBy(desc(PlatformAccountTable.time_created)).all().map(accountFromRow))
}

export function detail(accountID: string) {
  const account = getAccount(accountID)
  const identities = Database.use((db) => db.select().from(PlatformAuthIdentityTable).where(eq(PlatformAuthIdentityTable.account_id, accountID)).all().map((row) => ({ id: row.id, provider: row.provider, subject: row.subject, accountId: row.account_id, ...(row.email ? { email: row.email } : {}), ...(row.name ? { name: row.name } : {}) })))
  const workspaces = listWorkspacesForAccount(accountID)
  const quotas = Database.use((db) => db.select().from(PlatformResourceQuotaTable).where(eq(PlatformResourceQuotaTable.account_id, accountID)).all().map(quotaFromRow))
  const usage = Database.use((db) => db.select().from(PlatformResourceUsageTable).where(eq(PlatformResourceUsageTable.account_id, accountID)).orderBy(desc(PlatformResourceUsageTable.time_created)).limit(50).all().map(usageFromRow))
  return { account, identities, workspaces, quotas, usage }
}

export function listQuotas() {
  return Database.use((db) => db.select().from(PlatformResourceQuotaTable).all().map(quotaFromRow))
}

export function upsertQuota(input: UpdateQuotaPayload) {
  const existing = Database.use((db) => db.select().from(PlatformResourceQuotaTable).where(and(eq(PlatformResourceQuotaTable.workspace_id, input.workspaceId), input.accountId ? eq(PlatformResourceQuotaTable.account_id, input.accountId) : sql`${PlatformResourceQuotaTable.account_id} IS NULL`)).get())
  const values = {
    workspace_id: input.workspaceId,
    account_id: input.accountId ?? null,
    cpu_limit: input.cpuLimit ?? null,
    memory_limit_mb: input.memoryLimitMb ?? null,
    gpu_limit: input.gpuLimit ?? null,
    storage_limit_mb: input.storageLimitMb ?? null,
    session_limit: input.sessionLimit ?? null,
    monthly_token_limit: input.monthlyTokenLimit ?? null,
    monthly_cost_limit: input.monthlyCostLimit ?? null,
    time_updated: now(),
  }
  if (existing) {
    Database.use((db) => db.update(PlatformResourceQuotaTable).set(values).where(eq(PlatformResourceQuotaTable.id, existing.id)).run())
    return quotaFromRow({ ...existing, ...values })
  }
  const row = { id: `quota-${randomUUID()}`, ...values, time_created: now() }
  Database.use((db) => db.insert(PlatformResourceQuotaTable).values(row).run())
  return quotaFromRow(row)
}

export function recordUsage(input: CreateUsagePayload) {
  const time = now()
  const row = {
    id: `usage-${randomUUID()}`,
    workspace_id: input.workspaceId,
    account_id: input.accountId,
    resource_type: input.resourceType,
    amount: input.amount,
    unit: input.unit,
    source_id: input.sourceId ?? null,
    source_type: input.sourceType ?? null,
    metadata: input.metadata ?? null,
    time_created: time,
    time_updated: time,
  }
  Database.use((db) => db.insert(PlatformResourceUsageTable).values(row).run())
  return usageFromRow(row)
}

export function listUsage(input?: { accountId?: string; workspaceId?: string }) {
  return Database.use((db) => db.select().from(PlatformResourceUsageTable).where(and(input?.accountId ? eq(PlatformResourceUsageTable.account_id, input.accountId) : undefined, input?.workspaceId ? eq(PlatformResourceUsageTable.workspace_id, input.workspaceId) : undefined)).orderBy(desc(PlatformResourceUsageTable.time_created)).limit(200).all().map(usageFromRow))
}
