import fs from "node:fs"
import path from "node:path"
import * as Log from "@opencode-ai/core/util/log"
import { OneScienceCodeDefaultDirectory } from "@opencode-ai/core/onescience-code-default-directory"
import { LEASE_NAME, LEASE_TTL_MS, LEASE_WATCHDOG_POLL_SECONDS } from "./ssh-node-exec"

const log = Log.create({ service: "ssh-leaf-lease" })

export const SSH_LEAF_LEASE_POLL_MS = LEASE_WATCHDOG_POLL_SECONDS * 1000

export function shouldWatchSshLeafLease(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.OPENCODE_WORKSPACE_ID?.trim())
}

/** Control-plane A sets OPENCODE_WORKSPACE_ID when spawning B's pinned serve. */
export function isSshLeafServe(env: NodeJS.ProcessEnv = process.env) {
  return shouldWatchSshLeafLease(env)
}

/** Forced onto B's `onecode serve` so even an older leaf does not load @parcel/watcher. */
export const SSH_LEAF_SERVE_ENV = {
  OPENCODE_HOT_RELOAD: "false",
  OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "true",
  OPENCODE_EXPERIMENTAL_FILEWATCHER: "false",
} as const

/**
 * Remote leaf only needs files / providers / PTY. HOT_RELOAD + parcel watcher
 * crawl NFS/Lustre trees and can kill the process after listen already succeeded.
 */
export function applySshLeafServeEnv(env: NodeJS.ProcessEnv = process.env) {
  if (!isSshLeafServe(env)) return false
  env.OPENCODE_HOT_RELOAD = SSH_LEAF_SERVE_ENV.OPENCODE_HOT_RELOAD
  env.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER = SSH_LEAF_SERVE_ENV.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER
  env.OPENCODE_EXPERIMENTAL_FILEWATCHER = SSH_LEAF_SERVE_ENV.OPENCODE_EXPERIMENTAL_FILEWATCHER
  return true
}

export function sshLeafLeaseFile(directory: string) {
  return path.join(directory, LEASE_NAME)
}

export function isSshLeafLeaseExpired(mtimeMs: number, now = Date.now(), ttlMs = LEASE_TTL_MS) {
  return now - mtimeMs >= ttlMs
}

export function sshLeafLeaseToken(env: NodeJS.ProcessEnv = process.env) {
  return env.OPENCODE_SSH_LEASE_TOKEN?.trim() || ""
}

export function isSshLeafLeaseSuperseded(fileText: string, token: string) {
  if (!token) return false
  const got = fileText.trim()
  return got.length > 0 && got !== token
}

export function startSshLeafLeaseWatchdog(opts?: {
  env?: NodeJS.ProcessEnv
  directory?: string
  now?: () => number
  exit?: (code: number) => void
  intervalMs?: number
}) {
  const env = opts?.env ?? process.env
  if (!shouldWatchSshLeafLease(env)) return

  const directory =
    opts?.directory?.trim() ||
    env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY?.trim() ||
    OneScienceCodeDefaultDirectory.resolve()
  const file = sshLeafLeaseFile(directory)
  const now = opts?.now ?? Date.now
  const exit = opts?.exit ?? ((code: number) => process.exit(code))
  const intervalMs = opts?.intervalMs ?? SSH_LEAF_LEASE_POLL_MS

  let timer: ReturnType<typeof setInterval> | undefined
  const check = () => {
    try {
      const st = fs.statSync(file)
      const text = fs.readFileSync(file, "utf8")
      const token = sshLeafLeaseToken(env)
      if (isSshLeafLeaseSuperseded(text, token)) {
        log.warn("ssh leaf lease superseded, exiting", { file })
      } else if (isSshLeafLeaseExpired(st.mtimeMs, now(), LEASE_TTL_MS)) {
        log.warn("ssh leaf lease expired, exiting", { file, ageMs: now() - st.mtimeMs })
      } else {
        return
      }
    } catch {
      log.warn("ssh leaf lease missing, exiting", { file })
    }
    if (timer) clearInterval(timer)
    exit(0)
  }

  timer = setInterval(check, intervalMs)
  timer.unref?.()
  return timer
}
