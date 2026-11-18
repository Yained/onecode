/**
 * Preset case session IDs — must stay 1:1 with:
 * - session-seed/manifest.json
 * - case cards in onescience.tsx (caseCard / caseShowcases)
 */
export const PRESET_CASE_SESSION_IDS = [
  "ses_10346f0acffeC6AHvtobK5pHFs", // CFDBench
  "ses_103137ca7ffeO7q8BnYiPP3L2q", // ESM-2
  "ses_10336b7f1ffeL2BZqW7OT8eNMs", // FourCastNet
  "ses_103251332ffelcaGi7spx1esL9", // FuXi train
  "ses_09102687affe6WEyKzrDV0i5tJ", // MACE smoke
  "ses_090e3ee94ffeOUHq4ZepQ8DKHs", // MatRIS
  "ses_090bb739bffevzX4Zf7pBxuD16", // MACE water PES
  "ses_1037cc763ffeMfaaYQ6CQdmbrq", // MeshGraphNet
  "ses_1033535eaffeFd2OKFwlyBG9bl", // ProteinMPNN
  "ses_12c59a12fffe4xD0VPNsTHQ2iO", // RAE2822 FNO
  "ses_130857560ffebRRVOorz8TBEXI", // AIFS repro
  "ses_1109c4216ffe02IxWfmOd93yyu", // FuXi forecast smoke
  "ses_12afd8b95ffeFdtfOOORfsnETp", // FuXi run test
  "ses_173de5f78ffemATonCgBtx7ECA", // ocean-atmo fusion
  "ses_131e650f7ffejnFYPuWmd1TBPr", // xihe parallel
  "ses_10bffedbbffeAnlewduYPOpjBz", // NS benchmark
] as const

export const PRESET_CASE_SESSION_ID_SET = new Set<string>(PRESET_CASE_SESSION_IDS)

export function isPresetCaseSessionId(sessionId: string | undefined | null) {
  if (!sessionId) return false
  return PRESET_CASE_SESSION_ID_SET.has(sessionId)
}

/** Order sessions to match the preset catalog (unknown ids last). */
export function sortPresetCaseSessions<T extends { id: string }>(sessions: T[]) {
  const order = new Map<string, number>(PRESET_CASE_SESSION_IDS.map((id, index) => [id, index]))
  return [...sessions].sort((a, b) => (order.get(a.id) ?? 10_000) - (order.get(b.id) ?? 10_000))
}
