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
  Plus,
  Trash2,
  Upload,
  Image as ImageIcon,
  Film,
  FileJson,
  X,
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
import SutManager from "@/components/SutManager";

// ──────────────────────────────────────────────────────────
// 类型定义
// ──────────────────────────────────────────────────────────

/** 实时日志条目数据结构 */
interface LogEntry {
  id: string;          // 唯一标识符（递增计数器字符串）
  timestamp: string;   // 本地化时间戳，格式: HH:MM:SS
  level: "info" | "success" | "warning" | "error"; // 日志级别
  message: string;     // 日志正文
}

// ──────────────────────────────────────────────────────────
// 主组件：性能测试生成器
// ──────────────────────────────────────────────────────────
export default function Generator() {
  // 路由导航钩子
  const [, navigate] = useLocation();

  // 解析 URL 中的克隆配置 ID 参数 (cloneId)
  const cloneIdStr = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("cloneId") : null;
  const cloneId = cloneIdStr ? Number(cloneIdStr) : null;

  // ── UI 状态 ──────────────────────────────────────────────
  /** 复制配置按钮的"已复制"短暂状态 */
  const [copied, setCopied] = useState(false);

  /** 测试是否正在执行中（控制按钮禁用、进度条显示等） */
  const [isRunning, setIsRunning] = useState(false);

  /** 测试进度百分比 0~100，由轮询后端接口更新 */
  const [progress, setProgress] = useState(0);

  /** 实时日志列表，最多保留 500 条以防内存溢出 */
  const [logs, setLogs] = useState<LogEntry[]>([]);

  /** 日志容器底部锚点引用，用于自动滚动到最新日志 */
  const logsEndRef = useRef<HTMLDivElement>(null);

  /** 测试完成后的结果数据（JSON 对象，字段见后端 testResult schema） */
  const [testResults, setTestResults] = useState<any>(null);

  /** PDF 导出进行中的状态，防止重复点击 */
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  /** Word 导出进行中的状态，防止重复点击 */
  const [isExportingWord, setIsExportingWord] = useState(false);

  /** 当前激活的顶部 Tab（"generator" | "history"） */
  const [activeTab, setActiveTab] = useState<"generator" | "history">(
    "generator"
  );

  // ── 测试配置状态 ─────────────────────────────────────────
  /**
   * 核心测试配置对象
   * - apiProvider：API 供应商标识 (openai / anthropic / custom)
   * - apiUrl：接口完整地址
   * - apiKey：鉴权密钥（密码字段，不会明文展示）
   * - model：模型名称（如 gpt-4o、claude-3-5-sonnet）
   * - loadMode：负载模式（constant / ramp_up / fluctuate / spike）
   * - loadConfig：与负载模式对应的参数对象（并发数、时长等）
   * - inputType：输入数据类型 (text / image / json)
   * - inputData：具体的输入内容
   */
  const [config, setConfig] = useState({
    apiProvider: "openai",
    apiUrl: "https://api.openai.com/v1/chat/completions",
    apiKey: "",
    model: "gpt-4o",
    loadMode: "constant",
    loadConfig: { concurrency: 60, duration: 60 } as any,
    inputType: "text",
    inputData: "Explain quantum computing in simple terms.",
  });

  // ── 拖拽上传与媒体文件/JSON处理状态与助手 ──
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const processFile = (file: File, type: "image" | "video") => {
    if (type === "image" && !file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      return;
    }
    if (type === "video" && !file.type.startsWith("video/")) {
      toast.error("请选择视频文件");
      return;
    }
    // Limit local file upload to 45MB to be safe
    if (file.size > 45 * 1024 * 1024) {
      toast.error("文件体积过大，请上传 45MB 以内的文件");
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setConfig(prev => ({ ...prev, inputData: reader.result as string }));
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent, type: "image" | "video") => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file, type);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file, "image");
    }
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file, "video");
    }
  };

  const getJsonValidationStatus = () => {
    if (config.inputType !== "json") return { isValid: true, message: "" };
    if (!config.inputData.trim()) return { isValid: false, message: "内容为空" };
    try {
      JSON.parse(config.inputData);
      return { isValid: true, message: "格式正确" };
    } catch (e: any) {
      return { isValid: false, message: e.message };
    }
  };

  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(config.inputData);
      setConfig(prev => ({ ...prev, inputData: JSON.stringify(parsed, null, 2) }));
      toast.success("JSON 格式化成功");
    } catch (e) {
      toast.error("JSON 格式错误，无法格式化");
    }
  };

  const [testType, setTestType] = useState<"LLM" | "REST_API">("LLM");
  const [selectedEnvId, setSelectedEnvId] = useState<number | undefined>(undefined);
  const [restConfig, setRestConfig] = useState({
    url: "https://httpbin.org/post",
    method: "POST" as "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
    bodyType: "json" as "json" | "raw",
    bodyContent: JSON.stringify({ message: "Hello, World!" }, null, 2),
    expectedStatus: 200,
  });
  const [restHeaders, setRestHeaders] = useState<{ key: string; value: string }[]>([
    { key: "Content-Type", value: "application/json" }
  ]);
  const [restQueryParams, setRestQueryParams] = useState<{ key: string; value: string }[]>([
    { key: "", value: "" }
  ]);

  // 获取被测环境列表
  const { data: environments = [] } = trpc.environment.getEnvironments.useQuery();
  const selectedEnv = environments.find((e: any) => e.id === selectedEnvId);

  // ── tRPC 接口钩子 ─────────────────────────────────────────
  /** 执行测试的 Mutation（提交后进入任务队列，返回 resultId） */
  const executeTestMutation = trpc.test.executeTest.useMutation();

  /** API 健康检查 Mutation（在正式测试前做连通性预检） */
  const checkApiHealthMutation = trpc.test.checkApiHealth.useMutation();

  /** 查询用于克隆的测试历史记录配置 */
  const { data: cloneData } = trpc.test.getResult.useQuery(
    { resultId: cloneId ?? 0 },
    { enabled: !!cloneId }
  );

  /** tRPC Utils，用于手动触发 Query 缓存失效/重新请求 */
  const utils = trpc.useUtils();

  // ──────────────────────────────────────────────────────────
  // 副作用
  // ──────────────────────────────────────────────────────────

  /**
   * 当 logs 列表更新时，自动将滚动位置定位到底部
   * 确保用户始终能看到最新的日志条目
   */
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  /**
   * 自动克隆配置逻辑
   * 当从 Dashboard 中选择“克隆此配置”跳转来时，根据 cloneData 自动填充表单配置
   */
  useEffect(() => {
    if (!cloneData) return;

    const configData = cloneData.config;
    if (!configData) {
      toast.error("未找到对应的测试配置快照，无法克隆");
      return;
    }

    // 设置测试类型和被测环境
    const clonedTestType = cloneData.testType as "LLM" | "REST_API";
    setTestType(clonedTestType);
    setSelectedEnvId(cloneData.environmentId || undefined);

    if (clonedTestType === "LLM") {
      setConfig({
        apiProvider: configData.apiProvider || "openai",
        apiUrl: configData.apiUrl || "",
        apiKey: "", // 出于安全性考虑，API Key 重置为空，让用户输入
        model: configData.model || "",
        loadMode: configData.loadMode || "constant",
        loadConfig: configData.loadConfig || { concurrency: 60, duration: 60 },
        inputType: configData.inputType || "text",
        inputData: configData.inputData || "",
      });
      toast.success(`已成功克隆 LLM 压测配置（模型: ${configData.model}），请检查并输入 API Key 后执行测试`);
    } else if (clonedTestType === "REST_API") {
      const protocol = configData.protocolConfig as any;
      if (protocol) {
        setRestConfig({
          url: protocol.url || "https://httpbin.org/post",
          method: protocol.method || "POST",
          bodyType: protocol.bodyType || "json",
          bodyContent: protocol.bodyContent || "",
          expectedStatus: protocol.expectedStatus !== undefined ? protocol.expectedStatus : 200,
        });

        // 映射 Headers
        if (protocol.headers) {
          const headersArray = Object.entries(protocol.headers).map(([key, value]) => ({
            key,
            value: String(value),
          }));
          setRestHeaders(headersArray.length > 0 ? headersArray : [{ key: "Content-Type", value: "application/json" }]);
        } else {
          setRestHeaders([{ key: "Content-Type", value: "application/json" }]);
        }

        // 映射 Query Params
        if (protocol.queryParams) {
          const paramsArray = Object.entries(protocol.queryParams).map(([key, value]) => ({
            key,
            value: String(value),
          }));
          setRestQueryParams(paramsArray.length > 0 ? paramsArray : [{ key: "", value: "" }]);
        } else {
          setRestQueryParams([{ key: "", value: "" }]);
        }
      }

      // 填充负载设置
      setConfig(prev => ({
        ...prev,
        loadMode: configData.loadMode || "constant",
        loadConfig: configData.loadConfig || { concurrency: 60, duration: 60 },
      }));

      toast.success(`已成功克隆 REST API 压测配置（接口: ${protocol?.url || ''}），可直接执行测试`);
    }

    // 清空 URL 中的 cloneId 参数，避免页面刷新时重新覆盖用户修改
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("cloneId");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, [cloneData]);

  // ──────────────────────────────────────────────────────────
  // 辅助函数
  // ──────────────────────────────────────────────────────────

  /**
   * 日志 ID 单调递增计数器引用
   * 使用 useRef 而非 useState，避免更新时触发不必要的重渲染
   */
  const logCounterRef = useRef(0);

  /**
   * 向日志列表追加一条新日志
   * @param message - 日志正文内容
   * @param level   - 日志级别，默认为 "info"
   *
   * 内部逻辑：
   * 1. 递增计数器，确保每条日志 ID 唯一
   * 2. 追加到现有列表末尾
   * 3. 若超出 500 条，截取最后 500 条（滑动窗口）
   */
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
      // 超出上限时截取，防止大量日志撑爆内存
      if (updated.length > 500) return updated.slice(updated.length - 500);
      return updated;
    });
  };

  const generateYaml = () => {
    if (testType === 'REST_API') {
      const headersObj: Record<string, string> = {};
      restHeaders.forEach(h => {
        if (h.key.trim()) headersObj[h.key.trim()] = h.value;
      });

      const paramsObj: Record<string, string> = {};
      restQueryParams.forEach(p => {
        if (p.key.trim()) paramsObj[p.key.trim()] = p.value;
      });

      const headersYaml = Object.entries(headersObj)
        .map(([k, v]) => `    ${k}: "${v.replace(/"/g, '\\"')}"`)
        .join("\n");
      const paramsYaml = Object.entries(paramsObj)
        .map(([k, v]) => `    ${k}: "${v.replace(/"/g, '\\"')}"`)
        .join("\n");

      return `test_type: REST_API

test:
  load_mode: ${config.loadMode}
  load_config:
${Object.entries(config.loadConfig)
  .map(([k, v]) => `    ${k}: ${v}`)
  .join("\n")}

protocol_config:
  url: "${restConfig.url}"
  method: ${restConfig.method}
  expectedStatus: ${restConfig.expectedStatus}
  bodyType: ${restConfig.bodyType}
  bodyContent: |
${(restConfig.bodyContent || "")
  .split("\n")
  .map(line => `    ${line}`)
  .join("\n")}
  headers:
${headersYaml ? headersYaml : "    {}"}
  queryParams:
${paramsYaml ? paramsYaml : "    {}"}

report:
  output_dir: ./my_reports
  name: rest_api_perf_test_report
`;
    }

    return `test_type: LLM

api:
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

  /**
   * 复制 YAML 配置到系统剪贴板
   * 成功后短暂显示"已复制"状态，2 秒后复原
   */
  const handleCopyYaml = () => {
    const yaml = generateYaml();
    navigator.clipboard.writeText(yaml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("配置已复制到剪贴板！");
  };

  /**
   * 将 YAML 配置以文件形式下载到本地
   * 创建临时 <a> 标签模拟点击，下载完毕后立即清理 DOM 和 ObjectURL
   */
  const handleDownloadYaml = () => {
    const yaml = generateYaml();
    const blob = new Blob([yaml], { type: "text/plain" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "config.yaml";
    document.body.appendChild(a);
    a.click();
    // 下载后立即回收资源，防止内存泄漏
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    toast.success("配置已下载！");
  };

  // ──────────────────────────────────────────────────────────
  // 核心测试执行逻辑
  // ──────────────────────────────────────────────────────────

  /**
   * 执行真实 LLM 性能测试（完整流程）
   *
   * 执行步骤：
   * 1. 前置校验：API Key 非空、输入数据非空
   * 2. 重置 UI 状态（清空日志、进度、结果）
   * 3. API 预检（checkApiHealth），确认连通性后再继续
   * 4. 提交测试任务（executeTest），获取任务 ID (resultId)
   * 5. 启动 1500ms 轮询（pollStatus），实时拉取日志和进度
   * 6. 收到 completed 状态时：展示结果摘要，刷新历史列表
   * 7. 收到 failed 状态时：提示错误，中断轮询
   */
  const executeRealTest = async () => {
    // 步骤 1：前置校验
    // 1.1 校验测试负载参数是否合法且为正整数
    const loadFields = Object.keys(config.loadConfig);
    const cleanLoadConfig: Record<string, number> = {};
    for (const key of loadFields) {
      const val = config.loadConfig[key];
      const parsedVal = parseInt(String(val), 10);
      if (val === "" || isNaN(parsedVal) || parsedVal <= 0) {
        toast.error(`测试参数「${key}」不能为空且必须是正整数`);
        return;
      }
      cleanLoadConfig[key] = parsedVal;
    }

    if (testType === "LLM") {
      if (!config.apiKey) {
        toast.error("请输入 API Key");
        return;
      }

      // 文本输入非空校验（trim 处理空白字符）
      const normalizedInputData =
        config.inputType === "text" ? config.inputData.trim() : config.inputData;

      if (config.inputType === "text" && !normalizedInputData) {
        toast.error("文本输入不能为空");
        return;
      }
    } else {
      if (!restConfig.url) {
        toast.error("请输入 API URL");
        return;
      }
      try {
        new URL(restConfig.url);
      } catch (e) {
        toast.error("请输入有效的 API URL (以 http:// 或 https:// 开头)");
        return;
      }
    }

    // 步骤 2：重置 UI 状态
    setIsRunning(true);
    setProgress(0);
    setLogs([]);
    setTestResults(null);

    // 步骤 3：API 预检 - 仅针对 LLM 压测，REST API 跳过 API 预检
    if (testType === "LLM") {
      addLog("🔍 正在进行 API 预检 (Pre-flight Ping)...", "info");
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
    }

    // 步骤 4：提交测试任务，获取 resultId
    addLog("🚀 Starting real performance test...", "info");
    addLog(`Test Type: ${testType}`, "info");
    if (testType === "LLM") {
      addLog(`Provider: ${config.apiProvider} | Model: ${config.model}`, "info");
    } else {
      addLog(`URL: ${restConfig.url} | Method: ${restConfig.method}`, "info");
    }
    const displayDuration = cleanLoadConfig.duration || (cleanLoadConfig.spike_duration + 20);
    addLog(
      `Load Mode: ${config.loadMode} | Duration: ${displayDuration}s`,
      "info"
    );
    addLog("", "info");

    try {
      let enqueueResult;
      if (testType === "LLM") {
        enqueueResult = await executeTestMutation.mutateAsync({
          testType: "LLM",
          apiProvider: config.apiProvider,
          apiUrl: config.apiUrl,
          apiKey: config.apiKey,
          model: config.model,
          loadMode: config.loadMode as "constant" | "ramp_up" | "fluctuate" | "spike",
          loadConfig: cleanLoadConfig,
          inputType: config.inputType as "text" | "image" | "json" | "video",
          inputData: config.inputType === "text" ? config.inputData.trim() : config.inputData,
          environmentId: selectedEnvId,
        });
      } else {
        const headers: Record<string, string> = {};
        restHeaders.forEach(h => {
          if (h.key.trim()) headers[h.key.trim()] = h.value;
        });

        const queryParams: Record<string, string> = {};
        restQueryParams.forEach(p => {
          if (p.key.trim()) queryParams[p.key.trim()] = p.value;
        });

        enqueueResult = await executeTestMutation.mutateAsync({
          testType: "REST_API",
          loadMode: config.loadMode as "constant" | "ramp_up" | "fluctuate" | "spike",
          loadConfig: cleanLoadConfig,
          protocolConfig: {
            url: restConfig.url,
            method: restConfig.method,
            headers,
            queryParams,
            bodyType: restConfig.bodyType,
            bodyContent: restConfig.bodyContent,
            expectedStatus: Number(restConfig.expectedStatus) || 200,
          },
        });
      }
      const resultId = enqueueResult.resultId;
      addLog(`[System] Task queued successfully. Job ID: ${resultId}`, "info");

      // 步骤 5：轮询状态 - 用于追踪日志和进度
      let currentLogIndex = 0; // 日志游标，避免重复拉取已处理的日志行

      await new Promise<void>((resolve, reject) => {
        const pollInterval = setInterval(async () => {
          try {
            const statusResult = await utils.test.pollStatus.fetch({
              resultId,
              fromLogIndex: currentLogIndex,
            });

            // 将新增日志行追加到前端日志面板
            if (statusResult.logs && statusResult.logs.length > 0) {
              statusResult.logs.forEach((logLine) => {
                // 根据日志内容中的关键字判断级别
                const isError = logLine.includes('❌') || logLine.includes('[ERROR]') || logLine.includes('failed:');
                const isSuccess = logLine.includes('✅') || logLine.includes('completed successfully') || logLine.includes('completed');
                const isWarning = logLine.includes('⚠️');
                const level = isError ? 'error' : isSuccess ? 'success' : isWarning ? 'warning' : 'info';

                // 若日志格式为 [HH:MM:SS] message，则只显示 message 部分
                const timeMatch = logLine.match(/^\[(.*?)\]\s*(.*)$/);
                if (timeMatch) {
                  addLog(timeMatch[2], level);
                } else {
                  addLog(logLine, level);
                }
              });
              // 更新日志游标，下次请求从此位置之后拉取
              currentLogIndex = statusResult.nextLogIndex;
            }

            // 更新进度条百分比
            setProgress(statusResult.progress);

            // 步骤 6：任务完成 - 展示摘要数据并刷新历史
            if (statusResult.status === 'completed' && statusResult.result) {
              clearInterval(pollInterval);
              setProgress(100);

              const result = statusResult.result;
              setTestResults(result);

              // 在日志面板中打印格式化的结果摘要
              addLog("", "info");
              addLog("═══════════════════════════════════════", "info");
              addLog("📊 TEST RESULTS SUMMARY", "info");
              addLog("═══════════════════════════════════════", "info");
              addLog(`Total Requests: ${result.totalRequests}`, "info");

              // 判断是否全部请求失败
              const isAllFailed = result.totalRequests > 0 && result.successfulRequests === 0;

              addLog(
                `Successful Requests: ${result.successfulRequests} (${result.successRate}%)`,
                isAllFailed ? "error" : "success"
              );

              if (isAllFailed) {
                addLog(`❌ 所有请求均失败 (Failed: ${result.totalRequests - result.successfulRequests})`, "error");
              }

              if (testType === "LLM") {
                addLog(`TTFT (Avg): ${result.ttftAvg}ms`, "info");
                addLog(`TTFT (P95): ${result.ttftP95}ms`, "info");
                addLog(`TTFT (P99): ${result.ttftP99}ms`, "info");
                addLog(`TPS (Avg): ${result.tpsAvg} tokens/sec`, "info");
                addLog(`ITL (Avg): ${result.itlAvg}ms`, "info");
              } else {
                addLog(`Avg Latency: ${result.avgLatency}ms`, "info");
                addLog(`P95 Latency: ${result.p95Latency}ms`, "info");
                const protocolMetrics = result.protocolMetrics as any;
                if (protocolMetrics && protocolMetrics.avgResponseSize !== undefined) {
                  const size = protocolMetrics.avgResponseSize;
                  const sizeStr = size > 1024 ? `${(size / 1024).toFixed(2)} KB` : `${size} Bytes`;
                  addLog(`Avg Response Size: ${sizeStr}`, "info");
                }
              }
              addLog(`QPS: ${result.qps} requests/sec`, "info");
              addLog("═══════════════════════════════════════", "info");

              if (isAllFailed) {
                // 全量失败时输出专家诊断信息
                addLog("⚠️ 测试运行完成，但业务请求全量异常！", "warning");
                if (result.analysis && result.analysis.length > 0) {
                  result.analysis.forEach((msg: string) => addLog(`[专家诊断] ${msg}`, "error"));
                }
                toast.error("核心请求全部失败，请查看专家诊断");
              } else {
                addLog("✅ Test completed successfully!", "success");
                toast.success("测试成功完成！");
              }

              // 使历史记录列表缓存失效，触发重新获取
              utils.test.getResults.invalidate();
              resolve();

            // 步骤 7：任务失败 - 展示错误信息并中断轮询
            } else if (statusResult.status === 'failed') {
              clearInterval(pollInterval);
              addLog(`❌ 测试运行失败: ${statusResult.error || '未知错误'}`, "error");
              toast.error(`测试执行失败: ${statusResult.error || '未知错误'}`);

              // 刷新历史记录（即使失败也记录了结果行）
              utils.test.getResults.invalidate();
              reject(new Error(statusResult.error));
            }
          } catch (e) {
            // 轮询过程中的网络错误不直接中断，等待下次重试
            console.error("Polling error:", e);
          }
        }, 1500); // 每 1.5 秒轮询一次，平衡实时性与服务端压力
      });
    } catch (error) {
      // 任务提交或轮询最终失败时的兜底错误处理
      addLog(
        `❌ 测试失败: ${error instanceof Error ? error.message : "未知错误"}`,
        "error"
      );
      toast.error("测试执行失败");
    } finally {
      // 无论成功或失败，最终都要关闭"运行中"状态
      setIsRunning(false);
    }
  };

  /**
   * 重置测试面板状态
   * 清空进度、日志、结果，恢复到初始状态
   * 注意：此操作不会重置 config（保留用户的配置输入）
   */
  const handleReset = () => {
    setProgress(0);
    setLogs([]);
    setTestResults(null);
    setIsRunning(false);
  };

  // ──────────────────────────────────────────────────────────
  // 报告导出函数
  // ──────────────────────────────────────────────────────────

  /**
   * 构建统一的报告载荷（config + results），并导出为 JSON 文件
   * 格式遵循 testReportExport 的 payload schema
   */
  const exportTestResultsJson = () => {
    if (!testResults) return;

    const payload = buildTestReportPayload(
      testType === "LLM"
        ? {
            apiProvider: config.apiProvider,
            apiUrl: config.apiUrl,
            model: config.model,
            loadMode: config.loadMode as "constant" | "ramp_up" | "fluctuate" | "spike",
            loadConfig: config.loadConfig,
            inputType: config.inputType as "text" | "image" | "json",
          }
        : {
            apiProvider: "REST_API",
            apiUrl: restConfig.url,
            model: restConfig.method,
            loadMode: config.loadMode as "constant" | "ramp_up" | "fluctuate" | "spike",
            loadConfig: config.loadConfig,
            inputType: "json" as any,
          },
      {
        ...testResults,
        testType,
        analysis: testResults.analysis ?? [],
      }
    );

    exportTestReportAsJson(payload);
    toast.success("测试结果已导出！");
  };

  /**
   * 导出测试报告为 PDF 格式
   * 使用 loading 状态防止用户重复点击导致多次触发
   */
  const exportTestResultsPdf = async () => {
    if (!testResults) return;

    const payload = buildTestReportPayload(
      testType === "LLM"
        ? {
            apiProvider: config.apiProvider,
            apiUrl: config.apiUrl,
            model: config.model,
            loadMode: config.loadMode as "constant" | "ramp_up" | "fluctuate" | "spike",
            loadConfig: config.loadConfig,
            inputType: config.inputType as "text" | "image" | "json",
          }
        : {
            apiProvider: "REST_API",
            apiUrl: restConfig.url,
            model: restConfig.method,
            loadMode: config.loadMode as "constant" | "ramp_up" | "fluctuate" | "spike",
            loadConfig: config.loadConfig,
            inputType: "json" as any,
          },
      {
        ...testResults,
        testType,
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

  /**
   * 导出测试报告为 Word (.docx) 格式
   * 使用 loading 状态防止用户重复点击导致多次触发
   */
  const exportTestResultsWord = async () => {
    if (!testResults) return;

    const payload = buildTestReportPayload(
      testType === "LLM"
        ? {
            apiProvider: config.apiProvider,
            apiUrl: config.apiUrl,
            model: config.model,
            loadMode: config.loadMode as "constant" | "ramp_up" | "fluctuate" | "spike",
            loadConfig: config.loadConfig,
            inputType: config.inputType as "text" | "image" | "json",
          }
        : {
            apiProvider: "REST_API",
            apiUrl: restConfig.url,
            model: restConfig.method,
            loadMode: config.loadMode as "constant" | "ramp_up" | "fluctuate" | "spike",
            loadConfig: config.loadConfig,
            inputType: "json" as any,
          },
      {
        ...testResults,
        testType,
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

  // ──────────────────────────────────────────────────────────
  // UI 辅助函数
  // ──────────────────────────────────────────────────────────

  /**
   * 根据日志级别返回对应的 Tailwind 文字颜色类名
   * @param level - 日志级别
   * @returns Tailwind CSS 类名字符串
   */
  const getLogColor = (level: string) => {
    switch (level) {
      case "success":
        return "text-green-500";
      case "warning":
        return "text-yellow-500";
      case "error":
        return "text-red-500";
      default:
        // 普通信息使用中性的 muted 色，减少视觉噪音
        return "text-muted-foreground";
    }
  };

  // ──────────────────────────────────────────────────────────
  // JSX 渲染
  // ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      {/* ── 顶部导航栏：固定吸顶，毛玻璃效果 ── */}
      <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="container flex items-center justify-between h-16">
          {/* Logo / 品牌名：点击返回首页 */}
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-lg font-bold hover:opacity-80 transition-opacity"
          >
            <Zap className="w-6 h-6 text-primary" />
            LLM Perf Portal
          </button>
          {/* 返回首页文字链接 */}
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
          {/* ── 页面头部：标题 + Tab 切换 ── */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-4xl font-bold mb-2">性能测试平台</h1>
              <p className="text-lg text-muted-foreground">
                创建、测试并导出您的性能测试配置
              </p>
            </div>
            {/* Tab 切换按钮组：生成器 / 历史记录 */}
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

          {/* ── 主内容区：根据 activeTab 条件渲染 ── */}
          {activeTab === "generator" ? (
            // 三列网格布局：左侧配置表单（1/3）+ 右侧预览与执行（2/3）
            <div className="grid lg:grid-cols-3 gap-8">

              {/* ── 左侧：配置表单面板 ── */}
              <div className="lg:col-span-1 space-y-6 lg:sticky lg:top-24 h-fit">

                {/* 测试类型选择 */}
                <div className="card-premium p-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setTestType("LLM")}
                    className={`flex-1 py-2 rounded-lg font-medium text-sm transition-all ${
                      testType === "LLM"
                        ? "bg-primary text-primary-foreground shadow"
                        : "text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    LLM 压测
                  </button>
                  <button
                    type="button"
                    onClick={() => setTestType("REST_API")}
                    className={`flex-1 py-2 rounded-lg font-medium text-sm transition-all ${
                      testType === "REST_API"
                        ? "bg-primary text-primary-foreground shadow"
                        : "text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    REST API 压测
                  </button>
                </div>

                {/* SUT 被测环境（对所有测试类型可见） */}
                <div className="card-premium p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-foreground">被测环境 (SUT)</h3>
                    <SutManager
                      selectedId={selectedEnvId}
                      onSelect={(id) => setSelectedEnvId(id)}
                      trigger={
                        <button className="text-sm font-semibold text-primary hover:opacity-80 transition-opacity">
                          管理环境
                        </button>
                      }
                    />
                  </div>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">选择环境</label>
                      <select
                        value={selectedEnvId || ""}
                        onChange={(e) => setSelectedEnvId(e.target.value ? Number(e.target.value) : undefined)}
                        disabled={isRunning}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                      >
                        <option value="">未选择 (仅采集客户端指标)</option>
                        {environments.map((env: any) => (
                          <option key={env.id} value={env.id}>
                            {env.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {selectedEnv ? (
                      <div className="p-4 bg-muted/30 border border-border/60 rounded-lg space-y-2 text-sm text-muted-foreground animate-fadeIn">
                        <div className="flex justify-between">
                          <span className="font-semibold text-foreground">{selectedEnv.name}</span>
                          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                            {selectedEnv.inferenceEngine}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-border/40">
                          <div>
                            <span className="block text-2xs text-muted-foreground/80">GPU 硬件</span>
                            <span className="font-medium text-foreground/80">
                              {selectedEnv.gpuCount}x {selectedEnv.gpuModel}
                            </span>
                          </div>
                          <div>
                            <span className="block text-2xs text-muted-foreground/80">量化格式</span>
                            <span className="font-medium text-foreground/80">{selectedEnv.quantization || "无"}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground bg-muted/10 p-3 rounded-lg border border-dashed border-border/80">
                        {testType === "LLM"
                          ? "💡 提示：关联被测环境后，系统将在压测时自动关联并采集 GPU 利用率、KV Cache 和 VRAM 占用等硬件时序指标。"
                          : "💡 提示：关联被测环境后，系统将自动记录测试所针对的目标服务器硬件信息，方便在对比报告中追溯。"}
                      </p>
                    )}
                  </div>
                </div>

                {testType === "LLM" ? (
                  /* LLM API 配置卡片 */
                  <div className="card-premium p-6">
                    <h3 className="text-lg font-bold mb-4">API 配置</h3>
                    <div className="space-y-4">
                      {/* 供应商选择器 */}
                      <div>
                        <label className="block text-sm font-medium mb-2">供应商</label>
                        <select
                          value={config.apiProvider}
                          onChange={e => setConfig({ ...config, apiProvider: e.target.value })}
                          disabled={isRunning}
                          className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                        >
                          <option value="openai">OpenAI</option>
                          <option value="anthropic">Anthropic</option>
                          <option value="custom">自定义</option>
                        </select>
                      </div>

                      {/* API 地址 */}
                      <div>
                        <label className="block text-sm font-medium mb-2">API 地址</label>
                        <input
                          type="text"
                          value={config.apiUrl}
                          onChange={e => setConfig({ ...config, apiUrl: e.target.value })}
                          disabled={isRunning}
                          className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                        />
                      </div>

                      {/* API 密钥 */}
                      <div>
                        <label className="block text-sm font-medium mb-2">API 密钥</label>
                        <input
                          type="password"
                          value={config.apiKey}
                          onChange={e => setConfig({ ...config, apiKey: e.target.value })}
                          disabled={isRunning}
                          placeholder="sk-..."
                          className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                        />
                      </div>

                      {/* 模型 */}
                      <div>
                        <label className="block text-sm font-medium mb-2">模型</label>
                        <input
                          type="text"
                          value={config.model}
                          onChange={e => setConfig({ ...config, model: e.target.value })}
                          disabled={isRunning}
                          className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                        />
                      </div>

                      {/* 输入类型 */}
                      <div>
                        <label className="block text-sm font-medium mb-2">输入类型</label>
                        <select
                          value={config.inputType}
                          onChange={e => {
                            const newType = e.target.value;
                            let defaultData = "";
                            if (newType === "text") {
                              defaultData = "Explain quantum computing in simple terms.";
                            } else if (newType === "image") {
                              defaultData = "https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=500";
                            } else if (newType === "video") {
                              defaultData = "https://www.w3schools.com/html/mov_bbb.mp4";
                            } else if (newType === "json") {
                              defaultData = '[\n  {\n    "role": "user",\n    "content": "Hello!"\n  }\n]';
                            }
                            setConfig({ ...config, inputType: newType, inputData: defaultData });
                          }}
                          disabled={isRunning}
                          className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                        >
                          <option value="text">文本 (Text)</option>
                          <option value="image">图片 (Image)</option>
                          <option value="video">视频 (Video)</option>
                          <option value="json">JSON</option>
                        </select>
                      </div>

                      {/* 输入数据联动显示 */}
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <label className="text-sm font-medium">输入数据</label>
                          {config.inputType === "json" && (
                            <div className="flex gap-2 items-center">
                              <span className={`text-2xs px-1.5 py-0.5 rounded font-medium ${
                                getJsonValidationStatus().isValid 
                                  ? "bg-green-500/10 text-green-500 border border-green-500/20" 
                                  : "bg-red-500/10 text-red-500 border border-red-500/20"
                              }`}>
                                {getJsonValidationStatus().isValid ? "✓ 有效 JSON" : "✗ 无效 JSON"}
                              </span>
                              <button
                                type="button"
                                onClick={handleFormatJson}
                                disabled={isRunning || !getJsonValidationStatus().isValid}
                                className="text-2xs font-semibold text-primary hover:underline disabled:opacity-50"
                              >
                                格式化
                              </button>
                            </div>
                          )}
                        </div>

                        {/* 文本输入模式 */}
                        {config.inputType === "text" && (
                          <div className="space-y-2">
                            <textarea
                              value={config.inputData}
                              onChange={e => setConfig({ ...config, inputData: e.target.value })}
                              disabled={isRunning}
                              rows={4}
                              placeholder="请输入您的 Prompt 文本..."
                              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm disabled:opacity-50 focus:ring-2 focus:ring-primary/20"
                            />
                            {/* 快捷推荐 */}
                            <div className="flex gap-1.5 flex-wrap">
                              {[
                                { label: "解释量子计算", text: "Explain quantum computing in simple terms." },
                                { label: "写一首短诗", text: "Write a short poem about artificial intelligence." },
                                { label: "分析冒泡排序", text: "Analyze the time and space complexity of Bubble Sort." }
                              ].map((chip, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => setConfig({ ...config, inputData: chip.text })}
                                  disabled={isRunning}
                                  className="text-2xs bg-muted/60 hover:bg-muted text-muted-foreground px-2 py-1 rounded transition-colors"
                                >
                                  {chip.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 图片输入模式 */}
                        {config.inputType === "image" && (
                          <div className="space-y-3">
                            {/* 文件上传拖拽区 */}
                            <div
                              onDragOver={handleDragOver}
                              onDragLeave={handleDragLeave}
                              onDrop={(e) => handleDrop(e, "image")}
                              className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-all ${
                                isDragOver 
                                  ? "border-primary bg-primary/5" 
                                  : "border-border hover:border-muted-foreground/50 bg-muted/10"
                              }`}
                              onClick={() => document.getElementById("image-file-input")?.click()}
                            >
                              <input
                                id="image-file-input"
                                type="file"
                                accept="image/*"
                                onChange={handleImageUpload}
                                className="hidden"
                                disabled={isRunning}
                              />
                              <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground/60" />
                              <p className="text-xs text-muted-foreground">
                                拖拽图片到此，或 <span className="text-primary font-medium">点击上传</span>
                              </p>
                              <p className="text-3xs text-muted-foreground/60 mt-1">支持 PNG, JPG, GIF，自动转换为 Base64</p>
                            </div>

                            {/* 在线 URL 输入 */}
                            <div>
                              <input
                                type="text"
                                value={config.inputData.startsWith("data:") ? "" : config.inputData}
                                onChange={e => setConfig({ ...config, inputData: e.target.value })}
                                disabled={isRunning}
                                placeholder="或者输入图片在线 URL..."
                                className="w-full px-3 py-1.5 text-xs rounded-lg border border-border bg-background disabled:opacity-50"
                              />
                            </div>

                            {/* 预览区域 */}
                            {config.inputData && (
                              <div className="relative group rounded-lg overflow-hidden border border-border bg-muted/20 p-2 flex items-center justify-center max-h-40">
                                <img
                                  src={config.inputData}
                                  alt="Image preview"
                                  className="max-h-36 object-contain rounded"
                                  onError={(e) => {
                                    (e.target as HTMLElement).style.display = "none";
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={() => setConfig({ ...config, inputData: "" })}
                                  disabled={isRunning}
                                  className="absolute top-2 right-2 bg-destructive text-destructive-foreground p-1 rounded-full shadow hover:opacity-95 transition-opacity"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}

                            {/* 快捷推荐 */}
                            <div className="flex gap-1.5 flex-wrap">
                              {[
                                { label: "猫咪图片", url: "https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=500" },
                                { label: "风景图片", url: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=500" }
                              ].map((chip, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => setConfig({ ...config, inputData: chip.url })}
                                  disabled={isRunning}
                                  className="text-2xs bg-muted/60 hover:bg-muted text-muted-foreground px-2 py-1 rounded transition-colors"
                                >
                                  {chip.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 视频输入模式 */}
                        {config.inputType === "video" && (
                          <div className="space-y-3">
                            {/* 文件上传拖拽区 */}
                            <div
                              onDragOver={handleDragOver}
                              onDragLeave={handleDragLeave}
                              onDrop={(e) => handleDrop(e, "video")}
                              className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-all ${
                                isDragOver 
                                  ? "border-primary bg-primary/5" 
                                  : "border-border hover:border-muted-foreground/50 bg-muted/10"
                              }`}
                              onClick={() => document.getElementById("video-file-input")?.click()}
                            >
                              <input
                                id="video-file-input"
                                type="file"
                                accept="video/*"
                                onChange={handleVideoUpload}
                                className="hidden"
                                disabled={isRunning}
                              />
                              <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground/60" />
                              <p className="text-xs text-muted-foreground">
                                拖拽视频到此，或 <span className="text-primary font-medium">点击上传</span>
                              </p>
                              <p className="text-3xs text-muted-foreground/60 mt-1">支持 MP4, WebM，自动转换为 Base64</p>
                            </div>

                            {/* 在线 URL 输入 */}
                            <div>
                              <input
                                type="text"
                                value={config.inputData.startsWith("data:") ? "" : config.inputData}
                                onChange={e => setConfig({ ...config, inputData: e.target.value })}
                                disabled={isRunning}
                                placeholder="或者输入视频在线 URL..."
                                className="w-full px-3 py-1.5 text-xs rounded-lg border border-border bg-background disabled:opacity-50"
                              />
                            </div>

                            {/* 预览区域 */}
                            {config.inputData && (
                              <div className="relative group rounded-lg overflow-hidden border border-border bg-muted/20 p-2 flex flex-col items-center justify-center max-h-56">
                                <video
                                  src={config.inputData}
                                  controls
                                  className="max-h-48 w-full object-contain rounded"
                                  onError={(e) => {
                                    (e.target as HTMLElement).style.display = "none";
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={() => setConfig({ ...config, inputData: "" })}
                                  disabled={isRunning}
                                  className="absolute top-2 right-2 bg-destructive text-destructive-foreground p-1 rounded-full shadow hover:opacity-95 transition-opacity z-10"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}

                            {/* 快捷推荐 */}
                            <div className="flex gap-1.5 flex-wrap">
                              {[
                                { label: "BBB 示例视频", url: "https://www.w3schools.com/html/mov_bbb.mp4" }
                              ].map((chip, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => setConfig({ ...config, inputData: chip.url })}
                                  disabled={isRunning}
                                  className="text-2xs bg-muted/60 hover:bg-muted text-muted-foreground px-2 py-1 rounded transition-colors"
                                >
                                  {chip.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* JSON 输入模式 */}
                        {config.inputType === "json" && (
                          <div className="space-y-2">
                            <textarea
                              value={config.inputData}
                              onChange={e => setConfig({ ...config, inputData: e.target.value })}
                              disabled={isRunning}
                              rows={6}
                              placeholder="请输入合法的 JSON 数据..."
                              className="w-full px-3 py-2 rounded-lg border border-border bg-background font-mono text-xs disabled:opacity-50 focus:ring-2 focus:ring-primary/20"
                            />
                            {/* 快捷推荐 */}
                            <div className="flex gap-1.5 flex-wrap">
                              {[
                                { label: "对话消息 JSON", text: '[\n  {\n    "role": "user",\n    "content": "Hello!"\n  }\n]' },
                                { label: "参数配置 JSON", text: '{\n  "temperature": 0.7,\n  "max_tokens": 100\n}' }
                              ].map((chip, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => setConfig({ ...config, inputData: chip.text })}
                                  disabled={isRunning}
                                  className="text-2xs bg-muted/60 hover:bg-muted text-muted-foreground px-2 py-1 rounded transition-colors"
                                >
                                  {chip.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* REST API 配置卡片 */
                  <div className="card-premium p-6">
                    <h3 className="text-lg font-bold mb-4">REST API 配置</h3>
                    <div className="space-y-4">
                      {/* API 地址 */}
                      <div>
                        <label className="block text-sm font-medium mb-2">API 地址 (URL)</label>
                        <input
                          type="text"
                          value={restConfig.url}
                          onChange={e => setRestConfig({ ...restConfig, url: e.target.value })}
                          disabled={isRunning}
                          placeholder="https://api.example.com/endpoint"
                          className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                        />
                      </div>

                      {/* HTTP 请求方法 */}
                      <div>
                        <label className="block text-sm font-medium mb-2">请求方法 (Method)</label>
                        <select
                          value={restConfig.method}
                          onChange={e => setRestConfig({ ...restConfig, method: e.target.value as any })}
                          disabled={isRunning}
                          className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                        >
                          <option value="GET">GET</option>
                          <option value="POST">POST</option>
                          <option value="PUT">PUT</option>
                          <option value="DELETE">DELETE</option>
                          <option value="PATCH">PATCH</option>
                        </select>
                      </div>

                      {/* 自定义 Headers 列表 */}
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <label className="text-sm font-medium">请求头 (Headers)</label>
                          <button
                            type="button"
                            onClick={() => setRestHeaders([...restHeaders, { key: "", value: "" }])}
                            disabled={isRunning}
                            className="text-xs font-semibold text-primary flex items-center gap-1 hover:opacity-80 transition-opacity"
                          >
                            <Plus className="w-3.5 h-3.5" /> 添加
                          </button>
                        </div>
                        <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                          {restHeaders.map((header, idx) => (
                            <div key={idx} className="flex gap-2 items-center">
                              <input
                                type="text"
                                placeholder="Key"
                                value={header.key}
                                onChange={e => {
                                  const updated = [...restHeaders];
                                  updated[idx].key = e.target.value;
                                  setRestHeaders(updated);
                                }}
                                disabled={isRunning}
                                className="flex-1 px-2 py-1 text-xs rounded border border-border bg-background"
                              />
                              <input
                                type="text"
                                placeholder="Value"
                                value={header.value}
                                onChange={e => {
                                  const updated = [...restHeaders];
                                  updated[idx].value = e.target.value;
                                  setRestHeaders(updated);
                                }}
                                disabled={isRunning}
                                className="flex-1 px-2 py-1 text-xs rounded border border-border bg-background"
                              />
                              <button
                                type="button"
                                onClick={() => setRestHeaders(restHeaders.filter((_, i) => i !== idx))}
                                disabled={isRunning}
                                className="text-destructive hover:bg-destructive/10 p-1 rounded"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                          {restHeaders.length === 0 && (
                            <p className="text-xs text-muted-foreground text-center py-2">暂无自定义请求头</p>
                          )}
                        </div>
                      </div>

                      {/* 查询参数 Query Params 列表 */}
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <label className="text-sm font-medium">查询参数 (Query Params)</label>
                          <button
                            type="button"
                            onClick={() => setRestQueryParams([...restQueryParams, { key: "", value: "" }])}
                            disabled={isRunning}
                            className="text-xs font-semibold text-primary flex items-center gap-1 hover:opacity-80 transition-opacity"
                          >
                            <Plus className="w-3.5 h-3.5" /> 添加
                          </button>
                        </div>
                        <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                          {restQueryParams.map((param, idx) => (
                            <div key={idx} className="flex gap-2 items-center">
                              <input
                                type="text"
                                placeholder="Key"
                                value={param.key}
                                onChange={e => {
                                  const updated = [...restQueryParams];
                                  updated[idx].key = e.target.value;
                                  setRestQueryParams(updated);
                                }}
                                disabled={isRunning}
                                className="flex-1 px-2 py-1 text-xs rounded border border-border bg-background"
                              />
                              <input
                                type="text"
                                placeholder="Value"
                                value={param.value}
                                onChange={e => {
                                  const updated = [...restQueryParams];
                                  updated[idx].value = e.target.value;
                                  setRestQueryParams(updated);
                                }}
                                disabled={isRunning}
                                className="flex-1 px-2 py-1 text-xs rounded border border-border bg-background"
                              />
                              <button
                                type="button"
                                onClick={() => setRestQueryParams(restQueryParams.filter((_, i) => i !== idx))}
                                disabled={isRunning}
                                className="text-destructive hover:bg-destructive/10 p-1 rounded"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                          {restQueryParams.length === 0 && (
                            <p className="text-xs text-muted-foreground text-center py-2">暂无自定义查询参数</p>
                          )}
                        </div>
                      </div>

                      {/* 请求体 (Request Body) */}
                      {restConfig.method !== "GET" && (
                        <div>
                          <div className="flex justify-between items-center mb-2">
                            <label className="text-sm font-medium">请求体 (Request Body)</label>
                            <select
                              value={restConfig.bodyType}
                              onChange={e => setRestConfig({ ...restConfig, bodyType: e.target.value as any })}
                              disabled={isRunning}
                              className="px-2 py-0.5 text-xs rounded border border-border bg-background"
                            >
                              <option value="json">JSON</option>
                              <option value="raw">Raw</option>
                            </select>
                          </div>
                          <textarea
                            value={restConfig.bodyContent}
                            onChange={e => setRestConfig({ ...restConfig, bodyContent: e.target.value })}
                            disabled={isRunning}
                            rows={4}
                            placeholder={restConfig.bodyType === "json" ? '{\n  "key": "value"\n}' : "Text content..."}
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background font-mono text-xs disabled:opacity-50"
                          />
                        </div>
                      )}

                      {/* 预期 HTTP 状态码 */}
                      <div>
                        <label className="block text-sm font-medium mb-2">
                          预期 HTTP 状态码
                        </label>
                        <input
                          type="text"
                          value={restConfig.expectedStatus}
                          onChange={e => {
                            // Only allow numeric input
                            const val = e.target.value;
                            if (val === "" || /^[0-9]+$/.test(val)) {
                              setRestConfig({ ...restConfig, expectedStatus: val === "" ? "" as any : parseInt(val, 10) });
                            }
                          }}
                          disabled={isRunning}
                          placeholder="200"
                          className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* 测试参数配置卡片 */}
                <div className="card-premium p-6">
                  <h3 className="text-lg font-bold mb-4">测试参数</h3>
                  <div className="space-y-4">

                    {/* 负载模式选择器：切换时同步更新 loadConfig 的默认参数 */}
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        负载模式
                      </label>
                      <select
                        value={config.loadMode}
                        onChange={e => {
                          const mode = e.target.value;
                          // 根据选择的模式提供合理的默认参数，避免用户手动清空，全部默认设定为 60
                          let defaultLoadConfig = {
                            concurrency: 60,
                            duration: 60,
                          };
                          if (mode === "ramp_up") {
                            defaultLoadConfig = {
                              start: 10,
                              end: 60,
                              step: 10,
                              duration: 60,
                            } as any;
                          } else if (mode === "fluctuate") {
                            defaultLoadConfig = {
                              min: 10,
                              max: 60,
                              period: 60,
                              duration: 60,
                            } as any;
                          } else if (mode === "spike") {
                            defaultLoadConfig = {
                              baseline: 10,
                              spike: 60,
                              spike_duration: 60,
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

                    {/* 恒定负载参数：并发数 + 持续时长 */}
                    {config.loadMode === "constant" && (
                      <>
                        <div>
                          <label className="block text-sm font-medium mb-2">
                            并发数
                          </label>
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={config.loadConfig.concurrency !== undefined ? String(config.loadConfig.concurrency) : ""}
                            onChange={e => {
                              const val = e.target.value;
                              if (val === "" || /^[0-9]+$/.test(val)) {
                                setConfig({
                                  ...config,
                                  loadConfig: {
                                    ...config.loadConfig,
                                    concurrency: val === "" ? "" : parseInt(val, 10),
                                  },
                                });
                              }
                            }}
                            disabled={isRunning}
                            placeholder="60"
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2">
                            时长 (秒)
                          </label>
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={config.loadConfig.duration !== undefined ? String(config.loadConfig.duration) : ""}
                            onChange={e => {
                              const val = e.target.value;
                              if (val === "" || /^[0-9]+$/.test(val)) {
                                setConfig({
                                  ...config,
                                  loadConfig: {
                                    ...config.loadConfig,
                                    duration: val === "" ? "" : parseInt(val, 10),
                                  },
                                });
                              }
                            }}
                            disabled={isRunning}
                            placeholder="60"
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                          />
                        </div>
                      </>
                    )}

                    {/* 阶梯增压参数：起始并发 / 目标并发 / 步长 / 总时长 */}
                    {config.loadMode === "ramp_up" && (
                      <>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-sm font-medium mb-2">
                              起始并发
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={config.loadConfig.start !== undefined ? String(config.loadConfig.start) : ""}
                              onChange={e => {
                                const val = e.target.value;
                                if (val === "" || /^[0-9]+$/.test(val)) {
                                  setConfig({
                                    ...config,
                                    loadConfig: {
                                      ...config.loadConfig,
                                      start: val === "" ? "" : parseInt(val, 10),
                                    },
                                  });
                                }
                              }}
                              disabled={isRunning}
                              placeholder="10"
                              className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2">
                              目标并发
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={config.loadConfig.end !== undefined ? String(config.loadConfig.end) : ""}
                              onChange={e => {
                                const val = e.target.value;
                                if (val === "" || /^[0-9]+$/.test(val)) {
                                  setConfig({
                                    ...config,
                                    loadConfig: {
                                      ...config.loadConfig,
                                      end: val === "" ? "" : parseInt(val, 10),
                                    },
                                  });
                                }
                              }}
                              disabled={isRunning}
                              placeholder="60"
                              className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2">
                              步长
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={config.loadConfig.step !== undefined ? String(config.loadConfig.step) : ""}
                              onChange={e => {
                                const val = e.target.value;
                                if (val === "" || /^[0-9]+$/.test(val)) {
                                  setConfig({
                                    ...config,
                                    loadConfig: {
                                      ...config.loadConfig,
                                      step: val === "" ? "" : parseInt(val, 10),
                                    },
                                  });
                                }
                              }}
                              disabled={isRunning}
                              placeholder="10"
                              className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2">
                            时长 (秒)
                          </label>
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={config.loadConfig.duration !== undefined ? String(config.loadConfig.duration) : ""}
                            onChange={e => {
                              const val = e.target.value;
                              if (val === "" || /^[0-9]+$/.test(val)) {
                                setConfig({
                                  ...config,
                                  loadConfig: {
                                    ...config.loadConfig,
                                    duration: val === "" ? "" : parseInt(val, 10),
                                  },
                                });
                              }
                            }}
                            disabled={isRunning}
                            placeholder="60"
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                          />
                        </div>
                      </>
                    )}

                    {/* 波动负载参数：最小并发 / 最大并发 / 周期时长 / 测试总时长 */}
                    {config.loadMode === "fluctuate" && (
                      <>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-sm font-medium mb-2">
                              最小并发
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={config.loadConfig.min !== undefined ? String(config.loadConfig.min) : ""}
                              onChange={e => {
                                const val = e.target.value;
                                if (val === "" || /^[0-9]+$/.test(val)) {
                                  setConfig({
                                    ...config,
                                    loadConfig: {
                                      ...config.loadConfig,
                                      min: val === "" ? "" : parseInt(val, 10),
                                    },
                                  });
                                }
                              }}
                              disabled={isRunning}
                              placeholder="10"
                              className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2">
                              最大并发
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={config.loadConfig.max !== undefined ? String(config.loadConfig.max) : ""}
                              onChange={e => {
                                const val = e.target.value;
                                if (val === "" || /^[0-9]+$/.test(val)) {
                                  setConfig({
                                    ...config,
                                    loadConfig: {
                                      ...config.loadConfig,
                                      max: val === "" ? "" : parseInt(val, 10),
                                    },
                                  });
                                }
                              }}
                              disabled={isRunning}
                              placeholder="60"
                              className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2">
                              周期时长 (秒)
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={config.loadConfig.period !== undefined ? String(config.loadConfig.period) : ""}
                              onChange={e => {
                                const val = e.target.value;
                                if (val === "" || /^[0-9]+$/.test(val)) {
                                  setConfig({
                                    ...config,
                                    loadConfig: {
                                      ...config.loadConfig,
                                      period: val === "" ? "" : parseInt(val, 10),
                                    },
                                  });
                                }
                              }}
                              disabled={isRunning}
                              placeholder="60"
                              className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2">
                            测试总时长 (秒)
                          </label>
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={config.loadConfig.duration !== undefined ? String(config.loadConfig.duration) : ""}
                            onChange={e => {
                              const val = e.target.value;
                              if (val === "" || /^[0-9]+$/.test(val)) {
                                setConfig({
                                  ...config,
                                  loadConfig: {
                                    ...config.loadConfig,
                                    duration: val === "" ? "" : parseInt(val, 10),
                                  },
                                });
                              }
                            }}
                            disabled={isRunning}
                            placeholder="60"
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                          />
                        </div>
                      </>
                    )}

                    {/* 突刺负载参数：基线并发 / 突刺并发 / 突刺持续时长 */}
                    {config.loadMode === "spike" && (
                      <>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-sm font-medium mb-2">
                              基线并发
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={config.loadConfig.baseline !== undefined ? String(config.loadConfig.baseline) : ""}
                              onChange={e => {
                                const val = e.target.value;
                                if (val === "" || /^[0-9]+$/.test(val)) {
                                  setConfig({
                                    ...config,
                                    loadConfig: {
                                      ...config.loadConfig,
                                      baseline: val === "" ? "" : parseInt(val, 10),
                                    },
                                  });
                                }
                              }}
                              disabled={isRunning}
                              placeholder="10"
                              className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2">
                              突刺并发
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={config.loadConfig.spike !== undefined ? String(config.loadConfig.spike) : ""}
                              onChange={e => {
                                const val = e.target.value;
                                if (val === "" || /^[0-9]+$/.test(val)) {
                                  setConfig({
                                    ...config,
                                    loadConfig: {
                                      ...config.loadConfig,
                                      spike: val === "" ? "" : parseInt(val, 10),
                                    },
                                  });
                                }
                              }}
                              disabled={isRunning}
                              placeholder="60"
                              className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2">
                              突刺时长 (秒)
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={config.loadConfig.spike_duration !== undefined ? String(config.loadConfig.spike_duration) : ""}
                              onChange={e => {
                                const val = e.target.value;
                                if (val === "" || /^[0-9]+$/.test(val)) {
                                  setConfig({
                                    ...config,
                                    loadConfig: {
                                      ...config.loadConfig,
                                      spike_duration: val === "" ? "" : parseInt(val, 10),
                                    },
                                  });
                                }
                              }}
                              disabled={isRunning}
                              placeholder="60"
                              className="w-full px-3 py-2 rounded-lg border border-border bg-background disabled:opacity-50"
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* ── 右侧：预览 & 执行面板 ── */}
              <div className="lg:col-span-2 space-y-6">

                {/* YAML 配置预览卡片：实时显示当前配置的 YAML 序列化结果 */}
                <div className="card-premium p-6">
                  <h3 className="text-lg font-bold mb-4">config.yaml 预览</h3>
                  <pre className="bg-muted/50 p-4 rounded-lg text-sm overflow-auto max-h-64 mb-4 border border-border">
                    {generateYaml()}
                  </pre>
                  {/* 操作按钮组：复制 + 下载 */}
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

                {/* 测试执行控制卡片 */}
                <div className="card-premium p-6">
                  <h3 className="text-lg font-bold mb-4">执行测试</h3>

                  {/* 执行 / 重置 按钮组 */}
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

                  {/* 进度条：仅在测试运行或有进度时显示 */}
                  {(isRunning || progress > 0) && (
                    <div className="mb-6">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-medium">进度</span>
                        {/* 全量失败时进度百分比显示为红色，并附加"(测试中断)"提示 */}
                        <span className={`text-sm font-semibold ${testResults && testResults.successfulRequests === 0 ? 'text-red-500' : 'text-primary'}`}>
                          {Math.round(progress)}% {testResults && testResults.successfulRequests === 0 && "(测试中断)"}
                        </span>
                      </div>
                      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                        {/* 进度条填充：失败为红色，正常为主色渐变 */}
                        <div
                          className={`h-full transition-all duration-300 ${testResults && testResults.successfulRequests === 0 ? 'bg-red-500' : 'bg-gradient-to-r from-primary to-blue-400'}`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* 测试结果摘要：仅在测试完成后显示 */}
                  {testResults && (
                    <>
                      {/* 全量失败时展示专家诊断预警块 */}
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

                      {/* 关键指标网格：6 个核心性能数据卡片 */}
                      <div className="grid grid-cols-2 gap-3 mt-6 pt-6 border-t border-border">
                        {/* 成功率 */}
                        <div className={`p-3 rounded-lg ${testResults.successfulRequests === 0 ? 'bg-red-500/5' : 'bg-primary/5'}`}>
                          <p className="text-xs text-muted-foreground">测试成功率</p>
                          <p className={`text-lg font-bold ${testResults.successfulRequests === 0 ? 'text-red-500' : 'text-primary'}`}>
                            {testResults.successRate}
                          </p>
                        </div>
                        {/* 阻断请求数 / 总请求数 */}
                        <div className={`p-3 rounded-lg ${testResults.successfulRequests === 0 ? 'bg-red-500/5' : 'bg-primary/5'}`}>
                          <p className="text-xs text-muted-foreground">阻断/总请求</p>
                          <p className={`text-lg font-bold ${testResults.successfulRequests === 0 ? 'text-red-500' : 'text-primary'}`}>
                            {testResults.totalRequests - testResults.successfulRequests} / {testResults.totalRequests}
                          </p>
                        </div>
                        {/* 平均首包时间 TTFT / 平均延迟 */}
                        <div className="bg-primary/5 p-3 rounded-lg">
                          <p className="text-xs text-muted-foreground">
                            {testType === "LLM" ? "Avg TTFT" : "平均延迟 (Avg Latency)"}
                          </p>
                          <p className="text-lg font-bold text-primary">
                            {testType === "LLM" ? `${testResults.ttftAvg}ms` : `${testResults.avgLatency}ms`}
                          </p>
                        </div>
                        {/* P95 首包时间 TTFT / P95 延迟 */}
                        <div className="bg-primary/5 p-3 rounded-lg">
                          <p className="text-xs text-muted-foreground">
                            {testType === "LLM" ? "P95 TTFT" : "P95 延迟 (P95 Latency)"}
                          </p>
                          <p className="text-lg font-bold text-primary">
                            {testType === "LLM" ? `${testResults.ttftP95}ms` : `${testResults.p95Latency}ms`}
                          </p>
                        </div>
                        {/* 平均 Token 生成速率 TPS / 平均响应大小 */}
                        <div className="bg-primary/5 p-3 rounded-lg">
                          <p className="text-xs text-muted-foreground">
                            {testType === "LLM" ? "Avg TPS" : "平均响应大小 (Response Size)"}
                          </p>
                          <p className="text-lg font-bold text-primary">
                            {testType === "LLM" 
                              ? testResults.tpsAvg 
                              : (testResults.protocolMetrics?.avgResponseSize !== undefined
                                  ? (testResults.protocolMetrics.avgResponseSize > 1024
                                      ? `${(testResults.protocolMetrics.avgResponseSize / 1024).toFixed(2)} KB`
                                      : `${testResults.protocolMetrics.avgResponseSize} Bytes`)
                                  : "N/A")}
                          </p>
                        </div>
                        {/* 每秒请求数 QPS */}
                        <div className="bg-primary/5 p-3 rounded-lg">
                          <p className="text-xs text-muted-foreground">QPS</p>
                          <p className="text-lg font-bold text-primary">
                            {testResults.qps}
                          </p>
                        </div>
                      </div>

                      {/* 报告导出按钮组：JSON / PDF / Word / 查看详细报告 */}
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
                        {/* 查看详细报告按钮：仅当结果有 id 时显示 */}
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

                {/* 实时日志面板：仅在有日志时显示，使用等宽字体提升可读性 */}
                {logs.length > 0 && (
                  <div className="card-premium p-6">
                    <h3 className="text-lg font-bold mb-4">实时日志</h3>
                    <div className="bg-muted/30 rounded-lg p-4 h-64 overflow-y-auto border border-border font-mono text-sm">
                      {logs.map(log => (
                        <div key={log.id} className="mb-1 flex gap-2">
                          {/* 时间戳列（固定宽度，不换行） */}
                          <span className="text-muted-foreground flex-shrink-0">
                            [{log.timestamp}]
                          </span>
                          {/* 级别图标列 */}
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
                          {/* 日志正文列（允许换行以显示完整长内容） */}
                          <span className={`break-words ${log.level === 'error' ? 'text-red-500 font-medium' : log.level === 'warning' ? 'text-yellow-500 font-medium' : 'text-foreground'}`}>
                            {log.message}
                          </span>
                        </div>
                      ))}
                      {/* 滚动锚点：logs 更新后触发 scrollIntoView */}
                      <div ref={logsEndRef} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            // 历史记录 Tab
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

// ──────────────────────────────────────────────────────────
// 子组件：测试历史记录面板
// ──────────────────────────────────────────────────────────

/**
 * TestHistoryPanel
 * 负责展示历史测试结果列表，支持：
 * - 多选对比（≥2 个结果）→ 跳转比对页
 * - 单项查看详情 → 跳转 Dashboard
 * - 单项删除（带乐观更新）
 */
function TestHistoryPanel() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  /** 获取所有历史测试结果列表（自动缓存、后台刷新） */
  const { data: testResults = [], isLoading } = trpc.test.getResults.useQuery();

  /** 删除指定历史结果的 Mutation */
  const deleteResultMutation = trpc.test.deleteResult.useMutation();

  /** 用于多选对比的已选结果 ID 列表 */
  const [selectedResults, setSelectedResults] = useState<number[]>([]);

  /**
   * 删除单条测试结果
   * 成功后：
   * 1. 提示删除成功
   * 2. 从 selectedResults 中移除该 ID（防止残留无效选择）
   * 3. 使 getResults 缓存失效，触发重新拉取
   */
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

  /**
   * 跳转到多结果对比页面
   * 要求至少选择 2 个结果，URL 参数格式：?ids=1,2,3
   */
  const handleCompare = () => {
    if (selectedResults.length < 2) {
      toast.error("请至少选择两个结果来进行对比");
      return;
    }
    navigate(`/comparison?ids=${selectedResults.join(",")}`);
  };

  // 加载中状态
  if (isLoading) {
    return <div className="text-center py-8">正在加载测试历史...</div>;
  }

  // 空状态
  if (testResults.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">暂无测试结果</div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 对比按钮：未选满 2 项时禁用 */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={handleCompare}
          disabled={selectedResults.length < 2}
          className="button-secondary flex-1 disabled:opacity-50"
        >
          对比所选项 ({selectedResults.length})
        </button>
      </div>

      {/* 历史结果列表 */}
      <div className="space-y-2">
        {testResults.map((result: any) => (
          <div
            key={result.id}
            className="flex items-center gap-3 p-3 border border-border rounded-lg"
          >
            {/* 多选复选框 */}
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

            {/* 结果信息：名称、时间、关键指标 */}
            <div className="flex-1">
              <p className="font-medium">
                {result.name || result.model || `Test #${result.id}`}
              </p>
              <p className="text-sm text-muted-foreground">
                {new Date(result.createdAt).toLocaleString()} - {result.status}
              </p>
              {/* 已完成的测试展示核心指标摘要 */}
              {result.status === "completed" && (
                <p className="text-sm">
                  {result.testType === "REST_API"
                    ? `Avg RT: ${result.avgLatency}ms | P95: ${result.p95Latency}ms | QPS: ${result.qps}`
                    : `TTFT: ${result.ttftAvg}ms | TPS: ${result.tpsAvg} | QPS: ${result.qps}`}
                </p>
              )}
            </div>

            {/* 操作按钮：查看详情（仅已完成）+ 删除 */}
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
