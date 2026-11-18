import { inflateRawSync } from "node:zlib"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import * as Process from "./process"

export type ArchiveKind = "zip" | "tar" | "tar-gz"

export function archiveKind(filename: string) {
  const lower = filename.toLowerCase()
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return "tar-gz" satisfies ArchiveKind
  if (lower.endsWith(".tar")) return "tar" satisfies ArchiveKind
  if (lower.endsWith(".zip")) return "zip" satisfies ArchiveKind
  throw new Error(`Unsupported archive format: ${filename}`)
}

function safeJoin(destDir: string, entryName: string) {
  const resolvedDest = path.resolve(destDir)
  const resolvedEntry = path.resolve(destDir, entryName)
  if (resolvedEntry !== resolvedDest && !resolvedEntry.startsWith(resolvedDest + path.sep)) {
    throw new Error(`Refusing to extract path outside destination: ${entryName}`)
  }
  return resolvedEntry
}

/** Pure JS fallback for zip stores/deflate when system `unzip` is missing (e.g. node:slim). */
export function extractZipJs(zipPath: string, destDir: string) {
  const buf = readFileSync(zipPath)
  let offset = 0
  let extracted = 0

  while (offset + 30 <= buf.length) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) break

    const flags = buf.readUInt16LE(offset + 6)
    const method = buf.readUInt16LE(offset + 8)
    let compSize = buf.readUInt32LE(offset + 18)
    const nameLen = buf.readUInt16LE(offset + 26)
    const extraLen = buf.readUInt16LE(offset + 28)
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString("utf8")
    let dataStart = offset + 30 + nameLen + extraLen

    if (flags & 0x8) {
      // Data descriptor follows the compressed data; scan for next local header or descriptor sig.
      throw new Error(`Zip entry uses data descriptor (unsupported without unzip): ${name}`)
    }

    const data = buf.subarray(dataStart, dataStart + compSize)
    offset = dataStart + compSize

    if (!name || name.endsWith("/")) {
      if (name) mkdirSync(safeJoin(destDir, name), { recursive: true })
      continue
    }

    const outPath = safeJoin(destDir, name)
    mkdirSync(path.dirname(outPath), { recursive: true })
    let out: Buffer
    if (method === 0) out = Buffer.from(data)
    else if (method === 8) out = inflateRawSync(data)
    else throw new Error(`Unsupported zip compression method ${method} for ${name}`)
    writeFileSync(outPath, out)
    extracted += 1
  }

  if (extracted === 0) throw new Error("Zip archive contained no extractable files")
}

async function tryExtractZipCommand(cmd: string[], zipPath: string, destDir: string) {
  await Process.run([...cmd, zipPath, "-d", destDir])
}

export async function extractZip(zipPath: string, destDir: string) {
  mkdirSync(destDir, { recursive: true })

  if (process.platform === "win32") {
    const winZipPath = path.resolve(zipPath)
    const winDestDir = path.resolve(destDir)
    // $global:ProgressPreference suppresses PowerShell's blue progress bar popup
    const cmd = `$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path '${winZipPath}' -DestinationPath '${winDestDir}' -Force`
    await Process.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd])
    return
  }

  const commands = [
    ["unzip", "-o", "-q"],
    ["/usr/bin/unzip", "-o", "-q"],
  ] as const

  const errors: string[] = []
  for (const cmd of commands) {
    try {
      await tryExtractZipCommand([...cmd], zipPath, destDir)
      return
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  try {
    await Process.run([
      "python3",
      "-c",
      "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])",
      zipPath,
      destDir,
    ])
    return
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }

  try {
    extractZipJs(zipPath, destDir)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Failed to extract zip (tried unzip/python3/js): ${detail}; earlier: ${errors.join(" | ")}`,
    )
  }
}

export async function extractTar(tarPath: string, destDir: string, gzip = false) {
  const args = gzip ? ["-xzf", tarPath, "-C", destDir] : ["-xf", tarPath, "-C", destDir]
  await Process.run(["tar", ...args])
}

export async function extractArchive(archivePath: string, destDir: string, filename?: string) {
  const kind = archiveKind(filename ?? path.basename(archivePath))
  if (kind === "zip") return extractZip(archivePath, destDir)
  return extractTar(archivePath, destDir, kind === "tar-gz")
}

export * as Archive from "./archive"
