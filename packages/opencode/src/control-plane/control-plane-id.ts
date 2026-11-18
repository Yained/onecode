import fs from "fs"
import path from "path"
import { randomUUID } from "crypto"
import { Global } from "@opencode-ai/core/global"

const FILE_NAME = "control-plane-id"

export function controlPlaneId(dataDir = Global.Path.data) {
  const file = path.join(dataDir, FILE_NAME)
  try {
    const existing = fs.readFileSync(file, "utf8").trim()
    if (existing) return existing
  } catch {}
  const id = randomUUID()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${id}\n`, { encoding: "utf8", mode: 0o600 })
  return id
}
