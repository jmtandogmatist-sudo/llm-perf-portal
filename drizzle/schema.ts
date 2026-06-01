import { int, json, mysqlEnum, mysqlTable, text, mediumtext, timestamp, varchar, double, boolean, decimal } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const environments = mysqlTable("environments", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  gpuModel: varchar("gpuModel", { length: 128 }),
  gpuCount: int("gpuCount"),
  inferenceEngine: varchar("inferenceEngine", { length: 128 }),
  engineVersion: varchar("engineVersion", { length: 128 }),
  quantization: varchar("quantization", { length: 64 }),
  maxModelLen: int("maxModelLen"),
  gpuMemoryUtilization: decimal("gpuMemoryUtilization", { precision: 4, scale: 2 }),
  prometheusUrl: text("prometheusUrl"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Environment = typeof environments.$inferSelect;
export type InsertEnvironment = typeof environments.$inferInsert;

export const testConfigs = mysqlTable("test_configs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  testType: varchar("testType", { length: 32 }).default("LLM").notNull(),
  apiProvider: varchar("apiProvider", { length: 64 }),
  apiUrl: text("apiUrl"),
  model: varchar("model", { length: 255 }),
  concurrency: int("concurrency").notNull(),
  duration: int("duration").notNull(),
  loadMode: varchar("loadMode", { length: 64 }).notNull(),
  loadConfig: json("loadConfig"),
  inputType: varchar("inputType", { length: 64 }),
  inputData: mediumtext("inputData"),
  protocolConfig: json("protocolConfig"),
  datasetId: int("datasetId"), // 新增 dataset 关联
  environmentId: int("environmentId"), // 新增被测环境关联
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TestConfig = typeof testConfigs.$inferSelect;
export type InsertTestConfig = typeof testConfigs.$inferInsert;

export const datasets = mysqlTable("datasets", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  payloadUrl: varchar("payloadUrl", { length: 1024 }),
  rawPayload: json("rawPayload"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Dataset = typeof datasets.$inferSelect;
export type InsertDataset = typeof datasets.$inferInsert;

export const apiKeys = mysqlTable("api_keys", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  apiProvider: varchar("apiProvider", { length: 64 }).notNull(),
  keyEncrypted: text("keyEncrypted").notNull(),
  keyName: varchar("keyName", { length: 255 }), 
  isActive: boolean("isActive").default(true).notNull(),
  usageCount: int("usageCount").default(0).notNull(),
  lastUsedAt: timestamp("lastUsedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  deletedAt: timestamp("deletedAt"),
});

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;

export const testResults = mysqlTable("test_results", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  configId: int("configId").notNull(),
  name: varchar("name", { length: 255 }),
  testType: varchar("testType", { length: 32 }).default("LLM").notNull(),
  model: varchar("model", { length: 255 }),
  concurrency: int("concurrency"),
  duration: int("duration"),
  status: mysqlEnum("status", ["running", "completed", "failed", "aborted"]).notNull(),
  
  totalRequests: int("totalRequests"),
  successfulRequests: int("successfulRequests"),
  
  successRate: decimal("successRate", { precision: 5, scale: 2 }),
  ttftAvg: decimal("ttftAvg", { precision: 10, scale: 2 }),
  ttftP95: decimal("ttftP95", { precision: 10, scale: 2 }),
  ttftP99: decimal("ttftP99", { precision: 10, scale: 2 }),
  tpsAvg: decimal("tpsAvg", { precision: 10, scale: 2 }),
  itlAvg: decimal("itlAvg", { precision: 10, scale: 2 }),
  qps: decimal("qps", { precision: 10, scale: 2 }),
  avgLatency: decimal("avgLatency", { precision: 10, scale: 2 }),
  p95Latency: decimal("p95Latency", { precision: 10, scale: 2 }),
  protocolMetrics: json("protocolMetrics"),
  
  reportUrl: text("reportUrl"),
  errorMessage: text("errorMessage"),
  keysUsed: int("keysUsed"), 
  environmentId: int("environmentId"), // 新增被测环境关联
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TestResult = typeof testResults.$inferSelect;
export type InsertTestResult = typeof testResults.$inferInsert;

export const metricsTimeseries = mysqlTable("metrics_timeseries", {
  id: int("id").autoincrement().primaryKey(),
  resultId: int("resultId").notNull(),
  virtualUserId: int("virtualUserId"),
  timestamp: timestamp("timestamp").notNull(),
  
  latency: double("latency"),
  ttft: double("ttft"),
  tps: double("tps"),
  
  isError: boolean("isError").default(false).notNull(),
  errorCode: varchar("errorCode", { length: 128 }),
  gpuUtilization: double("gpuUtilization"),
  vramUsage: double("vramUsage"),
  kvCacheUsage: double("kvCacheUsage"),
});

export type MetricsTimeserie = typeof metricsTimeseries.$inferSelect;
export type InsertMetricsTimeserie = typeof metricsTimeseries.$inferInsert;

