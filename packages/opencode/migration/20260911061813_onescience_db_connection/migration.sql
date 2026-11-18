CREATE TABLE IF NOT EXISTS `onescience_db_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`engine` text NOT NULL,
	`host` text NOT NULL,
	`port` integer NOT NULL,
	`database` text NOT NULL,
	`username` text NOT NULL,
	`password_ciphertext` text NOT NULL,
	`label` text,
	`ssl_mode` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	`time_deleted` integer
);
