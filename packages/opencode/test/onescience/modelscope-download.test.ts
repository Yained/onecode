import fs from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  cancelModelScopeDatasetDownload,
  deleteModelScopeDatasetDownload,
  fetchModelScopeDatasetStorageSize,
  getModelScopeDownload,
  getModelScopeDownloadDiskSpace,
  getModelScopeDownloadPreflight,
  listModelScopeDownloads,
  startModelScopeDatasetDownload,
  localModelscopeDownloadCommand,
} from "@/onescience/modelscope-download"
import { parseDfAvailableKb, parseCondaEnvList, CONDA_ENV_LIST_SCRIPT, remoteCacheTargets, remoteCondaPrefix, remoteDiskDfScript, remoteDiskProbeAncestors, remoteLogChunkScript, remoteModelscopeSetup, remoteStartDownloadScript, remoteUserPathPrefix } from "@/onescience/modelscope-download-ssh"
import { datasetCacheDisplayRelPath, datasetCacheRelPaths } from "@/onescience/modelscope-download-store"
import { tmpdir } from "../fixture/fixture"

describe("OneScienceModelScopeDownload", () => {
  test("marks stale downloading records as interrupted when listing", async () => {
    await using tmp = await tmpdir()
    const storePath = path.join(tmp.path, ".onescience", "modelscope-downloads.json")
    await fs.mkdir(path.dirname(storePath), { recursive: true })
    await fs.writeFile(
      storePath,
      JSON.stringify({
        "OneScience/OC20": {
          resource_id: "OneScience/OC20",
          kind: "dataset",
          status: "downloading",
          started_at: Date.now() - 31_000,
        },
      }),
    )

    const items = await listModelScopeDownloads(tmp.path)
    const store = JSON.parse(await fs.readFile(storePath, "utf8"))

    expect(items).toHaveLength(0)
    expect(store).toEqual({})
  })

  test("promotes cancelled downloads with partial files to partial status", async () => {
    await using tmp = await tmpdir()
    const datasetDir = path.join(tmp.path, "modelscope/hub/datasets/OneScience/Water")
    await fs.mkdir(datasetDir, { recursive: true })
    await fs.writeFile(path.join(datasetDir, "partial.txt"), "demo")
    const storePath = path.join(tmp.path, ".onescience", "modelscope-downloads.json")
    await fs.mkdir(path.dirname(storePath), { recursive: true })
    await fs.writeFile(
      storePath,
      JSON.stringify({
        "OneScience/Water": {
          resource_id: "OneScience/Water",
          kind: "dataset",
          status: "failed",
          started_at: Date.now(),
          finished_at: Date.now(),
          error: "cancelled",
        },
      }),
    )

    const items = await listModelScopeDownloads(tmp.path)
    const store = JSON.parse(await fs.readFile(storePath, "utf8"))

    expect(items).toHaveLength(1)
    expect(items[0]?.status).toBe("partial")
    expect(items[0]?.error).toBe("cancelled")
  })

  test("marks downloading as completed when files exist without an active process", async () => {
    await using tmp = await tmpdir()
    const datasetDir = path.join(tmp.path, "modelscope/hub/datasets/OneScience/Water")
    await fs.mkdir(datasetDir, { recursive: true })
    await fs.writeFile(path.join(datasetDir, "sample.txt"), "demo")
    const storePath = path.join(tmp.path, ".onescience", "modelscope-downloads.json")
    await fs.mkdir(path.dirname(storePath), { recursive: true })
    await fs.writeFile(
      storePath,
      JSON.stringify({
        "OneScience/Water": {
          resource_id: "OneScience/Water",
          kind: "dataset",
          status: "downloading",
          started_at: Date.now(),
        },
      }),
    )

    const items = await listModelScopeDownloads(tmp.path)

    expect(items).toHaveLength(1)
    expect(items[0]?.status).toBe("completed")
  })

  test("marks failed downloads as completed when files exist on disk", async () => {
    await using tmp = await tmpdir()
    const datasetDir = path.join(tmp.path, "modelscope/hub/datasets/OneScience/Water")
    await fs.mkdir(datasetDir, { recursive: true })
    await fs.writeFile(path.join(datasetDir, "sample.txt"), "demo")
    const storePath = path.join(tmp.path, ".onescience", "modelscope-downloads.json")
    await fs.mkdir(path.dirname(storePath), { recursive: true })
    await fs.writeFile(
      storePath,
      JSON.stringify({
        "OneScience/Water": {
          resource_id: "OneScience/Water",
          kind: "dataset",
          status: "failed",
          started_at: Date.now(),
          finished_at: Date.now(),
          error: "exit 1",
        },
      }),
    )

    const items = await listModelScopeDownloads(tmp.path)

    expect(items).toHaveLength(1)
    expect(items[0]?.status).toBe("completed")
  })

  test("cancels to partial when partial cache exists", async () => {
    await using tmp = await tmpdir()
    const datasetDir = path.join(tmp.path, "modelscope/hub/datasets/OneScience/Water")
    await fs.mkdir(datasetDir, { recursive: true })
    await fs.writeFile(path.join(datasetDir, "partial.txt"), "demo")
    const storePath = path.join(tmp.path, ".onescience", "modelscope-downloads.json")
    await fs.mkdir(path.dirname(storePath), { recursive: true })
    await fs.writeFile(
      storePath,
      JSON.stringify({
        "OneScience/Water": {
          resource_id: "OneScience/Water",
          kind: "dataset",
          status: "downloading",
          started_at: Date.now(),
          pid: 999_999_999,
        },
      }),
    )

    const record = await cancelModelScopeDatasetDownload(tmp.path, "OneScience/Water")

    expect(record.status).toBe("partial")
    expect(record.error).toBe("cancelled")
    expect((await listModelScopeDownloads(tmp.path))[0]?.status).toBe("partial")
  })

  test("cancels an in-progress download record", async () => {
    await using tmp = await tmpdir()
    const storePath = path.join(tmp.path, ".onescience", "modelscope-downloads.json")
    await fs.mkdir(path.dirname(storePath), { recursive: true })
    await fs.writeFile(
      storePath,
      JSON.stringify({
        "OneScience/Water": {
          resource_id: "OneScience/Water",
          kind: "dataset",
          status: "downloading",
          started_at: Date.now(),
          pid: 999_999_999,
        },
      }),
    )

    const record = await cancelModelScopeDatasetDownload(tmp.path, "OneScience/Water")
    expect(record.status).toBe("failed")
    expect(record.error).toBe("cancelled")
    expect((await getModelScopeDownload(tmp.path, "OneScience/Water"))?.status).toBe("failed")
  })

  test("marks installed datasets as completed when cache exists", async () => {
    await using tmp = await tmpdir()
    const datasetDir = path.join(tmp.path, "modelscope/hub/datasets/OneScience/Water")
    await fs.mkdir(datasetDir, { recursive: true })
    await fs.writeFile(path.join(datasetDir, "sample.txt"), "demo")

    const items = await listModelScopeDownloads(tmp.path)

    expect(items).toHaveLength(1)
    expect(items[0]?.resource_id).toBe("OneScience/Water")
    expect(items[0]?.status).toBe("completed")
  })

  test("marks downloading as completed when the stored pid is no longer running", async () => {
    await using tmp = await tmpdir()
    const datasetDir = path.join(tmp.path, "modelscope/hub/datasets/OneScience/Water")
    await fs.mkdir(datasetDir, { recursive: true })
    await fs.writeFile(path.join(datasetDir, "sample.txt"), "demo")
    const storePath = path.join(tmp.path, ".onescience", "modelscope-downloads.json")
    await fs.mkdir(path.dirname(storePath), { recursive: true })
    await fs.writeFile(
      storePath,
      JSON.stringify({
        "OneScience/Water": {
          resource_id: "OneScience/Water",
          kind: "dataset",
          status: "downloading",
          started_at: Date.now() - 31_000,
          pid: 999_999_999,
        },
      }),
    )

    const items = await listModelScopeDownloads(tmp.path)

    expect(items).toHaveLength(1)
    expect(items[0]?.status).toBe("completed")
  })

  test("lists only active and completed dataset downloads", async () => {
    await using tmp = await tmpdir()
    const datasetDir = path.join(tmp.path, "modelscope/hub/datasets/OneScience/Water")
    await fs.mkdir(datasetDir, { recursive: true })
    await fs.writeFile(path.join(datasetDir, "sample.txt"), "demo")
    const storePath = path.join(tmp.path, ".onescience", "modelscope-downloads.json")
    await fs.mkdir(path.dirname(storePath), { recursive: true })
    await fs.writeFile(
      storePath,
      JSON.stringify({
        "OneScience/OC20": {
          resource_id: "OneScience/OC20",
          kind: "dataset",
          status: "failed",
          started_at: Date.now(),
          finished_at: Date.now(),
          error: "cancelled",
        },
        "OneScience/Water": {
          resource_id: "OneScience/Water",
          kind: "dataset",
          status: "completed",
          started_at: Date.now(),
          finished_at: Date.now(),
        },
        "._____temp/OneScience": {
          resource_id: "._____temp/OneScience",
          kind: "dataset",
          status: "completed",
          started_at: Date.now(),
          finished_at: Date.now(),
        },
      }),
    )

    const items = await listModelScopeDownloads(tmp.path)

    expect(items).toHaveLength(1)
    expect(items[0]?.resource_id).toBe("OneScience/Water")
    expect(items[0]?.status).toBe("completed")
    expect(JSON.parse(await fs.readFile(storePath, "utf8"))).toEqual({
      "local::OneScience/Water": {
        resource_id: "OneScience/Water",
        kind: "dataset",
        status: "completed",
        started_at: items[0]!.started_at,
        finished_at: items[0]!.finished_at,
        environment: { kind: "local" },
      },
    })
  })

  test("keeps downloading status while the process remains", async () => {
    await using tmp = await tmpdir()
    const child = Bun.spawn(["sleep", "300"])
    const datasetDir = path.join(tmp.path, "modelscope/hub/datasets/OneScience/Water")
    await fs.mkdir(datasetDir, { recursive: true })
    await fs.writeFile(path.join(datasetDir, "sample.txt"), "demo")
    const storePath = path.join(tmp.path, ".onescience", "modelscope-downloads.json")
    await fs.mkdir(path.dirname(storePath), { recursive: true })
    await fs.writeFile(
      storePath,
      JSON.stringify({
        "OneScience/Water": {
          resource_id: "OneScience/Water",
          kind: "dataset",
          status: "downloading",
          started_at: Date.now() - 31_000,
          pid: child.pid,
        },
      }),
    )

    expect((await listModelScopeDownloads(tmp.path))[0]?.status).toBe("downloading")
    child.kill()
  })

  test("deletes a completed dataset download", async () => {
    await using tmp = await tmpdir()
    const datasetDir = path.join(tmp.path, "modelscope/hub/datasets/OneScience/Water")
    await fs.mkdir(datasetDir, { recursive: true })
    await fs.writeFile(path.join(datasetDir, "sample.txt"), "demo")
    const storePath = path.join(tmp.path, ".onescience", "modelscope-downloads.json")
    await fs.mkdir(path.dirname(storePath), { recursive: true })
    await fs.writeFile(
      storePath,
      JSON.stringify({
        "OneScience/Water": {
          resource_id: "OneScience/Water",
          kind: "dataset",
          status: "completed",
          started_at: Date.now(),
          finished_at: Date.now(),
        },
      }),
    )

    await deleteModelScopeDatasetDownload(tmp.path, "OneScience/Water")

    await expect(fs.stat(datasetDir)).rejects.toThrow()
    expect(await getModelScopeDownload(tmp.path, "OneScience/Water")).toBeUndefined()
  })

  test("cancels to partial when files remain in modelscope temp cache", async () => {
    await using tmp = await tmpdir()
    const tempDir = path.join(tmp.path, "modelscope/hub/datasets/._____temp/OneScience/Water")
    await fs.mkdir(tempDir, { recursive: true })
    await fs.writeFile(path.join(tempDir, "partial.txt"), "demo")
    const storePath = path.join(tmp.path, ".onescience", "modelscope-downloads.json")
    await fs.mkdir(path.dirname(storePath), { recursive: true })
    await fs.writeFile(
      storePath,
      JSON.stringify({
        "OneScience/Water": {
          resource_id: "OneScience/Water",
          kind: "dataset",
          status: "downloading",
          started_at: Date.now(),
          pid: 999_999_999,
        },
      }),
    )

    const record = await cancelModelScopeDatasetDownload(tmp.path, "OneScience/Water")

    expect(record.status).toBe("partial")
    expect((await listModelScopeDownloads(tmp.path))[0]?.status).toBe("partial")
  })

  test("deletes partial cache from temp and final directories", async () => {
    await using tmp = await tmpdir()
    const datasetDir = path.join(tmp.path, "modelscope/hub/datasets/OneScience/Water")
    const tempDir = path.join(tmp.path, "modelscope/hub/datasets/._____temp/OneScience/Water")
    await fs.mkdir(datasetDir, { recursive: true })
    await fs.mkdir(tempDir, { recursive: true })
    await fs.writeFile(path.join(datasetDir, "sample.txt"), "demo")
    await fs.writeFile(path.join(tempDir, "temp.txt"), "demo")
    const storePath = path.join(tmp.path, ".onescience", "modelscope-downloads.json")
    await fs.mkdir(path.dirname(storePath), { recursive: true })
    await fs.writeFile(
      storePath,
      JSON.stringify({
        "OneScience/Water": {
          resource_id: "OneScience/Water",
          kind: "dataset",
          status: "partial",
          started_at: Date.now(),
          finished_at: Date.now(),
          error: "cancelled",
        },
      }),
    )

    await deleteModelScopeDatasetDownload(tmp.path, "OneScience/Water")

    await expect(fs.stat(datasetDir)).rejects.toThrow()
    await expect(fs.stat(tempDir)).rejects.toThrow()
    expect(await getModelScopeDownload(tmp.path, "OneScience/Water")).toBeUndefined()
  })

  test("fetchModelScopeDatasetStorageSize reads StorageSize from dataset detail API", async () => {
    const size = await fetchModelScopeDatasetStorageSize("OneScience/ERA5", (async () =>
      Response.json({
        Data: { StorageSize: 196789562412, Size: null },
      })) as unknown as typeof fetch)
    expect(size).toBe(196789562412)
  })

  test("fetchModelScopeDatasetStorageSize caches dataset sizes", async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return Response.json({ Data: { StorageSize: 1234 } })
    }) as unknown as typeof fetch
    expect(await fetchModelScopeDatasetStorageSize("OneScience/Cached", fetchImpl)).toBe(1234)
    expect(await fetchModelScopeDatasetStorageSize("OneScience/Cached", fetchImpl)).toBe(1234)
    expect(calls).toBe(1)
  })

  test("getModelScopeDownloadPreflight returns cached dataset size without disk info", async () => {
    await using tmp = await tmpdir()
    await fetchModelScopeDatasetStorageSize("OneScience/Water", (async () => Response.json({ Data: { StorageSize: 4096 } })) as unknown as typeof fetch)
    const preflight = await getModelScopeDownloadPreflight(tmp.path, "OneScience/Water")
    expect(preflight.resourceId).toBe("OneScience/Water")
    expect(preflight.datasetBytes).toBe(4096)
    expect("availableBytes" in preflight).toBe(false)
  })

  test("getModelScopeDownloadDiskSpace returns available bytes", async () => {
    await using tmp = await tmpdir()
    const disk = await getModelScopeDownloadDiskSpace(tmp.path)
    expect(typeof disk.availableBytes).toBe("number")
    expect(disk.availableBytes).toBeGreaterThan(0)
  })

  test("migrates legacy resourceId keys to local environment keys", async () => {
    await using tmp = await tmpdir()
    const storePath = path.join(tmp.path, ".onescience", "modelscope-downloads.json")
    await fs.mkdir(path.dirname(storePath), { recursive: true })
    await fs.writeFile(
      storePath,
      JSON.stringify({
        "OneScience/Water": {
          resource_id: "OneScience/Water",
          kind: "dataset",
          status: "completed",
          started_at: Date.now(),
          finished_at: Date.now(),
        },
      }),
    )

    const items = await listModelScopeDownloads(tmp.path)
    expect(items[0]?.environment).toEqual({ kind: "local" })

    const store = JSON.parse(await fs.readFile(storePath, "utf8"))
    expect(Object.keys(store)).toEqual(["local::OneScience/Water"])
    expect(store["local::OneScience/Water"].environment).toEqual({ kind: "local" })
  })

  test("keeps per-environment records for the same dataset independent", async () => {
    await using tmp = await tmpdir()
    const datasetDir = path.join(tmp.path, "modelscope/hub/datasets/OneScience/Water")
    await fs.mkdir(datasetDir, { recursive: true })
    await fs.writeFile(path.join(datasetDir, "sample.txt"), "demo")
    const storePath = path.join(tmp.path, ".onescience", "modelscope-downloads.json")
    await fs.mkdir(path.dirname(storePath), { recursive: true })
    await fs.writeFile(
      storePath,
      JSON.stringify({
        "ssh:cluster-a::OneScience/Water": {
          resource_id: "OneScience/Water",
          kind: "dataset",
          status: "completed",
          started_at: Date.now(),
          finished_at: Date.now(),
          environment: {
            kind: "ssh",
            target_name: "cluster-a",
            remote_path: "/work/alice/modelscope/hub/datasets",
            log_file: "/work/alice/modelscope/hub/datasets/.onescience-downloads/OneScience__Water.log",
            status_file: "/work/alice/modelscope/hub/datasets/.onescience-downloads/OneScience__Water.status",
            ssh: { host: "127.0.0.1", port: 1 },
          },
        },
      }),
    )

    const items = await listModelScopeDownloads(tmp.path)
    expect(items).toHaveLength(2)
    const local = await getModelScopeDownload(tmp.path, "OneScience/Water")
    const remote = await getModelScopeDownload(tmp.path, "OneScience/Water", { kind: "ssh", targetName: "cluster-a" })
    expect(local?.status).toBe("completed")
    expect(local?.environment?.kind).toBe("local")
    expect(remote?.status).toBe("completed")
    expect(remote?.environment?.kind).toBe("ssh")
  })

  test("rejects ssh download start when the remote host is unreachable", async () => {
    await using tmp = await tmpdir()
    await expect(
      startModelScopeDatasetDownload(tmp.path, "OneScience/Water", {
        kind: "ssh",
        targetName: "cluster-a",
        remotePath: "/work/alice/modelscope/hub/datasets",
        ssh: { host: "127.0.0.1", port: 1 },
      }),
    ).rejects.toThrow()
    expect(await listModelScopeDownloads(tmp.path)).toHaveLength(0)
  })

  test("cancels an ssh download record without a reachable host", async () => {
    await using tmp = await tmpdir()
    const storePath = path.join(tmp.path, ".onescience", "modelscope-downloads.json")
    await fs.mkdir(path.dirname(storePath), { recursive: true })
    await fs.writeFile(
      storePath,
      JSON.stringify({
        "ssh:cluster-a::OneScience/Water": {
          resource_id: "OneScience/Water",
          kind: "dataset",
          status: "downloading",
          started_at: Date.now(),
          pid: 424242,
          environment: {
            kind: "ssh",
            target_name: "cluster-a",
            remote_path: "/work/alice/modelscope/hub/datasets",
            log_file: "/work/alice/modelscope/hub/datasets/.onescience-downloads/OneScience__Water.log",
            status_file: "/work/alice/modelscope/hub/datasets/.onescience-downloads/OneScience__Water.status",
            ssh: { host: "127.0.0.1", port: 1 },
          },
        },
      }),
    )

    const record = await cancelModelScopeDatasetDownload(tmp.path, "OneScience/Water", {
      kind: "ssh",
      targetName: "cluster-a",
    })
    expect(record.status).toBe("failed")
    expect(record.error).toBe("cancelled")
    expect(record.pid).toBeUndefined()
  })
})

