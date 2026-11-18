import * as Log from "@opencode-ai/core/util/log"
import path from "path"
import { pathToFileURL } from "url"
import os from "os"
import { mergeDeep } from "remeda"
import { OneCodeExtraPath } from "@opencode-ai/core/extra-path"
import { Global } from "@opencode-ai/core/global"
import fsNode from "fs/promises"
import { NamedError } from "@opencode-ai/core/util/error"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Auth } from "../auth"
import { Env } from "../env"
import { applyEdits, modify } from "jsonc-parser"
import { type InstanceContext } from "../project/instance"
import { InstallationLocal, InstallationVersion } from "@opencode-ai/core/installation/version"
import { existsSync } from "fs"
import { Account } from "@/account/account"
import { isRecord } from "@/util/record"
import type { ConsoleState } from "./console-state"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import { Context, Duration, Effect, Exit, Fiber, Layer, Option, Schema } from "effect"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { containsPath } from "../project/instance-context"
import { NonNegativeInt, PositiveInt, type DeepMutable } from "@opencode-ai/core/schema"
import * as PlatformAuth from "@/platform-auth/platform-auth"
import { ConfigAgent } from "./agent"
import { ConfigAttachment } from "./attachment"
import { ConfigCommand } from "./command"
import { ConfigFormatter } from "./formatter"
import { ConfigLayout } from "./layout"
import { ConfigLSP } from "./lsp"
import { ConfigManaged } from "./managed"
import { ConfigMCP } from "./mcp"
import { ConfigModelID } from "./model-id"
import { ConfigOneScience } from "./onescience"
import { ConfigParse } from "./parse"
import { PublicProviders } from "./public-providers"
import { ConfigPaths } from "./paths"
import { ConfigPermission } from "./permission"
import { ConfigPlugin } from "./plugin"
import {
  mergeSshFromOpenSsh,
  readManagedOpenSshTargets,
  syncOpenSshFromProductSsh,
  type ProductSshMap,
} from "@/server/ssh-config-file"
import { ConfigProvider } from "./provider"
import { ConfigReference } from "./reference"
import { ConfigServer } from "./server"
import { ConfigSkills } from "./skills"
import { ConfigSSH } from "./ssh"
import { ConfigVariable } from "./variable"
import { Npm } from "@opencode-ai/core/npm"

const log = Log.create({ service: "config" })

/** Top-level maps that clients send as a full replacement, not a partial deep-merge. */
const REPLACE_MAP_KEYS = new Set(["ssh", "mcp"])

// Custom merge function that concatenates array fields instead of replacing them
// Keep remeda's deep conditional merge type out of hot config-loading paths; TS profiling showed it dominates here.
// ssh/mcp must replace (not deep-merge) when a later layer defines them — otherwise a deleted host in
// ONECODE_EXTRA_PATH/.config/opencode can reappear from ~/.config/opencode after reload.
function mergeConfig(target: Info, source: Info): Info {
  const merged = mergeDeep(target, source) as Info
  for (const key of REPLACE_MAP_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      ;(merged as Record<string, unknown>)[key] = (source as Record<string, unknown>)[key]
    }
  }
  return merged
}

function applyConfigPatch(existing: Info, patch: Info): Info {
  const deletedProviders = patch.deleted_providers ?? []
  const { deleted_providers: _deletedProviders, ...patchWithoutDeletes } = patch
  const merged = mergeDeep(existing, patchWithoutDeletes) as Info
  for (const key of REPLACE_MAP_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patchWithoutDeletes, key)) {
      ;(merged as Record<string, unknown>)[key] = (patchWithoutDeletes as Record<string, unknown>)[key]
    }
  }
  // Custom-provider UI sends a full provider payload (npm + models). Deep-merge cannot
  // delete removed model/header keys, so replace that provider entry entirely.
  if (isRecord(patchWithoutDeletes.provider) && isRecord(merged.provider)) {
    for (const [id, next] of Object.entries(patchWithoutDeletes.provider)) {
      if (!isRecord(next)) continue
      if (next.npm === "@ai-sdk/openai-compatible" && "models" in next) {
        merged.provider[id] = next as (typeof merged.provider)[string]
        continue
      }
      if ("models" in next && isRecord(merged.provider[id])) {
        merged.provider[id] = {
          ...merged.provider[id],
          ...next,
          models: next.models,
        } as (typeof merged.provider)[string]
      }
    }
  }
  // Hard-delete providers (disconnect custom relays). Deep-merge cannot remove map keys.
  if (deletedProviders.length > 0 && merged.provider) {
    const provider = { ...merged.provider }
    for (const id of deletedProviders) delete provider[id]
    merged.provider = provider
  }
  delete (merged as { deleted_providers?: string[] }).deleted_providers
  return merged
}

function mergeConfigConcatArrays(target: Info, source: Info): Info {
  const merged = mergeConfig(target, source)
  if (target.instructions && source.instructions) {
    merged.instructions = Array.from(new Set([...target.instructions, ...source.instructions]))
  }
  const targetSkills = target.skills
  const sourceSkills = source.skills
  if (targetSkills?.paths?.length || sourceSkills?.paths?.length) {
    merged.skills = merged.skills ?? {}
    merged.skills.paths = Array.from(new Set([...(targetSkills?.paths ?? []), ...(sourceSkills?.paths ?? [])]))
  }
  if (targetSkills?.urls?.length || sourceSkills?.urls?.length) {
    merged.skills = merged.skills ?? {}
    merged.skills.urls = Array.from(new Set([...(targetSkills?.urls ?? []), ...(sourceSkills?.urls ?? [])]))
  }
  return merged
}

function stripNullishDeep(value: unknown): unknown {
  if (value === null || value === undefined) return undefined
  if (Array.isArray(value)) {
    return value.map((item) => stripNullishDeep(item)).filter((item) => item !== undefined)
  }
  if (!isRecord(value)) return value
  const next: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const cleaned = stripNullishDeep(item)
    if (cleaned !== undefined) next[key] = cleaned
  }
  return next
}

/** Coerce incomplete / UI-partial onescience.json into a schema-acceptable shape. */
function normalizeLoadedOneScienceConfig(data: unknown) {
  const stripped = stripNullishDeep(data)
  if (!isRecord(stripped)) return data

  // Always materialize runtime — agent/UI writes often omit it or leave nulls.
  // Returning `{}` without runtime still fails schema and used to brick desktop.
  const runtime: Record<string, unknown> = isRecord(stripped.runtime) ? { ...stripped.runtime } : {}
  if (typeof runtime.backend_id !== "string") runtime.backend_id = ""

  for (const key of ["remote", "target", "environment", "cluster", "conda", "resources", "script"] as const) {
    if (!isRecord(runtime[key])) runtime[key] = {}
  }

  if ("execution_profile" in runtime && !isRecord(runtime.execution_profile)) {
    delete runtime.execution_profile
  }
  if ("logs" in runtime && !isRecord(runtime.logs)) {
    delete runtime.logs
  }
  if ("submission" in runtime && !isRecord(runtime.submission)) {
    delete runtime.submission
  }
  if ("modules" in runtime && !Array.isArray(runtime.modules)) {
    delete runtime.modules
  }

  return {
    ...stripped,
    runtime,
  }
}

/** Disable-only `{ enabled }` stubs — must NOT accept partial full entries (Schema.Struct would strip extras). */
const DisableOnlyStub = Schema.declare(
  (input: unknown): input is { enabled: boolean } =>
    isRecord(input) && Object.keys(input).length === 1 && typeof input.enabled === "boolean",
).annotate({ identifier: "ConfigDisableOnlyStub" })

