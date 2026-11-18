import { randomBytes } from "node:crypto"
import { Effect, Option } from "effect"
import type { ConfigSSH } from "@/config/ssh"
import { Instance } from "@/project/instance"
import type { WorkspaceAdapter, WorkspaceInfo } from "../types"
import { controlPlaneId } from "../control-plane-id"
import {
  defaultRemotePath,
  MARKER_NAME,
  parseMarker,
  parseSshNodeExtra,
  projectSlugFor,
  SSH_NODE_TYPE,
  type SshNodeExtra,
  type SshNodeMarker,
} from "./ssh-node-path"
import {
  LEASE_HEARTBEAT_MS,
  REMOTE_SERVE_HEALTH_TIMEOUT_MS,
  REMOTE_SERVE_SPAWN_TIMEOUT_MS,
  pickEphemeralPort,
  pickLocalPort,
  readServeLog,
  remoteDeleteCatalogTokenScript,
  remoteKillScript,
  remotePinnedKeepaliveScript,
  remoteRefreshLeaseScript,
  shellQuote,
  writeRemoteFile,
  REMOTE_HOME_SCRIPT,
  runRemote,
  startPinnedServeTunnel,
  waitForHealth,
  waitForLeafReady,
  waitForServeReadyMark,
} from "./ssh-node-exec"
import { currentListenPort } from "@/server/listen-port"
import { Process } from "@/util/process"
import { mintCatalogToken, revokeCatalogTokens } from "@/onescience/catalog-token"
import {
  beginConnectProgress,
  finishConnectProgress,
  isConnectProgressComplete,
  markConnectStep,
  setConnectStepDetail,
} from "./ssh-node-progress"
import { failedPreflightMessage, runWorkspacePreflightChecks } from "./ssh-node-preflight"

type Live = {
  localPort: number
  remotePort: number
  remotePath?: string
  progressKey?: string
  ready: boolean
  closed?: boolean
  tunnel: ReturnType<typeof startPinnedServeTunnel>
  leaseTimer?: ReturnType<typeof setInterval>
  leaseToken?: string
}

const live = new Map<string, Live>()
const creating = new Map<string, Promise<void>>()
const inflightByProgress = new Map<string, WorkspaceInfo>()
const abortedProgress = new Set<string>()
const DROP_LIVE_WAIT_MS = 2_000

function createLockKey(info: WorkspaceInfo) {
  const extra = parseSshNodeExtra(info.extra)
  const remotePath = extra?.remotePath || info.directory
  if (remotePath) return `path:${remotePath}`
  return `id:${info.id}`
}

function tunnelAlive(session: Live) {
  return session.tunnel.exitCode === null && session.tunnel.signalCode === null
}

async function dropLive(session: Live) {
  session.closed = true
  stopLeaseHeartbeat(session)
  const tunnel = session.tunnel
  for (const [id, value] of live) {
    if (value === session) live.delete(id)
  }
  await Process.stop(tunnel)
  await Promise.race([tunnel.exited, new Promise((resolve) => setTimeout(resolve, DROP_LIVE_WAIT_MS))]).catch(
    () => undefined,
  )
}

function sameRemotePath(left: string | undefined, right: string | undefined) {
  if (!left || !right) return false
  return left.replace(/\/+$/, "") === right.replace(/\/+$/, "")
}

/** Stop every local heartbeat/tunnel for this project directory, not just one workspace id. */
async function dropLiveForPath(remotePath: string | undefined) {
  if (!remotePath) return
  await Promise.all(
    [...new Set(live.values())]
      .filter((session) => sameRemotePath(session.remotePath, remotePath))
      .map((session) => dropLive(session)),
  )
}

async function dropLiveForProgressKey(progressKey: string | undefined) {
  const key = progressKey?.trim()
  if (!key) return
  await Promise.all(
    [...new Set(live.values())]
      .filter((session) => session.progressKey === key)
      .map((session) => dropLive(session)),
  )
}

export function stopAllSshNodeHeartbeats() {
  void Promise.all([...new Set(live.values())].map((session) => dropLive(session)))
}

