import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "fs"
import path from "path"
import { Archive } from "@/util/archive"
import { tmpdir } from "../fixture/fixture"

async function writeSampleAssets(root: string) {
  mkdirSync(path.join(root, "references"), { recursive: true })
  mkdirSync(path.join(root, "assets"), { recursive: true })
  await Bun.write(path.join(root, "references", "guide.md"), "# Guide\n")
  await Bun.write(path.join(root, "assets", "template.json"), '{"kind":"demo"}\n')
}

async function createArchive(source: string, archivePath: string) {
  const archiveName = path.basename(archivePath)
  if (archiveName.endsWith(".zip")) {
    const proc = Bun.spawn(["zip", "-qr", archivePath, "references", "assets"], { cwd: source })
    expect(await proc.exited).toBe(0)
    return
  }

  const gzip = archiveName.endsWith(".gz") || archiveName.endsWith(".tgz")
  const proc = Bun.spawn(
    gzip
      ? ["tar", "-czf", archivePath, "-C", source, "references", "assets"]
      : ["tar", "-cf", archivePath, "-C", source, "references", "assets"],
  )
  expect(await proc.exited).toBe(0)
}

describe("Archive", () => {
  test("archiveKind detects supported formats", () => {
    expect(Archive.archiveKind("assets.zip")).toBe("zip")
    expect(Archive.archiveKind("assets.tar")).toBe("tar")
    expect(Archive.archiveKind("assets.tar.gz")).toBe("tar-gz")
    expect(Archive.archiveKind("assets.tgz")).toBe("tar-gz")
    expect(() => Archive.archiveKind("assets.rar")).toThrow("Unsupported archive format")
  })

  test("extractArchive unpacks zip, tar, and tar.gz archives", async () => {
    await using tmp = await tmpdir()
    const source = path.join(tmp.path, "source")
    await writeSampleAssets(source)

    for (const archiveName of ["assets.zip", "assets.tar", "assets.tar.gz"] as const) {
      const archivePath = path.join(tmp.path, archiveName)
      await createArchive(source, archivePath)

      const dest = path.join(tmp.path, `dest-${archiveName}`)
      mkdirSync(dest, { recursive: true })
      await Archive.extractArchive(archivePath, dest, archiveName)
      expect(existsSync(path.join(dest, "references", "guide.md"))).toBe(true)
      expect(existsSync(path.join(dest, "assets", "template.json"))).toBe(true)
      rmSync(dest, { recursive: true, force: true })
    }
  })

  test("extractArchive defaults to zip when filename is omitted", async () => {
    await using tmp = await tmpdir()
    const source = path.join(tmp.path, "source")
    await writeSampleAssets(source)

    const archivePath = path.join(tmp.path, "assets.zip")
    await createArchive(source, archivePath)

    const dest = path.join(tmp.path, "dest")
    mkdirSync(dest, { recursive: true })
    await Archive.extractArchive(archivePath, dest)
    expect(existsSync(path.join(dest, "references", "guide.md"))).toBe(true)
  })

  test("extractZipJs unpacks stored and deflated entries without system unzip", async () => {
    await using tmp = await tmpdir()
    const source = path.join(tmp.path, "source")
    await writeSampleAssets(source)

    const archivePath = path.join(tmp.path, "assets.zip")
    await createArchive(source, archivePath)

    const dest = path.join(tmp.path, "dest-js")
    mkdirSync(dest, { recursive: true })
    Archive.extractZipJs(archivePath, dest)
    expect(existsSync(path.join(dest, "references", "guide.md"))).toBe(true)
    expect(existsSync(path.join(dest, "assets", "template.json"))).toBe(true)
  })
})
