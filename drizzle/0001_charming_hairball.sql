ALTER TABLE `attempts` ADD `session_id` text;--> statement-breakpoint
CREATE INDEX `attempts_session_idx` ON `attempts` (`session_id`);