import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { resetDatabase } from "../fixture/db"
import * as DataCatalog from "../../src/onescience/data-catalog"
import { bindAlreadyPrimitive } from "../../src/onescience/already-primitive"
import { writeFileSync, mkdirSync } from "fs"
import path from "path"
import os from "os"

const accountId = "acct_already_primitive"

function tempDir() {
  const dir = path.join(os.tmpdir(), `onedata-prim-${crypto.randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await resetDatabase()
})

describe("already-primitive binding", () => {
  test("bindAlreadyPrimitive creates data.load and marks complete", async () => {
    const dir = tempDir()
    const file = path.join(dir, "train.csv")
    writeFileSync(file, "a,b\n1,2\n")
    const raw = await DataCatalog.registerRaw({
      accountId,
      title: "Papers",
      uri: file,
      connector: "local_fs",
    })
    const already = await DataCatalog.convertRaw({ id: raw.id, accountId })
    expect(already.primitive_complete).toBe(false)

    const bound = bindAlreadyPrimitive({
      alreadyId: already.id,
      accountId,
      fields: {
        title: "Papers ready",
        description: "cleaned papers",
        data_schema: "csv: title,year",
        usage_notes: "english only",
      },
    })
    expect(bound.primitive_id.startsWith("primitive-")).toBe(true)
    expect(bound.primitive_complete).toBe(true)

    const again = DataCatalog.getAlready(already.id, { accountId })
    expect(again.primitive_complete).toBe(true)
    expect(again.primitive_id).toBe(bound.primitive_id)
  })
})
