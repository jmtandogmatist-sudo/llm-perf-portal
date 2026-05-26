import { pythonTestRunner, TestConfig, TestResult } from './pythonTestRunner';
import { getDb } from '../db';
import { testResults } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';

export interface JobState {
  resultId: number;
  config: TestConfig;
  status: 'pending' | 'running' | 'completed' | 'failed';
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
        .where(eq(testResults.id, job.resultId));

      job.status = 'completed';
      job.progress = 100;
      job.result = result;
      job.logs.push(`[${new Date().toLocaleTimeString()}] ✅ Job completed successfully.`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.handleJobError(job, errorMsg);
    } finally {
      // Move to completed buffer and remove from active map
      this.completedJobs.set(job.resultId, { ...job, startTime: job.startTime });
      this.activeJobs.delete(job.resultId);
      
      // Trigger next job in queue
      this.processNext();
    }
  }

  /**
   * Handle job execution failure
   */
  private async handleJobError(job: JobState, errorMsg: string): Promise<void> {
    const db = await getDb();
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
}

export const taskQueueManager = new TaskQueueManager();
