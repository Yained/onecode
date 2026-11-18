import { Auth } from "@/auth"
import { Config, isTenantMapsOnlyPatch } from "@/config/config"
import { ConfigSSH } from "@/config/ssh"
import { appendSshKnownHostsIgnoreArgs, stripBenignSshStderr } from "@/config/ssh-known-hosts"
import { Global } from "@opencode-ai/core/global"
import { GlobalBus, type GlobalEvent as GlobalBusEvent } from "@/bus/global"
import { EffectBridge } from "@/effect/bridge"
import { Bus } from "@/bus"
import { Installation } from "@/installation"
import { Process } from "@/util/process"
import { isSshMissingError, runSshProcess, sshAuthCliArgs, sshMissingOnServerMessage } from "@/util/ssh-cli"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import * as Log from "@opencode-ai/core/util/log"
import { Effect, Option, Queue, Schema } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { RootHttpApi } from "../api"
import {
  GlobalSshConfigRemoveInput,
  GlobalSshConfigWriteInput,
  GlobalSshIdentityCheckInput,
  GlobalSshIdentityIngestInput,
  GlobalSshIdentityUploadInput,
  GlobalSshTestInput,
  GlobalSshConnectProgressInput,
  GlobalSshWorkspacePreflightInput,
  GlobalUpgradeInput,
  GlobalProviderProbeInput,
  GlobalProviderModelsInput,
  GlobalProjectExecutionInput,
  GlobalSessionListQuery,
  OnesciencePresetConfigUpdateInput,
  OnesciencePresetLoginInput,
  OnesciencePresetMailConfigUpdateInput,
  OnesciencePresetMailTestInput,
  OnesciencePresetAccountDeleteInput,
  OnesciencePresetAccountStatusInput,
  OnesciencePresetPasswordResetInput,
  OnesciencePresetTokenInput,
  OnescienceRegistrationConfigUpdateInput,
  OnescienceRegistrationRandomInviteInput,
} from "../groups/global"
import * as OnesciencePreset from "@/provider/onescience-preset"
import { listCustomProviderModels, probeCustomProvider } from "@/provider/custom-provider-probe"
import { viewMailConfig, writeMailOverride } from "@/messaging/mail-config"
import { sendMail } from "@/messaging/smtp"
import {
  createRandomInvite,
  publicRegistrationGate,
  updateRegistrationConfig,
  viewRegistrationConfig,
} from "@/platform-auth/registration-config"
import path from "path"
import os from "os"
import fs from "fs/promises"
import { listProjectDataSubdirectories, projectDataRoot } from "@/path/project-folder"
import * as PlatformAuth from "@/platform-auth/platform-auth"
import {
  managedSshIdentityDirs,
  removeOpenSshConfig,
  openSshConfigPath,
  readManagedOpenSshTargets,
  sshIdentityDir,
  writeOpenSshConfig,
} from "@/server/ssh-config-file"
import {
  ingestServerIdentityFile,
  referencedIdentityPaths,
  releaseReplacedManagedIdentity,
  sshAuthKeyPath,
} from "@/server/ssh-identity-ingest"
import * as SessionViewer from "@/session/viewer"
import { Session } from "@/session/session"
import { Project } from "@/project/project"
import { lookupProjectRow } from "@/project/execution"
import { connectedSshTargetProjects, renameProjectSshTarget } from "@/project/ssh-target-usage"
import {
  connectedSshMutation,
  sshConfigSnapshot,
  sshTargetBusyMessage,
} from "@/config/ssh-target-usage"
import * as ApiError from "../errors"

const log = Log.create({ service: "server" })

function eventData(data: unknown): Sse.Event {
  return {
    _tag: "Event",
    event: "message",
    id: undefined,
    data: JSON.stringify(data),
  }
}

function parseBody(body: string) {
  try {
    return JSON.parse(body || "{}") as unknown
  } catch {
    return undefined
  }
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function safeIdentityFileName(name: string) {
  return (path.basename(name.trim()) || "identity").replace(/[^A-Za-z0-9._-]/g, "_")
}

function resolveIdentityPath(keyPath: string) {
  const trimmed = keyPath.trim()
  if (!trimmed) return ""
  if (trimmed === "~") return os.homedir()
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(os.homedir(), trimmed.slice(2))
  }
  return path.resolve(trimmed)
}

function isPathInsideRoot(root: string, target: string) {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
}

/** When platform auth is on, identity files must live under the account's platform-ssh dir. */
function assertIdentityPathAllowed(keyPath: string, accountId: string | undefined) {
  if (!accountId) return keyPath
  const allowed = sshIdentityDir(accountId)
  if (!isPathInsideRoot(allowed, keyPath)) {
    return ""
  }
  return keyPath
}

/** When platform auth is on, never fall back to OS ~/.ssh / shared ssh-identities. */
function requireAccountIdForPlatformSsh(accountId: string | undefined) {
  if (accountId) return accountId
  if (PlatformAuth.authRequired()) return null
  return undefined
}

