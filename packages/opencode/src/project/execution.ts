import { inArray, eq } from "drizzle-orm"
import { Database } from "@/storage/db"
import { ProjectTable } from "./project.sql"
import { ProjectID } from "./schema"

export type ProjectExecution =
  | { kind: "local" }
  | { kind: "ssh"; sshTarget: string; remotePath?: string }

export function parseProjectExecution(raw: unknown): ProjectExecution | undefined {
  const record = asRecord(raw)
  if (!record) return undefined
  if (record.kind === "local") return { kind: "local" }
  if (record.kind !== "ssh") return undefined
  const sshTarget =
    (typeof record.sshTarget === "string" && record.sshTarget.trim()) ||
    (typeof record.targetName === "string" && record.targetName.trim()) ||
    ""
  if (!sshTarget) return undefined
  const remotePath = typeof record.remotePath === "string" && record.remotePath.trim() ? record.remotePath.trim() : undefined
  return { kind: "ssh", sshTarget, ...(remotePath ? { remotePath } : {}) }
}

export function projectExecutionEquals(left: ProjectExecution, right: ProjectExecution) {
  if (left.kind === "local" && right.kind === "local") return true
  if (left.kind !== "ssh" || right.kind !== "ssh") return false
  return left.sshTarget === right.sshTarget && (left.remotePath ?? "") === (right.remotePath ?? "")
}

export const LOCAL_ONLY_PROJECT_NAME = "default"

export function isLocalOnlyProjectWorktree(worktree: string | undefined) {
  if (!worktree?.trim()) return false
  const leaf = worktree
    .replace(/[\\/]+$/, "")
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .at(-1)
  return leaf === LOCAL_ONLY_PROJECT_NAME
}

/** SSH and explicit local bindings are immutable. Missing rows may be written once.
 * Auto-default `.onecode/workspaces/...` may be upgraded once a custom remotePath arrives.
 */
export function nextProjectExecution(
  current: ProjectExecution | undefined,
  incoming: ProjectExecution,
  worktree?: string,
): ProjectExecution | undefined {
  if (worktree && isLocalOnlyProjectWorktree(worktree)) return { kind: "local" }
  if (!current) return incoming
  if (current.kind === "local") return incoming.kind === "local" ? current : undefined
  if (incoming.kind !== "ssh" || incoming.sshTarget !== current.sshTarget) return undefined
  if (!current.remotePath && incoming.remotePath) {
    return { kind: "ssh", sshTarget: current.sshTarget, remotePath: incoming.remotePath }
  }
  if (
    current.remotePath &&
    incoming.remotePath &&
    isAutoDefaultRemotePath(current.remotePath) &&
    !isAutoDefaultRemotePath(incoming.remotePath)
  ) {
    return { kind: "ssh", sshTarget: current.sshTarget, remotePath: incoming.remotePath }
  }
  return current
}

function isAutoDefaultRemotePath(path: string | undefined) {
  if (!path?.trim()) return false
  return path.replaceAll("\\", "/").includes("/.onecode/workspaces/")
}

export function lookupProjectRow(input: { projectID?: string; directory?: string }) {
  return Database.use((db) => {
    const id = input.projectID?.trim()
    if (id) {
      const row = db.select().from(ProjectTable).where(eq(ProjectTable.id, ProjectID.make(id))).get()
      if (row) return row
    }
    const directory = input.directory?.trim()
    if (!directory) return undefined
    const values = directoryQueryValues(directory)
    return values.length === 1
      ? db.select().from(ProjectTable).where(eq(ProjectTable.worktree, values[0]!)).get()
      : db.select().from(ProjectTable).where(inArray(ProjectTable.worktree, values)).get()
  })
}

export function sameProjectWorktree(left: string | undefined, right: string | undefined) {
  if (!left?.trim() || !right?.trim()) return false
  const values = new Set(directoryQueryValues(left))
  return directoryQueryValues(right).some((value) => values.has(value))
}

function directoryQueryValues(directory: string) {
  const trimmed = directory.replace(/[\\/]+$/, "")
  const forward = trimmed.replaceAll("\\", "/")
  const backward = trimmed.replaceAll("/", "\\")
  return [...new Set([directory, trimmed, forward, backward].filter(Boolean))]
}

function asRecord(raw: unknown): Record<string, unknown> | undefined {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw !== "string") return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
  return undefined
}
