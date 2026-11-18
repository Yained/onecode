import { ConfigSSH } from "@/config/ssh"
import { isSshKnownHostsOptionKey, sshKnownHostsIgnoreOptions } from "@/config/ssh-known-hosts"
import { Global } from "@opencode-ai/core/global"
import fs from "fs/promises"
import os from "os"
import path from "path"

export type OpenSshConfigWriteInput = {
  name: string
  previousName?: string
  config: ConfigSSH.Info
  /** Platform account id — scopes OpenSSH config under platform-ssh/{accountId}/. */
  accountId?: string
}

function sanitizeAccountId(accountId: string) {
  return accountId.replace(/[^a-zA-Z0-9._-]+/g, "_")
}

/** Per-account SSH home (config + identities) when platform auth is in use. */
export function platformSshHome(accountId: string) {
  return path.join(Global.Path.data, "platform-ssh", sanitizeAccountId(accountId))
}

export function openSshConfigPath(accountId?: string) {
  if (accountId) return path.join(platformSshHome(accountId), "config")
  return path.join(os.homedir(), ".ssh", "config")
}

export function sshIdentityDir(accountId?: string) {
  if (accountId) return path.join(platformSshHome(accountId), "identities")
  return path.join(Global.Path.data, "ssh-identities")
}

/** Dirs that OneCode may write identity files into (account-scoped plus legacy shared). */
export function managedSshIdentityDirs(accountId?: string) {
  const current = sshIdentityDir(accountId)
  if (!accountId) return [current]
  const legacy = sshIdentityDir()
  return current === legacy ? [current] : [current, legacy]
}

export function openSshManagedBlock(input: OpenSshConfigWriteInput) {
  const knownHosts = sshKnownHostsIgnoreOptions()
  const userOptions = Object.entries(input.config.options ?? {}).filter(([key]) => !isSshKnownHostsOptionKey(key))
  return [
    `# >>> opencode ssh ${input.name}`,
    `Host ${input.config.host}`,
    ...(input.config.hostName ? [`  HostName ${input.config.hostName}`] : []),
    ...(input.config.username ? [`  User ${input.config.username}`] : []),
    ...(input.config.port ? [`  Port ${input.config.port}`] : []),
    ...(input.config.auth?.type === "key" && input.config.auth.keyPath ? [`  IdentityFile ${input.config.auth.keyPath}`] : []),
    ...userOptions.map(([key, value]) => `  ${key} ${value}`),
    `  StrictHostKeyChecking ${knownHosts.StrictHostKeyChecking}`,
    `  UserKnownHostsFile ${knownHosts.UserKnownHostsFile}`,
    ...(input.config.remotePath?.trim() ? [`  # RemoteWorkDir ${input.config.remotePath.trim()}`] : []),
    `# <<< opencode ssh ${input.name}`,
    "",
  ].join("\n")
}

export function updateOpenSshConfigText(current: string, input: OpenSshConfigWriteInput) {
  const withoutPrevious = removeManagedBlock(current, input.previousName && input.previousName !== input.name ? input.previousName : undefined)
  const withoutCurrent = removeManagedBlock(withoutPrevious, input.name)
  const kept = stripLeadingBlankLines(withoutCurrent).trimEnd()
  return `${kept}${kept ? "\n\n" : ""}${openSshManagedBlock(input)}`
}

export async function writeOpenSshConfig(input: OpenSshConfigWriteInput) {
  const file = openSshConfigPath(input.accountId)
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const current = await readOpenSshConfig(file)
  await fs.writeFile(file, updateOpenSshConfigText(current, input), { mode: 0o600 })
  await fs.chmod(file, 0o600).catch(() => undefined)
  return { path: file }
}

export function removeOpenSshConfigText(current: string, name: string) {
  return stripLeadingBlankLines(removeManagedBlock(current, name)).trimEnd()
}

export async function removeOpenSshConfig(name: string, accountId?: string) {
  const file = openSshConfigPath(accountId)
  const current = await readOpenSshConfig(file)
  const next = removeOpenSshConfigText(current, name)
  if (next === current.trim()) return { path: file }
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await fs.writeFile(file, next ? `${next}\n` : "", { mode: 0o600 })
  await fs.chmod(file, 0o600).catch(() => undefined)
  return { path: file }
}

async function readOpenSshConfig(file: string) {
  return fs.readFile(file, "utf8").catch((err) => {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") return ""
    throw err
  })
}

const MANAGED_BLOCK_RE = /# >>> opencode ssh ([^\r\n]+)\r?\n([\s\S]*?)# <<< opencode ssh \1\r?\n?/g

const OPENSSH_RESERVED = new Set([
  "host",
  "hostname",
  "port",
  "user",
  "identityfile",
  "stricthostkeychecking",
  "userknownhostsfile",
  "remoteworkdir",
])

