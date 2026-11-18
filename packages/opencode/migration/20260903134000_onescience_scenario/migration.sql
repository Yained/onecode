CREATE TABLE `onescience_scenario` (
	`id` text PRIMARY KEY,
	`scenario_id` text NOT NULL,
	`domain` text NOT NULL,
	`model` text NOT NULL,
	`model_ids` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`hpc` text,
	`problem` text NOT NULL,
	`document` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	`time_deleted` integer
);
--> statement-breakpoint
CREATE INDEX `onescience_scenario_domain_idx` ON `onescience_scenario` (`domain`);
--> statement-breakpoint
CREATE INDEX `onescience_scenario_scenario_id_idx` ON `onescience_scenario` (`scenario_id`);
--> statement-breakpoint
CREATE INDEX `onescience_scenario_model_idx` ON `onescience_scenario` (`model`);
