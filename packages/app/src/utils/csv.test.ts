import { describe, expect, test } from "bun:test"
import { parseCsv } from "./csv"

describe("parseCsv", () => {
  test("parses header and rows", () => {
    const parsed = parseCsv("seed,sample,score\n101,3,0.9\n102,1,0.8\n")
    expect(parsed.headers).toEqual(["seed", "sample", "score"])
    expect(parsed.rows).toEqual([
      ["101", "3", "0.9"],
      ["102", "1", "0.8"],
    ])
  })

  test("handles quoted commas", () => {
    const parsed = parseCsv('name,note\n"a,b","ok""yes"\n')
    expect(parsed.headers).toEqual(["name", "note"])
    expect(parsed.rows).toEqual([["a,b", 'ok"yes']])
  })
})