async function releaseReplacedSshIdentity(input: {
  accountId: string | undefined
  previousKeyPath?: string
  keepKeyPath?: string
  productSsh: Record<string, unknown> | undefined
}) {
  const disk = await readManagedOpenSshTargets(input.accountId)
  const referenced = new Set([
    ...(await referencedIdentityPaths(disk)),
    ...(await referencedIdentityPaths(input.productSsh)),
  ])
  await releaseReplacedManagedIdentity({
    identityDirs: managedSshIdentityDirs(input.accountId),
    previousKeyPath: input.previousKeyPath,
    keepKeyPath: input.keepKeyPath,
    referenced,
  })
}

async function restrictIdentityFilePermissions(keyPath: string) {
  await fs.chmod(keyPath, 0o600).catch(() => undefined)
  if (process.platform !== "win32") return
  const user = await Process.run(["whoami", "/user", "/fo", "csv", "/nh"], { timeout: 12_000 })
  const sid = user.stdout.toString().match(/S-\d-\d+(?:-\d+)+/)?.[0]
  if (!sid) throw new Error("Unable to resolve current Windows user SID")
  await Process.run(["icacls", keyPath, "/inheritance:r", "/grant:r", `*${sid}:F`], { timeout: 12_000 })
}

function sshCdTarget(remotePath: string | undefined): string {
  const path = remotePath?.trim()
  if (!path) return "$HOME"
  if (path === "~") return "$HOME"
  if (path.startsWith("~/")) return `"$HOME/${path.slice(2).replace(/"/g, '\\"')}"`
  return shellQuote(path)
}

function sshArgs(config: ConfigSSH.Info) {
  const args = [...sshAuthCliArgs(config.auth, config.options)]
  if (config.port) args.push("-p", String(config.port))
  if (config.username) args.push("-l", config.username)
  appendSshKnownHostsIgnoreArgs(args)
  return [...args, config.hostName || config.host, `cd ${sshCdTarget(config.remotePath)} && printf __OPENCODE_SSH_OK__`]
}

function eventResponse(viewerID?: string) {
  log.info("global event connected", { viewerID })
  const events = Stream.callback<GlobalBusEvent>((queue) => {
    const handler = (event: GlobalBusEvent) => Queue.offerUnsafe(queue, event)
    return Effect.acquireRelease(
      Effect.sync(() => GlobalBus.on("event", handler)),
      () => Effect.sync(() => GlobalBus.off("event", handler)),
    )
  })
  const heartbeat = Stream.tick("10 seconds").pipe(
    Stream.drop(1),
    Stream.map(() => ({ payload: { id: Bus.createID(), type: "server.heartbeat", properties: {} } })),
  )

  return HttpServerResponse.stream(
    Stream.make({ payload: { id: Bus.createID(), type: "server.connected", properties: {} } }).pipe(
      Stream.concat(events.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }))),
      Stream.map(eventData),
      Stream.pipeThroughChannel(Sse.encode()),
      Stream.encodeText,
      Stream.ensuring(
        Effect.sync(() => {
          if (viewerID) SessionViewer.clearViewer(viewerID)
          log.info("global event disconnected", { viewerID })
        }),
      ),
    ),
    {
      contentType: "text/event-stream",
      headers: {
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      },
    },
  )
}

