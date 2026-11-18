import { describe, expect, test } from "bun:test"
import {
  countConnectableSshTargets,
  isScnetMcpName,
  listEnabledSshTargets,
  listRegisteredSshTargets,
  resolveExecutionLocationAvailability,
  resolveScnetMcpAvailability,
  sshConnectivityLabel,
  summarizeConnectableSshTargets,
  summarizeRegisteredSshTargets,
  sshTargetPromptFields,
} from "./execution-location"

describe("execution location availability", () => {
  test("detects scnet mcp names", () => {
    expect(isScnetMcpName("scnet")).toBe(true)
    expect(isScnetMcpName("scnet-mcp-server")).toBe(true)
    expect(isScnetMcpName("filesystem")).toBe(false)
  })

  test("lists registered ssh targets from integration config", () => {
    expect(listRegisteredSshTargets({
      ready: { host: "login.example.org", remotePath: "/home/user/work", enabled: true },
      disabled: { host: "old.example.org", remotePath: "/tmp", enabled: false },
      incomplete: { host: "missing-path.example.org", remotePath: "", enabled: true },
    }).map((item) => item.name)).toEqual(["disabled", "ready"])
  })

  test("lists only enabled registered ssh targets for submission", () => {
    expect(listEnabledSshTargets({
      ready: { host: "login.example.org", remotePath: "/home/user/work", enabled: true },
      disabled: { host: "old.example.org", remotePath: "/tmp", enabled: false },
    }).map((item) => item.name)).toEqual(["ready"])
  })

  test("summarizes connectable ssh targets for execution", () => {
    expect(summarizeConnectableSshTargets([
      { name: "a", host: "h1", remotePath: "/a", connectivity: "connected" },
      { name: "b", host: "h2", remotePath: "/b", enabled: false, connectivity: "skipped" },
    ])).toBe("1 个可用")
    expect(summarizeConnectableSshTargets([
      { name: "a", host: "h1", remotePath: "/a", connectivity: "failed" },
    ])).toBe("没有可连通的 SSH 配置")
    expect(summarizeConnectableSshTargets([
      { name: "a", host: "h1", remotePath: "/a", connectivity: "idle" },
    ], true)).toBe("正在检测 SSH 连通性...")
    expect(summarizeConnectableSshTargets([
      { name: "a", host: "h1", remotePath: "/a", connectivity: "idle" },
    ], true, { current: 1, total: 3, name: "cluster-a" })).toBe("正在检测 SSH 连通性（1/3） · cluster-a")
    expect(sshConnectivityLabel("connected")).toBe("可连通")
    expect(sshConnectivityLabel("failed")).toBe("未连通")
  })

  test("requires connected scnet mcp for mcp execution", () => {
    expect(resolveScnetMcpAvailability({}).available).toBe(false)
    expect(resolveScnetMcpAvailability({ "scnet-mcp": { status: "disabled" } }).available).toBe(false)
    expect(resolveScnetMcpAvailability({ "scnet-mcp": { status: "connected" } })).toEqual({
      available: true,
      configured: true,
      connected: true,
      name: "scnet-mcp",
      detail: "已连接 scnet-mcp",
    })
  })

  test("gates slurm ssh and mcp options by capability", () => {
    const availability = resolveExecutionLocationAvailability({
      slurm: { available: true, detail: "slurm 22.05.8 · 分区: debug" },
      registeredSshTargets: [{ name: "cluster", host: "login", remotePath: "/work", connectivity: "connected" }],
      mcp: { available: false, configured: false, connected: false, detail: "未配置 scnet MCP" },
    })
    expect(availability.find((item) => item.id === "ssh-slurm")).toMatchObject({
      enabled: true,
      detail: "1 个可用",
    })
    expect(availability.find((item) => item.id === "mcp")).toMatchObject({
      enabled: false,
      reason: "未配置 scnet MCP",
    })
  })

  test("disables ssh-slurm while connectivity is pending", () => {
    const availability = resolveExecutionLocationAvailability({
      slurm: { available: false, detail: "no slurm" },
      registeredSshTargets: [{ name: "cluster", host: "login", remotePath: "/work", connectivity: "idle" }],
      sshProbeLoading: true,
      mcp: { available: false, configured: false, connected: false, detail: "未配置 scnet MCP" },
    })
    expect(availability.find((item) => item.id === "ssh-slurm")).toMatchObject({
      enabled: false,
      reason: "正在检测 SSH 连通性...",
    })
    expect(countConnectableSshTargets([
      { name: "a", host: "h", remotePath: "/a", connectivity: "connected" },
      { name: "b", host: "h", remotePath: "/b", connectivity: "failed" },
    ])).toBe(1)
  })

  test("builds ssh prompt fields from selected target", () => {
    expect(sshTargetPromptFields({
      name: "cluster-a",
      host: "login",
      username: "alice",
      port: 22,
      remotePath: "/work/alice",
      auth: { type: "key", keyPath: "~/.ssh/id_rsa" },
    })).toEqual([
      "SSH Target: cluster-a",
      "SSH Remote Path: /work/alice",
    ])
  })
})
