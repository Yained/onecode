import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveRendererAsset } from "./resolve-renderer-asset"

describe("resolveRendererAsset", () => {
  const root = mkdtempSync(join(tmpdir(), "oc-renderer-"))
  mkdirSync(join(root, "assets"), { recursive: true })
  writeFileSync(join(root, "index.html"), "<html></html>")
  writeFileSync(join(root, "loading.html"), "<html></html>")
  writeFileSync(join(root, "assets", "app.js"), "console.log(1)")

  test("serves real files", () => {
    expect(resolveRendererAsset("/index.html", root)).toBe(join(root, "index.html"))
    expect(resolveRendererAsset("/loading.html", root)).toBe(join(root, "loading.html"))
    expect(resolveRendererAsset("/assets/app.js", root)).toBe(join(root, "assets", "app.js"))
  })

  test("falls back to index.html for SPA routes like /login", () => {
    expect(resolveRendererAsset("/login", root)).toBe(join(root, "index.html"))
    expect(resolveRendererAsset("/code", root)).toBe(join(root, "index.html"))
    expect(resolveRendererAsset("/", root)).toBe(join(root, "index.html"))
  })

  test("does not invent missing assets", () => {
    expect(resolveRendererAsset("/missing.js", root)).toBeNull()
    expect(resolveRendererAsset("/assets/nope.css", root)).toBeNull()
  })

  test("does not SPA-fallback API paths", () => {
    expect(resolveRendererAsset("/platform/auth/register", root)).toBeNull()
    expect(resolveRendererAsset("/global/health", root)).toBeNull()
    expect(resolveRendererAsset("/experimental/onescience/task-profile", root)).toBeNull()
  })

  test("blocks path traversal", () => {
    expect(resolveRendererAsset("/../windows.ts", root)).toBeNull()
  })
})