export const globalHandlers = HttpApiBuilder.group(RootHttpApi, "global", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const config = yield* Config.Service
    const installation = yield* Installation.Service
    const bridge = yield* EffectBridge.make()

    const health = Effect.fn("GlobalHttpApi.health")(function* () {
      return { healthy: true as const, version: InstallationVersion }
    })

    const event = Effect.fn("GlobalHttpApi.event")(function* (ctx: { request: HttpServerRequest.HttpServerRequest }) {
      const url = new URL(ctx.request.url, "http://localhost")
      const viewerID = url.searchParams.get("viewerID") ?? undefined
      return eventResponse(viewerID || undefined)
    })

    const configGet = Effect.fn("GlobalHttpApi.configGet")(function* () {
      return yield* config.getGlobal()
    })

    const configUpdate = Effect.fn("GlobalHttpApi.configUpdate")(function* (ctx) {
      const result = yield* config.updateGlobal(ctx.payload)
      // ssh/mcp-only writes must not dispose instances: dispose→bootstrap refetch races the UI pin
      // and historically wiped Integration SSH/MCP lists right after a successful save.
      if (result.changed && !isTenantMapsOnlyPatch(ctx.payload)) {
        bridge.fork(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }))
      }
      return result.info
    })

    const dispose = Effect.fn("GlobalHttpApi.dispose")(function* () {
      yield* disposeAllInstancesAndEmitGlobalDisposed()
      return true
    })

    const upgrade = Effect.fn("GlobalHttpApi.upgrade")(function* (ctx: { payload: typeof GlobalUpgradeInput.Type }) {
      const method = yield* installation.method()
      if (method === "unknown") {
        return {
          status: 400,
          body: { success: false as const, error: "Unknown installation method" },
        }
      }
      const target = ctx.payload.target || (yield* installation.latest(method))
      const result = yield* installation.upgrade(method, target).pipe(
        Effect.as({ status: 200, body: { success: true as const, version: target } }),
        Effect.catch((err) =>
          Effect.succeed({
            status: 500,
            body: {
              success: false as const,
              error: err instanceof Error ? err.message : String(err),
            },
          }),
        ),
      )
      if (!result.body.success) return result
      GlobalBus.emit("event", {
        directory: "global",
        payload: {
          type: Installation.Event.Updated.type,
          properties: { version: target },
        },
      })
      return result
    })

    const upgradeRaw = Effect.fn("GlobalHttpApi.upgradeRaw")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      const json = parseBody(body)
      if (json === undefined) {
        return HttpServerResponse.jsonUnsafe({ success: false, error: "Invalid request body" }, { status: 400 })
      }
      const payload = yield* Schema.decodeUnknownEffect(GlobalUpgradeInput)(json).pipe(
        Effect.map((payload) => ({ valid: true as const, payload })),
        Effect.catch(() => Effect.succeed({ valid: false as const })),
      )
      if (!payload.valid) {
        return HttpServerResponse.jsonUnsafe({ success: false, error: "Invalid request body" }, { status: 400 })
      }
      const result = yield* upgrade({ payload: payload.payload })
      return HttpServerResponse.jsonUnsafe(result.body, { status: result.status })
    })

    const sshWorkspacePreflight = Effect.fn("GlobalHttpApi.sshWorkspacePreflight")(function* (ctx: {
      payload: typeof GlobalSshWorkspacePreflightInput.Type
    }) {
      const config = ctx.payload.config
      if (!config.host || !config.remotePath) {
        return yield* new HttpApiError.BadRequest({})
      }
      const current = Option.getOrUndefined(yield* Effect.serviceOption(PlatformAuth.CurrentSession))
      const { workspacePreflight } = yield* Effect.promise(() => import("@/control-plane/adapters/ssh-node-preflight"))
      return yield* Effect.promise(() =>
        workspacePreflight({
          config,
          accountId: ctx.payload.accountId ?? current?.session?.account.id,
          projectSlug: ctx.payload.projectSlug,
          projectID: ctx.payload.projectID,
          remotePath: ctx.payload.remotePath,
          progressKey: ctx.payload.progressKey,
        }).catch((error) => ({
          ok: false,
          remotePath: ctx.payload.remotePath?.trim() || "",
          checks: [
            {
              id: "ssh" as const,
              ok: false,
              message: error instanceof Error ? error.message : "预检失败",
            },
            { id: "remotePath" as const, ok: true, skipped: true, message: "未检查远端目录" },
            { id: "marker" as const, ok: true, skipped: true, message: "未检查标记文件" },
            { id: "onecode" as const, ok: true, skipped: true, message: "未检测 onecode" },
          ],
        })),
      )
    })

    const sshConnectProgress = Effect.fn("GlobalHttpApi.sshConnectProgress")(function* (ctx: {
      payload: typeof GlobalSshConnectProgressInput.Type
    }) {
      const key = ctx.payload.key.trim()
      if (!key) return yield* new HttpApiError.BadRequest({})
      const { getConnectProgress } = yield* Effect.promise(() => import("@/control-plane/adapters/ssh-node-progress"))
      return { steps: getConnectProgress(key) }
    })

    const sshConnectAbort = Effect.fn("GlobalHttpApi.sshConnectAbort")(function* (ctx: {
      payload: typeof GlobalSshConnectProgressInput.Type
    }) {
      const key = ctx.payload.key.trim()
      if (!key) return yield* new HttpApiError.BadRequest({})
      const { abortSshNodeConnect } = yield* Effect.promise(() => import("@/control-plane/adapters/ssh-node"))
      yield* Effect.promise(() => abortSshNodeConnect(key))
      return { ok: true }
    })

    const sshTest = Effect.fn("GlobalHttpApi.sshTest")(function* (ctx: { payload: typeof GlobalSshTestInput.Type }) {
      const config = ctx.payload.config
      if (!config.host) {
        return {
          success: false,
          message: "SSH host is required.",
        }
      }
      if (config.auth?.type === "key" && config.auth.keyPath) {
        yield* Effect.promise(() => restrictIdentityFilePermissions(config.auth!.keyPath!))
      }
      if (config.auth?.type === "password" && !config.auth.password?.trim()) {
        return {
          success: false,
          message: "SSH password is required for password authentication.",
        }
      }
      const result = yield* Effect.promise(() =>
        runSshProcess(sshArgs(config), {
          nothrow: true,
          timeout: 12_000,
          password: config.auth?.type === "password" ? config.auth.password : undefined,
        }),
      )
      const stdout = result.stdout.toString().trim()
      const stderrRaw = result.stderr.toString().trim()
      if (isSshMissingError(stderrRaw) || isSshMissingError(stdout)) {
        return {
          success: false,
          message: sshMissingOnServerMessage(),
          stdout: stdout || undefined,
          stderr: stderrRaw || undefined,
        }
      }
      const stderr = stripBenignSshStderr(stderrRaw)
      if (result.code === 0 && stdout.includes("__OPENCODE_SSH_OK__")) {
        return {
          success: true,
          message: "Connected and remote path is accessible.",
          stdout,
          stderr: stderr || undefined,
        }
      }
      return {
        success: false,
        message:
          stderr ||
          stdout ||
          (stderrRaw && !stderr
            ? `ssh exited with code ${result.code} (host-key warning only; check key/auth/remote path)`
            : `ssh exited with code ${result.code}`),
        stdout: stdout || undefined,
        stderr: stderrRaw || undefined,
      }
    })

    const sshIdentityUpload = Effect.fn("GlobalHttpApi.sshIdentityUpload")(function* (ctx: {
      payload: typeof GlobalSshIdentityUploadInput.Type
    }) {
      const content = ctx.payload.content.trimEnd()
      if (!content.includes("PRIVATE KEY")) {
        return yield* new HttpApiError.BadRequest({})
      }
      const current = Option.getOrUndefined(yield* Effect.serviceOption(PlatformAuth.CurrentSession))
      const accountId = requireAccountIdForPlatformSsh(current?.session?.account.id)
      if (accountId === null) return yield* new HttpApiError.Unauthorized({})
      const dir = sshIdentityDir(accountId)
      yield* Effect.promise(() => fs.mkdir(dir, { recursive: true, mode: 0o700 }))
      const keyPath = path.join(dir, `${Date.now()}-${safeIdentityFileName(ctx.payload.name)}`)
      yield* Effect.promise(() => fs.writeFile(keyPath, `${content}\n`, { mode: 0o600 }))
      yield* Effect.promise(() => restrictIdentityFilePermissions(keyPath))
      return { keyPath }
    })

    const sshIdentityCheck = Effect.fn("GlobalHttpApi.sshIdentityCheck")(function* (ctx: {
      payload: typeof GlobalSshIdentityCheckInput.Type
    }) {
      const current = Option.getOrUndefined(yield* Effect.serviceOption(PlatformAuth.CurrentSession))
      const accountId = requireAccountIdForPlatformSsh(current?.session?.account.id)
      if (accountId === null) return yield* new HttpApiError.Unauthorized({})
      const keyPath = assertIdentityPathAllowed(resolveIdentityPath(ctx.payload.keyPath), accountId)
      if (!keyPath) return yield* new HttpApiError.BadRequest({})
      const exists = yield* Effect.promise(() =>
        fs.access(keyPath).then(
          () => true,
          () => false,
        ),
      )
      return { exists, keyPath }
    })

    const sshIdentityIngest = Effect.fn("GlobalHttpApi.sshIdentityIngest")(function* (ctx: {
      payload: typeof GlobalSshIdentityIngestInput.Type
    }) {
      const current = Option.getOrUndefined(yield* Effect.serviceOption(PlatformAuth.CurrentSession))
      const accountId = requireAccountIdForPlatformSsh(current?.session?.account.id)
      if (accountId === null) return yield* new HttpApiError.Unauthorized({})
      const destDir = sshIdentityDir(accountId)
      const result = yield* Effect.promise(() =>
        ingestServerIdentityFile({ sourcePath: ctx.payload.keyPath, destDir }),
      )
      if (!result.ok) {
        return { exists: false, ingested: false, keyPath: ctx.payload.keyPath.trim(), reason: result.reason }
      }
      yield* Effect.promise(() => restrictIdentityFilePermissions(result.keyPath))
      return { exists: true, ingested: result.ingested, keyPath: result.keyPath }
    })

    const sshConfigWrite = Effect.fn("GlobalHttpApi.sshConfigWrite")(function* (ctx: {
      payload: typeof GlobalSshConfigWriteInput.Type
    }) {
      if (!ctx.payload.name.trim() || !ctx.payload.config.host) {
        return yield* new HttpApiError.BadRequest({})
      }
      const current = Option.getOrUndefined(yield* Effect.serviceOption(PlatformAuth.CurrentSession))
      const accountId = requireAccountIdForPlatformSsh(current?.session?.account.id)
      if (accountId === null) return yield* new HttpApiError.Unauthorized({})
      const global = yield* config.getGlobal()
      const diskBefore = yield* Effect.promise(() => readManagedOpenSshTargets(accountId))
      const lookupName =
        ctx.payload.previousName && ctx.payload.previousName !== ctx.payload.name
          ? ctx.payload.previousName
          : ctx.payload.name
      const previousConfig = sshConfigSnapshot(lookupName, global.ssh, diskBefore)
      if (previousConfig) {
        const busy = connectedSshTargetProjects(lookupName)
        const mutation = connectedSshMutation({
          previousName: ctx.payload.previousName,
          nextName: ctx.payload.name,
          previous: previousConfig,
          next: ctx.payload.config,
        })
        if (mutation && busy.length) {
          return yield* ApiError.sshTargetBusy(
            sshTargetBusyMessage(mutation, lookupName, busy.map((item) => item.name)),
          )
        }
      }
      const previousKeyPath = sshAuthKeyPath(global.ssh?.[lookupName]) ?? sshAuthKeyPath(diskBefore[lookupName])
      const written = yield* Effect.promise(() => writeOpenSshConfig({ ...ctx.payload, accountId }))
      // Dual-write product config.ssh in the same request so Integration UI does not depend on a
      // follow-up /global/config PATCH (and stays aligned across native↔isolation).
      const ssh = { ...(global.ssh ?? {}) } as NonNullable<Config.Info["ssh"]>
      if (ctx.payload.previousName && ctx.payload.previousName !== ctx.payload.name) {
        delete ssh[ctx.payload.previousName]
        renameProjectSshTarget(ctx.payload.previousName, ctx.payload.name)
      }
      ssh[ctx.payload.name] = ctx.payload.config
      yield* config.updateGlobal({ ssh })
      yield* Effect.promise(() =>
        releaseReplacedSshIdentity({
          accountId,
          previousKeyPath,
          keepKeyPath: sshAuthKeyPath(ctx.payload.config),
          productSsh: ssh,
        }),
      )
      return written
    })

    const sshConfigRemove = Effect.fn("GlobalHttpApi.sshConfigRemove")(function* (ctx: {
      payload: typeof GlobalSshConfigRemoveInput.Type
    }) {
      if (!ctx.payload.name.trim()) return yield* new HttpApiError.BadRequest({})
      const current = Option.getOrUndefined(yield* Effect.serviceOption(PlatformAuth.CurrentSession))
      const accountId = requireAccountIdForPlatformSsh(current?.session?.account.id)
      if (accountId === null) return yield* new HttpApiError.Unauthorized({})
      const busy = connectedSshTargetProjects(ctx.payload.name)
      if (busy.length) {
        return yield* ApiError.sshTargetBusy(
          sshTargetBusyMessage("remove", ctx.payload.name, busy.map((item) => item.name)),
        )
      }
      const global = yield* config.getGlobal()
      const diskBefore = yield* Effect.promise(() => readManagedOpenSshTargets(accountId))
      const previousKeyPath = sshAuthKeyPath(global.ssh?.[ctx.payload.name]) ?? sshAuthKeyPath(diskBefore[ctx.payload.name])
      const removed = yield* Effect.promise(() => removeOpenSshConfig(ctx.payload.name, accountId))
      let ssh = global.ssh
      if (global.ssh && ctx.payload.name in global.ssh) {
        ssh = { ...global.ssh }
        delete ssh[ctx.payload.name]
        yield* config.updateGlobal({ ssh })
      }
      yield* Effect.promise(() =>
        releaseReplacedSshIdentity({
          accountId,
          previousKeyPath,
          productSsh: ssh,
        }),
      )
      return removed
    })

    const sshTargets = Effect.fn("GlobalHttpApi.sshTargets")(function* () {
      const current = Option.getOrUndefined(yield* Effect.serviceOption(PlatformAuth.CurrentSession))
      // Integration list is always account-scoped platform-ssh — never fall back to OS ~/.ssh.
      // A session-less read of empty ~/.ssh during login raced the client into pinning {} and
      // then skipping every later hydrate (UI empty; Network had no `targets` call).
      const accountId = current?.session?.account.id
      if (!accountId) return yield* new HttpApiError.Unauthorized({})
      const ssh = yield* Effect.promise(() => readManagedOpenSshTargets(accountId))
      // Keep product config aligned whenever Integration asks for the durable OpenSSH list.
      if (Object.keys(ssh).length > 0) {
        const global = yield* config.getGlobal()
        const product = global.ssh ?? {}
        const missing = Object.keys(ssh).filter((name) => {
          const entry = product[name]
          return !(entry && typeof entry === "object" && "host" in entry && "remotePath" in entry)
        })
        if (missing.length > 0) {
          yield* config.updateGlobal({ ssh: { ...product, ...ssh } })
        }
      }
      return { ssh, path: openSshConfigPath(accountId) }
    })

    const pathDirs = Effect.fn("GlobalHttpApi.pathDirs")(function* (ctx: { query: { path?: string } }) {
      const current = yield* PlatformAuth.CurrentSession
      const root = PlatformAuth.defaultWorkspaceRoot(current.session) ?? projectDataRoot()
      return yield* Effect.promise(() => listProjectDataSubdirectories(ctx.query.path ?? "", root))
    })

    const session = Effect.fn("GlobalHttpApi.session")(function* (ctx: { query: typeof GlobalSessionListQuery.Type }) {
      const limit = ctx.query.limit ?? 100
      const sessions = Array.from(
        Session.listGlobal({
          directory: ctx.query.directory,
          roots: ctx.query.roots,
          start: ctx.query.start,
          cursor: ctx.query.cursor,
          search: ctx.query.search,
          limit: limit + 1,
          archived: ctx.query.archived,
        }),
      )
      const list = sessions.length > limit ? sessions.slice(0, limit) : sessions
      return HttpServerResponse.jsonUnsafe(list, {
        headers:
          sessions.length > limit && list.length > 0
            ? { "x-next-cursor": String(list[list.length - 1].time.updated) }
            : undefined,
      })
    })

    const onesciencePresetStatus = Effect.fn("GlobalHttpApi.onesciencePresetStatus")(function* () {
      return yield* Effect.promise(() => OnesciencePreset.status())
    })

    const onesciencePresetLogin = Effect.fn("GlobalHttpApi.onesciencePresetLogin")(function* (ctx: {
      payload: typeof OnesciencePresetLoginInput.Type
    }) {
      return yield* Effect.promise(() => OnesciencePreset.attemptAdminLogin(ctx.payload.password))
    })

    const onesciencePresetConfigGet = Effect.fn("GlobalHttpApi.onesciencePresetConfigGet")(function* (ctx: {
      payload: typeof OnesciencePresetTokenInput.Type
    }) {
      if (!OnesciencePreset.verifyAdminSession(ctx.payload.token)) return yield* new HttpApiError.Unauthorized({})
      const cfg = yield* Effect.promise(() => OnesciencePreset.resolveConfig())
      return {
        baseURL: cfg.baseURL,
        modelID: cfg.modelID,
        modelName: cfg.modelName,
        providerName: cfg.providerName,
        hasApiKey: Boolean(cfg.apiKey),
      }
    })

    const onesciencePresetConfigUpdate = Effect.fn("GlobalHttpApi.onesciencePresetConfigUpdate")(function* (ctx: {
      payload: typeof OnesciencePresetConfigUpdateInput.Type
    }) {
      if (!OnesciencePreset.verifyAdminSession(ctx.payload.token)) return yield* new HttpApiError.Unauthorized({})
      // Do not dispose here: the client awaits dispose+reload after save/reset.
      // Forking dispose on the server races with that refresh and left lists stale.
      const cfg = yield* Effect.promise(() =>
        OnesciencePreset.updateConfig(
          {
            baseURL: ctx.payload.baseURL,
            apiKey: ctx.payload.apiKey,
            modelID: ctx.payload.modelID,
            modelName: ctx.payload.modelName,
            providerName: ctx.payload.providerName,
          },
          { clearApiKey: ctx.payload.clearApiKey },
        ),
      )
      return {
        baseURL: cfg.baseURL,
        modelID: cfg.modelID,
        modelName: cfg.modelName,
        providerName: cfg.providerName,
        hasApiKey: Boolean(cfg.apiKey),
      }
    })

    const onesciencePresetReset = Effect.fn("GlobalHttpApi.onesciencePresetReset")(function* (ctx: {
      payload: typeof OnesciencePresetTokenInput.Type
    }) {
      if (!OnesciencePreset.verifyAdminSession(ctx.payload.token)) return yield* new HttpApiError.Unauthorized({})
      const cfg = yield* Effect.promise(() => OnesciencePreset.resetOverride())
      return {
        baseURL: cfg.baseURL,
        modelID: cfg.modelID,
        modelName: cfg.modelName,
        providerName: cfg.providerName,
        hasApiKey: Boolean(cfg.apiKey),
      }
    })

    const onesciencePresetAccounts = Effect.fn("GlobalHttpApi.onesciencePresetAccounts")(function* (ctx: {
      payload: typeof OnesciencePresetTokenInput.Type
    }) {
      if (!OnesciencePreset.verifyAdminSession(ctx.payload.token)) return yield* new HttpApiError.Unauthorized({})
      return yield* Effect.try({
        try: () => ({ items: PlatformAuth.listAccounts() }),
        catch: () => new HttpApiError.BadRequest({}),
      })
    })

    const onesciencePresetAccountStatus = Effect.fn("GlobalHttpApi.onesciencePresetAccountStatus")(function* (ctx: {
      payload: typeof OnesciencePresetAccountStatusInput.Type
    }) {
      if (!OnesciencePreset.verifyAdminSession(ctx.payload.token)) return yield* new HttpApiError.Unauthorized({})
      return yield* Effect.try({
        try: () => PlatformAuth.setAccountStatus({ accountId: ctx.payload.accountId, status: ctx.payload.status }),
        catch: () => new HttpApiError.BadRequest({}),
      })
    })

    const onesciencePresetAccountDelete = Effect.fn("GlobalHttpApi.onesciencePresetAccountDelete")(function* (ctx: {
      payload: typeof OnesciencePresetAccountDeleteInput.Type
    }) {
      if (!OnesciencePreset.verifyAdminSession(ctx.payload.token)) return yield* new HttpApiError.Unauthorized({})
      return yield* Effect.try({
        try: () => PlatformAuth.adminDeleteAccount({ accountId: ctx.payload.accountId }),
        catch: () => new HttpApiError.BadRequest({}),
      })
    })

    const onesciencePresetPasswordReset = Effect.fn("GlobalHttpApi.onesciencePresetPasswordReset")(function* (ctx: {
      payload: typeof OnesciencePresetPasswordResetInput.Type
    }) {
      if (!OnesciencePreset.verifyAdminSession(ctx.payload.token)) return yield* new HttpApiError.Unauthorized({})
      return yield* Effect.try({
        try: () => PlatformAuth.createAdminPasswordReset({ accountId: ctx.payload.accountId }),
        catch: () => new HttpApiError.BadRequest({}),
      })
    })

    const onesciencePresetMailConfigGet = Effect.fn("GlobalHttpApi.onesciencePresetMailConfigGet")(function* (ctx: {
      payload: typeof OnesciencePresetTokenInput.Type
    }) {
      if (!OnesciencePreset.verifyAdminSession(ctx.payload.token)) return yield* new HttpApiError.Unauthorized({})
      return yield* Effect.promise(() => viewMailConfig())
    })

    const onesciencePresetMailConfigUpdate = Effect.fn("GlobalHttpApi.onesciencePresetMailConfigUpdate")(function* (ctx: {
      payload: typeof OnesciencePresetMailConfigUpdateInput.Type
    }) {
      if (!OnesciencePreset.verifyAdminSession(ctx.payload.token)) return yield* new HttpApiError.Unauthorized({})
      return yield* Effect.tryPromise({
        try: () =>
          writeMailOverride({
            host: ctx.payload.host,
            port: ctx.payload.port,
            secure: ctx.payload.secure,
            user: ctx.payload.user,
            from: ctx.payload.from,
            pass: ctx.payload.pass,
            testTo: ctx.payload.testTo,
            clearPassword: ctx.payload.clearPassword,
          }),
        catch: () => new HttpApiError.BadRequest({}),
      })
    })

    const onesciencePresetMailTest = Effect.fn("GlobalHttpApi.onesciencePresetMailTest")(function* (ctx: {
      payload: typeof OnesciencePresetMailTestInput.Type
    }) {
      if (!OnesciencePreset.verifyAdminSession(ctx.payload.token)) return yield* new HttpApiError.Unauthorized({})
      return yield* Effect.promise(async () => {
        try {
          await sendMail(
            {
              to: ctx.payload.to.trim(),
              subject: "OneCode SMTP test",
              text: "这是一封 OneCode 邮件服务测试信。若收到此邮件，说明 SMTP 配置可用。",
            },
            {
              host: ctx.payload.host,
              port: ctx.payload.port,
              secure: ctx.payload.secure,
              user: ctx.payload.user,
              from: ctx.payload.from,
              pass: ctx.payload.pass,
            },
          )
          return { ok: true as const }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.error("[mail-test]", message)
          return { ok: false as const, error: message }
        }
      })
    })

    const onescienceRegistrationPublic = Effect.fn("GlobalHttpApi.onescienceRegistrationPublic")(function* () {
      return yield* Effect.promise(() => publicRegistrationGate())
    })

    const onesciencePresetRegistrationConfigGet = Effect.fn("GlobalHttpApi.onesciencePresetRegistrationConfigGet")(
      function* (ctx: { payload: typeof OnesciencePresetTokenInput.Type }) {
        if (!OnesciencePreset.verifyAdminSession(ctx.payload.token)) return yield* new HttpApiError.Unauthorized({})
        return yield* Effect.promise(() => viewRegistrationConfig())
      },
    )

    const onesciencePresetRegistrationConfigUpdate = Effect.fn(
      "GlobalHttpApi.onesciencePresetRegistrationConfigUpdate",
    )(function* (ctx: { payload: typeof OnescienceRegistrationConfigUpdateInput.Type }) {
      if (!OnesciencePreset.verifyAdminSession(ctx.payload.token)) return yield* new HttpApiError.Unauthorized({})
      return yield* Effect.tryPromise({
        try: () =>
          updateRegistrationConfig({
            inviteRequired: ctx.payload.inviteRequired,
            fixedCode: ctx.payload.fixedCode,
            fixedTtlDays: ctx.payload.fixedTtlDays,
            clearFixedInvite: ctx.payload.clearFixedInvite,
          }),
        catch: () => new HttpApiError.BadRequest({}),
      })
    })

    const onesciencePresetRegistrationRandomInvite = Effect.fn(
      "GlobalHttpApi.onesciencePresetRegistrationRandomInvite",
    )(function* (ctx: { payload: typeof OnescienceRegistrationRandomInviteInput.Type }) {
      if (!OnesciencePreset.verifyAdminSession(ctx.payload.token)) return yield* new HttpApiError.Unauthorized({})
      return yield* Effect.tryPromise({
        try: () => createRandomInvite(),
        catch: () => new HttpApiError.BadRequest({}),
      })
    })

    const providerProbe = Effect.fn("GlobalHttpApi.providerProbe")(function* (ctx: {
      payload: typeof GlobalProviderProbeInput.Type
    }) {
      const baseURL = ctx.payload.baseURL?.trim()
      if (!baseURL || !/^https?:\/\//.test(baseURL)) {
        return yield* new HttpApiError.BadRequest({})
      }
      return yield* Effect.promise(() =>
        probeCustomProvider({
          baseURL,
          apiKey: ctx.payload.apiKey?.trim() || undefined,
          headers: ctx.payload.headers,
          modelID: ctx.payload.modelID?.trim() || undefined,
        }),
      )
    })

    const providerModels = Effect.fn("GlobalHttpApi.providerModels")(function* (ctx: {
      payload: typeof GlobalProviderModelsInput.Type
    }) {
      const baseURL = ctx.payload.baseURL?.trim()
      if (!baseURL || !/^https?:\/\//.test(baseURL)) {
        return yield* new HttpApiError.BadRequest({})
      }

      let apiKey = ctx.payload.apiKey?.trim() || undefined
      if (!apiKey && ctx.payload.providerID?.trim()) {
        const providerID = ctx.payload.providerID.trim()
        const stored = yield* auth.get(providerID).pipe(Effect.orElseSucceed(() => undefined))
        if (stored?.type === "api") apiKey = stored.key
        else if (stored?.type === "wellknown") apiKey = stored.token
        if (!apiKey && providerID === OnesciencePreset.PROVIDER_ID) {
          const cfg = yield* Effect.promise(() => OnesciencePreset.resolveConfig())
          if (cfg.apiKey) apiKey = cfg.apiKey
        }
      }

      return yield* Effect.promise(() =>
        listCustomProviderModels({
          baseURL,
          apiKey,
          headers: ctx.payload.headers,
        }),
      )
    })

    const projectExecution = Effect.fn("GlobalHttpApi.projectExecution")(function* (ctx: {
      payload: typeof GlobalProjectExecutionInput.Type
    }) {
      const directory = ctx.payload.directory?.trim()
      const projectID = ctx.payload.projectID?.trim()
      if (!directory && !projectID) return yield* new HttpApiError.BadRequest({})
      const row = lookupProjectRow({ directory, projectID })
      if (!row) return yield* new HttpApiError.NotFound({})
      const current = Option.getOrUndefined(yield* Effect.serviceOption(PlatformAuth.CurrentSession))
      if (!PlatformAuth.canWritePath(current?.session, row.worktree)) {
        return yield* new HttpApiError.Forbidden({})
      }
      const project = Project.setProjectExecution({
        projectID: row.id,
        directory: row.worktree,
        execution: ctx.payload.execution,
      })
      if (!project) return yield* new HttpApiError.NotFound({})
      return { project }
    })

    return handlers
      .handle("health", health)
      .handleRaw("event", event)
      .handle("configGet", configGet)
      .handle("configUpdate", configUpdate)
      .handle("dispose", dispose)
      .handleRaw("upgrade", upgradeRaw)
      .handle("pathDirs", pathDirs)
      .handle("session", session)
      .handle("sshTest", sshTest)
      .handle("sshWorkspacePreflight", sshWorkspacePreflight)
      .handle("sshConnectProgress", sshConnectProgress)
      .handle("sshConnectAbort", sshConnectAbort)
      .handle("sshIdentityUpload", sshIdentityUpload)
      .handle("sshIdentityCheck", sshIdentityCheck)
      .handle("sshIdentityIngest", sshIdentityIngest)
      .handle("sshConfigWrite", sshConfigWrite)
      .handle("sshConfigRemove", sshConfigRemove)
      .handle("sshTargets", sshTargets)
      .handle("onesciencePresetStatus", onesciencePresetStatus)
      .handle("onesciencePresetLogin", onesciencePresetLogin)
      .handle("onesciencePresetConfigGet", onesciencePresetConfigGet)
      .handle("onesciencePresetConfigUpdate", onesciencePresetConfigUpdate)
      .handle("onesciencePresetReset", onesciencePresetReset)
      .handle("onesciencePresetAccounts", onesciencePresetAccounts)
      .handle("onesciencePresetAccountStatus", onesciencePresetAccountStatus)
      .handle("onesciencePresetAccountDelete", onesciencePresetAccountDelete)
      .handle("onesciencePresetPasswordReset", onesciencePresetPasswordReset)
      .handle("onesciencePresetMailConfigGet", onesciencePresetMailConfigGet)
      .handle("onesciencePresetMailConfigUpdate", onesciencePresetMailConfigUpdate)
      .handle("onesciencePresetMailTest", onesciencePresetMailTest)
      .handle("onescienceRegistrationPublic", onescienceRegistrationPublic)
      .handle("onesciencePresetRegistrationConfigGet", onesciencePresetRegistrationConfigGet)
      .handle("onesciencePresetRegistrationConfigUpdate", onesciencePresetRegistrationConfigUpdate)
      .handle("onesciencePresetRegistrationRandomInvite", onesciencePresetRegistrationRandomInvite)
      .handle("providerProbe", providerProbe)
      .handle("providerModels", providerModels)
      .handle("projectExecution", projectExecution)
  }),
)
