import type { SelectedLineRange } from "@/context/file"
import { createSignal } from "solid-js"
import type { RuntimeEnvironment } from "@/components/onescience/runtime-environment"
import type { SshTargetOption } from "@/components/onescience/execution-location"

export type HandoffSkill = {
  name: string
  title: string
}

export type HandoffPromptContext = {
  sshTarget?: SshTargetOption
  condaEnv?: string
}

export type HandoffPromptTemplate = (env: RuntimeEnvironment, ctx?: HandoffPromptContext) => string

export type AppliedHandoffTemplate = {
  template: HandoffPromptTemplate
  renderedText: string
  envKey: string
}

type HandoffSession = {
  prompt: string
  files: Record<string, SelectedLineRange | null>
  skill?: HandoffSkill
  autostart?: boolean
  draftSeq?: number
  promptTemplate?: HandoffPromptTemplate
  /** Raw catalog ids to bind as session chips once a session id exists. */
  rawIds?: string[]
}

const MAX = 40

const store = {
  session: new Map<string, HandoffSession>(),
  terminal: new Map<string, string[]>(),
  appliedDraftSeq: new Map<string, number>(),
  appliedTemplates: new Map<string, AppliedHandoffTemplate>(),
}

export const setAppliedHandoffTemplate = (key: string, value: AppliedHandoffTemplate) => {
  touch(store.appliedTemplates, key, value)
}

export const getAppliedHandoffTemplate = (key: string) => store.appliedTemplates.get(key)

export const clearAppliedHandoffTemplate = (key: string) => {
  store.appliedTemplates.delete(key)
}

let handoffDraftSeq = 0
let lastAppliedHandoffText: string | undefined
const [handoffDraftRevision, setHandoffDraftRevision] = createSignal(0)

export const sessionHandoffRevision = () => handoffDraftRevision()

const touch = <K, V>(map: Map<K, V>, key: K, value: V) => {
  map.delete(key)
  map.set(key, value)
  while (map.size > MAX) {
    const first = map.keys().next().value
    if (first === undefined) return
    map.delete(first)
  }
}

export const setSessionHandoff = (key: string, patch: Partial<HandoffSession>) => {
  const prev = store.session.get(key) ?? { prompt: "", files: {} }
  touch(store.session, key, { ...prev, ...patch })
}

export const getSessionHandoff = (key: string) => store.session.get(key)

export const pushSessionHandoffDraft = (
  key: string,
  prompt: string,
  options?: {
    skill?: HandoffSkill
    template?: HandoffPromptTemplate
    rawIds?: string[]
  },
) => {
  handoffDraftSeq += 1
  const draftSeq = handoffDraftSeq
  lastAppliedHandoffText = undefined
  store.appliedTemplates.delete(key)
  setSessionHandoff(key, {
    prompt,
    skill: options?.skill,
    autostart: false,
    draftSeq,
    promptTemplate: options?.template,
    rawIds: options?.rawIds?.length ? Array.from(new Set(options.rawIds)) : undefined,
  })
  setHandoffDraftRevision((value) => value + 1)
  return draftSeq
}

/** Peek pending Raw chip ids without consuming them. */
export const peekPendingHandoffRawIds = (key: string) => {
  const prev = store.session.get(key)
  if (!prev?.rawIds?.length) return undefined
  return prev.rawIds
}

/** Consume pending Raw chip ids queued with a handoff (e.g. new session from OneData). */
export const takePendingHandoffRawIds = (key: string) => {
  const prev = store.session.get(key)
  if (!prev?.rawIds?.length) return undefined
  const ids = prev.rawIds
  touch(store.session, key, { ...prev, rawIds: undefined })
  return ids
}

/** Re-queue Raw chip ids (e.g. after a failed bind). */
export const queueHandoffRawIds = (key: string, rawIds: string[]) => {
  if (!rawIds.length) return
  const prev = store.session.get(key) ?? { prompt: "", files: {} }
  setSessionHandoff(key, {
    rawIds: Array.from(new Set([...(prev.rawIds ?? []), ...rawIds])),
  })
}

export const isStaleAppliedHandoffPrompt = (text: string) => !!lastAppliedHandoffText && text === lastAppliedHandoffText

export const clearAppliedHandoffPromptMarker = () => {
  lastAppliedHandoffText = undefined
}

export const hasSessionHandoffDraft = (key: string) => {
  const prev = store.session.get(key)
  const applied = store.appliedDraftSeq.get(key) ?? 0
  return !!(prev?.prompt && prev.autostart === false && prev.draftSeq && prev.draftSeq > applied)
}

export const discardSessionHandoffDraft = (key: string) => {
  const prev = store.session.get(key)
  if (!prev?.prompt || prev.autostart !== false || !prev.draftSeq) return
  store.appliedDraftSeq.set(key, prev.draftSeq)
  store.appliedTemplates.delete(key)
  touch(store.session, key, {
    ...prev,
    prompt: "",
    skill: undefined,
    draftSeq: undefined,
    autostart: undefined,
    promptTemplate: undefined,
  })
  setHandoffDraftRevision((value) => value + 1)
}

export const clearSessionHandoffPrompt = (key: string) => {
  const prev = store.session.get(key)
  if (!prev?.prompt && !prev?.skill && !prev?.draftSeq && !prev?.promptTemplate) return
  store.appliedTemplates.delete(key)
  if (prev?.draftSeq) store.appliedDraftSeq.set(key, prev.draftSeq)
  touch(store.session, key, {
    ...(prev ?? { prompt: "", files: {} }),
    prompt: "",
    skill: undefined,
    draftSeq: undefined,
    autostart: undefined,
    promptTemplate: undefined,
  })
  setHandoffDraftRevision((value) => value + 1)
}

export const takeSessionHandoffDraft = (key: string) => {
  const prev = store.session.get(key)
  const applied = store.appliedDraftSeq.get(key) ?? 0
  if (!prev?.prompt || prev.autostart !== false || !prev.draftSeq || prev.draftSeq <= applied) return undefined
  return {
    prompt: prev.prompt,
    draftSeq: prev.draftSeq,
    skill: prev.skill,
    ...(prev.promptTemplate ? { template: prev.promptTemplate } : {}),
  }
}

export const markSessionHandoffDraftApplied = (key: string, draftSeq: number) => {
  const prev = store.session.get(key)
  if (prev?.prompt) lastAppliedHandoffText = prev.prompt
  store.appliedDraftSeq.set(key, draftSeq)
  if (!prev) return
  touch(store.session, key, { ...prev, prompt: "", skill: undefined, draftSeq: undefined, autostart: undefined })
}

export const consumeSessionHandoffDraft = (key: string) => {
  const prev = store.session.get(key)
  if (!prev?.prompt || prev.autostart !== false) return undefined
  touch(store.session, key, { ...prev, autostart: undefined })
  return prev.prompt
}

export const setTerminalHandoff = (key: string, value: string[]) => {
  touch(store.terminal, key, value)
}

export const getTerminalHandoff = (key: string) => store.terminal.get(key)
