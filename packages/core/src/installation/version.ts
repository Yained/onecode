declare global {
  const OPENCODE_VERSION: string
  const OPENCODE_CHANNEL: string
  const OPENCODE_DISABLE_AUTOUPDATE: string
}

export const InstallationVersion = typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local"
export const InstallationChannel = typeof OPENCODE_CHANNEL === "string" ? OPENCODE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
export const InstallationDisableAutoupdate =
  typeof OPENCODE_DISABLE_AUTOUPDATE === "string" && OPENCODE_DISABLE_AUTOUPDATE === "true"
