CREATE TABLE `api_keys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`configId` int NOT NULL,
	`keyEncrypted` text NOT NULL,
	`keyName` varchar(255),
	`isActive` int NOT NULL DEFAULT 1,
	`usageCount` int NOT NULL DEFAULT 0,
	`lastUsedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `api_keys_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `test_results` ADD `keysUsed` int;--> statement-breakpoint
ALTER TABLE `test_configs` DROP COLUMN `apiKeyEncrypted`;