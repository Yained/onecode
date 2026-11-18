import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs"
import path from "path"
import {
  bootstrapExtraDataHome,
  dataDir,
  extraDataDir,
  extraXdgDataHome,
  ExtraDataPathError,
  migrateData,
  needsDataMigration,
  resolveDataHome,
  validateRoot,
} from "../src/extra-data"

describe("ExtraData", () => {
  const prevExtra = process.env.ONECODE_EXTRA_PATH
  const prevXdg = process.env.XDG_DATA_HOME

  afterEach(() => {
    if (prevExtra === undefined) delete process.env.ONECODE_EXTRA_PATH
    else process.env.ONECODE_EXTRA_PATH = prevExtra
    if (prevXdg === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = prevXdg
  })

  test("validateRoot rejects empty values", () => {
    expect(() => validateRoot("   ")).toThrow(ExtraDataPathError)
  })

  test("validateRoot accepts a writable directory", () => {
    const root = path.join("/tmp", `onecode-extra-data-${crypto.randomUUID()}`)
    expect(validateRoot(root)).toBe(path.resolve(root))
    rmSync(root, { recursive: true, force: true })
  })

  test("validateRoot rejects a file path", () => {
    const root = path.join("/tmp", `onecode-extra-data-${crypto.randomUUID()}`)
    writeFileSync(root, "x")
    expect(() => validateRoot(root)).toThrow(ExtraDataPathError)
    rmSync(root, { force: true })
  })

  test("needsDataMigration is false when the target already has a database", () => {
    const source = path.join("/tmp", `onecode-source-${crypto.randomUUID()}`)
    const target = path.join("/tmp", `onecode-target-${crypto.randomUUID()}`)
    mkdirSync(source, { recursive: true })
    writeFileSync(path.join(source, "opencode-dev.db"), "db")
    mkdirSync(target, { recursive: true })
    writeFileSync(path.join(target, "opencode-dev.db"), "db")
    expect(needsDataMigration(source, target)).toBe(false)
    rmSync(source, { recursive: true, force: true })
    rmSync(target, { recursive: true, force: true })
  })

  test("migrateData copies data and keeps the source intact", () => {
    const source = path.join("/tmp", `onecode-source-${crypto.randomUUID()}`)
    const target = path.join("/tmp", `onecode-target-${crypto.randomUUID()}`)
    mkdirSync(path.join(source, "log"), { recursive: true })
    writeFileSync(path.join(source, "opencode-dev.db"), "db")
    writeFileSync(path.join(source, "auth.json"), "{}")
    writeFileSync(path.join(source, "log", "dev.log"), "log")

    migrateData(source, target)

    expect(existsSync(path.join(target, "opencode-dev.db"))).toBe(true)
    expect(existsSync(path.join(target, "auth.json"))).toBe(true)
    expect(existsSync(path.join(target, "log", "dev.log"))).toBe(true)
    expect(existsSync(path.join(source, "opencode-dev.db"))).toBe(true)
    rmSync(source, { recursive: true, force: true })
    rmSync(target, { recursive: true, force: true })
  })

  test("bootstrapExtraDataHome migrates once and redirects XDG_DATA_HOME", () => {
    const root = path.join("/tmp", `onecode-extra-root-${crypto.randomUUID()}`)
    const sourceRoot = path.join("/tmp", `onecode-source-root-${crypto.randomUUID()}`)
    const source = dataDir(sourceRoot)
    mkdirSync(path.join(source, "log"), { recursive: true })
    writeFileSync(path.join(source, "opencode-dev.db"), "db")
    writeFileSync(path.join(source, "auth.json"), "{}")

    process.env.XDG_DATA_HOME = sourceRoot
    process.env.ONECODE_EXTRA_PATH = root

    bootstrapExtraDataHome()

    expect(process.env.XDG_DATA_HOME).toBe(extraXdgDataHome(root))
    expect(existsSync(path.join(extraDataDir(root), "opencode-dev.db"))).toBe(true)
    expect(existsSync(path.join(source, "opencode-dev.db"))).toBe(true)

    writeFileSync(path.join(source, "marker.txt"), "source-only")
    bootstrapExtraDataHome()
    expect(existsSync(path.join(extraDataDir(root), "marker.txt"))).toBe(false)

    rmSync(sourceRoot, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  })

  test("bootstrapExtraDataHome is a no-op when ONECODE_EXTRA_PATH is unset", () => {
    delete process.env.ONECODE_EXTRA_PATH
    process.env.XDG_DATA_HOME = "/tmp/onecode-unchanged"
    bootstrapExtraDataHome()
    expect(process.env.XDG_DATA_HOME).toBe("/tmp/onecode-unchanged")
  })

  test("resolveDataHome follows ONECODE_EXTRA_PATH at read time", () => {
    const root = path.join("/tmp", `onecode-extra-resolve-${crypto.randomUUID()}`)
    delete process.env.XDG_DATA_HOME
    delete process.env.ONECODE_EXTRA_PATH
    process.env.XDG_DATA_HOME = path.join("/tmp", `onecode-default-${crypto.randomUUID()}`)
    expect(resolveDataHome()).toBe(dataDir(process.env.XDG_DATA_HOME))

    process.env.ONECODE_EXTRA_PATH = root
    expect(resolveDataHome()).toBe(extraDataDir(root))
  })
})