/** Coerce/sanitize SSH map entries before Schema decode so corrupt partials cannot brick getGlobal. */
function normalizeSshMap(ssh: unknown): unknown {
  if (!isRecord(ssh)) return ssh
  const next: Record<string, unknown> = {}
  for (const [name, entry] of Object.entries(ssh)) {
    if (!isRecord(entry)) continue
    const host = typeof entry.host === "string" ? entry.host.trim() : ""
    const remotePath = typeof entry.remotePath === "string" ? entry.remotePath.trim() : ""
    const keys = Object.keys(entry)

    // Exact disable stub — keep as-is.
    if (keys.length === 1 && typeof entry.enabled === "boolean") {
      next[name] = { enabled: entry.enabled }
      continue
    }

    // Complete enough to be a real target — coerce wire quirks.
    if (host && remotePath) {
      const copy: Record<string, unknown> = { ...entry, host, remotePath }
      if (typeof copy.port === "string" && copy.port.trim()) {
        const port = Number(copy.port)
        if (Number.isInteger(port) && port >= 1 && port <= 65535) copy.port = port
      }
      if (isRecord(copy.options)) {
        copy.options = Object.fromEntries(
          Object.entries(copy.options).map(([key, value]) => [key, value == null ? value : String(value)]),
        )
      }
      next[name] = copy
      continue
    }

    // Corrupt partial (e.g. {enabled, host} without remotePath): demote so Schema cannot throw
    // and healAccountConfigSsh can refill from managed OpenSSH on the next getGlobal.
    if (typeof entry.enabled === "boolean") {
      next[name] = { enabled: entry.enabled }
    }
  }
  return next
}

function normalizeLoadedConfig(data: unknown, source: string) {
  if (!isRecord(data)) return data
  const copy = { ...data }
  if ("ssh" in copy) copy.ssh = normalizeSshMap(copy.ssh)
  const hadLegacy = "theme" in copy || "keybinds" in copy || "tui" in copy
  if (!hadLegacy) return copy
  delete copy.theme
  delete copy.keybinds
  delete copy.tui
  log.warn("tui keys in opencode config are deprecated; move them to tui.json", { path: source })
  return copy
}

async function substituteWellKnownRemoteConfig(input: { value: unknown; dir: string; source: string }) {
  if (!isRecord(input.value) || typeof input.value.url !== "string") return

  const url = await ConfigVariable.substitute({
    text: input.value.url,
    type: "virtual",
    dir: input.dir,
    source: input.source,
  })
  const headers = isRecord(input.value.headers)
    ? Object.fromEntries(
        await Promise.all(
          Object.entries(input.value.headers)
            .filter((entry): entry is [string, string] => typeof entry[1] === "string")
            .map(async ([key, value]) => [
              key,
              await ConfigVariable.substitute({
                text: value,
                type: "virtual",
                dir: input.dir,
                source: input.source,
              }),
            ]),
        ),
      )
    : undefined

  return { url, headers }
}

async function resolveLoadedPlugins<T extends { plugin?: ConfigPlugin.Spec[] }>(config: T, filepath: string) {
  if (!config.plugin) return config
  for (let i = 0; i < config.plugin.length; i++) {
    // Normalize path-like plugin specs while we still know which config file declared them.
    // This prevents `./plugin.ts` from being reinterpreted relative to some later merge location.
    config.plugin[i] = await ConfigPlugin.resolvePluginSpec(config.plugin[i], filepath)
  }
  return config
}

export type Layout = ConfigLayout.Layout

const LogLevelRef = Schema.Literals(["DEBUG", "INFO", "WARN", "ERROR"]).annotate({
  identifier: "LogLevel",
  description: "Log level",
})

export const Info = Schema.Struct({
  $schema: Schema.optional(Schema.String).annotate({
    description: "JSON schema reference for configuration validation",
  }),
  shell: Schema.optional(Schema.String).annotate({
    description: "Default shell to use for terminal and bash tool",
  }),
  logLevel: Schema.optional(LogLevelRef).annotate({ description: "Log level" }),
  server: Schema.optional(ConfigServer.Server).annotate({
    description: "Server configuration for opencode serve and web commands",
  }),
  command: Schema.optional(Schema.Record(Schema.String, ConfigCommand.Info)).annotate({
    description: "Command configuration, see https://opencode.ai/docs/commands",
  }),
  skills: Schema.optional(ConfigSkills.Info).annotate({ description: "Additional skill folder paths" }),
  reference: Schema.optional(ConfigReference.Info).annotate({
    description: "Named git or local directory references that can be mentioned as @alias or @alias/path",
  }),
  watcher: Schema.optional(
    Schema.Struct({
      ignore: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
    }),
  ),
  snapshot: Schema.optional(Schema.Boolean).annotate({
    description:
      "Enable or disable snapshot tracking. When false, filesystem snapshots are not recorded and undoing or reverting will not undo/redo file changes. Defaults to true.",
  }),
  // User-facing plugin config is stored as Specs; provenance gets attached later while configs are merged.
  plugin: Schema.optional(Schema.mutable(Schema.Array(ConfigPlugin.Spec))),
  share: Schema.optional(Schema.Literals(["manual", "auto", "disabled"])).annotate({
    description:
      "Control sharing behavior:'manual' allows manual sharing via commands, 'auto' enables automatic sharing, 'disabled' disables all sharing",
  }),
  autoshare: Schema.optional(Schema.Boolean).annotate({
    description: "@deprecated Use 'share' field instead. Share newly created sessions automatically",
  }),
  autoupdate: Schema.optional(Schema.Union([Schema.Boolean, Schema.Literal("notify")])).annotate({
    description:
      "Automatically update to the latest version. Set to true to auto-update, false to disable, or 'notify' to show update notifications",
  }),
  disabled_providers: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Disable providers that are loaded automatically",
  }),
  public_providers: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description:
      "Read-only provider IDs loaded from the shared opencode.json at process start. Not persisted.",
  }),
  deleted_providers: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description:
      "Provider IDs to remove from config.provider on update. Not persisted — applied then discarded.",
  }),
  enabled_providers: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "When set, ONLY these providers will be enabled. All other providers will be ignored",
  }),
  model: Schema.optional(ConfigModelID).annotate({
    description: "Model to use in the format of provider/model, eg anthropic/claude-2",
  }),
  small_model: Schema.optional(ConfigModelID).annotate({
    description: "Small model to use for tasks like title generation in the format of provider/model",
  }),
  default_agent: Schema.optional(Schema.String).annotate({
    description:
      "Default agent to use when none is specified. Must be a primary agent. Falls back to 'build' if not set or if the specified agent is invalid.",
  }),
  username: Schema.optional(Schema.String).annotate({
    description: "Custom username to display in conversations instead of system username",
  }),
  mode: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({
        build: Schema.optional(ConfigAgent.Info),
        plan: Schema.optional(ConfigAgent.Info),
      }),
      [Schema.Record(Schema.String, ConfigAgent.Info)],
    ),
  ).annotate({ description: "@deprecated Use `agent` field instead." }),
  agent: Schema.optional(
    Schema.StructWithRest(
      Schema.Struct({
        // primary
        plan: Schema.optional(ConfigAgent.Info),
        build: Schema.optional(ConfigAgent.Info),
        // subagent
        general: Schema.optional(ConfigAgent.Info),
        explore: Schema.optional(ConfigAgent.Info),
        scout: Schema.optional(ConfigAgent.Info),
        // specialized
        title: Schema.optional(ConfigAgent.Info),
        summary: Schema.optional(ConfigAgent.Info),
        compaction: Schema.optional(ConfigAgent.Info),
      }),
      [Schema.Record(Schema.String, ConfigAgent.Info)],
    ),
  ).annotate({ description: "Agent configuration, see https://opencode.ai/docs/agents" }),
  provider: Schema.optional(Schema.Record(Schema.String, ConfigProvider.Info)).annotate({
    description: "Custom provider configurations and model overrides",
  }),
  mcp: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Union([
        ConfigMCP.Info,
        // Legacy `{ enabled: false }` only — exact key set so partial MCP objects never strip to this stub.
        DisableOnlyStub,
      ]),
    ),
  ).annotate({ description: "MCP (Model Context Protocol) server configurations" }),
  ssh: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Union([
        ConfigSSH.Info,
        // Legacy `{ enabled: false }` only — exact key set so invalid full entries fail instead of
        // silently decoding as `{ enabled: true }` (which Integration UI then hides as "empty").
        DisableOnlyStub,
      ]),
    ),
  ).annotate({ description: "SSH remote job submission configurations for agents" }),
  onescience: Schema.optional(ConfigOneScience.Info).annotate({
    description: "OneScience runtime status configuration for project-level scientific workflows",
  }),
  formatter: Schema.optional(ConfigFormatter.Info).annotate({
    description:
      "Enable or configure formatters. Omit or set to false to disable, true to enable built-ins, or an object to enable built-ins with overrides.",
  }),
  lsp: Schema.optional(ConfigLSP.Info).annotate({
    description:
      "Enable or configure LSP servers. Omit or set to false to disable, true to enable built-ins, or an object to enable built-ins with overrides.",
  }),
  instructions: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Additional instruction files or patterns to include",
  }),
  layout: Schema.optional(ConfigLayout.Layout).annotate({ description: "@deprecated Always uses stretch layout." }),
  permission: Schema.optional(ConfigPermission.Info),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
  attachment: Schema.optional(ConfigAttachment.Info).annotate({
    description: "Attachment processing configuration, including image size limits and resizing behavior",
  }),
  enterprise: Schema.optional(
    Schema.Struct({
      url: Schema.optional(Schema.String).annotate({ description: "Enterprise URL" }),
    }),
  ),
  tool_output: Schema.optional(
    Schema.Struct({
      max_lines: Schema.optional(PositiveInt).annotate({
        description: "Maximum lines of tool output before it is truncated and saved to disk (default: 2000)",
      }),
      max_bytes: Schema.optional(PositiveInt).annotate({
        description: "Maximum bytes of tool output before it is truncated and saved to disk (default: 51200)",
      }),
    }),
  ).annotate({
    description:
      "Thresholds for truncating tool output. When output exceeds either limit, the full text is written to the truncation directory and a preview is returned.",
  }),
  compaction: Schema.optional(
    Schema.Struct({
      auto: Schema.optional(Schema.Boolean).annotate({
        description: "Enable automatic compaction when context is full (default: true)",
      }),
      prune: Schema.optional(Schema.Boolean).annotate({
        description: "Enable pruning of old tool outputs (default: true)",
      }),
      tail_turns: Schema.optional(NonNegativeInt).annotate({
        description:
          "Number of recent user turns, including their following assistant/tool responses, to keep verbatim during compaction (default: 2)",
      }),
      preserve_recent_tokens: Schema.optional(NonNegativeInt).annotate({
        description: "Maximum number of tokens from recent turns to preserve verbatim after compaction",
      }),
      reserved: Schema.optional(NonNegativeInt).annotate({
        description: "Token buffer for compaction. Leaves enough window to avoid overflow during compaction.",
      }),
    }),
  ),
  experimental: Schema.optional(
    Schema.Struct({
      disable_paste_summary: Schema.optional(Schema.Boolean),
      batch_tool: Schema.optional(Schema.Boolean).annotate({ description: "Enable the batch tool" }),
      openTelemetry: Schema.optional(Schema.Boolean).annotate({
        description: "Enable OpenTelemetry spans for AI SDK calls (using the 'experimental_telemetry' flag)",
      }),
      primary_tools: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
        description: "Tools that should only be available to primary agents.",
      }),
      continue_loop_on_deny: Schema.optional(Schema.Boolean).annotate({
        description: "Continue the agent loop when a tool call is denied",
      }),
      mcp_timeout: Schema.optional(PositiveInt).annotate({
        description: "Timeout in milliseconds for model context protocol (MCP) requests",
      }),
      task_stall_timeout_ms: Schema.optional(PositiveInt).annotate({
        description:
          "Cancel a task tool subagent session after this many milliseconds without any activity (default: 600000)",
      }),
    }),
  ),
}).annotate({ identifier: "Config" })

