import { describe, expect, test } from "bun:test"
import {
  collectSessionArtifacts,
  filePathFromArtifactSource,
  imagePathFromText,
  scriptPathFromCommand,
  scriptPathsFromCommand,
} from "./session-artifacts"
import type { Message, Part } from "@opencode-ai/sdk/v2"

describe("collectSessionArtifacts", () => {
  test("collects image attachments from completed read tool parts", () => {
    const messages = [{ id: "msg_1", role: "assistant" }] as Message[]
    const parts: Record<string, Part[]> = {
      msg_1: [
        {
          id: "prt_1",
          messageID: "msg_1",
          sessionID: "ses_1",
          type: "tool",
          callID: "call_1",
          tool: "read",
          state: {
            status: "completed",
            input: { filePath: "/tmp/plot.png" },
            output: "Image read successfully",
            title: "/tmp/plot.png",
            metadata: {},
            time: { start: 1, end: 2 },
            attachments: [
              {
                id: "file_1",
                messageID: "msg_1",
                sessionID: "ses_1",
                type: "file",
                mime: "image/png",
                url: "data:image/png;base64,abc",
                filename: "plot.png",
              },
            ],
          },
        },
      ],
    }

    const artifacts = collectSessionArtifacts(messages, parts)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.source).toBe("/tmp/plot.png")
    expect(artifacts[0]?.imagePath).toBe("/tmp/plot.png")
    expect(artifacts[0]?.scriptPath).toBeUndefined()
    expect(artifacts[0]?.tool).toBe("read")
  })

  test("links read attachments back to the bash script that produced the image", () => {
    const messages = [{ id: "msg_1", role: "assistant" }] as Message[]
    const parts: Record<string, Part[]> = {
      msg_1: [
        {
          id: "prt_bash",
          messageID: "msg_1",
          sessionID: "ses_1",
          type: "tool",
          callID: "call_1",
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "python3 .opencode/skills/onescience-resources/scripts/cfdbench-smoke-demo.py" },
            output: "Saved plot to outputs/cfdbench_pressure_field.png",
            title: "python3 .opencode/skills/onescience-resources/scripts/cfdbench-smoke-demo.py",
            metadata: {},
            time: { start: 1, end: 2 },
          },
        },
        {
          id: "prt_read",
          messageID: "msg_1",
          sessionID: "ses_1",
          type: "tool",
          callID: "call_2",
          tool: "read",
          state: {
            status: "completed",
            input: { filePath: "/home/user/onecode/outputs/cfdbench_pressure_field.png" },
            output: "Image read successfully",
            title: "/home/user/onecode/outputs/cfdbench_pressure_field.png",
            metadata: {},
            time: { start: 3, end: 4 },
            attachments: [
              {
                id: "file_1",
                messageID: "msg_1",
                sessionID: "ses_1",
                type: "file",
                mime: "image/png",
                url: "data:image/png;base64,abc",
                filename: "cfdbench_pressure_field.png",
              },
            ],
          },
        },
      ],
    }

    const artifacts = collectSessionArtifacts(messages, parts)
    const readArtifact = artifacts.find((item) => item.partID === "prt_read")
    expect(readArtifact?.scriptPath).toBe(".opencode/skills/onescience-resources/scripts/cfdbench-smoke-demo.py")
    expect(readArtifact?.imagePath).toBe("/home/user/onecode/outputs/cfdbench_pressure_field.png")
  })

  test("links modelscope CFDBench read artifact via cd && python", () => {
    const messages = [{ id: "msg_1", role: "assistant" }] as Message[]
    const parts: Record<string, Part[]> = {
      msg_1: [
        {
          id: "prt_bash",
          messageID: "msg_1",
          sessionID: "ses_1",
          type: "tool",
          callID: "call_1",
          tool: "bash",
          state: {
            status: "completed",
            input: {
              command:
                "cd data/zhangjing/modelscope/hub/models/OneScience/CFDBench && python smoke_demo/evaluate.py",
            },
            output: "Evaluation finished",
            title: "cd data/zhangjing/modelscope/hub/models/OneScience/CFDBench && python smoke_demo/evaluate.py",
            metadata: {},
            time: { start: 1, end: 2 },
          },
        },
        {
          id: "prt_read",
          messageID: "msg_1",
          sessionID: "ses_1",
          type: "tool",
          callID: "call_2",
          tool: "read",
          state: {
            status: "completed",
            input: {
              filePath:
                "data/zhangjing/modelscope/hub/models/OneScience/CFDBench/result/smoke_demo/nmse_by_case.png",
            },
            output: "Image read successfully",
            title:
              "data/zhangjing/modelscope/hub/models/OneScience/CFDBench/result/smoke_demo/nmse_by_case.png",
            metadata: {},
            time: { start: 3, end: 4 },
            attachments: [
              {
                id: "file_1",
                messageID: "msg_1",
                sessionID: "ses_1",
                type: "file",
                mime: "image/png",
                url: "data:image/png;base64,abc",
                filename: "nmse_by_case.png",
              },
            ],
          },
        },
      ],
    }

    const artifacts = collectSessionArtifacts(messages, parts)
    const readArtifact = artifacts.find((item) => item.partID === "prt_read")
    expect(readArtifact?.scriptPath).toBe(
      "data/zhangjing/modelscope/hub/models/OneScience/CFDBench/smoke_demo/evaluate.py",
    )
  })

  test("uses os-science artifact script hints", () => {
    const messages = [{ id: "msg_1", role: "assistant" }] as Message[]
    const parts: Record<string, Part[]> = {
      msg_1: [
        {
          id: "prt_text",
          messageID: "msg_1",
          sessionID: "ses_1",
          type: "text",
          text: `\`\`\`os-science
{"metrics":[{"name":"NMSE","value":0.01}],"artifacts":[{"path":"result/smoke_demo/nmse_by_case.png","script":"smoke_demo/evaluate.py"}]}
\`\`\``,
        },
        {
          id: "prt_read",
          messageID: "msg_1",
          sessionID: "ses_1",
          type: "tool",
          callID: "call_1",
          tool: "read",
          state: {
            status: "completed",
            input: {
              filePath:
                "data/zhangjing/modelscope/hub/models/OneScience/CFDBench/result/smoke_demo/nmse_by_case.png",
            },
            output: "Image read successfully",
            title:
              "data/zhangjing/modelscope/hub/models/OneScience/CFDBench/result/smoke_demo/nmse_by_case.png",
            metadata: {},
            time: { start: 1, end: 2 },
            attachments: [
              {
                id: "file_1",
                messageID: "msg_1",
                sessionID: "ses_1",
                type: "file",
                mime: "image/png",
                url: "data:image/png;base64,abc",
                filename: "nmse_by_case.png",
              },
            ],
          },
        },
      ],
    }

    const artifacts = collectSessionArtifacts(messages, parts)
    expect(artifacts[0]?.scriptPath).toBe("smoke_demo/evaluate.py")
  })

  test("collects image artifacts from os-science blocks when read attachments are missing", () => {
    const messages = [{ id: "msg_1", role: "assistant", time: { created: 1, completed: 2 } }] as Message[]
    const parts: Record<string, Part[]> = {
      msg_1: [
        {
          id: "prt_text",
          messageID: "msg_1",
          sessionID: "ses_1",
          type: "text",
          text: `\`\`\`os-science
{"metrics":[{"name":"RMSE","value":0.01}],"artifacts":[{"path":"outputs/weather_field.png","script":"scripts/weather_demo.py"}]}
\`\`\``,
        },
      ],
    }

    const artifacts = collectSessionArtifacts(messages, parts)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.tool).toBe("science")
    expect(artifacts[0]?.imagePath).toBe("outputs/weather_field.png")
    expect(artifacts[0]?.scriptPath).toBe("scripts/weather_demo.py")
    expect(artifacts[0]?.url).toBe("")
  })

  test("ignores diagnostic bash commands as artifacts", () => {
    const messages = [{ id: "msg_1", role: "assistant" }] as Message[]
    const parts: Record<string, Part[]> = {
      msg_1: [
        {
          id: "prt_bash",
          messageID: "msg_1",
          sessionID: "ses_1",
          type: "tool",
          callID: "call_1",
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "which python3" },
            output: "/usr/bin/python3",
            title: "which python3",
            metadata: {},
            time: { start: 1, end: 2 },
          },
        },
        {
          id: "prt_fail",
          messageID: "msg_1",
          sessionID: "ses_1",
          type: "tool",
          callID: "call_2",
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "python scripts/run_smoke_demo.py" },
            output: "bash: line 1: python: command not found",
            title: "python scripts/run_smoke_demo.py",
            metadata: {},
            time: { start: 2, end: 3 },
          },
        },
      ],
    }

    expect(collectSessionArtifacts(messages, parts)).toHaveLength(0)
  })

  test("creates bash output artifacts before read attachments exist", () => {
    const messages = [{ id: "msg_1", role: "assistant" }] as Message[]
    const parts: Record<string, Part[]> = {
      msg_1: [
        {
          id: "prt_bash",
          messageID: "msg_1",
          sessionID: "ses_1",
          type: "tool",
          callID: "call_1",
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "python3 scripts/plot_demo.py" },
            output: "Saved plot to outputs/cfdbench_pressure_field.png",
            title: "python3 scripts/plot_demo.py",
            metadata: {},
            time: { start: 1, end: 2 },
          },
        },
      ],
    }

    const artifacts = collectSessionArtifacts(messages, parts)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.scriptPath).toBe("scripts/plot_demo.py")
    expect(artifacts[0]?.imagePath).toBe("outputs/cfdbench_pressure_field.png")
    expect(artifacts[0]?.url).toBe("")
  })

  test("collects markdown image artifacts from assistant text", () => {
    const messages = [{ id: "msg_1", role: "assistant", time: { created: 1, completed: 2 } }] as Message[]
    const parts: Record<string, Part[]> = {
      msg_1: [
        {
          id: "prt_bash",
          messageID: "msg_1",
          sessionID: "ses_1",
          type: "tool",
          callID: "call_1",
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "python3 scripts/run_smoke_demo.py" },
            output: "Saved comparison.png",
            title: "python3 scripts/run_smoke_demo.py",
            metadata: {},
            time: { start: 1, end: 2 },
          },
        },
        {
          id: "prt_text",
          messageID: "msg_1",
          sessionID: "ses_1",
          type: "text",
          text: `\`\`\`os-science
{"title":"Eval","metrics":[{"name":"RMSE","value":0.01}]}
\`\`\`

![CFDBench comparison](result/smoke_demo/comparison.png)
![CFDBench NMSE by case](result/smoke_demo/nmse_by_case.png)`,
        },
      ],
    }

    const artifacts = collectSessionArtifacts(messages, parts)
    const markdownArtifacts = artifacts.filter((item) => item.tool === "markdown")
    expect(markdownArtifacts.length).toBeGreaterThanOrEqual(2)
    expect(markdownArtifacts.some((item) => item.imagePath?.includes("comparison.png"))).toBe(true)
    expect(markdownArtifacts[0]?.scriptPath).toBe("scripts/run_smoke_demo.py")
  })

  test("links modelscope markdown images to cd && python script in session", () => {
    const messages = [{ id: "msg_1", role: "assistant", time: { created: 1, completed: 2 } }] as Message[]
    const parts: Record<string, Part[]> = {
      msg_1: [
        {
          id: "prt_bash",
          messageID: "msg_1",
          sessionID: "ses_1",
          type: "tool",
          callID: "call_1",
          tool: "bash",
          state: {
            status: "completed",
            input: {
              command:
                "cd data/zhangjing/modelscope/hub/models/OneScience/CFDBench && python smoke_demo/evaluate.py",
            },
            output: "Evaluation finished",
            title: "cd data/zhangjing/modelscope/hub/models/OneScience/CFDBench && python smoke_demo/evaluate.py",
            metadata: {},
            time: { start: 1, end: 2 },
          },
        },
        {
          id: "prt_text",
          messageID: "msg_1",
          sessionID: "ses_1",
          type: "text",
          text: `\`\`\`os-science
{"title":"Eval","metrics":[{"name":"RMSE","value":0.01}]}
\`\`\`

![CFDBench comparison](modelscope/hub/models/OneScience/CFDBench/result/smoke_demo/comparison.png)`,
        },
      ],
    }

    const artifacts = collectSessionArtifacts(messages, parts)
    const markdownArtifact = artifacts.find((item) => item.tool === "markdown")
    expect(markdownArtifact?.scriptPath).toBe(
      "data/zhangjing/modelscope/hub/models/OneScience/CFDBench/smoke_demo/evaluate.py",
    )
  })

  test("does not crash when collecting artifacts after refresh with markdown images", () => {
    const messages = [{ id: "msg_1", role: "assistant", time: { created: 1, completed: 2 } }] as Message[]
    const parts: Record<string, Part[]> = {
      msg_1: [
        {
          id: "prt_text",
          messageID: "msg_1",
          sessionID: "ses_1",
          type: "text",
          text: `\`\`\`os-science
{"title":"CFDBench","metrics":[{"name":"NMSE","value":0.12}]}
\`\`\`

![CFDBench comparison](result/smoke_demo/comparison.png)
![CFDBench NMSE by case](result/smoke_demo/nmse_by_case.png)`,
        },
      ],
    }

    expect(() => collectSessionArtifacts(messages, parts)).not.toThrow()
    const artifacts = collectSessionArtifacts(messages, parts)
    expect(artifacts.length).toBeGreaterThanOrEqual(2)
  })

  test("ignores image filenames mentioned in assistant prose", () => {
    const messages = [{ id: "msg_1", role: "assistant", time: { created: 1, completed: 2 } }] as Message[]
    const parts: Record<string, Part[]> = {
      msg_1: [
        {
          id: "prt_text",
          messageID: "msg_1",
          sessionID: "ses_1",
          type: "text",
          text: `Metrics look good. loss.png and train_losses.png are expected. Do not parse *.png.`,
        },
      ],
    }

    expect(collectSessionArtifacts(messages, parts)).toHaveLength(0)
  })

  test("ignores bash output that only mentions image names without saving them", () => {
    const messages = [{ id: "msg_1", role: "assistant" }] as Message[]
    const parts: Record<string, Part[]> = {
      msg_1: [
        {
          id: "prt_bash",
          messageID: "msg_1",
          sessionID: "ses_1",
          type: "tool",
          callID: "call_1",
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "python3 scripts/preflight_check.py" },
            output: "Expected loss.png and train_losses.png under result/",
            title: "python3 scripts/preflight_check.py",
            metadata: {},
            time: { start: 1, end: 2 },
          },
        },
      ],
    }

    expect(collectSessionArtifacts(messages, parts)).toHaveLength(0)
  })
})

