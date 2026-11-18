CREATE TABLE IF NOT EXISTS `onescience_object_store_key` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider` text NOT NULL,
	`endpoint` text,
	`region` text,
	`label` text,
	`access_key_id` text NOT NULL,
	`secret_ciphertext` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	`time_deleted` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `onescience_object_store_key_account_provider` ON `onescience_object_store_key` (`account_id`, `provider`) WHERE `time_deleted` IS NULL;
