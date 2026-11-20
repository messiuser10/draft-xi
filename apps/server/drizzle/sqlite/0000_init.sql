CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_user_id` integer,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text,
	`game_id` integer,
	`details` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_log_created_at_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_action_idx` ON `audit_log` (`action`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`user_id` integer,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chat_messages_game_created_idx` ON `chat_messages` (`game_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `clubs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`short_name` text NOT NULL,
	`country` text NOT NULL,
	`league_name` text NOT NULL,
	`primary_color` text NOT NULL,
	`secondary_color` text NOT NULL,
	`strength_rating` real,
	`in_pool` integer DEFAULT true NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clubs_name_unique` ON `clubs` (`name`);--> statement-breakpoint
CREATE TABLE `draft_picks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`participant_id` integer NOT NULL,
	`pick_number` integer NOT NULL,
	`round` integer NOT NULL,
	`player_id` integer NOT NULL,
	`slot_key` text NOT NULL,
	`auto_picked` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `draft_picks_game_player_unique` ON `draft_picks` (`game_id`,`player_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `draft_picks_game_pick_number_unique` ON `draft_picks` (`game_id`,`pick_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `draft_picks_participant_slot_unique` ON `draft_picks` (`participant_id`,`slot_key`);--> statement-breakpoint
CREATE TABLE `fixtures` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`matchday` integer NOT NULL,
	`home_team_id` integer NOT NULL,
	`away_team_id` integer NOT NULL,
	`home_goals` integer,
	`away_goals` integer,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`home_team_id`) REFERENCES `season_teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`away_team_id`) REFERENCES `season_teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `fixtures_season_matchday_idx` ON `fixtures` (`season_id`,`matchday`);--> statement-breakpoint
CREATE TABLE `games` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`join_code` text NOT NULL,
	`name` text NOT NULL,
	`host_user_id` integer,
	`status` text DEFAULT 'lobby' NOT NULL,
	`settings` text NOT NULL,
	`seed` integer,
	`current_pick_number` integer DEFAULT 0 NOT NULL,
	`current_participant_id` integer,
	`pick_deadline` integer,
	`strength_snapshot` text,
	`ai_club_ids` text,
	`playback_state` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`host_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`current_participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `games_join_code_unique` ON `games` (`join_code`);--> statement-breakpoint
CREATE INDEX `games_status_idx` ON `games` (`status`);--> statement-breakpoint
CREATE TABLE `match_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fixture_id` integer NOT NULL,
	`minute` integer NOT NULL,
	`type` text NOT NULL,
	`player_id` integer,
	`season_team_id` integer NOT NULL,
	FOREIGN KEY (`fixture_id`) REFERENCES `fixtures`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`season_team_id`) REFERENCES `season_teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `match_events_fixture_idx` ON `match_events` (`fixture_id`);--> statement-breakpoint
CREATE TABLE `participants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`user_id` integer,
	`team_name` text,
	`color` text,
	`monogram` text,
	`formation` text,
	`pick_order` integer,
	`is_ready` integer DEFAULT false NOT NULL,
	`is_bot` integer DEFAULT false NOT NULL,
	`bot_level` text,
	`is_connected` integer DEFAULT false NOT NULL,
	`is_spectator` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `participants_game_team_name_unique` ON `participants` (`game_id`,`team_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `participants_game_user_unique` ON `participants` (`game_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `player_season_stats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`season_team_id` integer NOT NULL,
	`appearances` integer DEFAULT 0 NOT NULL,
	`goals` integer DEFAULT 0 NOT NULL,
	`assists` integer DEFAULT 0 NOT NULL,
	`clean_sheets` integer DEFAULT 0 NOT NULL,
	`yellows` integer DEFAULT 0 NOT NULL,
	`reds` integer DEFAULT 0 NOT NULL,
	`rating_sum` real DEFAULT 0 NOT NULL,
	`avg_rating` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`season_team_id`) REFERENCES `season_teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `player_season_stats_unique` ON `player_season_stats` (`season_id`,`player_id`,`season_team_id`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`club_id` integer NOT NULL,
	`full_name` text NOT NULL,
	`display_name` text NOT NULL,
	`primary_position` text NOT NULL,
	`alt_positions` text NOT NULL,
	`overall` integer NOT NULL,
	`nationality` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_injured` integer DEFAULT false NOT NULL,
	`source_note` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "players_overall_range" CHECK("players"."overall" between 40 and 99)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `players_club_full_name_unique` ON `players` (`club_id`,`full_name`);--> statement-breakpoint
CREATE TABLE `queue_items` (
	`participant_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`sort_order` integer NOT NULL,
	PRIMARY KEY(`participant_id`, `player_id`),
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `season_teams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`kind` text NOT NULL,
	`participant_id` integer,
	`club_id` integer,
	`name` text NOT NULL,
	`primary_color` text NOT NULL,
	`secondary_color` text NOT NULL,
	`lineup` text NOT NULL,
	`formation` text NOT NULL,
	`attack_rating` real NOT NULL,
	`defense_rating` real NOT NULL,
	`chemistry_bonus` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `season_teams_season_idx` ON `season_teams` (`season_id`);--> statement-breakpoint
CREATE TABLE `seasons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`season_number` integer NOT NULL,
	`seed` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`parameters_snapshot` text NOT NULL,
	`champion_season_team_id` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`champion_season_team_id`) REFERENCES `season_teams`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seasons_game_season_number_unique` ON `seasons` (`game_id`,`season_number`);--> statement-breakpoint
CREATE TABLE `standing_rows` (
	`season_id` integer NOT NULL,
	`matchday` integer NOT NULL,
	`season_team_id` integer NOT NULL,
	`played` integer NOT NULL,
	`won` integer NOT NULL,
	`drawn` integer NOT NULL,
	`lost` integer NOT NULL,
	`goals_for` integer NOT NULL,
	`goals_against` integer NOT NULL,
	`goal_difference` integer NOT NULL,
	`points` integer NOT NULL,
	`position` integer NOT NULL,
	`form` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`season_id`, `matchday`, `season_team_id`),
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_team_id`) REFERENCES `season_teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text,
	`password_hash` text,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`is_guest` integer DEFAULT false NOT NULL,
	`banned` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);