/** Cancel an in-flight or live ssh-node connect by the UI progress key. */
export async function abortSshNodeConnect(progressKey: string) {
  const key = progressKey.trim()
  if (!key) return
  abortedProgress.add(key)
  finishConnectProgress(key, false)
  await dropLiveForProgressKey(key)
  const pending = inflightByProgress.get(key)
  inflightByProgress.delete(key)
  if (pending) await SshNodeAdapter.remove(pending).catch(() => undefined)
}

function throwIfConnectAborted(progressKey: string) {
  if (progressKey && abortedProgress.has(progressKey)) {
    throw new Error("已取消连接")
  }
}

function extraDirectoryHeader(info: WorkspaceInfo) {
  const extra = parseSshNodeExtra(info.extra)
  const directory = extra?.remotePath || info.directory
  if (!directory) return
  return { "x-opencode-directory": directory }
}

function liveFor(info: WorkspaceInfo) {
  const direct = live.get(info.id)
  if (direct) return direct
  const extra = parseSshNodeExtra(info.extra)
  const remotePath = extra?.remotePath || info.directory
  if (!remotePath) return
  for (const session of live.values()) {
    if (session.remotePath === remotePath) return session
  }
}

function attachLive(info: WorkspaceInfo, session: Live) {
  live.set(info.id, session)
  const extra = parseSshNodeExtra(info.extra)
  if (!extra) return
  extra.servePort = session.remotePort
  extra.localPort = session.localPort
  info.extra = extra
}

async function withCreateLock(info: WorkspaceInfo, fn: () => Promise<void>) {
  const key = createLockKey(info)
  const previous = creating.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const chained = previous.then(
    () => gate,
    () => gate,
  )
  creating.set(key, chained)
  try {
    await previous.catch(() => undefined)
    const existing = liveFor(info)
    if (existing?.ready && tunnelAlive(existing)) {
      attachLive(info, existing)
      return
    }
    if (existing) await dropLive(existing)
    await fn()
  } finally {
    release()
    if (creating.get(key) === chained) creating.delete(key)
  }
}

function stopLeaseHeartbeat(session?: Live) {
  if (!session?.leaseTimer) return
  clearInterval(session.leaseTimer)
  session.leaseTimer = undefined
}

function startLeaseHeartbeat(session: Live, target: ConfigSSH.Info, remotePath: string) {
  stopLeaseHeartbeat(session)
  const touch = () => {
    void (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (session.closed) return
        try {
          const result = await runRemote(target, remoteRefreshLeaseScript(remotePath, session.leaseToken), 15_000, {
            login: false,
          })
          if (result.code === 0) return
        } catch {
          // Congestion or a single late heartbeat must not drop the tunnel.
        }
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 2_000))
      }
    })()
  }
  touch()
  session.leaseTimer = setInterval(touch, LEASE_HEARTBEAT_MS)
}

async function remoteHome(target: ConfigSSH.Info) {
  const result = await runRemote(target, REMOTE_HOME_SCRIPT, 20_000, { login: false })
  const home = result.stdout.trim()
  if (result.code !== 0 || !home.startsWith("/")) {
    throw new Error(result.stderr.trim() || "无法解析远端 $HOME，留空路径时需要可用的家目录")
  }
  return home
}

async function loadDeps() {
  const [{ AppRuntime }, PlatformAuth] = await Promise.all([
    import("@/effect/app-runtime"),
    import("@/platform-auth/platform-auth"),
  ])
  return { AppRuntime, PlatformAuth }
}

async function currentAccountId() {
  const { AppRuntime, PlatformAuth } = await loadDeps()
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const current = Option.getOrUndefined(yield* Effect.serviceOption(PlatformAuth.CurrentSession))
      return current?.session?.account.id?.trim() || "local"
    }),
  )
}