// Uses the shared `DeepMutable` from `@opencode-ai/core/schema`. See the definition
// there for why the local variant is needed over `Types.DeepMutable` from
// effect-smol (the upstream version collapses `unknown` to `{}`).
export type Info = DeepMutable<Schema.Schema.Type<typeof Info>> & {
  // plugin_origins is derived state, not a persisted config field. It keeps each winning plugin spec together
  // with the file and scope it came from so later runtime code can make location-sensitive decisions.
  plugin_origins?: ConfigPlugin.Origin[]
}

type State = {
  config: Info
  directories: string[]
  deps: Fiber.Fiber<void, never>[]
  consoleState: ConsoleState
}

export interface Interface {
  readonly get: () => Effect.Effect<Info>
  readonly getGlobal: () => Effect.Effect<Info>
  readonly getConsoleState: () => Effect.Effect<ConsoleState>
  readonly update: (config: Info) => Effect.Effect<void>
  readonly updateGlobal: (config: Info) => Effect.Effect<{ info: Info; changed: boolean }>
  readonly invalidate: () => Effect.Effect<void>
  readonly directories: () => Effect.Effect<string[]>
  readonly waitForDependencies: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Config") {}

function globalConfigDir() {
  if (Flag.OPENCODE_CONFIG_DIR) return Flag.OPENCODE_CONFIG_DIR
  const extra = OneCodeExtraPath.configDir()
  if (extra) {
    OneCodeExtraPath.ensureDirs()
    return extra
  }
  return Global.Path.config
}

function globalConfigFile() {
  const dir = globalConfigDir()
  const candidates = ["opencode.jsonc", "opencode.json", "config.json"].map((file) => path.join(dir, file))
  for (const file of candidates) {
    if (existsSync(file)) return file
  }
  // Prefer jsonc for newly seeded global config so editors get schema + comment support.
  return path.join(dir, "opencode.jsonc")
}

/**
 * Every shared global config path that {@link loadGlobal} merges.
 * Disconnect/delete must hard-remove providers from all of these — writing only
 * `globalConfigFile()` leaves DeepSeek (etc.) visible when another layer still has it.
 */
function sharedGlobalConfigFiles() {
  const files = [
    path.join(Global.Path.config, "config.json"),
    path.join(Global.Path.config, "opencode.json"),
    path.join(Global.Path.config, "opencode.jsonc"),
    path.join(Global.Path.home, ".opencode", "opencode.json"),
    path.join(Global.Path.home, ".opencode", "opencode.jsonc"),
  ]
  const extraConfigDir = OneCodeExtraPath.configDir()
  if (extraConfigDir) {
    files.push(
      path.join(extraConfigDir, "config.json"),
      path.join(extraConfigDir, "opencode.json"),
      path.join(extraConfigDir, "opencode.jsonc"),
    )
  }
  return files
}

const platformConfigDir = path.join(Global.Path.data, "platform-config")

function sanitizeAccountId(accountId: string) {
  return accountId.replace(/[^a-zA-Z0-9._-]+/g, "_")
}

/** Platform sessions store per-account config overlays (custom providers, model prefs). */
export function platformAccountConfigFile(accountId: string) {
  return path.join(platformConfigDir, `${sanitizeAccountId(accountId)}.json`)
}

function isTenantCustomProvider(id: string, value: unknown) {
  if (id === "onescience") return false
  if (!isRecord(value)) return false
  // UI custom relays always use the openai-compatible SDK.
  if (value.npm === "@ai-sdk/openai-compatible") return true
  // Legacy / hand-edited relays: inline models + baseURL, not a models.dev builtin override alone.
  if (!isRecord(value.models) || Object.keys(value.models).length === 0) return false
  return isRecord(value.options) && typeof value.options.baseURL === "string" && value.options.baseURL.length > 0
}

/** Written by the control plane on SSH connect; leaf serve loads this path. */
export const SSH_LEAF_PLATFORM_CONFIG_OVERLAY = "platform-config-overlay.jsonc"

export function sshLeafPlatformConfigOverlayFile(directory: string) {
  return path.join(directory, ".opencode", SSH_LEAF_PLATFORM_CONFIG_OVERLAY)
}

/** Extract only tenant-owned custom providers from a config object. */
export function tenantCustomProviders(config: Info): Info["provider"] | undefined {
  if (!config.provider) return undefined
  const provider: NonNullable<Info["provider"]> = {}
  for (const [id, value] of Object.entries(config.provider)) {
    if (PublicProviders.has(id)) continue
    if (!isTenantCustomProvider(id, value)) continue
    provider[id] = value
  }
  return Object.keys(provider).length > 0 ? provider : undefined
}

/** Drop shared/project custom providers that belong to other accounts. */
function stripForeignCustomProviders(config: Info, keepIds: Set<string>): Info {
  if (!config.provider) return config
  let changed = false
  const provider: NonNullable<Info["provider"]> = { ...config.provider }
  for (const [id, value] of Object.entries(provider)) {
    if (!isTenantCustomProvider(id, value)) continue
    if (keepIds.has(id)) continue
    if (PublicProviders.has(id)) continue
    delete provider[id]
    changed = true
  }
  return changed ? { ...config, provider } : config
}

/** Shared-file ssh/mcp must not leak across platform accounts. */
function stripSharedSshMcp(config: Info): Info {
  if (config.ssh === undefined && config.mcp === undefined) return config
  const next = { ...config }
  delete next.ssh
  delete next.mcp
  return next
}

/** True when a config.patch only touches tenant-private ssh/mcp maps (no provider/shell churn). */
export function isTenantMapsOnlyPatch(patch: Info): boolean {
  const keys = Object.keys(patch).filter((key) => (patch as Record<string, unknown>)[key] !== undefined)
  return keys.length > 0 && keys.every((key) => key === "ssh" || key === "mcp")
}

/**
 * When platform-config lost ssh but managed OpenSSH blocks remain (common after
 * isolation-mode restarts / dual-write races / account-switch reloads), restore
 * missing product entries from disk.
 */
function healAccountConfigSsh(accountId: string, accountConfig: Info) {
  return Effect.gen(function* () {
    const disk = yield* Effect.promise(() =>
      readManagedOpenSshTargets(accountId).catch((error) => {
        log.warn("failed to read managed OpenSSH targets for ssh heal", {
          accountId,
          error: String(error),
        })
        return {} as Record<string, never>
      }),
    )
    const { ssh, healedKeys } = mergeSshFromOpenSsh(
      accountConfig.ssh as ProductSshMap | undefined,
      disk,
    )
    if (healedKeys.length === 0 || !ssh) return accountConfig

    const next: Info = { ...accountConfig, ssh: ssh as Info["ssh"] }
    const file = platformAccountConfigFile(accountId)
    yield* Effect.promise(() => fsNode.mkdir(path.dirname(file), { recursive: true }).catch(() => undefined))
    const before = yield* Effect.promise(() =>
      fsNode.readFile(file, "utf8").catch((err) => {
        if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") return "{}"
        throw err
      }),
    )
    let existing: Info = {}
    try {
      existing = before.trim()
        ? ConfigParse.schema(Info, normalizeLoadedConfig(ConfigParse.jsonc(before, file), file), file)
        : ({} as Info)
    } catch (error) {
      // Corrupt overlay must not block heal — rewrite ssh from OpenSSH and keep provider map if present.
      log.warn("platform-config parse failed during ssh heal; rewriting ssh from OpenSSH", {
        accountId,
        error: String(error),
      })
      try {
        const raw = before.trim() ? ConfigParse.jsonc(before, file) : {}
        if (isRecord(raw) && isRecord(raw.provider)) {
          existing = { provider: raw.provider } as Info
        }
      } catch {
        existing = {} as Info
      }
    }
    const persisted: Info = { ...existing, ssh: ssh as Info["ssh"] }
    const serialized = JSON.stringify(writable(persisted), null, 2)
    if (serialized !== before) {
      // Persist is best-effort; still return healed config for this request.
      yield* Effect.promise(async () => {
        try {
          await fsNode.writeFile(file, serialized, "utf8")
          log.info("healed platform-config ssh from managed OpenSSH blocks", {
            accountId,
            healedKeys,
          })
        } catch (error) {
          log.warn("failed to persist healed platform-config ssh", {
            accountId,
            error: String(error),
          })
        }
      })
    }
    return next
  })
}

function providerHasConfigApiKey(value: unknown) {
  if (!isRecord(value) || !isRecord(value.options)) return false
  const key = value.options.apiKey
  return typeof key === "string" && key.trim().length > 0
}

/**
 * Official catalog providers (deepseek, anthropic, …) must not become "connected"
 * from a bare shared config stub. Custom relays and config entries that embed an
 * apiKey (pre-user-management legacy) still connect from config alone.
 */
export function shouldConnectFromConfigAlone(id: string, value: unknown) {
  if (isTenantCustomProvider(id, value)) return true
  return providerHasConfigApiKey(value)
}

/** Project config file that Config.update should write — must be one ConfigPaths loads. */
function projectConfigFile(directory: string) {
  const candidates = ["opencode.jsonc", "opencode.json"].map((file) => path.join(directory, file))
  for (const file of candidates) {
    if (existsSync(file)) return file
  }
  return path.join(directory, "opencode.json")
}

function patchJsonc(input: string, patch: unknown, path: string[] = []): string {
  if (!isRecord(patch)) {
    const edits = modify(input, path, patch, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
      },
    })
    return applyEdits(input, edits)
  }

  return Object.entries(patch).reduce((result, [key, value]) => {
    // Clients send ssh/mcp as a full map; deep-merging keys cannot delete entries.
    if (path.length === 0 && REPLACE_MAP_KEYS.has(key)) {
      const edits = modify(result, [key], value, {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
        },
      })
      return applyEdits(result, edits)
    }
    // Same for openai-compatible custom providers: replace the whole provider object
    // so deleted models/headers do not linger in opencode.jsonc.
    if (
      path.length === 1 &&
      path[0] === "provider" &&
      isRecord(value) &&
      value.npm === "@ai-sdk/openai-compatible" &&
      "models" in value
    ) {
      const edits = modify(result, [...path, key], value, {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
        },
      })
      return applyEdits(result, edits)
    }
    return patchJsonc(result, value, [...path, key])
  }, input)
}

