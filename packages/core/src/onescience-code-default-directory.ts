import { mkdirSync } from "fs"
import os from "os"
import path from "path"
import { OneCodeExtraPath } from "./extra-path"

function isDesktopClient() {
  return (process.env.OPENCODE_CLIENT ?? "cli") === "desktop"
}

/** Web demo path, including Windows drive-letter materialization of `/data/case`. */
function isWebDemoCaseDirectory(directory: string) {
  const key = directory.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
  return key === "/data/case" || /^[a-z]:\/data\/case$/.test(key)
}

function desktopHomeCase() {
  return path.join(os.homedir(), "OneCode", "case")
}

export function resolve() {
  const explicit = process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY?.trim()
  if (explicit) {
    const resolved = path.resolve(explicit)
    // Desktop must never keep the Linux/web demo workspace.
    if (isDesktopClient() && isWebDemoCaseDirectory(resolved)) {
      const extra = OneCodeExtraPath.root()
      if (extra) return path.resolve(extra, "case")
      return desktopHomeCase()
    }
    return resolved
  }
  const extra = OneCodeExtraPath.root()
  if (extra) return path.resolve(extra, "case")
  // Desktop installs use a portable home-relative workspace; web/serve keep /data/case.
  if (isDesktopClient()) return desktopHomeCase()
  return "/data/case"
}

export function ensureDirectory(directory = resolve()) {
  const target =
    isDesktopClient() && isWebDemoCaseDirectory(directory)
      ? resolve()
      : directory
  mkdirSync(target, { recursive: true })
  return target
}

export * as OneScienceCodeDefaultDirectory from "./onescience-code-default-directory"
