import { describe, expect, test } from "bun:test"
import {
  evaluateOnecodeVersion,
  failedPreflightMessage,
  ONECODE_INSTALL_HINT,
  runWorkspacePreflightChecks,
} from "../../src/control-plane/adapters/ssh-node-preflight"

const remotePath = "/home/onescience2026/onescience/workspaces/cp/acct/proj"

function combined(stdout: string, code = 0, stderr = "") {
  return async () => ({ code, stdout, stderr })
}

describe("workspace preflight checks", () => {
  test("uses a single SSH round-trip", async () => {
    let calls = 0
    const result = await runWorkspacePreflightChecks({
      remotePath,
      controlPlaneId: "cp",
      accountId: "acct",
      run: async () => {
        calls += 1
        return {
          code: 0,
          stdout: ["__SSH_OK__", "__PATH_OK__", "__MARKER_NONE__", "1.14.50-202609191559", "__ONECODE_OK__"].join("\n"),
          stderr: "",
        }
      },
    })
    expect(calls).toBe(1)
    expect(result.checks.every((item) => item.ok && !item.skipped)).toBe(true)
    expect(result.checks[3]?.message).toContain("1.14.50-202609191559")
  })

  test("stops after SSH failure and skips later steps", async () => {
    const result = await runWorkspacePreflightChecks({
      remotePath,
      controlPlaneId: "cp",
      accountId: "acct",
      run: combined("", 255, "Permission denied (publickey)"),
    })
    expect(result.checks.map((item) => [item.id, item.ok, !!item.skipped])).toEqual([
      ["ssh", false, false],
      ["remotePath", true, true],
      ["marker", true, true],
      ["onecode", true, true],
    ])
    expect(result.checks[0]?.message).toContain("Permission denied")
  })

  test("does not treat mkdir failure as an SSH failure", async () => {
    const result = await runWorkspacePreflightChecks({
      remotePath,
      controlPlaneId: "cp",
      accountId: "acct",
      run: combined("__SSH_OK__\n__PATH_FAIL__\n", 0, "mkdir: Permission denied"),
    })
    expect(result.checks[0]).toMatchObject({ id: "ssh", ok: true, message: "SSH 连通" })
    expect(result.checks[1]).toMatchObject({ id: "remotePath", ok: false })
    expect(result.checks.slice(2).every((item) => item.skipped)).toBe(true)
  })

  test("reports each check as the current step", async () => {
    const seen: string[] = []
    await runWorkspacePreflightChecks({
      remotePath,
      controlPlaneId: "cp",
      accountId: "acct",
      run: combined(["__SSH_OK__", "__PATH_OK__", "__MARKER_NONE__", "1.14.50-202609191559", "__ONECODE_OK__"].join("\n")),
      onStep: (id) => seen.push(id),
    })
    expect(seen).toEqual(["ssh", "remotePath", "marker", "onecode"])
  })

  test("reuses a leftover marker from the same control plane and account", async () => {
    const marker = JSON.stringify({
      version: 1,
      workspaceID: "wrk_old",
      controlPlaneId: "cp",
      accountId: "acct",
      projectID: "global",
      createdAt: 1,
    })
    const result = await runWorkspacePreflightChecks({
      remotePath,
      controlPlaneId: "cp",
      accountId: "acct",
      projectID: "prj_current",
      run: combined(
        ["__SSH_OK__", "__PATH_OK__", "__MARKER__", marker, "__MARKER_END__", "1.14.50-202609191559", "__ONECODE_OK__"].join(
          "\n",
        ),
      ),
    })
    expect(result.checks[2]).toMatchObject({
      id: "marker",
      ok: true,
      message: "目录未被占用",
    })
    expect(result.checks[3]?.ok).toBe(true)
    expect(result.markerText).toContain("wrk_old")
  })

  test("rejects onecode builds before the ssh-node CI stamp", async () => {
    const result = await runWorkspacePreflightChecks({
      remotePath,
      controlPlaneId: "cp",
      accountId: "acct",
      run: combined(["__SSH_OK__", "__PATH_OK__", "__MARKER_NONE__", "1.14.50-202609191558", "__ONECODE_OK__"].join("\n")),
    })
    expect(result.checks[3]).toMatchObject({ id: "onecode", ok: false })
    expect(result.checks[3]?.message).toContain("202609191558")
    expect(result.checks[3]?.message).toContain("不低于")
    expect(result.checks[3]?.message).toContain("202609191559")
    expect(result.checks[3]?.message).toContain(ONECODE_INSTALL_HINT)
  })

  test("treats login-node markers as SSH success even when bashrc exits non-zero", async () => {
    const result = await runWorkspacePreflightChecks({
      remotePath,
      controlPlaneId: "cp",
      accountId: "acct",
      createIfMissing: false,
      run: combined("__SSH_OK__ __PATH_OK__ __MARKER_NONE__", 1, "module: command not found"),
    })
    expect(result.checks[0]).toMatchObject({ id: "ssh", ok: true, message: "SSH 连通" })
    expect(result.checks[1]).toMatchObject({ id: "remotePath", ok: true })
    expect(result.checks[2]).toMatchObject({ id: "marker", ok: true })
    expect(result.checks[3]?.ok).toBe(false)
    expect(result.checks[3]?.message).toContain("远端找不到 onecode 命令")
    expect(result.checks[3]?.message).toContain(ONECODE_INSTALL_HINT)
  })

  test("reads concatenated markers from stderr when stdout is empty", async () => {
    const result = await runWorkspacePreflightChecks({
      remotePath,
      controlPlaneId: "cp",
      accountId: "acct",
      run: combined("", 1, "__SSH_OK__\n__PATH_OK__\n__MARKER_NONE__\n1.14.50-202609191559\n__ONECODE_OK__\n"),
    })
    expect(result.checks.every((item) => item.ok && !item.skipped)).toBe(true)
  })

  test("summarizes the first failed check for connect", () => {
    expect(
      failedPreflightMessage([
        { id: "ssh", ok: true, message: "SSH 连通" },
        { id: "remotePath", ok: true, message: "远端目录可写" },
        { id: "marker", ok: true, message: "目录未被占用" },
        {
          id: "onecode",
          ok: false,
          message: `远端找不到 onecode 命令，请先在远端服务器上安装 OneCode CLI\n请在远端服务器执行：${ONECODE_INSTALL_HINT}`,
        },
      ]),
    ).toContain("找不到 onecode")
  })
})