function writable(info: Info) {
  const {
    plugin_origins: _plugin_origins,
    deleted_providers: _deletedProviders,
    public_providers: _publicProviders,
    ...next
  } = info
  return next
}

function redactPublicApiKeys(config: Info): Info {
  const ids = PublicProviders.ids()
  if (!config.provider || ids.size === 0) return config
  let changed = false
  const provider: NonNullable<Info["provider"]> = { ...config.provider }
  for (const id of ids) {
    const entry = provider[id]
    if (!entry?.options || typeof entry.options.apiKey !== "string" || !entry.options.apiKey) continue
    const { apiKey: _apiKey, ...options } = entry.options
    provider[id] = { ...entry, options }
    changed = true
  }
  return changed ? { ...config, provider } : config
}

function overlayPublicProviders(config: Info): Info {
  const raw = PublicProviders.providers()
  const ids = Object.keys(raw)
  if (ids.length === 0) return { ...config, public_providers: [] }
  const provider: NonNullable<Info["provider"]> = { ...(config.provider ?? {}) }
  for (const id of ids) {
    provider[id] = raw[id]
  }
  return redactPublicApiKeys({ ...config, provider, public_providers: ids })
}

function omitPublicProviderMutations(patch: Info): Info {
  const ids = PublicProviders.ids()
  const next: Info = { ...patch }
  delete next.public_providers
  if (ids.size === 0) return next
  if (next.deleted_providers?.length) {
    next.deleted_providers = next.deleted_providers.filter((id) => !ids.has(id))
    if (next.deleted_providers.length === 0) delete next.deleted_providers
  }
  if (next.disabled_providers?.length) {
    next.disabled_providers = next.disabled_providers.filter((id) => !ids.has(id))
  }
  if (next.provider) {
    const provider = { ...next.provider }
    let changed = false
    for (const id of ids) {
      if (id in provider) {
        delete provider[id]
        changed = true
      }
    }
    if (changed) next.provider = provider
  }
  return next
}