async function sshMap(accountId?: string) {
  const [{ readManagedOpenSshTargets, mergeSshFromOpenSsh }, { platformAccountConfigFile }] = await Promise.all([
    import("@/server/ssh-config-file"),
    import("@/config/config"),
  ])
  const disk = await readManagedOpenSshTargets(accountId)
  let product: import("@/server/ssh-config-file").ProductSshMap | undefined
  if (accountId) {
    const fs = await import("fs/promises")
    const text = await fs.readFile(platformAccountConfigFile(accountId), "utf8").catch(() => "")
    if (text.trim()) {
      try {
        product = (JSON.parse(text) as { ssh?: import("@/server/ssh-config-file").ProductSshMap }).ssh
      } catch {
        product = undefined
      }
    }
  }
  return mergeSshFromOpenSsh(product, disk).ssh ?? product ?? disk
}

function resolveTarget(ssh: Awaited<ReturnType<typeof sshMap>> | undefined, name: string): ConfigSSH.Info {
  const target = ssh?.[name]
  if (!target || typeof target !== "object") {
    throw new Error(`SSH 配置「${name}」已删除或不存在`)
  }
  const record = target as Record<string, unknown>
  const host = typeof record.host === "string" ? record.host.trim() : ""
  if (!host) {
    throw new Error(`SSH 目标「${name}」不存在或未配置主机`)
  }
  if (record.enabled === false) throw new Error(`SSH 目标「${name}」已禁用`)
  return target as ConfigSSH.Info
}

async function resolveSshTarget(extra: SshNodeExtra): Promise<ConfigSSH.Info> {
  if (extra.ssh?.host) {
    return extra.ssh as ConfigSSH.Info
  }
  const accountId = extra.accountId || (await currentAccountId())
  const map = await sshMap(accountId && accountId !== "local" ? accountId : undefined)
  return resolveTarget(map, extra.sshTarget)
}

function currentProjectSlug(projectID: string) {
  try {
    return projectSlugFor(Instance.directory)
  } catch {
    return projectSlugFor(projectID)
  }
}

