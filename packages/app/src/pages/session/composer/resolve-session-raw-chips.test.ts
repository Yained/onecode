import { describe, expect, test } from "bun:test"
import { resolveSessionRawChipItems } from "./resolve-session-raw-chips"

describe("resolveSessionRawChipItems", () => {
  test("maps owned raw ids onto catalog rows and keeps missing ids visible", () => {
    expect(
      resolveSessionRawChipItems(["raw_a", "raw_missing"], [
        { id: "raw_a", title: "ERA5 subset", uri: "/data/era5.csv" },
        { id: "raw_b", title: "Other", uri: "/data/other.csv" },
      ]),
    ).toEqual([
      { id: "raw_a", title: "ERA5 subset", uri: "/data/era5.csv" },
      { id: "raw_missing", title: "raw_missing", uri: "" },
    ])
  })

  test("returns an empty list when no chips are attached", () => {
    expect(resolveSessionRawChipItems([], [{ id: "raw_a", title: "ERA5", uri: "/x" }])).toEqual([])
  })
})
