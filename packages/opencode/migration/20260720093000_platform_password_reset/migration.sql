CREATE TABLE IF NOT EXISTS platform_password_reset_token (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES platform_account(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  time_created INTEGER NOT NULL,
  time_updated INTEGER,
  time_used INTEGER
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS platform_password_reset_token_hash ON platform_password_reset_token(token_hash);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS platform_password_reset_token_account ON platform_password_reset_token(account_id);
