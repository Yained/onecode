CREATE TABLE IF NOT EXISTS platform_account (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  avatar_url TEXT,
  time_created INTEGER NOT NULL,
  time_updated INTEGER,
  time_deleted INTEGER
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS platform_account_email ON platform_account(email);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS platform_account_status ON platform_account(status);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS platform_password_credential (
  account_id TEXT PRIMARY KEY NOT NULL REFERENCES platform_account(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  password_updated_at INTEGER NOT NULL,
  time_created INTEGER NOT NULL,
  time_updated INTEGER
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS platform_auth_identity (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES platform_account(id) ON DELETE CASCADE,
  email TEXT,
  name TEXT,
  raw_profile TEXT,
  time_created INTEGER NOT NULL,
  time_updated INTEGER
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS platform_auth_identity_provider_subject ON platform_auth_identity(provider, subject);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS platform_auth_identity_account ON platform_auth_identity(account_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS platform_auth_session (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES platform_account(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT,
  time_created INTEGER NOT NULL,
  time_updated INTEGER,
  time_revoked INTEGER
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS platform_auth_session_token ON platform_auth_session(token_hash);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS platform_auth_session_account ON platform_auth_session(account_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS platform_workspace (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  default_env_path TEXT NOT NULL,
  owner_account_id TEXT REFERENCES platform_account(id) ON DELETE SET NULL,
  time_created INTEGER NOT NULL,
  time_updated INTEGER,
  time_deleted INTEGER
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS platform_workspace_slug ON platform_workspace(slug);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS platform_workspace_owner ON platform_workspace(owner_account_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS platform_workspace_member (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES platform_workspace(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES platform_account(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active',
  time_created INTEGER NOT NULL,
  time_updated INTEGER,
  time_deleted INTEGER
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS platform_workspace_member_unique ON platform_workspace_member(workspace_id, account_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS platform_workspace_member_account ON platform_workspace_member(account_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS platform_resource_quota (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES platform_workspace(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES platform_account(id) ON DELETE CASCADE,
  cpu_limit INTEGER,
  memory_limit_mb INTEGER,
  gpu_limit INTEGER,
  storage_limit_mb INTEGER,
  session_limit INTEGER,
  monthly_token_limit INTEGER,
  monthly_cost_limit REAL,
  time_created INTEGER NOT NULL,
  time_updated INTEGER
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS platform_resource_quota_workspace ON platform_resource_quota(workspace_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS platform_resource_quota_account ON platform_resource_quota(account_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS platform_resource_usage (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES platform_workspace(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES platform_account(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,
  amount REAL NOT NULL,
  unit TEXT NOT NULL,
  source_id TEXT,
  source_type TEXT,
  metadata TEXT,
  time_created INTEGER NOT NULL,
  time_updated INTEGER
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS platform_resource_usage_workspace ON platform_resource_usage(workspace_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS platform_resource_usage_account ON platform_resource_usage(account_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS platform_resource_usage_type ON platform_resource_usage(resource_type);
