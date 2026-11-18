import type { Message, Part } from "@opencode-ai/sdk/v2"
import type { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { getFilename } from "@opencode-ai/core/util/path"
import { collectSessionArtifacts, sessionImageUrlForPath } from "./session-artifacts"

type SDKClient = ReturnType<typeof createOpencodeClient>

function normalize(filePath: string | undefined) {
  if (!filePath) return ""
  return filePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
}

function isAbsolutePath(filePath: string | undefined) {
  if (!filePath) return false
  const normalized = filePath.replace(/\\/g, "/")
  return normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)
}

function relativePath(from: string, to: string) {
  const base = normalize(from).split("/").filter(Boolean)
  const target = normalize(to).split("/").filter(Boolean)
  let index = 0
  while (index < base.length && index < target.length && base[index] === target[index]) index++
  const up = Array.from({ length: base.length - index }, () => "..")
  const down = target.slice(index)
  return [...up, ...down].join("/")
}

export function pathsRelate(a: string | undefined, b: string | undefined) {
  if (!a || !b) return false
  if (a === b) return true
  const left = normalize(a)
  const right = normalize(b)
  if (left === right) return true
  if (getFilename(left) === getFilename(right)) return true
  return left.endsWith(`/${right}`) || right.endsWith(`/${left}`)
}

export function artifactPathCandidates(root: string, filePath: string | undefined) {
  const out = new Set<string>()
  if (!filePath) return []
  const normalized = normalize(filePath)
  out.add(filePath)
  out.add(normalized)
  if (!isAbsolutePath(filePath)) {
    const joined = `${normalize(root)}/${normalized}`.replace(/\/+/g, "/")
    out.add(joined)
  }
  if (isAbsolutePath(filePath)) {
    const relative = relativePath(root, filePath)
    if (relative && !relative.startsWith("..") && !isAbsolutePath(relative)) out.add(relative)
  }
  const segments = normalized.split("/").filter(Boolean)
  for (let start = 0; start < segments.length; start++) {
    out.add(segments.slice(start).join("/"))
  }
  return [...out]
}

async function readProjectImage(sdk: SDKClient, filePath: string) {
  try {
    const result = await sdk.file.read({ path: filePath })
    const content = result.data
    if (!content?.content || content.encoding !== "base64") return
    const mime = content.mimeType ?? "image/png"
    return `data:${mime};base64,${content.content}`
  } catch {
    return undefined
  }
}

export async function resolveArtifactImageUrl(input: {
  sdk: SDKClient
  directory: string
  filePath: string
  messages: readonly Message[]
  parts: Record<string, Part[] | undefined>
}) {
  const artifacts = collectSessionArtifacts(input.messages, input.parts)
  const fromSession = sessionImageUrlForPath(artifacts, input.filePath)
  if (fromSession) return fromSession

  const candidates = new Set(artifactPathCandidates(input.directory, input.filePath))
  for (const artifact of artifacts) {
    if (!artifact.imagePath || !pathsRelate(artifact.imagePath, input.filePath)) continue
    for (const candidate of artifactPathCandidates(input.directory, artifact.imagePath)) {
      candidates.add(candidate)
    }
  }

  for (const candidate of candidates) {
    const url = await readProjectImage(input.sdk, candidate)
    if (url) return url
  }

  const name = getFilename(input.filePath)
  if (!name) return undefined
  try {
    const found = await input.sdk.find.files({ query: name, dirs: "false", type: "file", limit: 50 })
    for (const match of found.data ?? []) {
      if (!pathsRelate(match, input.filePath)) continue
      const url = await readProjectImage(input.sdk, match)
      if (url) return url
    }
  } catch {
    return undefined
  }

  return undefined
}

async function readFileCandidate(sdk: SDKClient, candidate: string) {
  try {
    const result = await sdk.file.read({ path: candidate })
    const data = result.data
    if (!data) return
    if (data.type === "binary") return { path: candidate, nonempty: false }
    if (data.encoding === "base64") return { path: candidate, nonempty: data.content.length > 0 }
    return { path: candidate, nonempty: data.content.length > 0 }
  } catch {
    return undefined
  }
}

async function pathExists(sdk: SDKClient, candidate: string) {
  const parent = candidate.includes("/") ? candidate.slice(0, candidate.lastIndexOf("/")) : ""
  const name = getFilename(candidate)
  try {
    const list = await sdk.file.list({ path: parent })
    return (list.data ?? []).some((node) => node.path === candidate || node.name === name)
  } catch {
    return false
  }
}

async function pickResolvedPath(sdk: SDKClient, paths: string[]) {
  let empty: string | undefined
  for (const candidate of paths) {
    const read = await readFileCandidate(sdk, candidate)
    if (!read) continue
    if (read.nonempty) return read.path
    empty ??= read.path
  }
  if (!empty) return
  if (await pathExists(sdk, empty)) return empty
}

export async function resolveArtifactFilePath(input: {
  sdk: SDKClient
  directory: string
  filePath: string
}) {
  const name = getFilename(input.filePath)
  const ordered = new Set<string>()

  if (name) {
    try {
      const found = await input.sdk.find.files({ query: name, dirs: "false", type: "file", limit: 50 })
      for (const match of found.data ?? []) {
        if (!pathsRelate(match, input.filePath) && getFilename(match) !== name) continue
        ordered.add(match)
      }
    } catch {}
  }

  for (const candidate of artifactPathCandidates(input.directory, input.filePath)) {
    ordered.add(candidate)
  }

  return (await pickResolvedPath(input.sdk, [...ordered])) ?? input.filePath
}
