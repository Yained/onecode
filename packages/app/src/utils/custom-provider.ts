/** Detect tenant custom / openai-compatible relays (align with server isTenantCustomProvider). */

import { iconNames } from "@opencode-ai/ui/icons/provider"

type ProviderConfigLike = {
  npm?: string
  name?: string
  models?: Record<string, unknown>
  options?: { baseURL?: string } | Record<string, unknown>
}

type ProviderItemLike = {
  id: string
  source?: string
  models?: Record<string, unknown>
  options?: { baseURL?: string } | Record<string, unknown>
}

const ONESCIENCE_ID = "onescience"
const OPENAI_COMPATIBLE = "@ai-sdk/openai-compatible"

/** Official / branded provider ids that custom relays must not claim. */
const RESERVED_PROVIDER_IDS = new Set<string>(iconNames.filter((id) => id !== "synthetic"))

function baseURLOf(provider: ProviderConfigLike | undefined) {
  const options = provider?.options
  if (!options || typeof options !== "object") return ""
  const value = "baseURL" in options ? options.baseURL : undefined
  return typeof value === "string" ? value.trim() : ""
}

/** True when this id belongs to a models.dev / branded builtin provider. */
export function isReservedProviderID(providerID: string) {
  return RESERVED_PROVIDER_IDS.has(providerID)
}

export function reservedProviderIDs() {
  return new Set(RESERVED_PROVIDER_IDS)
}

/** True when config.provider[id] looks like a user-defined custom relay. */
export function isTenantCustomProviderConfig(providerID: string, provider: ProviderConfigLike | undefined) {
  if (!provider || providerID === ONESCIENCE_ID) return false
  if (provider.npm === OPENAI_COMPATIBLE) return true
  const models = provider.models
  if (!models || Object.keys(models).length === 0) return false
  return baseURLOf(provider).length > 0
}

export function isPublicProviderID(providerID: string, publicProviders?: string[]) {
  return Boolean(publicProviders?.includes(providerID))
}

/**
 * Editable / hard-deletable custom provider.
 * Prefer config shape; fall back to runtime shape when the client config store is stale.
 * Do NOT use source alone — models.dev catalog stubs use source "custom", and
 * config merges mark official providers as source "config".
 * Reserved branded ids (e.g. deepseek whale) are always official — never custom-edit.
 * Shared public providers from opencode.json are read-only.
 */
export function isEditableCustomProvider(
  providerID: string,
  configProvider: ProviderConfigLike | undefined,
  item?: ProviderItemLike,
  publicProviders?: string[],
) {
  if (providerID === ONESCIENCE_ID) return false
  if (isPublicProviderID(providerID, publicProviders)) return false
  if (isReservedProviderID(providerID)) return false
  if (isTenantCustomProviderConfig(providerID, configProvider)) return true
  if (!item) return false
  return isTenantCustomProviderConfig(providerID, {
    models: item.models,
    options: item.options,
  })
}

/** Icon id for settings list — official branded ids keep their icon; other customs use synthetic. */
export function providerListIconID(providerID: string, custom: boolean) {
  if (isReservedProviderID(providerID)) return providerID
  if (custom) return "synthetic"
  return providerID
}
