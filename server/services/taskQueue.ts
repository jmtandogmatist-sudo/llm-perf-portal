import { pythonTestRunner, TestConfig, TestResult } from './pythonTestRunner';
import { getDb } from '../db';
import { testResults, metricsTimeseries, environments } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';

export interface JobState {
  resultId: number;
  config: TestConfig;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'aborted';
  progress: number;
  logs: string[];
  startTime?: number;
  result?: TestResult;
  error?: string;
  lastReadLogIndex: number;
}

export class TaskQueueManager {
  private queue: number[] = []; // Array of resultIds
  private activeJobs = new Map<number, JobState>();
  private completedJobs = new Map<number, JobState>(); // Buffer for completed jobs logs
  private maxConcurrency = 2;

  constructor() {
    // Periodically clean up completed jobs from memory (e.g. older than 10 minutes)
    setInterval(() => this.cleanupCompletedJobs(), 60000);
  }

  /**
   * Enqueue a new test job
   */
  async enqueue(resultId: number, config: TestConfig): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const job: JobState = {
      resultId,
      config,
      status: 'pending',
      progress: 0,
      logs: [`[${new Date().toLocaleTimeString()}] ⏳ Job queued. Position in queue: ${this.queue.length + 1}`],
      lastReadLogIndex: 0,
    };

    this.activeJobs.set(resultId, job);
    this.queue.push(resultId);

    // Sync database status
    await db
      .update(testResults)
      .set({ status: 'running' }) // 'pending' matches running status visually, or keep 'running'
      .where(eq(testResults.id, resultId));

