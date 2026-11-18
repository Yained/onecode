import { existsSync, readdirSync } from "fs"
import os from "os"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { migrateStaticPrimitives, migratePrimitiveStatuses, migrateResourceDerivedDescriptions } from "./primitive-migration"
import { OneScienceResource } from "./resource"
import { OneScienceScenario } from "./scenario"
import { OneScienceSkill } from "./skill"
import { SessionSeed } from "@/session/session-seed"

const log = Log.create({ service: "onescience-startup-migrations" })

const commands = ["migrate-onescience", "migrate-primitives", "migrate-skills", "migrate-scenarios", "migrate-sessions"] as const

export function runningInCompiledBinary() {
  const exec = path.basename(process.execPath)
  // Standalone binary: .../onecode-linux-x64/bin/onecode
  if (exec === "onecode" || exec === "onecode.exe") return true
  // npm launcher hardlink: .../@onescience/onecode/bin/.onecode
  if (exec === ".onecode") return true
  return false
}

export function opencodePackageDir() {
  const root = process.env.ONECODE_ROOT?.trim()
  if (root) {
    const dir = path.join(path.resolve(root), "packages/opencode")
    if (existsSync(path.join(dir, "package.json"))) return dir
  }
  const dir = path.resolve(import.meta.dirname, "../..")
  if (existsSync(path.join(dir, "package.json"))) return dir
  return undefined
}

export function distBinaryCandidates(packageDir: string) {
  const dist = path.join(packageDir, "dist")
  if (!existsSync(dist)) return []

  const platform = os.platform() === "darwin" ? "darwin" : os.platform() === "win32" ? "windows" : "linux"
  const arch = os.arch() === "arm64" ? "arm64" : os.arch() === "x64" ? "x64" : os.arch()
  const binary = platform === "windows" ? "onecode.exe" : "onecode"
  const preferred = `onecode-${platform}-${arch}`
  const names = [
    preferred,
    ...readdirSync(dist, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("onecode-"))
      .map((entry) => entry.name)
      .filter((name) => name !== preferred),
  ]

  return [...new Set(names)]
    .map((name) => path.join(dist, name, "bin", binary))
    .filter((candidate) => existsSync(candidate))
}

export function resolveSourceDistBinary() {
  const env = process.env.ONECODE_BIN_PATH?.trim() || process.env.OPENCODE_BIN_PATH?.trim()
  if (env && existsSync(env)) return env

  if (runningInCompiledBinary() && existsSync(process.execPath)) return process.execPath

  const packageDir = opencodePackageDir()
  if (!packageDir) return undefined
  return distBinaryCandidates(packageDir)[0]
}

function runInProcess() {
  const resources = OneScienceResource.seedDefaults()
  const primitives = migrateStaticPrimitives()
  const primitiveDescriptions = migrateResourceDerivedDescriptions()
  const primitiveStatuses = migratePrimitiveStatuses()
  const skills = OneScienceSkill.seedDefaults()
  const relations = OneScienceSkill.seedPrimitiveRelations()
  const scenarios = OneScienceScenario.seedDefaults()
  const sessions = SessionSeed.seedDefaults()
  log.info("startup migrations complete", {
    resourcesSeeded: resources.seeded,
    resourcesUpdated: resources.updated,
    primitivesMigrated: primitives.migrated,
    primitivesSkipped: primitives.skipped,
    primitiveDescriptionsUpdated: primitiveDescriptions.updated,
    primitiveStatusesUpdated: primitiveStatuses.updated,
    primitiveStatusesRemoved: primitiveStatuses.removed,
    skillsSeeded: skills.seeded,
    skillsUpdated: skills.updated,
    skillBindings: relations.skillBindings,
    resourceBindings: relations.resourceBindings,
    scenariosSeeded: scenarios.seeded,
    scenariosUpdated: scenarios.updated,
    scenariosRemoved: scenarios.removed,
    sessionsSeeded: sessions.seeded,
    sessionsSkipped: sessions.skipped,
    sessionSeedReason: sessions.reason,
  })
}

async function runViaBinary(binary: string) {
  for (const command of commands) {
    const proc = Bun.spawn([binary, "db", command], {
      stdout: "inherit",
      stderr: "inherit",
      cwd: opencodePackageDir() ?? process.cwd(),
    })
    const code = await proc.exited
    if (code !== 0) throw new Error(`onecode db ${command} failed with exit code ${code}`)
  }
}

export async function run() {
  if (runningInCompiledBinary() || process.env.ONECODE_STARTUP_MIGRATIONS_IN_PROCESS === "1") {
    runInProcess()
    return
  }

  const binary = resolveSourceDistBinary()
  if (!binary) {
    throw new Error(
      "onecode dist binary not found for startup migrations; build first with ./packages/opencode/script/build.ts --single --skip-install",
    )
  }

  log.info("running startup migrations via dist binary", { binary })
  await runViaBinary(binary)
}

export * as OneScienceStartupMigrations from "./startup-migrations"
