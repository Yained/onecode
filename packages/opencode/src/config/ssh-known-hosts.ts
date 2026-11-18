/** scnet login nodes may rotate host keys; always ignore known_hosts for managed SSH. */
export function sshKnownHostsNullFile(platform = process.platform) {
  return platform === "win32" ? "NUL" : "/dev/null"
}

export function sshKnownHostsIgnoreOptions(platform = process.platform) {
  return {
    StrictHostKeyChecking: "no",
    UserKnownHostsFile: sshKnownHostsNullFile(platform),
  } as const
}

export function isSshKnownHostsOptionKey(key: string) {
  return /^strictHostKeyChecking$/i.test(key) || /^userKnownHostsFile$/i.test(key)
}

export function appendSshKnownHostsIgnoreArgs(args: string[], platform = process.platform) {
  const options = sshKnownHostsIgnoreOptions(platform)
  // Keep warnings like "Permanently added ... known hosts" off the failure channel.
  args.push("-o", "LogLevel=ERROR")
  args.push("-o", `StrictHostKeyChecking=${options.StrictHostKeyChecking}`)
  args.push("-o", `UserKnownHostsFile=${options.UserKnownHostsFile}`)
  return args
}

/** OpenSSH still emits this on stderr even with StrictHostKeyChecking=no + /dev/null. */
export function isBenignSshKnownHostsLine(line: string) {
  const text = line.trim()
  if (!text) return true
  if (/^warning:\s*permanently added\b/i.test(text)) return true
  if (/\bknown[_ ]hosts\b/i.test(text) && /\bpermanently added\b/i.test(text)) return true
  return false
}

export function stripBenignSshStderr(stderr: string) {
  return stderr
    .split(/\r?\n/)
    .filter((line) => !isBenignSshKnownHostsLine(line))
    .join("\n")
    .trim()
}

export function isMostlyKnownHostsNoise(message: string) {
  const text = message.trim()
  if (!text) return false
  const leftover = stripBenignSshStderr(text)
  return leftover.length === 0 && /known[_ ]hosts|permanently added/i.test(text)
}
