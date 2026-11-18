import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { collectTouchedRelativePaths, copyTouchedFiles } from "../../src/session/promote"
import type { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

describe("session promote", () => {
  test("collects relative paths from diffs and write tools", () => {
    const source = "/workspace/default"
    const sessionID = SessionID.descending()
    const messageID = MessageID.ascending()
    const messages = [
      {
        info: {
          id: messageID,
          sessionID,
          role: "assistant",
          time: { created: 1 },
        },
        parts: [
          {
            id: PartID.ascending(),
            sessionID,
            messageID,
            type: "tool",
            callID: "1",
            tool: "write",
            state: {
              status: "completed",
              input: { filePath: path.join(source, "src/a.ts"), content: "a" },
              output: "ok",
              title: "src/a.ts",
              metadata: {},
              time: { start: 1, end: 2 },
            },
          },
          {
            id: PartID.ascending(),
            sessionID,
            messageID,
            type: "patch",
            hash: "abc",
            files: [path.join(source, "src/b.ts")],
          },
        ],
      },
    ] as MessageV2.WithParts[]

    const relatives = collectTouchedRelativePaths({
      sourceDirectory: source,
      diffs: [
        { file: "src/c.ts", additions: 1, deletions: 0, status: "added" },
        { file: "gone.ts", additions: 0, deletions: 1, status: "deleted" },
        { file: "../escape.ts", additions: 1, deletions: 0, status: "added" },
      ],
      messages,
    })

    expect(relatives).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"])
  })

  test("copies missing targets and skips conflicts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "promote-"))
    const source = path.join(root, "default")
    const target = path.join(root, "project")
    await mkdir(path.join(source, "src"), { recursive: true })
    await mkdir(path.join(target, "src"), { recursive: true })
    await writeFile(path.join(source, "src/a.ts"), "a")
    await writeFile(path.join(source, "src/b.ts"), "b")
    await writeFile(path.join(target, "src/b.ts"), "existing")

    const result = await copyTouchedFiles({
      sourceDirectory: source,
      targetDirectory: target,
      relatives: ["src/a.ts", "src/b.ts", "src/missing.ts"],
    })

    expect(result.copied).toEqual(["src/a.ts"])
    expect(result.skipped).toEqual(["src/b.ts"])
    expect(result.missing).toEqual(["src/missing.ts"])
    expect(await readFile(path.join(target, "src/a.ts"), "utf8")).toBe("a")
    expect(await readFile(path.join(target, "src/b.ts"), "utf8")).toBe("existing")
  })
})
