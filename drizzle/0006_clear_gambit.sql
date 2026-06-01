CREATE TABLE `environments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`gpuModel` varchar(128),
	`gpuCount` int,
	`inferenceEngine` varchar(128),
	`engineVersion` varchar(128),
	`quantization` varchar(64),
	`maxModelLen` int,
	`gpuMemoryUtilization` decimal(4,2),
	`prometheusUrl` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `environments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `test_configs` MODIFY COLUMN `inputData` mediumtext;--> statement-breakpoint
ALTER TABLE `metrics_timeseries` ADD `gpuUtilization` double;--> statement-breakpoint
ALTER TABLE `metrics_timeseries` ADD `vramUsage` double;--> statement-breakpoint
ALTER TABLE `metrics_timeseries` ADD `kvCacheUsage` double;--> statement-breakpoint
ALTER TABLE `test_configs` ADD `environmentId` int;--> statement-breakpoint
ALTER TABLE `test_results` ADD `environmentId` int;