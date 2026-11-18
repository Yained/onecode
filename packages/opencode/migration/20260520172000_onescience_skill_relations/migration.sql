ALTER TABLE `onescience_resource` ADD `resource_type` text;
--> statement-breakpoint
ALTER TABLE `onescience_resource` ADD `trust_level` text DEFAULT 'user';
--> statement-breakpoint
ALTER TABLE `onescience_resource` ADD `license` text;
--> statement-breakpoint
ALTER TABLE `onescience_resource` ADD `version` text;
--> statement-breakpoint
ALTER TABLE `onescience_resource` ADD `owner` text;
--> statement-breakpoint
ALTER TABLE `onescience_resource` ADD `metadata` text;
--> statement-breakpoint
ALTER TABLE `onescience_resource` ADD `verification_state` text DEFAULT 'draft';
--> statement-breakpoint
ALTER TABLE `onescience_resource` ADD `verified_at` integer;
--> statement-breakpoint
ALTER TABLE `onescience_resource` ADD `verified_by` text;
--> statement-breakpoint

CREATE TABLE `onescience_skill` (
  `id` text PRIMARY KEY NOT NULL,
  `title` text NOT NULL,
  `copy` text NOT NULL,
  `layer` text NOT NULL,
  `tags` text NOT NULL,
  `provider` text NOT NULL,
  `size` text NOT NULL,
  `format` text NOT NULL,
  `href` text,
  `sort_order` integer NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `time_deleted` integer
);
--> statement-breakpoint

CREATE TABLE `onescience_skill_primitive` (
  `id` text PRIMARY KEY NOT NULL,
  `skill_id` text NOT NULL,
  `primitive_id` text NOT NULL,
  `binding_role` text NOT NULL,
  `sort_order` integer NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `time_deleted` integer,
  FOREIGN KEY (`skill_id`) REFERENCES `onescience_skill`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`primitive_id`) REFERENCES `ai_primitive`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `onescience_skill_primitive_unique` ON `onescience_skill_primitive` (`skill_id`,`primitive_id`);
--> statement-breakpoint

CREATE TABLE `onescience_primitive_resource` (
  `id` text PRIMARY KEY NOT NULL,
  `primitive_id` text NOT NULL,
  `resource_id` text NOT NULL,
  `resource_page` text NOT NULL,
  `relation_type` text NOT NULL,
  `sort_order` integer NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `time_deleted` integer,
  FOREIGN KEY (`primitive_id`) REFERENCES `ai_primitive`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`resource_id`) REFERENCES `onescience_resource`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `onescience_primitive_resource_unique` ON `onescience_primitive_resource` (`primitive_id`,`resource_id`,`relation_type`);
