import {
  ONESCIENCE_GLM_MODEL_ID,
  ONESCIENCE_GPT_MODEL_ID,
  ONESCIENCE_PROVIDER_ID,
} from "@opencode-ai/ui/onescience-model-label"

/** Ranking used to pick a default from OpenCode's free catalog. Later entries win. */
const FREE_MODEL_PRIORITY = ["gpt-5", "claude-sonnet-4", "big-pickle", "gemini-3-pro"] as const

type FreeCandidate = { id: string; cost?: { input?: number } | null }
type ModelKey = { providerID: string; modelID: string }

function rank(id: string) {
  return FREE_MODEL_PRIORITY.findIndex((filter) => id.includes(filter))
}

function compareFreeModels(a: FreeCandidate, b: FreeCandidate) {
  const byPriority = rank(b.id) - rank(a.id)
  if (byPriority !== 0) return byPriority
  const aLatest = a.id.includes("latest") ? 0 : 1
  const bLatest = b.id.includes("latest") ? 0 : 1
  if (aLatest !== bLatest) return aLatest - bLatest
  if (a.id === b.id) return 0
  return a.id < b.id ? 1 : -1
}

/** Pick the first sorted free model from an OpenCode provider catalog. */
export function pickPreferredFreeModelID(models: Iterable<FreeCandidate>): string | undefined {
  const free = [...models].filter((item) => (item.cost?.input ?? 0) <= 0)
  if (free.length === 0) return
  free.sort(compareFreeModels)
  return free[0]?.id
}

/** Default order: OneScience GLM, then GPT, then the first OpenCode free model. */
export function defaultFreeModelCandidates(input: {
  onescienceModels?: Iterable<string>
  opencode?: { id: string; models: Iterable<FreeCandidate> }
}): ModelKey[] {
  const onescience = new Set(input.onescienceModels ?? [])
  const next: ModelKey[] = []
  if (onescience.has(ONESCIENCE_GLM_MODEL_ID)) {
    next.push({ providerID: ONESCIENCE_PROVIDER_ID, modelID: ONESCIENCE_GLM_MODEL_ID })
  }
  if (onescience.has(ONESCIENCE_GPT_MODEL_ID)) {
    next.push({ providerID: ONESCIENCE_PROVIDER_ID, modelID: ONESCIENCE_GPT_MODEL_ID })
  }
  if (input.opencode) {
    const preferred = pickPreferredFreeModelID(input.opencode.models)
    if (preferred) next.push({ providerID: input.opencode.id, modelID: preferred })
  }
  return next
}

/** True when `saved` is a later automatic default than `preferred` (e.g. GPT while GLM exists). */
export function isWeakerAutomaticDefault(saved: ModelKey, preferred: ModelKey, candidates: ModelKey[]) {
  const preferredIndex = candidates.findIndex(
    (item) => item.providerID === preferred.providerID && item.modelID === preferred.modelID,
  )
  const savedIndex = candidates.findIndex(
    (item) => item.providerID === saved.providerID && item.modelID === saved.modelID,
  )
  if (preferredIndex < 0 || savedIndex < 0) return false
  return savedIndex > preferredIndex
}
