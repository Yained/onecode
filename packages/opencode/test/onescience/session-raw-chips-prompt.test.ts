import { describe, expect, test } from "bun:test"
import { formatSessionRawChipsPrompt } from "../../src/onescience/session-raw-chips-prompt"

describe("session raw chips prompt", () => {
  test("returns undefined when no chips", () => {
    expect(formatSessionRawChipsPrompt([])).toBeUndefined()
  })

  test("includes raw ids and dataset_report guidance", () => {
    const block = formatSessionRawChipsPrompt([
      { id: "raw_abc", title: "ERA5 sample", uri: "/data/era5.csv" },
    ])
    expect(block).toContain("raw_abc")
    expect(block).toContain("ERA5 sample")
    expect(block).toContain("source_dir=/data/era5.csv")
    expect(block).toContain("dataset_report")
    expect(block).toContain("target_dir")
    expect(block).toContain("NOT trainable")
    expect(block).toContain("<session-raw-data>")
    expect(block).toContain("Do not write .onescience/already.json")
    expect(block).not.toContain("read-only table")
  })

  test("adds database Raw note when connector is database", () => {
    const block = formatSessionRawChipsPrompt([
      {
        id: "raw_db1",
        title: "experiments",
        uri: "postgres://dbc_x/public.experiments",
        connector: "database",
      },
    ])
    expect(block).toContain("raw_db1")
    expect(block).toContain("connector=database")
    expect(block).toContain("read-only table")
    expect(block).toContain("not a training set by default")
    expect(block).toContain("dataset_report")
    expect(block).toContain("convert")
  })
})
