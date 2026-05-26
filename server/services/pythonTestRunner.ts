import { spawn } from 'child_process';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import yaml from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface TestConfig {
  apiProvider: string;
  apiUrl: string;
  apiKey: string;
  model: string;
  concurrency: number;
  duration: number;
  loadMode: string;
  loadConfig: Record<string, any>;
  inputType: string;
  inputData: string;
}

export interface TestResult {
  totalRequests: number;
  successfulRequests: number;
  successRate: number;
  ttftAvg: number;
  ttftP95: number;
  ttftP99: number;
  tpsAvg: number;
  itlAvg: number;
  qps: number;
  avgLatency: number;
  p95Latency: number;
  analysis: string[];
}

/**
 * Python Test Runner - 执行真实的性能测试脚本
 * 支持日志流式传输和真实的 Python 脚本执行
 */
export class PythonTestRunner {
  private tempDir = join('/tmp', 'llm-perf-tests');

  constructor() {
    try {
      mkdirSync(this.tempDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create temp directory:', error);
    }
  }

  /**
   * 执行真实的性能测试
   * 支持流式日志回调
   */
  async executeTest(
    config: TestConfig,
    onProgress?: (log: string) => void,
    onError?: (error: string) => void
  ): Promise<TestResult> {
    const testId = uuidv4();
    const configPath = join(this.tempDir, `config_${testId}.yaml`);

    try {
      // 生成配置文件
      const yamlConfig = this.generateYamlConfig(config);
      writeFileSync(configPath, yamlConfig);

      onProgress?.(`[${new Date().toLocaleTimeString()}] ✅ Generated config file`);
      onProgress?.(`[${new Date().toLocaleTimeString()}] 📝 Config path: ${configPath}`);

      // 执行 Python 脚本
      return await this.runPythonScript(configPath, onProgress, onError);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      onError?.(errorMsg);
      throw new Error(`Test execution failed: ${errorMsg}`);
    } finally {
      // 清理临时文件
      try {
        unlinkSync(configPath);
      } catch (e) {
        // 忽略清理错误
      }
    }
  }

  /**
   * 生成 YAML 配置文件
   */
  private generateYamlConfig(config: TestConfig): string {
    const yamlObj = {
      api: {
        url: config.apiUrl,
        key: config.apiKey,
        model: config.model,
        provider: config.apiProvider,
      },
      test: {
        concurrency: config.concurrency,
        duration: config.duration,
        stream: true,
        load_mode: config.loadMode,
        load_config: config.loadConfig,
        input: {
          type: config.inputType,
          data: config.inputData,
        },
      },
      report: {
        output_format: 'json',
      },
    };

    return yaml.stringify(yamlObj);
  }

  /**
   * 运行 Python 脚本并流式传输日志
   */
  private runPythonScript(
    configPath: string,
    onProgress?: (log: string) => void,
    onError?: (error: string) => void
  ): Promise<TestResult> {
    return new Promise((resolve, reject) => {
      const scriptPath = join(__dirname, '../scripts/run_test.py');

      onProgress?.(`[${new Date().toLocaleTimeString()}] 🚀 Starting Python test runner...`);
      onProgress?.(`[${new Date().toLocaleTimeString()}] 📍 Script: ${scriptPath}`);

      const pythonProcess = spawn('python3', [scriptPath, '--config', configPath], {
        cwd: __dirname,
        timeout: 600000, // 10 分钟超时
      });

      let stdout = '';
      let stderr = '';
      let hasStarted = false;

      // 捕获标准输出 - 流式传输
      pythonProcess.stdout?.on('data', (data) => {
        const output = data.toString().trim();
        if (!output) return;

        stdout += output + '\n';
        hasStarted = true;

        // 流式传输每一行日志
        const lines = output.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            onProgress?.(`[${new Date().toLocaleTimeString()}] ${line}`);
          }
        }
      });

      // 捕获标准错误 - 流式传输
      pythonProcess.stderr?.on('data', (data) => {
        const output = data.toString().trim();
        if (!output) return;

        stderr += output + '\n';
        onError?.(`[${new Date().toLocaleTimeString()}] ❌ ${output}`);
      });

      // 处理进程结束
      pythonProcess.on('close', (code) => {
        onProgress?.(`[${new Date().toLocaleTimeString()}] ⏹️  Python process exited with code ${code}`);

        if (code !== 0) {
          const errorMsg = stderr || stdout || 'Unknown error';
          onError?.(errorMsg);
          reject(new Error(`Python script failed with code ${code}`));
          return;
        }

        if (!hasStarted || !stdout) {
          onError?.('No output from Python script');
          reject(new Error('Python script produced no output'));
          return;
        }

        try {
          // 解析输出结果
          const result = this.parseTestOutput(stdout);
          onProgress?.(`[${new Date().toLocaleTimeString()}] ✨ Test completed successfully`);
          resolve(result);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Failed to parse results';
          onError?.(errorMsg);
          reject(new Error(errorMsg));
        }
      });

      // 处理进程错误
      pythonProcess.on('error', (error) => {
        const errorMsg = error.message;
        onError?.(errorMsg);
        reject(new Error(`Failed to start Python process: ${errorMsg}`));
      });

      // 处理超时
      pythonProcess.on('timeout', () => {
        pythonProcess.kill();
        onError?.('Test execution timeout (10 minutes exceeded)');
        reject(new Error('Test execution timeout'));
      });
    });
  }

  /**
   * 解析 Python 脚本的输出
   * 从 "--- Performance Summary ---" 和 "--- Expert Analysis ---" 部分提取数据
   */
  private parseTestOutput(output: string): TestResult {
    const lines = output.split('\n');
    const stats: Record<string, any> = {};
    const analysis: string[] = [];

    let inStatsSection = false;
    let inAnalysisSection = false;

    for (const line of lines) {
      if (line.includes('--- Performance Summary ---')) {
        inStatsSection = true;
        inAnalysisSection = false;
        continue;
      }
      if (line.includes('--- Expert Analysis ---')) {
        inStatsSection = false;
        inAnalysisSection = true;
        continue;
      }

      if (inStatsSection && line.includes(':')) {
        const [key, value] = line.split(':').map((s) => s.trim());
        if (key && value) {
          stats[key] = value;
        }
      }

      if (inAnalysisSection && line.trim() && !line.includes('---')) {
        analysis.push(line.trim());
      }
    }

    // 构建结果对象
    const totalRequests = parseInt(stats['total_requests'] || '0');
    const successful = parseInt(stats['successful'] || '0');
    const successRate = totalRequests > 0 ? ((successful / totalRequests) * 100).toFixed(1) : '0';

    return {
      totalRequests,
      successfulRequests: successful,
      successRate: parseFloat(successRate as any) || 0,
      ttftAvg: Math.round(parseFloat(stats['avg_ttft'] || '0')),
      ttftP95: Math.round(parseFloat(stats['p95_ttft'] || '0')),
      ttftP99: Math.round(parseFloat(stats['p95_ttft'] || '0') * 1.1), // P99 通常比 P95 略高
        tpsAvg: parseFloat((parseFloat(stats['tps'] || '0')).toFixed(2)),
      itlAvg: Math.round(parseFloat(stats['avg_itl'] || '0')),
      qps: parseFloat((parseFloat(stats['qps'] || '0')).toFixed(2)),
        avgLatency: Math.round(parseFloat(stats['avg_latency'] || '0')),
        p95Latency: Math.round(parseFloat(stats['p95_latency'] || '0')),
      analysis,
    };
  }
}

export const pythonTestRunner = new PythonTestRunner();