describe("parseDfAvailableKb", () => {
  test("reads POSIX df Available column", () => {
    const output = [
      "Filesystem     1024-blocks      Used Available Capacity Mounted on",
      "/dev/sda1        104857600  20971520  83886080      20% /public/home",
    ].join("\n")
    expect(parseDfAvailableKb(output)).toBe(83886080)
  })

  test("reads wrapped df lines that put Used/Available on the second row", () => {
    const output = [
      "Filesystem            1024-blocks      Used Available Capacity Mounted on",
      "10.0.0.1@tcp:/lustre",
      "                       999999999  111111111  22222222      83% /public/home",
    ].join("\n")
    expect(parseDfAvailableKb(output)).toBe(22222222)
  })

  test("parses ParaStor / GNU df output from an existing home directory", () => {
    const output = [
      "Filesystem      1K-blocks  Used Available Use% Mounted on",
      "ks_p300s_public 524288000 13428 524274572   1% /public",
    ].join("\n")
    expect(parseDfAvailableKb(output)).toBe(524274572)
  })

  test("returns undefined for empty df output", () => {
    expect(parseDfAvailableKb("")).toBeUndefined()
    expect(parseDfAvailableKb(undefined)).toBeUndefined()
    expect(parseDfAvailableKb("Filesystem 1024-blocks Used Available Capacity Mounted on\n")).toBeUndefined()
  })
})

