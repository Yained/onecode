import fs from "fs/promises"
import path from "path"
import { Global } from "@opencode-ai/core/global"

export type MailConfig = {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  from: string
}

export type MailConfigOverride = Partial<MailConfig> & {
  testTo?: string
  clearPassword?: boolean
}

export type MailConfigView = {
  host: string
  port: number
  secure: boolean
  user: string
  from: string
  testTo: string
  hasPassword: boolean
  configured: boolean
  source: "builtin" | "env" | "mixed" | "none"
}

/** Built-in Foxmail SMTP — only applied when ONECODE_SMTP_PASS is present. */
export const DEFAULT_MAIL = {
  host: "smtp.qq.com",
  port: 465,
  secure: true,
  user: "mk_han@foxmail.com",
  from: "OneCode <mk_han@foxmail.com>",
} as const

const EMPTY_MAIL: MailConfig = {
  host: "",
  port: 587,
  secure: false,
  user: "",
  pass: "",
  from: "",
}

type MailUiPrefs = {
  /** Admin “send test email” recipient — optional, never defaulted to SMTP user. */
  testTo?: string
}

export const MAIL_NOT_CONFIGURED_MESSAGE = "邮件找回未配置，请联系管理员"

declare const ONECODE_SMTP_PASS: string | undefined

function trim(value: string | undefined | null) {
  return (value ?? "").trim()
}

function bakedPass() {
  return typeof ONECODE_SMTP_PASS !== "undefined" ? trim(ONECODE_SMTP_PASS) : ""
}

function envPass() {
  return trim(process.env.ONECODE_SMTP_PASS)
}

/** Runtime env wins over build-time bake-in (empty env falls through to baked). */
export function resolvedMailPass() {
  return envPass() || bakedPass()
}

export function isMailConfigured(cfg: Pick<MailConfig, "host" | "from">) {
  return Boolean(trim(cfg.host) && trim(cfg.from))
}

function sourceOf(pass: string): MailConfigView["source"] {
  const hasEnv = Boolean(envPass())
  const hasBaked = Boolean(bakedPass())
  if (!trim(pass)) return "none"
  if (hasEnv && hasBaked) return "mixed"
  if (hasEnv) return "env"
  if (hasBaked) return "builtin"
  return "none"
}

function prefsPath() {
  return path.join(Global.Path.data, "onescience-mail.json")
}

async function readUiPrefs(): Promise<MailUiPrefs> {
  try {
    const raw = await fs.readFile(prefsPath(), "utf8")
    const data = JSON.parse(raw) as unknown
    if (!data || typeof data !== "object") return {}
    const testTo = "testTo" in data && typeof (data as { testTo?: unknown }).testTo === "string"
      ? trim((data as { testTo: string }).testTo)
      : ""
    return testTo ? { testTo } : {}
  } catch {
    return {}
  }
}

async function writeUiPrefs(prefs: MailUiPrefs) {
  const testTo = trim(prefs.testTo)
  await fs.mkdir(path.dirname(prefsPath()), { recursive: true })
  await fs.writeFile(prefsPath(), `${JSON.stringify(testTo ? { testTo } : {}, null, 2)}\n`, { mode: 0o600 })
}

/** Sync resolve — same rules as {@link resolveMailConfig}. */
export function resolveMailConfigSync(): MailConfig {
  const pass = resolvedMailPass()
  // No auth code → do not expose built-in SMTP defaults (treat as unconfigured).
  if (!pass) return { ...EMPTY_MAIL }

  return {
    host: DEFAULT_MAIL.host,
    port: DEFAULT_MAIL.port,
    secure: DEFAULT_MAIL.secure,
    user: DEFAULT_MAIL.user,
    from: DEFAULT_MAIL.from,
    pass,
  }
}

export async function resolveMailConfig(): Promise<MailConfig> {
  return resolveMailConfigSync()
}

/** True when SMTP host/from/pass are present (same gate as password-reset email). */
export function isMailAvailable() {
  const cfg = resolveMailConfigSync()
  return isMailConfigured(cfg) && Boolean(cfg.pass.trim())
}

/** Merge saved/builtin config with a one-off override (e.g. admin test form before save). */
export async function resolveMailConfigWithOverride(override?: Partial<MailConfig>): Promise<MailConfig> {
  const base = await resolveMailConfig()
  if (!override) return base

  const host = trim(override.host) || base.host
  const user = trim(override.user) || base.user
  const from = trim(override.from) || base.from || (user.includes("@") ? user : "")
  const pass = trim(override.pass) || base.pass
  const portRaw = override.port
  const port =
    portRaw !== undefined && Number.isFinite(Number(portRaw)) && Number(portRaw) > 0
      ? Math.floor(Number(portRaw))
      : base.port || (override.secure ?? base.secure ? 465 : 587)
  const secure = override.secure !== undefined ? Boolean(override.secure) : base.secure || port === 465

  return { host, port, secure, user, from, pass }
}

export async function viewMailConfig(): Promise<MailConfigView> {
  const cfg = await resolveMailConfig()
  const prefs = await readUiPrefs()
  const pass = trim(cfg.pass)
  return {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
    from: cfg.from,
    // Only a previously saved test recipient — never SMTP user/from.
    testTo: prefs.testTo ?? "",
    hasPassword: Boolean(pass),
    configured: isMailConfigured(cfg) && Boolean(pass),
    source: sourceOf(pass),
  }
}

/** Persist UI prefs (test recipient). SMTP host/user/pass stay baked/env. */
export async function writeMailOverride(input: MailConfigOverride = {}) {
  if (input.testTo !== undefined) {
    await writeUiPrefs({ testTo: input.testTo })
  }
  return viewMailConfig()
}