async function openWorkspaceTunnel(input: {
  target: ConfigSSH.Info
  info: WorkspaceInfo
  extra: SshNodeExtra
  remotePath: string
  remotePort: number
  catalogPort: number
  accountId: string
  marker: SshNodeMarker
  env?: Record<string, string | undefined>
  leaseToken: string
  catalogToken?: string
  healthTimeoutMs?: number
  /** Retunnel/sync: reattach only; never spawn a leaf after user disconnect. */
  reuseOnly?: boolean
}) {
  const localPort = input.extra.localPort && input.extra.localPort > 0 ? input.extra.localPort : await pickLocalPort()
  const previous = liveFor(input.info)
  if (previous) await dropLive(previous)
  const aPort = currentListenPort()
  const keepScript = remotePinnedKeepaliveScript({
    remotePath: input.remotePath,
    workspaceID: input.info.id,
    port: input.remotePort,
    marker: input.marker,
    env: input.env,
    controlPlaneUrl: aPort && input.catalogPort > 0 ? `http://127.0.0.1:${input.catalogPort}` : undefined,
    leaseToken: input.leaseToken,
    catalogToken: input.catalogToken,
    reuseOnly: input.reuseOnly,
  })
  const spawn = (catalog: boolean) =>
    startPinnedServeTunnel({
      config: input.target,
      localPort,
      remotePort: input.remotePort,
      remotePath: input.remotePath,
      keepScript,
      ...(catalog && aPort && input.catalogPort > 0
        ? { catalogPort: input.catalogPort, controlPort: aPort }
        : {}),
    })

  let tunnel = spawn(Boolean(aPort && input.catalogPort > 0))
  let catalogForward = Boolean(aPort && input.catalogPort > 0)
  let reusedServe = false
  const healthMs = input.healthTimeoutMs ?? REMOTE_SERVE_HEALTH_TIMEOUT_MS
  const progressKey = input.extra.progressKey?.trim() || ""
  const waitPinned = async (child: ReturnType<typeof startPinnedServeTunnel>) => {
    reusedServe = await waitForServeReadyMark(child, REMOTE_SERVE_SPAWN_TIMEOUT_MS)
    throwIfConnectAborted(progressKey)
    if (progressKey && !isConnectProgressComplete(progressKey)) {
      markConnectStep(progressKey, "health")
      setConnectStepDetail(progressKey, "health", "正在确认远端服务可以访问")
    }
    await Promise.race([
      child.exited.then(() => {
        throw new Error("SSH 会话在健康检查完成前断开（登录节点可能换机，或远端 serve 未起来）")
      }),
      waitForHealth(localPort, healthMs),
    ])
  }
  const session: Live = {
    localPort,
    remotePort: input.remotePort,
    remotePath: input.remotePath,
    progressKey: input.extra.progressKey?.trim() || undefined,
    ready: false,
    tunnel,
    leaseToken: input.leaseToken,
  }
  attachLive(input.info, session)
  try {
    throwIfConnectAborted(progressKey)
    await waitPinned(tunnel)
  } catch (error) {
    const cancelled =
      abortedProgress.has(input.extra.progressKey?.trim() || "") ||
      (error instanceof Error && error.message === "已取消连接")
    if (cancelled) {
      await dropLive(session)
      throw error instanceof Error ? error : new Error("已取消连接")
    }
    const died = tunnel.exitCode !== null || tunnel.signalCode !== null
    await Process.stop(tunnel)
    await Promise.race([tunnel.exited, new Promise((resolve) => setTimeout(resolve, DROP_LIVE_WAIT_MS))]).catch(
      () => undefined,
    )
    if (!catalogForward || !died) {
      await dropLive(session)
      throw error
    }
    catalogForward = false
    tunnel = spawn(false)
    session.tunnel = tunnel
    attachLive(input.info, session)
    try {
      await waitPinned(tunnel)
    } catch (retryError) {
      await dropLive(session)
      throw retryError
    }
  }

  if (!catalogForward) {
    revokeCatalogTokens(input.info.id, { immediate: true })
    await runRemote(input.target, remoteDeleteCatalogTokenScript(input.remotePath), 8_000).catch(() => undefined)
  }

  input.extra.catalogPort = input.catalogPort
  input.extra.catalogForward = catalogForward
  input.extra.servePort = input.remotePort
  input.extra.localPort = localPort
  input.info.extra = input.extra
  session.tunnel = tunnel
  session.ready = true
  // Reused serve still holds its original lease token. A new token from A would
  // look like a supersede and the leftover watchdog would exit.
  if (reusedServe) session.leaseToken = undefined
  attachLive(input.info, session)
  try {
    startLeaseHeartbeat(session, input.target, input.remotePath)
    return session
  } catch (error) {
    await dropLive(session)
    throw error
  }
}

function newLeaseToken() {
  return randomBytes(16).toString("hex")
}

/**
 * Re-pin the local tunnel to a same-node leftover leaf (leaveForReuse / tunnel blip).
 * Never startFresh: startSync and probes use target({create:false}) → retunnel, and
 * after an intentional disconnect that would resurrect the killed serve on the old port.
 */
async function retunnel(info: WorkspaceInfo): Promise<Live | undefined> {
  const extra = parseSshNodeExtra(info.extra)
  if (!extra) return
  const remotePath = extra.remotePath || info.directory
  if (!remotePath) return
  // No remembered port → nothing to reuse; do not pick a new ephemeral and spawn.
  if (!(extra.servePort && extra.servePort > 0)) return
  const accountId = extra.accountId || (await currentAccountId())
  const ssh = await resolveSshTarget({ ...extra, accountId })
  const planeId = extra.controlPlaneId || controlPlaneId()
  const remotePort = extra.servePort
  const catalogPort =
    extra.catalogPort && extra.catalogPort > 0 && extra.catalogPort !== remotePort
      ? extra.catalogPort
      : pickEphemeralPort()
  const leaseToken = newLeaseToken()
  const marker: SshNodeMarker = {
    version: 1,
    workspaceID: info.id,
    controlPlaneId: planeId,
    accountId,
    projectID: info.projectID,
    createdAt: Date.now(),
    servePort: remotePort,
  }
  const catalogToken =
    catalogPort > 0 && extra.accountId ? mintCatalogToken({ accountId, workspaceId: info.id }) : undefined
  try {
    return await openWorkspaceTunnel({
      target: ssh,
      info,
      extra,
      remotePath,
      remotePort,
      catalogPort,
      accountId,
      marker,
      leaseToken,
      catalogToken,
      healthTimeoutMs: 60_000,
      reuseOnly: true,
    })
  } catch {
    return
  }
}

