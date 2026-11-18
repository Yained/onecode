import { describe, expect, test } from "bun:test"
import { buildOnedataPreview, formatLabel } from "./onedata-preview"

describe("onedata preview model", () => {
  test("renders csv as a table model", () => {
    const model = buildOnedataPreview(
      {
        sample: "name,value\nalpha,1\nbeta,2\n",
        probe: { format_hint: "csv", logical_bytes: 28 },
      },
      { title: "demo.csv", format: "csv" },
    )
    expect(model.kind).toBe("table")
    expect(model.headers).toEqual(["name", "value"])
    expect(model.rows).toEqual([
      ["alpha", "1"],
      ["beta", "2"],
    ])
    expect(formatLabel("csv")).toBe("CSV 表格")
  })

  test("renders database table_preview as a table model", () => {
    const model = buildOnedataPreview(
      {
        table_preview: {
          columns: ["id", "title", "year"],
          rows: [
            { id: 1, title: "Graph neural potentials", year: 2024 },
            { id: 2, title: "ERA5 downscaling", year: null },
          ],
        },
        probe: { format_hint: "table", entry_count: 3 },
      },
      { title: "public.papers", format: "table" },
    )
    expect(model.kind).toBe("table")
    expect(model.format).toBe("table")
    expect(model.headers).toEqual(["id", "title", "year"])
    expect(model.rows).toEqual([
      ["1", "Graph neural potentials", "2024"],
      ["2", "ERA5 downscaling", ""],
    ])
    expect(model.subtitle).toContain("约 3 行")
    expect(formatLabel("table")).toBe("数据表")
  })

  test("renders fasta as sequence cards", () => {
    const model = buildOnedataPreview(
      { sample: ">seq1 desc\nATGC\n>seq2\nGGTT\n", probe: { format_hint: "fasta" } },
      { title: "reads.fasta", format: "fasta" },
    )
    expect(model.kind).toBe("fasta")
    expect(model.sequences).toEqual([
      { header: "seq1 desc", sequence: "ATGC" },
      { header: "seq2", sequence: "GGTT" },
    ])
  })

  test("renders directory listing with nested sample preview", () => {
    const model = buildOnedataPreview(
      {
        sample: '{"ok":true}\n',
        sample_path: "meta.json",
        directory_listing: {
          entries: [
            { path: "meta.json", is_dir: false, size_bytes: 12 },
            { path: "nested/", is_dir: true },
          ],
          truncated: false,
          sample_path: "meta.json",
        },
        probe: { format_hint: "directory", entry_count: 2, is_dir: true },
      },
      { title: "bundle", format: "directory" },
    )
    expect(model.kind).toBe("directory")
    expect(model.entries?.length).toBe(2)
    expect(model.nested?.kind).toBe("json")
    expect(model.nested?.body).toContain('"ok": true')
  })

  test("renders scientific summaries as cards", () => {
    const model = buildOnedataPreview(
      {
        sample: "npy: shape=(2, 3) dtype=int64\nsample: [0 1 2 3 4 5]\n",
        probe: { format_hint: "npy" },
      },
      { title: "vector.npy", format: "npy" },
    )
    expect(model.kind).toBe("scientific")
    expect(model.cards?.[0]?.label).toContain("npy")
  })
})
