import { describe, expect, test } from "bun:test"
import {
  clearPrefillComposerIfNeeded,
  clearStoredCapabilityPrefill,
  clearWorkspacePrompt,
  discardWorkspaceScopedPrefill,
  isPrefillComposerContent,
  workspacePromptText,
} from "./workspace-prompt"
import type { Prompt } from "@/context/prompt"
import {
  hasSessionHandoffDraft,
  markSessionHandoffDraftApplied,
  pushSessionHandoffDraft,
  setAppliedHandoffTemplate,
  takeSessionHandoffDraft,
} from "./handoff"

describe("clearWorkspacePrompt", () => {
  test("clears skill chips and resets workspace, session, and active prompt scopes", () => {
    let prompt: Prompt = [{ type: "text", content: "请基于技能继续开发。", start: 0, end: 12 }]
    const context = [
      { key: "skill:onescience-coder", type: "skill" as const, name: "onescience-coder", title: "代码实现与改造" },
      { key: "file:/tmp/a.ts:1:1", type: "file" as const, path: "/tmp/a.ts" },
    ]
    const resets: Array<{ dir: string; id?: string } | undefined> = []
    const sets: Array<{ dir?: string; id?: string }> = []

    clearWorkspacePrompt(
      {
        current: () => prompt,
        set: (next, _cursor, scope) => {
          prompt = next
          sets.push({ dir: scope?.dir, id: scope?.id })
        },
        reset: (scope) => {
          resets.push(scope)
          prompt = [{ type: "text", content: "", start: 0, end: 0 }]
        },
        context: {
          items: () => context.slice(),
          remove: (key) => {
            const index = context.findIndex((item) => item.key === key)
            if (index >= 0) context.splice(index, 1)
          },
        },
      },
      "skills-dir",
      "ses_1",
    )

    expect(prompt).toEqual([{ type: "text", content: "", start: 0, end: 0 }])
    expect(context).toEqual([{ key: "file:/tmp/a.ts:1:1", type: "file", path: "/tmp/a.ts" }])
    expect(resets).toEqual([{ dir: "skills-dir" }, { dir: "skills-dir", id: "ses_1" }, undefined])
    expect(sets).toEqual([
      { dir: "skills-dir", id: undefined },
      { dir: "skills-dir", id: "ses_1" },
      { dir: undefined, id: undefined },
    ])
  })

  test("clearStoredCapabilityPrefill drops pending handoff drafts", () => {
    pushSessionHandoffDraft("workspace-dir", "能力中心预填任务")
    expect(hasSessionHandoffDraft("workspace-dir")).toBe(true)

    clearStoredCapabilityPrefill("workspace-dir")
    expect(hasSessionHandoffDraft("workspace-dir")).toBe(false)
    expect(takeSessionHandoffDraft("workspace-dir")).toBeUndefined()
  })

  test("discardWorkspaceScopedPrefill clears workspace store without requiring a session id", () => {
    let prompt: Prompt = [{ type: "text", content: "预填", start: 0, end: 2 }]
    const resets: Array<{ dir: string; id?: string } | undefined> = []
    pushSessionHandoffDraft("workspace-dir", "预填")

    discardWorkspaceScopedPrefill(
      {
        current: () => prompt,
        set: (next) => {
          prompt = next
        },
        reset: (scope) => {
          resets.push(scope)
          prompt = [{ type: "text", content: "", start: 0, end: 0 }]
        },
        context: {
          items: () => [],
          remove: () => undefined,
        },
      },
      "workspace-dir",
    )

    expect(hasSessionHandoffDraft("workspace-dir")).toBe(false)
    expect(prompt).toEqual([{ type: "text", content: "", start: 0, end: 0 }])
    expect(resets).toEqual([{ dir: "workspace-dir" }])
  })

  test("isPrefillComposerContent detects handoff and applied template text", () => {
    const userPrompt: Prompt = [{ type: "text", content: "我自己写的", start: 0, end: 5 }]
    const handoffPrompt: Prompt = [{ type: "text", content: "能力中心预填", start: 0, end: 6 }]

    pushSessionHandoffDraft("handoff-dir", "能力中心预填")
    expect(isPrefillComposerContent(handoffPrompt, "handoff-dir")).toBe(true)

    setAppliedHandoffTemplate("applied-dir", {
      template: () => "能力中心预填",
      renderedText: "能力中心预填",
      envKey: "env",
    })
    expect(isPrefillComposerContent(handoffPrompt, "applied-dir")).toBe(true)
    expect(isPrefillComposerContent(userPrompt, "applied-dir")).toBe(false)

    const draftSeq = pushSessionHandoffDraft("stale-dir", "未修改的预填")
    markSessionHandoffDraftApplied("stale-dir", draftSeq)
    const stalePrompt: Prompt = [{ type: "text", content: "未修改的预填", start: 0, end: 6 }]
    expect(isPrefillComposerContent(stalePrompt, "stale-dir")).toBe(true)
    expect(isPrefillComposerContent(userPrompt, "stale-dir")).toBe(false)
  })

  test("clearPrefillComposerIfNeeded keeps user drafts when leaving session", () => {
    let prompt: Prompt = [{ type: "text", content: "用户草稿", start: 0, end: 4 }]
    const resets: Array<{ dir: string; id?: string } | undefined> = []

    const cleared = clearPrefillComposerIfNeeded(
      {
        current: () => prompt,
        set: (next) => {
          prompt = next
        },
        reset: (scope) => {
          resets.push(scope)
          prompt = [{ type: "text", content: "", start: 0, end: 0 }]
        },
        context: {
          items: () => [],
          remove: () => undefined,
        },
      },
      "workspace-dir",
    )

    expect(cleared).toBe(false)
    expect(workspacePromptText(prompt)).toBe("用户草稿")
    expect(resets).toEqual([])
  })

  test("clearPrefillComposerIfNeeded clears applied handoff drafts", () => {
    let prompt: Prompt = [{ type: "text", content: "能力中心预填", start: 0, end: 6 }]
    setAppliedHandoffTemplate("workspace-dir", {
      template: () => "能力中心预填",
      renderedText: "能力中心预填",
      envKey: "env",
    })

    const cleared = clearPrefillComposerIfNeeded(
      {
        current: () => prompt,
        set: (next) => {
          prompt = next
        },
        reset: () => {
          prompt = [{ type: "text", content: "", start: 0, end: 0 }]
        },
        context: {
          items: () => [],
          remove: () => undefined,
        },
      },
      "workspace-dir",
    )

    expect(cleared).toBe(true)
    expect(hasSessionHandoffDraft("workspace-dir")).toBe(false)
    expect(workspacePromptText(prompt)).toBe("")
  })
})
