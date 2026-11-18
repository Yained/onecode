import { describe, expect, test } from "bun:test"

describe("onescience execution capability module", () => {
  test("exports local slurm probe helpers", async () => {
    const source = await Bun.file(new URL("../../src/onescience/execution-capability.ts", import.meta.url)).text()
    expect(source).toContain("export async function probeLocalSlurm")
    expect(source).toContain('["sbatch", "--version"]')
    expect(source).toContain('["sinfo", "-h", "-o", "%P"]')
  })
})
