import * as Log from "@opencode-ai/core/util/log"
import { OneSkills } from "./index"
import { installFromRelease } from "./release"

const log = Log.create({ service: "oneskills-public-refresh" })

const REFRESH_TIMEZONE = "Asia/Shanghai"
const REFRESH_JITTER_MS = 30 * 60 * 1000

function publicRefreshDisabled() {
  const value = (process.env.OPENCODE_DISABLE_ONESKILLS_PUBLIC_REFRESH ?? "").trim().toLowerCase()
  return value === "1" || value === "true" || value === "yes"
}

function shanghaiClockParts(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: REFRESH_TIMEZONE,
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  )
  return {
    hour: Number(parts.hour ?? 0),
    minute: Number(parts.minute ?? 0),
    second: Number(parts.second ?? 0),
  }
}

export function msUntilNextShanghaiMidnight(from = Date.now()) {
  const { hour, minute, second } = shanghaiClockParts(new Date(from))
  const elapsedMs = ((hour * 3600 + minute * 60 + second) * 1000)
  const untilMidnight = Math.max(0, 86_400_000 - elapsedMs)
  return untilMidnight + Math.floor(Math.random() * REFRESH_JITTER_MS)
}

export async function refreshPublicOneskills() {
  const projectRoot = OneSkills.globalProjectRoot()
  log.info("refreshing shared public OneSkills", { projectRoot })
  const result = await installFromRelease({ force: true, projectRoot })
  log.info("refreshed shared public OneSkills", {
    projectRoot: result.projectRoot,
    version: result.version,
    skillCount: result.skillCount,
  })
  return result
}

export function startPublicOneskillsRefreshScheduler() {
  if (publicRefreshDisabled()) {
    log.info("skip public OneSkills refresh scheduler; disabled by env")
    return
  }

  const schedule = () => {
    const delay = msUntilNextShanghaiMidnight()
    log.info("scheduled public OneSkills refresh", { delayMs: delay })
    const timer = setTimeout(() => {
      void refreshPublicOneskills()
        .catch((error) => {
          log.error("public OneSkills refresh failed", {
            error: error instanceof Error ? error.message : String(error),
          })
        })
        .finally(schedule)
    }, delay)
    timer.unref?.()
  }

  schedule()
}

export * as OneSkillsPublicRefresh from "./public-refresh"
