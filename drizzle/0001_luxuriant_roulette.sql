PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_submitted_urls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` text NOT NULL,
	`url` text NOT NULL,
	`lastmod` text,
	`first_seen_at` integer,
	`last_seen_at` integer,
	`submitted_at` integer,
	`submitted_lastmod` text,
	`status_code` integer,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_submitted_urls`("id", "site_id", "url", "lastmod", "first_seen_at", "last_seen_at", "submitted_at", "submitted_lastmod", "status_code") SELECT "id", "site_id", "url", NULL, NULL, NULL, "submitted_at", NULL, "status_code" FROM `submitted_urls`;--> statement-breakpoint
DROP TABLE `submitted_urls`;--> statement-breakpoint
ALTER TABLE `__new_submitted_urls` RENAME TO `submitted_urls`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `submitted_urls_site_url` ON `submitted_urls` (`site_id`,`url`);--> statement-breakpoint
ALTER TABLE `sites` ADD `last_sync_at` integer;