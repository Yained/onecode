import fs from "fs/promises"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { isOnescienceProviderEnabled, resolvePresetSecret } from "./onescience-preset-enabled"

export const PROVIDER_ID = "onescience"
export const DEFAULT_BASE_URL = "https://rehdasu.cn/v1"
export const DEFAULT_MODEL_ID = "gpt-5.6-luna"
export const DEFAULT_MODEL_NAME = "OneScience GPT"
export const DEFAULT_PROVIDER_NAME = "OneScience"

/** Built-in free GLM preset (separate endpoint/key from the GPT preset). */
export const GLM_MODEL_ID = "glm-5.2"
export const GLM_MODEL_NAME = "OneScience GLM"
export const GLM_BASE_URL = "http://47.84.183.235:18081/v1/"

declare const ONECODE_PRESET_GPT_API_KEY: string | undefined
declare const ONECODE_PRESET_GLM_API_KEY: string | undefined
declare const ONECODE_PRESET_ADMIN_PASSWORD: string | undefined

export type OnesciencePresetConfig = {
  baseURL: string
  apiKey: string
  modelID: string
  modelName: string
  providerName: string
}

export type OnescienceGlmPreset = {
  enabled: boolean
  baseURL: string
  apiKey: string
  modelID: string
  modelName: string
}

export type OnesciencePresetPublic = {
  modelEnabled: boolean
  adminEnabled: boolean
  baseURL: string
  modelID: string
  modelName: string
  providerName: string
  hasApiKey: boolean
  glmEnabled: boolean
  lockedUntil?: number
  retryAfterMs?: number
}

export type OnesciencePresetOverride = Partial<OnesciencePresetConfig>

type Session = { token: string; expires: number }

const sessions = new Map<string, Session>()
const SESSION_TTL_MS = 1000 * 60 * 60

function trim(value: string | undefined | null) {
  return (value ?? "").trim()
}

function bakedApiKey() {
  return typeof ONECODE_PRESET_GPT_API_KEY !== "undefined" ? trim(ONECODE_PRESET_GPT_API_KEY) : ""
}

function bakedGlmApiKey() {
  return typeof ONECODE_PRESET_GLM_API_KEY !== "undefined" ? trim(ONECODE_PRESET_GLM_API_KEY) : ""
}

function bakedAdminPassword() {
  return typeof ONECODE_PRESET_ADMIN_PASSWORD !== "undefined" ? trim(ONECODE_PRESET_ADMIN_PASSWORD) : ""
}

function envApiKey() {
  return process.env.ONECODE_PRESET_GPT_API_KEY
}

function envGlmApiKey() {
  return process.env.ONECODE_PRESET_GLM_API_KEY
}

function envAdminPassword() {
  return trim(process.env.ONECODE_PRESET_ADMIN_PASSWORD)
}

/** First non-empty of override / env / CI bake. Empty means this model is hidden. */
export function resolvedApiKey(overrideKey?: string) {
  return resolvePresetSecret({
    override: overrideKey,
    env: envApiKey(),
    baked: bakedApiKey(),
  })
}

/** First non-empty of env / CI bake. Empty means this model is hidden. */
export function resolvedGlmApiKey() {
  return resolvePresetSecret({
    env: envGlmApiKey(),
    baked: bakedGlmApiKey(),
  })
}

export function resolvedAdminPassword() {
  return envAdminPassword() || bakedAdminPassword()
}

export function resolveGlmPreset(): OnescienceGlmPreset {
  const apiKey = resolvedGlmApiKey()
  return {
    enabled: Boolean(apiKey),
    baseURL: GLM_BASE_URL,
    apiKey,
    modelID: GLM_MODEL_ID,
    modelName: GLM_MODEL_NAME,
  }
}

function overridePath() {
  return path.join(Global.Path.data, "onescience-preset.json")
}

