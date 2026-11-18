import { test, expect } from "bun:test"
import { FileIgnore } from "../../src/file/ignore"

test("match nested and non-nested", () => {
  expect(FileIgnore.match("node_modules/index.js")).toBe(true)
  expect(FileIgnore.match("node_modules")).toBe(true)
  expect(FileIgnore.match("node_modules/")).toBe(true)
  expect(FileIgnore.match("node_modules/bar")).toBe(true)
  expect(FileIgnore.match("node_modules/bar/")).toBe(true)
})

test("match scientific artifacts and python caches", () => {
  expect(FileIgnore.match("repro/model.ckpt")).toBe(true)
  expect(FileIgnore.match("data/sample.h5")).toBe(true)
  expect(FileIgnore.match("samples_expanded_153.xlsx")).toBe(true)
  expect(FileIgnore.match("__pycache__/x.pyc")).toBe(true)
  expect(FileIgnore.match(".venv/lib/python3.11/site.py")).toBe(true)
  expect(FileIgnore.match("src/main.py")).toBe(false)
  expect(FileIgnore.ripgrepExcludeGlobs().some((g) => g.includes("*.h5"))).toBe(true)
})
