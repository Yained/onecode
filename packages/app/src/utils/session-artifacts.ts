import type { FilePart, Message, Part, ToolPart } from "@opencode-ai/sdk/v2"
import { splitScienceText, parseMarkdownImages } from "@opencode-ai/ui/science-metrics"
import { imageAttachments } from "@opencode-ai/ui/tool-attachments"

export type SessionArtifact = {
  id: string
  partID: string
  messageID: string
  tool: string
  mime: string
  url: string
  filename?: string
  source?: string
  imagePath?: string
  scriptPath?: string
  time?: number
}

const IMAGE_EXT = "(?:png|jpg|jpeg|gif|webp|svg)"
const HTML_EXT = "(?:html|htm)"
const ARTIFACT_EXT = `(?:${IMAGE_EXT}|${HTML_EXT})`
const SCRIPT_EXT = String.raw`(?:py\w*|mjs|js|ts|cjs|sh|R|jl)`

type ToolEntry = {
  part: ToolPart
  messageID: string
  ended: number
}

// Legacy data may carry titles like `Bash ({"command": "ls -la"})`; drop the
// raw JSON payload so artifact labels stay readable.
const JSON_TITLE_TAIL = /\s*\(\s*\{[\s\S]*\}\s*\)\s*$/

function cleanToolTitle(title: string | undefined) {
  if (!title) return undefined
  const trimmed = title.trim()
  if (!trimmed || (trimmed.startsWith("{") && trimmed.endsWith("}"))) return undefined
  const stripped = trimmed.replace(JSON_TITLE_TAIL, "").trim()
  return stripped || undefined
}

function toolSource(part: ToolPart) {
  const state = part.state
  const input = state.input ?? {}
  const metadata = "metadata" in state ? state.metadata : undefined
  if (part.tool === "read" && typeof input.filePath === "string") return input.filePath
  if (part.tool === "bash") {
    const command = input.command ?? metadata?.command
    if (typeof command === "string") return command
  }
  if (state.status === "completed" && state.title) return cleanToolTitle(state.title)
  return undefined
}

function toolOutput(part: ToolPart) {
  if (part.state.status !== "completed") return
  return part.state.output
}

function basename(path: string | undefined) {
  if (!path) return ""
  return path.split(/[/\\]/).pop() ?? path
}

function pathsMatch(a: string | undefined, b: string | undefined) {
  if (!a || !b) return false
  if (a === b) return true
  if (basename(a) === basename(b)) return true
  const left = a.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
  const right = b.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
  return left.endsWith(`/${right}`) || right.endsWith(`/${left}`)
}