describe("evaluateOnecodeVersion", () => {
  test("accepts the minimum stamp and newer bases", () => {
    expect(evaluateOnecodeVersion("1.14.50-202609191559").ok).toBe(true)
    expect(evaluateOnecodeVersion("1.14.50-202609191600").ok).toBe(true)
    expect(evaluateOnecodeVersion("1.14.51-202608010000").ok).toBe(true)
    expect(evaluateOnecodeVersion("1.15.0").ok).toBe(true)
  })

  test("rejects 1.14.50 below the required stamp", () => {
    expect(evaluateOnecodeVersion("1.14.50").ok).toBe(false)
    expect(evaluateOnecodeVersion("1.14.50-202609191558").ok).toBe(false)
    expect(evaluateOnecodeVersion("1.14.50-202609181347").ok).toBe(false)
    expect(evaluateOnecodeVersion("1.14.50-202609141735").ok).toBe(false)
    expect(evaluateOnecodeVersion("1.14.50-202609141712").ok).toBe(false)
    expect(evaluateOnecodeVersion("1.14.49-202609151200").ok).toBe(false)
    expect(evaluateOnecodeVersion("1.14.50-202609191558").message).toContain(ONECODE_INSTALL_HINT)
  })
})

describe("workspacePreflight source", () => {
  test("resolves HOME without a login shell and returns failed checks instead of throwing", async () => {
    const source = await Bun.file(new URL("../../src/control-plane/adapters/ssh-node-preflight.ts", import.meta.url)).text()
    expect(source).toContain("runRemote(input.config, REMOTE_HOME_SCRIPT, 20_000, { login: false })")
    expect(source.indexOf("beginPreflightProgress(progressKey)")).toBeLessThan(
      source.indexOf("runRemote(input.config, REMOTE_HOME_SCRIPT"),
    )
    const catchBlock = source.slice(source.lastIndexOf("} catch (error)"))
    expect(catchBlock).toContain("return {")
    expect(catchBlock).not.toContain("throw error")
  })
})
