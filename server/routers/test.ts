import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import { testConfigs, testResults, datasets, apiKeys, metricsTimeseries, environments } from "../../drizzle/schema";
import { pythonTestRunner } from "../services/pythonTestRunner";
import { testExecutor } from "../services/testExecutor";
import { taskQueueManager } from "../services/taskQueue";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

// Simple encryption helper (in production, use a proper library like `crypto-js`)
const encryptionKey =
  process.env.ENCRYPTION_KEY || "default-key-change-in-production";

function encryptApiKey(apiKey: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(encryptionKey.padEnd(32, "0").slice(0, 32)),
    iv
  );
  let encrypted = cipher.update(apiKey, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decryptApiKey(encrypted: string): string {
  if (!encrypted.includes(":")) {
    // Fallback for legacy base64 encoded keys
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

const BaseUnifiedSchema = z.object({
  environmentId: z.number().optional(),
  configId: z.number().optional(),
  
  testType: z.enum(["LLM", "REST_API"]).default("LLM"),
  loadMode: z.enum(["constant", "ramp_up", "fluctuate", "spike"]),
  loadConfig: z.record(z.string(), z.any()),
  
  // LLM-specific fields (validated conditionally in superRefine)
  apiProvider: z.string().optional(),
  apiUrl: z.string().url("Invalid API URL").optional(),
  apiKey: z.string().optional().transform(val => {
    if (!val) return val;
    const trimmed = val.trim();
    return trimmed.startsWith("Bearer ") ? trimmed.slice(7).trim() : trimmed;
  }),
  model: z.string().optional(),
  inputType: z.enum(["text", "image", "json", "video"]).optional(),
  inputData: z.string().optional(),
  
  // REST API-specific fields (validated conditionally in superRefine)
  protocolConfig: z.object({
    url: z.string().url("Invalid API URL"),
    method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET"),
    headers: z.record(z.string(), z.string()).optional(),
    queryParams: z.record(z.string(), z.string()).optional(),
    bodyType: z.enum(["json", "raw"]).default("json"),
    bodyContent: z.string().optional(),
    expectedStatus: z.number().default(200),
  }).optional(),
});

const validateUnified = (val: any, ctx: any) => {
  // 1. Validate based on testType
  if (val.testType === "LLM") {
    if (!val.apiProvider) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["apiProvider"], message: "API Provider is required" });
    }
    if (!val.apiUrl) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["apiUrl"], message: "API URL is required" });
    }
    if (!val.apiKey) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["apiKey"], message: "API Key is required" });
    }
    if (!val.model) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message: "Model is required" });
    }
    if (!val.inputType) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inputType"], message: "Input Type is required" });
    }
    if (val.inputType === "text" && (!val.inputData || val.inputData.trim().length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inputData"], message: "Text input cannot be empty" });
    }
  } else if (val.testType === "REST_API") {
    if (!val.protocolConfig) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["protocolConfig"], message: "Protocol Configuration is required" });
    }
  }

  // 2. Validate loadConfig based on loadMode
  if (val.loadMode === "constant") {
    if (!val.loadConfig || typeof val.loadConfig.concurrency !== "number" || val.loadConfig.concurrency < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["loadConfig", "concurrency"], message: "concurrency must be >= 1" });
    }
    if (!val.loadConfig || typeof val.loadConfig.duration !== "number" || val.loadConfig.duration < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["loadConfig", "duration"], message: "duration must be >= 1" });
    }
  } else if (val.loadMode === "ramp_up") {
    if (!val.loadConfig || typeof val.loadConfig.start !== "number" || val.loadConfig.start < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["loadConfig", "start"], message: "start must be >= 1" });
    }
    if (!val.loadConfig || typeof val.loadConfig.end !== "number" || val.loadConfig.end < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["loadConfig", "end"], message: "end must be >= 1" });
    }
    if (!val.loadConfig || typeof val.loadConfig.step !== "number" || val.loadConfig.step < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["loadConfig", "step"], message: "step must be >= 1" });
    }
    if (!val.loadConfig || typeof val.loadConfig.duration !== "number" || val.loadConfig.duration < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["loadConfig", "duration"], message: "duration must be >= 1" });
    }
  } else if (val.loadMode === "fluctuate") {
    if (!val.loadConfig || typeof val.loadConfig.min !== "number" || val.loadConfig.min < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["loadConfig", "min"], message: "min must be >= 1" });
    }
    if (!val.loadConfig || typeof val.loadConfig.max !== "number" || val.loadConfig.max < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["loadConfig", "max"], message: "max must be >= 1" });
    }
    if (!val.loadConfig || typeof val.loadConfig.period !== "number" || val.loadConfig.period < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["loadConfig", "period"], message: "period must be >= 1" });
    }
    if (!val.loadConfig || typeof val.loadConfig.duration !== "number" || val.loadConfig.duration < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["loadConfig", "duration"], message: "duration must be >= 1" });
    }
  } else if (val.loadMode === "spike") {
    if (!val.loadConfig || typeof val.loadConfig.baseline !== "number" || val.loadConfig.baseline < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["loadConfig", "baseline"], message: "baseline must be >= 1" });
    }
    if (!val.loadConfig || typeof val.loadConfig.spike !== "number" || val.loadConfig.spike < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["loadConfig", "spike"], message: "spike must be >= 1" });
    }
    if (!val.loadConfig || typeof val.loadConfig.spike_duration !== "number" || val.loadConfig.spike_duration < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["loadConfig", "spike_duration"], message: "spike_duration must be >= 1" });
    }
  }
};