describe("remoteDiskProbeAncestors", () => {
  test("walks the typed absolute path and never uses home", () => {
    expect(remoteDiskProbeAncestors("/public/home/easyscience2024/modelscope/hub/datasets")).toEqual([
      "/public/home/easyscience2024/modelscope/hub/datasets",
      "/public/home/easyscience2024/modelscope/hub",
      "/public/home/easyscience2024/modelscope",
      "/public/home/easyscience2024",
      "/public/home",
      "/public",
      "/",
    ])
    expect(remoteDiskProbeAncestors("/work/project/data/")).toEqual(["/work/project/data", "/work/project", "/work", "/"])
    expect(remoteDiskProbeAncestors("/")).toEqual(["/"])
    expect(remoteDiskProbeAncestors("")).toEqual([])
  })

  test("does not fall back to ~ or . for a relative path", () => {
    expect(remoteDiskProbeAncestors("modelscope/hub/datasets")).toEqual([
      "modelscope/hub/datasets",
      "modelscope/hub",
      "modelscope",
    ])
    expect(remoteDiskProbeAncestors("~")).toEqual(["~"])
    expect(remoteDiskProbeAncestors("~/data")).toEqual(["~/data", "~"])
  })
})

describe("remoteCondaPrefix", () => {
  test("is empty when the conda env is blank", () => {
    expect(remoteCondaPrefix(undefined)).toBe("")
    expect(remoteCondaPrefix("")).toBe("")
    expect(remoteCondaPrefix("  ")).toBe("")
  })

  test("activates the named env without embedding double quotes", () => {
    const prefix = remoteCondaPrefix("onescience311")
    expect(prefix).toContain("conda activate 'onescience311'")
    expect(prefix).toContain("conda.sh")
    expect(prefix.endsWith(" && ")).toBe(true)
    expect(prefix.includes('"')).toBe(false)
  })
})

