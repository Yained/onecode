import path from "path"
import { pathToFileURL } from "url"
import { Effect, Layer, Context, Schema } from "effect"
import { NamedError } from "@opencode-ai/core/util/error"
import type { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { BusEvent } from "@/bus/bus-event"
import { EffectBridge } from "@/effect/bridge"
import { InstanceState } from "@/effect/instance-state"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { Permission } from "@/permission"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Config } from "@/config/config"
import { ConfigPaths } from "@/config/paths"
import { ConfigMarkdown } from "@/config/markdown"
import { Glob } from "@opencode-ai/core/util/glob"
import { FileWatcher } from "@/file/watcher"
import * as Log from "@opencode-ai/core/util/log"
import { Discovery } from "./discovery"
import {
  skillOverrideRank,
  SkillOverrideRank,
  type SkillOverrideContext,
} from "./override-rank"
import { OneSkills } from "@/oneskills/index"
import * as PlatformAuth from "@/platform-auth/platform-auth"
import CUSTOMIZE_OPENCODE_SKILL_BODY from "./prompt/customize-opencode.md" with { type: "text" }
import { isRecord } from "@/util/record"
import { parseGitHubSkillSource } from "@/util/repository"

const log = Log.create({ service: "skill" })
const CLAUDE_EXTERNAL_DIR = ".claude"
const AGENTS_EXTERNAL_DIR = ".agents"
const EXTERNAL_SKILL_PATTERN = "skills/*/SKILL.md"
// Scan prefab oneskills before user skills so same-name entries in skills/ win.
const OPENCODE_SKILL_PATTERNS = ["oneskills/skills/*/SKILL.md", "{skill,skills}/*/SKILL.md"] as const
const SKILL_ROOT_PATTERN = "SKILL.md"
const SKILL_CHILD_PATTERN = "*/SKILL.md"

// Built-in skill that ships with opencode. The model's intuition for what an
// opencode.json should look like is often wrong, and opencode hard-fails on
// invalid config, so users hit cryptic startup errors. Loading this skill
// when the model is asked to touch opencode's own config files gives it the
// actual schemas instead of guesses.
const CUSTOMIZE_OPENCODE_SKILL_NAME = "customize-opencode"
const CUSTOMIZE_OPENCODE_SKILL_DESCRIPTION =
  "Use ONLY when the user is editing or creating opencode's own configuration: opencode.json, opencode.jsonc, files under .opencode/, or files under ~/.config/opencode/. Also use when creating or fixing opencode agents, subagents, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring opencode itself."

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  location: Schema.String,
})
export type Info = Schema.Schema.Type<typeof Info>

export type LoadedInfo = Info & {
  content: string
}

export const RuntimeSkillSnapshot = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  location: Schema.String,
})
export type RuntimeSkillSnapshot = Schema.Schema.Type<typeof RuntimeSkillSnapshot>

export const Event = {
  Updated: BusEvent.define("skill.updated", Schema.Struct({
    skills: Schema.optional(Schema.Array(RuntimeSkillSnapshot)),
  })),
}

export function catalogSnapshot(skills: Iterable<Info>) {
  return [...skills].flatMap((item) =>
    item.description && item.location !== "<built-in>"
      ? [{ name: item.name, description: item.description, location: item.location }]
      : [],
  )
}

