import { useGlobalSync } from "@/context/global-sync"
import { mergeProviderLists } from "@/context/global-sync/provider-merge"
import { decode64 } from "@/utils/base64"
import { useRouteParams } from "@/hooks/use-route-params"
import { defaultPlatformProjectDirectory, isSharedCasesPath, storedPlatformAuthSession } from "@/utils/platform-auth"
import { createMemo } from "solid-js"

export const popularProviders = [
  "onescience",
  "opencode",
  "opencode-go",
  "anthropic",
  "github-copilot",
  "openai",
  "google",
  "openrouter",
  "vercel",
]
const popularProviderSet = new Set(popularProviders)

export function useProviders() {
  const globalSync = useGlobalSync()
  const params = useRouteParams()
  const dir = createMemo(() => decode64(params.dir) ?? "")

  const providers = () => {
    const global = globalSync.data.provider
    if (!dir()) return mainWorkspaceProviders()
    // Shared cases are read-only chat — provider/model settings always belong to the account.
    // Do not merge the shared-root instance list (often empty / not bootstrapped).
    if (isSharedCasesPath(storedPlatformAuthSession(), dir())) return mainWorkspaceProviders()
    // Do not bootstrap here — Layout calls useProviders on every page, and instance
    // /provider (multi-MB) would saturate HTTP/1.1 before sidebar /global/session.
    const [projectStore] = globalSync.child(dir(), { bootstrap: false })
    if (!projectStore.provider_ready) return mainWorkspaceProviders()
    return mergeProviderLists(projectStore.provider, global)
  }

  // When the global provider list is empty (e.g. main workspace instance not yet
  // bootstrapped on OneHub / shared-case pages), fall back to the main workspace
  // instance providers so settings still shows connected providers/models.
  const mainWorkspaceProviders = () => {
    const global = globalSync.data.provider
    if (global.all.length > 0) return global
    const mainRoot = defaultPlatformProjectDirectory(storedPlatformAuthSession())
    if (!mainRoot) return global
    // bootstrap: false — do not trigger instance bootstrap just to warm /provider.
    // Settings / model picker call ensureProviders() when the user configures models.
    const [mainStore] = globalSync.child(mainRoot, { bootstrap: false })
    if (!mainStore.provider_ready) return global
    return mainStore.provider
  }

  const disabled = () => new Set(globalSync.data.config.disabled_providers ?? [])

  return {
    all: () => providers().all,
    default: () => providers().default,
    popular: () => providers().all.filter((p) => popularProviderSet.has(p.id)),
    connected: () => {
      const connected = new Set(providers().connected)
      const hide = disabled()
      return providers().all.filter((p) => connected.has(p.id) && !hide.has(p.id))
    },
    paid: () => {
      const connected = new Set(providers().connected)
      const hide = disabled()
      return providers().all.filter(
        (p) =>
          connected.has(p.id) &&
          !hide.has(p.id) &&
          (p.id !== "opencode" || Object.values(p.models).some((m) => m.cost?.input)),
      )
    },
  }
}
