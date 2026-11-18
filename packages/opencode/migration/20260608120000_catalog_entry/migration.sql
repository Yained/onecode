CREATE TABLE `catalog_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`category` text,
	`tags` text NOT NULL,
	`source` text,
	`status` text,
	`location` text,
	`payload_json` text,
	`time_updated` integer NOT NULL
);
