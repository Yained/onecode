import { describe, expect, test } from "bun:test"
import {
  formatRemoteEnvironmentLabel,
  lastMessageRuntimeEnvironment,
  parseRemoteEnvironmentFromText,
  preserveUserMessageEnvironment,
  stripEnvironmentHeader,
  userMessageEnvironment,
} from "./runtime-environment-marker"

const header = (body: string, prompt: string) => `【环境信息】\n${body}\n\n${prompt}`

describe("runtime-environment-marker", () => {
  test("parses SSH remote from the injected environment header", () => {
    expect(parseRemoteEnvironmentFromText(header("SSH 远程 · aliyun-onescience2026\n工作目录：/home/u", "执行 ls"))).toEqual({
      kind: "ssh",
      targetName: "aliyun-onescience2026",
    })
  })

  test("does not mark local prompts", () => {
    expect(parseRemoteEnvironmentFromText("执行 ls 命令")).toBeUndefined()
    expect(userMessageEnvironment({}, [{ type: "text", text: "执行 ls 命令" }])).toBeUndefined()
    expect(formatRemoteEnvironmentLabel(undefined)).toBeUndefined()
  })

  test("strips the environment header from the visible user text", () => {
    expect(stripEnvironmentHeader(header("SSH 远程 · demo\n工作目录：/tmp", "执行 ls 命令"))).toBe("执行 ls 命令")
  })

  test("prefers the optimistic environment field over missing header text", () => {
    expect(
      userMessageEnvironment(
        { environment: { kind: "ssh", targetName: "aliyun-onescience2026" } },
        [{ type: "text", text: "执行 ls 命令" }],
      ),
    ).toEqual({ kind: "ssh", targetName: "aliyun-onescience2026" })
    expect(formatRemoteEnvironmentLabel({ kind: "ssh", targetName: "aliyun-onescience2026" })).toBe(
      "远端 · aliyun-onescience2026",
    )
    expect(formatRemoteEnvironmentLabel({ kind: "local" })).toBeUndefined()
  })

  test("uses the latest user turn as the session runtime environment", () => {
    expect(lastMessageRuntimeEnvironment([])).toBeUndefined()
    expect(
      lastMessageRuntimeEnvironment(
        [
          { id: "msg_1", role: "user" },
          { id: "msg_2", role: "assistant" },
        ],
        { msg_1: [{ type: "text", text: "本地执行" }] },
      ),
    ).toBeUndefined()
    expect(
      lastMessageRuntimeEnvironment(
        [
          { id: "msg_1", role: "user" },
          { id: "msg_2", role: "user" },
        ],
        {
          msg_1: [{ type: "text", text: "本地执行" }],
          msg_2: [{ type: "text", text: header("SSH 远程 · aliyun-onescience2026", "ls") }],
        },
      ),
    ).toEqual({ kind: "ssh", targetName: "aliyun-onescience2026" })
    expect(
      lastMessageRuntimeEnvironment([{ id: "msg_3", role: "assistant" }], {
        msg_3: [{ type: "text", text: "ok" }],
      }),
    ).toBeUndefined()
  })

  test("does not treat SSH turns without a persisted header as local", () => {
    expect(
      lastMessageRuntimeEnvironment([{ id: "msg_1", role: "user" }], {
        msg_1: [{ type: "text", text: "执行 ls 命令" }],
      }),
    ).toBeUndefined()
    expect(
      lastMessageRuntimeEnvironment(
        [
          { id: "msg_1", role: "user", environment: { kind: "ssh", targetName: "cluster-a" } },
          { id: "msg_2", role: "user" },
        ],
        {
          msg_1: [{ type: "text", text: "远端执行" }],
          msg_2: [{ type: "text", text: "继续" }],
        },
      ),
    ).toBeUndefined()
  })

  test("keeps an optimistic environment when the synced message omits it", () => {
    const previous = { id: "msg_1", role: "user" as const, environment: { kind: "ssh" as const, targetName: "cluster-a" } }
    const synced = { id: "msg_1", role: "user" as const }
    expect(preserveUserMessageEnvironment(previous, synced)).toEqual(previous)
    expect(preserveUserMessageEnvironment(synced, synced)).toEqual(synced)
  })
})
