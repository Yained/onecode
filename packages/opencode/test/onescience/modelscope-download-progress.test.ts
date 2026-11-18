import { describe, expect, test } from "bun:test"
import {
  ModelScopeCliProgressTracker,
  parseModelScopeSize,
  parseModelScopeTqdmLine,
} from "@/onescience/modelscope-download-progress"

describe("modelscope-download-progress", () => {
  test("parseModelScopeSize converts binary units", () => {
    expect(parseModelScopeSize("4.70", "G")).toBe(Math.round(4.7 * 1024 ** 3))
    expect(parseModelScopeSize("401", "M")).toBe(401 * 1024 ** 2)
  })

  test("parseModelScopeTqdmLine reads tqdm progress output", () => {
    expect(
      parseModelScopeTqdmLine("data/1980.h5:   8%|██        | 401M/4.70G [00:33<04:31, 17.8MB/s]"),
    ).toEqual({
      file: "data/1980.h5",
      downloaded: 401 * 1024 ** 2,
      total: Math.round(4.7 * 1024 ** 3),
      complete: false,
      scope: "single",
    })

    expect(
      parseModelScopeTqdmLine("Fetching 3 files:  33%|███| 40.0M/120M [00:10<00:20, 4.00MB/s]"),
    ).toMatchObject({
      file: "Fetching 3 files",
      downloaded: Math.round(40 * 1024 ** 2),
      total: 120 * 1024 ** 2,
      complete: false,
      scope: "aggregate",
    })

    expect(
      parseModelScopeTqdmLine("Downloading [data/cavity/bc/case0012/case.json]: 100%|████| 119/119 [00:00<00:00, 204B/s]"),
    ).toMatchObject({
      file: "data/cavity/bc/case0012/case.json",
      downloaded: 119,
      total: 119,
      complete: true,
      scope: "per_file",
    })

    expect(
      parseModelScopeTqdmLine("Downloading [cfdbench/tube_prop/data.npy]:  45%|████| 4.3G/12.8G [10:00<12:00, 12MB/s]"),
    ).toMatchObject({
      file: "cfdbench/tube_prop/data.npy",
      scope: "per_file",
      complete: false,
    })
  })

  test("ModelScopeCliProgressTracker uses aggregate totals only for aggregate bars", () => {
    const tracker = new ModelScopeCliProgressTracker()
    tracker.feed("Fetching 3 files:  33%|███| 40.0M/120M [00:10<00:20, 4.00MB/s]")
    expect(tracker.progressTotalBytes()).toBe(120 * 1024 ** 2)
  })

  test("ModelScopeCliProgressTracker exposes single-file totals for one large file", () => {
    const tracker = new ModelScopeCliProgressTracker()
    tracker.feed("data/1980.h5:   8%|██        | 401M/4.70G [00:33<04:31, 17.8MB/s]")
    expect(tracker.progressTotalBytes()).toBe(Math.round(4.7 * 1024 ** 3))
  })

  test("ModelScopeCliProgressTracker does not sum per-file bracket download totals", () => {
    const tracker = new ModelScopeCliProgressTracker()
    tracker.feed("Downloading [data/cavity/bc/case0012/case.json]: 100%|████| 119/119 [00:00<00:00, 204B/s]\n")
    tracker.feed("Downloading [.gitattributes]: 100%|████| 130k/130k [00:00<00:00, 170kB/s]\n")
    tracker.feed("Downloading [data/cavity/bc/case0027/case.json]: 100%|████| 119/119 [00:00<00:00, 186B/s]\n")

    expect(tracker.progressTotalBytes()).toBeUndefined()
    expect(tracker.snapshot().downloaded_bytes).toBe(119 + 130 * 1024 + 119)
    expect(tracker.snapshot().current_file).toBe("data/cavity/bc/case0027/case.json")
  })

  test("ModelScopeCliProgressTracker aggregates completed and active single-scope files without dataset total", () => {
    const tracker = new ModelScopeCliProgressTracker()
    tracker.feed("data/1979.h5: 100%|██████████| 4.70G/4.70G [04:01<00:00, 20.9MB/s]\n")
    tracker.feed("data/1980.h5:   8%|██        | 401M/4.70G [00:33<04:31, 17.8MB/s]")

    const snapshot = tracker.snapshot()
    expect(snapshot.current_file).toBe("data/1980.h5")
    expect(snapshot.downloaded_bytes).toBe(Math.round(4.7 * 1024 ** 3) + 401 * 1024 ** 2)
    expect(tracker.progressTotalBytes()).toBeUndefined()
  })
})
