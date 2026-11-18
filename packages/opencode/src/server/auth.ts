export * as ServerAuth from "./auth"

import { ConfigService } from "@/effect/config-service"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Config as EffectConfig, Context, Option, Redacted } from "effect"

export type Credentials = {
  password?: string
  username?: string
}

export type DecodedCredentials = {
  readonly username: string
  readonly password: Redacted.Redacted
}

export class Config extends ConfigService.Service<Config>()("@opencode/ServerAuthConfig", {
  password: EffectConfig.string("OPENCODE_SERVER_PASSWORD").pipe(EffectConfig.option),
  username: EffectConfig.string("OPENCODE_SERVER_USERNAME").pipe(EffectConfig.withDefault("")),
}) {}

export type Info = Context.Service.Shape<typeof Config>

export type StartupAuth = {
  enabled: boolean
  generated: boolean
  password?: string
  username: string
}

export function required(config: Info) {
  // Workspace shared-password gate is retired for serve/web CLI. Desktop sidecar
  // and test harnesses may still use Basic when a password is configured.
  const client = process.env.OPENCODE_CLIENT
  if (client === "serve" || client === "web") return false
  return Option.isSome(config.password) && config.password.value !== ""
}

export function authorized(credentials: DecodedCredentials, config: Info) {
  if (!required(config)) return false
  return (
    Option.isSome(config.password) &&
    credentials.username === config.username &&
    Redacted.value(credentials.password) === config.password.value
  )
}

export function header(credentials?: Credentials) {
  const password = credentials?.password ?? Flag.OPENCODE_SERVER_PASSWORD
  if (!password) return undefined

  const username = credentials?.username ?? Flag.OPENCODE_SERVER_USERNAME ?? ""
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

export function token(credentials?: Credentials) {
  const password = credentials?.password ?? Flag.OPENCODE_SERVER_PASSWORD
  if (!password) return undefined

  return Buffer.from(`${credentials?.username ?? Flag.OPENCODE_SERVER_USERNAME ?? ""}:${password}`).toString("base64")
}

export function urlToken(credentials?: Credentials) {
  return credentials?.password ?? Flag.OPENCODE_SERVER_PASSWORD
}

export function headers(credentials?: Credentials) {
  const authorization = header(credentials)
  if (!authorization) return undefined
  return { Authorization: authorization }
}

export function clearStartupAuth() {
  delete process.env.OPENCODE_SERVER_PASSWORD
  delete process.env.OPENCODE_SERVER_USERNAME
  Flag.OPENCODE_SERVER_PASSWORD = undefined
  Flag.OPENCODE_SERVER_USERNAME = undefined
}

/** True when CLI/env still try to enable the retired workspace HTTP gate. */
export function hasRetiredWorkspaceGateInput(input?: {
  token?: string
  password?: string
  username?: string
}) {
  return Boolean(
    input?.token?.trim() ||
      input?.password?.trim() ||
      input?.username?.trim() ||
      Flag.OPENCODE_SERVER_PASSWORD ||
      process.env.OPENCODE_SERVER_PASSWORD ||
      Flag.OPENCODE_SERVER_USERNAME ||
      process.env.OPENCODE_SERVER_USERNAME,
  )
}

/**
 * Workspace HTTP gate is retired. Always clears shared-password env/flags and
 * never enables auth from --token / OPENCODE_SERVER_PASSWORD.
 */
export function ensureStartupAuth(_credentials?: Credentials): StartupAuth {
  clearStartupAuth()
  return { enabled: false, generated: false, username: "", password: undefined }
}

export function logRetiredWorkspaceGateIgnored() {
  console.log("Note: --token / OPENCODE_SERVER_PASSWORD are ignored; use platform account login.")
}
