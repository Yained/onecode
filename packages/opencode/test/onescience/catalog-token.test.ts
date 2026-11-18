import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mintCatalogToken, revokeCatalogTokens, verifyCatalogToken } from "@/onescience/catalog-token"
import { resetDatabase } from "../fixture/db"

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await resetDatabase()
})

describe("catalog token", () => {
  test("verifies a minted token and rejects it after immediate revoke", () => {
    const token = mintCatalogToken({ accountId: "acct-1", workspaceId: "wrk_1" })
    expect(verifyCatalogToken(token)).toEqual({ accountId: "acct-1", workspaceId: "wrk_1" })
    revokeCatalogTokens("wrk_1", { immediate: true })
    expect(verifyCatalogToken(token)).toBeUndefined()
  })

  test("rotate keeps the old token valid for a short grace period", () => {
    const first = mintCatalogToken({ accountId: "acct-1", workspaceId: "wrk_1" })
    const second = mintCatalogToken({ accountId: "acct-1", workspaceId: "wrk_1" })
    expect(verifyCatalogToken(second)?.accountId).toBe("acct-1")
    expect(verifyCatalogToken(first)?.accountId).toBe("acct-1")
  })
})
