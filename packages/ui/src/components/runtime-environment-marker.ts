export type MessageRuntimeEnvironment =
  | { kind: "local" }
  | { kind: "ssh"; targetName: string }
  | { kind: "scnet"; name?: string }

const ENVIRONMENT_HEADER = "【环境信息】"

type TextLikePart = {
  type: string
  text?: string
  synthetic?: boolean
  ignored?: boolean
}

export function stripEnvironmentHeader(text: string) {
  const start = text.indexOf(ENVIRONMENT_HEADER)
  if (start === -1) return text
  const after = text.slice(start + ENVIRONMENT_HEADER.length)
  const blank = after.search(/\n\n/)
  if (blank === -1) return text.slice(0, start).trimEnd()
  return `${text.slice(0, start)}${after.slice(blank + 2)}`.trim()
}

export function parseRemoteEnvironmentFromText(text: string): MessageRuntimeEnvironment | undefined {
  if (!text.includes(ENVIRONMENT_HEADER)) return undefined
  const ssh = text.match(/SSH 远程\s*·\s*([^\n]+)/)
  const sshName = ssh?.[1]?.trim()
  if (sshName) return { kind: "ssh", targetName: sshName }
  const scnet = text.match(/SCNet 远程\s*·\s*([^\n]+)/)
  const scnetName = scnet?.[1]?.trim()
  if (scnetName) return { kind: "scnet", name: scnetName }
  if (/SCNet 远程/.test(text)) return { kind: "scnet" }
  return undefined
}

function userMessageText(parts: TextLikePart[] | undefined) {
  const candidates = (parts ?? []).filter(
    (part): part is TextLikePart & { type: "text"; text: string } =>
      part.type === "text" && typeof part.text === "string" && !part.synthetic && !part.ignored,
  )
  return (
    candidates.reduce<TextLikePart | undefined>((best, part) => {
      if (!best || (part.text?.length ?? 0) > (best.text?.length ?? 0)) return part
      return best
    }, undefined)?.text ?? ""
  )
}

function messageEnvironment(message: object): MessageRuntimeEnvironment | undefined {
  const extra = "environment" in message ? (message as { environment?: MessageRuntimeEnvironment }).environment : undefined
  if (extra?.kind === "local") return extra
  if (extra?.kind === "ssh" && extra.targetName.trim()) return extra
  if (extra?.kind === "scnet") return extra
  return undefined
}

export function userMessageEnvironment(message: object, parts?: TextLikePart[]): MessageRuntimeEnvironment | undefined {
  return messageEnvironment(message) ?? parseRemoteEnvironmentFromText(userMessageText(parts))
}

export function lastMessageRuntimeEnvironment(
  messages: Array<{ id: string; role?: string; environment?: MessageRuntimeEnvironment }>,
  partsByMessage?: Record<string, TextLikePart[] | undefined>,
): MessageRuntimeEnvironment | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message || message.role !== "user") continue
    // Only restore an environment when the turn still carries explicit evidence
    // (persisted `environment` field or a 【环境信息】 header). Missing metadata is
    // unknown — callers decide whether that means "keep current" or "default local".
    return userMessageEnvironment(message, partsByMessage?.[message.id])
  }
  return undefined
}

export function preserveUserMessageEnvironment<T extends { role?: string; environment?: MessageRuntimeEnvironment }>(
  previous: T | undefined,
  next: T,
): T {
  if (next.role !== "user" || next.environment) return next
  if (previous?.role === "user" && previous.environment) {
    return { ...next, environment: previous.environment }
  }
  return next
}

export function formatRemoteEnvironmentLabel(env: MessageRuntimeEnvironment | undefined) {
  if (!env || env.kind === "local") return undefined
  if (env.kind === "ssh") return `远端 · ${env.targetName}`
  return env.name ? `远端 · ${env.name}` : "远端 · SCNet"
}
