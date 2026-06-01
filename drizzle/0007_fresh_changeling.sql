ALTER TABLE `test_configs` MODIFY COLUMN `apiProvider` varchar(64);--> statement-breakpoint
ALTER TABLE `test_configs` MODIFY COLUMN `apiUrl` text;--> statement-breakpoint
ALTER TABLE `test_configs` MODIFY COLUMN `model` varchar(255);--> statement-breakpoint
ALTER TABLE `test_configs` MODIFY COLUMN `inputType` varchar(64);--> statement-breakpoint
ALTER TABLE `test_configs` ADD `testType` varchar(32) DEFAULT 'LLM' NOT NULL;--> statement-breakpoint
ALTER TABLE `test_configs` ADD `protocolConfig` json;--> statement-breakpoint
ALTER TABLE `test_results` ADD `testType` varchar(32) DEFAULT 'LLM' NOT NULL;--> statement-breakpoint
ALTER TABLE `test_results` ADD `protocolMetrics` json;