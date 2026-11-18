/** Built-in OneScience preset IDs — never show these raw IDs in the UI. */
export const ONESCIENCE_PROVIDER_ID = "onescience"
export const ONESCIENCE_PROVIDER_NAME = "OneScience"
export const ONESCIENCE_GLM_MODEL_ID = "glm-5.2"
export const ONESCIENCE_GPT_MODEL_ID = "gpt-5.6-luna"

const MODEL_DISPLAY_NAMES: Record<string, string> = {
  [ONESCIENCE_GPT_MODEL_ID]: "OneScience GPT",
  [ONESCIENCE_GLM_MODEL_ID]: "OneScience GLM",
}

export function onescienceProviderDisplayName(providerID: string, catalogName?: string) {
  const name = catalogName?.trim()
  if (name && name !== providerID) return name
  if (providerID === ONESCIENCE_PROVIDER_ID) return ONESCIENCE_PROVIDER_NAME
  return name || providerID
}

/** Prefer the catalog label, but never fall back to gpt-5.6-luna / glm-5.2. */
export function onescienceModelDisplayName(input: {
  providerID?: string
  modelID?: string
  catalogName?: string
}) {
  const modelID = input.modelID?.trim() ?? ""
  const catalogName = input.catalogName?.trim()
  if (catalogName && catalogName !== modelID) return catalogName
  if (!modelID) return catalogName ?? ""
  const mapped = MODEL_DISPLAY_NAMES[modelID]
  if (mapped && (!input.providerID || input.providerID === ONESCIENCE_PROVIDER_ID)) return mapped
  return catalogName || modelID
}
