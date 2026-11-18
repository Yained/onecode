/** Mirrors server ssh-known-hosts ignore — keep in sync with opencode config helper. */
export function sshKnownHostsIgnoreOptions() {
  return {
    StrictHostKeyChecking: "no",
    UserKnownHostsFile: "/dev/null",
  } as const
}

export function isSshKnownHostsOptionKey(key: string) {
  return /^strictHostKeyChecking$/i.test(key) || /^userKnownHostsFile$/i.test(key)
}

export function applySshKnownHostsIgnore(
  options: Record<string, string> | undefined,
): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(options ?? {})) {
    if (isSshKnownHostsOptionKey(key)) continue
    next[key] = value
  }
  return { ...next, ...sshKnownHostsIgnoreOptions() }
}

export function isMostlyKnownHostsNoise(message: string | undefined) {
  if (!message?.trim()) return false
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return false
  const leftover = lines.filter((line) => {
    if (/^warning:\s*permanently added\b/i.test(line)) return false
    if (/\bknown[_ ]hosts\b/i.test(line) && /\bpermanently added\b/i.test(line)) return false
    return true
  })
  return leftover.length === 0 && /known[_ ]hosts|permanently added/i.test(message)
}

/** Remote rejected the offered private key (not a known_hosts problem). */
export function isPublicKeyAuthFailure(message: string | undefined) {
  if (!message?.trim()) return false
  return /permission denied \(publickey/i.test(message) || /permission denied \(.*,?publickey/i.test(message)
}