async function readOverride(): Promise<OnesciencePresetOverride> {
  try {
    const raw = await fs.readFile(overridePath(), "utf8")
    const parsed = JSON.parse(raw) as OnesciencePresetOverride
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

async function writeOverride(next: OnesciencePresetOverride) {
  await fs.mkdir(path.dirname(overridePath()), { recursive: true })
  await fs.writeFile(overridePath(), JSON.stringify(next, null, 2) + "\n", { mode: 0o600 })
}

export async function resolveConfig(): Promise<OnesciencePresetConfig> {
  const override = await readOverride()
  const providerName = trim(override.providerName) || DEFAULT_PROVIDER_NAME
  return {
    baseURL: trim(override.baseURL) || DEFAULT_BASE_URL,
    apiKey: resolvedApiKey(override.apiKey),
    modelID: trim(override.modelID) || DEFAULT_MODEL_ID,
    modelName: trim(override.modelName) || DEFAULT_MODEL_NAME,
    // Migrate the previous default display name.
    providerName: providerName === "OneScience GPT" ? DEFAULT_PROVIDER_NAME : providerName,
  }
}

export async function status(): Promise<OnesciencePresetPublic> {
  const cfg = await resolveConfig()
  const glm = resolveGlmPreset()
  const now = Date.now()
  const lock = await readLock()
  const lockedUntil = lock.lockedUntil > now ? lock.lockedUntil : undefined
  return {
    modelEnabled: isOnescienceProviderEnabled({ gptApiKey: cfg.apiKey, glmApiKey: glm.apiKey }),
    adminEnabled: Boolean(resolvedAdminPassword()),
    baseURL: cfg.baseURL,
    modelID: cfg.modelID,
    modelName: cfg.modelName,
    providerName: cfg.providerName,
    hasApiKey: Boolean(cfg.apiKey),
    glmEnabled: glm.enabled,
    lockedUntil,
    retryAfterMs: lockedUntil ? lockedUntil - now : undefined,
  }
}

export function verifyAdminPassword(password: string) {
  const expected = resolvedAdminPassword()
  if (!expected) return false
  return trim(password) === expected
}

type LockState = {
  failures: number
  lockedUntil: number
}

const MAX_LOCK_MS = 60 * 60 * 1000

/** Cooldown after N consecutive failures. Caps at 1 hour. */
export function lockoutMs(failures: number) {
  if (failures <= 1) return 0
  if (failures === 2) return 5_000
  if (failures === 3) return 15_000
  if (failures === 4) return 30_000
  if (failures === 5) return 60_000
  if (failures === 6) return 5 * 60_000
  if (failures === 7) return 15 * 60_000
  return MAX_LOCK_MS
}

function lockPath() {
  return path.join(Global.Path.data, "onescience-admin-lock.json")
}

async function readLock(): Promise<LockState> {
  try {
    const raw = await fs.readFile(lockPath(), "utf8")
    const parsed = JSON.parse(raw) as Partial<LockState>
    return {
      failures: typeof parsed.failures === "number" && parsed.failures > 0 ? Math.floor(parsed.failures) : 0,
      lockedUntil: typeof parsed.lockedUntil === "number" ? parsed.lockedUntil : 0,
    }
  } catch {
    return { failures: 0, lockedUntil: 0 }
  }
}

async function writeLock(next: LockState) {
  await fs.mkdir(path.dirname(lockPath()), { recursive: true })
  await fs.writeFile(lockPath(), JSON.stringify(next, null, 2) + "\n", { mode: 0o600 })
}

async function clearLock() {
  await fs.unlink(lockPath()).catch(() => undefined)
}

export type AdminLoginResult =
  | { ok: true; token: string }
  | { ok: false; lockedUntil?: number; retryAfterMs?: number; failures?: number }

export async function attemptAdminLogin(password: string): Promise<AdminLoginResult> {
  if (!resolvedAdminPassword()) return { ok: false }

  const now = Date.now()
  const lock = await readLock()
  if (lock.lockedUntil > now) {
    return {
      ok: false,
      lockedUntil: lock.lockedUntil,
      retryAfterMs: lock.lockedUntil - now,
      failures: lock.failures,
    }
  }

  if (!verifyAdminPassword(password)) {
    const failures = lock.failures + 1
    const wait = lockoutMs(failures)
    const lockedUntil = wait > 0 ? now + wait : 0
    await writeLock({ failures, lockedUntil })
    return {
      ok: false,
      lockedUntil: lockedUntil || undefined,
      retryAfterMs: wait || undefined,
      failures,
    }
  }

  await clearLock()
  const token = crypto.randomUUID()
  sessions.set(token, { token, expires: now + SESSION_TTL_MS })
  return { ok: true, token }
}

export function verifyAdminSession(token: string | undefined) {
  if (!token) return false
  const session = sessions.get(token)
  if (!session) return false
  if (Date.now() > session.expires) {
    sessions.delete(token)
    return false
  }
  return true
}

export async function updateConfig(
  input: {
    baseURL?: string
    apiKey?: string
    modelID?: string
    modelName?: string
    providerName?: string
  },
  options?: { clearApiKey?: boolean },
) {
  const current = await readOverride()
  const next: OnesciencePresetOverride = { ...current }

  if (input.baseURL !== undefined) next.baseURL = trim(input.baseURL) || DEFAULT_BASE_URL
  if (input.modelID !== undefined) next.modelID = trim(input.modelID) || DEFAULT_MODEL_ID
  if (input.modelName !== undefined) next.modelName = trim(input.modelName) || DEFAULT_MODEL_NAME
  if (input.providerName !== undefined) next.providerName = trim(input.providerName) || DEFAULT_PROVIDER_NAME

  if (options?.clearApiKey) {
    next.apiKey = ""
  } else if (input.apiKey !== undefined) {
    const key = trim(input.apiKey)
    if (key) next.apiKey = key
  }

  await writeOverride(next)
  return resolveConfig()
}

export async function resetOverride() {
  await fs.unlink(overridePath()).catch(() => undefined)
  return resolveConfig()
}

export function isOnesciencePreset(providerID: string) {
  return providerID === PROVIDER_ID
}

export { isOnescienceProviderEnabled }
