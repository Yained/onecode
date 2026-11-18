import { eq } from "drizzle-orm"
import { Database } from "@/storage/db"
import { GlobalBus } from "@/bus/global"
import { WorkspaceTable } from "@/control-plane/workspace.sql"
import { parseSshNodeExtra, SSH_NODE_TYPE } from "@/control-plane/adapters/ssh-node-path"
import { parseProjectExecution } from "./execution"
import { ProjectTable } from "./project.sql"
import { Event, fromRow, type Info } from "./project"
import { collectSshTargetUsage, type SshTargetProjectUsage } from "@/config/ssh-target-usage"

export function listSshTargetUsage(sshTarget: string): SshTargetProjectUsage[] {
  return Database.use((db) =>
    collectSshTargetUsage({
      sshTarget,
      projects: db.select().from(ProjectTable).all(),
      workspaces: db.select().from(WorkspaceTable).all(),
      parseExecution: parseProjectExecution,
      parseWorkspace: parseSshNodeExtra,
      workspaceType: SSH_NODE_TYPE,
    }),
  )
}

export function connectedSshTargetProjects(sshTarget: string) {
  return listSshTargetUsage(sshTarget).filter((item) => item.connected)
}

export function renameProjectSshTarget(from: string, to: string): Info[] {
  const source = from.trim()
  const target = to.trim()
  if (!source || !target || source === target) return []
  return Database.use((db) => {
    const updated: Info[] = []
    for (const row of db.select().from(ProjectTable).all()) {
      const execution = parseProjectExecution(row.execution)
      if (execution?.kind !== "ssh" || execution.sshTarget !== source) continue
      const next = {
        kind: "ssh" as const,
        sshTarget: target,
        ...(execution.remotePath ? { remotePath: execution.remotePath } : {}),
      }
      const result = db
        .update(ProjectTable)
        .set({ execution: next, time_updated: Date.now() })
        .where(eq(ProjectTable.id, row.id))
        .returning()
        .get()
      if (!result) continue
      const info = fromRow(result)
      GlobalBus.emit("event", {
        directory: "global",
        project: info.id,
        payload: { type: Event.Updated.type, properties: info },
      })
      updated.push(info)
    }
    return updated
  })
}
