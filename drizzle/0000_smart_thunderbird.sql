CREATE TABLE `recurrences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`rule` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`datetime` text NOT NULL,
	`is_done` integer DEFAULT false NOT NULL,
	`remind_minutes_before` integer DEFAULT 15 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
