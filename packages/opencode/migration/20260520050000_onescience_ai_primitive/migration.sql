CREATE TABLE `ai_primitive` (
	`id` text PRIMARY KEY,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`domain` text NOT NULL,
	`primitive_type` text NOT NULL,
	`intent_tags` text NOT NULL,
	`source_resource_ids` text,
	`status` text NOT NULL DEFAULT 'draft',
	`contract_json` text,
	`adapter_json` text,
	`validation_json` text,
	`quality_score` real,
	`owner` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	`time_deleted` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_primitive_slug_unique` ON `ai_primitive` (`slug`);
