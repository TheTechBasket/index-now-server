ALTER TABLE `submitted_urls` ADD `host_mismatch` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_site_urls_site_id` ON `submitted_urls` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_site_urls_site_submitted` ON `submitted_urls` (`site_id`,`submitted_at`);--> statement-breakpoint
CREATE INDEX `idx_submissions_site_id` ON `submissions` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_submissions_created_at` ON `submissions` (`created_at`);