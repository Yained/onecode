import { createHash, randomBytes, timingSafeEqual } from "crypto"
import { Database } from "@/storage/db"
import { and, eq, isNull } from "drizzle-orm"
import { OneScienceCatalogTokenTable } from "./data-project.sql"

const TTL_MS = 12 * 60 * 60 * 1000
const SUPERSEDE_GRACE_MS = 30_000

export type CatalogTokenClaims = {
  accountId: string
  workspaceId: string
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

function hashesEqual(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function mintCatalogToken(input: { accountId: string; workspaceId: string }) {
  const token = randomBytes(32).toString("base64url")
  const tokenHash = hashToken(token)
  const now = Date.now()
  Database.transaction((db) => {
    const previous = db
      .select()
      .from(OneScienceCatalogTokenTable)
      .where(
        and(
          eq(OneScienceCatalogTokenTable.workspace_id, input.workspaceId),
          eq(OneScienceCatalogTokenTable.account_id, input.accountId),
          isNull(OneScienceCatalogTokenTable.superseded_at),
        ),
      )
      .all()
    for (const row of previous) {
      db.update(OneScienceCatalogTokenTable)
        .set({ superseded_at: now })
        .where(eq(OneScienceCatalogTokenTable.token_hash, row.token_hash))
        .run()
    }
    db.insert(OneScienceCatalogTokenTable)
      .values({
        token_hash: tokenHash,
        account_id: input.accountId,
        workspace_id: input.workspaceId,
        expires_at: now + TTL_MS,
        superseded_at: null,
        time_created: now,
      })
      .run()
  })
  return token
}

export function verifyCatalogToken(token: string | undefined): CatalogTokenClaims | undefined {
  const value = token?.trim()
  if (!value) return
  const tokenHash = hashToken(value)
  const now = Date.now()
  const row = Database.use((db) =>
    db.select().from(OneScienceCatalogTokenTable).where(eq(OneScienceCatalogTokenTable.token_hash, tokenHash)).get(),
  )
  if (!row || !hashesEqual(row.token_hash, tokenHash)) return
  if (row.expires_at <= now) return
  if (row.superseded_at != null && now > row.superseded_at + SUPERSEDE_GRACE_MS) return
  return { accountId: row.account_id, workspaceId: row.workspace_id }
}

export function revokeCatalogTokens(workspaceId: string, input?: { immediate?: boolean }) {
  const now = Date.now()
  const supersededAt = input?.immediate === false ? now : now - SUPERSEDE_GRACE_MS - 1
  Database.use((db) => {
    db.update(OneScienceCatalogTokenTable)
      .set({ superseded_at: supersededAt })
      .where(and(eq(OneScienceCatalogTokenTable.workspace_id, workspaceId), isNull(OneScienceCatalogTokenTable.superseded_at)))
      .run()
  })
}

export function revokeAccountCatalogTokens(accountId: string) {
  const now = Date.now()
  Database.use((db) => {
    db.update(OneScienceCatalogTokenTable)
      .set({ superseded_at: now - SUPERSEDE_GRACE_MS - 1 })
      .where(and(eq(OneScienceCatalogTokenTable.account_id, accountId), isNull(OneScienceCatalogTokenTable.superseded_at)))
      .run()
  })
}