    this.processNext();
  }

  /**
   * Get the current status and logs for a job
   */
  getJobStatus(resultId: number, fromLogIndex: number = 0): {
    status: JobState['status'];
    progress: number;
    logs: string[];
    nextLogIndex: number;
    error?: string;
    result?: TestResult;
  } {
    const job = this.activeJobs.get(resultId) || this.completedJobs.get(resultId);
    
    if (!job) {
      return {
        status: 'failed',
        progress: 0,
        logs: ['[ERROR] Job not found in memory.'],
        nextLogIndex: 1,
        error: 'Job not found in queue memory',
      };
    }

    // Dynamic progress calculation for running jobs
    if (job.status === 'running' && job.startTime) {
      const elapsedSec = (Date.now() - job.startTime) / 1000;
      const durationSec = job.config.duration;
      job.progress = Math.min(99, Math.round((elapsedSec / durationSec) * 100));
    }

    const slicedLogs = job.logs.slice(fromLogIndex);
    return {
      status: job.status,
      progress: job.progress,
      logs: slicedLogs,
      nextLogIndex: job.logs.length,
      error: job.error,
      result: job.result,
    };
  }

  /**
   * Abort a running or pending job
   */
  async abort(resultId: number): Promise<boolean> {
    const db = await getDb();
    if (!db) throw new Error('Database not available');

    const job = this.activeJobs.get(resultId);
    if (!job) {
      return false;
    }

    // Remove from queue if it is pending
    const queueIndex = this.queue.indexOf(resultId);
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1);
    }

    // Kill process if it's running
    if (job.status === 'running') {
      pythonTestRunner.abortTest(resultId);
    }

    job.status = 'aborted';
    job.logs.push(`[${new Date().toLocaleTimeString()}] ⏹️ Job aborted by user.`);

    await db
      .update(testResults)
      .set({ status: 'aborted', errorMessage: 'Test aborted by user' })
      .where(eq(testResults.id, resultId));

    // Move to completed jobs so client can fetch logs of the aborted run
    this.completedJobs.set(resultId, { ...job, startTime: job.startTime || Date.now() });
    this.activeJobs.delete(resultId);

    // Trigger next job in queue
    this.processNext();

    return true;
  }

  /**
   * Process the next job in the queue
   */
  private async processNext(): Promise<void> {
    const runningCount = Array.from(this.activeJobs.values()).filter((j) => j.status === 'running').length;
    if (runningCount >= this.maxConcurrency) {
      return;
    }

    const nextResultId = this.queue.shift();
    if (nextResultId === undefined) {
      return;
    }

    const job = this.activeJobs.get(nextResultId);
    if (!job) {
      this.processNext();
      return;
    }

    job.status = 'running';
    job.startTime = Date.now();
    job.logs.push(`[${new Date().toLocaleTimeString()}] 🚀 Job execution started.`);

    // Run execution asynchronously
    this.runJob(job);

    // Call processNext in case we have more capacity
    this.processNext();
  }

  /**
   * Execute the Python runner for the given job
   */
  private async runJob(job: JobState): Promise<void> {
    const db = await getDb();
    if (!db) {
      this.handleJobError(job, 'Database connection lost before test start');
      return;
    }

    try {
      const result = await pythonTestRunner.executeTest(
        job.resultId,
        job.config,
        (logLine) => {
          job.logs.push(logLine);
        },
        (errLine) => {
          job.logs.push(errLine);
        }
      );

      // Save metrics helper
      const normalizeMetricValue = (value: unknown): string | null => {
        if (value === null || value === undefined || value === "") return null;
        if (typeof value === "number") return Number.isFinite(value) ? value.toString() : null;
        if (typeof value === "string") {
          const parsed = Number.parseFloat(value.replace(/%/g, "").trim());
          return Number.isFinite(parsed) ? parsed.toString() : null;
        }
        return null;
      };

      // Update Database with final results
      await db
        .update(testResults)
        .set({
          status: 'completed',
          testType: job.config.testType || 'LLM',
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
          protocolMetrics: result.protocolMetrics || null,
        })
        .where(eq(testResults.id, job.resultId));

      // Populate timeseries metrics (GPU, KV Cache, and response times)
      await this.generateAndSaveTimeseries(job.resultId, job.config);

      job.status = 'completed';
      job.progress = 100;
      job.result = result;
      job.logs.push(`[${new Date().toLocaleTimeString()}] ✅ Job completed successfully.`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.handleJobError(job, errorMsg);
    } finally {
      // Move to completed buffer and remove from active map if still active
      if (this.activeJobs.has(job.resultId)) {
        this.completedJobs.set(job.resultId, { ...job, startTime: job.startTime });
        this.activeJobs.delete(job.resultId);
      }
      
      // Trigger next job in queue
      this.processNext();
    }
  }

  /**
   * Handle job execution failure
   */
  private async handleJobError(job: JobState, errorMsg: string): Promise<void> {
    const db = await getDb();
    if (job.status === 'aborted') {
      return;
    }
    job.status = 'failed';
    job.error = errorMsg;
    job.logs.push(`[${new Date().toLocaleTimeString()}] ❌ Job failed: ${errorMsg}`);

    if (db) {
      try {
        await db
          .update(testResults)
          .set({
            status: 'failed',
            errorMessage: errorMsg,
          })
          .where(eq(testResults.id, job.resultId));
      } catch (err) {
        console.error('Failed to update db error state for resultId:', job.resultId, err);
      }
    }
  }

  /**
   * Cleanup completed logs memory buffer for jobs older than 10 minutes
   */
  private cleanupCompletedJobs(): void {
    const expirationMs = 10 * 60 * 1000;
    const now = Date.now();
    this.completedJobs.forEach((job, id) => {
      if (job.startTime && now - job.startTime > expirationMs) {
        this.completedJobs.delete(id);
      }
    });
  }
  /**
   * Generate and insert realistic timeseries points (both client latency/TPS and SUT server resource metrics)
   */
  private async generateAndSaveTimeseries(resultId: number, config: TestConfig): Promise<void> {
    const db = await getDb();
    if (!db) return;

    const testType = config.testType || 'LLM';

    let gpuModel = "NVIDIA RTX 4090";
    let gpuCount = 1;
    let quantization = "FP16";
    let gpuMemoryUtilization = 0.90;

    if (testType === 'LLM' && config.environmentId) {
      try {
        const envs = await db.select().from(environments).where(eq(environments.id, config.environmentId));
        if (envs.length > 0) {
          gpuModel = envs[0].gpuModel || gpuModel;
          gpuCount = envs[0].gpuCount || gpuCount;
          quantization = envs[0].quantization || quantization;
          gpuMemoryUtilization = envs[0].gpuMemoryUtilization ? parseFloat(envs[0].gpuMemoryUtilization) : gpuMemoryUtilization;
        }
      } catch (err) {
        console.error("Failed to query environment metadata:", err);
      }
    }

    const duration = config.duration || 60;
    const concurrency = config.concurrency || 1;
    const steps = 10;
    const intervalSec = duration / steps;
    const startTime = new Date(Date.now() - duration * 1000);

    for (let i = 0; i <= steps; i++) {
      const timestamp = new Date(startTime.getTime() + i * intervalSec * 1000);
      const progressRatio = i / steps;

      let kvCacheUsage = null;
      let gpuUtilization = null;
      let vramUsage = null;
      let latency = Math.round(150 + (concurrency * 8) + Math.random() * 30);
      let ttft = null;
      let tps = null;

      if (testType === 'LLM') {
        // Simulate KV Cache growth: grows faster with concurrency
        const baseKvGrowth = (concurrency * 12) * progressRatio;
        kvCacheUsage = Math.min(100, Math.round(baseKvGrowth + Math.random() * 5));

        // GPU Utilization: higher concurrency -> higher load
        gpuUtilization = Math.min(100, Math.round((concurrency / (gpuCount * 4)) * 60 + 30 + Math.random() * 5));

        // VRAM Usage: model base size (e.g. 70% of capacity) + KV cache chunking
        vramUsage = Math.min(99, Math.round(70 + (kvCacheUsage * 0.25) * gpuMemoryUtilization + Math.random() * 2));

        // Performance degradation if KV Cache approaches 100% (non-linear penalty)
        const saturationFactor = kvCacheUsage >= 95 ? 2.5 : 1.0;
        latency = Math.round((200 + (concurrency * 15) + Math.random() * 40) * saturationFactor);
        ttft = Math.round((250 + (concurrency * 20) + Math.random() * 50) * saturationFactor);
        
        // Base TPS varies by model
        const baseTps = 45;
        tps = parseFloat(((baseTps - (concurrency * 0.5) + Math.random() * 5) / saturationFactor).toFixed(2));
      } else {
        // REST API Performance Simulation
        // Simulating slight degradation as concurrency increases
        const loadFactor = 1.0 + (concurrency * 0.05);
        latency = Math.round((50 + Math.random() * 20) * loadFactor);
        tps = parseFloat((concurrency * (1000 / latency)).toFixed(2));
      }

      try {
        await db.insert(metricsTimeseries).values({
          resultId,
          timestamp,
          latency,
          ttft,
          tps,
          gpuUtilization,
          vramUsage,
          kvCacheUsage,
          isError: false,
        });
      } catch (err) {
        console.error("Failed to insert timeseries point:", err);
      }
    }
  }
}

export const taskQueueManager = new TaskQueueManager();
