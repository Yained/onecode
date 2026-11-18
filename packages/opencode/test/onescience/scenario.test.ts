import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { OneScienceScenario } from "@/onescience/scenario"
import { OneScienceScenarioTable } from "@/onescience/scenario.sql"
import { Database } from "@/storage/db"
import { resetDatabase } from "../fixture/db"

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await resetDatabase()
})

describe("OneScienceScenario", () => {
  test("seeds built-in scenarios into sqlite", () => {
    const result = OneScienceScenario.seedDefaults()
    const rows = Database.use((db) => db.select().from(OneScienceScenarioTable).all())

    expect(result.seeded).toBeGreaterThan(0)
    expect(rows.length).toBeGreaterThanOrEqual(7)
    expect(rows.map((row) => row.scenario_id)).toContain("M1")
    expect(rows.map((row) => row.scenario_id)).toContain("BIO01")
    expect(rows.map((row) => row.scenario_id)).toContain("BIO02")
    expect(rows.map((row) => row.scenario_id)).toContain("E2")
    expect(rows.map((row) => row.scenario_id)).toContain("M2")
    expect(rows.some((row) => row.id === "seed-scenarios-M2")).toBe(false)
    expect(rows.some((row) => row.scenario_id === "M2" && row.domain === "materials")).toBe(true)
    expect(rows.some((row) => row.id === "seed-scenarios-M1" && row.model_ids.includes("mace"))).toBe(true)
    expect(OneScienceScenario.list().items.length).toBeGreaterThanOrEqual(7)
  })

  test("replaces obsolete bundled seeds like V01 on sync", () => {
    Database.use((db) =>
      db
        .insert(OneScienceScenarioTable)
        .values({
          id: "seed-scenarios-V01",
          scenario_id: "V01",
          domain: "materials",
          model: "MACE",
          model_ids: ["mace"],
          type: "paper_scenario",
          name: "legacy V01",
          hpc: "VASP, LAMMPS",
          problem: "legacy",
          document: {
            scenario_id: "V01",
            type: "paper_scenario",
            name: "legacy V01",
            model: "MACE",
            model_ids: ["mace"],
            problem_and_applicability: "legacy",
            user_input: [],
            workflow: [],
            outputs: "",
          },
          time_created: Date.now(),
          time_updated: Date.now(),
          time_deleted: null,
        })
        .run(),
    )

    const result = OneScienceScenario.seedDefaults()
    expect(result.removed).toBeGreaterThan(0)
    expect(OneScienceScenario.list().items.map((item) => item.scenario_id)).not.toContain("V01")
    expect(OneScienceScenario.list().items.length).toBeGreaterThanOrEqual(7)
  })

  test("lists scenarios by domain and model id", () => {
    OneScienceScenario.seedDefaults()
    const materials = OneScienceScenario.list({ domain: "materials" })
    const weather = OneScienceScenario.list({ domain: "weather" })
    const bio = OneScienceScenario.list({ domain: "bio" })
    const mace = OneScienceScenario.list({ modelId: "mace" })

    expect(materials.items.length).toBeGreaterThan(0)
    expect(weather.items.length).toBeGreaterThan(0)
    expect(bio.items.some((item) => item.scenario_id === "BIO01")).toBe(true)
    expect(bio.items.some((item) => item.scenario_id === "BIO02")).toBe(true)
    expect(mace.items.map((item) => item.scenario_id)).toContain("M1")
  })

  test("gets by seed id or scenario_id and auto-seeds when empty", () => {
    const listed = OneScienceScenario.list({ limit: 10 })
    expect(listed.items.length).toBeGreaterThan(0)

    const byScenarioId = OneScienceScenario.get("M1")
    const bySeedId = OneScienceScenario.get("seed-scenarios-M1")
    expect(byScenarioId.scenario_id).toBe("M1")
    expect(bySeedId.id).toBe("seed-scenarios-M1")
    expect(bySeedId.model).toBe("MACE")
    expect(bySeedId.user_input).toHaveLength(43)
    expect((bySeedId.user_input as Array<{ default?: unknown }>)[0]?.default).toBeTruthy()
    expect(bySeedId.is_onemodel).toBe(true)
  })

  test("does not restore a scenario after soft delete", () => {
    OneScienceScenario.seedDefaults()
    Database.use((db) =>
      db
        .update(OneScienceScenarioTable)
        .set({ time_deleted: Date.now() })
        .where(eq(OneScienceScenarioTable.id, "seed-scenarios-M1"))
        .run(),
    )

    OneScienceScenario.seedDefaults()
    expect(OneScienceScenario.list().items.map((item) => item.id)).not.toContain("seed-scenarios-M1")
  })
})
