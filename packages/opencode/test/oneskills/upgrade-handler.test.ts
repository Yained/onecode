import { describe, expect, test } from "bun:test"

describe("OneSkills upgrade handler", () => {
  test("installs into the shared OneSkills tree", async () => {
    const source = await Bun.file(
      new URL("../../src/server/routes/instance/httpapi/handlers/experimental.ts", import.meta.url),
    ).text()
    const handler = source.indexOf("const oneScienceOneskillsUpgrade =")
    expect(handler).toBeGreaterThan(-1)
    expect(source.indexOf("requireAccountId(current)", handler)).toBeGreaterThan(handler)
    expect(source.indexOf("OneSkills.globalProjectRoot()", handler)).toBeGreaterThan(handler)
    expect(source.indexOf("removeAccountOneskillsInstalls()", handler)).toBeGreaterThan(handler)
    expect(source.indexOf("OneSkills.upgrade({ projectRoot", handler)).toBeGreaterThan(handler)
    expect(source.indexOf("migrateStaticPrimitives({ projectRoot })", handler)).toBeGreaterThan(handler)
    expect(source.indexOf("accountInstallRoot(accountId)", handler)).toBe(-1)
  })
})
