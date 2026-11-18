import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import {
  applyOptimisticAdd,
    applyOptimisticRemove,
  mergeOptimisticPage,
  missingAssistantParentIDs,
  pageNeedsUserTurn,
  attachableEarlierMessages,
  pageBelongsToKnownTurns,
  thumbnailizePartForHistory,
  keepRicherSessionMessages,
} from "./sync"

type Text = Extract<Part, { type: "text" }>

const userMessage = (id: string, sessionID: string): Message => ({
  id,
  sessionID,
  role: "user",
  time: { created: 1 },
  agent: "assistant",
  model: { providerID: "openai", modelID: "gpt" },
})

const textPart = (id: string, sessionID: string, messageID: string): Text => ({
  id,
  sessionID,
  messageID,
  type: "text",
  text: id,
})

describe("sync optimistic reducers", () => {
  test("applyOptimisticAdd inserts message in sorted order and stores parts", () => {
    const sessionID = "ses_1"
    const draft = {
      message: { [sessionID]: [userMessage("msg_2", sessionID)] },
      part: {} as Record<string, Part[] | undefined>,
    }

    applyOptimisticAdd(draft, {
      sessionID,
      message: userMessage("msg_1", sessionID),
      parts: [textPart("prt_2", sessionID, "msg_1"), textPart("prt_1", sessionID, "msg_1")],
    })

    expect(draft.message[sessionID]?.map((x) => x.id)).toEqual(["msg_1", "msg_2"])
    expect(draft.part.msg_1?.map((x) => x.id)).toEqual(["prt_1", "prt_2"])
  })

  test("applyOptimisticRemove removes message and part entries", () => {
    const sessionID = "ses_1"
    const draft = {
      message: { [sessionID]: [userMessage("msg_1", sessionID), userMessage("msg_2", sessionID)] },
      part: {
        msg_1: [textPart("prt_1", sessionID, "msg_1")],
        msg_2: [textPart("prt_2", sessionID, "msg_2")],
      } as Record<string, Part[] | undefined>,
    }

    applyOptimisticRemove(draft, { sessionID, messageID: "msg_1" })

    expect(draft.message[sessionID]?.map((x) => x.id)).toEqual(["msg_2"])
    expect(draft.part.msg_1).toBeUndefined()
    expect(draft.part.msg_2).toHaveLength(1)
  })

  test("mergeOptimisticPage keeps pending messages in fetched timelines", () => {
    const sessionID = "ses_1"
    const page = mergeOptimisticPage(
      {
        session: [userMessage("msg_1", sessionID)],
        part: [{ id: "msg_1", part: [textPart("prt_1", sessionID, "msg_1")] }],
        complete: true,
        pageChars: 0,
      },
      [{ message: userMessage("msg_2", sessionID), parts: [textPart("prt_2", sessionID, "msg_2")] }],
    )

    expect(page.session.map((x) => x.id)).toEqual(["msg_1", "msg_2"])
    expect(page.part.find((x) => x.id === "msg_2")?.part.map((x) => x.id)).toEqual(["prt_2"])
    expect(page.confirmed).toEqual([])
    expect(page.complete).toBe(true)
  })

  test("mergeOptimisticPage keeps missing optimistic parts until the server has them", () => {
    const sessionID = "ses_1"
    const page = mergeOptimisticPage(
      {
        session: [userMessage("msg_2", sessionID)],
        part: [{ id: "msg_2", part: [textPart("prt_2", sessionID, "msg_2")] }],
        complete: true,
        pageChars: 0,
      },
      [
        {
          message: userMessage("msg_2", sessionID),
          parts: [textPart("prt_1", sessionID, "msg_2"), textPart("prt_2", sessionID, "msg_2")],
        },
      ],
    )

    expect(page.part.find((x) => x.id === "msg_2")?.part.map((x) => x.id)).toEqual(["prt_1", "prt_2"])
    expect(page.confirmed).toEqual([])
  })

  test("mergeOptimisticPage confirms echoed messages once all parts arrive", () => {
    const sessionID = "ses_1"
    const page = mergeOptimisticPage(
      {
        session: [userMessage("msg_2", sessionID)],
        part: [
          {
            id: "msg_2",
            part: [{ ...textPart("prt_1", sessionID, "msg_2"), text: "server" }, textPart("prt_2", sessionID, "msg_2")],
          },
        ],
        complete: true,
        pageChars: 0,
      },
      [
        {
          message: userMessage("msg_2", sessionID),
          parts: [textPart("prt_1", sessionID, "msg_2"), textPart("prt_2", sessionID, "msg_2")],
        },
      ],
    )

    expect(page.confirmed).toEqual(["msg_2"])
    expect(page.part.find((x) => x.id === "msg_2")?.part).toMatchObject([
      { id: "prt_1", type: "text", text: "server" },
      { id: "prt_2", type: "text", text: "prt_2" },
    ])
  })
})

