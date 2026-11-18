import path from "path"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import type { ExecuteResult } from "@/tool/tool"
import { sniffAttachmentMime } from "./media"

const IMAGE_EXT = "png|jpg|jpeg|gif|webp"
const IMAGE_SAVE_PATTERN = new RegExp(
  String.raw`(?:saved|wrote|written|output)(?:\s+\S+)*\s+to\s+['"]?([^\s'"]+\.(?:${IMAGE_EXT}))['"]?`,
  "gi",
)
const RELATIVE_IMAGE_PATTERN = new RegExp(
  String.raw`((?:\.\./|\.?/?(?:[^\s'"]+/)*[^\s'"]+)\.(?:${IMAGE_EXT}))`,
  "gi",
)
const IMAGE_PATH_SUFFIX = new RegExp(`\\.(${IMAGE_EXT})$`, "i")

const SUPPORTED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])
const SAMPLE_BYTES = 4096
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

type ImageAttachment = NonNullable<ExecuteResult["attachments"]>[number]

export function imagePathsFromText(text: string | undefined) {
  if (!text) return []
  const paths = new Set<string>()

  for (const match of text.matchAll(IMAGE_SAVE_PATTERN)) {
    if (match[1]) paths.add(match[1])
  }

  for (const match of text.matchAll(RELATIVE_IMAGE_PATTERN)) {
    const candidate = match[1]
    if (!candidate || candidate.includes("python") || candidate.includes("node")) continue
    paths.add(candidate)
  }

  for (const match of text.matchAll(new RegExp(String.raw`\b([^\s'"]+\.(?:${IMAGE_EXT}))\b`, "gi"))) {
    const candidate = match[1]
    if (!candidate || candidate.includes("python") || candidate.includes("node")) continue
    paths.add(candidate)
  }

  const firstLine = text.trim().split("\n")[0]?.trim()
  if (
    firstLine &&
    (firstLine.startsWith("/") || /^[A-Za-z]:[\\/]/.test(firstLine)) &&
    IMAGE_PATH_SUFFIX.test(firstLine)
  ) {
    paths.add(firstLine)
  }

  return [...paths]
}

function resolveImagePath(raw: string, cwd: string) {
  if (path.isAbsolute(raw)) return raw
  return path.resolve(cwd, raw)
}

export async function imageAttachmentsFromOutput(text: string, cwd: string, worktree: string) {
  const attachments: ImageAttachment[] = []

  for (const raw of imagePathsFromText(text)) {
    const filepath = resolveImagePath(raw, cwd)
    const file = Bun.file(filepath)
    if (!(await file.exists())) continue
    const size = file.size
    if (size <= 0 || size > MAX_IMAGE_BYTES) continue

    const bytes = new Uint8Array(await file.arrayBuffer())
    const mime = sniffAttachmentMime(
      bytes.subarray(0, Math.min(SAMPLE_BYTES, bytes.length)),
      AppFileSystem.mimeType(filepath),
    )
    if (!SUPPORTED_IMAGE_MIMES.has(mime)) continue

    const relative = path.relative(worktree, filepath)
    attachments.push({
      type: "file",
      mime,
      url: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
      filename: relative && !relative.startsWith("..") ? relative : path.basename(filepath),
    })
  }

  return attachments
}

export * as OutputImages from "./output-images"
