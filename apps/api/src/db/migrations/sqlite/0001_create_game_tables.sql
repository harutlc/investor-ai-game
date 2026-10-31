CREATE TABLE `decision_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`turn` integer NOT NULL,
	`stage` text NOT NULL,
	`provider` text NOT NULL,
	`model` text,
	`questions` text NOT NULL,
	`answers` text,
	`error_code` text,
	`latency_ms` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `game_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `decision_logs_session_turn_idx` ON `decision_logs` (`session_id`,`turn`);--> statement-breakpoint
CREATE TABLE `game_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`persona_id` text NOT NULL,
	`scenario_id` text,
	`pitch` text NOT NULL,
	`status` text NOT NULL,
	`phase` text NOT NULL,
	`turn` integer NOT NULL,
	`current_investor_offer` text,
	`investor_state` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `game_sessions_player_created_idx` ON `game_sessions` (`player_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `game_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_session_created_idx` ON `messages` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `offers` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`from` text NOT NULL,
	`investment` integer NOT NULL,
	`equity` real NOT NULL,
	`implied_valuation` integer NOT NULL,
	`turn` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `game_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `offers_session_turn_idx` ON `offers` (`session_id`,`turn`);