import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import {
  listProjectDataSubdirectories,
  projectDataRoot,
  resolveProjectFolderPath,
  sanitizeProjectFolderPath,
  wouldNestProjectFolder,
} from "../../src/path/project-folder"

describe("project-folder", () => {
  const prev = process.env.ONECODE_EXTRA_PATH

  afterEach(() => {
    if (prev === undefined) delete process.env.ONECODE_EXTRA_PATH
    else process.env.ONECODE_EXTRA_PATH = prev
  })

  test("resolves folder directly under /data", () => {
    delete process.env.ONECODE_EXTRA_PATH
    expect(projectDataRoot()).toBe("/data")
    expect(resolveProjectFolderPath("my_proj")).toBe("/data/my_proj")
  })

  test("resolves nested folders under /data", () => {
    delete process.env.ONECODE_EXTRA_PATH
    expect(resolveProjectFolderPath("1/2/3")).toBe("/data/1/2/3")
  })

  test("resolves folders under ONECODE_EXTRA_PATH when set", () => {
    process.env.ONECODE_EXTRA_PATH = "/root/public_data"
    expect(projectDataRoot()).toBe("/root/public_data")
    expect(resolveProjectFolderPath("team/proj")).toBe("/root/public_data/team/proj")
  })

  test("rejects invalid paths", () => {
    expect(sanitizeProjectFolderPath("")).toBeUndefined()
    expect(sanitizeProjectFolderPath("  ")).toBeUndefined()
    expect(sanitizeProjectFolderPath("../escape")).toBeUndefined()
    expect(sanitizeProjectFolderPath("a/../b")).toBeUndefined()
    expect(resolveProjectFolderPath("../escape")).toBeUndefined()
  })

  test("wouldNestProjectFolder detects mismatched /data-relative names under a workspace", () => {
    const workspace = "/data/hanmk/privated_data/workspaces/hmk_2"
    expect(wouldNestProjectFolder(workspace, "default")).toBe(false)
    expect(wouldNestProjectFolder(workspace, "case/demo")).toBe(false)
    expect(wouldNestProjectFolder(workspace, "hanmk/privated_data/workspaces/hmk_2/default")).toBe(true)
  })

  test("listProjectDataSubdirectories lists only immediate child directories", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "onescience-project-data-"))
    process.env.ONECODE_EXTRA_PATH = root
    await fs.mkdir(path.join(root, "alpha"))
    await fs.mkdir(path.join(root, "beta"))
    await fs.mkdir(path.join(root, ".home"))
    await fs.mkdir(path.join(root, ".git"))
    await fs.writeFile(path.join(root, "note.txt"), "x")
    await fs.mkdir(path.join(root, "alpha", "nested"))

    await expect(listProjectDataSubdirectories()).resolves.toEqual([
      { name: "alpha", absolute: path.join(root, "alpha").replace(/\\/g, "/") },
      { name: "beta", absolute: path.join(root, "beta").replace(/\\/g, "/") },
    ])
    await expect(listProjectDataSubdirectories("alpha")).resolves.toEqual([
      { name: "nested", absolute: path.join(root, "alpha", "nested").replace(/\\/g, "/") },
    ])

    await fs.rm(root, { recursive: true, force: true })
  })

  test("lists nested directories from an explicit workspace root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "onescience-workspace-root-"))
    const displayRoot = root.replace(/\\/g, "/")
    await fs.mkdir(path.join(root, "case", "earth_ocean_atmo_fusion_model"), { recursive: true })

    expect(resolveProjectFolderPath("new_case", displayRoot)).toBe(`${displayRoot}/new_case`)
    await expect(listProjectDataSubdirectories("", displayRoot)).resolves.toEqual([
      { name: "case", absolute: `${displayRoot}/case` },
    ])
    await expect(listProjectDataSubdirectories("case", displayRoot)).resolves.toEqual([
      { name: "earth_ocean_atmo_fusion_model", absolute: `${displayRoot}/case/earth_ocean_atmo_fusion_model` },
    ])

    await fs.rm(root, { recursive: true, force: true })
  })
})
