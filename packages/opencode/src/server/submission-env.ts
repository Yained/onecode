// Replaced only by the server build; source runs have no embedded credential.
declare const ONECODE_BUILTIN_OPENALEX_API_KEY: string

export function configureSubmissionEnvironment(env = process.env) {
  // An explicitly empty runtime value disables OpenAlex, including in installers.
  if (env.OPENALEX_API_KEY !== undefined) return
  const key = typeof ONECODE_BUILTIN_OPENALEX_API_KEY === "string" ? ONECODE_BUILTIN_OPENALEX_API_KEY.trim() : ""
  if (key) env.OPENALEX_API_KEY = key
}
