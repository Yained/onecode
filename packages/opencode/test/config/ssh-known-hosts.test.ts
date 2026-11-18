import { describe, expect, test } from "bun:test"
import {
  appendSshKnownHostsIgnoreArgs,
  isBenignSshKnownHostsLine,
  isMostlyKnownHostsNoise,
  isSshKnownHostsOptionKey,
  sshKnownHostsIgnoreOptions,
  sshKnownHostsNullFile,
  stripBenignSshStderr,
} from "@/config/ssh-known-hosts"

describe("ssh known hosts ignore", () => {
  test("uses platform null device for UserKnownHostsFile", () => {
    expect(sshKnownHostsNullFile("win32")).toBe("NUL")
    expect(sshKnownHostsNullFile("linux")).toBe("/dev/null")
    expect(sshKnownHostsIgnoreOptions("linux")).toEqual({
      StrictHostKeyChecking: "no",
      UserKnownHostsFile: "/dev/null",
    })
  })

  test("appends ignore options and quiets host-key warnings", () => {
    const args = ["-o", "BatchMode=yes"]
    appendSshKnownHostsIgnoreArgs(args, "linux")
    expect(args).toEqual([
      "-o",
      "BatchMode=yes",
      "-o",
      "LogLevel=ERROR",
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
    ])
    expect(isSshKnownHostsOptionKey("StrictHostKeyChecking")).toBe(true)
    expect(isSshKnownHostsOptionKey("stricthostkeychecking")).toBe(true)
    expect(isSshKnownHostsOptionKey("PasswordAuthentication")).toBe(false)
  })

  test("strips permanently-added known_hosts noise from stderr", () => {
    const stderr =
      "Warning: Permanently added '[zzeshell.scnet.cn]:65032' (ED25519) to the list of known hosts.\nPermission denied (publickey)."
    expect(isBenignSshKnownHostsLine(stderr.split("\n")[0]!)).toBe(true)
    expect(stripBenignSshStderr(stderr)).toBe("Permission denied (publickey).")
    expect(isMostlyKnownHostsNoise(stderr.split("\n")[0]!)).toBe(true)
    expect(isMostlyKnownHostsNoise(stderr)).toBe(false)
  })
})
