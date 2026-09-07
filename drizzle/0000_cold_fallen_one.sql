CREATE TABLE `attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`word_id` integer NOT NULL,
	`mode` text NOT NULL,
	`direction` text NOT NULL,
	`correct` integer NOT NULL,
	`overridden` integer DEFAULT false NOT NULL,
	`given_answer` text,
	`answered_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`word_id`) REFERENCES `words`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attempts_word_idx` ON `attempts` (`word_id`);--> statement-breakpoint
CREATE INDEX `attempts_answered_at_idx` ON `attempts` (`answered_at`);--> statement-breakpoint
CREATE TABLE `languages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `languages_user_name_idx` ON `languages` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `progress` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`word_id` integer NOT NULL,
	`mode` text NOT NULL,
	`direction` text NOT NULL,
	`tested` integer DEFAULT 0 NOT NULL,
	`correct` integer DEFAULT 0 NOT NULL,
	`streak` integer DEFAULT 0 NOT NULL,
	`last_tested` text,
	FOREIGN KEY (`word_id`) REFERENCES `words`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `progress_word_mode_direction_idx` ON `progress` (`word_id`,`mode`,`direction`);--> statement-breakpoint
CREATE INDEX `progress_word_idx` ON `progress` (`word_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settings_user_key_idx` ON `settings` (`user_id`,`key`);--> statement-breakpoint
CREATE TABLE `stat_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`language_id` integer NOT NULL,
	`word_type_id` integer,
	`mode` text NOT NULL,
	`taken_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`measure` text NOT NULL,
	`value` real NOT NULL,
	FOREIGN KEY (`language_id`) REFERENCES `languages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`word_type_id`) REFERENCES `word_types`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `stat_snapshots_language_idx` ON `stat_snapshots` (`language_id`);--> statement-breakpoint
CREATE INDEX `stat_snapshots_taken_at_idx` ON `stat_snapshots` (`taken_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `word_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`language_id` integer NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`language_id`) REFERENCES `languages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `word_types_language_name_idx` ON `word_types` (`language_id`,`name`);--> statement-breakpoint
CREATE TABLE `words` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`word_type_id` integer NOT NULL,
	`term` text NOT NULL,
	`english` text NOT NULL,
	`written_enabled` integer DEFAULT true NOT NULL,
	`audio_enabled` integer DEFAULT true NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`word_type_id`) REFERENCES `word_types`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `words_type_idx` ON `words` (`word_type_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `words_type_term_idx` ON `words` (`word_type_id`,`term`);