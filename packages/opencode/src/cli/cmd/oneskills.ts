import type { Argv } from "yargs"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { OneSkills } from "@/oneskills/index"
import { Catalog } from "@/catalog/index"
import { migrateStaticPrimitives } from "@/onescience/primitive-migration"
import { errorMessage } from "../../util/error"

function reindexAfterInstall(projectDir: string) {
  // Built-in primitives come from the onecode-bundled seed (version-gated), not from
  // scanning the freshly installed oneskills tree as truth.
  migrateStaticPrimitives()
  return Catalog.reconcile({ syncSkills: true, projectDir })
}

const InstallCommand = cmd({
  command: "install",
  describe: "install OneSkills globally to ~/.opencode/oneskills",
  builder: (yargs: Argv) =>
    yargs
      .option("profile", {
        type: "string",
        choices: ["basic", "runtime"] as const,
        default: "basic",
        describe: "Install profile",
      })
      .option("mode", {
        type: "string",
        choices: ["copy", "symlink"] as const,
        default: "copy",
        describe: "Install mode",
      })
      .option("force", { type: "boolean", default: false, describe: "Overwrite existing targets" })
      .option("dry-run", { type: "boolean", default: false, describe: "Print planned actions only" }),
  handler: async (args) => {
    try {
      const result = await OneSkills.install({
        profile: (args.profile as "basic" | "runtime") ?? "basic",
        mode: (args.mode as "copy" | "symlink") ?? "copy",
        force: Boolean(args.force),
        dryRun: Boolean(args.dryRun),
      })
      if (args.dryRun) {
        UI.println("OneSkills dry-run complete.")
        return
      }
      const indexed = reindexAfterInstall(process.cwd())
      const legacy = OneSkills.removeLegacyFlatLayout()
      UI.println(
        `OneSkills installed to ${OneSkills.root(result.projectRoot)} (${result.skillCount} skills, ${indexed.primitiveCount} primitives indexed, ${indexed.embedded} embeddings)`,
      )
      if (legacy.length > 0) {
        UI.println(`Removed legacy flat layout: ${legacy.join(", ")}`)
      }
    } catch (err) {
      UI.error(`OneSkills install failed: ${errorMessage(err)}`)
      process.exit(1)
    }
  },
})

const UpgradeCommand = cmd({
  command: "upgrade",
  describe: "upgrade global OneSkills and rebuild the catalog index",
  builder: (yargs: Argv) =>
    yargs
      .option("profile", {
        type: "string",
        choices: ["basic", "runtime"] as const,
        default: "basic",
      })
      .option("mode", {
        type: "string",
        choices: ["copy", "symlink"] as const,
        default: "copy",
      })
      .option("project", {
        type: "string",
        describe: "Project directory to reindex after upgrade (defaults to cwd)",
      }),
  handler: async (args) => {
    try {
      const result = await OneSkills.upgrade({
        profile: (args.profile as "basic" | "runtime") ?? "basic",
        mode: (args.mode as "copy" | "symlink") ?? "copy",
      })
      const indexed = reindexAfterInstall(typeof args.project === "string" ? args.project : process.cwd())
      UI.println(
        `OneSkills upgraded to ${result.version ?? "latest"} (${result.skillCount} skills, ${indexed.primitiveCount} primitives indexed, ${indexed.embedded} embeddings)`,
      )
    } catch (err) {
      UI.error(`OneSkills upgrade failed: ${errorMessage(err)}`)
      process.exit(1)
    }
  },
})

const StatusCommand = cmd({
  command: "status",
  describe: "show global OneSkills install status",
  handler: async () => {
    const info = await OneSkills.status()
    UI.println(JSON.stringify(info, null, 2))
  },
})

const UninstallCommand = cmd({
  command: "uninstall",
  describe: "remove global OneSkills install from ~/.opencode/oneskills",
  builder: (yargs: Argv) => yargs.option("dry-run", { type: "boolean", default: false }),
  handler: async (args) => {
    try {
      await OneSkills.uninstall(OneSkills.globalProjectRoot(), Boolean(args.dryRun))
      UI.println(args.dryRun ? "OneSkills uninstall dry-run complete." : "OneSkills uninstalled.")
    } catch (err) {
      UI.error(`OneSkills uninstall failed: ${errorMessage(err)}`)
      process.exit(1)
    }
  },
})

const MigrateLegacyCommand = cmd({
  command: "migrate-legacy",
  describe: "remove old flat ~/.opencode/skills onescience-* layout after migrating to oneskills/",
  handler: async () => {
    const removed = OneSkills.removeLegacyFlatLayout()
    if (removed.length === 0) {
      UI.println("No legacy flat OneSkills paths found under ~/.opencode")
      return
    }
    UI.println(`Removed legacy flat layout: ${removed.join(", ")}`)
    const indexed = reindexAfterInstall(process.cwd())
    UI.println(`Catalog reindexed: ${indexed.skillCount} skills, ${indexed.primitiveCount} primitives, ${indexed.embedded} embeddings`)
  },
})

export const OneSkillsCommand = cmd({
  command: "oneskills",
  describe: "install and manage global OneSkills",
  builder: (yargs: Argv) =>
    yargs
      .command(InstallCommand)
      .command(UpgradeCommand)
      .command(MigrateLegacyCommand)
      .command(StatusCommand)
      .command(UninstallCommand)
      .demandCommand(),
  handler: () => {},
})
