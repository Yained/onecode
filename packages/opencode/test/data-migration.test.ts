import { describe, expect, test } from "bun:test"
import { DataMigration } from "@/data-migration"

describe("DataMigration", () => {
  test("does not seed OneScience resources during app startup", () => {
    expect(DataMigration.migrations.map((migration) => migration.name)).not.toContain("onescience_resource_seed_v1")
  })
})
