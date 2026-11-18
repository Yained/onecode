import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync } from "fs"
import { OneCodeExtraPath } from "../src/extra-path"

describe("OneCodeExtraPath", () => {
  const prev = process.env.ONECODE_EXTRA_PATH

  afterEach(() => {
    if (prev === undefined) delete process.env.ONECODE_EXTRA_PATH
    else process.env.ONECODE_EXTRA_PATH = prev
  })

  test("returns undefined when unset", () => {
    delete process.env.ONECODE_EXTRA_PATH
    expect(OneCodeExtraPath.root()).toBeUndefined()
    expect(OneCodeExtraPath.configDir()).toBeUndefined()
    expect(OneCodeExtraPath.projectDataRoot()).toBe("/data")
  })

  test("resolves config and project roots when set", () => {
    process.env.ONECODE_EXTRA_PATH = "/root/public_data"
    expect(OneCodeExtraPath.root()).toBe("/root/public_data")
    expect(OneCodeExtraPath.configDir()).toBe("/root/public_data/.config/opencode")
    expect(OneCodeExtraPath.projectDataRoot()).toBe("/root/public_data")
  })

  test("configDirIfExists returns undefined until the directory exists", () => {
    const root = `/tmp/onecode-extra-path-${crypto.randomUUID()}`
    process.env.ONECODE_EXTRA_PATH = root
    expect(OneCodeExtraPath.configDirIfExists()).toBeUndefined()
    mkdirSync(OneCodeExtraPath.configDir()!, { recursive: true })
    expect(OneCodeExtraPath.configDirIfExists()).toBe(OneCodeExtraPath.configDir())
    rmSync(root, { recursive: true, force: true })
  })

  test("ensureDirs creates root and config directories", () => {
    const root = `/tmp/onecode-extra-path-${crypto.randomUUID()}`
    process.env.ONECODE_EXTRA_PATH = root
    OneCodeExtraPath.ensureDirs()
    expect(OneCodeExtraPath.configDirIfExists()).toBe(OneCodeExtraPath.configDir())
    rmSync(root, { recursive: true, force: true })
  })
})
