import type { Provider, ProviderListResponse } from "@opencode-ai/sdk/v2/client"

const EMPTY: ProviderListResponse = { all: [], connected: [], default: {} }

function mergeModels(local: Provider["models"], global: Provider["models"]): Provider["models"] {
  const merged = { ...global, ...local }
  // Keep richer global display names when the local catalog only has id-as-name stubs
  // (common for onescience presets like glm-5.2 → "OneScience GLM").
  for (const [id, fromGlobal] of Object.entries(global ?? {})) {
    const current = merged[id]
    if (!current || !fromGlobal) continue
    const localName = current.name?.trim()
    const globalName = fromGlobal.name?.trim()
    if (!globalName || globalName === id) continue
    if (!localName || localName === id) {
      merged[id] = { ...current, name: globalName }
    }
  }
  return merged
}

/** Merge directory provider list with globally connected providers (custom presets live globally). */
export function mergeProviderLists(
  local: ProviderListResponse | undefined | null,
  global: ProviderListResponse | undefined | null,
): ProviderListResponse {
  const base = local ?? EMPTY
  const overlay = global ?? EMPTY
  const byId = new Map(base.all.map((provider) => [provider.id, provider]))

  for (const id of overlay.connected) {
    const fromGlobal = overlay.all.find((provider) => provider.id === id)
    if (!fromGlobal) continue
    const existing = byId.get(id)
    if (!existing) {
      byId.set(id, fromGlobal)
      continue
    }
    // Prefer the globally connected identity (source/options/key/name). Local catalog
    // stubs often keep source:"custom" and empty options, which mislabels official providers.
    byId.set(id, {
      ...existing,
      ...fromGlobal,
      name: fromGlobal.name || existing.name,
      options: { ...existing.options, ...fromGlobal.options },
      models: mergeModels(existing.models, fromGlobal.models),
    })
  }

  return {
    all: [...byId.values()],
    connected: [...new Set([...base.connected, ...overlay.connected])],
    default: { ...overlay.default, ...base.default },
  }
}

/** Whether directory results are missing any globally connected provider. */
export function shouldMergeGlobalProviders(
  local: ProviderListResponse | undefined | null,
  global: ProviderListResponse | undefined | null,
): boolean {
  const base = local ?? EMPTY
  const overlay = global ?? EMPTY
  if (base.all.length === 0 && overlay.all.length > 0) return true
  return overlay.connected.some((id) => !base.connected.includes(id))
}
