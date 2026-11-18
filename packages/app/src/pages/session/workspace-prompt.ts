import type { Prompt } from "@/context/prompt"
import {
  clearAppliedHandoffTemplate,
  clearAppliedHandoffPromptMarker,
  clearSessionHandoffPrompt,
  discardSessionHandoffDraft,
  getAppliedHandoffTemplate,
  hasSessionHandoffDraft,
  isStaleAppliedHandoffPrompt,
} from "@/pages/session/handoff"
import { Persist, removePersisted } from "@/utils/persist"

type PromptScope = {
  current: () => Prompt
  set: (prompt: Prompt, cursorPosition?: number, scope?: { dir: string; id?: string }) => void
  reset: (scope?: { dir: string; id?: string }) => void
  context: {
    items: () => Array<{ key: string; type: string }>
    remove: (key: string) => void
  }
}

const EMPTY_PROMPT: Prompt = [{ type: "text", content: "", start: 0, end: 0 }]

export function workspacePromptPersistTarget(dir: string) {
  return Persist.scoped(dir, undefined, "prompt", [`${dir}/prompt.v2`])
}

export function sessionPromptPersistTarget(dir: string, sessionID: string) {
  return Persist.scoped(dir, sessionID, "prompt", [`${dir}/prompt/${sessionID}.v2`])
}

export function clearStoredCapabilityPrefill(dir: string, sessionID?: string) {
  discardSessionHandoffDraft(dir)
  clearSessionHandoffPrompt(dir)
  clearAppliedHandoffTemplate(dir)
  if (sessionID) clearSessionHandoffPrompt(`${dir}/${sessionID}`)
}

export function clearStoredWorkspacePrompt(dir: string, sessionID?: string) {
  const workspaceTarget = workspacePromptPersistTarget(dir)
  removePersisted(workspaceTarget)
  removePersisted({ key: `${dir}/prompt.v2` })
  for (const legacy of workspaceTarget.legacy ?? []) removePersisted({ key: legacy })

  if (sessionID) {
    const sessionTarget = sessionPromptPersistTarget(dir, sessionID)
    removePersisted(sessionTarget)
    removePersisted({ key: `${dir}/prompt/${sessionID}.v2` })
    for (const legacy of sessionTarget.legacy ?? []) removePersisted({ key: legacy })
  }
}

/** Drop capability/workspace prefill without wiping an open session's composer draft. */
export function discardWorkspaceScopedPrefill(prompt: PromptScope, dir: string) {
  clearStoredCapabilityPrefill(dir)
  clearStoredWorkspacePrompt(dir)
  prompt.reset({ dir })
  prompt.set(EMPTY_PROMPT, 0, { dir })
  clearAppliedHandoffPromptMarker()
}

export function clearWorkspacePrompt(prompt: PromptScope, dir: string, sessionID?: string) {
  clearStoredWorkspacePrompt(dir, sessionID)
  for (const item of prompt.context.items().slice()) {
    if (item.type === "skill") prompt.context.remove(item.key)
  }

  // Reset both the workspace-scoped store and the currently active session store.
  prompt.reset({ dir })
  prompt.set(EMPTY_PROMPT, 0, { dir })
  if (sessionID) {
    prompt.reset({ dir, id: sessionID })
    prompt.set(EMPTY_PROMPT, 0, { dir, id: sessionID })
  }
  prompt.reset()
  prompt.set(EMPTY_PROMPT, 0)
  clearAppliedHandoffPromptMarker()
}

export function workspacePromptText(prompt: Prompt) {
  return prompt
    .filter((part) => part.type === "text")
    .map((part) => part.content)
    .join("")
}

export function normalizeHandoffPrompt(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\u200B/g, "").trim()
}

export function sameHandoffPrompt(left: string, right: string) {
  return normalizeHandoffPrompt(left) === normalizeHandoffPrompt(right)
}

/** True when composer content came from capability handoff / URL prompt, not user typing. */
export function isPrefillComposerContent(
  prompt: Prompt,
  dir: string,
  options?: {
    urlPrompt?: string
    contextItems?: Array<{ type: string }>
  },
) {
  if (options?.urlPrompt?.trim()) return true
  if (hasSessionHandoffDraft(dir)) return true

  const text = workspacePromptText(prompt).trim()
  if (text && isStaleAppliedHandoffPrompt(text)) return true

  const applied = getAppliedHandoffTemplate(dir)
  if (applied && sameHandoffPrompt(text, applied.renderedText)) return true

  const hasSkillPrefill = options?.contextItems?.some((item) => item.type === "skill") ?? false
  if (!text && hasSkillPrefill && applied) return true

  return false
}

/** Clear handoff state always; wipe composer + Persist only when content is prefill. */
export function clearPrefillComposerIfNeeded(
  prompt: PromptScope,
  dir: string,
  sessionID?: string,
  options?: { urlPrompt?: string },
) {
  const prefill = isPrefillComposerContent(prompt.current(), dir, {
    urlPrompt: options?.urlPrompt,
    contextItems: prompt.context.items(),
  })
  clearStoredCapabilityPrefill(dir, sessionID)
  if (!prefill) return false
  clearWorkspacePrompt(prompt, dir, sessionID)
  return true
}
