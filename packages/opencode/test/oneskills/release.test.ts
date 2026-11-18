import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs"
import path from "path"
import { installFromPackageRoot, installFromRelease } from "@/oneskills/release"

describe("OneSkillsRelease", () => {
  const prevExtra = process.env.ONECODE_EXTRA_PATH
  const roots: string[] = []

  afterEach(() => {
    if (prevExtra === undefined) delete process.env.ONECODE_EXTRA_PATH
    else process.env.ONECODE_EXTRA_PATH = prevExtra
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  test("installs skills and manifest from a local package root", async () => {
    const projectRoot = `/tmp/oneskills-release-install-${Date.now()}`
    const packageRoot = `/tmp/oneskills-release-package-${Date.now()}`
    roots.push(projectRoot, packageRoot)
    process.env.ONECODE_EXTRA_PATH = projectRoot

    const skillDir = path.join(packageRoot, "skills", "onescience-workflow")
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: onescience-workflow\ndescription: workflow entry\nlayer: workflow\ntags: [workflow]\n---\n",
    )
    writeFileSync(path.join(packageRoot, "VERSION"), "0.3.1\n")

    const result = await installFromPackageRoot(packageRoot, { force: true, url: "https://example.com/oneskills.zip" })

    expect(result.skillCount).toBe(1)
    expect(result.version).toBe("0.3.1")
    expect(existsSync(path.join(result.skillsDir, "onescience-workflow", "SKILL.md"))).toBe(true)
    expect(existsSync(path.join(projectRoot, ".opencode", "oneskills", "catalog", "manifest.json"))).toBe(true)
    expect(existsSync(path.join(projectRoot, ".oneskills", "install-state", "opencode.json"))).toBe(true)
  })

  test("installs into an account-scoped project root", async () => {
    const accountRoot = `/tmp/oneskills-account-${Date.now()}`
    const packageRoot = `/tmp/oneskills-account-package-${Date.now()}`
    roots.push(accountRoot, packageRoot)

    const skillDir = path.join(packageRoot, "skills", "onescience-workflow")
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: onescience-workflow\ndescription: workflow entry\nlayer: workflow\ntags: [workflow]\n---\n",
    )

    const result = await installFromPackageRoot(packageRoot, { force: true, projectRoot: accountRoot })

    expect(result.skillsDir).toBe(path.join(accountRoot, ".opencode", "oneskills", "skills"))
    expect(existsSync(path.join(result.skillsDir, "onescience-workflow", "SKILL.md"))).toBe(true)
  })

  test("rejects concurrent release installs for the same project root", async () => {
    const originalFetch = globalThis.fetch
    let releaseFetch!: () => void
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve
    })
    let sawFetch = false
    let resolveSawFetch!: () => void
    const sawFetchGate = new Promise<void>((resolve) => {
      resolveSawFetch = resolve
    })
    globalThis.fetch = (async () => {
      if (!sawFetch) {
        sawFetch = true
        resolveSawFetch()
        await fetchGate
      }
      return new Response("not-a-zip", { status: 200 })
    }) as unknown as typeof fetch

    try {
      const first = installFromRelease({ url: "https://example.com/oneskills.zip" })
      await sawFetchGate
      await expect(installFromRelease({ url: "https://example.com/oneskills.zip" })).rejects.toThrow(
        "OneSkills 正在更新中，请稍后再试",
      )
      releaseFetch()
      await expect(first).rejects.toThrow(/不是有效的 zip|无法下载|发布包/)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
