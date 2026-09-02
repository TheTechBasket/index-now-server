ALTER TABLE `sites` ADD `sitemap_children` text;--> statement-breakpoint
ALTER TABLE `sites` ADD `excluded_sitemaps` text DEFAULT '[]' NOT NULL;
