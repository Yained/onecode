import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs"
import os from "os"
import path from "path"
import { afterEach, describe, expect, test } from "bun:test"
import { OneScienceStartupMigrations } from "../../src/onescience/startup-migrations"

describe("OneScienceStartupMigrations", () => {
  const prevRoot = process.env.ONECODE_ROOT
  const prevBin = process.env.ONECODE_BIN_PATH

  afterEach(() => {
    if (prevRoot === undefined) delete process.env.ONECODE_ROOT
    else process.env.ONECODE_ROOT = prevRoot
    if (prevBin === undefined) delete process.env.ONECODE_BIN_PATH
    else process.env.ONECODE_BIN_PATH = prevBin
  })

  test("prefers the current platform dist binary", () => {
    const root = path.join(os.tmpdir(), `onecode-startup-${Date.now()}`)
    const platform = os.platform() === "darwin" ? "darwin" : os.platform() === "win32" ? "windows" : "linux"
    const arch = os.arch() === "arm64" ? "arm64" : os.arch() === "x64" ? "x64" : os.arch()
    const binary = platform === "windows" ? "onecode.exe" : "onecode"
    const preferred = path.join(root, "packages/opencode/dist", `onecode-${platform}-${arch}`, "bin", binary)
    const fallback = path.join(root, "packages/opencode/dist", "onecode-linux-x64", "bin", "onecode")

    mkdirSync(path.dirname(preferred), { recursive: true })
    mkdirSync(path.dirname(fallback), { recursive: true })
    writeFileSync(path.join(root, "packages/opencode/package.json"), "{}")
    writeFileSync(preferred, "")
    writeFileSync(fallback, "")

    process.env.ONECODE_ROOT = root
    expect(OneScienceStartupMigrations.resolveSourceDistBinary()).toBe(preferred)

    rmSync(root, { recursive: true, force: true })
  })

  test("uses ONECODE_BIN_PATH when set", () => {
    const root = path.join(os.tmpdir(), `onecode-startup-bin-${Date.now()}`)
    const binary = path.join(root, "onecode")
    mkdirSync(root, { recursive: true })
    writeFileSync(binary, "")
    process.env.ONECODE_BIN_PATH = binary
    expect(OneScienceStartupMigrations.resolveSourceDistBinary()).toBe(binary)
    rmSync(root, { recursive: true, force: true })
  })

  test("returns undefined when no dist binary exists", () => {
    const root = path.join(os.tmpdir(), `onecode-startup-missing-${Date.now()}`)
    mkdirSync(path.join(root, "packages/opencode"), { recursive: true })
    writeFileSync(path.join(root, "packages/opencode/package.json"), "{}")
    process.env.ONECODE_ROOT = root
    expect(OneScienceStartupMigrations.resolveSourceDistBinary()).toBeUndefined()
    rmSync(root, { recursive: true, force: true })
  })

  test("treats npm launcher hardlink .onecode as compiled binary", () => {
    const prevExecPath = process.execPath
    const root = path.join(os.tmpdir(), `onecode-startup-dot-${Date.now()}`)
    const binary = path.join(root, ".onecode")
    mkdirSync(root, { recursive: true })
    writeFileSync(binary, "")
    Object.defineProperty(process, "execPath", { value: binary, configurable: true })
    try {
      expect(OneScienceStartupMigrations.runningInCompiledBinary()).toBe(true)
      expect(OneScienceStartupMigrations.resolveSourceDistBinary()).toBe(binary)
    } finally {
      Object.defineProperty(process, "execPath", { value: prevExecPath, configurable: true })
      rmSync(root, { recursive: true, force: true })
    }
  })
})
