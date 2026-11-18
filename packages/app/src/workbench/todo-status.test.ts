import { describe, expect, test } from "bun:test"
import type { Todo } from "@opencode-ai/sdk/v2"
import { matchTodoForStep, workflowStepStatus } from "./todo-status"

function todo(content: string, status: Todo["status"]): Todo {
  return { content, status, priority: "medium" }
}

describe("workflowStepStatus", () => {
  const steps = ["加载 checkpoint", "单点推理", "检查能量与力"]

  test("stays pending when agent has no todos", () => {
    expect(workflowStepStatus(steps, [], 0)).toBe("pending")
    expect(workflowStepStatus(steps, [], 2)).toBe("pending")
  })

  test("prefers content match over order", () => {
    const todos = [todo("正在检查能量与力结果", "in_progress"), todo("加载 checkpoint 完成", "completed")]
    expect(workflowStepStatus(steps, todos, 0)).toBe("completed")
    expect(workflowStepStatus(steps, todos, 2)).toBe("in_progress")
  })

  test("falls back to sequential completion", () => {
    const todos = [todo("step-a", "completed"), todo("step-b", "in_progress")]
    expect(workflowStepStatus(steps, todos, 0)).toBe("completed")
    expect(workflowStepStatus(steps, todos, 1)).toBe("in_progress")
    expect(workflowStepStatus(steps, todos, 2)).toBe("pending")
  })
})

describe("matchTodoForStep", () => {
  test("matches overlapping chinese text", () => {
    const matched = matchTodoForStep("加载 checkpoint", [todo("检查并加载 checkpoint", "pending")])
    expect(matched?.content).toBe("检查并加载 checkpoint")
  })
})
