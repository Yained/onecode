import { describe, expect, test } from "bun:test"
import {
  buildSshConfigEntry,
  emptySshConfigForm,
  importedIdentityStrategy,
  isServerUnreachableIdentityPath,
  parseOpenSshConfig,
  resolveImportedKeyIssue,
  resolveSshConfigForEdit,
  firstInvalidSshFormField,
  validateSshConfigForm,
  visibleSshAuthType,
} from "./dialog-select-ssh-form"

describe("ssh config form", () => {
  test("builds trimmed config payload", () => {
    expect(
      buildSshConfigEntry({
        name: " hpc ",
        hostName: " login.hpc.example.test ",
        username: " alice ",
        remotePath: " /work/alice/project ",
        port: " 2202 ",
        keyPath: " ~/.ssh/id_ed25519 ",
        authType: "key",
        password: "",
        options: "StrictHostKeyChecking=no\nPasswordAuthentication no",
      }),
    ).toEqual({
      name: "hpc",
      value: {
        host: "login.hpc.example.test",
        hostName: "login.hpc.example.test",
        port: 2202,
        username: "alice",
        remotePath: "/work/alice/project",
        options: {
          StrictHostKeyChecking: "no",
          PasswordAuthentication: "no",
        },
        auth: { type: "key", keyPath: "~/.ssh/id_ed25519" },
      },
    })
  })

  test("builds config with empty optional fields defaulted", () => {
    expect(
      buildSshConfigEntry({
        name: "hpc",
        hostName: "login.hpc.example.test",
        username: "alice",
        remotePath: "",
        port: "22",
        keyPath: "/data/guest/.ssh/id_ed25519",
        authType: "key",
        password: "",
        options: "",
      }),
    ).toEqual({
      name: "hpc",
      value: {
        host: "login.hpc.example.test",
        hostName: "login.hpc.example.test",
        port: 22,
        username: "alice",
        remotePath: "",
        options: undefined,
        auth: { type: "key", keyPath: "/data/guest/.ssh/id_ed25519" },
      },
    })
  })

  test("imports an openssh config block with remote workdir comment", () => {
    expect(
      parseOpenSshConfig(`# OneScience core node
Host core1-scnet-easyscience2024
    HostName zzeshell.scnet.cn
    Port 65032
    User easyscience2024
    StrictHostKeyChecking no
    PasswordAuthentication no
    IdentityFile c:/Users/liu02/.ssh/easyscience2024.txt
    # RemoteWorkDir /public/home/easyscience2024
`),
    ).toEqual({
      name: "core1-scnet-easyscience2024",
      hostName: "zzeshell.scnet.cn",
      username: "easyscience2024",
      remotePath: "/public/home/easyscience2024",
      port: "65032",
      keyPath: "c:/Users/liu02/.ssh/easyscience2024.txt",
      authType: "key",
      options: "stricthostkeychecking=no\npasswordauthentication=no",
    })
  })

  test("detects local identity paths that cannot be used on the server", () => {
    expect(isServerUnreachableIdentityPath("")).toBe(true)
    expect(isServerUnreachableIdentityPath("c:/Users/mk_ha/.ssh/key.txt")).toBe(true)
    expect(isServerUnreachableIdentityPath("C:\\Users\\mk_ha\\.ssh\\key.txt")).toBe(true)
    expect(isServerUnreachableIdentityPath("/data/guest/.local/share/opencode/ssh-identities/key")).toBe(false)
    expect(isServerUnreachableIdentityPath("~/.ssh/id_ed25519")).toBe(false)
  })

  test("resolves imported key issues for desktop vs remote server", () => {
    const windowsKey = "C:/Users/mk_ha/.ssh/hanmk_sg.txt"

    expect(resolveImportedKeyIssue({ keyPath: "", desktop: true })).toBe("empty")
    expect(resolveImportedKeyIssue({ keyPath: windowsKey, desktop: false })).toBe("localPathOnServer")
    expect(resolveImportedKeyIssue({ keyPath: windowsKey, desktop: true })).toBeUndefined()
    expect(resolveImportedKeyIssue({ keyPath: windowsKey, desktop: true, exists: true })).toBe("needsUpload")
    expect(resolveImportedKeyIssue({ keyPath: windowsKey, desktop: true, exists: false })).toBe("notFound")
    expect(
      resolveImportedKeyIssue({
        keyPath: "/data/guest/.local/share/opencode/ssh-identities/key",
        desktop: false,
        exists: true,
      }),
    ).toBeUndefined()
    expect(
      resolveImportedKeyIssue({
        keyPath: "/data/guest/.local/share/opencode/ssh-identities/key",
        desktop: false,
        exists: false,
      }),
    ).toBe("serverMissing")
    expect(resolveImportedKeyIssue({ keyPath: windowsKey, desktop: true, checkFailed: true })).toBe("unverified")
    expect(importedIdentityStrategy("")).toBe("empty")
    expect(importedIdentityStrategy(windowsKey)).toBe("browserUpload")
    expect(importedIdentityStrategy("/home/onescience/.ssh/id_ed25519")).toBe("serverIngest")
    expect(importedIdentityStrategy("~/.ssh/id_ed25519")).toBe("serverIngest")
  })

  test("loads connection fields from the listed/disk row", () => {
    const listed = { host: "login", remotePath: "/home/onescience2026" }
    expect(
      resolveSshConfigForEdit("aliyun-onescience2026", listed, undefined, {
        "aliyun-onescience2026": { enabled: false },
      }),
    ).toEqual(listed)
    expect(
      resolveSshConfigForEdit("aliyun-onescience2026", listed, undefined, {
        "aliyun-onescience2026": {
          host: "stale",
          remotePath: "/stale",
          submit: { command: "sbatch run.sh" },
          auth: { type: "password", password: "secret" },
        },
      }),
    ).toEqual({
      ...listed,
      auth: { type: "password", password: "secret" },
    })
    expect(
      resolveSshConfigForEdit("aliyun-onescience2026", undefined, { "aliyun-onescience2026": listed }, {
        "aliyun-onescience2026": { enabled: true },
      }),
    ).toEqual(listed)
    expect(
      resolveSshConfigForEdit("aliyun-onescience2026", undefined, undefined, {
        "aliyun-onescience2026": { host: "login", remotePath: "/home/onescience2026" },
      }),
    ).toBeUndefined()
  })

  test("validates required fields and port range", () => {
    expect(validateSshConfigForm(emptySshConfigForm())).toBe("required")
    expect(firstInvalidSshFormField(emptySshConfigForm())).toBe("name")
    expect(
      firstInvalidSshFormField({
        ...emptySshConfigForm(),
        name: "hpc",
      }),
    ).toBe("hostName")
    expect(
      firstInvalidSshFormField({
        ...emptySshConfigForm(),
        name: "hpc",
        hostName: "login.hpc.example.test",
      }),
    ).toBe("username")
    expect(
      firstInvalidSshFormField({
        ...emptySshConfigForm(),
        name: "hpc",
        hostName: "login.hpc.example.test",
        username: "alice",
      }),
    ).toBe("port")
    expect(
      firstInvalidSshFormField({
        ...emptySshConfigForm(),
        name: "hpc",
        hostName: "login.hpc.example.test",
        username: "alice",
        port: "22",
      }),
    ).toBe("keyPath")
    expect(
      firstInvalidSshFormField({
        ...emptySshConfigForm(),
        name: "hpc",
        hostName: "login.hpc.example.test",
        username: "alice",
        port: "22",
        authType: "password",
      }),
    ).toBe("password")
    expect(
      validateSshConfigForm({
        ...emptySshConfigForm(),
        name: "hpc",
        hostName: "login.hpc.example.test",
        username: "alice",
        port: "70000",
      }),
    ).toBe("portInvalid")
    expect(
      validateSshConfigForm({
        ...emptySshConfigForm(),
        name: "hpc",
        hostName: "login.hpc.example.test",
        username: "alice",
        port: "22",
      }),
    ).toBe("keyRequired")
    expect(
      validateSshConfigForm({
        ...emptySshConfigForm(),
        name: "hpc",
        hostName: "login.hpc.example.test",
        username: "alice",
        port: "22",
        authType: "password",
      }),
    ).toBe("passwordRequired")
    expect(
      validateSshConfigForm({
        ...emptySshConfigForm(),
        name: "hpc",
        hostName: "login.hpc.example.test",
        username: "alice",
        port: "22",
        authType: "password",
        password: "secret",
      }),
    ).toBeUndefined()
    expect(
      buildSshConfigEntry({
        ...emptySshConfigForm(),
        name: "hpc",
        hostName: "login.hpc.example.test",
        username: "alice",
        port: "22",
        remotePath: "/work",
        authType: "password",
        password: "secret",
      }).value.auth,
    ).toEqual({ type: "password", password: "secret" })
    expect(visibleSshAuthType("agent")).toBe("key")
    expect(visibleSshAuthType("config")).toBe("key")
    expect(visibleSshAuthType("password")).toBe("password")
    expect(
      buildSshConfigEntry({
        ...emptySshConfigForm(),
        name: "hpc",
        hostName: "login.hpc.example.test",
        username: "alice",
        port: "22",
        remotePath: "/work",
        keyPath: "/data/guest/.ssh/id_ed25519",
      }).value.auth,
    ).toEqual({ type: "key", keyPath: "/data/guest/.ssh/id_ed25519" })
    expect(
      buildSshConfigEntry({
        ...emptySshConfigForm(),
        name: "hpc",
        hostName: "login.hpc.example.test",
        username: "alice",
        port: "22",
        remotePath: "/work",
      }).value.host,
    ).toBe("login.hpc.example.test")
  })
})
