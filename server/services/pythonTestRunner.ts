import { spawn } from 'child_process';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import yaml from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface TestConfig {
  apiProvider?: string;
  apiUrl?: string;
  apiKey?: string;
  model?: string;
  concurrency: number;
  duration: number;
  loadMode: string;
  loadConfig: Record<string, any>;
  inputType?: string;
  inputData?: string;
  environmentId?: number;
  // 新增多协议字段
  testType?: string;
  protocolConfig?: Record<string, any>;
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
  protocolMetrics?: Record<string, any>;
}

/**
 * Python Test Runner - 执行真实的性能测试脚本
 * 支持日志流式传输和真实的 Python 脚本执行
 */
export class PythonTestRunner {
  private tempDir = join('/tmp', 'llm-perf-tests');
  private activeProcesses = new Map<number, any>();

  constructor() {
    try {
      mkdirSync(this.tempDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create temp directory:', error);
    }
  }

  /**
   * 中止正在运行的测试
   */
  abortTest(resultId: number): boolean {
    const process = this.activeProcesses.get(resultId);
    if (process) {
      process.kill('SIGINT');
      return true;
    }
    return false;
  }

  /**
   * 执行真实的性能测试
   * 支持流式日志回调
   */
  async executeTest(
    resultId: number,
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
      return await this.runPythonScript(resultId, configPath, onProgress, onError);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      onError?.(errorMsg);
      throw new Error(`Test execution failed: ${errorMsg}`);
    } finally {
      this.activeProcesses.delete(resultId);
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
    const testType = config.testType || 'LLM';
    
    const yamlObj: any = {
      test_type: testType,
      test: {
        concurrency: config.concurrency,
        duration: config.duration,
        load_mode: config.loadMode,
        load_config: config.loadConfig,
      },
      report: {
        output_format: 'json',
      },
    };

    if (testType === 'REST_API') {
      yamlObj.protocol_config = config.protocolConfig || {};
    } else {
      yamlObj.test.stream = true;
      if (config.protocolConfig) {
        yamlObj.protocol_config = config.protocolConfig;
      } else {
        // 兼容老调用逻辑，旧版本接口字段进行转换
        yamlObj.api = {
          url: config.apiUrl || '',
          key: config.apiKey || '',
          model: config.model || '',
          provider: config.apiProvider || '',
        };
        yamlObj.test.input = {
          type: config.inputType || 'text',
          data: config.inputData || '',
        };
      }
    }

    return yaml.stringify(yamlObj);
  }

  /**
   * 运行 Python 脚本并流式传输日志
   */
  private runPythonScript(
    resultId: number,
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

      this.activeProcesses.set(resultId, pythonProcess);

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

    // 尝试解析 REST API 特有指标
    let protocolMetrics: Record<string, any> | undefined;
    if (stats['status_codes']) {
      try {
        protocolMetrics = {
          statusCodes: JSON.parse(stats['status_codes']),
          avgResponseSize: parseFloat(stats['avg_response_size'] || '0')
        };
      } catch (e) {
        console.error('Failed to parse status_codes from python output:', e);
      }
    }

    return {
      totalRequests,
      successfulRequests: successful,
      successRate: parseFloat(successRate as any) || 0,
      ttftAvg: Math.round(parseFloat(stats['avg_ttft'] || '0')),
      ttftP95: Math.round(parseFloat(stats['p95_ttft'] || '0')),
      ttftP99: Math.round(parseFloat(stats['p99_ttft'] || '0')), // 使用 Python 端直接计算的真实 P99 分位数
      tpsAvg: parseFloat((parseFloat(stats['tps'] || '0')).toFixed(2)),
      itlAvg: Math.round(parseFloat(stats['avg_itl'] || '0')),
      qps: parseFloat((parseFloat(stats['qps'] || '0')).toFixed(2)),
      avgLatency: Math.round(parseFloat(stats['avg_latency'] || '0')),
      p95Latency: Math.round(parseFloat(stats['p95_latency'] || '0')),
      analysis,
      protocolMetrics
    };
  }
}

export const pythonTestRunner = new PythonTestRunner();
