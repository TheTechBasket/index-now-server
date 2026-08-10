ALTER TABLE `settings` ADD `webhook_secret` text;--> statement-breakpoint
ALTER TABLE `sites` DROP COLUMN `webhook_secret`;