function writableGlobal(info: Info) {
  const next = writable(info)
  // When a user changes config from a value back to default in the Desktop app, we don't want to leave a blank `"shell": "",` key
  if ("shell" in next && next.shell === "") return { ...next, shell: undefined }
  return next
}

/**
 * writable*() strips deleted_providers so it is never persisted.
 * Reattach it for applyConfigPatch, which uses it as a hard-delete instruction.
 */
function withDeletedProviders(info: Info, options?: { omitEmptyShell?: boolean }): Info {
  const deleted = info.deleted_providers ?? []
  // Project updates must keep shell:"" as a sentinel; only global updates omit it.
  const patch = options?.omitEmptyShell === false ? writable(info) : writableGlobal(info)
  if (deleted.length === 0) return patch
  return { ...patch, deleted_providers: deleted }
}

export const ConfigDirectoryTypoError = NamedError.create("ConfigDirectoryTypoError", {
  path: Schema.String,
  dir: Schema.String,
  suggestion: Schema.String,
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const authSvc = yield* Auth.Service
    const accountSvc = yield* Account.Service
    PublicProviders.loadOnce()
    const env = yield* Env.Service
    const npmSvc = yield* Npm.Service

    const readConfigFile = (filepath: string) => fs.readFileStringSafe(filepath).pipe(Effect.orDie)

    const loadConfig = Effect.fnUntraced(function* (
      text: string,
      options: { path: string } | { dir: string; source: string },
    ) {
      const source = "path" in options ? options.path : options.source
      const expanded = yield* Effect.promise(() =>
        ConfigVariable.substitute(
          "path" in options ? { text, type: "path", path: options.path } : { text, type: "virtual", ...options },
        ),
      )
      const parsed = ConfigParse.jsonc(expanded, source)
      const normalized = normalizeLoadedConfig(parsed, source)
      // Legacy opencode.json may embed onescience; coerce partial runtime the same way
      // as standalone onescience.json so missing backend_id cannot brick bootstrap.
      if (isRecord(normalized) && "onescience" in normalized) {
        normalized.onescience = normalizeLoadedOneScienceConfig(normalized.onescience)
      }
      const data = ConfigParse.schema(Info, normalized, source)
      if (!("path" in options)) return data

      yield* Effect.promise(() => resolveLoadedPlugins(data, options.path))
      if (!data.$schema) {
        data.$schema = "https://opencode.ai/config.json"
        const updated = text.replace(/^\s*\{/, '{\n  "$schema": "https://opencode.ai/config.json",')
        yield* fs.writeFileString(options.path, updated).pipe(Effect.catch(() => Effect.void))
      }
      return data
    })

    const loadFile = Effect.fnUntraced(function* (filepath: string) {
      log.info("loading", { path: filepath })
      const text = yield* readConfigFile(filepath)
      if (!text) return {} as Info
      return yield* loadConfig(text, { path: filepath })
    })

    const loadOneScienceFile = Effect.fnUntraced(function* (filepath: string) {
      log.info("loading", { path: filepath })
      const text = yield* readConfigFile(filepath)
      if (!text) return {} as Info
      const expanded = yield* Effect.promise(() =>
        ConfigVariable.substitute({ text, type: "path", path: filepath }),
      )
      try {
        return {
          onescience: ConfigParse.schema(
            ConfigOneScience.Info,
            normalizeLoadedOneScienceConfig(ConfigParse.jsonc(expanded, filepath)),
            filepath,
          ),
        }
      } catch (error) {
        // Incomplete agent/UI writes must not brick /code bootstrap.
        if (NamedError.hasName(error, "ConfigInvalidError") || NamedError.hasName(error, "ConfigJsonError")) {
          log.warn("ignoring invalid onescience.json", {
            path: filepath,
            error: error instanceof Error ? error.message : String(error),
          })
          return {} as Info
        }
        throw error
      }
    })

    const loadGlobal = Effect.fnUntraced(function* () {
      let result: Info = {}
      // Seed the default global config with the schema for editor completion, but avoid writing when the user
      // explicitly routes config through env-provided paths or content.
      if (!Flag.OPENCODE_CONFIG && !Flag.OPENCODE_CONFIG_DIR && !Flag.OPENCODE_CONFIG_CONTENT) {
        const file = globalConfigFile()
        if (!existsSync(file)) {
          yield* fs
            .writeWithDirs(file, JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2))
            .pipe(Effect.catch(() => Effect.void))
        }
      }
      result = mergeConfig(result, yield* loadFile(path.join(Global.Path.config, "config.json")))
      result = mergeConfig(result, yield* loadFile(path.join(Global.Path.config, "opencode.json")))
      result = mergeConfig(result, yield* loadFile(path.join(Global.Path.config, "opencode.jsonc")))

      const homeOpencode = path.join(Global.Path.home, ".opencode")
      result = mergeConfigConcatArrays(result, yield* loadFile(path.join(homeOpencode, "opencode.json")))
      result = mergeConfigConcatArrays(result, yield* loadFile(path.join(homeOpencode, "opencode.jsonc")))

      const extraConfigDir = OneCodeExtraPath.configDir()
      if (extraConfigDir) {
        result = mergeConfig(result, yield* loadFile(path.join(extraConfigDir, "config.json")))
        result = mergeConfig(result, yield* loadFile(path.join(extraConfigDir, "opencode.json")))
        result = mergeConfig(result, yield* loadFile(path.join(extraConfigDir, "opencode.jsonc")))
      }

      const legacy = path.join(Global.Path.config, "config")
      if (existsSync(legacy)) {
        yield* Effect.promise(() =>
          import(pathToFileURL(legacy).href, { with: { type: "toml" } })
            .then(async (mod) => {
              const { provider, model, ...rest } = mod.default
              if (provider && model) result.model = `${provider}/${model}`
              result["$schema"] = "https://opencode.ai/config.json"
              result = mergeConfig(result, rest)
              await fsNode.writeFile(path.join(Global.Path.config, "config.json"), JSON.stringify(result, null, 2))
              await fsNode.unlink(legacy)
            })
            .catch(() => {}),
        )
      }

      return result
    })

    const [cachedGlobal, invalidateGlobal] = yield* Effect.cachedInvalidateWithTTL(
      loadGlobal().pipe(
        Effect.tapError((error) =>
          Effect.sync(() => log.error("failed to load global config, using defaults", { error: String(error) })),
        ),
        Effect.orElseSucceed((): Info => ({})),
      ),
      Duration.infinity,
    )

    const getGlobal = Effect.fn("Config.getGlobal")(function* () {
      let result = yield* cachedGlobal
      const current = Option.getOrUndefined(yield* Effect.serviceOption(PlatformAuth.CurrentSession))
      const accountId = current?.session?.account.id
      // Multi-tenant web: never expose shared-file custom providers / ssh / mcp without an account overlay.
      if (PlatformAuth.authRequired() && !accountId) {
        return overlayPublicProviders(stripSharedSshMcp(stripForeignCustomProviders(result, new Set())))
      }
      if (!accountId) return overlayPublicProviders(result)

      const accountFile = platformAccountConfigFile(accountId)
      let accountConfig = yield* loadFile(accountFile).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            log.warn("failed to load platform-config; continuing with empty overlay for ssh heal", {
              accountId,
              error: String(error),
            })
            return {} as Info
          }),
        ),
      )
      accountConfig = yield* healAccountConfigSsh(accountId, accountConfig).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            log.warn("ssh heal failed during getGlobal", { accountId, error: String(error) })
            return accountConfig
          }),
        ),
      )
      const keepIds = new Set(Object.keys(accountConfig.provider ?? {}))
      // Shared opencode.json previously stored every user's custom providers — hide them
      // unless this account owns them via platform-config/{accountId}.json.
      result = stripForeignCustomProviders(result, keepIds)
      // Logged-in platform accounts always use private ssh/mcp overlays (even if authRequired is off).
      result = stripSharedSshMcp(result)
      if (Object.keys(accountConfig).length > 0) {
        result = mergeConfig(result, accountConfig)
      }
      // Final OpenSSH overlay — Integration list must match terminal `~/.ssh/config` after re-login
      // even when platform-config heal/persist races leave product ssh empty.
      const disk = yield* Effect.promise(() =>
        readManagedOpenSshTargets(accountId).catch(() => ({}) as Record<string, never>),
      )
      if (Object.keys(disk).length > 0) {
        const overlaid = mergeSshFromOpenSsh(result.ssh as ProductSshMap | undefined, disk)
        if (overlaid.ssh) result = { ...result, ssh: overlaid.ssh as Info["ssh"] }
      }
      // Re-strip after merge so account overlays cannot reintroduce foreign customs via deep-merge quirks.
      return overlayPublicProviders(stripForeignCustomProviders(result, keepIds))
    })

    const ensureGitignore = Effect.fn("Config.ensureGitignore")(function* (dir: string) {
      const gitignore = path.join(dir, ".gitignore")
      const hasIgnore = yield* fs.existsSafe(gitignore)
      if (!hasIgnore) {
        yield* fs
          .writeFileString(
            gitignore,
            ["node_modules", "package.json", "package-lock.json", "bun.lock", ".gitignore"].join("\n"),
          )
          .pipe(
            Effect.catchIf(
              (e) => e.reason._tag === "PermissionDenied",
              () => Effect.void,
            ),
          )
      }
    })

    const loadInstanceState = Effect.fn("Config.loadInstanceState")(
      function* (ctx: InstanceContext) {
        const auth = yield* authSvc.all().pipe(Effect.orDie)

        let result: Info = {}
        const consoleManagedProviders = new Set<string>()
        let activeOrgName: string | undefined

        const pluginScopeForSource = Effect.fnUntraced(function* (source: string) {
          if (source.startsWith("http://") || source.startsWith("https://")) return "global"
          if (source === "OPENCODE_CONFIG_CONTENT") return "local"
          if (containsPath(source, ctx)) return "local"
          return "global"
        })

        const mergePluginOrigins = Effect.fnUntraced(function* (
          source: string,
          // mergePluginOrigins receives raw Specs from one config source, before provenance for this merge step
          // is attached.
          list: ConfigPlugin.Spec[] | undefined,
          // Scope can be inferred from the source path, but some callers already know whether the config should
          // behave as global or local and can pass that explicitly.
          kind?: ConfigPlugin.Scope,
        ) {
          if (!list?.length) return
          const hit = kind ?? (yield* pluginScopeForSource(source))
          // Merge newly seen plugin origins with previously collected ones, then dedupe by plugin identity while
          // keeping the winning source/scope metadata for downstream installs, writes, and diagnostics.
          const plugins = ConfigPlugin.deduplicatePluginOrigins([
            ...(result.plugin_origins ?? []),
            ...list.map((spec) => ({ spec, source, scope: hit })),
          ])
          result.plugin = plugins.map((item) => item.spec)
          result.plugin_origins = plugins
        })

        const merge = (source: string, next: Info, kind?: ConfigPlugin.Scope) => {
          result = mergeConfigConcatArrays(result, next)
          return mergePluginOrigins(source, next.plugin, kind)
        }

        for (const [key, value] of Object.entries(auth)) {
          if (value.type === "wellknown") {
            const url = key.replace(/\/+$/, "")
            process.env[value.key] = value.token
            log.debug("fetching remote config", { url: `${url}/.well-known/opencode` })
            const response = yield* Effect.promise(() => fetch(`${url}/.well-known/opencode`))
            if (!response.ok) {
              throw new Error(`failed to fetch remote config from ${url}: ${response.status}`)
            }
            const wellknown = (yield* Effect.promise(() => response.json())) as {
              config?: Record<string, unknown>
              remote_config?: unknown
            }
            const remote = yield* Effect.promise(() =>
              substituteWellKnownRemoteConfig({
                value: wellknown.remote_config,
                dir: url,
                source: `${url}/.well-known/opencode`,
              }),
            )
            const fetchedConfig = remote
              ? ((yield* Effect.promise(async () => {
                  log.debug("fetching remote config", { url: remote.url })
                  const response = await fetch(remote.url, { headers: remote.headers })
                  if (!response.ok)
                    throw new Error(`failed to fetch remote config from ${remote.url}: ${response.status}`)
                  const data = await response.json()
                  return isRecord(data) && isRecord(data.config) ? data.config : data
                })) as Record<string, unknown>)
              : {}
            const remoteConfig = mergeConfig(wellknown.config ?? {}, fetchedConfig as Info)
            if (!remoteConfig.$schema) remoteConfig.$schema = "https://opencode.ai/config.json"
            const source = `${url}/.well-known/opencode`
            const next = yield* loadConfig(JSON.stringify(remoteConfig), {
              dir: path.dirname(source),
              source,
            })
            yield* merge(source, next, "global")
            log.debug("loaded remote config from well-known", { url })
          }
        }

        const global = yield* getGlobal()
        yield* merge(Global.Path.config, global, "global")

        if (Flag.OPENCODE_CONFIG) {
          yield* merge(Flag.OPENCODE_CONFIG, yield* loadFile(Flag.OPENCODE_CONFIG))
          log.debug("loaded custom config", { path: Flag.OPENCODE_CONFIG })
        }

        const sshLeaf = Boolean(Flag.OPENCODE_WORKSPACE_ID?.trim())
        if (sshLeaf) {
          const overlayPath = sshLeafPlatformConfigOverlayFile(ctx.directory)
          if (overlayPath !== Flag.OPENCODE_CONFIG && existsSync(overlayPath)) {
            yield* merge(overlayPath, yield* loadFile(overlayPath))
            log.debug("loaded ssh leaf platform config overlay", { path: overlayPath })
          }
        }

        if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
          for (const file of yield* ConfigPaths.files("opencode", ctx.directory, ctx.worktree).pipe(Effect.orDie)) {
            yield* merge(file, yield* loadFile(file), "local")
          }
          const oneScienceFile = path.join(ctx.directory, "onescience.json")
          yield* merge(oneScienceFile, yield* loadOneScienceFile(oneScienceFile), "local")
        }

        result.agent = result.agent || {}
        result.mode = result.mode || {}
        result.plugin = result.plugin || []

        const directories = yield* ConfigPaths.directories(ctx.directory, ctx.worktree)

        if (Flag.OPENCODE_CONFIG_DIR) {
          log.debug("loading config from OPENCODE_CONFIG_DIR", { path: Flag.OPENCODE_CONFIG_DIR })
        }

        const deps: Fiber.Fiber<void, never>[] = []
        const extraConfigDir = OneCodeExtraPath.configDirIfExists()

        for (const dir of directories) {
          if (!existsSync(dir)) continue

          if (dir.endsWith(".opencode") || dir === Flag.OPENCODE_CONFIG_DIR || dir === extraConfigDir) {
            for (const file of ["opencode.json", "opencode.jsonc"]) {
              const source = path.join(dir, file)
              log.debug(`loading config from ${source}`)
              yield* merge(source, yield* loadFile(source))
              result.agent ??= {}
              result.mode ??= {}
              result.plugin ??= []
            }
          }

          yield* ensureGitignore(dir).pipe(Effect.orDie)

          const dep = yield* npmSvc
            .install(dir, {
              add: [
                {
                  name: "@opencode-ai/plugin",
                  version: InstallationLocal ? undefined : InstallationVersion,
                },
              ],
            })
            .pipe(
              Effect.exit,
              Effect.tap((exit) =>
                Exit.isFailure(exit)
                  ? Effect.sync(() => {
                      log.warn("background dependency install failed", { dir, error: String(exit.cause) })
                    })
                  : Effect.void,
              ),
              Effect.asVoid,
              Effect.forkDetach,
            )
          deps.push(dep)

          result.command = mergeDeep(result.command ?? {}, yield* Effect.promise(() => ConfigCommand.load(dir)))
          result.agent = mergeDeep(result.agent ?? {}, yield* Effect.promise(() => ConfigAgent.load(dir)))
          result.agent = mergeDeep(result.agent ?? {}, yield* Effect.promise(() => ConfigAgent.loadMode(dir)))
          // Auto-discovered plugins under `.opencode/plugin(s)` are already local files, so ConfigPlugin.load
          // returns normalized Specs and we only need to attach origin metadata here.
          const list = yield* Effect.promise(() => ConfigPlugin.load(dir))
          yield* mergePluginOrigins(dir, list)
        }

        if (process.env.OPENCODE_CONFIG_CONTENT) {
          const source = "OPENCODE_CONFIG_CONTENT"
          const next = yield* loadConfig(process.env.OPENCODE_CONFIG_CONTENT, {
            dir: ctx.directory,
            source,
          })
          yield* merge(source, next, "local")
          log.debug("loaded custom config from OPENCODE_CONFIG_CONTENT")
        }

        const activeAccount = Option.getOrUndefined(
          yield* accountSvc.active().pipe(Effect.catch(() => Effect.succeed(Option.none()))),
        )
        if (activeAccount?.active_org_id) {
          const accountID = activeAccount.id
          const orgID = activeAccount.active_org_id
          const url = activeAccount.url
          yield* Effect.gen(function* () {
            const [configOpt, tokenOpt] = yield* Effect.all(
              [accountSvc.config(accountID, orgID), accountSvc.token(accountID)],
              { concurrency: 2 },
            )
            if (Option.isSome(tokenOpt)) {
              process.env["OPENCODE_CONSOLE_TOKEN"] = tokenOpt.value
              yield* env.set("OPENCODE_CONSOLE_TOKEN", tokenOpt.value)
            }

            if (Option.isSome(configOpt)) {
              const source = `${url}/api/config`
              const next = yield* loadConfig(JSON.stringify(configOpt.value), {
                dir: path.dirname(source),
                source,
              })
              for (const providerID of Object.keys(next.provider ?? {})) {
                consoleManagedProviders.add(providerID)
              }
              yield* merge(source, next, "global")
            }
          }).pipe(
            Effect.withSpan("Config.loadActiveOrgConfig"),
            Effect.catch((err) => {
              log.debug("failed to fetch remote account config", {
                error: err instanceof Error ? err.message : String(err),
              })
              return Effect.void
            }),
          )
        }

        const managedDir = ConfigManaged.managedConfigDir()
        if (existsSync(managedDir)) {
          for (const file of ["opencode.json", "opencode.jsonc"]) {
            const source = path.join(managedDir, file)
            yield* merge(source, yield* loadFile(source), "global")
          }
        }

        // macOS managed preferences (.mobileconfig deployed via MDM) override everything
        const managed = yield* Effect.promise(() => ConfigManaged.readManagedPreferences())
        if (managed) {
          result = mergeConfigConcatArrays(
            result,
            yield* loadConfig(managed.text, {
              dir: path.dirname(managed.source),
              source: managed.source,
            }),
          )
        }

        for (const [name, mode] of Object.entries(result.mode ?? {})) {
          result.agent = mergeDeep(result.agent ?? {}, {
            [name]: {
              ...mode,
              mode: "primary" as const,
            },
          })
        }

        if (Flag.OPENCODE_PERMISSION) {
          result.permission = mergeDeep(result.permission ?? {}, JSON.parse(Flag.OPENCODE_PERMISSION))
        }

        if (result.tools) {
          const perms: Record<string, ConfigPermission.Action> = {}
          for (const [tool, enabled] of Object.entries(result.tools)) {
            const action: ConfigPermission.Action = enabled ? "allow" : "deny"
            if (tool === "write" || tool === "edit" || tool === "patch") {
              perms.edit = action
              continue
            }
            perms[tool] = action
          }
          result.permission = mergeDeep(perms, result.permission ?? {})
        }

        if (!result.username) result.username = os.userInfo().username

        if (result.autoshare === true && !result.share) {
          result.share = "auto"
        }

        if (Flag.OPENCODE_DISABLE_AUTOCOMPACT) {
          result.compaction = { ...result.compaction, auto: false }
        }
        if (Flag.OPENCODE_DISABLE_PRUNE) {
          result.compaction = { ...result.compaction, prune: false }
        }

        // SSH leaf serves are single-tenant: custom providers arrive via the synced
        // platform-config-overlay.jsonc written at connect. Do not strip them — the
        // control plane already scoped the overlay to the connecting account.
        if (!sshLeaf) {
          // Project-level opencode.json can reintroduce another tenant's custom relays after getGlobal.
          // Re-apply ownership filter so platform sessions only see account-owned customs.
          const platformSession = Option.getOrUndefined(yield* Effect.serviceOption(PlatformAuth.CurrentSession))
          const platformAccountId = platformSession?.session?.account.id
          if (platformAccountId) {
            let accountOwned = yield* loadFile(platformAccountConfigFile(platformAccountId)).pipe(
              Effect.catch((error) =>
                Effect.sync(() => {
                  log.warn("failed to load platform-config during instance config; continuing for ssh heal", {
                    accountId: platformAccountId,
                    error: String(error),
                  })
                  return {} as Info
                }),
              ),
            )
            accountOwned = yield* healAccountConfigSsh(platformAccountId, accountOwned).pipe(
              Effect.catch((error) =>
                Effect.sync(() => {
                  log.warn("ssh heal failed during instance config", {
                    accountId: platformAccountId,
                    error: String(error),
                  })
                  return accountOwned
                }),
              ),
            )
            result = stripForeignCustomProviders(result, new Set(Object.keys(accountOwned.provider ?? {})))
            // Keep instance ssh/mcp equal to the account overlay (already applied via getGlobal path).
            // Project files must not reintroduce shared-tenant maps.
            result = {
              ...result,
              ssh: accountOwned.ssh,
              mcp: accountOwned.mcp,
            }
            // Same OpenSSH overlay as getGlobal — logout/login must not leave instance config.ssh empty
            // when managed blocks still exist under platform-ssh/{accountId}.
            const disk = yield* Effect.promise(() =>
              readManagedOpenSshTargets(platformAccountId).catch(() => ({}) as Record<string, never>),
            )
            if (Object.keys(disk).length > 0) {
              const overlaid = mergeSshFromOpenSsh(result.ssh as ProductSshMap | undefined, disk)
              if (overlaid.ssh) result = { ...result, ssh: overlaid.ssh as Info["ssh"] }
            }
          } else if (PlatformAuth.authRequired()) {
            result = stripSharedSshMcp(stripForeignCustomProviders(result, new Set()))
          }
        }

        return {
          config: overlayPublicProviders(result),
          directories,
          deps,
          consoleState: {
            consoleManagedProviders: Array.from(consoleManagedProviders),
            activeOrgName,
            switchableOrgCount: 0,
          },
        }
      },
      Effect.provideService(AppFileSystem.Service, fs),
    )

    const state = yield* InstanceState.make<State>(
      Effect.fn("Config.state")(function* (ctx) {
        return yield* loadInstanceState(ctx).pipe(Effect.orDie)
      }),
    )

    const get = Effect.fn("Config.get")(function* () {
      const config = yield* InstanceState.use(state, (s) => s.config)
      return overlayPublicProviders(config)
    })

    const directories = Effect.fn("Config.directories")(function* () {
      return yield* InstanceState.use(state, (s) => s.directories)
    })

    const getConsoleState = Effect.fn("Config.getConsoleState")(function* () {
      return yield* InstanceState.use(state, (s) => s.consoleState)
    })

    const waitForDependencies = Effect.fn("Config.waitForDependencies")(function* () {
      yield* InstanceState.useEffect(state, (s) =>
        Effect.forEach(s.deps, Fiber.join, { concurrency: "unbounded" }).pipe(Effect.asVoid),
      )
    })

    const update = Effect.fn("Config.update")(function* (config: Info) {
      const dir = yield* InstanceState.directory
      const file = projectConfigFile(dir)
      const existing = yield* loadFile(file)
      if (config.onescience) {
        const onescience = normalizeLoadedOneScienceConfig(config.onescience)
        yield* fs
          .writeFileString(path.join(dir, "onescience.json"), JSON.stringify(onescience, null, 2))
          .pipe(Effect.orDie)
      }
      const { onescience: _onescience, ...next } = config
      const { onescience: _existingOneScience, ...existingConfig } = writable(existing)
      if (Object.keys(next).length === 0 && Object.keys(existingConfig).length === 0) return
      // Keep deleted_providers as a patch instruction — writable() strips it for persistence.
      // Preserve empty shell sentinel for project configs (global updates still omit it).
      yield* fs
        .writeFileString(
          file,
          JSON.stringify(applyConfigPatch(existingConfig, withDeletedProviders(next, { omitEmptyShell: false })), null, 2),
        )
        .pipe(Effect.orDie)
    })

    const invalidate = Effect.fn("Config.invalidate")(function* () {
      yield* invalidateGlobal
      yield* InstanceState.invalidate(state)
    })

    const hardDeleteProvidersFromSharedFiles = Effect.fnUntraced(function* (providerIDs: string[]) {
      providerIDs = providerIDs.filter((id) => !PublicProviders.has(id))
      if (providerIDs.length === 0) return false
      let anyChanged = false
      for (const sharedFile of sharedGlobalConfigFiles()) {
        const sharedBefore = (yield* readConfigFile(sharedFile)) ?? ""
        if (!sharedBefore.trim()) continue
        const sharedExisting = ConfigParse.schema(Info, ConfigParse.jsonc(sharedBefore, sharedFile), sharedFile)
        if (!sharedExisting.provider) continue
        const hasAny = providerIDs.some((id) => Boolean(sharedExisting.provider?.[id]))
        if (!hasAny) continue
        const cleaned = applyConfigPatch(writable(sharedExisting), {
          deleted_providers: providerIDs,
        } as Info)
        // Also strip leaked custom relays while rewriting shared files.
        const stripped = stripForeignCustomProviders(cleaned, new Set())
        const sharedSerialized = JSON.stringify(writable(stripped), null, 2)
        if (sharedSerialized === sharedBefore) continue
        yield* fs.writeFileString(sharedFile, sharedSerialized).pipe(Effect.orDie)
        anyChanged = true
      }
      return anyChanged
    })

    const updateGlobal = Effect.fn("Config.updateGlobal")(function* (config: Info) {
      config = omitPublicProviderMutations(config)
      // writableGlobal strips deleted_providers (not persisted); reattach for applyConfigPatch hard-delete.
      const patch = withDeletedProviders(config)
      const deletedIDs = config.deleted_providers ?? []
      const current = Option.getOrUndefined(yield* Effect.serviceOption(PlatformAuth.CurrentSession))
      const accountId = current?.session?.account.id

      // Platform accounts write overlays to a per-account file so custom providers
      // (and model prefs) do not leak across tenants via the shared global config.
      if (accountId) {
        const file = platformAccountConfigFile(accountId)
        yield* fs.ensureDir(path.dirname(file)).pipe(Effect.orDie)
        const before = (yield* readConfigFile(file)) ?? "{}"
        const existing = before.trim()
          ? ConfigParse.schema(Info, ConfigParse.jsonc(before, file), file)
          : ({} as Info)
        const merged = applyConfigPatch(writable(existing), patch)
        const serialized = JSON.stringify(merged, null, 2)
        const overlayChanged = serialized !== before
        if (overlayChanged) yield* fs.writeFileString(file, serialized).pipe(Effect.orDie)

        // Keep OpenSSH managed blocks in lockstep with product ssh so native↔isolation terminals
        // and Integration UI never diverge after an account overlay write.
        if (Object.prototype.hasOwnProperty.call(patch, "ssh")) {
          yield* Effect.promise(() =>
            syncOpenSshFromProductSsh(
              accountId,
              merged.ssh as ProductSshMap | undefined,
              existing.ssh as ProductSshMap | undefined,
            ),
          )
        }

        // Legacy pre-user-management providers (e.g. deepseek) live in shared opencode.json.
        // Overlay deleted_providers cannot remove them — hard-delete across every loadGlobal layer
        // so one user's disconnect is permanent for all accounts ("一删永删").
        let sharedChanged = false
        if (deletedIDs.length > 0) {
          sharedChanged = yield* hardDeleteProvidersFromSharedFiles(deletedIDs)
        } else {
          // One-time cleanup: strip tenant custom providers that previously leaked into the shared file.
          const sharedFile = globalConfigFile()
          const sharedBefore = (yield* readConfigFile(sharedFile)) ?? "{}"
          if (sharedBefore.trim()) {
            const sharedExisting = ConfigParse.schema(Info, ConfigParse.jsonc(sharedBefore, sharedFile), sharedFile)
            const cleaned = stripForeignCustomProviders(sharedExisting, new Set())
            if (cleaned !== sharedExisting) {
              const sharedSerialized = JSON.stringify(writable(cleaned), null, 2)
              if (sharedSerialized !== sharedBefore) {
                yield* fs.writeFileString(sharedFile, sharedSerialized).pipe(Effect.orDie)
                sharedChanged = true
              }
            }
          }
        }

        const changed = overlayChanged || sharedChanged
        if (sharedChanged) yield* invalidateGlobal
        if (changed) yield* invalidate()
        return { info: yield* getGlobal(), changed }
      }

      const file = globalConfigFile()
      const before = (yield* readConfigFile(file)) ?? "{}"

      let next: Info
      let changed: boolean
      if (!file.endsWith(".jsonc") || deletedIDs.length > 0) {
        // JSON files, or any hard-delete: applyConfigPatch can remove provider map keys;
        // patchJsonc cannot delete keys, so rewrite the serialized object when deleting.
        const existing = ConfigParse.schema(Info, ConfigParse.jsonc(before, file), file)
        const merged = applyConfigPatch(writable(existing), patch)
        const serialized = JSON.stringify(merged, null, 2)
        changed = serialized !== before
        if (changed) yield* fs.writeFileString(file, serialized).pipe(Effect.orDie)
        next = merged
      } else {
        const updated = patchJsonc(before, patch)
        next = ConfigParse.schema(Info, ConfigParse.jsonc(updated, file), file)
        changed = updated !== before
        if (changed) yield* fs.writeFileString(file, updated).pipe(Effect.orDie)
      }

      // Also purge other shared layers so a delete in the write-target file is not
      // reintroduced by ~/.config/opencode or ONECODE_EXTRA_PATH siblings.
      if (deletedIDs.length > 0) {
        const extra = yield* hardDeleteProvidersFromSharedFiles(deletedIDs)
        if (extra) {
          changed = true
          yield* invalidateGlobal
          next = yield* loadGlobal()
        }
      }

      if (changed) yield* invalidate()
      return { info: next, changed }
    })

    return Service.of({
      get,
      getGlobal,
      getConsoleState,
      update,
      updateGlobal,
      invalidate,
      directories,
      waitForDependencies,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(EffectFlock.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Env.defaultLayer),
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Account.defaultLayer),
  Layer.provide(Npm.defaultLayer),
)

/** @internal test-only helpers for tenant provider isolation */
export const testing = {
  applyConfigPatch,
  stripForeignCustomProviders,
  stripSharedSshMcp,
  withDeletedProviders,
  writableGlobal,
  shouldConnectFromConfigAlone,
  sharedGlobalConfigFiles,
  isTenantMapsOnlyPatch,
  normalizeSshMap,
  overlayPublicProviders,
  omitPublicProviderMutations,
  tenantCustomProviders,
}

export * as Config from "./config"