const UnifiedSaveConfigSchema = BaseUnifiedSchema.extend({
  name: z.string().min(1, "Config name is required"),
}).superRefine(validateUnified);

const UnifiedExecuteTestSchema = BaseUnifiedSchema.superRefine(validateUnified);

const UPLOADS_DIR = "/tmp/llm-perf-tests/uploads";
try {
  mkdirSync(UPLOADS_DIR, { recursive: true });
} catch (e) {
  // Ignore
}

function saveBase64ToFile(base64Str: string): string {
  if (!base64Str || typeof base64Str !== "string" || !base64Str.startsWith("data:")) {
    return base64Str;
  }

  try {
    const matches = base64Str.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.*)$/);
    if (!matches || matches.length !== 3) {
      return base64Str;
    }

    const mimeType = matches[1];
    const base64Data = matches[2];
    
    // Determine extension
    let ext = "bin";
    if (mimeType.includes("image/png")) ext = "png";
    else if (mimeType.includes("image/jpeg") || mimeType.includes("image/jpg")) ext = "jpg";
    else if (mimeType.includes("image/gif")) ext = "gif";
    else if (mimeType.includes("image/webp")) ext = "webp";
    else if (mimeType.includes("video/mp4")) ext = "mp4";
    else if (mimeType.includes("video/webm")) ext = "webm";
    else if (mimeType.includes("video/ogg")) ext = "ogg";
    
    const filename = `upload_${crypto.randomUUID()}.${ext}`;
    const filePath = join(UPLOADS_DIR, filename);
    
    writeFileSync(filePath, Buffer.from(base64Data, "base64"));
    return `/uploads/${filename}`;
  } catch (error) {
    console.error("Failed to save base64 to file:", error);
    return base64Str;
  }
}

