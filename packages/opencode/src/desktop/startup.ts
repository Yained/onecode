import { Catalog } from "@/catalog/index"
import { OneScienceCodeDefaultDirectory } from "@/onescience/code-default-directory"
import { OneScienceStartupMigrations } from "@/onescience/startup-migrations"
import { OneSkillsBootstrapBundled } from "@/oneskills/bootstrap-bundled"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "desktop-startup" })

/**
 * Desktop sidecar bootstrap: sync bundled OneSkills, run OneScience migrations,
 * ensure ~/OneCode/case (or configured data root), then reconcile catalog.
 * Only intended when OPENCODE_CLIENT=desktop.
 */
export async function run() {
  if ((process.env.OPENCODE_CLIENT ?? "cli") !== "desktop") {
    log.warn("desktop startup skipped; OPENCODE_CLIENT is not desktop", {
      client: process.env.OPENCODE_CLIENT,
    })
    return { skipped: true as const, reason: "not-desktop" as const }
  }

  const oneskills = await OneSkillsBootstrapBundled.run()
  await OneScienceStartupMigrations.run()
  const codeDefaultDirectory = OneScienceCodeDefaultDirectory.ensure()
  Catalog.bootstrap({
    projectDir: codeDefaultDirectory,
    syncSkills: true,
  })

  log.info("desktop startup complete", {
    codeDefaultDirectory,
    oneskillsCopied: "copied" in oneskills ? oneskills.copied : [],
    oneskillsTarget: "target" in oneskills ? oneskills.target : undefined,
  })

  return {
    skipped: false as const,
    codeDefaultDirectory,
    oneskills,
  }
}

export * as DesktopStartup from "./startup"
