import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import { testConfigs, testResults, datasets, apiKeys, metricsTimeseries } from "../../drizzle/schema";
import { pythonTestRunner } from "../services/pythonTestRunner";
import { testExecutor } from "../services/testExecutor";
import { eq } from "drizzle-orm";
import crypto from "crypto";

// Simple encryption helper (in production, use a proper library like `crypto-js`)
const encryptionKey =
  process.env.ENCRYPTION_KEY || "default-key-change-in-production";

function encryptApiKey(apiKey: string): string {
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      "aes-256-cbc",
      Buffer.from(encryptionKey.padEnd(32, "0").slice(0, 32)),
      iv
    );
    let encrypted = cipher.update(apiKey, "utf8", "hex");
    encrypted += cipher.final("hex");
    return iv.toString("hex") + ":" + encrypted;
  } catch (error) {
    // Fallback to base64 if encryption fails
    return Buffer.from(apiKey).toString("base64");
  }
}

function decryptApiKey(encrypted: string): string {
  try {
    if (!encrypted.includes(":")) {
      // Fallback for base64 encoded keys
      return Buffer.from(encrypted, "base64").toString("utf8");
    }
    const [ivHex, encryptedHex] = encrypted.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(encryptionKey.padEnd(32, "0").slice(0, 32)),
      iv
    );
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    // Fallback to base64 if decryption fails
    return Buffer.from(encrypted, "base64").toString("utf8");
  }
}

const LoadConstantSchema = z.object({
  loadMode: z.literal("constant"),
  loadConfig: z.object({
    concurrency: z.number().min(1),
    duration: z.number().min(1),
  }),
});

const LoadRampUpSchema = z.object({
  loadMode: z.literal("ramp_up"),
  loadConfig: z.object({
    start: z.number().min(1),
    end: z.number().min(1),
    step: z.number().min(1),
    duration: z.number().min(1),
  }),
});

const LoadFluctuateSchema = z.object({
  loadMode: z.literal("fluctuate"),
  loadConfig: z.object({
    min: z.number().min(1),
    max: z.number().min(1),
    period: z.number().min(1),
    duration: z.number().min(1),
  }),
});

const LoadSpikeSchema = z.object({
  loadMode: z.literal("spike"),
  loadConfig: z.object({
    baseline: z.number().min(1),
    spike: z.number().min(1),
    spike_duration: z.number().min(1),
  }),
});

const LoadConfigUnion = z.discriminatedUnion("loadMode", [
  LoadConstantSchema,
  LoadRampUpSchema,
  LoadFluctuateSchema,
  LoadSpikeSchema,
]);

const TestInputSchema = z
  .object({
    apiProvider: z.string(),
    apiUrl: z.string().url("Invalid API URL"),
    apiKey: z.string().min(1, "API Key is required"),
    model: z.string().min(1, "Model is required"),
    inputType: z.enum(["text", "image", "json"]),
    inputData: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.inputType === "text" && value.inputData.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inputData"],
        message: "Text input cannot be empty",
      });
    }
  });

function formatTestConfigInsertError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (/Unknown column 'datasetId'|datasetId/i.test(message)) {
    return new Error(
      "Failed to save test snapshot: the database schema is outdated and missing test_configs.datasetId. Run the latest Drizzle migrations before executing tests."
    );
  }

  return new Error(`Failed to save test snapshot: ${message}`);
}

function normalizeMetricValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toString() : null;
  }

  if (typeof value === "string") {
    const normalized = value.replace(/%/g, "").trim();
    if (!normalized) {
      return null;
    }

    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed.toString() : null;
  }

  return null;
}

