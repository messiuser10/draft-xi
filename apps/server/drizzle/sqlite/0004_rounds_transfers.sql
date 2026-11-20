CREATE TABLE `roster_moves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`participant_id` integer NOT NULL,
	`slot_key` text NOT NULL,
	`out_player_id` integer NOT NULL,
	`in_player_id` integer NOT NULL,
	`kind` text NOT NULL,
	`window_kind` text NOT NULL,
	`season_number` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `roster_moves_game_idx` ON `roster_moves` (`game_id`);--> statement-breakpoint
CREATE TABLE `trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`from_participant_id` integer NOT NULL,
	`to_participant_id` integer NOT NULL,
	`offer_player_id` integer NOT NULL,
	`request_player_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`responded_at` integer,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trades_game_idx` ON `trades` (`game_id`);--> statement-breakpoint
ALTER TABLE `games` ADD `series_id` integer;--> statement-breakpoint
ALTER TABLE `games` ADD `round_number` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `games` ADD `window_state` text;--> statement-breakpoint
CREATE INDEX `games_series_idx` ON `games` (`series_id`);--> statement-breakpoint
ALTER TABLE `participants` ADD `captain_player_id` integer;--> statement-breakpoint
ALTER TABLE `participants` ADD `respin_pick` integer;--> statement-breakpoint
ALTER TABLE `seasons` ADD `inputs_snapshot` text;