import { describe, expect, test } from "bun:test"
import {
  defaultRuntimeEnvironment,
  envKeyOf,
  handoffRenderKey,
  inferSessionBoundEnvironment,
  lastRuntimeEnvironmentFromMessages,
  resetRuntimeEnvironmentForTest,
  resetRuntimeEnvironmentInjectionForTest,
  restoreProjectRuntimeEnvironment,
  applyServerRuntimeEnvironment,
  runtimeEnvironmentFor,
  runtimeEnvironmentInjection,
  runtimeEnvironmentLabel,
  runtimeEnvironmentPromptFields,
  resolveRuntimeEnvironmentSnapshot,
  resolveSessionRuntimeEnvironment,
  sessionCondaEnvFor,
  sessionEnvironmentMismatch,
  setRuntimeEnvironmentFor,
  setSessionBoundEnvironmentFor,
  setSessionCondaEnvFor,
  shouldApplySessionRuntimeEnvironment,
  validateRuntimeEnvironment,
  withRuntimeEnvironmentBatch,
  runtimeEnvironmentRevision,
} from "./runtime-environment"
import { pathKey } from "@/utils/path-key"

describe("runtime environment", () => {
  test("skips revision bump when runtime env is unchanged", () => {
    resetRuntimeEnvironmentForTest()
    setRuntimeEnvironmentFor("D:/work/a", { kind: "ssh", targetName: "cluster-a" })
    const before = localStorage.getItem("onescience.runtime-environment.v1")
    setRuntimeEnvironmentFor("D:/work/a", { kind: "ssh", targetName: "cluster-a" })
    expect(localStorage.getItem("onescience.runtime-environment.v1")).toBe(before)
    expect(runtimeEnvironmentFor("D:/work/a")).toEqual({ kind: "ssh", targetName: "cluster-a" })
    resetRuntimeEnvironmentForTest()
  })

  test("batches project stamps into one revision and localStorage write", () => {
    resetRuntimeEnvironmentForTest()
    const before = runtimeEnvironmentRevision()
    withRuntimeEnvironmentBatch(() => {
      setRuntimeEnvironmentFor("D:/work/a", { kind: "ssh", targetName: "cluster-a" })
      setRuntimeEnvironmentFor("D:/work/b", { kind: "ssh", targetName: "cluster-b" })
      setRuntimeEnvironmentFor("D:/work/c", { kind: "local" })
      expect(runtimeEnvironmentRevision()).toBe(before)
      expect(localStorage.getItem("onescience.runtime-environment.v1")).toBeNull()
    })
    expect(runtimeEnvironmentRevision()).toBe(before + 1)
    expect(runtimeEnvironmentFor("D:/work/a")).toEqual({ kind: "ssh", targetName: "cluster-a" })
    expect(runtimeEnvironmentFor("D:/work/b")).toEqual({ kind: "ssh", targetName: "cluster-b" })
    expect(JSON.parse(localStorage.getItem("onescience.runtime-environment.v1") ?? "{}")).toMatchObject({
      [pathKey("D:/work/a")]: { kind: "ssh", targetName: "cluster-a" },
    })
    resetRuntimeEnvironmentForTest()
  })

  test("persists selection per directory", () => {
    resetRuntimeEnvironmentForTest()
    expect(runtimeEnvironmentFor("D:/work/a")).toEqual({ kind: "local" })
    setRuntimeEnvironmentFor("D:/work/a", { kind: "ssh", targetName: "cluster-a" })
    setRuntimeEnvironmentFor("D:/work/b", { kind: "scnet", serverName: "scnet-mcp" })
    expect(runtimeEnvironmentFor("D:/work/a")).toEqual({ kind: "ssh", targetName: "cluster-a" })
    expect(runtimeEnvironmentFor("D:\\work\\a")).toEqual({ kind: "ssh", targetName: "cluster-a" })
    expect(runtimeEnvironmentFor("D:/work/b")).toEqual({ kind: "scnet", serverName: "scnet-mcp" })
    expect(runtimeEnvironmentFor("D:/work/c")).toEqual({ kind: "local" })
    resetRuntimeEnvironmentForTest()
  })

  test("restores ssh evidence onto a missing local project but never rewrites ssh to local", () => {
    resetRuntimeEnvironmentForTest()
    expect(restoreProjectRuntimeEnvironment("D:/work/proj", { kind: "local" })).toBe(false)
    expect(restoreProjectRuntimeEnvironment("D:/work/proj", { kind: "ssh", targetName: "core1-hanmk_sq" })).toBe(true)
    expect(runtimeEnvironmentFor("D:/work/proj")).toEqual({ kind: "ssh", targetName: "core1-hanmk_sq" })
    expect(restoreProjectRuntimeEnvironment("D:/work/proj", { kind: "ssh", targetName: "other" })).toBe(false)
    expect(restoreProjectRuntimeEnvironment("D:/work/proj", { kind: "local" })).toBe(false)
    expect(runtimeEnvironmentFor("D:/work/proj")).toEqual({ kind: "ssh", targetName: "core1-hanmk_sq" })
    resetRuntimeEnvironmentForTest()
  })

  test("keeps the reserved default project local even without an auth session", () => {
    resetRuntimeEnvironmentForTest()
    setRuntimeEnvironmentFor("D:/data/workspaces/acct/default", { kind: "ssh", targetName: "aliyun" })
    expect(runtimeEnvironmentFor("D:/data/workspaces/acct/default")).toEqual({ kind: "local" })
    expect(restoreProjectRuntimeEnvironment("D:/data/workspaces/acct/default", { kind: "ssh", targetName: "aliyun" })).toBe(
      false,
    )
    resetRuntimeEnvironmentForTest()
  })

  test("does not restore ssh evidence over an explicit server-local project", () => {
    resetRuntimeEnvironmentForTest()
    applyServerRuntimeEnvironment("D:/work/local", { kind: "local" })
    expect(restoreProjectRuntimeEnvironment("D:/work/local", { kind: "ssh", targetName: "core1" })).toBe(false)
    expect(runtimeEnvironmentFor("D:/work/local")).toEqual({ kind: "local" })
    resetRuntimeEnvironmentForTest()
  })

  test("builds stable env keys", () => {
    expect(envKeyOf({ kind: "local" })).toBe("local")
    expect(envKeyOf({ kind: "ssh", targetName: "a" })).toBe("ssh:a")
    expect(envKeyOf({ kind: "scnet" })).toBe("scnet:")
    expect(envKeyOf({ kind: "scnet", serverName: "m" })).toBe("scnet:m")
    expect(envKeyOf(defaultRuntimeEnvironment())).toBe("local")
    expect(handoffRenderKey({ kind: "local" })).toBe("local:")
    expect(handoffRenderKey({ kind: "ssh", targetName: "a" }, { condaEnv: "py311" })).toBe("ssh:a:::py311")
    expect(
      handoffRenderKey(
        { kind: "ssh", targetName: "a" },
        { sshTarget: { name: "a", host: "login", remotePath: "/work" }, condaEnv: "py311" },
      ),
    ).toBe("ssh:a:login:/work:py311")
  })

  test("labels environments for display", () => {
    expect(runtimeEnvironmentLabel({ kind: "local" })).toBe("本地运行")
    expect(runtimeEnvironmentLabel({ kind: "ssh", targetName: "cluster-a" })).toBe("SSH: cluster-a")
    expect(runtimeEnvironmentLabel({ kind: "scnet" })).toBe("SCNet")
    expect(runtimeEnvironmentLabel({ kind: "scnet", serverName: "m" })).toBe("SCNet: m")
  })

  test("persists optional session conda env per directory and runtime env", () => {
    resetRuntimeEnvironmentForTest()
    const ssh = { kind: "ssh" as const, targetName: "cluster-a" }
    expect(sessionCondaEnvFor("D:/work/a", ssh)).toBe("")
    setSessionCondaEnvFor("D:/work/a", ssh, "onescience311")
    expect(sessionCondaEnvFor("D:/work/a", ssh)).toBe("onescience311")
    expect(sessionCondaEnvFor("D:\\work\\a", ssh)).toBe("onescience311")
    expect(sessionCondaEnvFor("D:/work/a", { kind: "local" })).toBe("")
    setSessionCondaEnvFor("D:/work/a", ssh, "  ")
    expect(sessionCondaEnvFor("D:/work/a", ssh)).toBe("")
    resetRuntimeEnvironmentForTest()
  })

  test("keeps ssh binding invalid when the target is missing or disabled", () => {
    const scnet = { available: false, configured: false, connected: false, detail: "未配置 scnet MCP" }
    expect(validateRuntimeEnvironment({ kind: "ssh", targetName: "gone" }, { sshTargets: [], scnet })).toMatchObject({
      env: { kind: "ssh", targetName: "gone" },
      valid: false,
    })
    expect(
      validateRuntimeEnvironment(
        { kind: "ssh", targetName: "off" },
        { sshTargets: [{ name: "off", enabled: false }], scnet },
      ),
    ).toMatchObject({ env: { kind: "ssh", targetName: "off" }, valid: false })
    expect(
      validateRuntimeEnvironment(
        { kind: "ssh", targetName: "on" },
        { sshTargets: [{ name: "on", enabled: true }], scnet },
      ),
    ).toMatchObject({ env: { kind: "ssh", targetName: "on" }, valid: true })
  })

  test("keeps scnet selection but reports when disconnected", () => {
    const disconnected = { available: false, configured: true, connected: false, name: "scnet-mcp", detail: "scnet MCP 已配置但未连接" }
    const result = validateRuntimeEnvironment({ kind: "scnet" }, { sshTargets: [], scnet: disconnected })
    expect(result.valid).toBe(false)
    expect(result.env).toEqual({ kind: "scnet" })
    const connected = { available: true, configured: true, connected: true, name: "scnet-mcp", detail: "已连接 scnet-mcp" }
    expect(validateRuntimeEnvironment({ kind: "scnet" }, { sshTargets: [], scnet: connected }).valid).toBe(true)
  })

  test("builds prompt fields per environment", () => {
    expect(runtimeEnvironmentPromptFields({ kind: "local" }, { directory: "D:/work/proj" })).toEqual([])

    const ssh = runtimeEnvironmentPromptFields(
      { kind: "ssh", targetName: "cluster-a" },
      {
        directory: "D:/work/proj",
        sshTarget: {
          name: "cluster-a",
          host: "login",
          username: "alice",
          remotePath: "/work/alice",
          auth: { type: "key", keyPath: "/secret/id_rsa" },
        },
        condaEnv: "onescience311",
      },
    )
    expect(ssh).toEqual(["SSH 远程 · cluster-a", "工作目录：/work/alice", "Conda：onescience311"])
    const sshText = ssh.join("\n")
    expect(sshText).not.toContain("ls")
    expect(sshText).not.toContain("hostname")
    expect(sshText).not.toContain("login")
    expect(sshText).not.toContain("/secret/id_rsa")

    const missing = runtimeEnvironmentPromptFields({ kind: "ssh", targetName: "gone" }, { directory: "D:/work/proj" })
    expect(missing[0]).toContain("配置缺失")

    const scnet = runtimeEnvironmentPromptFields(
      { kind: "scnet" },
      { directory: "D:/work/proj", scnet: { available: true, configured: true, connected: true, name: "scnet-mcp", detail: "" } },
    )
    expect(scnet[0]).toContain("SCNet 远程 · scnet-mcp")
  })

  test("injects scnet header and skips local and ssh", () => {
    resetRuntimeEnvironmentInjectionForTest()
    const ctx = { directory: "D:/work/proj" }
    expect(runtimeEnvironmentInjection({ scope: "s1", env: { kind: "local" }, ctx })).toBeUndefined()
    expect(
      runtimeEnvironmentInjection({
        scope: "s1",
        env: { kind: "ssh", targetName: "cluster-a" },
        ctx: { ...ctx, sshTarget: { name: "cluster-a", host: "login", remotePath: "/work/alice" } },
      }),
    ).toBeUndefined()

    const scnet = runtimeEnvironmentInjection({
      scope: "s1",
      env: { kind: "scnet", serverName: "scnet-mcp" },
      ctx: { ...ctx, scnet: { available: true, configured: true, connected: true, name: "scnet-mcp", detail: "" } },
    })
    expect(scnet?.header).toContain("【环境信息】")
    expect(scnet?.header).toContain("SCNet 远程 · scnet-mcp")
    resetRuntimeEnvironmentInjectionForTest()
  })

  test("maps the latest user turn to a runtime environment", () => {
    const header = (body: string, prompt: string) => `【环境信息】\n${body}\n\n${prompt}`
    expect(lastRuntimeEnvironmentFromMessages([])).toBeUndefined()
    expect(
      lastRuntimeEnvironmentFromMessages([{ id: "msg_1", role: "assistant" }], {
        msg_1: [{ type: "text", text: "ok" }],
      }),
    ).toBeUndefined()
    expect(
      lastRuntimeEnvironmentFromMessages([{ id: "msg_1", role: "user" }], {
        msg_1: [{ type: "text", text: "本地执行" }],
      }),
    ).toBeUndefined()
    expect(
      lastRuntimeEnvironmentFromMessages(
        [
          { id: "msg_1", role: "user" },
          { id: "msg_2", role: "user" },
        ],
        {
          msg_1: [{ type: "text", text: "本地执行" }],
          msg_2: [{ type: "text", text: header("SSH 远程 · cluster-a", "ls") }],
        },
      ),
    ).toEqual({ kind: "ssh", targetName: "cluster-a" })
    expect(
      lastRuntimeEnvironmentFromMessages([{ id: "msg_1", role: "user" }], {
        msg_1: [{ type: "text", text: header("SCNet 远程 · scnet-mcp", "run") }],
      }),
    ).toEqual({ kind: "scnet", serverName: "scnet-mcp" })
  })

  test("does not overwrite a stored SSH selection from header-less user turns", () => {
    resetRuntimeEnvironmentForTest()
    setRuntimeEnvironmentFor("D:/work/proj", { kind: "ssh", targetName: "cluster-a" })
    const inferred = lastRuntimeEnvironmentFromMessages([{ id: "msg_1", role: "user" }], {
      msg_1: [{ type: "text", text: "继续远端任务" }],
    })
    expect(inferred).toBeUndefined()
    expect(runtimeEnvironmentFor("D:/work/proj")).toEqual({ kind: "ssh", targetName: "cluster-a" })
    resetRuntimeEnvironmentForTest()
  })

  test("defaults a session to local when the latest turn has no environment record", () => {
    expect(resolveSessionRuntimeEnvironment([])).toEqual({ env: { kind: "local" }, ready: true, source: "default" })
    expect(
      resolveSessionRuntimeEnvironment([{ id: "msg_1", role: "user" }], {
        msg_1: [{ type: "text", text: "本地执行" }],
      }),
    ).toEqual({ env: { kind: "local" }, ready: true, source: "default" })
    expect(resolveSessionRuntimeEnvironment([{ id: "msg_1", role: "user" }])).toEqual({
      env: { kind: "local" },
      ready: false,
      source: "default",
    })
    expect(
      resolveSessionRuntimeEnvironment([{ id: "msg_1", role: "user", environment: { kind: "ssh", targetName: "cluster-a" } }]),
    ).toEqual({ env: { kind: "ssh", targetName: "cluster-a" }, ready: true, source: "explicit" })
    expect(
      resolveSessionRuntimeEnvironment([{ id: "msg_1", role: "user", environment: { kind: "local" } }]),
    ).toEqual({ env: { kind: "local" }, ready: true, source: "explicit" })
  })

  test("does not unbind a live SSH workspace from missing environment metadata", () => {
    const current = { kind: "ssh" as const, targetName: "cluster-a" }
    const binding = { targetName: "cluster-a", workspaceID: "wrk_1" }
    expect(
      shouldApplySessionRuntimeEnvironment({
        resolved: { env: { kind: "local" }, ready: true, source: "default" },
        current,
        binding,
      }),
    ).toBe(false)
    expect(
      shouldApplySessionRuntimeEnvironment({
        resolved: { env: { kind: "local" }, ready: true, source: "explicit" },
        current,
        binding,
      }),
    ).toBe(true)
    expect(
      shouldApplySessionRuntimeEnvironment({
        resolved: { env: { kind: "local" }, ready: true, source: "default" },
        current,
      }),
    ).toBe(true)
  })

  test("switches to local when opening a local transcript while SSH is still connected", () => {
    const current = { kind: "ssh" as const, targetName: "cluster-a" }
    const binding = { targetName: "cluster-a", workspaceID: "wrk_1" }
    expect(
      shouldApplySessionRuntimeEnvironment({
        resolved: { env: { kind: "local" }, ready: true, source: "default" },
        current,
        binding,
        hasUserTurns: true,
      }),
    ).toBe(true)
    expect(
      shouldApplySessionRuntimeEnvironment({
        resolved: { env: { kind: "local" }, ready: true, source: "default" },
        current,
        binding,
        hasUserTurns: true,
        sessionWorkspaceID: "wrk_1",
      }),
    ).toBe(false)
    expect(
      shouldApplySessionRuntimeEnvironment({
        resolved: { env: { kind: "local" }, ready: true, source: "default" },
        current,
        binding,
        hasUserTurns: false,
      }),
    ).toBe(false)
  })

  test("keeps a stored SSH selection while the target list is still empty", () => {
    resetRuntimeEnvironmentForTest()
    setRuntimeEnvironmentFor("D:/work/proj", { kind: "ssh", targetName: "cluster-a" })
    const snapshot = resolveRuntimeEnvironmentSnapshot({ directory: "D:/work/proj", ssh: {} })
    expect(snapshot.env).toEqual({ kind: "ssh", targetName: "cluster-a" })
    expect(snapshot.sshTarget).toBeUndefined()
    resetRuntimeEnvironmentForTest()
  })

  test("keeps a stored SSH selection when the named target is missing from a loaded list", () => {
    resetRuntimeEnvironmentForTest()
    setRuntimeEnvironmentFor("D:/work/proj", { kind: "ssh", targetName: "cluster-a" })
    const snapshot = resolveRuntimeEnvironmentSnapshot({
      directory: "D:/work/proj",
      ssh: { other: { name: "other", host: "login", remotePath: "/work" } },
    })
    expect(snapshot.env).toEqual({ kind: "ssh", targetName: "cluster-a" })
    expect(snapshot.sshTarget).toBeUndefined()
    resetRuntimeEnvironmentForTest()
  })

  test("does not persist a validation fallback that would rewrite ssh to local", async () => {
    const source = await Bun.file(new URL("./runtime-environment.ts", import.meta.url)).text()
    expect(source).not.toContain("setRuntimeEnvironmentFor(dir, result.env)")
    expect(source).toContain('if (storedEnv.kind === "ssh") return storedEnv')
  })

  test("binds a session to the environment it first ran in", () => {
    resetRuntimeEnvironmentForTest()
    expect(
      inferSessionBoundEnvironment({
        sessionID: "ses_new",
        messages: [],
      }),
    ).toBeUndefined()
    expect(
      inferSessionBoundEnvironment({
        sessionID: "ses_local",
        messages: [{ id: "msg_1", role: "user" }],
      }),
    ).toEqual({ kind: "local" })
    expect(
      inferSessionBoundEnvironment({
        sessionID: "ses_ssh",
        messages: [{ id: "msg_1", role: "user", environment: { kind: "ssh", targetName: "cluster-a" } }],
      }),
    ).toEqual({ kind: "ssh", targetName: "cluster-a" })
    setSessionBoundEnvironmentFor("ses_stamp", { kind: "ssh", targetName: "cluster-a" })
    expect(
      inferSessionBoundEnvironment({
        sessionID: "ses_stamp",
        messages: [{ id: "msg_1", role: "user", environment: { kind: "local" } }],
      }),
    ).toEqual({ kind: "ssh", targetName: "cluster-a" })
    expect(sessionEnvironmentMismatch({ kind: "local" }, { kind: "ssh", targetName: "cluster-a" })).toBe(true)
    expect(sessionEnvironmentMismatch(undefined, { kind: "ssh", targetName: "cluster-a" })).toBe(false)
    resetRuntimeEnvironmentForTest()
  })
})
