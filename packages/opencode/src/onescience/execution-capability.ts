import { Process } from "@/util/process"

export type LocalSlurmCapability = {
  available: boolean
  sbatchVersion?: string
  sinfoAvailable?: boolean
  partitions?: string[]
  detail: string
}

export type ExecutionCapability = {
  slurm: LocalSlurmCapability
}

async function runText(cmd: string[], timeout = 5_000) {
  const result = await Process.run(cmd, { nothrow: true, timeout })
  return {
    ok: result.code === 0,
    text: result.stdout.toString().trim() || result.stderr.toString().trim(),
  }
}

function parsePartitions(text: string) {
  const names = text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\*$/, ""))
    .filter(Boolean)
  return [...new Set(names)].slice(0, 12)
}

export async function probeLocalSlurm(): Promise<LocalSlurmCapability> {
  const version = await runText(["sbatch", "--version"])
  if (!version.ok) {
    return {
      available: false,
      detail: "当前环境未检测到 sbatch，无法在本机直接提交 Slurm 作业。",
    }
  }

  const sinfo = await runText(["sinfo", "-h", "-o", "%P"])
  const partitions = sinfo.ok ? parsePartitions(sinfo.text) : undefined
  const detailParts = [version.text || "sbatch 可用"]
  if (partitions && partitions.length > 0) detailParts.push(`分区: ${partitions.join(", ")}`)
  else if (sinfo.ok) detailParts.push("已检测到 sinfo")

  return {
    available: true,
    sbatchVersion: version.text || undefined,
    sinfoAvailable: sinfo.ok,
    ...(partitions && partitions.length > 0 ? { partitions } : {}),
    detail: detailParts.join(" · "),
  }
}

export async function probeExecutionCapability(): Promise<ExecutionCapability> {
  return {
    slurm: await probeLocalSlurm(),
  }
}
