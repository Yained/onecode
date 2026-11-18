import type { Session } from "@opencode-ai/sdk/v2/client"
import { pathKey } from "@/utils/path-key"

const PREFIX = "opencode.sidebar-sessions.v1:"
const MAX = 8

export function readSidebarSessionSnapshot(directory: string): Session[] {
  if (typeof localStorage === "undefined") return []
  const raw = localStorage.getItem(PREFIX + pathKey(directory))
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is Session => !!item && typeof item === "object" && typeof (item as Session).id === "string",
    )
  } catch {
    return []
  }
}

export function writeSidebarSessionSnapshot(directory: string, sessions: Session[]) {
  if (typeof localStorage === "undefined") return
  const roots = sessions
    .filter((session) => !!session?.id && !session.parentID && !session.time?.archived)
    .slice(0, MAX)
  try {
    localStorage.setItem(PREFIX + pathKey(directory), JSON.stringify(roots))
  } catch {
    // ignore quota / private mode
  }
}