/**
 * Parse OneCode-managed OpenSSH Host blocks into product `config.ssh` entries.
 * Map key is the managed name (`# >>> opencode ssh NAME`), not necessarily Host.
 */
export function parseManagedOpenSshTargets(input: string): Record<string, ConfigSSH.Info> {
  const out: Record<string, ConfigSSH.Info> = {}
  for (const match of input.matchAll(MANAGED_BLOCK_RE)) {
    const name = match[1]?.trim()
    const body = match[2] ?? ""
    if (!name) continue

    const entries = body
      .split("\n")
      .map((line) => {
        const trimmed = line.trim()
        if (!trimmed) return
        const uncommented = trimmed.startsWith("#") ? trimmed.slice(1).trim() : trimmed
        if (trimmed.startsWith("#") && !/^RemoteWorkDir\s+/i.test(uncommented)) return
        const pair = uncommented.match(/^([A-Za-z][A-Za-z0-9]*)\s+(.+)$/)
        if (!pair) return
        return [pair[1], pair[2].trim().replace(/^["']|["']$/g, "")] as const
      })
      .filter((entry): entry is readonly [string, string] => !!entry)

    const value = (key: string) => entries.find((entry) => entry[0].toLowerCase() === key)?.[1]
    const host = value("host")
    const remotePath = value("remoteworkdir")
    if (!host) continue

    const portRaw = value("port")
    const port = portRaw ? Number(portRaw) : undefined
    const identityFile = value("identityfile")
    const options = Object.fromEntries(
      entries.filter((entry) => !OPENSSH_RESERVED.has(entry[0].toLowerCase())),
    )

    out[name] = {
      enabled: true,
      host,
      ...(value("hostname") ? { hostName: value("hostname") } : {}),
      ...(port && Number.isInteger(port) && port >= 1 && port <= 65535 ? { port } : {}),
      ...(value("user") ? { username: value("user") } : {}),
      remotePath: remotePath?.trim() ?? "",
      ...(Object.keys(options).length > 0 ? { options } : {}),
      ...(identityFile ? { auth: { type: "key" as const, keyPath: identityFile } } : {}),
    }
  }
  return out
}

/** Read managed SSH targets from the account (or OS) OpenSSH config file. */
export async function readManagedOpenSshTargets(accountId?: string) {
  const text = await readOpenSshConfig(openSshConfigPath(accountId))
  return parseManagedOpenSshTargets(text)
}

/**
 * Prefer product `config.ssh` when present; fill gaps from managed OpenSSH blocks
 * so Integration UI still sees targets after platform-config/OpenSSH drift.
 */
export type ProductSshMap = Record<string, ConfigSSH.Info | { enabled: boolean }>

export function isCompleteSshEntry(value: unknown): value is ConfigSSH.Info {
  if (!value || typeof value !== "object") return false
  const entry = value as Record<string, unknown>
  return typeof entry.host === "string" && entry.host.length > 0
}

export function mergeSshFromOpenSsh(
  product: ProductSshMap | undefined,
  disk: Record<string, ConfigSSH.Info>,
): { ssh: ProductSshMap | undefined; healedKeys: string[] } {
  const existing = product ?? {}
  const healedKeys = Object.keys(disk).filter((key) => !isCompleteSshEntry(existing[key]))
  if (healedKeys.length === 0) {
    return { ssh: product, healedKeys }
  }
  const ssh: ProductSshMap = { ...existing }
  for (const key of healedKeys) {
    ssh[key] = disk[key]
  }
  return { ssh, healedKeys }
}

/**
 * Keep managed OpenSSH blocks aligned with product `config.ssh` after account overlay writes.
 * Complete entries rewrite their managed block. Incomplete stubs must NOT delete OpenSSH —
 * product stubs are common after schema/UI races; heal restores product from disk instead.
 * Removals only happen when a name disappears from the product map (intentional delete).
 */
export async function syncOpenSshFromProductSsh(
  accountId: string,
  ssh: ProductSshMap | undefined,
  previous?: ProductSshMap | undefined,
) {
  const next = ssh ?? {}
  const prev = previous ?? {}
  const nextNames = new Set(Object.keys(next))
  for (const name of Object.keys(prev)) {
    if (nextNames.has(name)) continue
    await removeOpenSshConfig(name, accountId)
  }
  for (const [name, entry] of Object.entries(next)) {
    if (!isCompleteSshEntry(entry)) continue
    await writeOpenSshConfig({ name, config: entry, accountId })
  }
}

function stripLeadingBlankLines(input: string) {
  return input.replace(/^(?:[ \t]*\r?\n)+/, "")
}

function removeManagedBlock(input: string, name: string | undefined) {
  if (!name) return input
  return input.replace(new RegExp(`\\n?# >>> opencode ssh ${escapeRegExp(name)}\\n[\\s\\S]*?# <<< opencode ssh ${escapeRegExp(name)}\\n?`, "g"), "\n")
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
