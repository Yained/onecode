import fs from "node:fs/promises"
import path from "node:path"

const MAX_REPORTED_BYTES = Number.MAX_SAFE_INTEGER

/** Convert statfs fields to free bytes. Throws when the reading is unusable. */
export function availableBytesFromStatfs(stat: { bavail: number | bigint; bsize: number | bigint }) {
  const bsize = BigInt(stat.bsize)
  const bavail = BigInt(stat.bavail)
  // Bun linux-x64 (1.3.x) truncates non-bigint `bavail` to int32, so filesystems
  // larger than ~8TB report negative free space (oven-sh/bun#31510). Bun darwin-x64
  // can also shift the statfs struct and return `bsize=0` (oven-sh/bun#31133).
  // Both must not be treated as "disk full".
  if (bsize <= 0n || bavail < 0n) throw new Error("unreliable disk space")
  const bytes = bavail * bsize
  if (bytes > BigInt(MAX_REPORTED_BYTES)) return MAX_REPORTED_BYTES
  return Number(bytes)
}

export async function getAvailableDiskBytes(target: string) {
  let probe = path.resolve(target)
  while (true) {
    try {
      await fs.access(probe)
      break
    } catch {
      const parent = path.dirname(probe)
      if (parent === probe) throw new Error("path not accessible")
      probe = parent
    }
  }

  const stat = await fs.statfs(probe, { bigint: true })
  return availableBytesFromStatfs(stat)
}