describe("scriptPathFromCommand", () => {
  test("extracts python scripts", () => {
    expect(scriptPathFromCommand("python3 scripts/plot.py")).toBe("scripts/plot.py")
    expect(scriptPathFromCommand('python "scripts/plot demo.py"')).toBe("scripts/plot demo.py")
    expect(scriptPathFromCommand("python3 .opencode/skills/onescience-resources/scripts/cfdbench-smoke-demo.py")).toBe(
      ".opencode/skills/onescience-resources/scripts/cfdbench-smoke-demo.py",
    )
  })

  test("extracts node scripts", () => {
    expect(scriptPathFromCommand("node tools/render.mjs")).toBe("tools/render.mjs")
  })

  test("joins cd directory with python script", () => {
    expect(
      scriptPathFromCommand(
        "cd data/zhangjing/modelscope/hub/models/OneScience/CFDBench && python smoke_demo/evaluate.py",
      ),
    ).toBe("data/zhangjing/modelscope/hub/models/OneScience/CFDBench/smoke_demo/evaluate.py")
    expect(scriptPathsFromCommand("cd /tmp && python plot.py && python finalize.py")).toEqual([
      "/tmp/plot.py",
      "/tmp/finalize.py",
    ])
  })
})

describe("imagePathFromText", () => {
  test("returns absolute paths", () => {
    expect(imagePathFromText("/tmp/plot.png")).toBe("/tmp/plot.png")
  })

  test("does not treat absolute non-image paths as images", () => {
    expect(imagePathFromText("/usr/bin/python3")).toBeUndefined()
  })

  test("extracts relative paths from shell output", () => {
    expect(imagePathFromText("Saved plot to outputs/cfdbench_pressure_field.png")).toBe(
      "outputs/cfdbench_pressure_field.png",
    )
  })
})

describe("filePathFromArtifactSource", () => {
  test("delegates to imagePathFromText", () => {
    expect(filePathFromArtifactSource("saved outputs/plot.png")).toBe("outputs/plot.png")
  })
})
