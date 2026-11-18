// Register on the platform, not inside the disposable submission iframe.
export function watchSubmissionWorkspace(account: () => string | undefined) {
  const host = window as Window & {
    __onescienceSubmissionCleanup?: boolean
    __onescienceSubmissionWorkspaceV1?: Map<string | undefined, { dispose: () => void }>
  }
  if (host.__onescienceSubmissionCleanup) return
  host.__onescienceSubmissionCleanup = true
  const clear = (all = false) => {
    const bank = host.__onescienceSubmissionWorkspaceV1
    if (!bank) return
    for (const [id, store] of bank) {
      if (!all && id === account()) continue
      store.dispose()
      bank.delete(id)
    }
  }
  host.addEventListener("onescience:platform-auth-logging-out", () => clear(true))
  host.addEventListener("onescience:platform-auth-session-updated", () => clear())
  host.addEventListener("onescience:platform-workspace-cache-cleared", () => clear(true))
  host.addEventListener("storage", () => clear())
}
