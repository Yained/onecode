import { BusEvent } from "@/bus/bus-event"
import { SessionID, MessageID, PartID } from "./schema"
import { NamedError } from "@opencode-ai/core/util/error"
import { APICallError, convertToModelMessages, LoadAPIKeyError, type ModelMessage, type UIMessage } from "ai"
import { LSP } from "@/lsp/lsp"
import { Snapshot } from "@/snapshot"
import { SyncEvent } from "../sync"
import { Database } from "@/storage/db"
import { NotFoundError } from "@/storage/storage"
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm"
import { MessageTable, PartTable, SessionTable } from "./session.sql"
import * as ProviderError from "@/provider/error"
import { iife } from "@/util/iife"
import { errorMessage } from "@/util/error"
import { isMedia } from "@/util/media"
import type { SystemError } from "bun"
import type { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { Effect, Schema, Types } from "effect"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import * as EffectLogger from "@opencode-ai/core/effect/logger"
import { MessageError } from "./message-error"
import { AuthError, OutputLengthError } from "./message-error"
export { AuthError, OutputLengthError } from "./message-error"

/** Error shape thrown by Bun's fetch() when gzip/br decompression fails mid-stream */
interface FetchDecompressionError extends Error {
  code: "ZlibError"
  errno: number
  path: string
}

export const SYNTHETIC_ATTACHMENT_PROMPT = "Attached media from tool result:"
export { isMedia }

export const AbortedError = NamedError.create("MessageAbortedError", { message: Schema.String })
export const StructuredOutputError = NamedError.create("StructuredOutputError", {
  message: Schema.String,
  retries: NonNegativeInt,
})
export const APIError = NamedError.create("APIError", {
  message: Schema.String,
  statusCode: Schema.optional(NonNegativeInt),
  isRetryable: Schema.Boolean,
  responseHeaders: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  responseBody: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
export type APIError = Schema.Schema.Type<typeof APIError.Schema>
export const ContextOverflowError = NamedError.create("ContextOverflowError", {
  message: Schema.String,
  responseBody: Schema.optional(Schema.String),
})

export class OutputFormatText extends Schema.Class<OutputFormatText>("OutputFormatText")({
  type: Schema.Literal("text"),
}) {}

export class OutputFormatJsonSchema extends Schema.Class<OutputFormatJsonSchema>("OutputFormatJsonSchema")({
  type: Schema.Literal("json_schema"),
  schema: Schema.Record(Schema.String, Schema.Any).annotate({ identifier: "JSONSchema" }),
  retryCount: NonNegativeInt.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed(2))),
}) {}

export const Format = Schema.Union([OutputFormatText, OutputFormatJsonSchema]).annotate({
  discriminator: "type",
  identifier: "OutputFormat",
})
export type OutputFormat = Schema.Schema.Type<typeof Format>

const partBase = {
  id: PartID,
  sessionID: SessionID,
  messageID: MessageID,
}

export const SnapshotPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal("snapshot"),
  snapshot: Schema.String,
}).annotate({ identifier: "SnapshotPart" })
export type SnapshotPart = Types.DeepMutable<Schema.Schema.Type<typeof SnapshotPart>>

export const PatchPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal("patch"),
  hash: Schema.String,
  files: Schema.Array(Schema.String),
}).annotate({ identifier: "PatchPart" })
export type PatchPart = Types.DeepMutable<Schema.Schema.Type<typeof PatchPart>>

export const TextPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal("text"),
  text: Schema.String,
  synthetic: Schema.optional(Schema.Boolean),
  ignored: Schema.optional(Schema.Boolean),
  time: Schema.optional(
    Schema.Struct({
      start: NonNegativeInt,
      end: Schema.optional(NonNegativeInt),
    }),
  ),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
}).annotate({ identifier: "TextPart" })
export type TextPart = Types.DeepMutable<Schema.Schema.Type<typeof TextPart>>

export const ReasoningPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal("reasoning"),
  text: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
  time: Schema.Struct({
    start: NonNegativeInt,
    end: Schema.optional(NonNegativeInt),
  }),
}).annotate({ identifier: "ReasoningPart" })
export type ReasoningPart = Types.DeepMutable<Schema.Schema.Type<typeof ReasoningPart>>

const filePartSourceBase = {
  text: Schema.Struct({
    value: Schema.String,
    start: Schema.Finite,
    end: Schema.Finite,
  }).annotate({ identifier: "FilePartSourceText" }),
}

export const FileSource = Schema.Struct({
  ...filePartSourceBase,
  type: Schema.Literal("file"),
  path: Schema.String,
}).annotate({ identifier: "FileSource" })

export const SymbolSource = Schema.Struct({
  ...filePartSourceBase,
  type: Schema.Literal("symbol"),
  path: Schema.String,
  range: LSP.Range,
  name: Schema.String,
  kind: NonNegativeInt,
}).annotate({ identifier: "SymbolSource" })

export const ResourceSource = Schema.Struct({
  ...filePartSourceBase,
  type: Schema.Literal("resource"),
  clientName: Schema.String,
  uri: Schema.String,
}).annotate({ identifier: "ResourceSource" })

export const FilePartSource = Schema.Union([FileSource, SymbolSource, ResourceSource]).annotate({
  discriminator: "type",
  identifier: "FilePartSource",
})

export const FilePart = Schema.Struct({
  ...partBase,
  type: Schema.Literal("file"),
  mime: Schema.String,
  filename: Schema.optional(Schema.String),
  url: Schema.String,
  source: Schema.optional(FilePartSource),
}).annotate({ identifier: "FilePart" })
export type FilePart = Types.DeepMutable<Schema.Schema.Type<typeof FilePart>>

export const AgentPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal("agent"),
  name: Schema.String,
  source: Schema.optional(
    Schema.Struct({
      value: Schema.String,
      start: NonNegativeInt,
      end: NonNegativeInt,
    }),
  ),
}).annotate({ identifier: "AgentPart" })
export type AgentPart = Types.DeepMutable<Schema.Schema.Type<typeof AgentPart>>

export const CompactionPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal("compaction"),
  auto: Schema.Boolean,
  overflow: Schema.optional(Schema.Boolean),
  tail_start_id: Schema.optional(MessageID),
}).annotate({ identifier: "CompactionPart" })
export type CompactionPart = Types.DeepMutable<Schema.Schema.Type<typeof CompactionPart>>

export const SubtaskPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal("subtask"),
  prompt: Schema.String,
  description: Schema.String,
  agent: Schema.String,
  model: Schema.optional(
    Schema.Struct({
      providerID: ProviderID,
      modelID: ModelID,
    }),
  ),
  command: Schema.optional(Schema.String),
}).annotate({ identifier: "SubtaskPart" })
export type SubtaskPart = Types.DeepMutable<Schema.Schema.Type<typeof SubtaskPart>>

