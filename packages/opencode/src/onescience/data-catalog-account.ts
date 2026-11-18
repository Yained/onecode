import { Database } from "@/storage/db"
import { and, eq, isNull } from "drizzle-orm"
import {
  OneScienceDataArtifactTable,
  OneScienceDataProjectTable,
  OneScienceDataSessionChipTable,
  OneScienceDataSessionMetaTable,
} from "./data-project.sql"
import { OneScienceResourceTable } from "./resource.sql"
import { revokeAccountCatalogTokens } from "./catalog-token"
import { deleteAccountObjectStoreKeys } from "./object-store-key"
import { deleteAccountDbConnections } from "./db-connection"

export function deleteAccountCatalog(accountId: string) {
  const now = Date.now()
  Database.transaction((db) => {
    const artifacts = db
      .select()
      .from(OneScienceDataArtifactTable)
      .where(and(eq(OneScienceDataArtifactTable.owner, accountId), isNull(OneScienceDataArtifactTable.time_deleted)))
      .all()
    for (const row of artifacts) {
      db.update(OneScienceDataArtifactTable)
        .set({ visibility: "private", time_deleted: now, time_updated: now })
        .where(eq(OneScienceDataArtifactTable.id, row.id))
        .run()
    }
    db.update(OneScienceDataProjectTable)
      .set({ time_deleted: now, time_updated: now })
      .where(and(eq(OneScienceDataProjectTable.owner, accountId), isNull(OneScienceDataProjectTable.time_deleted)))
      .run()
    db.delete(OneScienceDataSessionChipTable).where(eq(OneScienceDataSessionChipTable.owner, accountId)).run()
    db.delete(OneScienceDataSessionMetaTable).where(eq(OneScienceDataSessionMetaTable.owner, accountId)).run()

    // Soft-delete published OneData catalog cards linked via metadata.already_id.
    const resources = db
      .select()
      .from(OneScienceResourceTable)
      .where(
        and(
          eq(OneScienceResourceTable.page, "datasets"),
          eq(OneScienceResourceTable.owner, accountId),
          isNull(OneScienceResourceTable.time_deleted),
        ),
      )
      .all()
    for (const resource of resources) {
      if (typeof resource.metadata?.already_id !== "string") continue
      db.update(OneScienceResourceTable)
        .set({ time_deleted: now, time_updated: now })
        .where(eq(OneScienceResourceTable.id, resource.id))
        .run()
    }
  })
  revokeAccountCatalogTokens(accountId)
  deleteAccountObjectStoreKeys(accountId)
  deleteAccountDbConnections(accountId)
}
