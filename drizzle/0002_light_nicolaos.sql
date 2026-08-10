ALTER TABLE `sites` ADD `sitemap_count` integer;--> statement-breakpoint
ALTER TABLE `sites` ADD `key_verified` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `sites` ADD `key_verified_at` integer;