function trim(value: string | undefined | null) {
  return (value ?? "").trim()
}

/** Show the OneScience provider when either GPT or GLM key can be resolved. */
export function isOnescienceProviderEnabled(input: { gptApiKey?: string; glmApiKey?: string }) {
  return Boolean(trim(input.gptApiKey) || trim(input.glmApiKey))
}

/**
 * First non-empty value wins. Source does not matter: admin override, runtime env, or CI bake.
 * Empty from every source means that model is hidden.
 */
export function resolvePresetSecret(input: {
  override?: string
  env?: string
  baked?: string
}) {
  return trim(input.override) || trim(input.env) || trim(input.baked)
}