function stripQuotes(value: string) {
  return value.replace(/^['"]|['"]$/g, "")
}

function joinScriptPath(cwd: string | undefined, script: string) {
  if (!cwd) return script
  if (/^(?:\.\.?\/|\/|[A-Za-z]:)/.test(script)) return script
  return `${cwd.replace(/[/\\]+$/, "")}/${script}`
}

function scriptFromSegment(segment: string, cwd: string | undefined) {
  const trimmed = segment.trim()
  const python = trimmed.match(
    new RegExp(String.raw`\bpython3?\s+(?:-\S+\s+)*("([^"]+\.${SCRIPT_EXT})"|'([^']+\.${SCRIPT_EXT})'|([^\s]+\.${SCRIPT_EXT}))`, "i"),
  )
  if (python) {
    const script = python[2] ?? python[3] ?? python[4]
    if (script && !script.startsWith("-")) return joinScriptPath(cwd, script)
  }
  const node = trimmed.match(
    new RegExp(String.raw`\bnode\s+(?:-\S+\s+)*("([^"]+\.(?:mjs|js|ts|cjs))"|'([^']+\.(?:mjs|js|ts|cjs))'|([^\s]+\.(?:mjs|js|ts|cjs)))`, "i"),
  )
  if (node) {
    const script = node[2] ?? node[3] ?? node[4]
    if (script) return joinScriptPath(cwd, script)
  }
  const shell = trimmed.match(/\b(?:bash|sh)\s+("([^"]+\.sh)"|'([^']+\.sh)'|([^\s]+\.sh))/i)
  if (shell) {
    const script = shell[2] ?? shell[3] ?? shell[4]
    if (script) return joinScriptPath(cwd, script)
  }
  const direct = trimmed.match(
    new RegExp(String.raw`^("([^"]+\.${SCRIPT_EXT})"|'([^']+\.${SCRIPT_EXT})'|([^\s]+\.${SCRIPT_EXT}))$`, "i"),
  )
  if (direct) return direct[2] ?? direct[3] ?? direct[4]
}

export function scriptPathsFromCommand(command: string | undefined) {
  if (!command) return []
  const trimmed = command.trim()
  const paths: string[] = []
  let cwd: string | undefined

  for (const segment of trimmed.split(/\s*(?:&&|;|\|)\s*/)) {
    const cd = segment.match(/^\s*cd\s+([^\s]+)\s*$/)
    if (cd) {
      cwd = stripQuotes(cd[1])
      continue
    }
    const script = scriptFromSegment(segment, cwd)
    if (script) paths.push(script)
  }

  if (!paths.length) {
    for (const match of trimmed.matchAll(
      new RegExp(String.raw`\bpython3?\s+(?:-\S+\s+)*("([^"]+\.${SCRIPT_EXT})"|'([^']+\.${SCRIPT_EXT})'|([^\s;&|]+\.${SCRIPT_EXT}))`, "gi"),
    )) {
      const script = match[2] ?? match[3] ?? match[4]
      if (script && !script.startsWith("-")) paths.push(script)
    }
  }

  return [...new Set(paths)]
}

export function scriptPathFromCommand(command: string | undefined) {
  return scriptPathsFromCommand(command).at(-1)
}

export function scriptPathsFromText(text: string | undefined) {
  if (!text) return []
  const paths: string[] = []
  for (const match of text.matchAll(new RegExp(String.raw`(?:^|[\s('"[\]])([^\s'"]+\.${SCRIPT_EXT})`, "gi"))) {
    const path = match[1]
    if (!path || path.includes("python")) continue
    paths.push(path)
  }
  return [...new Set(paths)]
}

const IMAGE_SAVE_PATTERN = new RegExp(
  String.raw`(?:saved|wrote|written|output)(?:\s+\S+)*\s+to\s+['"]?([^\s'"]+\.${ARTIFACT_EXT})['"]?`,
  "i",
)

export function imagePathFromText(text: string | undefined) {
  if (!text) return
  const trimmed = text.trim()
  const artifactPathPattern = new RegExp(`\\.${ARTIFACT_EXT}$`, "i")
  const firstLine = trimmed.split("\n")[0]?.trim()
  if (firstLine && (firstLine.startsWith("/") || /^[A-Za-z]:[\\/]/.test(firstLine)) && artifactPathPattern.test(firstLine)) {
    return firstLine
  }
  const saved = trimmed.match(IMAGE_SAVE_PATTERN)
  if (saved?.[1]) return saved[1]
  const relative = trimmed.match(new RegExp(`((?:\\.\\./|\\.?/?(?:[^\\s'"]+/)*[^\\s'"]+)\\.${ARTIFACT_EXT})`, "i"))
  if (relative?.[1] && !relative[1].includes("python") && !relative[1].includes("node")) return relative[1]
}

function imagePathFromBashOutput(text: string | undefined) {
  if (!text) return
  return text.match(IMAGE_SAVE_PATTERN)?.[1]
}

/** @deprecated use imagePathFromText */
export function filePathFromArtifactSource(source: string | undefined) {
  return imagePathFromText(source)
}

function bashCommand(part: ToolPart) {
  if (part.tool !== "bash") return
  const input = part.state.input ?? {}
  const metadata = "metadata" in part.state ? part.state.metadata : undefined
  const command = input.command ?? metadata?.command
  if (typeof command === "string") return command
}

function scriptPathFromPart(part: ToolPart) {
  return scriptPathFromCommand(bashCommand(part))
}

function imagePathFromPart(part: ToolPart, file: FilePart) {
  if (part.tool === "read") {
    const filePath = part.state.input?.filePath
    if (typeof filePath === "string") return filePath
  }
  const fromOutput = imagePathFromText(toolOutput(part))
  if (fromOutput) return fromOutput
  if (file.filename?.includes("/")) return file.filename
  return imagePathFromText(part.state.status === "completed" ? part.state.title : undefined)
}

function pathHints(imagePath: string | undefined, filename: string | undefined) {
  const hints = new Set<string>()
  if (filename) hints.add(filename)
  if (!imagePath) return hints
  hints.add(imagePath)
  hints.add(basename(imagePath))
  const parts = imagePath.split(/[/\\]/).filter(Boolean)
  for (const part of parts) {
    if (part.length >= 4) hints.add(part)
  }
  for (let size = 2; size <= 4 && size <= parts.length; size++) {
    hints.add(parts.slice(-size).join("/"))
  }
  return hints
}

function outputRelatesToImage(output: string, hints: Set<string>) {
  for (const hint of hints) {
    if (hint.length >= 4 && output.includes(hint)) return true
  }
  return false
}

function scriptFromBashEntry(entry: ToolEntry) {
  const command = bashCommand(entry.part) ?? ""
  const output = toolOutput(entry.part) ?? ""
  const scripts = [...scriptPathsFromCommand(command), ...scriptPathsFromText(output)]
  return scripts.at(-1)
}

const HTML_FILE = /\.html?$/i
const ARTIFACT_FILE = /\.(png|jpe?g|gif|webp|svg|html?)$/i

function mimeFromPath(path: string | undefined) {
  if (!path) return "image/png"
  const ext = path.split(".").pop()?.toLowerCase()
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg"
  if (ext === "gif") return "image/gif"
  if (ext === "webp") return "image/webp"
  if (ext === "svg") return "image/svg+xml"
  if (ext === "html" || ext === "htm") return "text/html"
  return "image/png"
}

export function isHtmlArtifactPath(path: string | undefined) {
  return !!path && HTML_FILE.test(path)
}

function artifactPathKey(path: string | undefined) {
  if (!path) return ""
  return path.replace(/\\/g, "/").toLowerCase()
}

function hasSeenPath(seen: Set<string>, path: string | undefined) {
  const key = artifactPathKey(path)
  if (!key || !path) return false
  for (const seenPath of seen) {
    if (pathsMatch(seenPath, path)) return true
  }
  return false
}

function rememberPath(seen: Set<string>, path: string | undefined) {
  const key = artifactPathKey(path)
  if (key) seen.add(key)
}

function collectScienceBlockArtifacts(
  messages: readonly Message[],
  parts: Record<string, Part[] | undefined>,
  seenPaths: Set<string>,
): SessionArtifact[] {
  const out: SessionArtifact[] = []
  for (const message of messages) {
    if (message.role !== "assistant") continue
    const time = message.role === "assistant" ? message.time?.completed : undefined
    for (const part of parts[message.id] ?? []) {
      if (part.type !== "text" || !("text" in part) || typeof part.text !== "string") continue
      for (const segment of splitScienceText(part.text)) {
        if (segment.type !== "science") continue
        for (const [index, artifact] of (segment.report.artifacts ?? []).entries()) {
          if (!artifact.path || !ARTIFACT_FILE.test(artifact.path)) continue
          if (hasSeenPath(seenPaths, artifact.path)) continue
          rememberPath(seenPaths, artifact.path)
          out.push({
            id: `${part.id}:science:${index}`,
            partID: part.id,
            messageID: part.messageID,
            tool: "science",
            mime: mimeFromPath(artifact.path),
            url: "",
            filename: basename(artifact.path),
            source: artifact.path,
            imagePath: artifact.path,
            scriptPath: artifact.script,
            time,
          })
        }
      }
    }
  }
  return out
}

function pathRelatesToScript(imagePath: string, script: string) {
  const normalized = imagePath.replace(/\\/g, "/")
  const scriptParts = script.replace(/\\/g, "/").split("/").filter(Boolean)
  const scriptDir = scriptParts.slice(0, -1)
  for (const part of scriptDir) {
    if (part.length >= 4 && (normalized.includes(`/${part}/`) || normalized.includes(`/${part}`))) return true
  }
  return false
}

function resolveScriptPathForMessage(
  entries: ToolEntry[],
  messageID: string,
  imagePath: string,
  scienceScripts: Map<string, string>,
) {
  const fromScience = scienceScripts.get(imagePath) ?? scienceScripts.get(basename(imagePath))
  if (fromScience) return fromScience

  const name = basename(imagePath)
  const hints = pathHints(imagePath, name)

  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (!entry || entry.messageID !== messageID || entry.part.tool !== "bash") continue
    const script = scriptFromBashEntry(entry)
    if (!script) continue
    const output = toolOutput(entry.part) ?? ""
    if (output.includes(imagePath) || output.includes(name) || outputRelatesToImage(output, hints)) return script
    if (pathRelatesToScript(imagePath, script)) return script
  }

  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (!entry || entry.part.tool !== "bash") continue
    const script = scriptFromBashEntry(entry)
    if (!script) continue
    const output = toolOutput(entry.part) ?? ""
    if (output.includes(imagePath) || output.includes(name) || outputRelatesToImage(output, hints)) return script
    if (pathRelatesToScript(imagePath, script)) return script
  }
}

