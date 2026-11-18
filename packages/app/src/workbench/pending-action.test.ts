import { describe, expect, test, beforeEach } from "bun:test"
import { stashPendingAction, consumePendingAction, peekPendingAction, clearPendingAction } from "./pending-action"
import { requirePersonalSpace } from "./require-auth"

describe("pending action", () => {
  beforeEach(() => {
    sessionStorage.clear()
    consumePendingAction()
  })

  test("stores and consumes once", () => {
    stashPendingAction({ type: "install", resourceId: "mace" })
    expect(peekPendingAction()?.type).toBe("install")
    expect(consumePendingAction()).toEqual({ type: "install", resourceId: "mace" })
    expect(consumePendingAction()).toBeUndefined()
  })

  test("stores wizard payload", () => {
    const action = {
      type: "wizard" as const,
      resourceId: "mace",
      scenarioId: "train",
      values: { epochs: "10" },
      prompt: "Run training",
    }
    stashPendingAction(action)
    expect(peekPendingAction()).toEqual(action)
  })

  test("clearPendingAction removes stashed action", () => {
    stashPendingAction({ type: "install", resourceId: "mace" })
    clearPendingAction()
    expect(peekPendingAction()).toBeUndefined()
  })
})

describe("requirePersonalSpace", () => {
  beforeEach(() => {
    sessionStorage.clear()
    consumePendingAction()
  })

  test("returns true when logged in", () => {
    const navigated: string[] = []
    const result = requirePersonalSpace({
      navigate: (href) => navigated.push(href),
      action: { type: "install", resourceId: "mace" },
      isLoggedIn: true,
    })
    expect(result).toBe(true)
    expect(navigated).toEqual([])
    expect(peekPendingAction()).toBeUndefined()
  })

  test("stashes action and navigates to login when logged out", () => {
    const navigated: string[] = []
    const action = { type: "install" as const, resourceId: "mace" }
    const result = requirePersonalSpace({
      navigate: (href) => navigated.push(href),
      action,
      isLoggedIn: false,
    })
    expect(result).toBe(false)
    expect(navigated).toEqual(["/login?redirect=%2Fworkspace%2Fcapabilities"])
    expect(peekPendingAction()).toEqual(action)
  })

  test("defaults redirect to the current browse page when available", () => {
    const navigated: string[] = []
    const pathname = Object.getOwnPropertyDescriptor(location, "pathname")
    const search = Object.getOwnPropertyDescriptor(location, "search")
    const hash = Object.getOwnPropertyDescriptor(location, "hash")
    Object.defineProperty(location, "pathname", { configurable: true, value: "/workspace/capabilities/mace" })
    Object.defineProperty(location, "search", { configurable: true, value: "" })
    Object.defineProperty(location, "hash", { configurable: true, value: "" })
    try {
      requirePersonalSpace({
        navigate: (href) => navigated.push(href),
        action: { type: "install", resourceId: "mace" },
        isLoggedIn: false,
      })
      expect(navigated).toEqual(["/login?redirect=%2Fworkspace%2Fcapabilities%2Fmace"])
    } finally {
      if (pathname) Object.defineProperty(location, "pathname", pathname)
      if (search) Object.defineProperty(location, "search", search)
      if (hash) Object.defineProperty(location, "hash", hash)
    }
  })

  test("uses custom redirect for welcome prompt gate", () => {
    const navigated: string[] = []
    requirePersonalSpace({
      navigate: (href) => navigated.push(href),
      action: { type: "prompt", prompt: "hello" },
      isLoggedIn: false,
      redirect: "/workspace",
    })
    expect(navigated).toEqual(["/login?redirect=%2Fworkspace"])
  })
})
