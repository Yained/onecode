import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"
import { app, utilityProcess } from "electron"
import type { Details } from "electron"
import { DATA_ROOT_KEY, DEFAULT_SERVER_URL_KEY, WSL_ENABLED_KEY } from "./constants"
import { resolveDesktopInstallIdentity } from "./install-session"
import { getUserShell, loadShellEnv } from "./shell-env"
import { getStore } from "./store"
import type { SqliteMigrationProgress } from "../preload/types"

/** Resolve monorepo `onecode/` root from this file (out/main or src/main). */
function resolveOnecodeRoot() {
  if (process.env.ONECODE_ROOT?.trim()) return resolve(process.env.ONECODE_ROOT.trim())
  const here = dirname(fileURLToPath(import.meta.url))
  for (const candidate of [resolve(here, "../../../.."), resolve(here, "../../.."), resolve(here, "..")]) {
    if (existsSync(join(candidate, "packages", "desktop")) && existsSync(join(candidate, "packages", "opencode"))) {
      return candidate
    }
  }
  return undefined
}

function resolveOneskillsRepo(onecodeRoot: string | undefined) {
  if (process.env.ONESKILLS_REPO?.trim()) return resolve(process.env.ONESKILLS_REPO.trim())
  if (!onecodeRoot) return undefined
  const sibling = resolve(onecodeRoot, "..", "oneskills")
  if (existsSync(join(sibling, "skills"))) return sibling
  return undefined
}

export type WslConfig = { enabled: boolean }

export type HealthCheck = { wait: Promise<void> }

type SidecarMessage =
  | { type: "sqlite"; progress: SqliteMigrationProgress }
  | { type: "ready" }
  | { type: "stopped" }
  | { type: "error"; error: { message: string; stack?: string } }

export type SidecarListener = { stop: () => Promise<void> }

const SIDECAR_SERVICE_NAME = "opencode server"
const SIDECAR_START_STALL_TIMEOUT = 60_000
const SIDECAR_STOP_TIMEOUT = 6_000

type SpawnLocalServerOptions = {
  needsMigration: boolean
  userDataPath: string
  onSqliteProgress?: (progress: SqliteMigrationProgress) => void
  onStdout?: (message: string) => void
  onStderr?: (message: string) => void
  onExit?: (code: number) => void
}

export function getDefaultServerUrl(): string | null {
  const value = getStore().get(DEFAULT_SERVER_URL_KEY)
  return typeof value === "string" ? value : null
}

export function setDefaultServerUrl(url: string | null) {
  if (url) {
    getStore().set(DEFAULT_SERVER_URL_KEY, url)
    return
  }

  getStore().delete(DEFAULT_SERVER_URL_KEY)
}

export function getWslConfig(): WslConfig {
  const value = getStore().get(WSL_ENABLED_KEY)
  return { enabled: typeof value === "boolean" ? value : false }
}

export function setWslConfig(config: WslConfig) {
  getStore().set(WSL_ENABLED_KEY, config.enabled)
}