const assistantMessage = (id: string, sessionID: string, parentID: string): Message =>
  ({
    id,
    sessionID,
    role: "assistant",
    parentID,
    time: { created: 2 },
    agent: "build",
    modelID: "gpt",
    providerID: "openai",
    mode: "",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }) as Message

describe("session turn-root helpers", () => {
  test("missingAssistantParentIDs returns parents not present in the page", () => {
    const sessionID = "ses_1"
    const assistant = assistantMessage("msg_a", sessionID, "msg_u")
    expect(missingAssistantParentIDs([assistant])).toEqual(["msg_u"])
    expect(missingAssistantParentIDs([userMessage("msg_u", sessionID), assistant])).toEqual([])
  })

  test("pageNeedsUserTurn is true for assistant-only pages", () => {
    const sessionID = "ses_1"
    const assistant = assistantMessage("msg_a", sessionID, "msg_u")
    expect(pageNeedsUserTurn([assistant])).toBe(true)
    expect(pageNeedsUserTurn([userMessage("msg_u", sessionID), assistant])).toBe(false)
    expect(pageNeedsUserTurn([])).toBe(false)
  })

  test("attachableEarlierMessages keeps same-turn assistants, drops true orphans", () => {
    const sessionID = "ses_1"
    const known = new Set(["msg_u"])
    const midTurn = assistantMessage("msg_a1", sessionID, "msg_u")
    const orphan = assistantMessage("msg_a2", sessionID, "msg_other")
    expect(attachableEarlierMessages([midTurn, orphan], known)).toEqual([midTurn])
    expect(attachableEarlierMessages([userMessage("msg_u", sessionID)], known)).toEqual([
      userMessage("msg_u", sessionID),
    ])
    expect(attachableEarlierMessages([userMessage("msg_other", sessionID)], known)).toEqual([])
  })

  test("pageBelongsToKnownTurns is true only for known users and their assistants", () => {
    const sessionID = "ses_1"
    const known = new Set(["msg_u"])
    expect(
      pageBelongsToKnownTurns(
        [assistantMessage("msg_a1", sessionID, "msg_u"), assistantMessage("msg_a2", sessionID, "msg_u")],
        known,
      ),
    ).toBe(true)
    expect(pageBelongsToKnownTurns([assistantMessage("msg_a1", sessionID, "msg_other")], known)).toBe(false)
    expect(pageBelongsToKnownTurns([userMessage("msg_other", sessionID)], known)).toBe(false)
    expect(pageBelongsToKnownTurns([userMessage("msg_u", sessionID)], known)).toBe(true)
  })

  test("thumbnailizePartForHistory strips heavy completed tool payloads", () => {
    const part = {
      id: "prt_1",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "tool" as const,
      callID: "call_1",
      tool: "bash",
      state: {
        status: "completed" as const,
        input: { command: "x".repeat(800) },
        output: "y".repeat(5000),
        title: "Shell",
        metadata: { huge: "z".repeat(2000) },
        time: { start: 1, end: 2 },
      },
    }
    const next = thumbnailizePartForHistory(part as Part)
    expect(next.type).toBe("tool")
    if (next.type !== "tool" || next.state.status !== "completed") throw new Error("expected tool")
    expect(String(next.state.input.command).length).toBeLessThan(500)
    expect(next.state.output.length).toBeLessThan(500)
    expect(next.state.metadata).toEqual({ _historyThumbnail: true })
  })

  test("thumbnailizePartForHistory keeps conversation text and reasoning intact", () => {
    const text = {
      id: "prt_text",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "text" as const,
      text: "skill-path\n".repeat(400),
    }
    const reasoning = {
      id: "prt_reason",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "reasoning" as const,
      text: "thinking\n".repeat(200),
      time: { start: 1 },
    }
    expect(thumbnailizePartForHistory(text as Part)).toEqual(text)
    expect(thumbnailizePartForHistory(reasoning as Part)).toEqual(reasoning)
  })

  test("keepRicherSessionMessages preserves cached turns missing from a shorter page", () => {
    const sessionID = "ses_1"
    const previous = [userMessage("msg_1", sessionID), userMessage("msg_2", sessionID), userMessage("msg_3", sessionID)]
    const incoming = [userMessage("msg_3", sessionID), userMessage("msg_4", sessionID)]
    expect(keepRicherSessionMessages(previous, incoming).map((item) => item.id)).toEqual([
      "msg_1",
      "msg_2",
      "msg_3",
      "msg_4",
    ])
    expect(keepRicherSessionMessages(previous, previous.slice(1)).map((item) => item.id)).toEqual([
      "msg_1",
      "msg_2",
      "msg_3",
    ])
    expect(keepRicherSessionMessages(undefined, incoming).map((item) => item.id)).toEqual(["msg_3", "msg_4"])
  })
})
