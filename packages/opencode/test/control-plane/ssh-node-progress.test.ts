import { describe, expect, test } from "bun:test"
import {
  beginConnectProgress,
  beginPreflightProgress,
  connectProgressKey,
  finishConnectProgress,
  getConnectProgress,
  isConnectProgressComplete,
  markConnectStep,
  markPreflightStep,
  preflightProgressKey,
  setConnectStepDetail,
} from "../../src/control-plane/adapters/ssh-node-progress"

describe("ssh-node connect progress", () => {
  test("tracks the current connect step", () => {
    const key = connectProgressKey("aliyun", "/data/ws/default")
    beginConnectProgress(key)
    expect(getConnectProgress(key).map((item) => item.status)).toEqual([
      "current",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ])
    markConnectStep(key, "serve")
    expect(getConnectProgress(key).map((item) => `${item.id}:${item.status}`)).toEqual([
      "preflight:ok",
      "prepare:ok",
      "serve:current",
      "health:pending",
      "tunnel:pending",
      "init:pending",
    ])
    markConnectStep(key, "health")
    finishConnectProgress(key, false)
    expect(getConnectProgress(key).find((item) => item.id === "health")?.status).toBe("fail")
    expect(getConnectProgress(key).find((item) => item.id === "health")?.message).toBe("确认服务已启动")
    expect(getConnectProgress(key).find((item) => item.id === "tunnel")?.status).toBe("pending")
    expect(getConnectProgress(key).find((item) => item.id === "init")?.status).toBe("pending")
  })

  test("tracks the current preflight step", () => {
    const key = preflightProgressKey("aliyun", "/data/ws/default")
    beginPreflightProgress(key)
    expect(getConnectProgress(key).map((item) => `${item.id}:${item.status}`)).toEqual([
      "ssh:current",
      "remotePath:pending",
      "marker:pending",
      "onecode:pending",
    ])
    markPreflightStep(key, "marker")
    expect(getConnectProgress(key).map((item) => `${item.id}:${item.status}`)).toEqual([
      "ssh:ok",
      "remotePath:ok",
      "marker:current",
      "onecode:pending",
    ])
    finishConnectProgress(key, true)
    expect(getConnectProgress(key).every((item) => item.status === "ok")).toBe(true)
  })

  test("a finished connect is complete so retunnel cannot rewind it", () => {
    const key = connectProgressKey("aliyun", "/data/ws/done")
    beginConnectProgress(key)
    expect(isConnectProgressComplete(key)).toBe(false)
    markConnectStep(key, "tunnel")
    finishConnectProgress(key, true)
    expect(isConnectProgressComplete(key)).toBe(true)
    markConnectStep(key, "health")
    expect(getConnectProgress(key).every((item) => item.status === "ok")).toBe(true)
  })

  test("keeps a current-step detail while the long init wait runs", () => {
    const key = connectProgressKey("aliyun", "/data/ws/detail")
    beginConnectProgress(key)
    markConnectStep(key, "serve")
    setConnectStepDetail(key, "serve", "等待远端 serve 监听")
    markConnectStep(key, "init")
    setConnectStepDetail(key, "init", "正在准备 OneSkills")
    expect(getConnectProgress(key).find((item) => item.id === "serve")?.detail).toBeUndefined()
    expect(getConnectProgress(key).find((item) => item.id === "init")).toEqual({
      id: "init",
      message: "初始化远端环境",
      status: "current",
      detail: "正在准备 OneSkills",
    })
  })
})
