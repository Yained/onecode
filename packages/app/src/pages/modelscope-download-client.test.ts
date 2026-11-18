import { describe, expect, test } from "bun:test"
import {
  datasetCacheDisplayRelPath,
  datasetCacheLocationLabel,
  datasetCacheLocationPaths,
  datasetCopyStatusForEnv,
  formatDatasetDialogSize,
  formatDownloadBytes,
  isCondaOptionalMessage,
  listDatasetDownloadCopies,
  localizeCondaListError,
  localizeModelScopeDownloadError,
  normalizeDownloadRecord,
  selectDatasetProgressRecord,
} from "./modelscope-download-client"

describe("modelscope download client", () => {
  test("normalizes camelCase download records", () => {
    expect(
      normalizeDownloadRecord({
        resourceId: "OneScience/Water",
        kind: "dataset",
        status: "downloading",
        startedAt: 1,
        downloadedBytes: 2048,
      }),
    ).toEqual({
      resource_id: "OneScience/Water",
      kind: "dataset",
      status: "downloading",
      started_at: 1,
      downloaded_bytes: 2048,
    })
  })

  test("normalizes partial download records", () => {
    expect(
      normalizeDownloadRecord({
        resourceId: "OneScience/Water",
        kind: "dataset",
        status: "partial",
        startedAt: 1,
        error: "cancelled",
      }),
    ).toEqual({
      resource_id: "OneScience/Water",
      kind: "dataset",
      status: "partial",
      started_at: 1,
      error: "cancelled",
    })
  })

  test("formats download byte sizes", () => {
    expect(formatDownloadBytes(0)).toBe("0 B")
    expect(formatDownloadBytes(1536)).toBe("1.5 KB")
    expect(formatDownloadBytes(5 * 1024 * 1024 * 1024)).toBe("5.0 GB")
  })

  test("formats dataset dialog sizes in GB or MB", () => {
    expect(formatDatasetDialogSize(undefined)).toBe("未知")
    expect(formatDatasetDialogSize(512 * 1024 ** 2)).toBe("512.0 MB")
    expect(formatDatasetDialogSize(1024 ** 3)).toBe("1.0 GB")
    expect(formatDatasetDialogSize(196789562412)).toBe("183.2 GB")
  })

  test("normalizes total byte fields", () => {
    expect(
      normalizeDownloadRecord({
        resourceId: "OneScience/ERA5",
        kind: "dataset",
        status: "downloading",
        startedAt: 1,
        downloadedBytes: 1024,
        totalBytes: 196789562412,
        progressTotalBytes: 200 * 1024 ** 3,
      }),
    ).toEqual({
      resource_id: "OneScience/ERA5",
      kind: "dataset",
      status: "downloading",
      started_at: 1,
      downloaded_bytes: 1024,
      total_bytes: 196789562412,
      progress_total_bytes: 200 * 1024 ** 3,
    })
  })

  test("localizes a missing modelscope CLI without requiring conda or switching to local", () => {
    const message = localizeModelScopeDownloadError("modelscope CLI not found on the remote SSH host")
    expect(message).toBe("所选环境找不到 modelscope 命令。请先在该环境安装后再试。")
    expect(message).not.toContain("conda")
    expect(message).not.toContain("改选本地下载")
    expect(localizeModelScopeDownloadError("Executable not found in $PATH: \"modelscope\"")).toBe(message)
  })

  test("localizes a missing modelscope inside a named conda env", () => {
    expect(localizeModelScopeDownloadError("modelscope CLI not found in conda environment onescience311")).toContain(
      "conda 环境",
    )
  })

  test("treats a missing conda CLI as optional rather than blocking", () => {
    expect(localizeCondaListError("conda CLI not found on the remote SSH host")).toContain("未检测到 conda")
    expect(localizeCondaListError("conda CLI not found on the local host")).toContain("本机未检测到 conda")
    expect(localizeCondaListError("no conda environments found on the remote SSH host")).toContain("留空")
    expect(isCondaOptionalMessage("远端未检测到 conda。可留空，将使用远端默认环境中的 modelscope。")).toBe(true)
    expect(isCondaOptionalMessage("本机未检测到 conda。可留空，将使用当前环境中的 modelscope。")).toBe(true)
  })

  test("splits hub and legacy cache paths for dialog layout", () => {
    expect(datasetCacheLocationPaths("/home/onescience2026/modelscope/hub/datasets", "OneScience/DeePMD")).toEqual([
      "/home/onescience2026/modelscope/hub/datasets/OneScience/DeePMD",
      "/home/onescience2026/modelscope/hub/datasets/datasets/OneScience--DeePMD",
    ])
  })

  test("describes hub cache copies for local and ssh records", () => {
    expect(datasetCacheDisplayRelPath("OneScience/DeePMD")).toBe("datasets/OneScience--DeePMD")
    expect(
      datasetCacheLocationLabel("/home/onescience2026/modelscope/hub/datasets", "OneScience/DeePMD"),
    ).toBe(
      "/home/onescience2026/modelscope/hub/datasets/OneScience/DeePMD 或 /home/onescience2026/modelscope/hub/datasets/datasets/OneScience--DeePMD",
    )
    expect(
      listDatasetDownloadCopies(
        {
          "ssh:aliyun-onescience2026::OneScience/DeePMD": {
            resource_id: "OneScience/DeePMD",
            kind: "dataset",
            status: "completed",
            started_at: 1,
            environment: {
              kind: "ssh",
              targetName: "aliyun-onescience2026",
              remotePath: "/home/onescience2026/modelscope/hub/datasets",
            },
          },
          "local::OneScience/DeePMD": {
            resource_id: "OneScience/DeePMD",
            kind: "dataset",
            status: "partial",
            started_at: 1,
            environment: { kind: "local" },
          },
        },
        "OneScience/DeePMD",
        "/work/project",
      ),
    ).toEqual([
      {
        key: "local::OneScience/DeePMD",
        label: "本地",
        path: "/work/project/modelscope/hub/datasets/datasets/OneScience--DeePMD",
        paths: ["/work/project/modelscope/hub/datasets/datasets/OneScience--DeePMD"],
        confirmed: false,
        environment: { kind: "local" },
        partial: true,
      },
      {
        key: "ssh:aliyun-onescience2026::OneScience/DeePMD",
        label: "SSH: aliyun-onescience2026",
        path: "/home/onescience2026/modelscope/hub/datasets/datasets/OneScience--DeePMD",
        paths: ["/home/onescience2026/modelscope/hub/datasets/datasets/OneScience--DeePMD"],
        confirmed: false,
        environment: {
          kind: "ssh",
          targetName: "aliyun-onescience2026",
          remotePath: "/home/onescience2026/modelscope/hub/datasets",
        },
        partial: false,
      },
    ])
  })

  test("marks which runtime environment already has a dataset copy", () => {
    const copies = listDatasetDownloadCopies(
      {
        "ssh:aliyun-onescience2026::OneScience/DeePMD": {
          resource_id: "OneScience/DeePMD",
          kind: "dataset",
          status: "completed",
          started_at: 1,
          environment: {
            kind: "ssh",
            targetName: "aliyun-onescience2026",
            remotePath: "/home/onescience2026/modelscope/hub/datasets",
          },
        },
        "local::OneScience/DeePMD": {
          resource_id: "OneScience/DeePMD",
          kind: "dataset",
          status: "partial",
          started_at: 1,
          environment: { kind: "local" },
        },
      },
      "OneScience/DeePMD",
      "/work/project",
    )
    expect(datasetCopyStatusForEnv(copies, { kind: "local" })).toBe("partial")
    expect(datasetCopyStatusForEnv(copies, { kind: "ssh", targetName: "aliyun-onescience2026" })).toBe("completed")
    expect(datasetCopyStatusForEnv(copies, { kind: "ssh", targetName: "core1-hanmk_sg" })).toBeUndefined()
  })

  test("uses probed cache_paths when present", () => {
    const copies = listDatasetDownloadCopies(
      {
        "ssh:core1::OneScience/DeePMD": {
          resource_id: "OneScience/DeePMD",
          kind: "dataset",
          status: "completed",
          started_at: 1,
          cache_paths: ["/public/home/hanmk_sg/modelscope/hub/datasets/datasets/OneScience--DeePMD"],
          environment: {
            kind: "ssh",
            targetName: "core1",
            remotePath: "/public/home/hanmk_sg/modelscope/hub/datasets",
          },
        },
      },
      "OneScience/DeePMD",
    )
    expect(copies[0]?.paths).toEqual(["/public/home/hanmk_sg/modelscope/hub/datasets/datasets/OneScience--DeePMD"])
    expect(copies[0]?.confirmed).toBe(true)
  })

  test("prefers an in-flight download over another environment's completed copy", () => {
    const records = {
      "ssh:aliyun::OneScience/oc20": {
        resource_id: "OneScience/oc20",
        kind: "dataset" as const,
        status: "completed" as const,
        started_at: 1,
        environment: { kind: "ssh" as const, targetName: "aliyun" },
      },
      "local::OneScience/oc20": {
        resource_id: "OneScience/oc20",
        kind: "dataset" as const,
        status: "downloading" as const,
        started_at: 2,
        downloaded_bytes: 78 * 1024 ** 2,
        estimated_total_bytes: 251 * 1024 ** 2,
        environment: { kind: "local" as const },
      },
    }
    expect(selectDatasetProgressRecord(records, "OneScience/oc20", { kind: "ssh", targetName: "aliyun" })?.status).toBe(
      "downloading",
    )
    expect(selectDatasetProgressRecord(records, "OneScience/oc20", { kind: "local" })?.environment?.kind).toBe("local")
  })
})