function collectMarkdownTextArtifacts(
  messages: readonly Message[],
  parts: Record<string, Part[] | undefined>,
  entries: ToolEntry[],
  scienceScripts: Map<string, string>,
  seenPaths: Set<string>,
): SessionArtifact[] {
  const out: SessionArtifact[] = []
  for (const message of messages) {
    if (message.role !== "assistant") continue
    const time = message.time?.completed
    for (const part of parts[message.id] ?? []) {
      if (part.type !== "text" || !("text" in part) || typeof part.text !== "string") continue
      const images = parseMarkdownImages(part.text)
      for (const [index, ref] of images.entries()) {
        if (!ref.path || hasSeenPath(seenPaths, ref.path)) continue
        rememberPath(seenPaths, ref.path)
        out.push({
          id: `${part.id}:md:${index}`,
          partID: part.id,
          messageID: part.messageID,
          tool: "markdown",
          mime: mimeFromPath(ref.path),
          url: ref.url ?? "",
          filename: basename(ref.path),
          source: ref.path,
          imagePath: ref.path,
          scriptPath: ref.script ?? resolveScriptPathForMessage(entries, message.id, ref.path, scienceScripts),
          time,
        })
      }
    }
  }
  return out
}

function collectToolOutputImageArtifacts(
  entries: ToolEntry[],
  scienceScripts: Map<string, string>,
  seenPaths: Set<string>,
): SessionArtifact[] {
  const out: SessionArtifact[] = []
  for (const entry of entries) {
    if (entry.part.tool !== "bash") continue
    const output = toolOutput(entry.part)
    const imagePath = imagePathFromBashOutput(output)
    if (!imagePath || hasSeenPath(seenPaths, imagePath)) continue
    rememberPath(seenPaths, imagePath)
    const scriptPath =
      scriptFromBashEntry(entry) ??
      resolveScriptPathForMessage(entries, entry.messageID, imagePath, scienceScripts)
    out.push({
      id: `${entry.part.id}:output-path:0`,
      partID: entry.part.id,
      messageID: entry.messageID,
      tool: entry.part.tool,
      mime: mimeFromPath(imagePath),
      url: "",
      filename: basename(imagePath),
      source: toolSource(entry.part),
      imagePath,
      scriptPath,
      time: entry.part.state.status === "completed" ? entry.part.state.time.end : undefined,
    })
  }
  return out
}

