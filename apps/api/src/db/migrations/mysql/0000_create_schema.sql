CREATE TABLE `decision_logs` (
	`id` varchar(36) NOT NULL,
	`seq` serial AUTO_INCREMENT,
	`session_id` varchar(36) NOT NULL,
	`turn` int NOT NULL,
	`stage` varchar(64) NOT NULL,
	`provider` varchar(128) NOT NULL,
	`model` varchar(128),
	`questions` json NOT NULL,
	`answers` json,
	`error_code` varchar(64),
	`latency_ms` int NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `decision_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `game_sessions` (
	`id` varchar(36) NOT NULL,
	`seq` serial AUTO_INCREMENT,
	`player_id` varchar(36) NOT NULL,
	`persona_id` varchar(64) NOT NULL,
	`scenario_id` varchar(64),
	`pitch` json NOT NULL,
	`status` varchar(64) NOT NULL,
	`phase` varchar(64) NOT NULL,
	`turn` int NOT NULL,
	`current_investor_offer` json,
	`investor_state` json NOT NULL,
	`player_options` json NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `game_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` varchar(36) NOT NULL,
	`seq` serial AUTO_INCREMENT,
	`session_id` varchar(36) NOT NULL,
	`role` varchar(64) NOT NULL,
	`text` text NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `offers` (
	`id` varchar(36) NOT NULL,
	`seq` serial AUTO_INCREMENT,
	`session_id` varchar(36) NOT NULL,
	`from` varchar(64) NOT NULL,
	`investment` bigint NOT NULL,
	`equity` double NOT NULL,
	`implied_valuation` bigint NOT NULL,
	`turn` int NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `offers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `players` (
	`id` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`last_seen_at` datetime(3) NOT NULL,
	CONSTRAINT `players_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `decision_logs` ADD CONSTRAINT `decision_logs_session_id_game_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `game_sessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `game_sessions` ADD CONSTRAINT `game_sessions_player_id_players_id_fk` FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `messages` ADD CONSTRAINT `messages_session_id_game_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `game_sessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `offers` ADD CONSTRAINT `offers_session_id_game_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `game_sessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `decision_logs_session_turn_idx` ON `decision_logs` (`session_id`,`turn`);--> statement-breakpoint
CREATE INDEX `game_sessions_player_created_idx` ON `game_sessions` (`player_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `messages_session_created_idx` ON `messages` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `offers_session_turn_idx` ON `offers` (`session_id`,`turn`);