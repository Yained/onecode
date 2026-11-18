import type { Config } from "@opencode-ai/sdk/v2/client"

export type SshAuthType = "key" | "password"

export type SshConfigForm = {
  name: string
  hostName: string
  username: string
  remotePath: string
  port: string
  keyPath: string
  authType: SshAuthType
  password: string
  options: string
}

/** Legacy `config` / `agent` entries are edited as key auth. */
export function visibleSshAuthType(type: string | undefined): SshAuthType {
  return type === "password" ? "password" : "key"
}

export function emptySshConfigForm(): SshConfigForm {
  return {
    name: "",
    hostName: "",
    username: "",
    remotePath: "",
    port: "",
    keyPath: "",
    authType: "key",
    password: "",
    options: "",
  }
}

export function parseOpenSshConfig(input: string): Partial<SshConfigForm> {
  const entries = input
    .split("\n")
    .map((line) => {
      const trimmed = line.trim()
      const uncommented = trimmed.startsWith("#") ? trimmed.slice(1).trim() : trimmed
      if (trimmed.startsWith("#") && !/^RemoteWorkDir\s+/i.test(uncommented)) return
      const match = uncommented.match(/^([A-Za-z][A-Za-z0-9]*)\s+(.+)$/)
      if (!match) return
      return [match[1].toLowerCase(), match[2].trim().replace(/^["']|["']$/g, "")] as const
    })
    .filter((entry): entry is readonly [string, string] => !!entry)

  const value = (key: string) => entries.find((entry) => entry[0] === key)?.[1]
  const hostName = value("hostname")
  const name = value("host") || hostName
  const identityFile = value("identityfile")
  const reserved = new Set(["host", "hostname", "port", "user", "identityfile", "remoteworkdir"])
  return {
    name,
    hostName,
    username: value("user"),
    remotePath: value("remoteworkdir"),
    port: value("port"),
    keyPath: identityFile,
    authType: identityFile ? "key" : undefined,
    options: entries
      .filter((entry) => !reserved.has(entry[0]))
      .map((entry) => `${entry[0]}=${entry[1]}`)
      .join("\n"),
  }
}

/** Classify an imported IdentityFile. Import always tries server ingest first; browserUpload is the fallback prompt. */
export function importedIdentityStrategy(keyPath: string): "empty" | "browserUpload" | "serverIngest" {
  const trimmed = keyPath.trim()
  if (!trimmed) return "empty"
  if (isServerUnreachableIdentityPath(trimmed)) return "browserUpload"
  return "serverIngest"
}

/** Paths that cannot be used by a remote OneCode server until the key is re-uploaded. */
export function isServerUnreachableIdentityPath(keyPath: string): boolean {
  const trimmed = keyPath.trim()
  if (!trimmed) return true
  // Windows drive / UNC paths from a local laptop
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) return true
  if (trimmed.startsWith("\\\\") || trimmed.startsWith("//")) return true
  return false
}

export type ImportedKeyIssue = "empty" | "needsUpload" | "notFound" | "serverMissing" | "localPathOnServer" | "unverified"

/** Decide how to treat an imported IdentityFile after (or before) a filesystem exists check. */
export function resolveImportedKeyIssue(input: {
  keyPath: string
  desktop: boolean
  exists?: boolean
  checkFailed?: boolean
}): ImportedKeyIssue | undefined {
  const trimmed = input.keyPath.trim()
  if (!trimmed) return "empty"

  // Remote Linux OneCode cannot read a Windows laptop path; require upload without probing.
  if (!input.desktop && isServerUnreachableIdentityPath(trimmed)) return "localPathOnServer"

  // No exists probe yet — caller should run /global/ssh/identity/check.
  if (input.exists === undefined && !input.checkFailed) return undefined

  if (input.checkFailed) return "unverified"
  if (input.exists === true) {
    // Desktop local absolute paths still need the managed upload before Test can run.
    if (input.desktop && isServerUnreachableIdentityPath(trimmed)) return "needsUpload"
    return undefined
  }
  if (input.exists === false) return input.desktop ? "notFound" : "serverMissing"
  return "unverified"
}

type SshConfigValue = NonNullable<Config["ssh"]>[string]
export type EditableSshConfig = Extract<SshConfigValue, { host: string }>

/** List rows can come from OpenSSH disk while product `config.ssh` is still a stub. */
export function isEditableSshConfig(value: unknown): value is EditableSshConfig {
  return !!value && typeof value === "object" && typeof (value as { host?: unknown }).host === "string" && !!(value as { host: string }).host.trim()
}

/** Product-only fields that OpenSSH config does not store. */
export function overlayProductSshExtras(base: EditableSshConfig, product: unknown): EditableSshConfig {
  if (!product || typeof product !== "object") return base
  const extra = product as Record<string, unknown>
  const auth = extra.auth
  const passwordAuth =
    auth && typeof auth === "object" && (auth as { type?: unknown }).type === "password"
      ? (auth as NonNullable<EditableSshConfig["auth"]>)
      : undefined
  return {
    ...base,
    ...(passwordAuth && !base.auth ? { auth: passwordAuth } : {}),
  }
}

export function resolveSshConfigForEdit(
  name: string,
  listed: unknown,
  disk?: Config["ssh"],
  product?: Config["ssh"],
): EditableSshConfig | undefined {
  const base = [listed, disk?.[name]].find(isEditableSshConfig)
  if (!base) return undefined
  return overlayProductSshExtras(base, product?.[name])
}

export function validateSshConfigForm(form: SshConfigForm): "required" | "portInvalid" | "passwordRequired" | "keyRequired" | undefined {
  if (!form.name.trim() || !form.hostName.trim() || !form.username.trim() || !form.port.trim()) return "required"
  const port = Number(form.port.trim())
  if (!Number.isInteger(port) || port < 1 || port > 65535) return "portInvalid"
  if (form.authType === "password" && !form.password.trim()) return "passwordRequired"
  if (form.authType === "key" && !form.keyPath.trim()) return "keyRequired"
  return undefined
}

export type SshFormFocusField = "name" | "hostName" | "username" | "port" | "password" | "keyPath"

/** First invalid field in form order, for scrolling/focus after Test or Save. */
export function firstInvalidSshFormField(form: SshConfigForm): SshFormFocusField | undefined {
  if (!form.name.trim()) return "name"
  if (!form.hostName.trim()) return "hostName"
  if (!form.username.trim()) return "username"
  const port = Number(form.port.trim())
  if (!form.port.trim() || !Number.isInteger(port) || port < 1 || port > 65535) return "port"
  if (form.authType === "password" && !form.password.trim()) return "password"
  if (form.authType === "key" && !form.keyPath.trim()) return "keyPath"
  return undefined
}

export function parseSshOptions(input: string) {
  return Object.fromEntries(
    input
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const index = line.search(/[\s=]/)
        if (index === -1) return [line, ""] as const
        return [
          line.slice(0, index).trim(),
          line
            .slice(index + 1)
            .replace(/^=\s*/, "")
            .trim(),
        ] as const
      })
      .filter((entry) => entry[0]),
  )
}

export function buildSshConfigEntry(form: SshConfigForm) {
  const port = Number(form.port.trim())
  const options = parseSshOptions(form.options)
  const hostName = form.hostName.trim()
  return {
    name: form.name.trim(),
    value: {
      host: hostName,
      hostName: hostName || undefined,
      port: Number.isFinite(port) && port > 0 ? port : undefined,
      username: form.username.trim() || undefined,
      remotePath: form.remotePath.trim() || "",
      options: Object.keys(options).length ? options : undefined,
      auth:
        form.authType === "password"
          ? { type: "password" as const, password: form.password }
          : { type: "key" as const, keyPath: form.keyPath.trim() || undefined },
    },
  } satisfies { name: string; value: NonNullable<Config["ssh"]>[string] }
}
