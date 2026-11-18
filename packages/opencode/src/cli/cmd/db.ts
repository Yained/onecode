import type { Argv } from "yargs"
import { spawn } from "child_process"
import { Database } from "@/storage/db"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { Database as BunDatabase } from "bun:sqlite"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { JsonMigration } from "@/storage/json-migration"
import { OneScienceResource } from "@/onescience/resource"
import { OneScienceScenario } from "@/onescience/scenario"
import { OneScienceSkill } from "@/onescience/skill"
import { migrateStaticPrimitives } from "@/onescience/primitive-migration"
import { SessionSeed } from "@/session/session-seed"
import { EOL } from "os"
import { errorMessage } from "../../util/error"

const QueryCommand = cmd({
  command: "$0 [query]",
  describe: "open an interactive sqlite3 shell or run a query",
  builder: (yargs: Argv) => {
    return yargs
      .positional("query", {
        type: "string",
        describe: "SQL query to execute",
      })
      .option("format", {
        type: "string",
        choices: ["json", "tsv"],
        default: "tsv",
        describe: "Output format",
      })
  },
  handler: async (args: { query?: string; format: string }) => {
    const query = args.query as string | undefined
    if (query) {
      const db = new BunDatabase(Database.getPath(), { readonly: true })
      try {
        const result = db.query(query).all() as Record<string, unknown>[]
        if (args.format === "json") {
          console.log(JSON.stringify(result, null, 2))
        } else if (result.length > 0) {
          const keys = Object.keys(result[0])
          console.log(keys.join("\t"))
          for (const row of result) {
            console.log(keys.map((k) => row[k]).join("\t"))
          }
        }
      } catch (err) {
        UI.error(errorMessage(err))
        process.exit(1)
      }
      db.close()
      return
    }
    const child = spawn("sqlite3", [Database.getPath()], {
      stdio: "inherit",
    })
    await new Promise((resolve) => child.on("close", resolve))
  },
})

const PathCommand = cmd({
  command: "path",
  describe: "print the database path",
  handler: () => {
    console.log(Database.getPath())
  },
})

const MigrateCommand = cmd({
  command: "migrate",
  describe: "migrate JSON data to SQLite (merges with existing data)",
  handler: async () => {
    const sqlite = new BunDatabase(Database.getPath())
    const tty = process.stderr.isTTY
    const width = 36
    const orange = "\x1b[38;5;214m"
    const muted = "\x1b[0;2m"
    const reset = "\x1b[0m"
    let last = -1
    if (tty) process.stderr.write("\x1b[?25l")
    try {
      const stats = await JsonMigration.run(drizzle({ client: sqlite }), {
        progress: (event) => {
          const percent = Math.floor((event.current / event.total) * 100)
          if (percent === last) return
          last = percent
          if (tty) {
            const fill = Math.round((percent / 100) * width)
            const bar = `${"■".repeat(fill)}${"･".repeat(width - fill)}`
            process.stderr.write(
              `\r${orange}${bar} ${percent.toString().padStart(3)}%${reset} ${muted}${event.current}/${event.total}${reset} `,
            )
          } else {
            process.stderr.write(`sqlite-migration:${percent}${EOL}`)
          }
        },
      })
      if (tty) process.stderr.write("\n")
      if (tty) process.stderr.write("\x1b[?25h")
      else process.stderr.write(`sqlite-migration:done${EOL}`)
      UI.println(
        `Migration complete: ${stats.projects} projects, ${stats.sessions} sessions, ${stats.messages} messages`,
      )
      if (stats.errors.length > 0) {
        UI.println(`${stats.errors.length} errors occurred during migration`)
      }
    } catch (err) {
      if (tty) process.stderr.write("\x1b[?25h")
      UI.error(`Migration failed: ${errorMessage(err)}`)
      process.exit(1)
    } finally {
      sqlite.close()
    }
  },
})

const MigrateOneScienceCommand = cmd({
  command: "migrate-onescience",
  describe: "seed or update OneScience resource catalog in SQLite",
  handler: () => {
    try {
      const result = OneScienceResource.seedDefaults()
      UI.println(`OneScience resource migration complete: ${result.seeded} seeded, ${result.updated} updated`)
    } catch (err) {
      UI.error(`OneScience resource migration failed: ${errorMessage(err)}`)
      process.exit(1)
    }
  },
})

const MigrateSkillsCommand = cmd({
  command: "migrate-skills",
  describe: "seed OneScience skills and primitive/resource relations in SQLite",
  handler: () => {
    try {
      const skills = OneScienceSkill.seedDefaults()
      const relations = OneScienceSkill.seedPrimitiveRelations()
      UI.println(`OneScience skill migration complete: ${skills.seeded} seeded, ${skills.updated} updated, ${relations.skillBindings} skill bindings, ${relations.resourceBindings} resource bindings`)
    } catch (err) {
      UI.error(`OneScience skill migration failed: ${errorMessage(err)}`)
      process.exit(1)
    }
  },
})

const MigratePrimitivesCommand = cmd({
  command: "migrate-primitives",
  describe: "migrate static AI primitives to SQLite database",
  handler: () => {
    try {
      const result = migrateStaticPrimitives()
      UI.println(`AI primitives migration complete: ${result.migrated} migrated, ${result.skipped} skipped`)
    } catch (err) {
      UI.error(`AI primitives migration failed: ${errorMessage(err)}`)
      process.exit(1)
    }
  },
})

const MigrateSessionsCommand = cmd({
  command: "migrate-sessions",
  describe: "seed bundled default sessions for the default code workspace (incremental on later runs)",
  handler: () => {
    try {
      const result = SessionSeed.seedDefaults()
      if (result.skipped && result.reason === "already-applied") {
        UI.println("Default session seed up to date; no new sessions to import")
        return
      }
      if (result.skipped) {
        UI.println(`Default session seed skipped (${result.reason ?? "unknown"})`)
        return
      }
      UI.println(`Default session seed complete: ${result.seeded} session(s) at ${result.directory}`)
    } catch (err) {
      UI.error(`Default session seed failed: ${errorMessage(err)}`)
      process.exit(1)
    }
  },
})

const MigrateScenariosCommand = cmd({
  command: "migrate-scenarios",
  describe: "seed or update OneScience scenario catalog in SQLite from scenario-seed.json",
  handler: () => {
    try {
      const result = OneScienceScenario.seedDefaults()
      UI.println(
        `OneScience scenario migration complete: ${result.seeded} seeded, ${result.updated} updated, ${result.removed} removed`,
      )
    } catch (err) {
      UI.error(`OneScience scenario migration failed: ${errorMessage(err)}`)
      process.exit(1)
    }
  },
})

export const DbCommand = cmd({
  command: "db",
  describe: "database tools",
  builder: (yargs: Argv) => {
    return yargs
      .command(QueryCommand)
      .command(PathCommand)
      .command(MigrateCommand)
      .command(MigrateOneScienceCommand)
      .command(MigratePrimitivesCommand)
      .command(MigrateSkillsCommand)
      .command(MigrateScenariosCommand)
      .command(MigrateSessionsCommand)
      .demandCommand()
  },
  handler: () => {},
})
