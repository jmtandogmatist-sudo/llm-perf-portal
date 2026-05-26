import { useState, useEffect, useRef } from "react";
import {
  Download,
  Zap,
  Copy,
  Check,
  Play,
  Square,
  RotateCcw,
  AlertCircle,
} from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  buildTestReportPayload,
  exportTestReportAsJson,
  exportTestReportAsPdf,
  exportTestReportAsWord,
} from "@/lib/testReportExport";

interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
}

export default function Generator() {
  const [, navigate] = useLocation();
  const [copied, setCopied] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [testResults, setTestResults] = useState<any>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingWord, setIsExportingWord] = useState(false);
  const [activeTab, setActiveTab] = useState<"generator" | "history">(
    "generator"
  );

  const [config, setConfig] = useState({
    apiProvider: "openai",
    apiUrl: "https://api.openai.com/v1/chat/completions",
    apiKey: "",
    model: "gpt-4o",
    loadMode: "constant",
    loadConfig: { concurrency: 5, duration: 60 } as any,
    inputType: "text",
    inputData: "Explain quantum computing in simple terms.",
  });

  // tRPC mutations
  const executeTestMutation = trpc.test.executeTest.useMutation();
  const checkApiHealthMutation = trpc.test.checkApiHealth.useMutation();
  const utils = trpc.useUtils();

  // Auto-scroll logs to bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const logCounterRef = useRef(0);
  const addLog = (
    message: string,
    level: "info" | "success" | "warning" | "error" = "info"
  ) => {
    logCounterRef.current += 1;
    const currentId = logCounterRef.current.toString();
    const newLog: LogEntry = {
      id: currentId,
      timestamp: new Date().toLocaleTimeString(),
      level,
      message,
    };
    setLogs(prev => {
      const updated = [...prev, newLog];
      if (updated.length > 500) return updated.slice(updated.length - 500);
      return updated;
    });
  };

  const generateYaml = () => {
    return `api:
  provider: ${config.apiProvider}
  url: ${config.apiUrl}
  key: ${config.apiKey}
  model: ${config.model}

test:
  load_mode: ${config.loadMode}
  load_config:
${Object.entries(config.loadConfig)
  .map(([k, v]) => `    ${k}: ${v}`)
  .join("\n")}
  stream: true
  input:
    type: ${config.inputType}
    data: "${config.inputData}"

report:
  output_dir: ./my_reports
  name: llm_perf_test_report
`;
  };

  const handleCopyYaml = () => {
    const yaml = generateYaml();
    navigator.clipboard.writeText(yaml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("配置已复制到剪贴板！");
  };

  const handleDownloadYaml = () => {
    const yaml = generateYaml();
    const blob = new Blob([yaml], { type: "text/plain" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "config.yaml";
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    toast.success("配置已下载！");
  };

  const executeRealTest = async () => {
    if (!config.apiKey) {
      toast.error("请输入 API Key");
      return;
    }

    const normalizedInputData =
      config.inputType === "text" ? config.inputData.trim() : config.inputData;

    if (config.inputType === "text" && !normalizedInputData) {
      toast.error("文本输入不能为空");
      return;
    }

    setIsRunning(true);
    setProgress(0);
    setLogs([]);
    setTestResults(null);

    addLog("� 正在进行 API 预检 (Pre-flight Ping)...", "info");
    try {
      const healthCheck = await checkApiHealthMutation.mutateAsync({
        apiProvider: config.apiProvider,
        apiUrl: config.apiUrl,
        apiKey: config.apiKey,
        model: config.model,
      });

      if (!healthCheck.ok) {
        addLog(`❌ API 预检失败: ${healthCheck.error}`, "error");
        toast.error("API连通性检查未通过，请检查网关或模型状态");
        setIsRunning(false);
        return;
      }
      addLog("✅ API 预检通过，网关连通性正常", "success");
    } catch (e) {
      addLog(`❌ 预检请求抛错: ${e}`, "error");
      toast.error("API连通性检查请求异常");
      setIsRunning(false);
      return;
    }

    addLog("�🚀 Starting real performance test...", "info");
    addLog(`Provider: ${config.apiProvider} | Model: ${config.model}`, "info");
    addLog(
      `Load Mode: ${config.loadMode} | Duration: ${config.loadConfig.duration}s`,
      "info"
    );
    addLog("", "info");

    try {
      // Execute test mutation to get resultId (it no longer runs synchronously)
      const enqueueResult = await executeTestMutation.mutateAsync({
        apiProvider: config.apiProvider,
        apiUrl: config.apiUrl,
        apiKey: config.apiKey,
        model: config.model,
        loadMode: config.loadMode as "constant" | "ramp_up" | "fluctuate" | "spike",
        loadConfig: config.loadConfig,
        inputType: config.inputType as "text" | "image" | "json",
        inputData: normalizedInputData,
      });

      const resultId = enqueueResult.resultId;
      addLog(`[System] Task queued successfully. Job ID: ${resultId}`, "info");

      let currentLogIndex = 0;

      await new Promise<void>((resolve, reject) => {
        const pollInterval = setInterval(async () => {
          try {
            const statusResult = await utils.test.pollStatus.fetch({
              resultId,
              fromLogIndex: currentLogIndex,
            });

            // Append new logs
            if (statusResult.logs && statusResult.logs.length > 0) {
              statusResult.logs.forEach((logLine) => {
                const isError = logLine.includes('❌') || logLine.includes('[ERROR]') || logLine.includes('failed:');
                const isSuccess = logLine.includes('✅') || logLine.includes('completed successfully') || logLine.includes('completed');
                const isWarning = logLine.includes('⚠️');
                const level = isError ? 'error' : isSuccess ? 'success' : isWarning ? 'warning' : 'info';
                
                // Parse timestamp if present [HH:MM:SS] message
                const timeMatch = logLine.match(/^\[(.*?)\]\s*(.*)$/);
                if (timeMatch) {
                  addLog(timeMatch[2], level);
                } else {
                  addLog(logLine, level);
                }
              });
              currentLogIndex = statusResult.nextLogIndex;
            }

            setProgress(statusResult.progress);

            if (statusResult.status === 'completed' && statusResult.result) {
              clearInterval(pollInterval);
              setProgress(100);
              
              const result = statusResult.result;
              setTestResults(result);

              // Display results summary in logs
              addLog("", "info");
              addLog("═══════════════════════════════════════", "info");
              addLog("📊 TEST RESULTS SUMMARY", "info");
              addLog("═══════════════════════════════════════", "info");
              addLog(`Total Requests: ${result.totalRequests}`, "info");

              const isAllFailed = result.totalRequests > 0 && result.successfulRequests === 0;

              addLog(
                `Successful Requests: ${result.successfulRequests} (${result.successRate}%)`,
                isAllFailed ? "error" : "success"
              );
              
              if (isAllFailed) {
                 addLog(`❌ 所有请求均失败 (Failed: ${result.totalRequests - result.successfulRequests})`, "error");
              }

              addLog(`TTFT (Avg): ${result.ttftAvg}ms`, "info");
              addLog(`TTFT (P95): ${result.ttftP95}ms`, "info");
              addLog(`TTFT (P99): ${result.ttftP99}ms`, "info");
              addLog(`TPS (Avg): ${result.tpsAvg} tokens/sec`, "info");
              addLog(`ITL (Avg): ${result.itlAvg}ms`, "info");
              addLog(`QPS: ${result.qps} requests/sec`, "info");
              addLog("═══════════════════════════════════════", "info");

              if (isAllFailed) {
                addLog("⚠️ 测试运行完成，但业务请求全量异常！", "warning");
                if (result.analysis && result.analysis.length > 0) {
                  result.analysis.forEach((msg: string) => addLog(`[专家诊断] ${msg}`, "error"));
                }
                toast.error("核心请求全部失败，请查看专家诊断");
              } else {
                addLog("✅ Test completed successfully!", "success");
                toast.success("测试成功完成！");
              }

              // Refetch history panel list
              utils.test.getResults.invalidate();
              resolve();
            } else if (statusResult.status === 'failed') {
              clearInterval(pollInterval);
              addLog(`❌ 测试运行失败: ${statusResult.error || '未知错误'}`, "error");
              toast.error(`测试执行失败: ${statusResult.error || '未知错误'}`);
              
              // Refetch history panel list
              utils.test.getResults.invalidate();
              reject(new Error(statusResult.error));
            }
          } catch (e) {
            console.error("Polling error:", e);
          }
        }, 1500);
      });
    } catch (error) {
      addLog(
        `❌ 测试失败: ${error instanceof Error ? error.message : "未知错误"}`,
        "error"
      );
      toast.error("测试执行失败");
    } finally {
      setIsRunning(false);
    }
  };

  const handleReset = () => {
    setProgress(0);
    setLogs([]);
    setTestResults(null);
    setIsRunning(false);
  };

  const exportTestResultsJson = () => {
    if (!testResults) return;

    const payload = buildTestReportPayload(
      {
        apiProvider: config.apiProvider,
        apiUrl: config.apiUrl,
        model: config.model,
        loadMode: config.loadMode as "constant" | "ramp_up" | "fluctuate" | "spike",
        loadConfig: config.loadConfig,
        inputType: config.inputType as "text" | "image" | "json",
      },
      {
        ...testResults,
        analysis: testResults.analysis ?? [],
      }
    );

    exportTestReportAsJson(payload);
    toast.success("测试结果已导出！");
  };

  const exportTestResultsPdf = async () => {
    if (!testResults) return;

    const payload = buildTestReportPayload(
      {
        apiProvider: config.apiProvider,
        apiUrl: config.apiUrl,
        model: config.model,
        loadMode: config.loadMode as "constant" | "ramp_up" | "fluctuate" | "spike",
        loadConfig: config.loadConfig,
        inputType: config.inputType as "text" | "image" | "json",
      },
      {
        ...testResults,
        analysis: testResults.analysis ?? [],
      }
    );

    setIsExportingPdf(true);
    try {
      await exportTestReportAsPdf(payload);
      toast.success("PDF 报告已导出！");
    } finally {
      setIsExportingPdf(false);
    }
  };

  const exportTestResultsWord = async () => {
    if (!testResults) return;

    const payload = buildTestReportPayload(
      {
        apiProvider: config.apiProvider,
        apiUrl: config.apiUrl,
        model: config.model,
        loadMode: config.loadMode as "constant" | "ramp_up" | "fluctuate" | "spike",
        loadConfig: config.loadConfig,
        inputType: config.inputType as "text" | "image" | "json",
      },
      {
        ...testResults,
        analysis: testResults.analysis ?? [],
      }
    );

    setIsExportingWord(true);
    try {
      await exportTestReportAsWord(payload);
      toast.success("Word 报告已导出！");
    } finally {
      setIsExportingWord(false);
    }
  };

  const getLogColor = (level: string) => {
    switch (level) {
      case "success":
        return "text-green-500";
      case "warning":
        return "text-yellow-500";
      case "error":
        return "text-red-500";
      default:
        return "text-muted-foreground";
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="container flex items-center justify-between h-16">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-lg font-bold hover:opacity-80 transition-opacity"
          >
            <Zap className="w-6 h-6 text-primary" />
            LLM Perf Portal
          </button>
          <button
            onClick={() => navigate("/")}
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            返回首页
          </button>
        </div>
      </nav>

      <div className="container py-12">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-4xl font-bold mb-2">性能测试平台</h1>
              <p className="text-lg text-muted-foreground">
                创建、测试并导出您的性能测试配置
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTab("generator")}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  activeTab === "generator"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                生成器
              </button>
              <button
                onClick={() => setActiveTab("history")}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  activeTab === "history"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                历史记录
              </button>
            </div>
          </div>

          {/* Main Layout */}
          {activeTab === "generator" ? (
            <div className="grid lg:grid-cols-3 gap-8">
              {/* Form - Left Column */}
              <div className="lg:col-span-1 space-y-6">
                <div className="card-premium p-6">
                  <h3 className="text-lg font-bold mb-4">API 配置</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        供应商
                      </label>
                      <select
                        value={config.apiProvider}
                        onChange={e =>
                          setConfig({ ...config, apiProvider: e.target.value })
                        }
                        disabled={isRunning}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                      >
                        <option value="openai">OpenAI</option>
                        <option value="anthropic">Anthropic</option>
                        <option value="custom">自定义</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        API 地址
                      </label>
                      <input
                        type="text"
                        value={config.apiUrl}
                        onChange={e =>
                          setConfig({ ...config, apiUrl: e.target.value })
                        }
                        disabled={isRunning}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        API 密钥
                      </label>
                      <input
                        type="password"
                        value={config.apiKey}
                        onChange={e =>
                          setConfig({ ...config, apiKey: e.target.value })
                        }
                        disabled={isRunning}
                        placeholder="sk-..."
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        模型
                      </label>
                      <input
                        type="text"
                        value={config.model}
                        onChange={e =>
                          setConfig({ ...config, model: e.target.value })
                        }
                        disabled={isRunning}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                      />
                    </div>
                  </div>
                </div>

                <div className="card-premium p-6">
                  <h3 className="text-lg font-bold mb-4">测试参数</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        负载模式
                      </label>
                      <select
                        value={config.loadMode}
                        onChange={e => {
                          const mode = e.target.value;
                          let defaultLoadConfig = {
                            concurrency: 10,
                            duration: 60,
                          };
                          if (mode === "ramp_up") {
                            defaultLoadConfig = {
                              start: 1,
                              end: 50,
                              step: 5,
                              duration: 60,
                            } as any;
                          } else if (mode === "fluctuate") {
                            defaultLoadConfig = {
                              min: 5,
                              max: 50,
                              period: 30,
                              duration: 300,
                            } as any;
                          } else if (mode === "spike") {
                            defaultLoadConfig = {
                              baseline: 10,
                              spike: 100,
                              spike_duration: 10,
                            } as any;
                          }
                          setConfig({
                            ...config,
                            loadMode: mode,
                            loadConfig: defaultLoadConfig,
                          });
                        }}
                        disabled={isRunning}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                      >
                        <option value="constant">恒定负载</option>
                        <option value="ramp_up">阶梯增压</option>
                        <option value="fluctuate">波动负载</option>
                        <option value="spike">突刺负载</option>
                      </select>
                    </div>

                    {config.loadMode === "constant" && (
                      <>
                        <div>
                          <label className="block text-sm font-medium mb-2">
                            并发数
                          </label>
                          <input
                            type="number"
                            value={config.loadConfig.concurrency || ""}
                            onChange={e =>
                              setConfig({
                                ...config,
                                loadConfig: {
                                  ...config.loadConfig,
                                  concurrency: parseInt(e.target.value) || 1,
                                },
                              })
                            }
                            disabled={isRunning}
                            min="1"
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2">
                            时长 (秒)
                          </label>
                          <input
                            type="number"
                            value={config.loadConfig.duration || ""}
                            onChange={e =>
                              setConfig({
                                ...config,
                                loadConfig: {
                                  ...config.loadConfig,
                                  duration: parseInt(e.target.value) || 10,
                                },
                              })
                            }
                            disabled={isRunning}
                            min="10"
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                          />
                        </div>
                      </>
                    )}

                    {config.loadMode === "ramp_up" && (
                      <>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-sm font-medium mb-2">
                              起始并发
                            </label>
                            <input
                              type="number"
                              value={config.loadConfig.start || ""}
                              onChange={e =>
                                setConfig({
                                  ...config,
                                  loadConfig: {
                                    ...config.loadConfig,
                                    start: parseInt(e.target.value) || 1,
                                  },
                                })
                              }
                              disabled={isRunning}
                              min="1"
                              className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2">
                              目标并发
                            </label>
                            <input
                              type="number"
                              value={config.loadConfig.end || ""}
                              onChange={e =>
                                setConfig({
                                  ...config,
                                  loadConfig: {
                                    ...config.loadConfig,
                                    end: parseInt(e.target.value) || 1,
                                  },
                                })
                              }
                              disabled={isRunning}
                              min="1"
                              className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2">
                              步长
                            </label>
                            <input
                              type="number"
                              value={config.loadConfig.step || ""}
                              onChange={e =>
                                setConfig({
                                  ...config,
                                  loadConfig: {
                                    ...config.loadConfig,
                                    step: parseInt(e.target.value) || 1,
                                  },
                                })
                              }
                              disabled={isRunning}
                              min="1"
                              className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2">
                            时长 (秒)
                          </label>
                          <input
                            type="number"
                            value={config.loadConfig.duration || ""}
                            onChange={e =>
                              setConfig({
                                ...config,
                                loadConfig: {
                                  ...config.loadConfig,
                                  duration: parseInt(e.target.value) || 10,
                                },
                              })
                            }
                            disabled={isRunning}
                            min="10"
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                          />
                        </div>
                      </>
                    )}

                    {config.loadMode === "fluctuate" && (
                      <>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-sm font-medium mb-2">
                              最小并发
                            </label>
                            <input
                              type="number"
                              value={config.loadConfig.min || ""}
                              onChange={e =>
                                setConfig({
                                  ...config,
                                  loadConfig: {
                                    ...config.loadConfig,
                                    min: parseInt(e.target.value) || 1,
                                  },
                                })
                              }
                              disabled={isRunning}
                              min="1"
                              className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2">
                              最大并发
                            </label>
                            <input
                              type="number"
                              value={config.loadConfig.max || ""}
                              onChange={e =>
                                setConfig({
                                  ...config,
                                  loadConfig: {
                                    ...config.loadConfig,
                                    max: parseInt(e.target.value) || 1,
                                  },
                                })
                              }
                              disabled={isRunning}
                              min="1"
                              className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2">
                              周期时长 (秒)
                            </label>
                            <input
                              type="number"
                              value={config.loadConfig.period || ""}
                              onChange={e =>
                                setConfig({
                                  ...config,
                                  loadConfig: {
                                    ...config.loadConfig,
                                    period: parseInt(e.target.value) || 1,
                                  },
                                })
                              }
                              disabled={isRunning}
                              min="1"
                              className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2">
                            测试总时长 (秒)
                          </label>
                          <input
                            type="number"
                            value={config.loadConfig.duration || ""}
                            onChange={e =>
                              setConfig({
                                ...config,
                                loadConfig: {
                                  ...config.loadConfig,
                                  duration: parseInt(e.target.value) || 10,
                                },
                              })
                            }
                            disabled={isRunning}
                            min="10"
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                          />
                        </div>
                      </>
                    )}

                    {config.loadMode === "spike" && (
                      <>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-sm font-medium mb-2">
                              基线并发
                            </label>
                            <input
                              type="number"
                              value={config.loadConfig.baseline || ""}
                              onChange={e =>
                                setConfig({
                                  ...config,
                                  loadConfig: {
                                    ...config.loadConfig,
                                    baseline: parseInt(e.target.value) || 1,
                                  },
                                })
                              }
                              disabled={isRunning}
                              min="1"
                              className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2">
                              突刺并发
                            </label>
                            <input
                              type="number"
                              value={config.loadConfig.spike || ""}
                              onChange={e =>
                                setConfig({
                                  ...config,
                                  loadConfig: {
                                    ...config.loadConfig,
                                    spike: parseInt(e.target.value) || 1,
                                  },
                                })
                              }
                              disabled={isRunning}
                              min="1"
                              className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2">
                              突刺时长 (秒)
                            </label>
                            <input
                              type="number"
                              value={config.loadConfig.spike_duration || ""}
                              onChange={e =>
                                setConfig({
                                  ...config,
                                  loadConfig: {
                                    ...config.loadConfig,
                                    spike_duration:
                                      parseInt(e.target.value) || 1,
                                  },
                                })
                              }
                              disabled={isRunning}
                              min="1"
                              className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                            />
                          </div>
                        </div>
                      </>
                    )}

                    <div>
                      <label className="block text-sm font-medium mb-2">
                        输入类型
                      </label>
                      <select
                        value={config.inputType}
                        onChange={e =>
                          setConfig({ ...config, inputType: e.target.value })
                        }
                        disabled={isRunning}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                      >
                        <option value="text">文本</option>
                        <option value="image">图像</option>
                        <option value="json">JSON</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        输入数据
                      </label>
                      <textarea
                        value={config.inputData}
                        onChange={e =>
                          setConfig({ ...config, inputData: e.target.value })
                        }
                        disabled={isRunning}
                        rows={3}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Preview & Execution - Right Column */}
              <div className="lg:col-span-2 space-y-6">
                {/* YAML Preview */}
                <div className="card-premium p-6">
                  <h3 className="text-lg font-bold mb-4">config.yaml 预览</h3>
                  <pre className="bg-muted/50 p-4 rounded-lg text-sm overflow-auto max-h-64 mb-4 border border-border">
                    {generateYaml()}
                  </pre>
                  <div className="flex gap-3">
                    <button
                      onClick={handleCopyYaml}
                      disabled={isRunning}
                      className="flex-1 button-secondary flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {copied ? (
                        <Check className="w-4 h-4" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                      {copied ? "已复制" : "复制配置"}
                    </button>
                    <button
                      onClick={handleDownloadYaml}
                      disabled={isRunning}
                      className="flex-1 button-primary flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <Download className="w-4 h-4" />
                      下载配置
                    </button>
                  </div>
                </div>

                {/* Test Execution Controls */}
                <div className="card-premium p-6">
                  <h3 className="text-lg font-bold mb-4">执行测试</h3>
                  <div className="flex gap-3 mb-6">
                    <button
                      onClick={executeRealTest}
                      disabled={isRunning || executeTestMutation.isPending}
                      className="flex-1 button-primary flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <Play className="w-4 h-4" />
                      {isRunning || executeTestMutation.isPending
                        ? "运行中..."
                        : "运行真实测试"}
                    </button>
                    <button
                      onClick={handleReset}
                      disabled={isRunning}
                      className="flex-1 button-secondary flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <RotateCcw className="w-4 h-4" />
                      重置
                    </button>
                  </div>

                  {/* Progress Bar */}
                  {(isRunning || progress > 0) && (
                    <div className="mb-6">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-medium">进度</span>
                        <span className={`text-sm font-semibold ${testResults && testResults.successfulRequests === 0 ? 'text-red-500' : 'text-primary'}`}>
                          {Math.round(progress)}% {testResults && testResults.successfulRequests === 0 && "(测试中断)"}
                        </span>
                      </div>
                      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${testResults && testResults.successfulRequests === 0 ? 'bg-red-500' : 'bg-gradient-to-r from-primary to-blue-400'}`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Test Results Summary */}
                  {testResults && (
                    <>
                      {testResults.successfulRequests === 0 && (
                        <div className="mt-4 p-4 border border-red-500/50 bg-red-500/10 rounded-lg">
                          <h4 className="text-red-500 font-bold flex items-center gap-2 mb-2">
                            <AlertCircle className="w-5 h-5" /> 专家诊断预警
                          </h4>
                          <p className="text-sm text-red-400 mb-2">检测到大量阻断错误，上游可能无法提供服务或存在速率限制：</p>
                          <ul className="list-disc list-inside text-sm text-red-400 pl-4">
                            {testResults.analysis && testResults.analysis.length > 0 ? (
                              testResults.analysis.map((msg: string, i: number) => <li key={i}>{msg}</li>)
                            ) : (
                              <li>API 端点无有效响应</li>
                            )}
                          </ul>
                        </div>
                      )}
                      
                      <div className="grid grid-cols-2 gap-3 mt-6 pt-6 border-t border-border">
                        <div className={`p-3 rounded-lg ${testResults.successfulRequests === 0 ? 'bg-red-500/5' : 'bg-primary/5'}`}>
                          <p className="text-xs text-muted-foreground">测试成功率</p>
                          <p className={`text-lg font-bold ${testResults.successfulRequests === 0 ? 'text-red-500' : 'text-primary'}`}>
                            {testResults.successRate}
                          </p>
                        </div>
                        <div className={`p-3 rounded-lg ${testResults.successfulRequests === 0 ? 'bg-red-500/5' : 'bg-primary/5'}`}>
                          <p className="text-xs text-muted-foreground">阻断/总请求</p>
                          <p className={`text-lg font-bold ${testResults.successfulRequests === 0 ? 'text-red-500' : 'text-primary'}`}>
                            {testResults.totalRequests - testResults.successfulRequests} / {testResults.totalRequests}
                          </p>
                        </div>
                        <div className="bg-primary/5 p-3 rounded-lg">

                          <p className="text-xs text-muted-foreground">
                            Avg TTFT
                          </p>
                          <p className="text-lg font-bold text-primary">
                            {testResults.ttftAvg}ms
                          </p>
                        </div>
                        <div className="bg-primary/5 p-3 rounded-lg">
                          <p className="text-xs text-muted-foreground">
                            P95 TTFT
                          </p>
                          <p className="text-lg font-bold text-primary">
                            {testResults.ttftP95}ms
                          </p>
                        </div>
                        <div className="bg-primary/5 p-3 rounded-lg">
                          <p className="text-xs text-muted-foreground">
                            Avg TPS
                          </p>
                          <p className="text-lg font-bold text-primary">
                            {testResults.tpsAvg}
                          </p>
                        </div>
                        <div className="bg-primary/5 p-3 rounded-lg">
                          <p className="text-xs text-muted-foreground">QPS</p>
                          <p className="text-lg font-bold text-primary">
                            {testResults.qps}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-3 mt-4 flex-wrap">
                        <button
                          onClick={exportTestResultsJson}
                          className="flex-1 button-secondary flex items-center justify-center gap-2 min-w-32"
                          disabled={isExportingPdf || isExportingWord}
                        >
                          <Download className="w-4 h-4" />
                          导出 JSON
                        </button>
                        <button
                          onClick={exportTestResultsPdf}
                          className="flex-1 button-secondary flex items-center justify-center gap-2 min-w-32"
                          disabled={isExportingPdf || isExportingWord}
                        >
                          <Download className="w-4 h-4" />
                          {isExportingPdf ? "导出 PDF 中..." : "导出 PDF"}
                        </button>
                        <button
                          onClick={exportTestResultsWord}
                          className="flex-1 button-secondary flex items-center justify-center gap-2 min-w-32"
                          disabled={isExportingPdf || isExportingWord}
                        >
                          <Download className="w-4 h-4" />
                          {isExportingWord ? "导出 Word 中..." : "导出 Word"}
                        </button>
                        {testResults.id && (
                          <button
                            onClick={() =>
                              navigate(`/dashboard?id=${testResults.id}`)
                            }
                            className="flex-1 button-primary flex items-center justify-center gap-2 min-w-32"
                          >
                            查看详细报告
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* Real-time Logs */}
                {logs.length > 0 && (
                  <div className="card-premium p-6">
                    <h3 className="text-lg font-bold mb-4">实时日志</h3>
                    <div className="bg-muted/30 rounded-lg p-4 h-64 overflow-y-auto border border-border font-mono text-sm">
                      {logs.map(log => (
                        <div key={log.id} className="mb-1 flex gap-2">
                          <span className="text-muted-foreground flex-shrink-0">
                            [{log.timestamp}]
                          </span>
                          <span
                            className={`flex-shrink-0 ${getLogColor(log.level)}`}
                          >
                            {log.level === "success"
                              ? "✓"
                              : log.level === "error"
                                ? "✗"
                                : log.level === "warning"
                                  ? "⚠"
                                  : "•"}
                          </span>
                          <span className={`break-words ${log.level === 'error' ? 'text-red-500 font-medium' : log.level === 'warning' ? 'text-yellow-500 font-medium' : 'text-foreground'}`}>
                            {log.message}
                          </span>
                        </div>
                      ))}
                      <div ref={logsEndRef} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="card-premium p-8">
              <h2 className="text-2xl font-bold mb-6">测试历史记录</h2>
              <TestHistoryPanel />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Test History Component
function TestHistoryPanel() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { data: testResults = [], isLoading } = trpc.test.getResults.useQuery();
  const deleteResultMutation = trpc.test.deleteResult.useMutation();
  const [selectedResults, setSelectedResults] = useState<number[]>([]);

  const handleDelete = (resultId: number) => {
    deleteResultMutation.mutate(
      { resultId },
      {
        onSuccess: () => {
          toast.success("测试结果已删除");
          setSelectedResults(prev => prev.filter(id => id !== resultId));
          utils.test.getResults.invalidate();
        },
      }
    );
  };

  const handleCompare = () => {
    if (selectedResults.length < 2) {
      toast.error("请至少选择两个结果来进行对比");
      return;
    }
    navigate(`/comparison?ids=${selectedResults.join(",")}`);
  };

  if (isLoading) {
    return <div className="text-center py-8">正在加载测试历史...</div>;
  }

  if (testResults.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">暂无测试结果</div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 mb-4">
        <button
          onClick={handleCompare}
          disabled={selectedResults.length < 2}
          className="button-secondary flex-1 disabled:opacity-50"
        >
          对比所选项 ({selectedResults.length})
        </button>
      </div>
      <div className="space-y-2">
        {testResults.map((result: any) => (
          <div
            key={result.id}
            className="flex items-center gap-3 p-3 border border-border rounded-lg"
          >
            <input
              type="checkbox"
              checked={selectedResults.includes(result.id)}
              onChange={e => {
                if (e.target.checked) {
                  setSelectedResults([...selectedResults, result.id]);
                } else {
                  setSelectedResults(
                    selectedResults.filter(id => id !== result.id)
                  );
                }
              }}
              className="w-4 h-4"
            />
            <div className="flex-1">
              <p className="font-medium">
                {result.name || result.model || `Test #${result.id}`}
              </p>
              <p className="text-sm text-muted-foreground">
                {new Date(result.createdAt).toLocaleString()} - {result.status}
              </p>
              {result.status === "completed" && (
                <p className="text-sm">
                  TTFT: {result.ttftAvg}ms | QPS: {result.qps}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {result.status === "completed" && (
                <button
                  onClick={() => navigate(`/dashboard?id=${result.id}`)}
                  className="text-primary hover:text-primary/80 text-sm font-medium"
                >
                  查看详情
                </button>
              )}
              <button
                onClick={() => handleDelete(result.id)}
                className="text-destructive hover:text-destructive/80 text-sm"
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