export function getDataRoot(): string | null {
  const value = getStore().get(DATA_ROOT_KEY)
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export function setDataRoot(root: string | null) {
  if (root?.trim()) {
    getStore().set(DATA_ROOT_KEY, root.trim())
    return
  }
  getStore().delete(DATA_ROOT_KEY)
}

export function preferAppEnv(userDataPath: string) {
  const shell = process.platform === "win32" ? null : getUserShell()
  const dataRoot = getDataRoot()
  const onecodeRoot = resolveOnecodeRoot()
  const oneskillsRepo = resolveOneskillsRepo(onecodeRoot)
  const sessionSeedRoot = resolveSessionSeedRoot(onecodeRoot)
  const installIdentity = resolveDesktopInstallIdentity()
  Object.assign(process.env, {
    ...(shell ? loadShellEnv(shell) : null),
    OPENCODE_EXPERIMENTAL_ICON_DISCOVERY: "true",
    OPENCODE_EXPERIMENTAL_FILEWATCHER: "true",
    OPENCODE_CLIENT: "desktop",
    // Sidecar embeds the server module; run OneScience migrations in-process.
    ONECODE_STARTUP_MIGRATIONS_IN_PROCESS: "1",
    XDG_STATE_HOME: process.env.XDG_STATE_HOME ?? userDataPath,
    ...(installIdentity ? { OPENCODE_VERSION: installIdentity } : {}),
    ...(onecodeRoot ? { ONECODE_ROOT: onecodeRoot } : {}),
    ...(oneskillsRepo ? { ONESKILLS_REPO: oneskillsRepo } : {}),
    ...(sessionSeedRoot ? { OPENCODE_SESSION_SEED_ROOT: sessionSeedRoot } : {}),
    ...(dataRoot
      ? {
          ONECODE_EXTRA_PATH: dataRoot,
          OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY: join(dataRoot, "case"),
        }
      : {
          // Explicit desktop default so sidecar never falls through to /data/case.
          OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY:
            process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY ?? join(homedir(), "OneCode", "case"),
        }),
  })
}

/** Packaged: resources/session-seed. Dev: monorepo packages/opencode/src/session/session-seed. */
function resolveSessionSeedRoot(onecodeRoot: string | undefined) {
  const fromEnv = process.env.OPENCODE_SESSION_SEED_ROOT?.trim()
  if (fromEnv && existsSync(join(fromEnv, "manifest.json"))) return resolve(fromEnv)

  if (app.isPackaged) {
    const packaged = join(process.resourcesPath, "session-seed")
    if (existsSync(join(packaged, "manifest.json"))) return packaged
  }

  if (onecodeRoot) {
    const fromRepo = join(onecodeRoot, "packages", "opencode", "src", "session", "session-seed")
    if (existsSync(join(fromRepo, "manifest.json"))) return fromRepo
  }

  return undefined
}

export async function spawnLocalServer(
  hostname: string,
  port: number,
  password: string,
  options: SpawnLocalServerOptions,
) {
  const sidecar = join(dirname(fileURLToPath(import.meta.url)), "sidecar.js")
  const child = utilityProcess.fork(sidecar, [], {
    cwd: process.cwd(),
    env: createSidecarEnv(),
    serviceName: SIDECAR_SERVICE_NAME,
    stdio: "pipe",
  })
  let exited = false
  const exit = defer<number>()

  const onProcessGone = (_event: unknown, details: Details) => {
    if (details.type !== "Utility" || details.name !== SIDECAR_SERVICE_NAME) return
    options.onStderr?.(`utility process gone reason=${details.reason} exitCode=${details.exitCode}`)
  }

  app.on("child-process-gone", onProcessGone)
  child.once("exit", (code) => {
    exited = true
    app.off("child-process-gone", onProcessGone)
    options.onExit?.(code)
    exit.resolve(code)
  })
  child.on("error", (error) => options.onStderr?.(`utility process error: ${serializeError(error).message}`))

  child.stdout?.on("data", (chunk: Buffer) => options.onStdout?.(chunk.toString("utf8").trimEnd()))
  child.stderr?.on("data", (chunk: Buffer) => options.onStderr?.(chunk.toString("utf8").trimEnd()))

  await new Promise<void>((resolve, reject) => {
    let done = false
    let timeout: NodeJS.Timeout

    const fail = (error: Error) => {
      if (done) return
      done = true
      cleanup()
      reject(error)
    }

    const refreshTimeout = () => {
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        fail(new Error(`Sidecar did not become ready within ${SIDECAR_START_STALL_TIMEOUT}ms: ${sidecar}`))
      }, SIDECAR_START_STALL_TIMEOUT)
    }

    const onMessage = (message: SidecarMessage) => {
      if (message.type === "sqlite") {
        refreshTimeout()
        options.onSqliteProgress?.(message.progress)
        return
      }
      if (message.type === "ready") {
        if (done) return
        done = true
        cleanup()
        resolve()
        return
      }
      if (message.type === "error") {
        fail(Object.assign(new Error(message.error.message), { stack: message.error.stack }))
      }
    }
    const onExit = (code: number) => {
      fail(new Error(`Sidecar exited before ready with code ${code}`))
    }
    const cleanup = () => {
      clearTimeout(timeout)
      child.off("message", onMessage)
      child.off("exit", onExit)
    }

    child.on("message", onMessage)
    child.on("exit", onExit)
    refreshTimeout()
    child.postMessage({
      type: "start",
      hostname,
      port,
      password,
      userDataPath: options.userDataPath,
      needsMigration: options.needsMigration,
    })
  }).catch((error) => {
    if (!exited) child.kill()
    throw error
  })

  const wait = (async () => {
    const url = `http://${hostname}:${port}`
    let healthy = false
    const gone = exit.promise.then((code) => {
      if (healthy) return
      throw new Error(`Sidecar exited before health check passed with code ${code}`)
    })

    const ready = async () => {
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        if (await checkHealth(url, password)) {
          healthy = true
          return
        }
      }
    }

    await Promise.race([ready(), gone])
  })()

  let stopping: Promise<void> | undefined

  return {
    listener: {
      stop: () => {
        if (stopping) return stopping
        if (exited) return Promise.resolve()
        child.postMessage({ type: "stop" })
        stopping = Promise.race([
          exit.promise.then(() => undefined),
          delay(SIDECAR_STOP_TIMEOUT).then(() => {
            if (!exited) child.kill()
          }),
        ])
        return stopping
      },
    },
    health: { wait },
  }
}

export async function checkHealth(url: string, password?: string | null): Promise<boolean> {
  let healthUrl: URL
  try {
    healthUrl = new URL("/global/health", url)
  } catch {
    return false
  }

  const headers = new Headers()
  if (password) {
    const auth = Buffer.from(`opencode:${password}`).toString("base64")
    headers.set("authorization", `Basic ${auth}`)
  }

  try {
    const res = await fetch(healthUrl, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

function createSidecarEnv(): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) => (value === undefined ? [] : [[key, String(value)]])),
  )
  delete env.DEBUG
  if (process.platform === "linux") delete env.LD_PRELOAD
  return env
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function serializeError(error: unknown) {
  if (error instanceof Error) return { message: error.message, stack: error.stack }
  return { message: String(error) }
}

function defer<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
