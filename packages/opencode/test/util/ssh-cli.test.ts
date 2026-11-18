import { describe, expect, test } from "bun:test"
import { isSshMissingError, resolveSshExecutable, sshAuthCliArgs, sshMissingOnServerMessage, sshSearchPath } from "@/util/ssh-cli"

describe("ssh-cli", () => {
  test("detects bun and node missing-ssh errors", () => {
    expect(isSshMissingError('Executable not found in $PATH: "ssh"')).toBe(true)
    expect(isSshMissingError("spawn ssh ENOENT")).toBe(true)
    expect(isSshMissingError("Connection refused")).toBe(false)
  })

  test("puts standard unix dirs first on PATH", () => {
    if (process.platform === "win32") return
    const next = sshSearchPath("/opt/custom/bin")
    expect(next.startsWith("/usr/local/bin:")).toBe(true)
    expect(next).toContain("/usr/bin")
    expect(next.endsWith("/opt/custom/bin")).toBe(true)
  })

  test("prefers an absolute ssh path even when process PATH is empty", () => {
    if (process.platform === "win32") return
    const resolved = resolveSshExecutable({ PATH: "" })
    if (resolved === "ssh") return
    expect(resolved.startsWith("/")).toBe(true)
    expect(resolved.endsWith("/ssh")).toBe(true)
  })

  test("password auth skips BatchMode and imported PasswordAuthentication=no", () => {
    const args = sshAuthCliArgs(
      { type: "password", password: "secret" },
      { PasswordAuthentication: "no", StrictHostKeyChecking: "no" },
    )
    expect(args).not.toContain("BatchMode=yes")
    expect(args).toContain("PreferredAuthentications=password,keyboard-interactive")
    expect(args.join(" ")).not.toContain("PasswordAuthentication=no")
    expect(args).toContain("PubkeyAuthentication=no")
  })

  test("legacy agent auth matches SSH config", () => {
    const config = sshAuthCliArgs({ type: "config" })
    const agent = sshAuthCliArgs({ type: "agent" })
    expect(agent).toEqual(config)
    expect(config).toContain("BatchMode=yes")
    expect(config.join(" ")).not.toContain("PreferredAuthentications")
  })
})
