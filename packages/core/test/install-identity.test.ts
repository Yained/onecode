import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import os from "os"
import path from "path"
import {
  cstBuildStamp,
  fullInstallIdentity,
  resolveInstallIdentity,
} from "../src/install-identity"

describe("InstallIdentity", () => {
  test("fullInstallIdentity appends CST stamp once", () => {
    expect(fullInstallIdentity("1.14.50", "202607021504")).toBe("1.14.50-202607021504")
    expect(fullInstallIdentity("1.14.50-202607021504", "202607021504")).toBe("1.14.50-202607021504")
  })

  test("cstBuildStamp is 12 digits", () => {
    expect(cstBuildStamp(new Date("2026-07-02T07:04:00.000Z"))).toBe("202607021504")
  })

  test("resolveInstallIdentity prefers onecode-build.json over package.json", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "onecode-identity-"))
    try {
      writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "1.14.50" }))
      writeFileSync(
        path.join(root, "onecode-build.json"),
        JSON.stringify({ version: "1.14.50-202607021504" }),
      )
      expect(resolveInstallIdentity({ packageRoot: root })).toBe("1.14.50-202607021504")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("resolveInstallIdentity falls back to package.json", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "onecode-identity-pkg-"))
    try {
      mkdirSync(root, { recursive: true })
      writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "1.14.50" }))
      expect(
        resolveInstallIdentity({
          packageRoot: root,
          envVersion: "",
          compiledVersion: "local",
        }),
      ).toBe("1.14.50")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