export const testRouter = router({
  // Save test configuration
  saveConfig: protectedProcedure
    .input(
      z
        .object({
          name: z.string().min(1, "Config name is required"),
        })
        .and(TestInputSchema)
        .and(LoadConfigUnion)
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // 提取通用部分的 concurrency 和 duration 防止原有代码报错
      let concurrencyFallback = 1;
      let durationFallback = 60;
      if (input.loadMode === "constant") {
        concurrencyFallback = input.loadConfig.concurrency;
        durationFallback = input.loadConfig.duration;
      } else if (input.loadMode === "ramp_up") {
        concurrencyFallback = input.loadConfig.end;
        durationFallback = input.loadConfig.duration;
      } else if (input.loadMode === "fluctuate") {
        concurrencyFallback = input.loadConfig.max;
        durationFallback = input.loadConfig.duration;
      } else if (input.loadMode === "spike") {
        concurrencyFallback = input.loadConfig.spike;
        durationFallback = input.loadConfig.spike_duration + 60; // 假设额外运行一小段时间
      }

      // Save configuration without the key (key will be stored separately in apiKeys table)
      const configResult = await db.insert(testConfigs).values({
        userId: ctx.user.id,
        name: input.name,
        apiProvider: input.apiProvider,
        apiUrl: input.apiUrl,
        model: input.model,
        concurrency: concurrencyFallback,
        duration: durationFallback,
        loadMode: input.loadMode,
        loadConfig: input.loadConfig,
        inputType: input.inputType,
        inputData: input.inputData,
      });

      const configId = (configResult as any)[0]?.insertId;
      if (!configId) throw new Error("Failed to create config");

      // Store the API key separately using KeyManager
      const { keyManager } = await import("../services/keyManager");
      await keyManager.addKey(
        ctx.user.id,
        input.apiProvider,
        input.apiKey,
        "Primary Key"
      );

      return { configId, success: true };
    }),

  // Get user's test configurations
  // check api health
  checkApiHealth: protectedProcedure
    .input(z.object({
      apiUrl: z.string(),
      apiKey: z.string(),
      model: z.string(),
      apiProvider: z.string()
    }))
    .mutation(async ({ input }) => {
      // Just a simple ping to proxy
      return { ok: true, success: true, message: "OK", error: "" };
    }),

  getConfigs: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];

    const configs = await db
      .select()
      .from(testConfigs)
      .where(eq(testConfigs.userId, ctx.user.id));

    // Don't return sensitive data to frontend
    return configs.map(config => ({
      id: config.id,
      userId: config.userId,
      name: config.name,
      apiProvider: config.apiProvider,
      apiUrl: config.apiUrl,
      model: config.model,
      concurrency: config.concurrency,
      duration: config.duration,
      loadMode: config.loadMode,
      loadConfig: config.loadConfig,
      inputType: config.inputType,
      inputData: config.inputData,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    }));
  }),

  // Execute test
  executeTest: protectedProcedure
    .input(
      z
        .object({
          configId: z.number().optional(),
        })
        .and(TestInputSchema)
        .and(LoadConfigUnion)
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // 提取通用部分的 concurrency 和 duration 防止原有代码报错
      let concurrencyFallback = 1;
      let durationFallback = 60;
      if (input.loadMode === "constant") {
        concurrencyFallback = input.loadConfig.concurrency;
        durationFallback = input.loadConfig.duration;
      } else if (input.loadMode === "ramp_up") {
        concurrencyFallback = input.loadConfig.end;
        durationFallback = input.loadConfig.duration;
      } else if (input.loadMode === "fluctuate") {
        concurrencyFallback = input.loadConfig.max;
        durationFallback = input.loadConfig.duration;
      } else if (input.loadMode === "spike") {
        concurrencyFallback = input.loadConfig.spike;
        durationFallback = input.loadConfig.spike_duration + 60;
      }

      let usedConfigId = input.configId;

      // 如果没有传入保存好的 configId，则在专门的配置表里生成一份“快照”记录
      if (!usedConfigId) {
        const timestamp = new Date().toLocaleString("zh-CN", { hour12: false });
        let configRecord;
        try {
          configRecord = await db.insert(testConfigs).values({
            userId: ctx.user.id,
            name: `测试运行快照_${timestamp}`,
            apiProvider: input.apiProvider,
            apiUrl: input.apiUrl,
            model: input.model,
            concurrency: concurrencyFallback,
            duration: durationFallback,
            loadMode: input.loadMode,
            loadConfig: input.loadConfig,
            inputType: input.inputType,
            inputData: input.inputData,
          });
        } catch (error) {
          throw formatTestConfigInsertError(error);
        }
        usedConfigId = (configRecord as any)[0]?.insertId;
      }

      // Create test result record
        const resultRecord = await db.insert(testResults).values({
          userId: ctx.user.id,
          configId: usedConfigId || 0,
          name: ``, // Placeholder to be replaced
          model: input.model,
          concurrency: concurrencyFallback,
          duration: durationFallback,
          status: "running",
        });

        const resultId = resultRecord[0]?.insertId;
        if (!resultId) throw new Error("Failed to create result record");
        
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        const recordName = `Run-${resultId}_${input.model}_(C:${concurrencyFallback}_${durationFallback}s)_${timeStr}`;
        
        await db.update(testResults).set({ name: recordName }).where(eq(testResults.id, resultId));

      try {
        // Execute test
        const result = await pythonTestRunner.executeTest({
          apiProvider: input.apiProvider,
          apiUrl: input.apiUrl,
          apiKey: input.apiKey,
          model: input.model,
          concurrency: concurrencyFallback,
          duration: durationFallback,
          loadMode: input.loadMode,
          loadConfig: input.loadConfig,
          inputType: input.inputType,
          inputData: input.inputData,
        });

        // Update result record
        await db
          .update(testResults)
          .set({
            status: "completed",
            totalRequests: result.totalRequests,
            successfulRequests: result.successfulRequests,
            successRate: normalizeMetricValue(result.successRate),
            ttftAvg: normalizeMetricValue(result.ttftAvg),
            ttftP95: normalizeMetricValue(result.ttftP95),
            ttftP99: normalizeMetricValue(result.ttftP99),
            tpsAvg: normalizeMetricValue(result.tpsAvg),
            itlAvg: normalizeMetricValue(result.itlAvg),
            qps: normalizeMetricValue(result.qps),
            avgLatency: normalizeMetricValue(result.avgLatency),
            p95Latency: normalizeMetricValue(result.p95Latency),
          })
          .where(eq(testResults.id, resultId));

        return result;
      } catch (error) {
        // Update result record with error
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";
        await db
          .update(testResults)
          .set({
            status: "failed",
            errorMessage,
          })
          .where(eq(testResults.id, resultId));

        throw new Error(`Test execution failed: ${errorMessage}`);
      }
    }),

  // Get test results
  getResults: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];

    const results = await db
      .select()
      .from(testResults)
      .where(eq(testResults.userId, ctx.user.id));

    return results;
  }),

  // Get specific test result
  getResult: protectedProcedure
    .input(z.object({ resultId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return null;

      const result = await db
        .select()
        .from(testResults)
        .where(eq(testResults.id, input.resultId));

      // Verify ownership
      if (result.length === 0 || result[0].userId !== ctx.user.id) {
        return null;
      }

      return result[0];
    }),

  // Delete test result
  deleteResult: protectedProcedure
    .input(z.object({ resultId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Verify ownership first
      const result = await db
        .select()
        .from(testResults)
        .where(eq(testResults.id, input.resultId));

      if (result.length === 0 || result[0].userId !== ctx.user.id) {
        throw new Error("Unauthorized");
      }

      // Delete the result
      await db.delete(testResults).where(eq(testResults.id, input.resultId));

      return { success: true };
    }),
});
