import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message, Part, UserMessage } from "@opencode-ai/sdk/v2"
import { Timeline, TimelineRow } from "./rows"

const user = (id: string, sessionID = "ses_1"): UserMessage =>
  ({
    id,
    sessionID,
    role: "user",
    time: { created: 1 },
    agent: "build",
    model: { modelID: "model", providerID: "provider" },
  }) as UserMessage

const assistant = (id: string, parentID: string, sessionID = "ses_1"): AssistantMessage =>
  ({
    id,
    sessionID,
    parentID,
    role: "assistant",
    time: { created: 2 },
    agent: "build",
    modelID: "model",
    providerID: "provider",
    model: { modelID: "model", providerID: "provider" },
    mode: "build",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }) as AssistantMessage

const textPart = (id: string, messageID: string, text: string, sessionID = "ses_1"): Part =>
  ({
    id,
    sessionID,
    messageID,
    type: "text",
    text,
  }) as Part

const toolPart = (id: string, messageID: string, tool: string, sessionID = "ses_1"): Part =>
  ({
    id,
    sessionID,
    messageID,
    type: "tool",
    tool,
    callID: id,
    state: { status: "completed", input: {}, output: "", title: tool },
  }) as Part

describe("Timeline.constructSessionMessageRows", () => {
  test("derives turns and tagged rows from chronological SDK messages", () => {
    const messages: Message[] = [
      user("msg_1"),
      assistant("msg_2", "msg_1"),
      user("msg_3"),
      assistant("msg_4", "msg_3"),
    ]
    const parts = new Map<string, Part[]>([
      ["msg_1", [textPart("msg_1:text", "msg_1", "first")]],
      ["msg_2", [textPart("msg_2:text", "msg_2", "answer")]],
      ["msg_3", [textPart("msg_3:text", "msg_3", "second")]],
      ["msg_4", [textPart("msg_4:reasoning", "msg_4", "working")]],
    ])
    const byID = new Map(messages.map((message) => [message.id, message] as const))

    const result = Timeline.constructSessionMessageRows(
      messages,
      (messageID) => byID.get(messageID) as UserMessage | AssistantMessage | undefined,
      (messageID) => parts.get(messageID) ?? [],
      true,
      "busy",
      true,
      messages.filter((message): message is UserMessage => message.role === "user"),
    )

    expect(result.activeMessageID).toBe("msg_3")
    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_1",
      "assistant-part:msg_1:part:msg_2:msg_2:text",
      "turn-gap:msg_3",
      "user-message:msg_3",
      "assistant-part:msg_3:part:msg_4:msg_4:reasoning",
    ])
  })

  test("orders turns by time.created when client message ids went backwards", () => {
    const older = { ...user("msg_zz"), time: { created: 100 } } as UserMessage
    const newer = { ...user("msg_aa"), time: { created: 200 } } as UserMessage
    const olderAsst = { ...assistant("msg_zz_a", "msg_zz"), time: { created: 110 } } as AssistantMessage
    const newerAsst = { ...assistant("msg_aa_a", "msg_aa"), time: { created: 210 } } as AssistantMessage
    // Store / API order can follow id (msg_aa before msg_zz) after clock skew.
    const messages: Message[] = [newer, newerAsst, older, olderAsst]
    const parts = new Map<string, Part[]>([
      ["msg_zz", [textPart("msg_zz:text", "msg_zz", "你好")]],
      ["msg_zz_a", [textPart("msg_zz_a:text", "msg_zz_a", "你好！")]],
      ["msg_aa", [textPart("msg_aa:text", "msg_aa", "这个路径里有哪些文件")]],
      ["msg_aa_a", [toolPart("msg_aa_a:tool", "msg_aa_a", "read")]],
    ])
    const byID = new Map(messages.map((message) => [message.id, message] as const))

    const result = Timeline.constructSessionMessageRows(
      messages,
      (messageID) => byID.get(messageID) as UserMessage | AssistantMessage | undefined,
      (messageID) => parts.get(messageID) ?? [],
      true,
      "busy",
      true,
      [newer, older],
    )

    expect(result.activeMessageID).toBe("msg_aa")
    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_zz",
      "assistant-part:msg_zz:part:msg_zz_a:msg_zz_a:text",
      "turn-gap:msg_aa",
      "user-message:msg_aa",
      "assistant-part:msg_aa:context:msg_aa_a:tool",
    ])
  })

  test("renders a shell user + :assistant sibling as a standalone turn", () => {
    const shellUser = user("msg_shell")
    const shellAssistant = assistant("msg_shell:assistant", "msg_shell")
    const messages: Message[] = [shellUser, shellAssistant]
    const parts = new Map<string, Part[]>([
      ["msg_shell", [textPart("msg_shell:text", "msg_shell", "pwd")]],
      ["msg_shell:assistant", [toolPart("msg_shell:tool", "msg_shell:assistant", "bash")]],
    ])
    const byID = new Map(messages.map((message) => [message.id, message] as const))

    const result = Timeline.constructSessionMessageRows(
      messages,
      (messageID) => byID.get(messageID) as UserMessage | AssistantMessage | undefined,
      (messageID) => parts.get(messageID) ?? [],
      true,
      "idle",
      true,
      [shellUser],
    )

    expect(result.activeMessageID).toBe("msg_shell")
    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_shell",
      "assistant-part:msg_shell:part:msg_shell:assistant:msg_shell:tool",
    ])
  })

  test("groups consecutive completed shells into one context row", () => {
    const shellUser = user("msg_shell")
    const shellAssistant = assistant("msg_shell:assistant", "msg_shell")
    const messages: Message[] = [shellUser, shellAssistant]
    const parts = new Map<string, Part[]>([
      ["msg_shell", [textPart("msg_shell:text", "msg_shell", "pwd")]],
      [
        "msg_shell:assistant",
        [
          toolPart("msg_shell:tool1", "msg_shell:assistant", "bash"),
          toolPart("msg_shell:tool2", "msg_shell:assistant", "bash"),
          toolPart("msg_shell:tool3", "msg_shell:assistant", "bash"),
        ],
      ],
    ])
    const byID = new Map(messages.map((message) => [message.id, message] as const))

    const result = Timeline.constructSessionMessageRows(
      messages,
      (messageID) => byID.get(messageID) as UserMessage | AssistantMessage | undefined,
      (messageID) => parts.get(messageID) ?? [],
      true,
      "idle",
      true,
      [shellUser],
    )

    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_shell",
      "assistant-part:msg_shell:context:msg_shell:tool1",
    ])
  })

  test("keeps read tools and shells in separate context groups", () => {
    const u = user("msg_1")
    const a = assistant("msg_2", "msg_1")
    const messages: Message[] = [u, a]
    const parts = new Map<string, Part[]>([
      ["msg_1", [textPart("u", "msg_1", "go")]],
      [
        "msg_2",
        [
          toolPart("read1", "msg_2", "read"),
          toolPart("bash1", "msg_2", "bash"),
          toolPart("bash2", "msg_2", "bash"),
        ],
      ],
    ])
    const byID = new Map(messages.map((message) => [message.id, message] as const))

    const result = Timeline.constructSessionMessageRows(
      messages,
      (messageID) => byID.get(messageID) as UserMessage | AssistantMessage | undefined,
      (messageID) => parts.get(messageID) ?? [],
      true,
      "idle",
      true,
      [u],
    )

    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_1",
      "assistant-part:msg_1:context:read1",
      "assistant-part:msg_1:context:bash1",
    ])
  })

  test("keeps a projected parent missing from the source page before newer turns", () => {
    const all: Message[] = [
      user("msg_user_1"),
      assistant("msg_assistant_1", "msg_user_1"),
      user("msg_user_2"),
      assistant("msg_assistant_2", "msg_user_2"),
    ]
    const parts = new Map<string, Part[]>([
      ["msg_user_1", [textPart("u1", "msg_user_1", "first question")]],
      ["msg_assistant_1", [textPart("a1", "msg_assistant_1", "first answer")]],
      ["msg_user_2", [textPart("u2", "msg_user_2", "second question")]],
      ["msg_assistant_2", [textPart("a2", "msg_assistant_2", "second answer")]],
    ])
    const byID = new Map(all.map((message) => [message.id, message] as const))
    // Page starts mid-stream (missing msg_user_1) but projection still has the parent.
    const page = all.slice(1)

    const result = Timeline.constructSessionMessageRows(
      page,
      (messageID) => byID.get(messageID) as UserMessage | AssistantMessage | undefined,
      (messageID) => parts.get(messageID) ?? [],
      true,
      "idle",
      true,
      all.filter((message): message is UserMessage => message.role === "user"),
    )

    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_user_1",
      "assistant-part:msg_user_1:part:msg_assistant_1:a1",
      "turn-gap:msg_user_2",
      "user-message:msg_user_2",
      "assistant-part:msg_user_2:part:msg_assistant_2:a2",
    ])
  })

  test("does not keep 思考中 after a finished answer when status is stuck busy", () => {
    const u = user("msg_1")
    const a = assistant("msg_2", "msg_1")
    const messages: Message[] = [u, a]
    const parts = new Map<string, Part[]>([
      ["msg_1", [textPart("u", "msg_1", "ls")]],
      ["msg_2", [textPart("a", "msg_2", "done")]],
    ])
    const byID = new Map(messages.map((message) => [message.id, message] as const))

    const result = Timeline.constructSessionMessageRows(
      messages,
      (messageID) => byID.get(messageID) as UserMessage | AssistantMessage | undefined,
      (messageID) => parts.get(messageID) ?? [],
      false,
      "busy",
      true,
      [u],
    )

    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_1",
      "assistant-part:msg_1:part:msg_2:a",
    ])
  })

  test("renders an optimistic user turn and thinking before the protocol message arrives", () => {
    const existing = user("msg_1")
    const optimistic = { ...user("msg_2"), time: { created: 2 } } as UserMessage
    const messages: Message[] = [existing]
    const byID = new Map<string, Message>([[existing.id, existing]])

    const result = Timeline.constructSessionMessageRows(
      messages,
      (messageID) =>
        messageID === optimistic.id
          ? optimistic
          : (byID.get(messageID) as UserMessage | AssistantMessage | undefined),
      () => [],
      true,
      "busy",
      true,
      [existing, optimistic],
    )

    expect(result.activeMessageID).toBe(optimistic.id)
    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_1",
      "turn-gap:msg_2",
      "user-message:msg_2",
      "thinking:msg_2",
    ])
  })

  test("renders orphan assistants with a stub user root so shared cases are not blank", () => {
    const orphan = assistant("msg_assistant_1", "msg_missing_user")
    const messages: Message[] = [orphan]
    const parts = new Map<string, Part[]>([
      ["msg_assistant_1", [textPart("msg_assistant_1:text", "msg_assistant_1", "hello")]],
    ])
    const byID = new Map(messages.map((message) => [message.id, message] as const))

    const result = Timeline.constructSessionMessageRows(
      messages,
      (messageID) => byID.get(messageID) as UserMessage | AssistantMessage | undefined,
      (messageID) => parts.get(messageID) ?? [],
      true,
      "idle",
      true,
      [],
    )

    expect(result.activeMessageID).toBe("msg_missing_user")
    expect(result.rows.map(TimelineRow.key)).toEqual([
      "user-message:msg_missing_user",
      "assistant-part:msg_missing_user:part:msg_assistant_1:msg_assistant_1:text",
    ])
  })

  test("shows a retry row while the session is retrying", () => {
    const u = user("msg_1")
    const a = assistant("msg_2", "msg_1")
    const messages: Message[] = [u, a]
    const byID = new Map(messages.map((message) => [message.id, message] as const))

    const result = Timeline.constructSessionMessageRows(
      messages,
      (messageID) => byID.get(messageID) as UserMessage | AssistantMessage | undefined,
      () => [],
      false,
      "retry",
      true,
      [u],
    )

    expect(result.rows.map(TimelineRow.key)).toEqual(["user-message:msg_1", "retry:msg_1"])
  })

  test("uses a fallback when the assistant error has no message", () => {
    const u = user("msg_1")
    const a = {
      ...assistant("msg_2", "msg_1"),
      error: { name: "APIError", data: {} },
    } as AssistantMessage
    const messages: Message[] = [u, a]
    const byID = new Map(messages.map((message) => [message.id, message] as const))

    const result = Timeline.constructSessionMessageRows(
      messages,
      (messageID) => byID.get(messageID) as UserMessage | AssistantMessage | undefined,
      () => [],
      false,
      "idle",
      true,
      [u],
    )

    const error = result.rows.find((row) => row._tag === "Error")
    expect(error?._tag).toBe("Error")
    if (error?._tag === "Error") expect(error.text).toBe("模型调用失败")
  })
})
