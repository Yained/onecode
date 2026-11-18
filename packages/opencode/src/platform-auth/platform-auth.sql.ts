import { integer, real, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"

export const PlatformAccountTable = sqliteTable(
  "platform_account",
  {
    id: text().primaryKey(),
    email: text().notNull(),
    name: text().notNull(),
    status: text().notNull().default("active"),
    avatar_url: text(),
    ...Timestamps,
    time_deleted: integer(),
  },
  (table) => [uniqueIndex("platform_account_email").on(table.email), index("platform_account_status").on(table.status)],
)

export const PlatformPasswordCredentialTable = sqliteTable("platform_password_credential", {
  account_id: text().primaryKey().references(() => PlatformAccountTable.id, { onDelete: "cascade" }),
  password_hash: text().notNull(),
  password_updated_at: integer().notNull(),
  ...Timestamps,
})

export const PlatformPasswordResetTokenTable = sqliteTable(
  "platform_password_reset_token",
  {
    id: text().primaryKey(),
    account_id: text().notNull().references(() => PlatformAccountTable.id, { onDelete: "cascade" }),
    token_hash: text().notNull(),
    expires_at: integer().notNull(),
    ...Timestamps,
    time_used: integer(),
  },
  (table) => [
    uniqueIndex("platform_password_reset_token_hash").on(table.token_hash),
    index("platform_password_reset_token_account").on(table.account_id),
  ],
)

export const PlatformAuthIdentityTable = sqliteTable(
  "platform_auth_identity",
  {
    id: text().primaryKey(),
    provider: text().notNull(),
    subject: text().notNull(),
    account_id: text().notNull().references(() => PlatformAccountTable.id, { onDelete: "cascade" }),
    email: text(),
    name: text(),
    raw_profile: text({ mode: "json" }).$type<Record<string, unknown>>(),
    ...Timestamps,
  },
  (table) => [uniqueIndex("platform_auth_identity_provider_subject").on(table.provider, table.subject), index("platform_auth_identity_account").on(table.account_id)],
)

export const PlatformAuthSessionTable = sqliteTable(
  "platform_auth_session",
  {
    id: text().primaryKey(),
    account_id: text().notNull().references(() => PlatformAccountTable.id, { onDelete: "cascade" }),
    token_hash: text().notNull(),
    expires_at: integer().notNull(),
    ip: text(),
    user_agent: text(),
    ...Timestamps,
    time_revoked: integer(),
  },
  (table) => [uniqueIndex("platform_auth_session_token").on(table.token_hash), index("platform_auth_session_account").on(table.account_id)],
)

export const PlatformWorkspaceTable = sqliteTable(
  "platform_workspace",
  {
    id: text().primaryKey(),
    slug: text().notNull(),
    name: text().notNull(),
    default_env_path: text().notNull(),
    owner_account_id: text().references(() => PlatformAccountTable.id, { onDelete: "set null" }),
    ...Timestamps,
    time_deleted: integer(),
  },
  (table) => [uniqueIndex("platform_workspace_slug").on(table.slug), index("platform_workspace_owner").on(table.owner_account_id)],
)

export const PlatformWorkspaceMemberTable = sqliteTable(
  "platform_workspace_member",
  {
    id: text().primaryKey(),
    workspace_id: text().notNull().references(() => PlatformWorkspaceTable.id, { onDelete: "cascade" }),
    account_id: text().notNull().references(() => PlatformAccountTable.id, { onDelete: "cascade" }),
    role: text().notNull().default("member"),
    status: text().notNull().default("active"),
    ...Timestamps,
    time_deleted: integer(),
  },
  (table) => [uniqueIndex("platform_workspace_member_unique").on(table.workspace_id, table.account_id), index("platform_workspace_member_account").on(table.account_id)],
)

export const PlatformResourceQuotaTable = sqliteTable(
  "platform_resource_quota",
  {
    id: text().primaryKey(),
    workspace_id: text().notNull().references(() => PlatformWorkspaceTable.id, { onDelete: "cascade" }),
    account_id: text().references(() => PlatformAccountTable.id, { onDelete: "cascade" }),
    cpu_limit: integer(),
    memory_limit_mb: integer(),
    gpu_limit: integer(),
    storage_limit_mb: integer(),
    session_limit: integer(),
    monthly_token_limit: integer(),
    monthly_cost_limit: real(),
    ...Timestamps,
  },
  (table) => [index("platform_resource_quota_workspace").on(table.workspace_id), index("platform_resource_quota_account").on(table.account_id)],
)

export const PlatformResourceUsageTable = sqliteTable(
  "platform_resource_usage",
  {
    id: text().primaryKey(),
    workspace_id: text().notNull().references(() => PlatformWorkspaceTable.id, { onDelete: "cascade" }),
    account_id: text().notNull().references(() => PlatformAccountTable.id, { onDelete: "cascade" }),
    resource_type: text().notNull(),
    amount: real().notNull(),
    unit: text().notNull(),
    source_id: text(),
    source_type: text(),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    ...Timestamps,
  },
  (table) => [index("platform_resource_usage_workspace").on(table.workspace_id), index("platform_resource_usage_account").on(table.account_id), index("platform_resource_usage_type").on(table.resource_type)],
)
