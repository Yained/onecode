/** Platform-auth "workspace" ids are tenant roots, not experimental ssh-node workspace ids. */

export function extraAccountId(extra: unknown): string | undefined {
  if (!extra || typeof extra !== "object") return
  const value = (extra as Record<string, unknown>).accountId
  if (typeof value !== "string" || !value.trim()) return
  return value.trim()
}

export function canAccessRemoteWorkspace(input: {
  sessionAccountId?: string
  platformWorkspaceIds?: readonly string[]
  workspaceId: string
  extraAccountId?: string
  localDirectoryAllowed?: boolean
}): boolean {
  if (!input.sessionAccountId) return true
  if (input.platformWorkspaceIds?.includes(input.workspaceId)) return true
  if (input.extraAccountId) return input.extraAccountId === input.sessionAccountId
  return input.localDirectoryAllowed === true
}