describe("remoteStartDownloadScript", () => {
  test("detaches with bash -c so the SSH session does not wait for modelscope", () => {
    const script = remoteStartDownloadScript({
      setup: remoteUserPathPrefix(),
      resourceId: "OneScience/oc20",
      remotePath: "/home/onescience2026/modelscope/hub/datasets",
      logFile: "/home/onescience2026/modelscope/hub/datasets/.onescience-downloads/OneScience__oc20.log",
      statusFile: "/home/onescience2026/modelscope/hub/datasets/.onescience-downloads/OneScience__oc20.status",
    })
    expect(script.startsWith("set +m;")).toBe(true)
    expect(script).toContain("nohup bash -lc")
    expect(script).toContain("echo $!")
    expect(script).not.toContain("&;")
    expect(script).toContain("disown")
    expect(script).toContain("exit 0")
    expect(script).not.toContain('bash -lc "')
    expect(script).toContain("modelscope download --dataset")
    expect(script).toContain("OneScience/oc20")
  })
})

describe("remoteModelscopeSetup", () => {
  test("puts ~/.local/bin on PATH when conda is omitted, without nested double quotes", () => {
    const prefix = remoteModelscopeSetup(undefined)
    expect(prefix).toBe(remoteUserPathPrefix())
    expect(prefix).toContain("$HOME/.local/bin")
    expect(prefix.includes('"')).toBe(false)
  })

  test("activates conda instead of prepending ~/.local/bin when an env is named", () => {
    const prefix = remoteModelscopeSetup("onescience311")
    expect(prefix).toContain("conda activate 'onescience311'")
    expect(prefix).not.toContain("$HOME/.local/bin")
  })
})

