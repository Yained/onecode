import { describe, expect, test } from "bun:test"
import { mergeSshFromOpenSsh, parseManagedOpenSshTargets } from "@/server/ssh-config-file"

const sampleLf = `# >>> opencode ssh core1-scnet-easyscience2024
Host core1-scnet-easyscience2024
  HostName zzeshell.scnet.cn
  User easyscience2024
  Port 65032
  IdentityFile /data/x/identities/key.txt
  PasswordAuthentication no
  IdentitiesOnly yes
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  # RemoteWorkDir /public/home/easyscience2024
# <<< opencode ssh core1-scnet-easyscience2024
`

describe("ssh heal robustness", () => {
  test("parses CRLF managed blocks", () => {
    const crlf = sampleLf.replace(/\n/g, "\r\n")
    const parsed = parseManagedOpenSshTargets(crlf)
    expect(parsed["core1-scnet-easyscience2024"]?.remotePath).toBe("/public/home/easyscience2024")
    expect(parsed["core1-scnet-easyscience2024"]?.host).toBe("core1-scnet-easyscience2024")
  })

  test("replaces enabled-only stubs from disk", () => {
    const disk = parseManagedOpenSshTargets(sampleLf)
    const { ssh, healedKeys } = mergeSshFromOpenSsh(
      { "core1-scnet-easyscience2024": { enabled: true } },
      disk,
    )
    expect(healedKeys).toEqual(["core1-scnet-easyscience2024"])
    expect(ssh?.["core1-scnet-easyscience2024"]).toEqual(disk["core1-scnet-easyscience2024"])
  })
})