function formatTestConfigInsertError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);

  // Always log the real error so we can diagnose issues
  console.error("[formatTestConfigInsertError] Original DB error:", message);
  if (error instanceof Error && error.stack) {
    console.error("[formatTestConfigInsertError] Stack:", error.stack);
  }

  // Only match the specific MySQL "Unknown column" error — not any error mentioning the column name
  if (/Unknown column ['`]datasetId['`]/i.test(message)) {
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
    .input(UnifiedSaveConfigSchema)
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

      const testType = ("testType" in input) ? input.testType : "LLM";

      let insertValues: any = {
        userId: ctx.user.id,
        name: input.name,
        testType: testType,
        concurrency: concurrencyFallback,
        duration: durationFallback,
        loadMode: input.loadMode,
        loadConfig: input.loadConfig,
        environmentId: input.environmentId || null,
      };

      if (testType === "REST_API") {
        const restInput = input as any;
        insertValues.protocolConfig = restInput.protocolConfig;
      } else {
        const llmInput = input as any;
        insertValues.apiProvider = llmInput.apiProvider;
        insertValues.apiUrl = llmInput.apiUrl;
        insertValues.model = llmInput.model;
        insertValues.inputType = llmInput.inputType;
        const processedInput = saveBase64ToFile(llmInput.inputData || "");
        insertValues.inputData = processedInput;
        insertValues.protocolConfig = {
          url: llmInput.apiUrl,
          model: llmInput.model,
          provider: llmInput.apiProvider,
          input_type: llmInput.inputType,
          input_data: processedInput,
        };
      }

      // Save configuration without the key (key will be stored separately in apiKeys table)
      const configResult = await db.insert(testConfigs).values(insertValues);

      const configId = (configResult as any)[0]?.insertId;
      if (!configId) throw new Error("Failed to create config");

      // Store the API key separately using KeyManager (LLM only)
      if (testType === "LLM") {
        const llmInput = input as any;
        const { keyManager } = await import("../services/keyManager");
        await keyManager.addKey(
          ctx.user.id,
          llmInput.apiProvider,
          llmInput.apiKey,
          "Primary Key"
        );
      }

      return { configId, success: true };
    }),

  // Get user's test configurations
  // check api health
  checkApiHealth: protectedProcedure
    .input(z.object({
      apiUrl: z.string(),
      apiKey: z.string().transform(val => {
        const trimmed = val.trim();
        return trimmed.startsWith("Bearer ") ? trimmed.slice(7).trim() : trimmed;
      }),
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
      testType: config.testType,
      apiProvider: config.apiProvider,
      apiUrl: config.apiUrl,
      model: config.model,
      concurrency: config.concurrency,
      duration: config.duration,
      loadMode: config.loadMode,
      loadConfig: config.loadConfig,
      inputType: config.inputType,
      inputData: config.inputData,
      protocolConfig: config.protocolConfig,
      environmentId: config.environmentId,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    }));
  }),

  // Execute test
  executeTest: protectedProcedure
    .input(UnifiedExecuteTestSchema)
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

      const testType = ("testType" in input) ? input.testType : "LLM";
      let usedConfigId = input.configId;

      // 如果没有传入保存好的 configId，则在专门的配置表里生成一份“快照”记录
      if (!usedConfigId) {
        const timestamp = new Date().toLocaleString("zh-CN", { hour12: false });
        let insertValues: any = {
          userId: ctx.user.id,
          name: `测试运行快照_${timestamp}`,
          testType: testType,
          concurrency: concurrencyFallback,
          duration: durationFallback,
          loadMode: input.loadMode,
          loadConfig: input.loadConfig,
          environmentId: input.environmentId || null,
        };

        if (testType === "REST_API") {
          const restInput = input as any;
          insertValues.protocolConfig = restInput.protocolConfig;
        } else {
          const llmInput = input as any;
          insertValues.apiProvider = llmInput.apiProvider;
          insertValues.apiUrl = llmInput.apiUrl;
          insertValues.model = llmInput.model;
          insertValues.inputType = llmInput.inputType;
          const processedInput = saveBase64ToFile(llmInput.inputData || "");
          insertValues.inputData = processedInput;
          insertValues.protocolConfig = {
            url: llmInput.apiUrl,
            model: llmInput.model,
            provider: llmInput.apiProvider,
            input_type: llmInput.inputType,
            input_data: processedInput,
          };
        }

        let configRecord;
        try {
          configRecord = await db.insert(testConfigs).values(insertValues);
        } catch (error) {
          throw formatTestConfigInsertError(error);
        }
        usedConfigId = (configRecord as any)[0]?.insertId;
      }

      // Create test result record
      let modelName = testType === "REST_API" ? "REST_API" : (input as any).model || "LLM";

      const resultRecord = await db.insert(testResults).values({
        userId: ctx.user.id,
        configId: usedConfigId || 0,
        name: ``, // Placeholder to be replaced
        model: modelName,
        concurrency: concurrencyFallback,
        duration: durationFallback,
        status: "running",
        testType: testType,
        environmentId: input.environmentId || null,
      });

      const resultId = resultRecord[0]?.insertId;
      if (!resultId) throw new Error("Failed to create result record");
      
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      const recordName = `Run-${resultId}_${modelName}_(C:${concurrencyFallback}_${durationFallback}s)_${timeStr}`;
      
      await db.update(testResults).set({ name: recordName }).where(eq(testResults.id, resultId));

      // Construct runner configuration
      let runnerConfig: any = {
        testType: testType,
        concurrency: concurrencyFallback,
        duration: durationFallback,
        loadMode: input.loadMode,
        loadConfig: input.loadConfig,
        environmentId: input.environmentId,
      };

      if (testType === "REST_API") {
        const restInput = input as any;
        runnerConfig.protocolConfig = restInput.protocolConfig;
      } else {
        const llmInput = input as any;
        runnerConfig.apiProvider = llmInput.apiProvider;
        runnerConfig.apiUrl = llmInput.apiUrl;
        runnerConfig.apiKey = llmInput.apiKey;
        runnerConfig.model = llmInput.model;
        runnerConfig.inputType = llmInput.inputType;
        runnerConfig.inputData = llmInput.inputData;
      }

      // Enqueue the task asynchronously using the TaskQueueManager
      await taskQueueManager.enqueue(resultId, runnerConfig);

      return { resultId };
    }),

  // Poll status of a running test
  pollStatus: protectedProcedure
    .input(
      z.object({
        resultId: z.number(),
        fromLogIndex: z.number().default(0),
      })
    )
    .query(async ({ input }) => {
      return taskQueueManager.getJobStatus(input.resultId, input.fromLogIndex);
    }),

  // Abort running test
  abortTest: protectedProcedure
    .input(z.object({ resultId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Verify ownership
      const result = await db
        .select()
        .from(testResults)
        .where(eq(testResults.id, input.resultId));

      if (result.length === 0 || result[0].userId !== ctx.user.id) {
        throw new Error("Unauthorized");
      }

      if (result[0].status !== "running") {
        return { success: false, message: "Test is not running" };
      }

      const success = await taskQueueManager.abort(input.resultId);
      return { success };
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

      // Fetch associated config
      const configRecord = await db
        .select()
        .from(testConfigs)
        .where(eq(testConfigs.id, result[0].configId));

      // Fetch associated environment
      let environment = null;
      if (result[0].environmentId) {
        const envRecord = await db
          .select()
          .from(environments)
          .where(eq(environments.id, result[0].environmentId));
        environment = envRecord[0] || null;
      }

      return {
        ...result[0],
        config: configRecord[0] || null,
        environment,
      };
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

  // Analyze test results using LLM
  analyzeResults: protectedProcedure
    .input(
      z.object({
        compareIds: z.array(z.number()).min(1),
        apiProvider: z.enum(["builtin", "custom"]),
        builtinModel: z.string().optional(),
        customConfig: z
          .object({
            apiUrl: z.string(),
            apiKey: z.string().transform(val => {
              const trimmed = val.trim();
              return trimmed.startsWith("Bearer ") ? trimmed.slice(7).trim() : trimmed;
            }),
            model: z.string(),
          })
          .optional(),
        prompt: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // 1. Query selected test results
      const results = await db
        .select()
        .from(testResults)
        .where(eq(testResults.userId, ctx.user.id));

      const selectedResults = results.filter((r) =>
        input.compareIds.includes(r.id)
      );

      if (selectedResults.length === 0) {
        throw new Error("未找到选中的测试记录");
      }

      // 2. Build structured context data
      const contextData = selectedResults.map((r) => {
        const isRest = r.testType === "REST_API";
        const protocolMetrics = r.protocolMetrics as { statusCodes?: Record<string, number>; avgResponseSize?: number } | null;
        return {
          runId: `Run-${r.id}`,
          testType: r.testType,
          name: r.name,
          model: r.model,
          concurrency: r.concurrency,
          duration: r.duration,
          totalRequests: r.totalRequests,
          successfulRequests: r.successfulRequests,
          successRate: r.successRate,
          ttftAvg: !isRest && r.ttftAvg ? `${r.ttftAvg} ms` : undefined,
          ttftP95: !isRest && r.ttftP95 ? `${r.ttftP95} ms` : undefined,
          ttftP99: !isRest && r.ttftP99 ? `${r.ttftP99} ms` : undefined,
          tpsAvg: !isRest && r.tpsAvg ? `${r.tpsAvg} tok/s` : undefined,
          itlAvg: !isRest && r.itlAvg ? `${r.itlAvg} ms` : undefined,
          qps: r.qps ? `${r.qps} req/s` : "N/A",
          avgLatency: r.avgLatency ? `${r.avgLatency} ms` : "N/A",
          p95Latency: r.p95Latency ? `${r.p95Latency} ms` : "N/A",
          avgResponseSize: isRest && protocolMetrics?.avgResponseSize 
            ? (protocolMetrics.avgResponseSize > 1024 
              ? `${(protocolMetrics.avgResponseSize / 1024).toFixed(2)} KB` 
              : `${protocolMetrics.avgResponseSize} Bytes`)
            : undefined,
          statusCodes: isRest && protocolMetrics?.statusCodes ? protocolMetrics.statusCodes : undefined,
          testTime: r.createdAt
            ? new Date(r.createdAt).toLocaleString("zh-CN", { hour12: false })
            : "N/A",
        };
      });

      const dataStr = JSON.stringify(contextData, null, 2);
      const finalPrompt = input.prompt.replace("{data}", dataStr);

      // 3. Call LLM
      let llmResponseText: string;

      if (input.apiProvider === "builtin") {
        if (input.builtinModel === "qwen3.7-max") {
          // Use the built-in Qwen 3.7 Max model
          const apiUrl = "http://10.111.32.151:3001/v1/chat/completions";
          const apiKey = "SDwcmPUt1bcRnCuUA05e51Ec3dC24e2b8bA14e5080Aa5284";
          const model = "qwen3.7-max";

          const payload = {
            model,
            messages: [
              {
                role: "system",
                content:
                  "你是一位硅谷顶尖的大模型性能调优与架构专家。请严格按照用户要求的 JSON 格式输出分析结果。",
              },
              { role: "user", content: finalPrompt },
            ],
            max_tokens: 8192,
            temperature: 0.3,
          };

          const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
              `内置 Qwen 3.6 Plus API 调用失败: ${response.status} ${response.statusText} – ${errorText}`
            );
          }

          const result = (await response.json()) as any;
          llmResponseText =
            result.choices?.[0]?.message?.content || "模型未返回内容";
        } else {
          // Use the default built-in invokeLLM (Gemini)
          const { invokeLLM } = await import("../_core/llm");
          const llmResult = await invokeLLM({
            messages: [
              {
                role: "system",
                content:
                  "你是一位硅谷顶尖的大模型性能调优与架构专家。请严格按照用户要求的 JSON 格式输出分析结果。",
              },
              { role: "user", content: finalPrompt },
            ],
            maxTokens: 8192,
          });
          // Extract text content from the first choice
          const choice = llmResult.choices?.[0];
          if (!choice) {
            throw new Error("大模型未返回任何内容");
          }
          const content = choice.message?.content;
          if (typeof content === "string") {
            llmResponseText = content;
          } else if (Array.isArray(content)) {
            llmResponseText = content
              .filter((p) => p.type === "text")
              .map((p) => (p as { type: "text"; text: string }).text)
              .join("\n");
          } else {
            llmResponseText = String(content || "");
          }
        }
      } else {
        // Custom API (OpenAI-compatible)
        if (!input.customConfig) {
          throw new Error("自定义 API 配置不能为空");
        }
        const { apiUrl, apiKey, model } = input.customConfig;
        const payload = {
          model,
          messages: [
            {
              role: "system",
              content:
                "你是一位硅谷顶尖的大模型性能调优与架构专家。请严格按照用户要求的 JSON 格式输出分析结果。",
            },
            { role: "user", content: finalPrompt },
          ],
          max_tokens: 8192,
          temperature: 0.3,
        };

        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `自定义 API 调用失败: ${response.status} ${response.statusText} – ${errorText}`
          );
        }

        const result = (await response.json()) as any;
        llmResponseText =
          result.choices?.[0]?.message?.content || "模型未返回内容";
      }

      // 4. Parse JSON from response (robust extraction)
      let analysisResult: Record<string, string>;
      try {
        // Try to extract JSON block from markdown code fences
        const jsonMatch = llmResponseText.match(
          /```(?:json)?\s*([\s\S]*?)```/
        );
        const jsonStr = jsonMatch ? jsonMatch[1].trim() : llmResponseText.trim();
        analysisResult = JSON.parse(jsonStr);
      } catch {
        // Fallback: try raw parse
        try {
          // Attempt to find the first { ... } block
          const braceStart = llmResponseText.indexOf("{");
          const braceEnd = llmResponseText.lastIndexOf("}");
          if (braceStart !== -1 && braceEnd > braceStart) {
            analysisResult = JSON.parse(
              llmResponseText.slice(braceStart, braceEnd + 1)
            );
          } else {
            // Ultimate fallback
            analysisResult = { global: llmResponseText };
          }
        } catch {
          analysisResult = { global: llmResponseText };
        }
      }

      return { analysis: analysisResult };
    }),

  // Get metrics timeseries for a result
  getMetricsTimeseries: protectedProcedure
    .input(z.object({ resultId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];

      // Verify ownership
      const result = await db
        .select()
        .from(testResults)
        .where(eq(testResults.id, input.resultId));

      if (result.length === 0 || result[0].userId !== ctx.user.id) {
        throw new Error("Unauthorized");
      }

      return db
        .select()
        .from(metricsTimeseries)
        .where(eq(metricsTimeseries.resultId, input.resultId))
        .orderBy(metricsTimeseries.timestamp);
    }),
});