const Issue = Schema.StructWithRest(
  Schema.Struct({
    message: Schema.String,
    path: Schema.Array(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

function isSkillFrontmatter(data: unknown): data is { name: string; description?: string } {
  return (
    isRecord(data) &&
    typeof data.name === "string" &&
    (data.description === undefined || typeof data.description === "string")
  )
}

export const InvalidError = NamedError.create("SkillInvalidError", {
  path: Schema.String,
  message: Schema.optional(Schema.String),
  issues: Schema.optional(Schema.Array(Issue)),
})

export const NameMismatchError = NamedError.create("SkillNameMismatchError", {
  path: Schema.String,
  expected: Schema.String,
  actual: Schema.String,
})

type State = {
  skills: Record<string, Info>
  loaded: Record<string, LoadedInfo>
  dirs: Set<string>
  expandedDirs: Set<string>
}

type DiscoveryState = {
  matches: string[]
  dirs: string[]
}

type ScanState = {
  matches: Set<string>
  dirs: Set<string>
}

export interface Interface {
  readonly get: (name: string) => Effect.Effect<LoadedInfo | undefined>
  readonly all: () => Effect.Effect<Info[]>
  readonly dirs: () => Effect.Effect<string[]>
  readonly available: (agent?: Agent.Info) => Effect.Effect<Info[]>
  readonly expand: (name: string) => Effect.Effect<void>
  readonly refresh: () => Effect.Effect<void>
  readonly initHotReload: () => Effect.Effect<void>
  readonly initOneskillsRefresh: () => Effect.Effect<void>
}

function inSkillTree(filepath: string) {
  return /\/skills\/[^/]+(?:\/|$)/.test(filepath) || /\/skill\/[^/]+(?:\/|$)/.test(filepath)
}

export function matchesSkillChange(file: string, event: "add" | "change" | "unlink") {
  const filepath = file.replaceAll("\\", "/")
  if (filepath.endsWith("SKILL.md")) return true
  if (event === "change") return false
  return inSkillTree(filepath)
}

const add = Effect.fnUntraced(function* (
  state: State,
  match: string,
  bus: Bus.Interface,
  rankCtx: SkillOverrideContext,
) {
  const md = yield* Effect.tryPromise({
    try: () => ConfigMarkdown.frontmatter(match),
    catch: (err) => err,
  }).pipe(
    Effect.catch(
      Effect.fnUntraced(function* (err) {
        const message = ConfigMarkdown.FrontmatterError.isInstance(err)
          ? err.data.message
          : `Failed to parse skill ${match}`
        const { Session } = yield* Effect.promise(() => import("@/session/session"))
        yield* bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        log.error("failed to load skill", { skill: match, err })
        return undefined
      }),
    ),
  )

  if (!md) return

  if (!isSkillFrontmatter(md.data)) {
    log.warn("invalid skill frontmatter", { skill: match })
    return
  }

  const existing = state.skills[md.data.name]
  if (existing) {
    const nextRank = skillOverrideRank(match, rankCtx)
    const existingRank =
      existing.location === "<built-in>" ? SkillOverrideRank.external : skillOverrideRank(existing.location, rankCtx)
    if (nextRank < existingRank) {
      log.warn("duplicate skill name", {
        name: md.data.name,
        existing: existing.location,
        duplicate: match,
      })
      return
    }
    if (nextRank === existingRank) {
      log.warn("duplicate skill name", {
        name: md.data.name,
        existing: existing.location,
        duplicate: match,
      })
    }
  }

  state.dirs.add(path.dirname(match))
  state.skills[md.data.name] = {
    name: md.data.name,
    description: md.data.description,
    location: match,
  }
})

const scan = Effect.fnUntraced(function* (
  state: ScanState,
  root: string,
  pattern: string,
  opts?: { dot?: boolean; scope?: string },
) {
  const matches = yield* Effect.tryPromise({
    try: () =>
      Glob.scan(pattern, {
        cwd: root,
        absolute: true,
        include: "file",
        symlink: true,
        dot: opts?.dot,
      }),
    catch: (error) => error,
  }).pipe(
    Effect.catch((error) => {
      if (!opts?.scope) return Effect.die(error)
      log.error(`failed to scan ${opts.scope} skills`, { dir: root, error })
      return Effect.succeed([] as string[])
    }),
  )

  for (const match of matches) {
    state.matches.add(match)
    state.dirs.add(path.dirname(match))
  }
})

const discoverSkills = Effect.fnUntraced(function* (
  config: Config.Interface,
  discovery: Discovery.Interface,
  fsys: AppFileSystem.Interface,
  global: Global.Interface,
  directory: string,
  worktree: string,
) {
  const state: ScanState = { matches: new Set(), dirs: new Set() }

  const externalDirs: string[] = []
  if (!Flag.OPENCODE_DISABLE_EXTERNAL_SKILLS) {
    if (!Flag.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS) externalDirs.push(CLAUDE_EXTERNAL_DIR)
    externalDirs.push(AGENTS_EXTERNAL_DIR)

    for (const dir of externalDirs) {
      const root = path.join(global.home, dir)
      if (!(yield* fsys.isDir(root))) continue
      yield* scan(state, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "global" })
    }

    const upDirs = yield* fsys
      .up({ targets: externalDirs, start: directory, stop: worktree })
      .pipe(Effect.catch(() => Effect.succeed([] as string[])))

    for (const root of upDirs) {
      yield* scan(state, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "project" })
    }
  }

  for (const target of OneSkills.globalSkillScanTargets({
    includeSharedUserSkills: !PlatformAuth.authRequired(),
  })) {
    for (const pattern of target.patterns) {
      yield* scan(state, target.root, pattern)
    }
  }

  const accountId = PlatformAuth.accountIdForDirectory(directory)
  if (accountId) {
    const accountSkills = PlatformAuth.accountSkillsDir(accountId)
    if (yield* fsys.isDir(accountSkills)) {
      yield* scan(state, accountSkills, SKILL_CHILD_PATTERN)
    }
  }

  const configDirs = yield* ConfigPaths.directories(directory, worktree)
  for (const dir of configDirs) {
    if (OneSkills.isGlobalHomeOpencodeDir(dir)) continue
    for (const pattern of OPENCODE_SKILL_PATTERNS) {
      yield* scan(state, dir, pattern)
    }
  }

  const cfg = yield* config.get()
  for (const item of cfg.skills?.paths ?? []) {
    const expanded = item.startsWith("~/") ? path.join(global.home, item.slice(2)) : item
    const dir = path.isAbsolute(expanded) ? expanded : path.join(directory, expanded)
    if (!(yield* fsys.isDir(dir))) {
      log.warn("skill path not found", { path: dir })
      continue
    }

    yield* scan(state, dir, SKILL_ROOT_PATTERN)
    yield* scan(state, dir, SKILL_CHILD_PATTERN)
  }

  for (const url of cfg.skills?.urls ?? []) {
    if (parseGitHubSkillSource(url)) {
      log.warn("skipping GitHub repository URL in skills.urls; add it via skill repo config instead", { url })
      continue
    }
    const pulledDirs = yield* discovery.pull(url).pipe(
      Effect.timeoutOrElse({
        duration: "5 seconds",
        orElse: () =>
          Effect.sync(() => {
            log.warn("skill index fetch timed out", { url })
            return [] as string[]
          }),
      }),
      Effect.catch((error) =>
        Effect.sync(() => {
          log.warn("skill index fetch failed", { url, error })
          return [] as string[]
        }),
      ),
    )
    for (const dir of pulledDirs) {
      yield* scan(state, dir, SKILL_ROOT_PATTERN)
    }
  }

  return {
    matches: Array.from(state.matches),
    dirs: Array.from(state.dirs),
  }
})

const loadSkills = Effect.fnUntraced(function* (
  state: State,
  discovered: DiscoveryState,
  bus: Bus.Interface,
  rankCtx: SkillOverrideContext,
) {
  yield* Effect.forEach(discovered.matches, (match) => add(state, match, bus, rankCtx), {
    concurrency: "unbounded",
    discard: true,
  })

  log.info("init", { count: Object.keys(state.skills).length })
})

const discoverChildren = Effect.fnUntraced(function* (
  state: State,
  info: Info,
  bus: Bus.Interface,
  rankCtx: SkillOverrideContext,
) {
  if (info.location === "<built-in>") return

  const dir = path.dirname(info.location)
  if (state.expandedDirs.has(dir)) return
  state.expandedDirs.add(dir)

  const childState: ScanState = { matches: new Set(), dirs: new Set() }
  yield* scan(childState, dir, SKILL_CHILD_PATTERN)
  yield* Effect.forEach(childState.matches, (match) => add(state, match, bus, rankCtx), {
    concurrency: "unbounded",
    discard: true,
  })
})

export class Service extends Context.Service<Service, Interface>()("@opencode/Skill") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const discovery = yield* Discovery.Service
    const config = yield* Config.Service
    const bus = yield* Bus.Service
    const fsys = yield* AppFileSystem.Service
    const global = yield* Global.Service
    const discovered = yield* InstanceState.make(
      Effect.fn("Skill.discovery")(function* (ctx) {
        return yield* discoverSkills(config, discovery, fsys, global, ctx.directory, ctx.worktree)
      }),
    )
    const state = yield* InstanceState.make(
      Effect.fn("Skill.state")(function* () {
        const ctx = yield* InstanceState.context
        const rankCtx = { directory: ctx.directory, worktree: ctx.worktree }
        const s: State = { skills: {}, loaded: {}, dirs: new Set(), expandedDirs: new Set() }
        // Register the built-in skill BEFORE disk discovery so a user-disk
        // skill with the same name can override it.
        s.skills[CUSTOMIZE_OPENCODE_SKILL_NAME] = {
          name: CUSTOMIZE_OPENCODE_SKILL_NAME,
          description: CUSTOMIZE_OPENCODE_SKILL_DESCRIPTION,
          location: "<built-in>",
        }
        yield* loadSkills(s, yield* InstanceState.get(discovered), bus, rankCtx)
        return s
      }),
    )

    const get = Effect.fn("Skill.get")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      const cached = s.loaded[name]
      if (cached) return cached

      const info = s.skills[name]
      if (!info) return undefined

      if (info.location === "<built-in>") {
        const loaded = {
          ...info,
          content: CUSTOMIZE_OPENCODE_SKILL_BODY,
        }
        s.loaded[name] = loaded
        return loaded
      }

      const md = yield* Effect.tryPromise({
        try: () => ConfigMarkdown.parse(info.location),
        catch: (err) => err,
      }).pipe(
        Effect.catch(
          Effect.fnUntraced(function* (err) {
            const message = ConfigMarkdown.FrontmatterError.isInstance(err)
              ? err.data.message
              : `Failed to parse skill ${info.location}`
            const { Session } = yield* Effect.promise(() => import("@/session/session"))
            yield* bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
            log.error("failed to load skill content", { skill: info.location, err })
            return undefined
          }),
        ),
      )
      if (!md) return undefined
      if (!isSkillFrontmatter(md.data)) return undefined

      const loaded = {
        ...info,
        content: md.content,
      }
      s.loaded[name] = loaded
      return loaded
    })

    const expand = Effect.fn("Skill.expand")(function* (name: string) {
      const ctx = yield* InstanceState.context
      const s = yield* InstanceState.get(state)
      const info = s.skills[name]
      if (!info) return
      yield* discoverChildren(s, info, bus, { directory: ctx.directory, worktree: ctx.worktree })
    })

    const all = Effect.fn("Skill.all")(function* () {
      const s = yield* InstanceState.get(state)
      return Object.values(s.skills)
    })

    const dirs = Effect.fn("Skill.dirs")(function* () {
      const s = yield* InstanceState.get(state)
      return Array.from(s.dirs)
    })

    const available = Effect.fn("Skill.available")(function* (agent?: Agent.Info) {
      const s = yield* InstanceState.get(state)
      // Progressive disclosure: state.skills starts with only top-level skills
      // (initial scan uses single-level globs). Children are added to state.skills
      // by discoverChildren() after their parent is loaded, so simply exposing
      // everything currently in state.skills yields the desired progressive set.
      const list = Object.values(s.skills).toSorted((a, b) => a.name.localeCompare(b.name))
      if (!agent) return list
      return list.filter((skill) => Permission.evaluate("skill", skill.name, agent.permission).action !== "deny")
    })

    const publishCatalogSync = Effect.fnUntraced(function* (s: State) {
      yield* bus.publish(Event.Updated, { skills: catalogSnapshot(Object.values(s.skills)) })
    })

    const refresh = Effect.fn("Skill.refresh")(function* () {
      yield* InstanceState.invalidate(discovered)
      yield* InstanceState.invalidate(state)
      const s = yield* InstanceState.get(state)
      yield* publishCatalogSync(s)
      log.info("reloaded", { count: Object.keys(s.skills).length })
    })

    const upsertSkillFile = Effect.fnUntraced(function* (file: string) {
      const ctx = yield* InstanceState.context
      const filepath = file.replaceAll("\\", "/")
      const s = yield* InstanceState.get(state)
      for (const name of Object.keys(s.loaded)) {
        if (s.skills[name]?.location === filepath) delete s.loaded[name]
      }
      const before = Object.keys(s.skills).length
      yield* add(s, filepath, bus, { directory: ctx.directory, worktree: ctx.worktree })
      const entry = Object.entries(s.skills).find(([, info]) => info.location === filepath)
      if (entry) log.info("upserted skill from watch", { name: entry[0], file: filepath })
      else if (Object.keys(s.skills).length === before) log.warn("skill file ignored after watch", { file: filepath })
    })

    const removeSkillFile = Effect.fnUntraced(function* (file: string) {
      const filepath = file.replaceAll("\\", "/")
      const s = yield* InstanceState.get(state)
      for (const [name, info] of Object.entries(s.skills)) {
        if (info.location !== filepath) continue
        delete s.skills[name]
        delete s.loaded[name]
        log.info("removed skill from watch", { name, file: filepath })
      }
    })

    const applyFileChanges = Effect.fn("Skill.applyFileChanges")(function* (
      batch: Array<{ file: string; event: "add" | "change" | "unlink" }>,
    ) {
      const skillMd = batch.filter((item) => item.file.replaceAll("\\", "/").endsWith("SKILL.md"))
      const needsRescan = batch.some((item) => !item.file.replaceAll("\\", "/").endsWith("SKILL.md"))

      if (needsRescan) {
        yield* refresh()
        return
      }

      for (const item of skillMd) {
        if (item.event === "unlink") yield* removeSkillFile(item.file)
        else yield* upsertSkillFile(item.file)
      }
      if (skillMd.length > 0) yield* publishCatalogSync(yield* InstanceState.get(state))
    })

    const hotReload = yield* InstanceState.make(
      Effect.fn("Skill.hotReload")(function* () {
        if (!Flag.OPENCODE_HOT_RELOAD) return

        const ctx = yield* InstanceState.context
        const bridge = yield* EffectBridge.make()
        const directory = path.resolve(ctx.directory)
        log.info("enabled", { directory })

        let timer: ReturnType<typeof setTimeout> | undefined
        let queue: Array<{ file: string; event: "add" | "change" | "unlink" }> = []

        const flush = () => {
          timer = undefined
          const batch = queue
          queue = []
          if (batch.length === 0) return
          void bridge.promise(applyFileChanges(batch)).catch((error) => log.error("refresh failed", { error }))
        }

        const schedule = (file: string, event: "add" | "change" | "unlink") => {
          queue.push({ file, event })
          if (timer !== undefined) clearTimeout(timer)
          timer = setTimeout(flush, 500)
        }

        const handler = (evt: GlobalEvent) => {
          if (path.resolve(evt.directory ?? "") !== directory) return
          if (evt.payload?.type !== FileWatcher.Event.Updated.type) return
          const props = evt.payload.properties as { file: string; event: "add" | "change" | "unlink" }
          if (!matchesSkillChange(props.file, props.event)) return
          schedule(props.file, props.event)
        }

        GlobalBus.on("event", handler)
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            GlobalBus.off("event", handler)
            if (timer !== undefined) clearTimeout(timer)
          }),
        )
      }),
    )

    const initHotReload = Effect.fn("Skill.initHotReload")(function* () {
      if (!Flag.OPENCODE_HOT_RELOAD) return
      yield* InstanceState.get(hotReload)
    })

    const oneskillsRefresh = yield* InstanceState.make(
      Effect.fn("Skill.oneskillsRefresh")(function* () {
        const bridge = yield* EffectBridge.make()
        const handler = (evt: GlobalEvent) => {
          if (evt.payload?.type !== OneSkills.UPGRADED_EVENT) return
          void bridge.promise(refresh()).catch((error) => log.error("oneskills refresh failed", { error }))
        }
        GlobalBus.on("event", handler)
        yield* Effect.addFinalizer(() => Effect.sync(() => GlobalBus.off("event", handler)))
      }),
    )

    const initOneskillsRefresh = Effect.fn("Skill.initOneskillsRefresh")(function* () {
      yield* InstanceState.get(oneskillsRefresh)
    })

    return Service.of({
      get,
      all,
      dirs,
      available,
      expand,
      refresh,
      initHotReload,
      initOneskillsRefresh,
    } as Interface)
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Discovery.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Bus.layer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Global.layer),
)

const VERBOSE_DESCRIPTION_MAX = 80
const COMPACT_DESCRIPTION_MAX = 60

function truncateDescription(text: string, max: number) {
  const value = text.replace(/\s+/g, " ").trim()
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

export function fmt(list: Info[], opts: { verbose: boolean }) {
  const described = list.filter((skill) => skill.description !== undefined)
  if (described.length === 0) return "No skills are currently available."
  if (opts.verbose) {
    return [
      "<available_skills>",
      ...described
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .flatMap((skill) => [
          "  <skill>",
          `    <name>${skill.name}</name>`,
          `    <description>${truncateDescription(skill.description!, VERBOSE_DESCRIPTION_MAX)}</description>`,
          `    <location>${skill.location === "<built-in>" ? skill.location : pathToFileURL(skill.location).href}</location>`,
          "  </skill>",
        ]),
      "</available_skills>",
    ].join("\n")
  }

  return [
    "## Available Skills",
    ...described
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((skill) => `- **${skill.name}**: ${truncateDescription(skill.description!, COMPACT_DESCRIPTION_MAX)}`),
  ].join("\n")
}

export * as Skill from "."
