import { existsSync, mkdirSync } from "fs"
import path from "path"
import { Flag } from "./flag/flag"

export function root() {
  const value = Flag.ONECODE_EXTRA_PATH?.trim()
  if (!value) return undefined
  return path.resolve(value)
}

export function configDir() {
  const extra = root()
  if (!extra) return undefined
  return path.join(extra, ".config", "opencode")
}

export function ensureDirs() {
  const extra = root()
  if (!extra) return
  mkdirSync(extra, { recursive: true })
  mkdirSync(path.join(extra, ".config", "opencode"), { recursive: true })
}

export function configDirIfExists() {
  const dir = configDir()
  if (!dir || !existsSync(dir)) return undefined
  return dir
}

export function projectDataRoot() {
  return root() ?? "/data"
}

export * as OneCodeExtraPath from "./extra-path"