export const RetryPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal("retry"),
  attempt: NonNegativeInt,
  error: APIError.EffectSchema,
  time: Schema.Struct({
    created: NonNegativeInt,
  }),
}).annotate({ identifier: "RetryPart" })
export type RetryPart = Omit<Types.DeepMutable<Schema.Schema.Type<typeof RetryPart>>, "error"> & {
  error: APIError
}

export const StepStartPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal("step-start"),
  snapshot: Schema.optional(Schema.String),
}).annotate({ identifier: "StepStartPart" })
export type StepStartPart = Types.DeepMutable<Schema.Schema.Type<typeof StepStartPart>>

export const StepFinishPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal("step-finish"),
  reason: Schema.String,
  snapshot: Schema.optional(Schema.String),
  cost: Schema.Finite,
  tokens: Schema.Struct({
    total: Schema.optional(Schema.Finite),
    input: Schema.Finite,
    output: Schema.Finite,
    reasoning: Schema.Finite,
    cache: Schema.Struct({
      read: Schema.Finite,
      write: Schema.Finite,
    }),
  }),
}).annotate({ identifier: "StepFinishPart" })
export type StepFinishPart = Types.DeepMutable<Schema.Schema.Type<typeof StepFinishPart>>

export const ToolStatePending = Schema.Struct({
  status: Schema.Literal("pending"),
  input: Schema.Record(Schema.String, Schema.Any),
  raw: Schema.String,
}).annotate({ identifier: "ToolStatePending" })
export type ToolStatePending = Types.DeepMutable<Schema.Schema.Type<typeof ToolStatePending>>

export const ToolStateRunning = Schema.Struct({
  status: Schema.Literal("running"),
  input: Schema.Record(Schema.String, Schema.Any),
  title: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
  time: Schema.Struct({
    start: NonNegativeInt,
  }),
}).annotate({ identifier: "ToolStateRunning" })
export type ToolStateRunning = Types.DeepMutable<Schema.Schema.Type<typeof ToolStateRunning>>

export const ToolStateCompleted = Schema.Struct({
  status: Schema.Literal("completed"),
  input: Schema.Record(Schema.String, Schema.Any),
  output: Schema.String,
  title: Schema.String,
  metadata: Schema.Record(Schema.String, Schema.Any),
  time: Schema.Struct({
    start: NonNegativeInt,
    end: NonNegativeInt,
    compacted: Schema.optional(NonNegativeInt),
  }),
  attachments: Schema.optional(Schema.Array(FilePart)),
}).annotate({ identifier: "ToolStateCompleted" })
export type ToolStateCompleted = Types.DeepMutable<Schema.Schema.Type<typeof ToolStateCompleted>>

function truncateToolOutput(text: string, maxChars?: number) {
  if (!maxChars || text.length <= maxChars) return text
  const omitted = text.length - maxChars
  return `${text.slice(0, maxChars)}\n[Tool output truncated for compaction: omitted ${omitted} chars]`
}

export const ToolStateError = Schema.Struct({
  status: Schema.Literal("error"),
  input: Schema.Record(Schema.String, Schema.Any),
  error: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
  time: Schema.Struct({
    start: NonNegativeInt,
    end: NonNegativeInt,
  }),
}).annotate({ identifier: "ToolStateError" })
export type ToolStateError = Types.DeepMutable<Schema.Schema.Type<typeof ToolStateError>>

export const ToolState = Schema.Union([
  ToolStatePending,
  ToolStateRunning,
  ToolStateCompleted,
  ToolStateError,
]).annotate({
  discriminator: "status",
  identifier: "ToolState",
})
export type ToolState = ToolStatePending | ToolStateRunning | ToolStateCompleted | ToolStateError

export const ToolPart = Schema.Struct({
  ...partBase,
  type: Schema.Literal("tool"),
  callID: Schema.String,
  tool: Schema.String,
  state: ToolState,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
}).annotate({ identifier: "ToolPart" })
export type ToolPart = Omit<Types.DeepMutable<Schema.Schema.Type<typeof ToolPart>>, "state"> & {
  state: ToolState
}

const messageBase = {
  id: MessageID,
  sessionID: SessionID,
}

export const UserEnvironment = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("local"),
  }),
  Schema.Struct({
    kind: Schema.Literal("ssh"),
    targetName: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("scnet"),
    name: Schema.optional(Schema.String),
  }),
]).annotate({ identifier: "UserMessageEnvironment" })
export type UserEnvironment = Types.DeepMutable<Schema.Schema.Type<typeof UserEnvironment>>

export const User = Schema.Struct({
  ...messageBase,
  role: Schema.Literal("user"),
  time: Schema.Struct({
    created: NonNegativeInt,
  }),
  format: Schema.optional(Format),
  summary: Schema.optional(
    Schema.Struct({
      title: Schema.optional(Schema.String),
      body: Schema.optional(Schema.String),
      diffs: Schema.Array(Snapshot.FileDiff),
    }),
  ),
  agent: Schema.String,
  model: Schema.Struct({
    providerID: ProviderID,
    modelID: ModelID,
    variant: Schema.optional(Schema.String),
  }),
  system: Schema.optional(Schema.String),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
  environment: Schema.optional(UserEnvironment),
}).annotate({ identifier: "UserMessage" })
export type User = Types.DeepMutable<Schema.Schema.Type<typeof User>>

export const Part = Schema.Union([
  TextPart,
  SubtaskPart,
  ReasoningPart,
  FilePart,
  ToolPart,
  StepStartPart,
  StepFinishPart,
  SnapshotPart,
  PatchPart,
  AgentPart,
  RetryPart,
  CompactionPart,
]).annotate({ discriminator: "type", identifier: "Part" })
export type Part =
  | TextPart
  | SubtaskPart
  | ReasoningPart
  | FilePart
  | ToolPart
  | StepStartPart
  | StepFinishPart
  | SnapshotPart
  | PatchPart
  | AgentPart
  | RetryPart
  | CompactionPart

const AssistantErrorSchema = Schema.Union([
  ...MessageError.Shared,
  AbortedError.EffectSchema,
  StructuredOutputError.EffectSchema,
  ContextOverflowError.EffectSchema,
  APIError.EffectSchema,
]).annotate({ discriminator: "name" })
type AssistantError = Schema.Schema.Type<typeof AssistantErrorSchema>

// ── Prompt input schemas ─────────────────────────────────────────────────────
//
// Consumers of `SessionPrompt.PromptInput.parts` send part drafts without the
// ambient IDs (`messageID`, `sessionID`) that live on stored parts, and may
// omit `id` to let the server allocate one.  These Schema-Struct variants
// carry that shape so prompt decoding can accept drafts without stored IDs.

export const TextPartInput = Schema.Struct({
  id: Schema.optional(PartID),
  type: Schema.Literal("text"),
  text: Schema.String,
  synthetic: Schema.optional(Schema.Boolean),
  ignored: Schema.optional(Schema.Boolean),
  time: Schema.optional(
    Schema.Struct({
      start: NonNegativeInt,
      end: Schema.optional(NonNegativeInt),
    }),
  ),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
}).annotate({ identifier: "TextPartInput" })
export type TextPartInput = Types.DeepMutable<Schema.Schema.Type<typeof TextPartInput>>

