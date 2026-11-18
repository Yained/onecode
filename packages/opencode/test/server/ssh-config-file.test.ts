import { describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { openSshConfigPath, managedSshIdentityDirs, platformSshHome, sshIdentityDir } from "../../src/server/ssh-config-file"

describe("ssh-config-file account scoping", () => {
  test("uses ~/.ssh/config when no account id", () => {
    expect(openSshConfigPath()).toContain(path.join(".ssh", "config"))
  })

  test("scopes config and identities under platform-ssh/{accountId}", () => {
    const accountId = "acc/with spaces!"
    const home = platformSshHome(accountId)
    expect(home.startsWith(path.join(Global.Path.data, "platform-ssh"))).toBe(true)
    expect(home).not.toContain(" ")
    expect(openSshConfigPath(accountId)).toBe(path.join(home, "config"))
    expect(sshIdentityDir(accountId)).toBe(path.join(home, "identities"))
    expect(managedSshIdentityDirs(accountId)).toEqual([
      path.join(home, "identities"),
      path.join(Global.Path.data, "ssh-identities"),
    ])
  })
})
