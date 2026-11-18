import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { OneCodeExtraPath } from "@opencode-ai/core/extra-path"
import * as Log from "@opencode-ai/core/util/log"
import { existsSync, readFileSync } from "fs"
import path from "path"
import { isRecord } from "@/util/record"
import { ConfigParse } from "./parse"
import { ConfigProvider } from "./provider"

const log = Log.create({ service: "public-providers" })

const ONESCIENCE_ID = "onescience"

type ProviderInfo = ConfigProvider.Info

let loaded = false
let snapshot: Record<string, ProviderInfo> = {}

function publicConfigDir() {
  if (Flag.OPENCODE_CONFIG_DIR) return Flag.OPENCODE_CONFIG_DIR
  const extra = OneCodeExtraPath.configDir()
  if (extra) return extra
  return Global.Path.config
}

/** Shared opencode.json used as the public-provider snapshot (json, then jsonc fallback). */
export function filePath() {
  const dir = publicConfigDir()
  const json = path.join(dir, "opencode.json")
  if (existsSync(json)) return json
  const jsonc = path.join(dir, "opencode.jsonc")
  if (existsSync(jsonc)) return jsonc
  return json
}

function apiKeyOf(value: ProviderInfo) {
  const key = value.options?.apiKey
  return typeof key === "string" ? key.trim() : ""
}

function baseURLOf(value: ProviderInfo) {
  const url = value.options?.baseURL
  return typeof url === "string" ? url.trim() : ""
}

function hasModels(value: ProviderInfo) {
  return !!value.models && Object.keys(value.models).length > 0
}

function isConnectable(id: string, value: ProviderInfo) {
  if (id === ONESCIENCE_ID) return false
  if (value.npm && baseURLOf(value) && hasModels(value)) return true
  if (apiKeyOf(value)) return true
  return false
}

function readFromDisk(): Record<string, ProviderInfo> {
  const file = filePath()
  if (!existsSync(file)) return {}

  let parsed: unknown
  try {
    parsed = ConfigParse.jsonc(readFileSync(file, "utf8"), file)
  } catch (error) {
    log.error("public opencode.json is not valid JSONC; ignoring public providers", {
      file,
      error: String(error),
    })
    return {}
  }

  if (!isRecord(parsed)) {
    log.error("public opencode.json must be an object; ignoring public providers", { file })
    return {}
  }

  const rawProviders = parsed.provider
  if (rawProviders === undefined) return {}
  if (!isRecord(rawProviders)) {
    log.error("public opencode.json provider must be an object; ignoring public providers", { file })
    return {}
  }

  const next: Record<string, ProviderInfo> = {}
  try {
    for (const [id, value] of Object.entries(rawProviders)) {
      next[id] = ConfigParse.schema(ConfigProvider.Info, value, `${file}#provider.${id}`)
    }
  } catch (error) {
    log.error("public opencode.json failed schema validation; ignoring public providers", {
      file,
      error: String(error),
    })
    return {}
  }

  const accepted: Record<string, ProviderInfo> = {}
  for (const [id, value] of Object.entries(next)) {
    if (id === ONESCIENCE_ID) {
      log.warn("skipping reserved onescience id in public opencode.json", { file })
      continue
    }
    if (!isConnectable(id, value)) {
      log.warn("skipping public provider that cannot connect (need npm+baseURL+models or apiKey)", {
        file,
        id,
      })
      continue
    }
    accepted[id] = value
  }
  if (Object.keys(accepted).length > 0) {
    log.info("loaded public providers from shared opencode.json", {
      file,
      ids: Object.keys(accepted),
    })
  }
  return accepted
}

/** Load the shared snapshot once per process. Later file edits require a restart. */
export function loadOnce() {
  if (loaded) return
  loaded = true
  snapshot = readFromDisk()
}

export function providers(): Record<string, ProviderInfo> {
  return snapshot
}

export function ids(): Set<string> {
  return new Set(Object.keys(snapshot))
}

export function has(id: string) {
  return Object.prototype.hasOwnProperty.call(snapshot, id)
}

export const testing = {
  replace(providers: Record<string, ProviderInfo>) {
    loaded = true
    snapshot = { ...providers }
  },
  reset() {
    loaded = false
    snapshot = {}
  },
}

export * as PublicProviders from "./public-providers"
