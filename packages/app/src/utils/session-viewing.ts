import { pathKey } from "@/utils/path-key"

export type SessionViewRef = {
  id: string
  parentID?: string
}

export function isViewingSession(input: {
  directory: string
  sessionID: string
  currentDirectory?: string
  currentSessionID?: string
  sessions?: readonly SessionViewRef[]
}) {
  const currentDirectory = input.currentDirectory
  const currentSessionID = input.currentSessionID
  if (!currentDirectory || !currentSessionID) return false
  if (pathKey(input.directory) !== pathKey(currentDirectory)) return false
  if (input.sessionID === currentSessionID) return true
  const session = input.sessions?.find((item) => item.id === input.sessionID)
  return session?.parentID === currentSessionID
}
