const STORAGE_KEY = "onescience.workbench.pending-action.v1"

export type PendingAction =
  | { type: "install"; resourceId: string }
  | { type: "wizard"; resourceId: string; scenarioId: string; values: Record<string, string>; prompt: string }
  | { type: "prompt"; prompt: string; title?: string; workflow?: string[] }
  | { type: "scenario-run"; scenarioId: string; values: Record<string, string> }
  | { type: "fork"; sessionId: string }

export function stashPendingAction(action: PendingAction) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(action))
}

export function peekPendingAction(): PendingAction | undefined {
  const raw = sessionStorage.getItem(STORAGE_KEY)
  if (!raw) return undefined
  const parsed = JSON.parse(raw) as PendingAction
  return parsed
}

export function consumePendingAction(): PendingAction | undefined {
  const action = peekPendingAction()
  if (!action) return undefined
  sessionStorage.removeItem(STORAGE_KEY)
  return action
}

export function clearPendingAction() {
  sessionStorage.removeItem(STORAGE_KEY)
}
