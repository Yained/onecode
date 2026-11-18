import net from "node:net"
import tls from "node:tls"
import { isMailConfigured, MAIL_NOT_CONFIGURED_MESSAGE, resolveMailConfigWithOverride, type MailConfig } from "./mail-config"

export type MailMessage = {
  to: string
  subject: string
  text: string
}

type SentMail = MailMessage & { from: string; at: number }

type SmtpSocket = net.Socket | tls.TLSSocket

const memoryOutbox: SentMail[] = []

/** Per connect / read step. Keeps UI from hanging when outbound SMTP is dropped. */
const SMTP_TIMEOUT_MS = 15_000

export function resetMailOutboxForTest() {
  memoryOutbox.length = 0
}

export function listMailOutboxForTest() {
  return memoryOutbox.slice()
}

function transportMode() {
  return (process.env.ONECODE_SMTP_TRANSPORT ?? "").trim().toLowerCase()
}

const SMTP_UNREACHABLE_CODES = new Set([
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
])

/** Connect / read timeout or typical “SMTP host unreachable” network errors — not auth failures. */
export function isSmtpUnreachableError(error: unknown): boolean {
  if (!error) return false
  const err = error as NodeJS.ErrnoException
  const code = typeof err.code === "string" ? err.code.toUpperCase() : ""
  if (SMTP_UNREACHABLE_CODES.has(code)) return true
  const message = error instanceof Error ? error.message : String(error)
  return /timed out|timeout/i.test(message)
}

function encodeBase64(value: string) {
  return Buffer.from(value, "utf8").toString("base64")
}

function extractAddress(from: string) {
  const match = from.match(/<([^>]+)>/)
  return (match?.[1] ?? from).trim()
}

/** Keeps leftover bytes across reads — QQ/Foxmail often send multi-line EHLO in one packet. */
class SmtpReader {
  private buffer = ""

  constructor(private socket: SmtpSocket) {}

  attach(socket: SmtpSocket) {
    this.socket = socket
  }

  async readLine(): Promise<string> {
    const existing = this.takeLine()
    if (existing !== undefined) return existing

    return await new Promise<string>((resolve, reject) => {
      const cleanup = () => {
        this.socket.setTimeout(0)
        this.socket.off("data", onData)
        this.socket.off("error", onError)
        this.socket.off("timeout", onTimeout)
      }
      const onData = (chunk: Buffer) => {
        this.buffer += chunk.toString("utf8")
        const line = this.takeLine()
        if (line === undefined) return
        cleanup()
        resolve(line)
      }
      const onError = (error: Error) => {
        cleanup()
        reject(error)
      }
      const onTimeout = () => {
        cleanup()
        reject(new Error(`SMTP read timed out after ${SMTP_TIMEOUT_MS}ms`))
      }
      this.socket.setTimeout(SMTP_TIMEOUT_MS)
      this.socket.on("data", onData)
      this.socket.on("error", onError)
      this.socket.on("timeout", onTimeout)
    })
  }

  private takeLine(): string | undefined {
    const crlf = this.buffer.indexOf("\r\n")
    if (crlf >= 0) {
      const line = this.buffer.slice(0, crlf)
      this.buffer = this.buffer.slice(crlf + 2)
      return line
    }
    // Some servers may emit LF-only; still keep remainder.
    const lf = this.buffer.indexOf("\n")
    if (lf >= 0) {
      const line = this.buffer.slice(0, lf).replace(/\r$/, "")
      this.buffer = this.buffer.slice(lf + 1)
      return line
    }
    return undefined
  }

  async readResponse(): Promise<string> {
    const lines: string[] = []
    while (true) {
      const line = await this.readLine()
      lines.push(line)
      if (line.length >= 4 && line[3] === " ") break
    }
    return lines.join("\n")
  }
}

async function expectOk(reader: SmtpReader, socket: SmtpSocket, command?: string) {
  if (command) socket.write(command.endsWith("\r\n") ? command : `${command}\r\n`)
  const response = await reader.readResponse()
  const code = Number(response.slice(0, 3))
  if (!Number.isFinite(code) || code >= 400) throw new Error(`SMTP error: ${response}`)
  return response
}