describe("localModelscopeDownloadCommand", () => {
  test("does not activate conda when the env is omitted", () => {
    const command = localModelscopeDownloadCommand("OneScience/oc20")
    expect(command).not.toContain("conda activate")
    expect(command).toContain("modelscope download --dataset 'OneScience/oc20'")
  })

  test("activates the named conda env before modelscope", () => {
    const command = localModelscopeDownloadCommand("OneScience/oc20", "onescience311")
    expect(command).toContain("conda activate 'onescience311'")
    expect(command).toContain("modelscope download --dataset 'OneScience/oc20'")
    expect(command.startsWith(remoteCondaPrefix("onescience311"))).toBe(true)
  })
})

describe("datasetCacheRelPaths", () => {
  test("covers hub layout, legacy org/name, and temp dirs", () => {
    expect(datasetCacheRelPaths("OneScience/DeePMD")).toEqual([
      "OneScience/DeePMD",
      "datasets/OneScience--DeePMD",
      "OneScience--DeePMD",
      "datasets/OneScience/DeePMD",
      "._____temp/OneScience/DeePMD",
    ])
    expect(datasetCacheDisplayRelPath("OneScience/DeePMD")).toBe("datasets/OneScience--DeePMD")
    expect(remoteCacheTargets("/home/onescience2026/modelscope/hub/datasets", "OneScience/DeePMD")).toContain(
      "/home/onescience2026/modelscope/hub/datasets/datasets/OneScience--DeePMD",
    )
    expect(remoteCacheTargets("/home/onescience2026/modelscope/hub/datasets", "OneScience/DeePMD")).toContain(
      "/home/onescience2026/modelscope/hub/datasets/OneScience/DeePMD",
    )
  })
})

