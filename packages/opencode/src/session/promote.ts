import { copyFile, mkdir, stat } from "fs/promises"
import path from "path"
import type { Snapshot } from "@/snapshot"
import type { MessageV2 } from "./message-v2"
import * as PlatformAuth from "@/platform-auth/platform-auth"

const WRITE_TOOLS = new Set(["write", "edit", "apply_patch"])

export type CopyResult = {
  copied: string[]
  skipped: string[]
  missing: string[]
}

/** Collect project-relative paths this session created or edited. */
export function collectTouchedRelativePaths(input: {
  sourceDirectory: string
  diffs: Snapshot.FileDiff[]
  messages: MessageV2.WithParts[]
}) {
  const source = path.resolve(input.sourceDirectory)
  const seen = new Set<string>()

  const add = (raw: string | undefined) => {
    if (!raw?.trim()) return
    const absolute = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(source, raw)
    if (!PlatformAuth.isPathInsideRoot(source, absolute)) return
    const relative = path.relative(source, absolute).replaceAll("\\", "/")
    if (!relative || relative === "." || relative.startsWith("..")) return
    seen.add(relative)
  }

  for (const diff of input.diffs) {
    if (diff.status === "deleted") continue
    add(diff.file)
  }

  for (const message of input.messages) {
    for (const part of message.parts) {
      if (part.type === "patch") {
        for (const file of part.files) add(file)
        continue
      }
      if (part.type !== "tool") continue
      if (!WRITE_TOOLS.has(part.tool)) continue
      const inputRecord = "input" in part.state ? part.state.input : undefined
      if (inputRecord && typeof inputRecord === "object") {
        const record = inputRecord as Record<string, unknown>
        if (typeof record.filePath === "string") add(record.filePath)
        if (typeof record.path === "string") add(record.path)
      }
      const metadata = "metadata" in part.state ? part.state.metadata : undefined
      if (metadata && typeof metadata === "object") {
        const record = metadata as Record<string, unknown>
        if (typeof record.filepath === "string") add(record.filepath)
        if (typeof record.filePath === "string") add(record.filePath)
      }
    }
  }

  return [...seen].sort()
}

/** Copy touched files into the target project root. Existing targets are skipped. */
export async function copyTouchedFiles(input: {
  sourceDirectory: string
  targetDirectory: string
  relatives: string[]
}): Promise<CopyResult> {
  const source = path.resolve(input.sourceDirectory)
  const target = path.resolve(input.targetDirectory)
  const copied: string[] = []
  const skipped: string[] = []
  const missing: string[] = []

  for (const relative of input.relatives) {
    const from = path.resolve(source, relative)
    const to = path.resolve(target, relative)
    if (!PlatformAuth.isPathInsideRoot(source, from) || !PlatformAuth.isPathInsideRoot(target, to)) {
      skipped.push(relative)
      continue
    }
    if (!(await isFile(from))) {
      missing.push(relative)
      continue
    }
    if (await exists(to)) {
      skipped.push(relative)
      continue
    }
    await mkdir(path.dirname(to), { recursive: true })
    await copyFile(from, to)
    copied.push(relative)
  }

  return { copied, skipped, missing }
}

async function exists(file: string) {
  return stat(file).then(
    () => true,
    () => false,
  )
}

async function isFile(file: string) {
  return stat(file).then(
    (info) => info.isFile(),
    () => false,
  )
}

export * as SessionPromote from "./promote"