function collectScienceScriptHints(
  messages: readonly Message[],
  parts: Record<string, Part[] | undefined>,
) {
  const hints = new Map<string, string>()
  for (const message of messages) {
    if (message.role !== "assistant") continue
    for (const part of parts[message.id] ?? []) {
      if (part.type !== "text" || !("text" in part) || typeof part.text !== "string") continue
      for (const segment of splitScienceText(part.text)) {
        if (segment.type !== "science") continue
        for (const artifact of segment.report.artifacts ?? []) {
          if (!artifact.path || !artifact.script) continue
          hints.set(artifact.path, artifact.script)
          hints.set(basename(artifact.path), artifact.script)
        }
      }
    }
  }
  return hints
}

function resolveScriptPath(
  entries: ToolEntry[],
  sourcePart: ToolPart,
  imagePath: string | undefined,
  filename: string | undefined,
  scienceScripts: Map<string, string>,
) {
  if (imagePath) {
    const fromScience = scienceScripts.get(imagePath) ?? scienceScripts.get(basename(imagePath))
    if (fromScience) return fromScience
  }

  const direct = scriptPathFromPart(sourcePart)
  if (direct) return direct

  const name = filename ?? (imagePath ? basename(imagePath) : undefined)
  const hints = pathHints(imagePath, name)
  const sourceTime = sourcePart.state.status === "completed" ? sourcePart.state.time.end : Number.MAX_SAFE_INTEGER

  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (!entry || entry.part.tool !== "bash") continue
    if (entry.ended > sourceTime) continue
    const script = scriptFromBashEntry(entry)
    if (!script) continue
    const output = toolOutput(entry.part) ?? ""
    const outputImage = imagePathFromText(output)
    if (imagePath && outputImage && pathsMatch(imagePath, outputImage)) return script
    if (imagePath && output.includes(imagePath)) return script
    if (name && output.includes(name)) return script
    if (outputRelatesToImage(output, hints)) return script
  }

  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (!entry || entry.part.tool !== "bash") continue
    if (entry.messageID !== sourcePart.messageID) continue
    if (entry.ended > sourceTime) continue
    const script = scriptFromBashEntry(entry)
    if (script) return script
  }

  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (!entry || entry.part.tool !== "bash") continue
    if (entry.ended > sourceTime) continue
    const script = scriptFromBashEntry(entry)
    if (script) return script
  }
}

