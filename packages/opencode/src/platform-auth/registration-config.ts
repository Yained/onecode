import fs from "fs/promises"
import fsSync from "fs"
import path from "path"
import { randomBytes } from "node:crypto"
import { Global } from "@opencode-ai/core/global"
import { isMailAvailable } from "@/messaging/mail-config"

export type FixedInvite = {
  code: string
  expiresAt: number
  ttlDays: 7 | 14 | 30
}

export type RandomInvite = {
  code: string
  expiresAt: number
  usedAt?: number
}

export type RegistrationConfig = {
  inviteRequired: boolean
  fixedInvite?: FixedInvite
  randomInvites: RandomInvite[]
}

export type RegistrationConfigView = {
  inviteRequired: boolean
  fixedInvite?: { code: string; expiresAt: number; ttlDays?: number }
  randomInvites: Array<{ code: string; expiresAt: number; usedAt?: number }>
}

export const INVITE_REQUIRED_MESSAGE = "当前开启注册审核，请填写有效邀请码"
export const INVALID_INVITE_MESSAGE = "邀请码无效或已过期"
export const RANDOM_INVITE_TTL_MS = 30 * 60 * 1000

function trim(value: string | undefined | null) {
  return (value ?? "").trim()
}

function overridePath() {
  return path.join(Global.Path.data, "onescience-registration.json")
}

function normalizeCode(code: string) {
  return trim(code).toUpperCase()
}

async function readStore(): Promise<RegistrationConfig> {
  try {
    const raw = await fs.readFile(overridePath(), "utf8")
    return parseStore(raw)
  } catch {
    return { inviteRequired: false, randomInvites: [] }
  }
}

function readStoreSync(): RegistrationConfig {
  try {
    const raw = fsSync.readFileSync(overridePath(), "utf8")
    return parseStore(raw)
  } catch {
    return { inviteRequired: false, randomInvites: [] }
  }
}

function parseStore(raw: string): RegistrationConfig {
  const parsed = JSON.parse(raw) as Partial<RegistrationConfig>
  return {
    inviteRequired: Boolean(parsed.inviteRequired),
    ...(parsed.fixedInvite?.code
      ? {
          fixedInvite: {
            code: normalizeCode(parsed.fixedInvite.code),
            expiresAt: Number(parsed.fixedInvite.expiresAt) || 0,
            ttlDays: ([7, 14, 30].includes(Number(parsed.fixedInvite.ttlDays))
              ? Number(parsed.fixedInvite.ttlDays)
              : 30) as 7 | 14 | 30,
          },
        }
      : {}),
    randomInvites: Array.isArray(parsed.randomInvites)
      ? parsed.randomInvites
          .filter((item) => item && typeof item.code === "string")
          .map((item) => ({
            code: normalizeCode(item.code),
            expiresAt: Number(item.expiresAt) || 0,
            ...(item.usedAt ? { usedAt: Number(item.usedAt) } : {}),
          }))
      : [],
  }
}

async function writeStore(next: RegistrationConfig) {
  await fs.mkdir(path.dirname(overridePath()), { recursive: true })
  await fs.writeFile(overridePath(), JSON.stringify(next, null, 2) + "\n", { mode: 0o600 })
}

function writeStoreSync(next: RegistrationConfig) {
  fsSync.mkdirSync(path.dirname(overridePath()), { recursive: true })
  fsSync.writeFileSync(overridePath(), JSON.stringify(next, null, 2) + "\n", { mode: 0o600 })
}

function pruneRandom(invites: RandomInvite[], now = Date.now()) {
  return invites.filter((item) => !item.usedAt && item.expiresAt > now).slice(-50)
}

export async function viewRegistrationConfig(): Promise<RegistrationConfigView> {
  const cfg = await readStore()
  const now = Date.now()
  return {
    inviteRequired: cfg.inviteRequired,
    ...(cfg.fixedInvite
      ? {
          fixedInvite: {
            code: cfg.fixedInvite.code,
            expiresAt: cfg.fixedInvite.expiresAt,
            ttlDays: cfg.fixedInvite.ttlDays,
          },
        }
      : {}),
    randomInvites: pruneRandom(cfg.randomInvites, now).map((item) => ({
      code: item.code,
      expiresAt: item.expiresAt,
      ...(item.usedAt ? { usedAt: item.usedAt } : {}),
    })),
  }
}

export async function publicRegistrationGate() {
  const cfg = await readStore()
  return {
    inviteRequired: Boolean(cfg.inviteRequired),
    /** When SMTP is configured, register UI must send/verify an email code. */
    emailVerificationRequired: isMailAvailable(),
  }
}

export async function updateRegistrationConfig(input: {
  inviteRequired?: boolean
  fixedCode?: string
  fixedTtlDays?: 7 | 14 | 30
  clearFixedInvite?: boolean
}) {
  const current = await readStore()
  const next: RegistrationConfig = {
    inviteRequired: input.inviteRequired ?? current.inviteRequired,
    randomInvites: pruneRandom(current.randomInvites),
  }

  if (input.clearFixedInvite) {
    // drop fixed invite
  } else if (input.fixedCode !== undefined || input.fixedTtlDays !== undefined || current.fixedInvite) {
    const code = normalizeCode(input.fixedCode ?? current.fixedInvite?.code ?? "")
    const ttlDays = (input.fixedTtlDays ?? current.fixedInvite?.ttlDays ?? 30) as 7 | 14 | 30
    if (code) {
      const refreshed = input.fixedCode !== undefined || input.fixedTtlDays !== undefined
      next.fixedInvite = {
        code,
        ttlDays,
        expiresAt: refreshed ? Date.now() + ttlDays * 24 * 60 * 60 * 1000 : current.fixedInvite!.expiresAt,
      }
    }
  }

  await writeStore(next)
  return viewRegistrationConfig()
}

function generateInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const bytes = randomBytes(8)
  let out = ""
  for (const byte of bytes) out += alphabet[byte % alphabet.length]
  return `${out.slice(0, 4)}-${out.slice(4)}`
}

export async function createRandomInvite() {
  const current = await readStore()
  const code = generateInviteCode()
  const expiresAt = Date.now() + RANDOM_INVITE_TTL_MS
  const next: RegistrationConfig = {
    ...current,
    randomInvites: pruneRandom([...current.randomInvites, { code, expiresAt }]),
  }
  await writeStore(next)
  return { code, expiresAt }
}

/** Validates and consumes invite when required. Throws on failure. */
export async function assertAndConsumeInvite(inviteCode: string | undefined) {
  assertAndConsumeInviteSync(inviteCode)
}

export function assertAndConsumeInviteSync(inviteCode: string | undefined) {
  const cfg = readStoreSync()
  if (!cfg.inviteRequired) return

  const code = normalizeCode(inviteCode ?? "")
  if (!code) throw new Error(INVITE_REQUIRED_MESSAGE)

  const now = Date.now()
  if (cfg.fixedInvite && cfg.fixedInvite.code === code && cfg.fixedInvite.expiresAt > now) {
    return
  }

  const idx = cfg.randomInvites.findIndex(
    (item) => item.code === code && !item.usedAt && item.expiresAt > now,
  )
  if (idx < 0) throw new Error(INVALID_INVITE_MESSAGE)

  const nextInvites = cfg.randomInvites.slice()
  nextInvites[idx] = { ...nextInvites[idx]!, usedAt: now }
  writeStoreSync({
    ...cfg,
    randomInvites: nextInvites,
  })
}

export async function resetRegistrationConfigForTest() {
  await writeStore({ inviteRequired: false, randomInvites: [] })
}