describe("remoteLogChunkScript", () => {
  test("reads the modelscope log incrementally without probing disk usage", () => {
    const script = remoteLogChunkScript("/tmp/OneScience__oc20.log", 4096, 262144)
    expect(script).toContain("tail -c +")
    expect(script).toContain("n=4096")
    expect(script).toContain("c=262144")
    expect(script).not.toContain("du ")
    expect(script).not.toContain("df ")
  })
})

describe("parseCondaEnvList", () => {
  test("parses HPC conda env list text including the active base env", () => {
    const output = `# conda environments:
#
onescience311            /public/home/hanmk_sg/.conda/envs/onescience311
py311                    /public/home/hanmk_sg/.conda/envs/py311
base                  *  /public/software/sghpc_sdk/Linux_x86_64/25.6/das/conda
aiops_dev                /public/software/sghpc_sdk/Linux_x86_64/25.6/das/conda/envs/aiops_dev
deepmd-kit-3.1.0         /public/software/sghpc_sdk/Linux_x86_64/25.6/das/conda/envs/deepmd-kit-3.1.0
`
    const items = parseCondaEnvList(output)
    expect(items.map((item) => item.name)).toEqual([
      "onescience311",
      "py311",
      "base",
      "aiops_dev",
      "deepmd-kit-3.1.0",
    ])
    expect(items.find((item) => item.name === "base")).toEqual({
      name: "base",
      path: "/public/software/sghpc_sdk/Linux_x86_64/25.6/das/conda",
      active: true,
    })
    expect(items.find((item) => item.name === "onescience311")?.active).toBeUndefined()
  })

  test("shares one login-shell conda list script for local and SSH queries", () => {
    expect(CONDA_ENV_LIST_SCRIPT).toContain("conda env list")
    expect(CONDA_ENV_LIST_SCRIPT).toContain("__OS_NO_CONDA__")
    expect(CONDA_ENV_LIST_SCRIPT).toContain("conda.sh")
  })
})

describe("remoteDiskDfScript", () => {
  test("walks the typed path with plain df and without bash -lc wrapping", () => {
    const script = remoteDiskDfScript("/public/home/hanmk_sg/modelscope/hub/datasets")
    expect(script).toContain("/public/home/hanmk_sg/modelscope/hub/datasets")
    expect(script).toContain("df -k")
    expect(script).toContain('df "$p"')
    expect(script).not.toContain("bash -lc")
    expect(script).not.toContain("df -Pk")
    expect(script).not.toContain("$HOME")
    expect(script).not.toMatch(/(^|[^/])~\b/)
  })
})
