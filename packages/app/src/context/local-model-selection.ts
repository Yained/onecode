export const MODEL_SELECTION_WORKSPACE_KEY = "__workspace__"

export type ModelSelectionState = {
  agent?: string
  model?: { providerID: string; modelID: string; variant?: string }
  variant?: string | null
  /** True only when the user picked a model in the picker. Implicit GPT defaults must not beat GLM. */
  modelPicked?: boolean
}

export type ModelSelectionSaved = {
  session: Record<string, ModelSelectionState | undefined>
}

export function modelSelectionPersistKey(sessionId: string | undefined) {
  return sessionId || MODEL_SELECTION_WORKSPACE_KEY
}

/** Home-page (no session) picks used to live under pick[__workspace__]; keep them. */
export function migrateModelSelection(value: unknown): ModelSelectionSaved {
  if (!value || typeof value !== "object") return { session: {} }

  const item = value as {
    session?: Record<string, ModelSelectionState | undefined>
    pick?: Record<string, ModelSelectionState | undefined>
  }

  if (item.session && typeof item.session === "object") return { session: item.session }
  if (!item.pick || typeof item.pick !== "object") return { session: {} }

  return { session: { ...item.pick } }
}
