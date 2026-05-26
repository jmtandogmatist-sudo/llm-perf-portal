CREATE TABLE `datasets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`payloadUrl` varchar(1024),
	`rawPayload` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `datasets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `metrics_timeseries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`resultId` int NOT NULL,
	`virtualUserId` int,
	`timestamp` timestamp NOT NULL,
	`latency` double,
	`ttft` double,
	`tps` double,
	`isError` boolean NOT NULL DEFAULT false,
	`errorCode` varchar(128),
	CONSTRAINT `metrics_timeseries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `api_keys` MODIFY COLUMN `isActive` boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE `test_results` MODIFY COLUMN `status` enum('running','completed','failed','aborted') NOT NULL;--> statement-breakpoint
ALTER TABLE `test_results` MODIFY COLUMN `successRate` decimal(5,2);--> statement-breakpoint
ALTER TABLE `test_results` MODIFY COLUMN `ttftAvg` decimal(10,2);--> statement-breakpoint
ALTER TABLE `test_results` MODIFY COLUMN `ttftP95` decimal(10,2);--> statement-breakpoint
ALTER TABLE `test_results` MODIFY COLUMN `ttftP99` decimal(10,2);--> statement-breakpoint
ALTER TABLE `test_results` MODIFY COLUMN `tpsAvg` decimal(10,2);--> statement-breakpoint
ALTER TABLE `test_results` MODIFY COLUMN `itlAvg` decimal(10,2);--> statement-breakpoint
ALTER TABLE `test_results` MODIFY COLUMN `qps` decimal(10,2);--> statement-breakpoint
ALTER TABLE `test_results` MODIFY COLUMN `avgLatency` decimal(10,2);--> statement-breakpoint
ALTER TABLE `test_results` MODIFY COLUMN `p95Latency` decimal(10,2);--> statement-breakpoint
ALTER TABLE `api_keys` ADD `apiProvider` varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE `api_keys` ADD `deletedAt` timestamp;--> statement-breakpoint
ALTER TABLE `test_configs` ADD `datasetId` int;--> statement-breakpoint
ALTER TABLE `api_keys` DROP COLUMN `configId`;