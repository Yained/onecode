export function syncWorkspaceFiles(input: {
  refreshTree: () => void
  refreshVcs?: () => void
  refreshSessionDiff?: () => void
}) {
  input.refreshTree()
  input.refreshVcs?.()
  input.refreshSessionDiff?.()
}
