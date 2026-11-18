import { rm } from "fs/promises"
import { Database } from "@/storage/db"
import { appliedMarkerPath } from "@/onescience/oneskills-primitive-seed"
import { disposeAllInstances } from "./fixture"

export async function resetDatabase() {
  await disposeAllInstances().catch(() => undefined)
  Database.close()
  const dbPath = Database.getPath()
  await rm(dbPath, { force: true }).catch(() => undefined)
  await rm(`${dbPath}-wal`, { force: true }).catch(() => undefined)
  await rm(`${dbPath}-shm`, { force: true }).catch(() => undefined)
  await rm(appliedMarkerPath(dbPath), { force: true }).catch(() => undefined)
}
