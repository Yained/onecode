import { describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "fs"
import os from "os"
import path from "path"
import { sampleScientificBinary, isSampleableFormat } from "../../src/onescience/sample-scientific"

describe("sampleScientificBinary", () => {
  test("recognizes common research text and binary formats", () => {
    expect(isSampleableFormat("pdb")).toBe(true)
    expect(isSampleableFormat("fastq")).toBe(true)
    expect(isSampleableFormat("nc")).toBe(true)
    expect(isSampleableFormat("h5")).toBe(true)
    expect(isSampleableFormat("npz")).toBe(true)
    expect(isSampleableFormat("bam")).toBe(false)
  })

  test("summarizes npy arrays via numpy", () => {
    const dir = path.join(os.tmpdir(), `sci-sample-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, "vector.npy")
    const create = Bun.spawnSync([
      "python3",
      "-c",
      `import numpy as np; np.save(${JSON.stringify(file)}, np.arange(6).reshape(2,3))`,
    ])
    expect(create.exitCode).toBe(0)
    const sample = sampleScientificBinary(file, "npy")
    expect(sample).toContain("shape=(2, 3)")
    expect(sample).toContain("dtype=int")
  })

  test("summarizes netcdf variables", () => {
    const dir = path.join(os.tmpdir(), `sci-nc-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, "demo.nc")
    const create = Bun.spawnSync(
      [
        "python3",
        "-c",
        [
          "import netCDF4 as nc, numpy as np",
          `ds=nc.Dataset(${JSON.stringify(file)}, "w")`,
          'ds.createDimension("x", 3)',
          'v=ds.createVariable("temp", "f4", ("x",))',
          "v[:]=[1,2,3]",
          'ds.setncattr("title", "demo")',
          "ds.close()",
        ].join("; "),
      ],
    )
    expect(create.exitCode).toBe(0)
    const sample = sampleScientificBinary(file, "nc")
    expect(sample).toContain("temp:")
    expect(sample).toContain("shape=(3,)")
  })
})
