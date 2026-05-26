CREATE TABLE `test_configs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`apiProvider` varchar(64) NOT NULL,
	`apiUrl` text NOT NULL,
	`apiKeyEncrypted` text NOT NULL,
	`model` varchar(255) NOT NULL,
	`concurrency` int NOT NULL,
	`duration` int NOT NULL,
	`loadMode` varchar(64) NOT NULL,
	`inputType` varchar(64) NOT NULL,
	`inputData` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `test_configs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `test_results` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`configId` int NOT NULL,
	`status` enum('running','completed','failed') NOT NULL,
	`totalRequests` int,
	`successfulRequests` int,
	`successRate` varchar(10),
	`ttftAvg` varchar(20),
	`ttftP95` varchar(20),
	`ttftP99` varchar(20),
	`tpsAvg` varchar(20),
	`itlAvg` varchar(20),
	`qps` varchar(20),
	`reportUrl` text,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `test_results_id` PRIMARY KEY(`id`)
);
