CREATE TABLE `onescience_resource` (
	`id` text PRIMARY KEY,
	`page` text NOT NULL,
	`title` text NOT NULL,
	`copy` text NOT NULL,
	`tags` text NOT NULL,
	`provider` text NOT NULL,
	`size` text NOT NULL,
	`format` text NOT NULL,
	`href` text,
	`source` text NOT NULL,
	`metric_label` text NOT NULL,
	`action` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	`time_deleted` integer
);
