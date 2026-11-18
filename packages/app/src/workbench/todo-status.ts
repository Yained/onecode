import type { Todo } from "@opencode-ai/sdk/v2"

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[\d]+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
}

function overlapScore(a: string, b: string) {
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length)
  return 0
}

export function matchTodoForStep(step: string, todos: Todo[]) {
  const needle = normalize(step)
  if (!needle) return undefined

  let best: { todo: Todo; score: number } | undefined
  for (const todo of todos) {
    const score = overlapScore(needle, normalize(todo.content))
    if (score < 0.35) continue
    if (!best || score > best.score) best = { todo, score }
  }
  return best?.todo
}

export function workflowStepStatus(steps: string[], todos: Todo[], index: number): Todo["status"] {
  const step = steps[index]
  if (!step) return "pending"

  const matched = matchTodoForStep(step, todos)
  if (matched) return matched.status

  if (todos.length === 0) return "pending"

  const completed = todos.filter((todo) => todo.status === "completed" || todo.status === "cancelled").length
  const hasInProgress = todos.some((todo) => todo.status === "in_progress")
  if (index < completed) return "completed"
  if (index === completed && hasInProgress) return "in_progress"
  return "pending"
}
