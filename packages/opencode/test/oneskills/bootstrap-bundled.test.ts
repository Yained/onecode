import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import os from "os"
import path from "path"
import { OneSkillsBootstrapBundled } from "../../src/oneskills/bootstrap-bundled"

describe("OneSkillsBootstrapBundled", () => {
  const prevExecPath = process.execPath
  const prevExtra = process.env.ONECODE_EXTRA_PATH
  const tempRoots: string[] = []

  afterEach(() => {
    Object.defineProperty(process, "execPath", { value: prevExecPath, configurable: true })
    if (prevExtra === undefined) delete process.env.ONECODE_EXTRA_PATH
    else process.env.ONECODE_EXTRA_PATH = prevExtra
    for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  function makePackageLayout(version = "1.0.0") {
    const packageRoot = mkdtempSync(path.join(os.tmpdir(), "onecode-package-"))
    tempRoots.push(packageRoot)
    writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ name: "@onescience/onecode", version }, null, 2))
    const bundled = path.join(packageRoot, ".opencode", "oneskills")
    mkdirSync(path.join(bundled, "skills", "onescience-workflow"), { recursive: true })
    writeFileSync(path.join(bundled, "skills", "onescience-workflow", "SKILL.md"), "---\nname: onescience-workflow\n---\n")
    mkdirSync(path.join(bundled, "onescience", "src"), { recursive: true })
    writeFileSync(path.join(bundled, "onescience", "src", "marker.txt"), "onescience")
    mkdirSync(path.join(bundled, "references"), { recursive: true })
    writeFileSync(path.join(bundled, "references", "shared.md"), "shared")
    mkdirSync(path.join(packageRoot, ".oneskills", "install-state"), { recursive: true })
    writeFileSync(path.join(packageRoot, ".oneskills", "install-state", "opencode.json"), "{}")
    const binary = path.join(packageRoot, "bin", "onecode")
    mkdirSync(path.dirname(binary), { recursive: true })
    writeFileSync(binary, "")
    Object.defineProperty(process, "execPath", { value: binary, configurable: true })
    return packageRoot
  }

  test("skips when bundled oneskills are not present in the install package", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "onecode-dist-only-"))
    tempRoots.push(root)
    const binary = path.join(root, "bin", "onecode")
    mkdirSync(path.dirname(binary), { recursive: true })
    writeFileSync(binary, "")
    Object.defineProperty(process, "execPath", { value: binary, configurable: true })

    const result = OneSkillsBootstrapBundled.bootstrapBundled()
    expect(result.skipped).toBe(true)
    expect(result.copied).toEqual([])
  })

  test("copies bundled content to ~/.opencode/oneskills when ONECODE_EXTRA_PATH is unset", () => {
    delete process.env.ONECODE_EXTRA_PATH
    const home = mkdtempSync(path.join(os.tmpdir(), "onecode-home-"))
    tempRoots.push(home)
    makePackageLayout()

    const previousHome = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = home
    try {
      const result = OneSkillsBootstrapBundled.bootstrapBundled()
      expect(result.skipped).toBe(false)
      expect(result.target).toBe(path.join(home, ".opencode", "oneskills"))
      expect(result.copied).toContain("skills")
      expect(result.copied).toContain("onescience")
      expect(existsSync(path.join(home, ".opencode", "oneskills", "skills", "onescience-workflow", "SKILL.md"))).toBe(true)
      expect(existsSync(path.join(home, ".opencode", "oneskills", "onescience", "src", "marker.txt"))).toBe(true)
      expect(existsSync(path.join(home, ".oneskills", "install-state", "opencode.json"))).toBe(true)
    } finally {
      if (previousHome === undefined) delete process.env.OPENCODE_TEST_HOME
      else process.env.OPENCODE_TEST_HOME = previousHome
    }
  })

  test("copies bundled content under ONECODE_EXTRA_PATH/.opencode/oneskills when set", () => {
    const extra = mkdtempSync(path.join(os.tmpdir(), "onecode-extra-"))
    tempRoots.push(extra)
    process.env.ONECODE_EXTRA_PATH = extra
    makePackageLayout()

    const result = OneSkillsBootstrapBundled.bootstrapBundled()
    expect(result.skipped).toBe(false)
    expect(result.target).toBe(path.join(extra, ".opencode", "oneskills"))
    expect(result.copied).toContain("skills")
    expect(existsSync(path.join(extra, ".opencode", "oneskills", "onescience", "src", "marker.txt"))).toBe(true)
    expect(existsSync(path.join(extra, ".oneskills", "install-state", "opencode.json"))).toBe(true)
  })

  test("copies bundled content under ONECODE_EXTRA_PATH/.agents/oneskills for desktop client", () => {
    const prevClient = process.env.OPENCODE_CLIENT
    const extra = mkdtempSync(path.join(os.tmpdir(), "onecode-extra-desktop-"))
    tempRoots.push(extra)
    process.env.ONECODE_EXTRA_PATH = extra
    process.env.OPENCODE_CLIENT = "desktop"
    makePackageLayout()

    try {
      const result = OneSkillsBootstrapBundled.bootstrapBundled()
      expect(result.skipped).toBe(false)
      expect(result.target).toBe(path.join(extra, ".agents", "oneskills"))
      expect(result.copied).toContain("skills")
      expect(existsSync(path.join(extra, ".agents", "oneskills", "skills", "onescience-workflow", "SKILL.md"))).toBe(true)
    } finally {
      if (prevClient === undefined) delete process.env.OPENCODE_CLIENT
      else process.env.OPENCODE_CLIENT = prevClient
    }
  })

  test("repairs empty skills directory from bundled content", () => {
    delete process.env.ONECODE_EXTRA_PATH
    const home = mkdtempSync(path.join(os.tmpdir(), "onecode-home-empty-skills-"))
    tempRoots.push(home)
    makePackageLayout()

    mkdirSync(path.join(home, ".opencode", "oneskills", "skills"), { recursive: true })

    const previousHome = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = home
    try {
      const result = OneSkillsBootstrapBundled.bootstrapBundled()
      expect(result.skipped).toBe(false)
      expect(result.copied).toContain("skills")
      expect(existsSync(path.join(home, ".opencode", "oneskills", "skills", "onescience-workflow", "SKILL.md"))).toBe(true)
    } finally {
      if (previousHome === undefined) delete process.env.OPENCODE_TEST_HOME
      else process.env.OPENCODE_TEST_HOME = previousHome
    }
  })

  test("does not overwrite existing target content for the same onecode version", () => {
    delete process.env.ONECODE_EXTRA_PATH
    const home = mkdtempSync(path.join(os.tmpdir(), "onecode-home-existing-"))
    tempRoots.push(home)
    makePackageLayout("1.0.0")

    const targetSkill = path.join(home, ".opencode", "oneskills", "skills", "onescience-workflow", "SKILL.md")
    mkdirSync(path.dirname(targetSkill), { recursive: true })
    writeFileSync(targetSkill, "existing")
    mkdirSync(path.join(home, ".oneskills"), { recursive: true })
    writeFileSync(
      path.join(home, ".oneskills", "bundled-sync.json"),
      JSON.stringify({ onecodeVersion: "1.0.0", skillCount: 1, syncedAt: Date.now() }, null, 2),
    )

    const previousHome = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = home
    try {
      const result = OneSkillsBootstrapBundled.bootstrapBundled()
      expect(result.skipped).toBe(false)
      expect(result.copied).not.toContain("skills")
      expect(result.copied).toContain("onescience")
      expect(readFileSync(targetSkill, "utf8")).toBe("existing")
    } finally {
      if (previousHome === undefined) delete process.env.OPENCODE_TEST_HOME
      else process.env.OPENCODE_TEST_HOME = previousHome
    }
  })

  test("refreshes bundled skills when onecode version changes", () => {
    delete process.env.ONECODE_EXTRA_PATH
    const home = mkdtempSync(path.join(os.tmpdir(), "onecode-home-upgrade-"))
    tempRoots.push(home)
    makePackageLayout("1.1.0")

    const targetSkill = path.join(home, ".opencode", "oneskills", "skills", "onescience-workflow", "SKILL.md")
    mkdirSync(path.dirname(targetSkill), { recursive: true })
    writeFileSync(targetSkill, "stale")
    mkdirSync(path.join(home, ".oneskills"), { recursive: true })
    writeFileSync(
      path.join(home, ".oneskills", "bundled-sync.json"),
      JSON.stringify({ onecodeVersion: "1.0.0", skillCount: 1, syncedAt: Date.now() }, null, 2),
    )

    const previousHome = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = home
    try {
      const result = OneSkillsBootstrapBundled.bootstrapBundled()
      expect(result.skipped).toBe(false)
      expect(result.refreshBundled).toBe(true)
      expect(result.copied).toContain("skills")
      expect(readFileSync(targetSkill, "utf8")).toContain("name: onescience-workflow")
    } finally {
      if (previousHome === undefined) delete process.env.OPENCODE_TEST_HOME
      else process.env.OPENCODE_TEST_HOME = previousHome
    }
  })

  test("refreshes bundled skills when stamped install identity changes", () => {
    delete process.env.ONECODE_EXTRA_PATH
    const home = mkdtempSync(path.join(os.tmpdir(), "onecode-home-stamp-"))
    tempRoots.push(home)
    const packageRoot = makePackageLayout("1.14.50")
    writeFileSync(
      path.join(packageRoot, "onecode-build.json"),
      JSON.stringify({ version: "1.14.50-202607021504" }, null, 2),
    )

    const targetSkill = path.join(home, ".opencode", "oneskills", "skills", "onescience-workflow", "SKILL.md")
    mkdirSync(path.dirname(targetSkill), { recursive: true })
    writeFileSync(targetSkill, "stale")
    mkdirSync(path.join(home, ".oneskills"), { recursive: true })
    writeFileSync(
      path.join(home, ".oneskills", "bundled-sync.json"),
      JSON.stringify({ onecodeVersion: "1.14.50-202607011200", skillCount: 1, syncedAt: Date.now() }, null, 2),
    )

    const previousHome = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = home
    try {
      const result = OneSkillsBootstrapBundled.bootstrapBundled()
      expect(result.refreshBundled).toBe(true)
      expect(result.copied).toContain("skills")
      const sync = JSON.parse(readFileSync(path.join(home, ".oneskills", "bundled-sync.json"), "utf8"))
      expect(sync.onecodeVersion).toBe("1.14.50-202607021504")
    } finally {
      if (previousHome === undefined) delete process.env.OPENCODE_TEST_HOME
      else process.env.OPENCODE_TEST_HOME = previousHome
    }
  })

  test("refreshes bundled skills when bundled skill inventory changes", () => {
    delete process.env.ONECODE_EXTRA_PATH
    const home = mkdtempSync(path.join(os.tmpdir(), "onecode-home-skill-count-"))
    tempRoots.push(home)
    const packageRoot = makePackageLayout("1.0.0")

    const bundled = path.join(packageRoot, ".opencode", "oneskills", "skills", "onescience-coder")
    mkdirSync(bundled, { recursive: true })
    writeFileSync(path.join(bundled, "SKILL.md"), "---\nname: onescience-coder\n---\n")

    const targetSkill = path.join(home, ".opencode", "oneskills", "skills", "onescience-workflow", "SKILL.md")
    mkdirSync(path.dirname(targetSkill), { recursive: true })
    writeFileSync(targetSkill, "stale")
    mkdirSync(path.join(home, ".oneskills"), { recursive: true })
    writeFileSync(
      path.join(home, ".oneskills", "bundled-sync.json"),
      JSON.stringify({ onecodeVersion: "1.0.0", skillCount: 1, syncedAt: Date.now() }, null, 2),
    )

    const previousHome = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = home
    try {
      const result = OneSkillsBootstrapBundled.bootstrapBundled()
      expect(result.refreshBundled).toBe(true)
      expect(result.copied).toContain("skills")
      expect(existsSync(path.join(home, ".opencode", "oneskills", "skills", "onescience-coder", "SKILL.md"))).toBe(true)
    } finally {
      if (previousHome === undefined) delete process.env.OPENCODE_TEST_HOME
      else process.env.OPENCODE_TEST_HOME = previousHome
    }
  })

  test("resolveBundledPackageRoot finds sibling onecode package from platform binary layout", () => {
    const modules = mkdtempSync(path.join(os.tmpdir(), "onecode-node-modules-"))
    tempRoots.push(modules)
    const packageRoot = path.join(modules, "onecode")
    const bundled = path.join(packageRoot, ".opencode", "oneskills", "skills", "onescience-workflow")
    mkdirSync(bundled, { recursive: true })
    writeFileSync(path.join(bundled, "SKILL.md"), "---\nname: onescience-workflow\n---\n")
    const binary = path.join(modules, "onecode-linux-x64", "bin", "onecode")
    mkdirSync(path.dirname(binary), { recursive: true })
    writeFileSync(binary, "")
    Object.defineProperty(process, "execPath", { value: binary, configurable: true })

    expect(OneSkillsBootstrapBundled.resolveBundledPackageRoot()).toBe(packageRoot)
  })

  test("does not treat the global install target as a bundled package root", () => {
    delete process.env.ONECODE_EXTRA_PATH
    const home = mkdtempSync(path.join(os.tmpdir(), "onecode-home-self-source-"))
    tempRoots.push(home)

    const skill = path.join(home, ".opencode", "oneskills", "skills", "onescience-workflow", "SKILL.md")
    mkdirSync(path.dirname(skill), { recursive: true })
    writeFileSync(skill, "keep-me")
    mkdirSync(path.join(home, ".oneskills"), { recursive: true })
    writeFileSync(
      path.join(home, ".oneskills", "bundled-sync.json"),
      JSON.stringify({ onecodeVersion: "old", skillCount: 1, syncedAt: Date.now() }, null, 2),
    )

    // Binary under $HOME so walking execPath ancestors finds ~/.opencode/oneskills/skills.
    const binary = path.join(home, "onecode", "dist", "bin", "onecode")
    mkdirSync(path.dirname(binary), { recursive: true })
    writeFileSync(binary, "")
    Object.defineProperty(process, "execPath", { value: binary, configurable: true })

    const previousHome = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = home
    try {
      expect(OneSkillsBootstrapBundled.resolveBundledPackageRoot()).toBeUndefined()
      const result = OneSkillsBootstrapBundled.bootstrapBundled()
      expect(result.skipped).toBe(true)
      expect(existsSync(skill)).toBe(true)
      expect(readFileSync(skill, "utf8")).toBe("keep-me")
    } finally {
      if (previousHome === undefined) delete process.env.OPENCODE_TEST_HOME
      else process.env.OPENCODE_TEST_HOME = previousHome
    }
  })
})
