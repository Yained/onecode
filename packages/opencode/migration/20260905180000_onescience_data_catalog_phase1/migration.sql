CREATE TABLE IF NOT EXISTS `onescience_data_session_meta` (
	`session_id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`last_already_json_hash` text,
	`last_ingest_at` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `onescience_catalog_token` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`superseded_at` integer,
	`time_created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `onescience_catalog_token_workspace_idx` ON `onescience_catalog_token` (`workspace_id`);
