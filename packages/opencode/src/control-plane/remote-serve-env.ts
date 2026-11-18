type ApiKeyAuth = { type: "api"; key: string }
type RemoteSyncProvider = { env?: string[] }

/** Copy env-backed API keys into the auth snapshot so the SSH leaf can connect without local env vars. */
export function mergeCustomProviderEnvAuth<T extends object>(
  auth: Record<string, T>,
  providers: Record<string, RemoteSyncProvider> | undefined,
): Record<string, T | ApiKeyAuth> {
  if (!providers) return auth
  // Auth.Info (Api | Oauth | WellKnown) is a Schema.Class union and is not
  // assignable to Record<string, unknown> — keep the snapshot type generic.
  const next: Record<string, T | ApiKeyAuth> = { ...auth }
  for (const [id, provider] of Object.entries(providers)) {
    if (next[id]) continue
    for (const key of provider.env ?? []) {
      const trimmed = key.trim()
      if (!trimmed) continue
      const value = process.env[trimmed]?.trim()
      if (!value) continue
      next[id] = { type: "api", key: value }
      break
    }
  }
  return next
}
