import { describe, expect, test } from "bun:test"
import pkg from "../../../../package.json"

describe("dev scripts", () => {
  test("starts opencode server on the local API port", () => {
    expect(pkg.scripts.dev).toContain("serve --port 4096")
    expect(pkg.scripts.dev).toContain("--hostname 0.0.0.0")
    expect(pkg.scripts.dev).not.toContain("onescience.ai")
  })

  test("starts opencode web on 8004", () => {
    expect(pkg.scripts["dev:web"]).toContain("--port 8004")
    expect(pkg.scripts["dev:web"]).toContain("--host 0.0.0.0")
  })
})
