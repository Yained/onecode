import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, rmSync } from "fs"
import os from "os"
import path from "path"
import { OneScienceCodeDefaultDirectory } from "../src/onescience-code-default-directory"

describe("OneScienceCodeDefaultDirectory", () => {
  const prevExtra = process.env.ONECODE_EXTRA_PATH
  const prevExplicit = process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY
  const prevClient = process.env.OPENCODE_CLIENT

  afterEach(() => {
    if (prevExtra === undefined) delete process.env.ONECODE_EXTRA_PATH
    else process.env.ONECODE_EXTRA_PATH = prevExtra
    if (prevExplicit === undefined) delete process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY
    else process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY = prevExplicit
    if (prevClient === undefined) delete process.env.OPENCODE_CLIENT
    else process.env.OPENCODE_CLIENT = prevClient
  })

  test("defaults to /data/case when ONECODE_EXTRA_PATH is unset", () => {
    delete process.env.ONECODE_EXTRA_PATH
    delete process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY
    delete process.env.OPENCODE_CLIENT
    expect(OneScienceCodeDefaultDirectory.resolve()).toBe("/data/case")
  })

  test("desktop defaults to ~/OneCode/case when ONECODE_EXTRA_PATH is unset", () => {
    delete process.env.ONECODE_EXTRA_PATH
    delete process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY
    process.env.OPENCODE_CLIENT = "desktop"
    expect(OneScienceCodeDefaultDirectory.resolve()).toBe(path.join(os.homedir(), "OneCode", "case"))
  })

  test("desktop remaps explicit /data/case away from the web demo path", () => {
    delete process.env.ONECODE_EXTRA_PATH
    process.env.OPENCODE_CLIENT = "desktop"
    process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY = "/data/case"
    expect(OneScienceCodeDefaultDirectory.resolve()).toBe(path.join(os.homedir(), "OneCode", "case"))
  })

  test("defaults to ONECODE_EXTRA_PATH/case when ONECODE_EXTRA_PATH is set", () => {
    process.env.ONECODE_EXTRA_PATH = "/root/public_data"
    delete process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY
    expect(OneScienceCodeDefaultDirectory.resolve()).toBe(path.resolve("/root/public_data", "case"))
  })

  test("prefers OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY when set", () => {
    process.env.ONECODE_EXTRA_PATH = "/root/public_data"
    process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY = "/data/custom"
    delete process.env.OPENCODE_CLIENT
    expect(OneScienceCodeDefaultDirectory.resolve()).toBe(path.resolve("/data/custom"))
  })

  test("creates the resolved directory", () => {
    const root = path.join(process.cwd(), `.opencode-test-case-${crypto.randomUUID()}`)
    process.env.ONECODE_EXTRA_PATH = root
    delete process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY
    const directory = OneScienceCodeDefaultDirectory.ensureDirectory()
    expect(directory).toBe(path.resolve(root, "case"))
    expect(existsSync(directory)).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })
})
