import { describe, expect, test } from "bun:test"
import {
  clearSessionHandoffPrompt,
  discardSessionHandoffDraft,
  hasSessionHandoffDraft,
  markSessionHandoffDraftApplied,
  peekPendingHandoffRawIds,
  pushSessionHandoffDraft,
  takePendingHandoffRawIds,
  takeSessionHandoffDraft,
} from "./handoff"

describe("session handoff skill draft", () => {
  test("round-trips optional skill with short prompt draft", () => {
    const draftSeq = pushSessionHandoffDraft("skills-dir", "请基于技能继续开发。", {
      skill: { name: "onescience-coder", title: "代码实现与改造" },
    })

    const draft = takeSessionHandoffDraft("skills-dir")
    expect(draft).toEqual({
      prompt: "请基于技能继续开发。",
      draftSeq,
      skill: { name: "onescience-coder", title: "代码实现与改造" },
    })

    markSessionHandoffDraftApplied("skills-dir", draftSeq)
    expect(takeSessionHandoffDraft("skills-dir")).toBeUndefined()
  })

  test("keeps prompt-only drafts working without skill", () => {
    const draftSeq = pushSessionHandoffDraft("model-dir", "长提示词")
    expect(takeSessionHandoffDraft("model-dir")).toEqual({
      prompt: "长提示词",
      draftSeq,
      skill: undefined,
    })
  })

  test("leaves draft readable until applied so show transition can keep prefill", () => {
    const draftSeq = pushSessionHandoffDraft("graphcast-dir", "请按照下面的内容，进行后续工作。")
    expect(hasSessionHandoffDraft("graphcast-dir")).toBe(true)
    expect(takeSessionHandoffDraft("graphcast-dir")?.draftSeq).toBe(draftSeq)
    expect(hasSessionHandoffDraft("graphcast-dir")).toBe(true)

    markSessionHandoffDraftApplied("graphcast-dir", draftSeq)
    expect(hasSessionHandoffDraft("graphcast-dir")).toBe(false)
    expect(takeSessionHandoffDraft("graphcast-dir")).toBeUndefined()
  })

  test("clears composer-synced prompt cache without dropping file handoff", () => {
    const draftSeq = pushSessionHandoffDraft("workspace-dir", "能力中心预填任务")
    clearSessionHandoffPrompt("workspace-dir/ses_1")

    expect(takeSessionHandoffDraft("workspace-dir")).toEqual({
      prompt: "能力中心预填任务",
      draftSeq,
      skill: undefined,
    })

    clearSessionHandoffPrompt("workspace-dir")
    expect(hasSessionHandoffDraft("workspace-dir")).toBe(false)
    expect(takeSessionHandoffDraft("workspace-dir")).toBeUndefined()
  })

  test("keeps pending raw chip ids after prompt draft is applied", () => {
    const draftSeq = pushSessionHandoffDraft("raw-chip-dir", "请标准化数据", {
      rawIds: ["raw_a", "raw_b"],
    })
    expect(peekPendingHandoffRawIds("raw-chip-dir")).toEqual(["raw_a", "raw_b"])
    markSessionHandoffDraftApplied("raw-chip-dir", draftSeq)
    expect(takeSessionHandoffDraft("raw-chip-dir")).toBeUndefined()
    expect(peekPendingHandoffRawIds("raw-chip-dir")).toEqual(["raw_a", "raw_b"])
    expect(takePendingHandoffRawIds("raw-chip-dir")).toEqual(["raw_a", "raw_b"])
    expect(peekPendingHandoffRawIds("raw-chip-dir")).toBeUndefined()
  })
})
