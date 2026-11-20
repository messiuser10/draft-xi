ALTER TABLE `games` ADD `paused_remaining_ms` integer;--> statement-breakpoint
ALTER TABLE `participants` ADD `rerolls_used` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `participants` ADD `auto_draft` text;