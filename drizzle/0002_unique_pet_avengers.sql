ALTER TABLE `users` ADD `failed_logins` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `locked_at` text;