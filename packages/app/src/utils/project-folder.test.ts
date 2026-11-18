import { afterEach, describe, expect, test } from "bun:test"
import {
  allocateLocalIdentityName,
  clampToProjectDataRoot,
  isWithinProjectDataRoot,
  projectDataRoot,
  relativeProjectFolderPath,
  resolveProjectFolderPath,
} from "./project-folder"

const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto")
const secureDescriptor = Object.getOwnPropertyDescriptor(globalThis, "isSecureContext")

afterEach(() => {
  if (cryptoDescriptor) Object.defineProperty(globalThis, "crypto", cryptoDescriptor)
  if (secureDescriptor) Object.defineProperty(globalThis, "isSecureContext", secureDescriptor)
  if (!secureDescriptor) delete (globalThis as { isSecureContext?: boolean }).isSecureContext
})

describe("project-folder", () => {
  test("projectDataRoot prefers server path.project_data_root", () => {
    expect(projectDataRoot({ project_data_root: "/root/public_data" })).toBe("/root/public_data")
    expect(projectDataRoot({})).toBe("/data")
  })

  test("isWithinProjectDataRoot accepts root and descendants only", () => {
    expect(isWithinProjectDataRoot("/data", "/data")).toBe(true)
    expect(isWithinProjectDataRoot("/data/case", "/data")).toBe(true)
    expect(isWithinProjectDataRoot("/root", "/data")).toBe(false)
    expect(isWithinProjectDataRoot("/data-evil", "/data")).toBe(false)
  })

  test("clampToProjectDataRoot keeps paths inside the root", () => {
    expect(clampToProjectDataRoot("/data/case", "/data")).toBe("/data/case")
    expect(clampToProjectDataRoot("/root", "/data")).toBe("/data")
  })

  test("relativeProjectFolderPath resolves paths under project_data_root", () => {
    expect(relativeProjectFolderPath("/data/case", "/data")).toBe("case")
    expect(relativeProjectFolderPath("/data/111/222", "/data")).toBe("111/222")
    expect(relativeProjectFolderPath("/root", "/data")).toBeUndefined()
  })

  test("relative against account workspace avoids nesting host path segments", () => {
    const workspace = "/data/hanmk/privated_data/workspaces/hmk_2"
    const project = `${workspace}/default`
    // Correct root → just the project folder name.
    expect(relativeProjectFolderPath(project, workspace)).toBe("default")
    // Wrong root (/data EMPTY default) would produce a host-relative path that must not be mkdir'd under workspace.
    expect(relativeProjectFolderPath(project, "/data")).toBe("hanmk/privated_data/workspaces/hmk_2/default")
  })

  test("resolveProjectFolderPath stays under the configured root", () => {
    expect(resolveProjectFolderPath("team/proj", "/root/public_data")).toBe("/root/public_data/team/proj")
  })

  test("allocateLocalIdentityName keeps the requested name when it is free", () => {
    expect(allocateLocalIdentityName("foo", ["bar", "baz"])).toBe("foo")
    expect(allocateLocalIdentityName("team/proj", ["other"], "aabbccdd")).toBe("team/proj")
  })

  test("allocateLocalIdentityName suffixes a uuid when the local leaf already exists", () => {
    expect(allocateLocalIdentityName("foo", ["Foo"], "a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe("foo-a1b2c3d4")
    expect(allocateLocalIdentityName("team/proj", ["proj"], "deadbeef")).toBe("team/proj-deadbeef")
    expect(allocateLocalIdentityName("foo", ["foo", "foo-aabbccdd"], "aabbccdd")).toBe("foo-aabbccdd-2")
  })

  test("allocateLocalIdentityName does not require crypto.randomUUID", () => {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: {} })
    Object.defineProperty(globalThis, "isSecureContext", { configurable: true, value: false })
    expect(allocateLocalIdentityName("free", ["other"])).toBe("free")
    const allocated = allocateLocalIdentityName("taken", ["taken"])
    expect(allocated).toMatch(/^taken-[0-9a-f]+/)
    expect(allocated).not.toBe("taken")
  })
})