export const FilePartInput = Schema.Struct({
  id: Schema.optional(PartID),
  type: Schema.Literal("file"),
  mime: Schema.String,
  filename: Schema.optional(Schema.String),
  url: Schema.String,
  source: Schema.optional(FilePartSource),
}).annotate({ identifier: "FilePartInput" })
export type FilePartInput = Types.DeepMutable<Schema.Schema.Type<typeof FilePartInput>>

export const AgentPartInput = Schema.Struct({
  id: Schema.optional(PartID),
  type: Schema.Literal("agent"),
  name: Schema.String,
  source: Schema.optional(
    Schema.Struct({
      value: Schema.String,
      start: NonNegativeInt,
      end: NonNegativeInt,
    }),
  ),
}).annotate({ identifier: "AgentPartInput" })
export type AgentPartInput = Types.DeepMutable<Schema.Schema.Type<typeof AgentPartInput>>

export const SubtaskPartInput = Schema.Struct({
  id: Schema.optional(PartID),
  type: Schema.Literal("subtask"),
  prompt: Schema.String,
  description: Schema.String,
  agent: Schema.String,
  model: Schema.optional(
    Schema.Struct({
      providerID: ProviderID,
      modelID: ModelID,
    }),
  ),
  command: Schema.optional(Schema.String),
}).annotate({ identifier: "SubtaskPartInput" })
export type SubtaskPartInput = Types.DeepMutable<Schema.Schema.Type<typeof SubtaskPartInput>>

export const Assistant = Schema.Struct({
  ...messageBase,
  role: Schema.Literal("assistant"),
  time: Schema.Struct({
    created: NonNegativeInt,
    completed: Schema.optional(NonNegativeInt),
  }),
  error: Schema.optional(AssistantErrorSchema),
  parentID: MessageID,
  modelID: ModelID,
  providerID: ProviderID,
  /**
   * @deprecated
   */
  mode: Schema.String,
  agent: Schema.String,
  path: Schema.Struct({
    cwd: Schema.String,
    root: Schema.String,
  }),
  summary: Schema.optional(Schema.Boolean),
  cost: Schema.Finite,
  tokens: Schema.Struct({
    total: Schema.optional(Schema.Finite),
    input: Schema.Finite,
    output: Schema.Finite,
    reasoning: Schema.Finite,
    cache: Schema.Struct({
      read: Schema.Finite,
      write: Schema.Finite,
    }),
  }),
  structured: Schema.optional(Schema.Any),
  variant: Schema.optional(Schema.String),
  finish: Schema.optional(Schema.String),
}).annotate({ identifier: "AssistantMessage" })
export type Assistant = Omit<Types.DeepMutable<Schema.Schema.Type<typeof Assistant>>, "error"> & {
  error?: AssistantError
}

export const Info = Schema.Union([User, Assistant]).annotate({ discriminator: "role", identifier: "Message" })
export type Info = User | Assistant

const UpdatedEventSchema = Schema.Struct({
  sessionID: SessionID,
  info: Info,
})

const RemovedEventSchema = Schema.Struct({
  sessionID: SessionID,
  messageID: MessageID,
})

const PartUpdatedEventSchema = Schema.Struct({
  sessionID: SessionID,
  part: Part,
  time: NonNegativeInt,
})

const PartRemovedEventSchema = Schema.Struct({
  sessionID: SessionID,
  messageID: MessageID,
  partID: PartID,
})

export const Event = {
  Updated: SyncEvent.define({
    type: "message.updated",
    version: 1,
    aggregate: "sessionID",
    schema: UpdatedEventSchema,
  }),
  Removed: SyncEvent.define({
    type: "message.removed",
    version: 1,
    aggregate: "sessionID",
    schema: RemovedEventSchema,
  }),
  PartUpdated: SyncEvent.define({
    type: "message.part.updated",
    version: 1,
    aggregate: "sessionID",
    schema: PartUpdatedEventSchema,
  }),
  PartDelta: BusEvent.define(
    "message.part.delta",
    Schema.Struct({
      sessionID: SessionID,
      messageID: MessageID,
      partID: PartID,
      field: Schema.String,
      delta: Schema.String,
    }),
  ),
  PartRemoved: SyncEvent.define({
    type: "message.part.removed",
    version: 1,
    aggregate: "sessionID",
    schema: PartRemovedEventSchema,
  }),
}

export const WithParts = Schema.Struct({
  info: Info,
  parts: Schema.Array(Part),
})
export type WithParts = {
  info: Info
  parts: Part[]
}

const Cursor = Schema.Struct({
  id: MessageID,
  time: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
})
type Cursor = typeof Cursor.Type

const decodeCursor = Schema.decodeUnknownSync(Cursor)

export const cursor = {
  encode(input: Cursor) {
    return Buffer.from(JSON.stringify(input)).toString("base64url")
  },
  decode(input: string) {
    return decodeCursor(JSON.parse(Buffer.from(input, "base64url").toString("utf8")))
  },
}

const info = (row: typeof MessageTable.$inferSelect) =>
  ({
    ...row.data,
    id: row.id,
    sessionID: row.session_id,
  }) as Info

const part = (row: typeof PartTable.$inferSelect) =>
  ({
    ...row.data,
    id: row.id,
    sessionID: row.session_id,
    messageID: row.message_id,
  }) as Part

const older = (row: Cursor) =>
  or(lt(MessageTable.time_created, row.time), and(eq(MessageTable.time_created, row.time), lt(MessageTable.id, row.id)))

/**
 * Part JSON larger than this is never materialized into the JS heap for UI reads.
 * SQLite still may touch the column for length(), but the GB string does not cross into V8.
 */
const MAX_CLIENT_PART_JSON_CHARS = 256 * 1024

function stubDataUrl(url: string, mime?: string) {
  const media = mime || url.slice(5, url.indexOf(";")) || "application/octet-stream"
  return `data:${media};base64,`
}

function unescapeJsonString(value: string) {
  try {
    return JSON.parse(`"${value}"`) as string
  } catch {
    return value
  }
}

const HISTORY_TOOL_INPUT_KEYS = ["command", "description", "filePath", "path", "pattern", "query", "url"] as const
const HISTORY_TOOL_OMITTED_ERROR = "Details omitted from history"

