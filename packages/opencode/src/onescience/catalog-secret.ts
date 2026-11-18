import { createCipheriv, createDecipheriv, randomBytes } from "crypto"
import { catalogBadRequest, catalogUnavailable } from "./catalog-error"

/** Same soft-gate pattern as ONECODE_SMTP_PASS: missing key disables the feature. */
export const SECRET_MASTER_KEY_NOT_CONFIGURED_MESSAGE = "对象存储与私有数据库接入未配置，请联系管理员"

declare const ONECODE_OBJECT_STORE_MASTER_KEY: string | undefined

function trim(value: string | undefined | null) {
  return (value ?? "").trim()
}

function bakedMasterKey() {
  return typeof ONECODE_OBJECT_STORE_MASTER_KEY !== "undefined" ? trim(ONECODE_OBJECT_STORE_MASTER_KEY) : ""
}

function envMasterKey() {
  return trim(process.env.ONECODE_OBJECT_STORE_MASTER_KEY)
}

/** Runtime env wins over build-time bake-in (empty env falls through to baked). */
export function resolvedSecretMasterKeyRaw() {
  return envMasterKey() || bakedMasterKey()
}

function decodeMasterKey(raw: string) {
  const buf = Buffer.from(raw, "base64")
  if (buf.length !== 32) throw catalogBadRequest("ONECODE_OBJECT_STORE_MASTER_KEY must be 32-byte base64")
  return buf
}

/** True when a usable 32-byte master key is present (env or bake-in). */
export function isSecretMasterKeyAvailable() {
  const raw = resolvedSecretMasterKeyRaw()
  if (!raw) return false
  try {
    decodeMasterKey(raw)
    return true
  } catch {
    return false
  }
}

export function requireSecretMasterKey() {
  const raw = resolvedSecretMasterKeyRaw()
  if (!raw) throw catalogUnavailable(SECRET_MASTER_KEY_NOT_CONFIGURED_MESSAGE)
  return decodeMasterKey(raw)
}

export function encryptSecret(secret: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", requireSecretMasterKey(), iv)
  const enc = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`
}

export function decryptSecret(ciphertext: string) {
  const parts = ciphertext.split(":")
  if (parts[0] !== "v1" || parts.length !== 4) throw catalogUnavailable("Stored catalog secret cannot be decrypted")
  const iv = Buffer.from(parts[1]!, "base64")
  const tag = Buffer.from(parts[2]!, "base64")
  const enc = Buffer.from(parts[3]!, "base64")
  const decipher = createDecipheriv("aes-256-gcm", requireSecretMasterKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8")
}
