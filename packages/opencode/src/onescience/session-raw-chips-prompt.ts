import { and, eq, isNull, or } from "drizzle-orm"
import { Database } from "@/storage/db"
import { OneScienceDataProjectTable, OneScienceDataSessionChipTable } from "./data-project.sql"

export type SessionRawChipSource = {
  id: string
  title: string
  uri: string
  connector?: string
}

const DATABASE_RAW_NOTE =
  "Database Raw chips are read-only table data for reading/organizing; they are not a training set by default. To register as trainable, call dataset_report after preparing files, or convert to materialize first."

/** Pure formatter for agent system prompt injection when session has Raw chips. */
export function formatSessionRawChipsPrompt(sources: SessionRawChipSource[]) {
  if (sources.length === 0) return undefined
  const hasDatabase = sources.some((item) => item.connector === "database")
  return [
    "<session-raw-data>",
    "Raw sources bound to this session (source dir). They are NOT trainable yet.",
    ...(hasDatabase ? [DATABASE_RAW_NOTE] : []),
    "Standardize each source into an AI Ready target dir, then call dataset_report with only:",
    "- name: dataset display name",
    "- target_dir: AI Ready output path (must exist)",
    "Source lineage uses these chips automatically; do not pass source_dir to the tool.",
    "Do not write .onescience/already.json.",
    "Bound sources:",
    ...sources.map((item) => {
      const connector = item.connector ? `; connector=${item.connector}` : ""
      return `- ${item.id}: name=${item.title}; source_dir=${item.uri}${connector}`
    }),
    "</session-raw-data>",
  ].join("\n")
}

export function listSessionRawChipSources(sessionId: string): SessionRawChipSource[] {
  return Database.use((db) => {
    const chips = db
      .select()
      .from(OneScienceDataSessionChipTable)
      .where(eq(OneScienceDataSessionChipTable.session_id, sessionId))
      .all()
    return chips.map((chip) => {
      const raw = db
        .select()
        .from(OneScienceDataProjectTable)
        .where(
          and(
            eq(OneScienceDataProjectTable.owner, chip.owner),
            isNull(OneScienceDataProjectTable.time_deleted),
            or(eq(OneScienceDataProjectTable.public_id, chip.raw_id), eq(OneScienceDataProjectTable.id, chip.raw_id)),
          ),
        )
        .get()
      return {
        id: chip.raw_id,
        title: raw?.title || chip.raw_id,
        uri: raw?.raw_data_uri || "",
        connector: raw?.connector,
      }
    })
  })
}

export function sessionRawChipsPromptBlock(sessionId: string) {
  return formatSessionRawChipsPrompt(listSessionRawChipSources(sessionId))
}