function extractJsonStringField(head: string, key: string, max = 400) {
  const match = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`).exec(head)
  if (!match?.[1]) return
  return unescapeJsonString(match[1]).slice(0, max)
}

/** Pull identity fields from a truncated tool-part JSON head (history stubs). */
export function extractHistoryToolInput(head: string): Record<string, string> {
  const extracted: Record<string, string> = {}
  for (const key of HISTORY_TOOL_INPUT_KEYS) {
    const value = extractJsonStringField(head, key)
    if (value) extracted[key] = value
  }
  return extracted
}

function stubHistoryToolPart(input: {
  id: PartID
  messageID: MessageID
  sessionID: SessionID
  size: number
  head: string
}): Part {
  const tool = /"tool"\s*:\s*"([^"]+)"/.exec(input.head)?.[1] ?? "unknown"
  const callID = /"callID"\s*:\s*"([^"]+)"/.exec(input.head)?.[1] ?? "omitted"
  const extractedInput = extractHistoryToolInput(input.head)
  const status = /"status"\s*:\s*"(pending|running|completed|error)"/.exec(input.head)?.[1] ?? "completed"
  if (status === "error") {
    return {
      id: input.id,
      sessionID: input.sessionID,
      messageID: input.messageID,
      type: "tool",
      callID,
      tool,
      state: {
        status: "error",
        input: extractedInput,
        error: extractJsonStringField(input.head, "error") ?? HISTORY_TOOL_OMITTED_ERROR,
        time: { start: 0, end: 0 },
      },
    }
  }
  if (status === "pending") {
    return {
      id: input.id,
      sessionID: input.sessionID,
      messageID: input.messageID,
      type: "tool",
      callID,
      tool,
      state: {
        status: "pending",
        input: extractedInput,
        raw: "",
      },
    }
  }
  if (status === "running") {
    return {
      id: input.id,
      sessionID: input.sessionID,
      messageID: input.messageID,
      type: "tool",
      callID,
      tool,
      state: {
        status: "running",
        input: extractedInput,
        time: { start: 0 },
      },
    }
  }
  return {
    id: input.id,
    sessionID: input.sessionID,
    messageID: input.messageID,
    type: "tool",
    callID,
    tool,
    state: {
      status: "completed",
      input: extractedInput,
      output: "",
      title: tool === "bash" ? "Shell" : extractedInput.filePath || extractedInput.path || tool,
      metadata: { _historyThumbnail: true, omittedBytes: input.size },
      time: { start: 0, end: 0 },
    },
  }
}

const MAX_STUB_TEXT_PREFIX_CHARS = 800

/**
 * `head` is a truncated JSON document, so a full JSON.parse is impossible. Pull
 * the leading characters of the `text` field out of it instead, tolerating the
 * value being cut off mid-string (and even mid-escape) at the head boundary.
 */
function extractTruncatedTextPrefix(head: string) {
  const match = /"text"\s*:\s*"((?:\\.|[^"\\])*)/.exec(head)
  if (!match) return ""
  const raw = match[1].replace(/\\(?:u[0-9a-fA-F]{0,3})?$/, "")
  const text = unescapeJsonString(raw)
  if (text.length > MAX_STUB_TEXT_PREFIX_CHARS) {
    return text.slice(0, MAX_STUB_TEXT_PREFIX_CHARS) + "…"
  }
  return text
}

function stubOversizedPart(input: {
  id: PartID
  messageID: MessageID
  sessionID: SessionID
  size: number
  head: string
}): Part {
  const type = /"type"\s*:\s*"([^"]+)"/.exec(input.head)?.[1]
  const note = `[…content truncated, ${input.size} bytes total]`

  if (type === "file") {
    const mime = /"mime"\s*:\s*"([^"]+)"/.exec(input.head)?.[1] ?? "application/octet-stream"
    const filename = /"filename"\s*:\s*"([^"]+)"/.exec(input.head)?.[1] ?? "omitted"
    return {
      id: input.id,
      sessionID: input.sessionID,
      messageID: input.messageID,
      type: "file",
      mime,
      filename,
      url: stubDataUrl(`data:${mime};base64,`, mime),
    }
  }

  if (type === "tool") {
    return stubHistoryToolPart(input)
  }

  if (type === "reasoning") {
    const prefix = extractTruncatedTextPrefix(input.head)
    return {
      id: input.id,
      sessionID: input.sessionID,
      messageID: input.messageID,
      type: "reasoning",
      text: prefix ? `${prefix}\n\n${note}` : note,
      time: { start: 0 },
    }
  }

  const prefix = extractTruncatedTextPrefix(input.head)
  return {
    id: input.id,
    sessionID: input.sessionID,
    messageID: input.messageID,
    type: "text",
    text: prefix ? `${prefix}\n\n${note}` : note,
    synthetic: true,
  }
}

function loadPartsForClient(messageIDs: MessageID[], opts?: { forHistory?: boolean }) {
  if (messageIDs.length === 0) return new Map<string, Part[]>()

  const forHistory = !!opts?.forHistory

  const partByMessage = new Map<string, Part[]>()
  const meta = Database.use((db) =>
    db
      .select({
        id: PartTable.id,
        message_id: PartTable.message_id,
        session_id: PartTable.session_id,
        size: sql<number>`length(${PartTable.data})`.mapWith(Number),
        head: forHistory
          ? sql<string>`substr(${PartTable.data}, 1, 2048)`
          : sql<string>`substr(${PartTable.data}, 1, 256)`,
      })
      .from(PartTable)
      .where(inArray(PartTable.message_id, messageIDs))
      .orderBy(PartTable.message_id, PartTable.id)
      .all(),
  )

  const smallIDs: PartID[] = []
  for (const row of meta) {
    const type = /"type"\s*:\s*"([^"]+)"/.exec(row.head ?? "")?.[1]
    // History pagination: never SELECT full tool JSON — stub from the column head only.
    // Text/reasoning (preset case reports) ship in full so the session UI is not
    // an empty synthetic stub or a "[…content truncated]" note.
    if (forHistory && type === "tool") continue
    if (row.size <= MAX_CLIENT_PART_JSON_CHARS) smallIDs.push(row.id)
  }

  const smallByID = new Map<string, Part>()
  if (smallIDs.length > 0) {
    const smallRows = Database.use((db) => db.select().from(PartTable).where(inArray(PartTable.id, smallIDs)).all())
    for (const row of smallRows) smallByID.set(row.id, part(row))
  }

  for (const row of meta) {
    const type = /"type"\s*:\s*"([^"]+)"/.exec(row.head ?? "")?.[1]
    const next =
      forHistory && type === "tool"
        ? stubHistoryToolPart({
            id: row.id,
            messageID: row.message_id,
            sessionID: row.session_id,
            size: row.size,
            head: row.head ?? "",
          })
        : row.size > MAX_CLIENT_PART_JSON_CHARS
          ? stubOversizedPart({
              id: row.id,
              messageID: row.message_id,
              sessionID: row.session_id,
              size: row.size,
              head: row.head ?? "",
            })
          : (smallByID.get(row.id) ??
            stubOversizedPart({
              id: row.id,
              messageID: row.message_id,
              sessionID: row.session_id,
              size: row.size,
              head: row.head ?? "",
            }))
    const list = partByMessage.get(row.message_id)
    if (list) list.push(next)
    else partByMessage.set(row.message_id, [next])
  }
  return partByMessage
}

function hydrate(rows: (typeof MessageTable.$inferSelect)[], opts?: { forClient?: boolean; forHistory?: boolean }) {
  const ids = rows.map((row) => row.id)
  if (ids.length === 0) {
    return rows.map((row) => ({
      info: info(row),
      parts: [] as Part[],
    }))
  }

  if (opts?.forClient) {
    const partByMessage = loadPartsForClient(ids, { forHistory: opts.forHistory })
    return rows.map((row) => ({
      info: info(row),
      parts: partByMessage.get(row.id) ?? [],
    }))
  }

  const partByMessage = new Map<string, Part[]>()
  const partRows = Database.use((db) =>
    db
      .select()
      .from(PartTable)
      .where(inArray(PartTable.message_id, ids))
      .orderBy(PartTable.message_id, PartTable.id)
      .all(),
  )
  for (const row of partRows) {
    const next = part(row)
    const list = partByMessage.get(row.message_id)
    if (list) list.push(next)
    else partByMessage.set(row.message_id, [next])
  }

  return rows.map((row) => ({
    info: info(row),
    parts: partByMessage.get(row.id) ?? [],
  }))
}

/** Cap inline payloads returned to the web UI so session open cannot hang on GB-scale attachments. */
const MAX_CLIENT_DATA_URL_CHARS = 256 * 1024
/**
 * Keep tool/text payloads bounded for the browser. Shell DOM is deferred until
 * expand, so this can be moderately larger than the emergency 1.2KB cap.
 */
const MAX_CLIENT_TOOL_OUTPUT_CHARS = 4_000
/** Long one-line conda/python commands thrash layout in the collapsed Shell subtitle. */
const MAX_CLIENT_TOOL_INPUT_CHARS = 400
const TOOL_INPUT_SUBTITLE_KEYS = ["command", "description", "filePath", "path", "pattern", "query", "url"] as const
const TOOL_INPUT_BODY_KEYS = ["content", "oldString", "newString"] as const
const TOOL_INPUT_KEEP_KEYS = [...TOOL_INPUT_SUBTITLE_KEYS, ...TOOL_INPUT_BODY_KEYS, "files"] as const
const TOOL_METADATA_KEEP_KEYS = ["filepath", "file", "exists", "filediff"] as const
const LEADING_TOOL_PATH = /^\s*\{\s*"(filePath|path)"\s*:\s*"((?:\\.|[^"\\])*)"/

function truncateText(text: string, max: number) {
  if (text.length <= max) return text
  const omitted = text.length - max
  return `${text.slice(0, max)}\n\n[Truncated for session UI: omitted ${omitted} chars]`
}

function truncateField(value: unknown, max: number): { value: unknown; changed: boolean } {
  if (typeof value !== "string" || value.length <= max) return { value, changed: false }
  return { value: truncateText(value, max), changed: true }
}

function truncateToolInput(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input
  const next: Record<string, unknown> = { ...(input as Record<string, unknown>) }
  let changed = false
  for (const key of TOOL_INPUT_SUBTITLE_KEYS) {
    const result = truncateField(next[key], MAX_CLIENT_TOOL_INPUT_CHARS)
    if (!result.changed) continue
    next[key] = result.value
    changed = true
  }
  for (const key of TOOL_INPUT_BODY_KEYS) {
    const result = truncateField(next[key], MAX_CLIENT_TOOL_OUTPUT_CHARS)
    if (!result.changed) continue
    next[key] = result.value
    changed = true
  }
  return changed ? next : input
}

/**
 * Bound tool input for the browser without dropping identity fields.
 * Replacing the whole object with `{ _truncated, preview }` hid Write/Edit paths
 * because `content` is serialized first and the 4KB preview never reached `filePath`.
 */
function compactToolInput(input: unknown): unknown {
  const fieldTruncated = truncateToolInput(input)
  if (!fieldTruncated || typeof fieldTruncated !== "object" || Array.isArray(fieldTruncated)) return fieldTruncated
  const json = JSON.stringify(fieldTruncated)
  if (json.length <= MAX_CLIENT_TOOL_OUTPUT_CHARS) return fieldTruncated

  const source = fieldTruncated as Record<string, unknown>
  const kept: Record<string, unknown> = {}
  for (const key of TOOL_INPUT_KEEP_KEYS) {
    if (key in source) kept[key] = source[key]
  }
  return Object.keys(kept).length > 0 ? kept : fieldTruncated
}

function compactToolMetadata(metadata: unknown): unknown {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return metadata
  const raw = JSON.stringify(metadata)
  if (raw.length <= MAX_CLIENT_TOOL_OUTPUT_CHARS) return metadata

  const source = metadata as Record<string, unknown>
  const kept: Record<string, unknown> = { _truncated: true, omittedChars: raw.length }
  for (const key of TOOL_METADATA_KEEP_KEYS) {
    if (!(key in source)) continue
    if (key === "filediff" && JSON.stringify(source.filediff).length > MAX_CLIENT_TOOL_OUTPUT_CHARS) continue
    kept[key] = source[key]
  }
  return kept
}

/** Pull filePath/path from streaming tool JSON once the leading key is complete. */
export function extractLeadingToolPath(raw: string): { key: "filePath" | "path"; value: string } | undefined {
  const match = LEADING_TOOL_PATH.exec(raw)
  if (!match) return
  const key = match[1] === "path" ? "path" : "filePath"
  try {
    return { key, value: JSON.parse(`"${match[2]}"`) }
  } catch {
    return { key, value: match[2] }
  }
}

/** Strip / truncate oversized part payloads before sending messages to the browser. */
export function sanitizePartForClient(input: Part): Part {
  if (input.type === "file" && typeof input.url === "string" && input.url.length > MAX_CLIENT_DATA_URL_CHARS) {
    return {
      ...input,
      url: input.url.startsWith("data:")
        ? stubDataUrl(input.url, input.mime)
        : `${input.url.slice(0, 128)}…[truncated ${input.url.length} chars]`,
    }
  }

  if (input.type === "tool") {
    const state = input.state
    const compactedInput = state.input ? compactToolInput(state.input) : state.input
    const truncatedInput = compactedInput !== state.input ? compactedInput : undefined

    if (state.status !== "completed") {
      if (!truncatedInput) return input
      return {
        ...input,
        state: {
          ...state,
          input: truncatedInput,
        },
      }
    }

    let next = truncatedInput ? { ...state, input: truncatedInput } : state
    let changed = !!truncatedInput

    if (typeof state.output === "string" && state.output.length > MAX_CLIENT_TOOL_OUTPUT_CHARS) {
      next = {
        ...next,
        output: truncateText(state.output, MAX_CLIENT_TOOL_OUTPUT_CHARS),
      }
      changed = true
    }

    if (state.metadata && typeof state.metadata === "object") {
      const compacted = compactToolMetadata(state.metadata)
      if (compacted !== state.metadata) {
        next = {
          ...next,
          metadata: compacted as typeof state.metadata,
        }
        changed = true
      }
    }

    if (Array.isArray(state.attachments) && state.attachments.length > 0) {
      let attachmentsChanged = false
      const attachments = state.attachments.map((attachment) => {
        if (typeof attachment.url !== "string" || attachment.url.length <= MAX_CLIENT_DATA_URL_CHARS) {
          return attachment
        }
        attachmentsChanged = true
        return {
          ...attachment,
          url: attachment.url.startsWith("data:")
            ? stubDataUrl(attachment.url, attachment.mime)
            : `${attachment.url.slice(0, 128)}…[truncated]`,
        }
      })
      if (attachmentsChanged) {
        next = {
          ...next,
          attachments,
        }
        changed = true
      }
    }

    if (changed) {
      return {
        ...input,
        state: next,
      }
    }
  }

  return input
}

export function sanitizeForClient(items: WithParts[]): WithParts[] {
  return items.map((item) => ({
    info: item.info,
    parts: item.parts.map(sanitizePartForClient),
  }))
}

/**
 * History list /「加载更早」payloads. Drop completed tool dumps entirely so a
 * multi-page drain cannot ship ~10MB of Shell output through JSON.parse.
 * Assistant text/reasoning is kept in full so preset cases render for users.
 * Expand uses session.message + sanitizeForClient to hydrate one message.
 */
export function sanitizePartForHistory(input: Part): Part {
  const base = sanitizePartForClient(input)
  if (base.type === "tool") {
    const state = base.state
    if (state.status !== "completed") return base
    const inputFields = truncateToolInput(state.input)
    return {
      ...base,
      state: {
        ...state,
        input: inputFields as typeof state.input,
        output: "",
        metadata: { _historyThumbnail: true },
        attachments: undefined,
      },
    }
  }
  return base
}

export function sanitizeForHistory(items: WithParts[]): WithParts[] {
  return items.map((item) => ({
    info: item.info,
    parts: item.parts.map(sanitizePartForHistory),
  }))
}

function providerMeta(metadata: Record<string, any> | undefined) {
  if (!metadata) return undefined
  const { providerExecuted: _, ...rest } = metadata
  return Object.keys(rest).length > 0 ? rest : undefined
}

export const toModelMessagesEffect = Effect.fnUntraced(function* (
  input: WithParts[],
  model: Provider.Model,
  options?: { stripMedia?: boolean; toolOutputMaxChars?: number },
) {
  const result: UIMessage[] = []
  const toolNames = new Set<string>()
  // Track media from tool results that need to be injected as user messages
  // for providers that don't support that media type in tool results.
  //
  // OpenAI-compatible APIs only support string content in tool results, so we need
  // to extract media and inject as user messages. Some SDKs only support a subset
  // of media in tool results; e.g. Bedrock supports images but not PDFs there.
  //
  // Only apply this workaround if the model actually supports that media input -
  // otherwise unsupportedParts() will turn it into a user-visible error.
  const supportsMediaInToolResult = (attachment: { mime: string }) => {
    if (model.api.npm === "@ai-sdk/anthropic") return true
    if (model.api.npm === "@ai-sdk/openai") return true
    if (model.api.npm === "@ai-sdk/amazon-bedrock") return attachment.mime.startsWith("image/")
    if (model.api.npm === "@ai-sdk/google-vertex/anthropic") return true
    if (model.api.npm === "@ai-sdk/google") {
      const id = model.api.id.toLowerCase()
      return id.includes("gemini-3") && !id.includes("gemini-2")
    }
    return false
  }

  const toModelOutput = (options: { toolCallId: string; input: unknown; output: unknown }) => {
    const output = options.output
    if (typeof output === "string") {
      return { type: "text", value: output }
    }

    if (typeof output === "object") {
      const outputObject = output as {
        text: string
        attachments?: Array<{ mime: string; url: string }>
      }
      const attachments = (outputObject.attachments ?? []).filter((attachment) => {
        return attachment.url.startsWith("data:") && attachment.url.includes(",")
      })

      return {
        type: "content",
        value: [
          ...(outputObject.text ? [{ type: "text", text: outputObject.text }] : []),
          ...attachments.map((attachment) => ({
            type: "media",
            mediaType: attachment.mime,
            data: iife(() => {
              const commaIndex = attachment.url.indexOf(",")
              return commaIndex === -1 ? attachment.url : attachment.url.slice(commaIndex + 1)
            }),
          })),
        ],
      }
    }

    return { type: "json", value: output as never }
  }

  for (const msg of input) {
    if (msg.parts.length === 0) continue

    if (msg.info.role === "user") {
      const userMessage: UIMessage = {
        id: msg.info.id,
        role: "user",
        parts: [],
      }
      for (const part of msg.parts) {
        // User message parts should never be empty
        if (part.type === "text" && !part.ignored && part.text !== "")
          userMessage.parts.push({
            type: "text",
            text: part.text,
          })
        // text/plain and directory files are converted into text parts, ignore them
        if (part.type === "file" && part.mime !== "text/plain" && part.mime !== "application/x-directory") {
          // Providers reject local file:// URLs (only http/https/data). Keep a text stub.
          if (options?.stripMedia && isMedia(part.mime)) {
            userMessage.parts.push({
              type: "text",
              text: `[Attached ${part.mime}: ${part.filename ?? "file"}]`,
            })
          } else if (part.url.startsWith("file:")) {
            userMessage.parts.push({
              type: "text",
              text: `[Attached ${part.mime}: ${part.filename ?? "file"}]`,
            })
          } else {
            userMessage.parts.push({
              type: "file",
              url: part.url,
              mediaType: part.mime,
              filename: part.filename,
            })
          }
        }

        if (part.type === "compaction") {
          userMessage.parts.push({
            type: "text",
            text: "What did we do so far?",
          })
        }
        if (part.type === "subtask") {
          userMessage.parts.push({
            type: "text",
            text: "The following tool was executed by the user",
          })
        }
      }
      if (userMessage.parts.length > 0) result.push(userMessage)
    }

    if (msg.info.role === "assistant") {
      const differentModel = `${model.providerID}/${model.id}` !== `${msg.info.providerID}/${msg.info.modelID}`
      const media: Array<{ mime: string; url: string; filename?: string }> = []

      if (
        msg.info.error &&
        !(
          AbortedError.isInstance(msg.info.error) &&
          msg.parts.some((part) => part.type !== "step-start" && part.type !== "reasoning")
        )
      ) {
        continue
      }
      const assistantMessage: UIMessage = {
        id: msg.info.id,
        role: "assistant",
        parts: [],
      }
      // Anthropic adaptive thinking can persist assistant turns like:
      // step-start, reasoning(signature), text(""), step-start,
      // reasoning(signature). The empty text part is a structural separator,
      // but it does not carry the signature metadata itself. Dropping it shifts
      // signed thinking positions after step-start splitting/provider regrouping;
      // keeping it as "" is filtered by the AI SDK and rejected by Anthropic.
      // It is unclear whether this shape originates in our stream processing,
      // a proxy, or a lower-level library, but preserving a non-empty separator
      // here is the only safe replay point we have.
      // Use a single space so the separator survives replay without changing
      // the neighboring signed reasoning blocks.
      const hasSignedReasoning = msg.parts.some((part) => {
        if (part.type !== "reasoning") return false
        return part.metadata?.anthropic?.signature != null
      })
      for (const part of msg.parts) {
        if (part.type === "text") {
          const text = part.text === "" && hasSignedReasoning ? " " : part.text
          assistantMessage.parts.push({
            type: "text",
            text,
            ...(differentModel ? {} : { providerMetadata: part.metadata }),
          })
        }
        if (part.type === "step-start")
          assistantMessage.parts.push({
            type: "step-start",
          })
        if (part.type === "tool") {
          toolNames.add(part.tool)
          if (part.state.status === "completed") {
            const outputText = part.state.time.compacted
              ? "[Old tool result content cleared]"
              : truncateToolOutput(part.state.output, options?.toolOutputMaxChars)
            const attachments = part.state.time.compacted || options?.stripMedia ? [] : (part.state.attachments ?? [])

            // For providers that don't support media in tool results, extract media files
            // (images, PDFs) to be sent as a separate user message
            const mediaAttachments = attachments.filter((a) => isMedia(a.mime))
            const extractedMedia = mediaAttachments.filter((a) => !supportsMediaInToolResult(a))
            if (extractedMedia.length > 0) {
              media.push(...extractedMedia)
            }
            const finalAttachments = attachments.filter((a) => !isMedia(a.mime) || supportsMediaInToolResult(a))

            const output =
              finalAttachments.length > 0
                ? {
                    text: outputText,
                    attachments: finalAttachments,
                  }
                : outputText

            assistantMessage.parts.push({
              type: ("tool-" + part.tool) as `tool-${string}`,
              state: "output-available",
              toolCallId: part.callID,
              input: part.state.input,
              output,
              ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
              ...(differentModel ? {} : { callProviderMetadata: providerMeta(part.metadata) }),
            })
          }
          if (part.state.status === "error") {
            const output = part.state.metadata?.interrupted === true ? part.state.metadata.output : undefined
            if (typeof output === "string") {
              assistantMessage.parts.push({
                type: ("tool-" + part.tool) as `tool-${string}`,
                state: "output-available",
                toolCallId: part.callID,
                input: part.state.input,
                output,
                ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
                ...(differentModel ? {} : { callProviderMetadata: providerMeta(part.metadata) }),
              })
            } else {
              assistantMessage.parts.push({
                type: ("tool-" + part.tool) as `tool-${string}`,
                state: "output-error",
                toolCallId: part.callID,
                input: part.state.input,
                errorText: part.state.error,
                ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
                ...(differentModel ? {} : { callProviderMetadata: providerMeta(part.metadata) }),
              })
            }
          }
          // Handle pending/running tool calls to prevent dangling tool_use blocks
          // Anthropic/Claude APIs require every tool_use to have a corresponding tool_result
          if (part.state.status === "pending" || part.state.status === "running")
            assistantMessage.parts.push({
              type: ("tool-" + part.tool) as `tool-${string}`,
              state: "output-error",
              toolCallId: part.callID,
              input: part.state.input,
              errorText: "[Tool execution was interrupted]",
              ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
              ...(differentModel ? {} : { callProviderMetadata: providerMeta(part.metadata) }),
            })
        }
        if (part.type === "reasoning") {
          if (differentModel) {
            if (part.text.trim().length > 0)
              assistantMessage.parts.push({
                type: "text",
                text: part.text,
              })
            continue
          }
          assistantMessage.parts.push({
            type: "reasoning",
            text: part.text,
            providerMetadata: part.metadata,
          })
        }
      }
      if (assistantMessage.parts.length > 0) {
        result.push(assistantMessage)
        // Inject pending media as a user message for providers that don't support
        // media (images, PDFs) in tool results
        if (media.length > 0) {
          result.push({
            id: MessageID.ascending(),
            role: "user",
            parts: [
              {
                type: "text" as const,
                text: SYNTHETIC_ATTACHMENT_PROMPT,
              },
              ...media.map((attachment) => ({
                type: "file" as const,
                url: attachment.url,
                mediaType: attachment.mime,
                filename: attachment.filename,
              })),
            ],
          })
        }
      }
    }
  }

  const tools = Object.fromEntries(Array.from(toolNames).map((toolName) => [toolName, { toModelOutput }]))

  return yield* Effect.promise(() =>
    convertToModelMessages(
      result.filter((msg) => msg.parts.some((part) => part.type !== "step-start")),
      {
        //@ts-expect-error (convertToModelMessages expects a ToolSet but only actually needs tools[name]?.toModelOutput)
        tools,
      },
    ),
  )
})

export function toModelMessages(
  input: WithParts[],
  model: Provider.Model,
  options?: { stripMedia?: boolean; toolOutputMaxChars?: number },
): Promise<ModelMessage[]> {
  return Effect.runPromise(toModelMessagesEffect(input, model, options).pipe(Effect.provide(EffectLogger.layer)))
}

export const page = Effect.fn("MessageV2.page")(function* (input: {
  sessionID: SessionID
  limit: number
  before?: string
  /** When true, oversized part JSON is stubbed in SQL and never loaded into the JS heap. */
  forClient?: boolean
  /** History list / load-earlier: never SELECT full tool part JSON from SQLite. */
  forHistory?: boolean
}) {
  const before = input.before ? cursor.decode(input.before) : undefined
  const where = before
    ? and(eq(MessageTable.session_id, input.sessionID), older(before))
    : eq(MessageTable.session_id, input.sessionID)
  const rows = Database.use((db) =>
    db
      .select()
      .from(MessageTable)
      .where(where)
      .orderBy(desc(MessageTable.time_created), desc(MessageTable.id))
      .limit(input.limit + 1)
      .all(),
  )
  if (rows.length === 0) {
    const row = Database.use((db) =>
      db.select({ id: SessionTable.id }).from(SessionTable).where(eq(SessionTable.id, input.sessionID)).get(),
    )
    if (!row) return yield* new NotFoundError({ message: `Session not found: ${input.sessionID}` })
    return {
      items: [] as WithParts[],
      more: false,
    }
  }

  const more = rows.length > input.limit
  const slice = more ? rows.slice(0, input.limit) : rows
  const items = hydrate(slice, { forClient: input.forClient, forHistory: input.forHistory })
  items.reverse()
  const tail = slice.at(-1)
  return {
    items,
    more,
    cursor: more && tail ? cursor.encode({ id: tail.id, time: tail.time_created }) : undefined,
  }
})

export function* stream(sessionID: SessionID) {
  const size = 50
  let before: string | undefined
  while (true) {
    const next = Effect.runSync(
      page({ sessionID, limit: size, before }).pipe(
        Effect.catchIf(NotFoundError.isInstance, () =>
          Effect.succeed({ items: [] as WithParts[], more: false, cursor: undefined }),
        ),
      ),
    )
    if (next.items.length === 0) break
    for (let i = next.items.length - 1; i >= 0; i--) {
      yield next.items[i]
    }
    if (!next.more || !next.cursor) break
    before = next.cursor
  }
}

export function parts(message_id: MessageID, opts?: { forClient?: boolean }) {
  if (opts?.forClient) {
    return loadPartsForClient([message_id]).get(message_id) ?? []
  }
  const rows = Database.use((db) =>
    db.select().from(PartTable).where(eq(PartTable.message_id, message_id)).orderBy(PartTable.id).all(),
  )
  return rows.map(
    (row) =>
      ({
        ...row.data,
        id: row.id,
        sessionID: row.session_id,
        messageID: row.message_id,
      }) as Part,
  )
}

export const get = Effect.fn("MessageV2.get")(function* (input: {
  sessionID: SessionID
  messageID: MessageID
  forClient?: boolean
}) {
  const row = Database.use((db) =>
    db
      .select()
      .from(MessageTable)
      .where(and(eq(MessageTable.id, input.messageID), eq(MessageTable.session_id, input.sessionID)))
      .get(),
  )
  if (!row) return yield* new NotFoundError({ message: `Message not found: ${input.messageID}` })
  return {
    info: info(row),
    parts: parts(input.messageID, { forClient: input.forClient }),
  }
})

export function filterCompacted(msgs: Iterable<WithParts>) {
  const result = [] as WithParts[]
  const completed = new Set<string>()
  let retain: MessageID | undefined
  for (const msg of msgs) {
    result.push(msg)
    if (retain) {
      if (msg.info.id === retain) break
      continue
    }
    if (msg.info.role === "user" && completed.has(msg.info.id)) {
      const part = msg.parts.find((item): item is CompactionPart => item.type === "compaction")
      if (!part) continue
      if (!part.tail_start_id) break
      retain = part.tail_start_id
      if (msg.info.id === retain) break
      continue
    }
    if (msg.info.role === "user" && completed.has(msg.info.id) && msg.parts.some((part) => part.type === "compaction"))
      break
    if (msg.info.role === "assistant" && msg.info.summary && msg.info.finish && !msg.info.error)
      completed.add(msg.info.parentID)
  }
  result.reverse()
  const compactionIndex = result.findLastIndex(
    (msg) =>
      msg.info.role === "user" &&
      msg.parts.some((item): item is CompactionPart => item.type === "compaction" && item.tail_start_id !== undefined),
  )
  const compaction = result[compactionIndex]
  const part = compaction?.parts.find(
    (item): item is CompactionPart => item.type === "compaction" && item.tail_start_id !== undefined,
  )
  const summaryIndex = compaction
    ? result.findIndex(
        (msg, index) =>
          index > compactionIndex &&
          msg.info.role === "assistant" &&
          msg.info.summary &&
          msg.info.parentID === compaction.info.id,
      )
    : -1
  const tailIndex = part?.tail_start_id ? result.findIndex((msg) => msg.info.id === part.tail_start_id) : -1
  if (tailIndex >= 0 && tailIndex < compactionIndex && summaryIndex > compactionIndex) {
    return [
      ...result.slice(compactionIndex, summaryIndex + 1),
      ...result.slice(tailIndex, compactionIndex),
      ...result.slice(summaryIndex + 1),
    ]
  }
  return result
}

export const filterCompactedEffect = Effect.fnUntraced(function* (sessionID: SessionID) {
  return filterCompacted(stream(sessionID))
})

function isAbortLikeError(e: unknown): e is Error {
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")
}

export function fromError(
  e: unknown,
  ctx: { providerID: ProviderID; aborted?: boolean },
): NonNullable<Assistant["error"]> {
  switch (true) {
    case isAbortLikeError(e) && ctx.aborted === true:
      return new AbortedError(
        { message: e.message },
        {
          cause: e,
        },
      ).toObject()
    case isAbortLikeError(e):
      return new APIError(
        {
          message: e.name === "TimeoutError" ? "Model request timed out" : "Provider connection was interrupted",
          isRetryable: true,
          metadata: {
            code: e.name,
            message: e.message,
          },
        },
        { cause: e },
      ).toObject()
    case e instanceof Error && e.message === "SSE read timed out":
      return new APIError(
        {
          message: "Model stream stalled",
          isRetryable: true,
          metadata: {
            code: "SSETimeout",
            message: e.message,
          },
        },
        { cause: e },
      ).toObject()
    case OutputLengthError.isInstance(e):
      return e
    case LoadAPIKeyError.isInstance(e):
      return new AuthError(
        {
          providerID: ctx.providerID,
          message: e.message,
        },
        { cause: e },
      ).toObject()
    case (e as SystemError)?.code === "ECONNRESET":
      return new APIError(
        {
          message: "Connection reset by server",
          isRetryable: true,
          metadata: {
            code: (e as SystemError).code ?? "",
            syscall: (e as SystemError).syscall ?? "",
            message: (e as SystemError).message ?? "",
          },
        },
        { cause: e },
      ).toObject()
    case e instanceof Error && (e as FetchDecompressionError).code === "ZlibError":
      if (ctx.aborted) {
        return new AbortedError({ message: e.message }, { cause: e }).toObject()
      }
      return new APIError(
        {
          message: "Response decompression failed",
          isRetryable: true,
          metadata: {
            code: (e as FetchDecompressionError).code,
            message: e.message,
          },
        },
        { cause: e },
      ).toObject()
    case APICallError.isInstance(e):
      const parsed = ProviderError.parseAPICallError({
        providerID: ctx.providerID,
        error: e,
      })
      if (parsed.type === "context_overflow") {
        return new ContextOverflowError(
          {
            message: parsed.message,
            responseBody: parsed.responseBody,
          },
          { cause: e },
        ).toObject()
      }

      return new APIError(
        {
          message: parsed.message,
          statusCode: parsed.statusCode,
          isRetryable: parsed.isRetryable,
          responseHeaders: parsed.responseHeaders,
          responseBody: parsed.responseBody,
          metadata: parsed.metadata,
        },
        { cause: e },
      ).toObject()
    case e instanceof Error: {
      const text = errorMessage(e)
      if (ProviderError.isOverflowMessage(text)) {
        return new ContextOverflowError({ message: text }, { cause: e }).toObject()
      }
      return new NamedError.Unknown({ message: text }, { cause: e }).toObject()
    }
    default:
      try {
        const parsed = ProviderError.parseStreamError(e)
        if (parsed) {
          if (parsed.type === "context_overflow") {
            return new ContextOverflowError(
              {
                message: parsed.message,
                responseBody: parsed.responseBody,
              },
              { cause: e },
            ).toObject()
          }
          return new APIError(
            {
              message: parsed.message,
              isRetryable: parsed.isRetryable,
              responseBody: parsed.responseBody,
            },
            {
              cause: e,
            },
          ).toObject()
        }
      } catch {}
      return new NamedError.Unknown({ message: JSON.stringify(e) }, { cause: e }).toObject()
  }
}

export * as MessageV2 from "./message-v2"
