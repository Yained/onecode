import { pathKey } from "@/utils/path-key"

const activeByDirectory = new Map<string, string>()

export function setActiveSession(directory: string, sessionID: string | undefined) {
  const key = pathKey(directory)
  if (!sessionID) {
    activeByDirectory.delete(key)
    return
  }
  activeByDirectory.set(key, sessionID)
}

export function getActiveSession(directory: string) {
  return activeByDirectory.get(pathKey(directory))
}

export function preserveSessionIds(directory: string) {
  const sessionID = getActiveSession(directory)
  return sessionID ? [sessionID] : undefined
}
