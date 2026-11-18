import { describe, expect, test } from "bun:test"
import {
  applySshKnownHostsIgnore,
  isMostlyKnownHostsNoise,
  isPublicKeyAuthFailure,
  isSshKnownHostsOptionKey,
} from "./ssh-known-hosts"

describe("ssh-known-hosts ui helpers", () => {
  test("applySshKnownHostsIgnore replaces casing variants", () => {
    expect(
      applySshKnownHostsIgnore({
        stricthostkeychecking: "yes",
        PasswordAuthentication: "no",
      }),
    ).toEqual({
      PasswordAuthentication: "no",
      StrictHostKeyChecking: "no",
      UserKnownHostsFile: "/dev/null",
    })
    expect(isSshKnownHostsOptionKey("UserKnownHostsFile")).toBe(true)
  })

  test("detects permanently-added warning as known_hosts noise", () => {
    expect(
      isMostlyKnownHostsNoise(
        "Warning: Permanently added '[zzeshell.scnet.cn]:65032' (ED25519) to the list of known hosts.",
      ),
    ).toBe(true)
    expect(isMostlyKnownHostsNoise("Permission denied (publickey).")).toBe(false)
  })

  test("detects publickey permission denied", () => {
    expect(
      isPublicKeyAuthFailure(
        "easyscience2024@zzeshell.scnet.cn: Permission denied (publickey,gssapi-keyex,gssapi-with-mic).",
      ),
    ).toBe(true)
    expect(isPublicKeyAuthFailure("Connection timed out")).toBe(false)
  })
})