function collectToolEntries(messages: readonly Message[], parts: Record<string, Part[] | undefined>) {
  const out: ToolEntry[] = []
  for (const message of messages) {
    if (message.role !== "assistant") continue
    for (const part of parts[message.id] ?? []) {
      if (part.type !== "tool") continue
      if (part.state.status !== "completed") continue
      out.push({
        part,
        messageID: message.id,
        ended: part.state.time.end,
      })
    }
  }
  return out.sort((a, b) => a.ended - b.ended)
}

function artifactFromAttachment(
  entries: ToolEntry[],
  part: ToolPart,
  file: FilePart,
  index: number,
  scienceScripts: Map<string, string>,
): SessionArtifact | undefined {
  const htmlPath =
    (typeof file.filename === "string" && HTML_FILE.test(file.filename) && file.filename) ||
    (typeof part.state.input?.filePath === "string" && HTML_FILE.test(part.state.input.filePath)
      ? part.state.input.filePath
      : undefined)
  if (!file.mime.startsWith("image/") && !(file.mime === "text/html" || htmlPath)) return
  const source = toolSource(part)
  const imagePath = htmlPath ?? imagePathFromPart(part, file)
  const scriptPath = resolveScriptPath(entries, part, imagePath, file.filename, scienceScripts)
  const time = part.state.status === "completed" ? part.state.time.end : undefined
  return {
    id: `${part.id}:${index}`,
    partID: part.id,
    messageID: part.messageID,
    tool: part.tool,
    mime: htmlPath || file.mime === "text/html" ? "text/html" : file.mime,
    url: file.url,
    filename: file.filename,
    source,
    imagePath,
    scriptPath,
    time,
  }
}

function artifactFromBashOutput(
  entry: ToolEntry,
  entries: ToolEntry[],
  seen: Set<string>,
  seenBasenames: Set<string>,
  scienceScripts: Map<string, string>,
) {
  const part = entry.part
  if (part.tool !== "bash") return
  const output = toolOutput(part)
  const imagePath = imagePathFromBashOutput(output)
  const scriptPath = resolveScriptPath(entries, part, imagePath, imagePath ? basename(imagePath) : undefined, scienceScripts)
  if (!imagePath) return
  const name = basename(imagePath)
  if (seenBasenames.has(name)) return
  const key = `${imagePath}:${scriptPath}`
  if (seen.has(key)) return
  seen.add(key)
  seenBasenames.add(name)
  return {
    id: `${part.id}:output`,
    partID: part.id,
    messageID: part.messageID,
    tool: part.tool,
    mime: mimeFromPath(imagePath),
    url: "",
    filename: name,
    source: bashCommand(part),
    imagePath,
    scriptPath,
    time: entry.ended,
  } satisfies SessionArtifact
}

export function collectSessionArtifacts(
  messages: readonly Message[],
  parts: Record<string, Part[] | undefined>,
): SessionArtifact[] {
  const entries = collectToolEntries(messages, parts)
  const scienceScripts = collectScienceScriptHints(messages, parts)
  const out: SessionArtifact[] = []
  const seen = new Set<string>()
  const seenBasenames = new Set<string>()
  const seenPaths = new Set<string>()

  for (const entry of entries) {
    if (entry.part.state.status !== "completed") continue
    imageAttachments(entry.part.state.attachments).forEach((file, index) => {
      const item = artifactFromAttachment(entries, entry.part, file, index, scienceScripts)
      if (!item) return
      out.push(item)
      if (item.imagePath) seen.add(`${item.imagePath}:${item.scriptPath ?? ""}`)
      if (item.filename) seenBasenames.add(item.filename)
      if (item.imagePath) {
        seenBasenames.add(basename(item.imagePath))
        rememberPath(seenPaths, item.imagePath)
      }
    })

    const bashArtifact = artifactFromBashOutput(entry, entries, seen, seenBasenames, scienceScripts)
    if (bashArtifact) {
      out.push(bashArtifact)
      rememberPath(seenPaths, bashArtifact.imagePath)
    }
  }

  out.push(...collectScienceBlockArtifacts(messages, parts, seenPaths))
  out.push(...collectMarkdownTextArtifacts(messages, parts, entries, scienceScripts, seenPaths))
  out.push(...collectToolOutputImageArtifacts(entries, scienceScripts, seenPaths))

  return out.sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
}

export function sessionImageUrlForPath(artifacts: readonly SessionArtifact[], targetPath: string) {
  if (!targetPath) return
  for (const artifact of artifacts) {
    if (!artifact.url) continue
    if (artifact.imagePath && pathsMatch(artifact.imagePath, targetPath)) return artifact.url
    if (artifact.filename && pathsMatch(artifact.filename, targetPath)) return artifact.url
    if (artifact.source && pathsMatch(artifact.source, targetPath)) return artifact.url
  }
}
