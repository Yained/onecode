CREATE TABLE `onescience_data_project` (
  `id` text PRIMARY KEY NOT NULL,
  `slug` text NOT NULL,
  `title` text NOT NULL,
  `description` text NOT NULL,
  `domain` text NOT NULL,
  `status` text NOT NULL,
  `raw_data_uri` text NOT NULL,
  `raw_data_format` text NOT NULL,
  `raw_data_license` text,
  `raw_data_metadata_json` text,
  `target_dataset_name` text NOT NULL,
  `target_dataset_goal` text NOT NULL,
  `target_task_type` text NOT NULL,
  `owner` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `time_deleted` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `onescience_data_project_slug_unique` ON `onescience_data_project` (`slug`);
--> statement-breakpoint
CREATE TABLE `onescience_data_agent_run` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `run_type` text NOT NULL,
  `status` text NOT NULL,
  `input_json` text NOT NULL,
  `plan_json` text,
  `result_json` text,
  `error_message` text,
  `session_id` text,
  `time_started` integer NOT NULL,
  `time_completed` integer,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `time_deleted` integer,
  FOREIGN KEY (`project_id`) REFERENCES `onescience_data_project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `onescience_data_artifact` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `run_id` text,
  `artifact_type` text NOT NULL,
  `title` text NOT NULL,
  `uri` text,
  `format` text NOT NULL,
  `metadata_json` text,
  `version` text,
  `quality_score` real,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `time_deleted` integer,
  FOREIGN KEY (`project_id`) REFERENCES `onescience_data_project`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`run_id`) REFERENCES `onescience_data_agent_run`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `onescience_data_quality_report` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `artifact_id` text,
  `schema_score` real,
  `missing_score` real,
  `license_score` real,
  `train_ready_score` real,
  `checks_json` text NOT NULL,
  `recommendations_json` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `time_deleted` integer,
  FOREIGN KEY (`project_id`) REFERENCES `onescience_data_project`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`artifact_id`) REFERENCES `onescience_data_artifact`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `onescience_data_release` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `artifact_id` text,
  `target` text NOT NULL,
  `status` text NOT NULL,
  `resource_id` text,
  `training_config_json` text,
  `publish_payload_json` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `time_deleted` integer,
  FOREIGN KEY (`project_id`) REFERENCES `onescience_data_project`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`artifact_id`) REFERENCES `onescience_data_artifact`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`resource_id`) REFERENCES `onescience_resource`(`id`) ON UPDATE no action ON DELETE set null
);