export const SshNodeAdapter: WorkspaceAdapter = {
  name: "SSH 节点",
  description: "在已登记的 SSH 目标上启动 OpenCode serve",
  async configure(info) {
    const extra = parseSshNodeExtra(info.extra)
    if (!extra) throw new Error("ssh-node workspace 需要 extra.sshTarget")
    const slug = extra.projectSlug || currentProjectSlug(info.projectID)
    const accountId = extra.accountId || (await currentAccountId())
    const target = await resolveSshTarget({ ...extra, accountId })
    const planeId = extra.controlPlaneId || controlPlaneId()
    const userPath = extra.remotePath?.trim()
    // Respect an explicit false, but default to creating the directory so a typed path
    // does not fail with "does not exist".
    const createRemoteDir = extra.createRemoteDir !== false
    const remotePath = userPath
      ? userPath
      : defaultRemotePath({
          basePath: await remoteHome(target),
          controlPlaneId: planeId,
          accountId,
          projectSlug: slug,
        })
    return {
      ...info,
      name: extra.sshTarget,
      directory: remotePath,
      extra: {
        ...extra,
        remotePath,
        createRemoteDir,
        accountId,
        controlPlaneId: planeId,
        projectSlug: slug,
      },
    }
  },
  async create(info, env = {}) {
    await withCreateLock(info, async () => {
    const extra = parseSshNodeExtra(info.extra)
    if (!extra) throw new Error("ssh-node workspace 需要 extra.sshTarget")
    const remotePath = extra.remotePath || info.directory
    if (!remotePath) throw new Error("ssh-node workspace 缺少 remotePath")
    const accountId = extra.accountId || (await currentAccountId())
    const target = await resolveSshTarget({ ...extra, accountId })
    const planeId = extra.controlPlaneId || controlPlaneId()
    const progressKey = extra.progressKey || ""
    abortedProgress.delete(progressKey)
    if (progressKey) inflightByProgress.set(progressKey, info)
    throwIfConnectAborted(progressKey)
    beginConnectProgress(progressKey)
    const fail = async (error: unknown): Promise<never> => {
      finishConnectProgress(progressKey, false)
      const message = error instanceof Error ? error.message : String(error)
      const log = await readServeLog(target, remotePath).catch(() => "")
      const earlyExit = /SSH 会话在远端 serve 启动前断开|远端 serve 未在时限内启动|__SERVE_LISTEN_FAIL__/.test(message)
      // Old .onescience-serve.log on NFS is often leftover from a prior success and
      // must not be presented as evidence that this attempt started serve.
      const portBusy = /Is port \d+ in use|port .* in use|EADDRINUSE|__SERVE_LISTEN_FAIL__/i.test(
        `${message}\n${log}`,
      )
      const suffix = log
        ? `（以下 serve 日志可能来自本次或上次连接，仅供参考）\n${log}`
        : "未找到 .onescience-serve.log（远端 serve 可能没有真正启动）"
      const hint = portBusy
        ? "远端端口仍被占用（常见于上次 serve 残留）。已尝试清理后请再点连接；若反复失败可断开后重试。\n"
        : ""
      await dropLiveForPath(remotePath).catch(() => undefined)
      // Prefer leaving a same-node leaf for reuse after NFS/health blips. Hard-kill
      // only when the user cancelled or serve never got far enough to be useful.
      const cancelled =
        abortedProgress.has(progressKey) || message === "已取消连接" || message.includes("已取消连接")
      const leaveForReuse =
        !cancelled &&
        !earlyExit &&
        !portBusy &&
        (/健康检查超时|未在时限内就绪|未在时限内启动|SSH 会话在健康检查/.test(message) ||
          /opencode server listening|serve: ready|sqlite-migration/.test(log))
      if (!leaveForReuse) {
        await runRemote(target, remoteKillScript(info.id, { remotePath, port: extra.servePort }), 15_000, {
          login: false,
        }).catch(() => undefined)
      }
      throw new Error(`${hint}${message}\n${suffix}`)
    }

    markConnectStep(progressKey, "preflight")
    // One SSH: connectivity + mkdir + marker + onecode version (login-node lean path).
    const preflight = await runWorkspacePreflightChecks({
      remotePath,
      controlPlaneId: planeId,
      accountId,
      projectID: info.projectID,
      createIfMissing: extra.createRemoteDir !== false,
      run: (command, timeout) => runRemote(target, command, timeout),
    })
    if (preflight.checks.some((item) => !item.skipped && !item.ok)) {
      finishConnectProgress(progressKey, false)
      throw new Error(failedPreflightMessage(preflight.checks))
    }

    markConnectStep(progressKey, "prepare")
    const existing = parseMarker(preflight.markerText ?? "")
    const leaseToken = newLeaseToken()
    const remotePort =
      (existing?.servePort && existing.servePort > 0 ? existing.servePort : 0) ||
      (extra.servePort && extra.servePort > 0 ? extra.servePort : 0) ||
      pickEphemeralPort()
    let catalogPort = extra.catalogPort && extra.catalogPort > 0 ? extra.catalogPort : pickEphemeralPort()
    if (catalogPort === remotePort) catalogPort = pickEphemeralPort()

    const marker: SshNodeMarker = {
      version: 1,
      workspaceID: info.id,
      controlPlaneId: planeId,
      accountId,
      projectID: info.projectID,
      createdAt: existing?.createdAt && existing.workspaceID === info.id ? existing.createdAt : Date.now(),
      servePort: remotePort,
    }
    extra.servePort = remotePort
    extra.catalogPort = catalogPort
    info.extra = extra
    throwIfConnectAborted(progressKey)

    const token = mintCatalogToken({ accountId, workspaceId: info.id })
    const auth = env.OPENCODE_AUTH_CONTENT
    const platformConfigContent = env.OPENCODE_PLATFORM_CONFIG_CONTENT ?? "{}"
    const remoteRoot = remotePath.replace(/\/+$/, "")
    const platformConfigPath = `${remoteRoot}/.opencode/platform-config-overlay.jsonc`
    const authFile = `${remoteRoot}/.opencode-auth.json`

    await runRemote(target, `mkdir -p ${shellQuote(`${remoteRoot}/.opencode`)}`, 8_000, {
      login: false,
    })
    await writeRemoteFile(target, authFile, auth ?? "{}")
    await writeRemoteFile(target, platformConfigPath, platformConfigContent)
    // Also write a durable project config so ConfigPaths auto-loads providers even if
    // OPENCODE_CONFIG is dropped on a later serve restart without control-plane env.
    if (env.OPENCODE_PLATFORM_CONFIG_CONTENT && env.OPENCODE_PLATFORM_CONFIG_CONTENT !== "{}") {
      await writeRemoteFile(target, `${remoteRoot}/.opencode/opencode.jsonc`, platformConfigContent)
    }
    // Auth and custom providers are read at serve start. A reused leaf never reloads
    // the synced files, so always stop any leftover serve before opening the tunnel.
    await runRemote(target, remoteKillScript(info.id, { remotePath, port: remotePort }), 15_000, {
      login: false,
    }).catch(() => undefined)

    const serveEnv: Record<string, string | undefined> = {
      ...env,
      OPENCODE_AUTH_CONTENT: undefined,
      OPENCODE_PLATFORM_CONFIG_CONTENT: undefined,
      OPENCODE_CONFIG: platformConfigPath,
    }

    markConnectStep(progressKey, "serve")
    setConnectStepDetail(progressKey, "serve", "等待远端 serve 监听（登录节点 bashrc 可能较慢）")
    try {
      await openWorkspaceTunnel({
        target,
        info,
        extra,
        remotePath,
        remotePort,
        catalogPort,
        accountId,
        marker,
        env: serveEnv,
        leaseToken,
        catalogToken: token,
      })
      markConnectStep(progressKey, "tunnel")
      markConnectStep(progressKey, "init")
      setConnectStepDetail(progressKey, "init", "正在初始化远端环境")
      const localPort = extra.localPort
      if (!localPort || localPort <= 0) throw new Error("本机隧道端口未就绪")
      await waitForLeafReady({
        port: localPort,
        directory: remotePath,
        abort: () => abortedProgress.has(progressKey),
        onDetail: (detail) => setConnectStepDetail(progressKey, "init", detail),
        readLog: () => readServeLog(target, remotePath),
      })
      finishConnectProgress(progressKey, true)
    } catch (error) {
      await fail(error)
    } finally {
      if (progressKey && inflightByProgress.get(progressKey) === info) inflightByProgress.delete(progressKey)
    }
    })
  },
  async remove(info) {
    const extra = parseSshNodeExtra(info.extra)
    const session = live.get(info.id) ?? liveFor(info)
    const remotePort = session?.remotePort || extra?.servePort
    const remotePath = extra?.remotePath || info.directory || session?.remotePath
    const progressKey = extra?.progressKey?.trim()
    if (progressKey) {
      await dropLiveForProgressKey(progressKey)
      inflightByProgress.delete(progressKey)
    }
    // A leftover workspace row can hold a second Live + lease timer on the
    // same directory. UI disconnect must stop all of them or the leaf stays
    // leased until this control-plane process exits.
    await dropLiveForPath(remotePath)
    if (!extra) return
    // Create failed before serve/tunnel — nothing remote to kill; skip SSH round-trips
    // so abortCreate can return the real preflight error quickly.
    if (!session && !(extra.servePort && extra.servePort > 0) && !(extra.localPort && extra.localPort > 0)) {
      revokeCatalogTokens(info.id, { immediate: true })
      return
    }
    try {
      const target = await resolveSshTarget(extra)
      if (remotePath) {
        await runRemote(target, remoteDeleteCatalogTokenScript(remotePath), 8_000, { login: false }).catch(() => undefined)
      }
      revokeCatalogTokens(info.id, { immediate: true })
      // Killing the pinned SSH session is what stops serve on that login node.
      // A follow-up SSH often lands elsewhere and cannot see the process.
      // login:false so scnet bashrc cannot eat the 15s abortCreate budget before `rm` lease.
      await runRemote(target, remoteKillScript(info.id, { remotePath, port: remotePort }), 15_000, {
        login: false,
      }).catch(() => undefined)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`无法停止远端 onecode serve: ${message}`)
    }
  },
  async target(info, opts) {
    const existing = liveFor(info)
    // File/sync probes must not tear down a live SSH because one health GET
    // was slow. That rewinded the UI to 健康检查 and left remote keepalives.
    if (existing && tunnelAlive(existing)) {
      attachLive(info, existing)
      return {
        type: "remote" as const,
        url: `http://127.0.0.1:${existing.localPort}/`,
        headers: extraDirectoryHeader(info),
      }
    }
    if (existing) await dropLive(existing)
    // Disconnect/remove must not retunnel just to copy transcripts — that races
    // the kill and can leave the UI "已连接" again after F5.
    if (opts?.create === false && opts?.reconnect === false) {
      throw new Error(`ssh-node workspace ${info.id} 隧道已关闭`)
    }
    if (opts?.create !== false) {
      await SshNodeAdapter.create(info, {})
    } else {
      await retunnel(info)
    }
    const session = liveFor(info)
    if (!session) throw new Error(`ssh-node workspace ${info.id} 尚未建立隧道，请重新连接远端`)
    return {
      type: "remote" as const,
      url: `http://127.0.0.1:${session.localPort}/`,
      headers: extraDirectoryHeader(info),
    }
  },
}

export { SSH_NODE_TYPE, MARKER_NAME }
