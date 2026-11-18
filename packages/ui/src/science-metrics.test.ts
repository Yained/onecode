import { describe, expect, test } from "bun:test"
import {
  isModelScopeDownloadCommand,
  imagePathsFromText,
  mergeScienceArtifacts,
  parseMarkdownImages,
  parseModelScopeDownloadProgress,
  parseScienceMetricsFromOutput,
  parseScienceReportJson,
  scienceImagesFromMessageParts,
  splitScienceText,
  stripMarkdownImages,
} from "./science-metrics"

describe("science-metrics", () => {
  test("parses os-science JSON blocks", () => {
    const report = parseScienceReportJson(`{
      "title": "CFDBench smoke",
      "domain": "cfd",
      "status": "passed",
      "metrics": [
        { "name": "u RMSE", "value": 0.0234, "unit": "m/s", "baseline": 0.0312 }
      ]
    }`)
    expect(report?.title).toBe("CFDBench smoke")
    expect(report?.metrics).toHaveLength(1)
    expect(report?.metrics[0]?.value).toBe("0.0234")
  })

  test("splits assistant text into markdown and science segments", () => {
    const segments = splitScienceText(`推理完成。

\`\`\`os-science
{"title":"评估","metrics":[{"name":"RMSE","value":0.01}]}
\`\`\`

后续步骤见产物面板。`)
    expect(segments).toHaveLength(3)
    expect(segments[0]?.type).toBe("markdown")
    expect(segments[1]?.type).toBe("science")
    expect(segments[2]?.type).toBe("markdown")
  })

  test("parses a standalone os-science block", () => {
    const segments = splitScienceText(`\`\`\`os-science
{"title":"Eval","metrics":[{"name":"RMSE","value":0.01}]}
\`\`\``)
    expect(segments).toHaveLength(1)
    expect(segments[0]?.type).toBe("science")
  })

  test("parses metric lines from shell output", () => {
    const report = parseScienceMetricsFromOutput(`Training finished
RMSE: 0.0234 m/s
MAE=0.0189
| u-velocity | 0.0234 | 0.0312 |
| v-velocity | 0.0189 | 0.0241 |`)
    expect(report?.metrics.length).toBeGreaterThanOrEqual(3)
    expect(report?.metrics.some((row) => row.name === "RMSE")).toBe(true)
  })

  test("captures markdown heading as science report title", () => {
    const report = parseScienceMetricsFromOutput(`# Eval summary
RMSE: 0.0234 m/s`)
    expect(report?.title).toBe("Eval summary")
    expect(report?.metrics).toHaveLength(1)
  })

  test("parses modelscope tqdm progress", () => {
    const progress = parseModelScopeDownloadProgress("Downloading [model.safetensors]:  512.0MB / 2.0GB  25.0%")
    expect(progress?.downloaded).toBeGreaterThan(0)
    expect(progress?.total).toBeGreaterThan(progress?.downloaded ?? 0)
    expect(progress?.percent).toBe(25)
    expect(progress?.file).toBe("model.safetensors")
  })

  test("parses modelscope progress from noisy multiline output", () => {
    const progress = parseModelScopeDownloadProgress(`( '.( OO )_   banner art with / slashes
Downloading [cfdbench/tube_prop/data.npy]:  45%|████| 4.3G/12.8G [10:00<12:00, 12MB/s]`)
    expect(progress?.file).toBe("cfdbench/tube_prop/data.npy")
    expect(progress?.percent).toBe(45)
  })

  test("detects modelscope download commands", () => {
    expect(isModelScopeDownloadCommand("modelscope download --model OneScience/FuXi")).toBe(true)
    expect(isModelScopeDownloadCommand("python train.py")).toBe(false)
  })

  test("parses markdown images below the report", () => {
    const images = parseMarkdownImages("![Pressure field](outputs/plot.png)\n\nDone.")
    expect(images).toHaveLength(1)
    expect(images[0]?.path).toBe("outputs/plot.png")
    expect(images[0]?.label).toBe("Pressure field")
    expect(stripMarkdownImages("![Pressure field](outputs/plot.png)\n\nDone.")).toBe("Done.")
  })

  test("parses and strips html image tags", () => {
    const images = parseMarkdownImages('<img src="outputs/plot.png" alt="Pressure field" />')
    expect(images).toHaveLength(1)
    expect(images[0]?.path).toBe("outputs/plot.png")
    expect(stripMarkdownImages('<img src="outputs/plot.png" alt="Pressure field" /> rest')).toBe("rest")
  })

  test("extracts image paths mentioned in shell output", () => {
    const images = imagePathsFromText("Saved plot to result/smoke_demo/nmse_by_case.png")
    expect(images).toHaveLength(1)
    expect(images[0]?.path).toBe("result/smoke_demo/nmse_by_case.png")
  })

  test("ignores glob patterns and bare mentions", () => {
    expect(imagePathsFromText("Expected outputs: loss.png, train_losses.png and *.png")).toHaveLength(0)
  })

  test("mergeScienceArtifacts skips entries without paths", () => {
    const merged = mergeScienceArtifacts(
      [{ path: "outputs/a.png", label: "A" }],
      [{ path: undefined as unknown as string, label: "Bad" }],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]?.path).toBe("outputs/a.png")
  })

  test("stripMarkdownImages handles undefined", () => {
    expect(stripMarkdownImages(undefined)).toBe("")
  })
})
