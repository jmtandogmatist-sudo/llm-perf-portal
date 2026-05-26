ALTER TABLE `test_configs` ADD `loadConfig` json;--> statement-breakpoint
ALTER TABLE `test_results` ADD `name` varchar(255);--> statement-breakpoint
ALTER TABLE `test_results` ADD `model` varchar(255);--> statement-breakpoint
ALTER TABLE `test_results` ADD `concurrency` int;--> statement-breakpoint
ALTER TABLE `test_results` ADD `duration` int;--> statement-breakpoint
ALTER TABLE `test_results` ADD `avgLatency` varchar(20);--> statement-breakpoint
ALTER TABLE `test_results` ADD `p95Latency` varchar(20);