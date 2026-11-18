import { describe, expect, test } from "bun:test"
import {
  mergeSshFromOpenSsh,
  openSshManagedBlock,
  openSshConfigPath,
  parseManagedOpenSshTargets,
  removeOpenSshConfigText,
  syncOpenSshFromProductSsh,
  updateOpenSshConfigText,
  writeOpenSshConfig,
} from "@/server/ssh-config-file"
import fs from "fs/promises"
import path from "path"

describe("ssh config file", () => {
  test("renders an opencode managed openssh block", () => {
    expect(openSshManagedBlock({
      name: "hpc",
      config: {
        enabled: true,
        host: "hpc-login",
        hostName: "login.hpc.example.test",
        port: 2202,
        username: "alice",
        remotePath: "/work/alice/project",
        auth: { type: "key", keyPath: "~/.ssh/id_ed25519" },
        options: { StrictHostKeyChecking: "no" },
      },
    })).toContain("Host hpc-login\n")
    const block = openSshManagedBlock({
      name: "hpc",
      config: {
        enabled: true,
        host: "hpc-login",
        hostName: "login.hpc.example.test",
        port: 2202,
        username: "alice",
        remotePath: "/work/alice/project",
        auth: { type: "key", keyPath: "~/.ssh/id_ed25519" },
        options: { StrictHostKeyChecking: "yes", PasswordAuthentication: "no" },
      },
    })
    expect(block).toContain("# RemoteWorkDir /work/alice/project")
    expect(block).toContain("PasswordAuthentication no")
    expect(block).toContain("StrictHostKeyChecking no")
    expect(block).toMatch(/UserKnownHostsFile (NUL|\/dev\/null)/)
    expect(block).not.toContain("StrictHostKeyChecking yes")
  })

  test("updates only matching managed blocks and preserves user config", () => {
    const original = `Host github.com
  User git

# >>> opencode ssh old
Host old
  HostName old.example.test
# <<< opencode ssh old
`
    const next = updateOpenSshConfigText(original, {
      previousName: "old",
      name: "hpc",
      config: {
        enabled: true,
        host: "hpc-login",
        hostName: "login.hpc.example.test",
        remotePath: "/work/alice/project",
      },
    })

    expect(next).toContain("Host github.com")
    expect(next).not.toContain("Host old")
    expect(next).toContain("# >>> opencode ssh hpc")
    expect(next).toContain("Host hpc-login")
    expect(next).toContain("# RemoteWorkDir /work/alice/project")
  })

  test("strips leading blank lines when rewriting a managed block", () => {
    const original = `${"\n".repeat(16)}# >>> opencode ssh east1-hanmk_sg
Host east1-hanmk_sg
  HostName cancon.hpccube.com
  User hanmk_sg
  # RemoteWorkDir /public/home/hanmk_sg
# <<< opencode ssh east1-hanmk_sg

# >>> opencode ssh lab
Host lab
  # RemoteWorkDir /work
# <<< opencode ssh lab
`
    const next = updateOpenSshConfigText(original, {
      name: "east1-hanmk_sg",
      config: {
        enabled: true,
        host: "east1-hanmk_sg",
        hostName: "cancon.hpccube.com",
        username: "hanmk_sg",
        remotePath: "/public/home/hanmk_sg",
      },
    })
    expect(next.startsWith("# >>> opencode ssh")).toBe(true)
    expect(next).not.toMatch(/^\s/)
    expect(next).toContain("# >>> opencode ssh lab")
    expect(next).toContain("# >>> opencode ssh east1-hanmk_sg")
  })

  test("removes only the matching managed block", () => {
    const original = `Host github.com
  User git

# >>> opencode ssh hpc
Host hpc-login
  HostName login.hpc.example.test
# <<< opencode ssh hpc
`
    const next = removeOpenSshConfigText(original, "hpc")
    expect(next).toContain("Host github.com")
    expect(next).not.toContain("Host hpc-login")
  })

  test("parses managed blocks into product ssh map keys", () => {
    const text = `# >>> opencode ssh east1-hanmk_sg
Host east1-hanmk_sg
  HostName cancon.hpccube.com
  User hanmk_sg
  Port 65023
  IdentityFile /data/hanmk/privated_data/.local/share/opencode/platform-ssh/acct-1/identities/key.txt
  StrictHostKeyChecking no
  PasswordAuthentication no
  UserKnownHostsFile /dev/null
  # RemoteWorkDir /public/home/hanmk_sg
# <<< opencode ssh east1-hanmk_sg
`
    expect(parseManagedOpenSshTargets(text)).toEqual({
      "east1-hanmk_sg": {
        enabled: true,
        host: "east1-hanmk_sg",
        hostName: "cancon.hpccube.com",
        port: 65023,
        username: "hanmk_sg",
        remotePath: "/public/home/hanmk_sg",
        options: {
          PasswordAuthentication: "no",
        },
        auth: {
          type: "key",
          keyPath:
            "/data/hanmk/privated_data/.local/share/opencode/platform-ssh/acct-1/identities/key.txt",
        },
      },
    })
  })

  test("mergeSshFromOpenSsh fills missing product keys from disk", () => {
    const disk = parseManagedOpenSshTargets(`# >>> opencode ssh a
Host a
  # RemoteWorkDir /a
# <<< opencode ssh a

# >>> opencode ssh b
Host b
  # RemoteWorkDir /b
# <<< opencode ssh b
`)
    expect(mergeSshFromOpenSsh(undefined, disk).healedKeys.sort()).toEqual(["a", "b"])
    expect(mergeSshFromOpenSsh({ a: disk.a }, disk)).toEqual({
      ssh: { a: disk.a, b: disk.b },
      healedKeys: ["b"],
    })
    expect(mergeSshFromOpenSsh({ a: disk.a, b: { ...disk.b, remotePath: "/kept" } }, disk)).toEqual({
      ssh: { a: disk.a, b: { ...disk.b, remotePath: "/kept" } },
      healedKeys: [],
    })
  })

  test("syncOpenSshFromProductSsh does not delete managed blocks for incomplete stubs", async () => {
    const accountId = `sync-stub-${Date.now()}`
    const file = openSshConfigPath(accountId)
    await writeOpenSshConfig({
      name: "lab",
      accountId,
      config: {
        enabled: true,
        host: "lab",
        remotePath: "/work",
        auth: { type: "key", keyPath: "/tmp/id" },
      },
    })
    expect(await fs.readFile(file, "utf8")).toContain("# >>> opencode ssh lab")

    await syncOpenSshFromProductSsh(accountId, {
      lab: { enabled: true },
    })
    expect(await fs.readFile(file, "utf8")).toContain("# >>> opencode ssh lab")

    await syncOpenSshFromProductSsh(
      accountId,
      {},
      { lab: { enabled: true, host: "lab", remotePath: "/work" } },
    )
    const afterDelete = await fs.readFile(file, "utf8").catch(() => "")
    expect(afterDelete).not.toContain("# >>> opencode ssh lab")

    await fs.rm(path.dirname(file), { recursive: true, force: true }).catch(() => undefined)
  })
})
