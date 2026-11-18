import { describe, expect, test } from "bun:test"
import { artifactPathCandidates, pathsRelate, resolveArtifactFilePath } from "./artifact-image-url"
import { sessionImageUrlForPath } from "./session-artifacts"

describe("pathsRelate", () => {
  test("matches suffix paths", () => {
    expect(
      pathsRelate(
        "data/modelscope/hub/models/OneScience/CFDBench/result/smoke_demo/comparison.png",
        "result/smoke_demo/comparison.png",
      ),
    ).toBe(true)
  })
})

describe("resolveArtifactFilePath", () => {
  test("returns the first readable candidate path", async () => {
    const reads: string[] = []
    const resolved = await resolveArtifactFilePath({
      sdk: {
        file: {
          read: async ({ path }: { path: string }) => {
            reads.push(path)
            if (path.endsWith("smoke_demo/evaluate.py")) return { data: { type: "text", content: "print('ok')" } }
            throw new Error("missing")
          },
          list: async () => ({ data: [] }),
        },
        find: { files: async () => ({ data: [] }) },
      } as any,
      directory: "/repo",
      filePath: "result/smoke_demo/evaluate.py",
    })

    expect(resolved).toBe("result/smoke_demo/evaluate.py")
    expect(reads).toContain("result/smoke_demo/evaluate.py")
  })

  test("skips empty reads until a non-empty match is found", async () => {
    const resolved = await resolveArtifactFilePath({
      sdk: {
        file: {
          read: async ({ path }: { path: string }) => {
            if (path === "scripts/run_smoke_demo.py") return { data: { type: "text", content: "" } }
            if (path === "weather_quickcheck_output/scripts/run_smoke_demo.py") {
              return { data: { type: "text", content: "print('ok')" } }
            }
            throw new Error("missing")
          },
          list: async () => ({ data: [] }),
        },
        find: {
          files: async () => ({
            data: ["weather_quickcheck_output/scripts/run_smoke_demo.py", "scripts/run_smoke_demo.py"],
          }),
        },
      } as any,
      directory: "/repo",
      filePath: "scripts/run_smoke_demo.py",
    })

    expect(resolved).toBe("weather_quickcheck_output/scripts/run_smoke_demo.py")
  })
})

describe("artifactPathCandidates", () => {
  test("includes joined workspace paths", () => {
    expect(artifactPathCandidates("/repo", "scripts/plot.py")).toContain("scripts/plot.py")
    expect(artifactPathCandidates("/repo", "scripts/plot.py")).toContain("repo/scripts/plot.py")
  })
})

describe("sessionImageUrlForPath", () => {
  test("returns attachment url for matching artifact path", () => {
    const url = sessionImageUrlForPath(
      [
        {
          id: "a",
          partID: "p",
          messageID: "m",
          tool: "bash",
          mime: "image/png",
          url: "data:image/png;base64,abc",
          imagePath: "data/modelscope/hub/models/OneScience/CFDBench/result/smoke_demo/comparison.png",
        },
      ],
      "result/smoke_demo/comparison.png",
    )
    expect(url).toBe("data:image/png;base64,abc")
  })
})