async function connectSocket(cfg: MailConfig): Promise<SmtpSocket> {
  return await new Promise((resolve, reject) => {
    let settled = false
    let socket: SmtpSocket

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      socket.setTimeout(0)
      socket.off("error", onError)
      socket.off("timeout", onTimeout)
      if (error) {
        socket.destroy()
        reject(error)
        return
      }
      resolve(socket)
    }
    const onError = (error: Error) => finish(error)
    const onTimeout = () => finish(new Error(`SMTP connect timed out (${cfg.host}:${cfg.port})`))

    if (cfg.secure) {
      socket = tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host }, () => finish())
    } else {
      socket = net.connect({ host: cfg.host, port: cfg.port }, () => finish())
    }
    socket.setTimeout(SMTP_TIMEOUT_MS)
    socket.on("error", onError)
    socket.on("timeout", onTimeout)
  })
}

async function upgradeToTls(socket: net.Socket, host: string) {
  return await new Promise<tls.TLSSocket>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error, upgraded?: tls.TLSSocket) => {
      if (settled) return
      settled = true
      socket.setTimeout(0)
      if (error) {
        reject(error)
        return
      }
      resolve(upgraded!)
    }
    const upgraded = tls.connect({ socket, servername: host }, () => finish(undefined, upgraded))
    upgraded.on("error", (error: Error) => finish(error))
    upgraded.setTimeout(SMTP_TIMEOUT_MS, () => {
      upgraded.destroy()
      finish(new Error(`SMTP STARTTLS timed out (${host})`))
    })
  })
}

async function sendViaSmtp(cfg: MailConfig, message: MailMessage) {
  let socket: SmtpSocket = await connectSocket(cfg)
  const reader = new SmtpReader(socket)
  try {
    await expectOk(reader, socket)
    let ehlo = await expectOk(reader, socket, "EHLO onecode")
    if (!cfg.secure && /\bSTARTTLS\b/i.test(ehlo) && socket instanceof net.Socket) {
      await expectOk(reader, socket, "STARTTLS")
      socket = await upgradeToTls(socket, cfg.host)
      reader.attach(socket)
      ehlo = await expectOk(reader, socket, "EHLO onecode")
    }
    if (cfg.user) {
      await expectOk(reader, socket, "AUTH LOGIN")
      await expectOk(reader, socket, encodeBase64(cfg.user))
      await expectOk(reader, socket, encodeBase64(cfg.pass))
    }
    await expectOk(reader, socket, `MAIL FROM:<${extractAddress(cfg.from)}>`)
    await expectOk(reader, socket, `RCPT TO:<${extractAddress(message.to)}>`)
    await expectOk(reader, socket, "DATA")
    const body =
      `From: ${cfg.from}\r\n` +
      `To: ${message.to}\r\n` +
      `Subject: ${message.subject}\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\n` +
      `\r\n` +
      `${message.text.replace(/\r?\n/g, "\r\n")}\r\n.\r\n`
    socket.write(body)
    await expectOk(reader, socket)
    socket.write("QUIT\r\n")
    socket.end()
  } finally {
    socket.destroy()
  }
}

export async function sendMail(message: MailMessage, override?: Partial<MailConfig>) {
  const cfg = await resolveMailConfigWithOverride(override)
  if (!isMailConfigured(cfg) || !cfg.pass.trim()) throw new Error(MAIL_NOT_CONFIGURED_MESSAGE)

  const mode = transportMode()
  if (mode === "memory" || mode === "log") {
    const entry = { ...message, from: cfg.from, at: Date.now() }
    memoryOutbox.push(entry)
    if (mode === "log") {
      console.info("[mail]", entry.from, "->", entry.to, entry.subject, entry.text)
    }
    return true
  }
  if (mode === "fail-timeout") {
    throw new Error(`SMTP connect timed out (${cfg.host}:${cfg.port})`)
  }

  await sendViaSmtp(cfg, message)
  return true
}
