ALTER TABLE `onescience_data_project` ADD COLUMN `public_id` text;
--> statement-breakpoint
ALTER TABLE `onescience_data_project` ADD COLUMN `workspace_id` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `onescience_data_project` ADD COLUMN `connector` text NOT NULL DEFAULT 'local_fs';
--> statement-breakpoint
ALTER TABLE `onescience_data_project` ADD COLUMN `ingest_method` text NOT NULL DEFAULT 'onescience';
--> statement-breakpoint
ALTER TABLE `onescience_data_project` ADD COLUMN `lineage_public_id` text;
--> statement-breakpoint
ALTER TABLE `onescience_data_artifact` ADD COLUMN `public_id` text;
--> statement-breakpoint
ALTER TABLE `onescience_data_artifact` ADD COLUMN `owner` text;
--> statement-breakpoint
ALTER TABLE `onescience_data_artifact` ADD COLUMN `visibility` text NOT NULL DEFAULT 'private';
--> statement-breakpoint
ALTER TABLE `onescience_data_artifact` ADD COLUMN `workspace_id` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `onescience_data_artifact` ADD COLUMN `source_raw_ids` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `onescience_data_artifact` ADD COLUMN `status` text NOT NULL DEFAULT 'draft';
--> statement-breakpoint
ALTER TABLE `onescience_data_artifact` ADD COLUMN `build_method` text NOT NULL DEFAULT 'direct';
--> statement-breakpoint
ALTER TABLE `onescience_data_artifact` ADD COLUMN `connector` text NOT NULL DEFAULT 'local_fs';
--> statement-breakpoint
ALTER TABLE `onescience_data_artifact` ADD COLUMN `logical_bytes` integer;
--> statement-breakpoint
ALTER TABLE `onescience_data_artifact` ADD COLUMN `record_count` integer;
--> statement-breakpoint
ALTER TABLE `onescience_data_artifact` ADD COLUMN `entry_count` integer;
--> statement-breakpoint
UPDATE `onescience_data_project`
SET `time_deleted` = CAST(strftime('%s','now') AS integer) * 1000
WHERE `time_deleted` IS NULL AND (`owner` IS NULL OR trim(`owner`) = '');
--> statement-breakpoint
UPDATE `onescience_data_project`
SET `public_id` = 'raw_' || replace(substr(`id`, 14), '-', '')
WHERE `public_id` IS NULL AND `id` LIKE 'data-project-%';
--> statement-breakpoint
UPDATE `onescience_data_artifact`
SET `time_deleted` = CAST(strftime('%s','now') AS integer) * 1000
WHERE `time_deleted` IS NULL AND (`uri` IS NULL OR trim(`uri`) = '');
--> statement-breakpoint
UPDATE `onescience_data_artifact`
SET `public_id` = 'alr_' || replace(substr(`id`, 15), '-', '')
WHERE `public_id` IS NULL AND `id` LIKE 'data-artifact-%';
--> statement-breakpoint
UPDATE `onescience_data_artifact`
SET `owner` = (
  SELECT `owner` FROM `onescience_data_project` WHERE `onescience_data_project`.`id` = `onescience_data_artifact`.`project_id`
)
WHERE `owner` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `onescience_data_project_public_id_unique` ON `onescience_data_project` (`public_id`) WHERE `public_id` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `onescience_data_artifact_public_id_unique` ON `onescience_data_artifact` (`public_id`) WHERE `public_id` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `onescience_data_artifact_alive_uri_unique` ON `onescience_data_artifact` (`owner`, `workspace_id`, `uri`) WHERE `time_deleted` IS NULL AND `uri` IS NOT NULL AND `uri` != '';
--> statement-breakpoint
CREATE TABLE `onescience_data_session_chip` (
  `session_id` text NOT NULL,
  `raw_id` text NOT NULL,
  `owner` text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  PRIMARY KEY (`session_id`, `raw_id`)
);
