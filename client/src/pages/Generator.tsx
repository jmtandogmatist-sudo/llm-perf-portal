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
  X,
  Activity,
  CheckCircle2,
  Terminal,
  Settings,
  History,
  TrendingUp,
  FileJson,
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
import YAML from "yaml";
import { motion, AnimatePresence } from "framer-motion";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ChartTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

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
// 子组件：SVG 负载曲线生成器
// ──────────────────────────────────────────────────────────
function LoadCurveVisualizer({ loadMode }: { loadMode: string }) {
  let path = "";
  let label = "";
  
  if (loadMode === "constant") {
    path = "M 10,40 L 190,40";
    label = "恒定负载 (Constant)";
  } else if (loadMode === "ramp_up") {
    path = "M 10,70 L 190,20";
    label = "阶梯增压 (Ramp Up)";
  } else if (loadMode === "fluctuate") {
    const points = [];
    for (let x = 10; x <= 190; x++) {
      const y = 45 + Math.sin((x - 10) * 0.05) * 20;
      points.push(`${x},${y}`);
    }
    path = `M ${points.join(" L ")}`;
    label = "波动负载 (Fluctuate)";
  } else if (loadMode === "spike") {
    path = "M 10,70 L 70,70 L 100,20 L 130,70 L 190,70";
    label = "突刺负载 (Spike)";
  }

  return (
    <div className="flex flex-col items-center p-3 bg-muted/30 rounded-xl border border-border/40 w-full animate-fadeIn">
      <svg width="100%" height="80" viewBox="0 0 200 80" className="stroke-primary fill-none stroke-2">
        <line x1="10" y1="10" x2="190" y2="10" stroke="var(--border)" strokeWidth="0.5" strokeDasharray="2,2" />
        <line x1="10" y1="40" x2="190" y2="40" stroke="var(--border)" strokeWidth="0.5" strokeDasharray="2,2" />
        <line x1="10" y1="70" x2="190" y2="70" stroke="var(--border)" strokeWidth="0.5" strokeDasharray="2,2" />
        <path d={path} className="transition-all duration-500 ease-in-out drop-shadow-[0_2px_4px_rgba(59,130,246,0.35)]" />
      </svg>
      <span className="text-2xs font-semibold text-muted-foreground mt-2">{label}</span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// 子组件：压测结果时序折线图
// ──────────────────────────────────────────────────────────
function PerformanceCharts({ resultId, testType }: { resultId: number; testType: "LLM" | "REST_API" }) {
  const { data: timeseriesData = [], isLoading } = trpc.test.getMetricsTimeseries.useQuery(
    { resultId },
    { enabled: !!resultId }
  );

  if (isLoading) {
    return <div className="text-center py-8 text-sm text-muted-foreground">正在加载性能时序数据...</div>;
  }

  if (timeseriesData.length === 0) {
    return null;
  }

  // 将数据按照10步转换格式
  const chartData = timeseriesData.map((pt: any, index: number) => {
    const elapsed = index * 10;
    return {
      name: `${elapsed}%`,
      latency: pt.latency,
      ttft: pt.ttft,
      tps: pt.tps,
      gpu: pt.gpuUtilization,
      vram: pt.vramUsage,
      kvCache: pt.kvCacheUsage,
    };
  });

  return (
    <div className="grid md:grid-cols-2 gap-6 mt-6">
      {/* 性能趋势图 */}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-purple-500" />
            性能与吞吐时序演进
          </CardTitle>
          <CardDescription className="text-xs">延迟与并发吞吐量随测试进度的波动曲线</CardDescription>
        </CardHeader>
        <CardContent className="h-64 text-2xs">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
              <XAxis dataKey="name" stroke="var(--muted-foreground)" />
              <YAxis yAxisId="left" stroke="#8b5cf6" label={{ value: '延迟 (ms)', angle: -90, position: 'insideLeft', style: { fill: '#8b5cf6' } }} />
              <YAxis yAxisId="right" orientation="right" stroke="#10b981" label={{ value: testType === 'LLM' ? 'TPS (Tokens/s)' : 'QPS (Req/s)', angle: 90, position: 'insideRight', style: { fill: '#10b981' } }} />
              <ChartTooltip contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', color: 'var(--foreground)' }} />
              <Legend verticalAlign="top" height={36} />
              <Line yAxisId="left" type="monotone" dataKey="latency" name="平均延迟" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              {testType === "LLM" && (
                <Line yAxisId="left" type="monotone" dataKey="ttft" name="首字延迟 (TTFT)" stroke="#ec4899" strokeWidth={1.5} strokeDasharray="3 3" dot={{ r: 2 }} />
              )}
              <Line yAxisId="right" type="monotone" dataKey="tps" name={testType === 'LLM' ? 'TPS' : 'QPS'} stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* 硬件资源监控图 (仅针对 LLM 且有 SUT 收集时) */}
      {testType === "LLM" && chartData.some(d => d.gpu !== null) && (
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Activity className="w-4 h-4 text-orange-500" />
              SUT 硬件资源负荷占用
            </CardTitle>
            <CardDescription className="text-xs">被测显卡 GPU 利用率、显存及 KV Cache 的健康指标</CardDescription>
          </CardHeader>
          <CardContent className="h-64 text-2xs">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
                <XAxis dataKey="name" stroke="var(--muted-foreground)" />
                <YAxis stroke="var(--muted-foreground)" unit="%" />
                <ChartTooltip contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', color: 'var(--foreground)' }} />
                <Legend verticalAlign="top" height={36} />
                <Line type="monotone" dataKey="gpu" name="GPU 利用率" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="vram" name="VRAM 显存" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="kvCache" name="KV Cache" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// 主组件：性能测试生成器
// ──────────────────────────────────────────────────────────
export default function Generator() {
  const [, navigate] = useLocation();

  // 解析 URL 中的克隆配置 ID 参数 (cloneId)
  const cloneIdStr = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("cloneId") : null;
  const cloneId = cloneIdStr ? Number(cloneIdStr) : null;

  // ── UI 状态 ──────────────────────────────────────────────
  const [copied, setCopied] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [testResults, setTestResults] = useState<any>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingWord, setIsExportingWord] = useState(false);

  // 双向绑定的 YAML 状态
  const [yamlText, setYamlText] = useState("");
  const [yamlError, setYamlError] = useState<string | null>(null);
  const isEditingYamlRef = useRef(false);

  // 运行中的 Result ID (用于中止)
  const [runningResultId, setRunningResultId] = useState<number | null>(null);

  // API 连通性测试状态
  const [apiHealthStatus, setApiHealthStatus] = useState<"idle" | "testing" | "success" | "failed">("idle");
  const [apiHealthError, setApiHealthError] = useState<string | null>(null);

  // 工作区 Tab 激活状态 ("config" | "run" | "history")
  const [workspaceTab, setWorkspaceTab] = useState<string>("config");

  // ── 测试配置状态 ─────────────────────────────────────────
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
  const executeTestMutation = trpc.test.executeTest.useMutation();
  const checkApiHealthMutation = trpc.test.checkApiHealth.useMutation();
  const abortTestMutation = trpc.test.abortTest.useMutation();
  const { data: cloneData } = trpc.test.getResult.useQuery(
    { resultId: cloneId ?? 0 },
    { enabled: !!cloneId }
  );
  const utils = trpc.useUtils();

  // ──────────────────────────────────────────────────────────
  // 副作用与 YAML 同步
  // ──────────────────────────────────────────────────────────

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // 从输入参数自动生成 YAML
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
    data: "${config.inputData.replace(/"/g, '\\"')}"

report:
  output_dir: ./my_reports
  name: llm_perf_test_report
`;
  };

  // 表单状态更新时，自动同步至 YAML 编辑器 (排除手动编辑状态)
  useEffect(() => {
    if (!isEditingYamlRef.current) {
      setYamlText(generateYaml());
      setYamlError(null);
    }
  }, [
    testType,
    config.apiProvider,
    config.apiUrl,
    config.apiKey,
    config.model,
    config.loadMode,
    config.loadConfig,
    config.inputType,
    config.inputData,
    restConfig,
    restHeaders,
    restQueryParams,
  ]);

  // YAML 改变的双向同步校验和逻辑
  const handleYamlChange = (val: string) => {
    setYamlText(val);
    try {
      const parsed = YAML.parse(val);
      if (!parsed) return;
      setYamlError(null);

      if (parsed.test_type === "LLM" || parsed.test_type === "REST_API") {
        setTestType(parsed.test_type);
      }

      if (parsed.test_type === "LLM") {
        setConfig(prev => ({
          ...prev,
          apiProvider: parsed.api?.provider || prev.apiProvider,
          apiUrl: parsed.api?.url || prev.apiUrl,
          apiKey: parsed.api?.key || prev.apiKey,
          model: parsed.api?.model || prev.model,
          loadMode: parsed.test?.load_mode || prev.loadMode,
          loadConfig: parsed.test?.load_config || prev.loadConfig,
          inputType: parsed.test?.input?.type || prev.inputType,
          inputData: parsed.test?.input?.data || prev.inputData,
        }));
      } else if (parsed.test_type === "REST_API") {
        const proto = parsed.protocol_config;
        if (proto) {
          setRestConfig(prev => ({
            ...prev,
            url: proto.url || prev.url,
            method: proto.method || prev.method,
            bodyType: proto.bodyType || prev.bodyType,
            bodyContent: proto.bodyContent || prev.bodyContent,
            expectedStatus: proto.expectedStatus !== undefined ? proto.expectedStatus : prev.expectedStatus,
          }));

          if (proto.headers) {
            const arr = Object.entries(proto.headers).map(([key, value]) => ({
              key,
              value: String(value),
            }));
            setRestHeaders(arr.length > 0 ? arr : [{ key: "", value: "" }]);
          }

          if (proto.queryParams) {
            const arr = Object.entries(proto.queryParams).map(([key, value]) => ({
              key,
              value: String(value),
            }));
            setRestQueryParams(arr.length > 0 ? arr : [{ key: "", value: "" }]);
          }
        }

        setConfig(prev => ({
          ...prev,
          loadMode: parsed.test?.load_mode || prev.loadMode,
          loadConfig: parsed.test?.load_config || prev.loadConfig,
        }));
      }
    } catch (err: any) {
      setYamlError(err.message || "YAML 格式不正确");
    }
  };

  /**
   * 自动克隆配置逻辑
   */
  useEffect(() => {
    if (!cloneData) return;

    const configData = cloneData.config;
    if (!configData) {
      toast.error("未找到对应的测试配置快照，无法克隆");
      return;
    }

    const clonedTestType = cloneData.testType as "LLM" | "REST_API";
    setTestType(clonedTestType);
    setSelectedEnvId(cloneData.environmentId || undefined);

    if (clonedTestType === "LLM") {
      setConfig({
        apiProvider: configData.apiProvider || "openai",
        apiUrl: configData.apiUrl || "",
        apiKey: "",
        model: configData.model || "",
        loadMode: configData.loadMode || "constant",
        loadConfig: configData.loadConfig || { concurrency: 60, duration: 60 },
        inputType: configData.inputType || "text",
        inputData: configData.inputData || "",
      });
      toast.success(`已克隆 LLM 压测配置（模型: ${configData.model}），请检查后输入 API Key 执行`);
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

        if (protocol.headers) {
          const headersArray = Object.entries(protocol.headers).map(([key, value]) => ({
            key,
            value: String(value),
          }));
          setRestHeaders(headersArray.length > 0 ? headersArray : [{ key: "Content-Type", value: "application/json" }]);
        } else {
          setRestHeaders([{ key: "Content-Type", value: "application/json" }]);
        }

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

      setConfig(prev => ({
        ...prev,
        loadMode: configData.loadMode || "constant",
        loadConfig: configData.loadConfig || { concurrency: 60, duration: 60 },
      }));

      toast.success(`已克隆 REST API 压测配置（接口: ${protocol?.url || ''}）`);
    }

    setWorkspaceTab("config");

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("cloneId");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, [cloneData]);

  // ── 辅助函数 ──────────────────────────────────────────

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

  const handleCopyYaml = () => {
    navigator.clipboard.writeText(yamlText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("配置已复制到剪贴板！");
  };

  const handleDownloadYaml = () => {
    const blob = new Blob([yamlText], { type: "text/plain" });
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

  // ── API 健康性前置校验 ──────────────────────────────────────
  const testApiConnection = async () => {
    if (!config.apiUrl) {
      toast.error("请输入 API 接口地址");
      return;
    }
    setApiHealthStatus("testing");
    setApiHealthError(null);
    try {
      const healthCheck = await checkApiHealthMutation.mutateAsync({
        apiProvider: config.apiProvider,
        apiUrl: config.apiUrl,
        apiKey: config.apiKey || "dummy-key-check",
        model: config.model,
      });

      if (healthCheck.ok) {
        setApiHealthStatus("success");
        toast.success("API 网关连通性测试通过！");
      } else {
        setApiHealthStatus("failed");
        setApiHealthError(healthCheck.error || "未通过连通性测试");
        toast.error(`接口连通测试失败: ${healthCheck.error}`);
      }
    } catch (e: any) {
      setApiHealthStatus("failed");
      setApiHealthError(e.message || "测试请求抛错，请检查网络");
      toast.error("接口连通测试异常");
    }
  };

  // ── 一键中止测试逻辑 ──────────────────────────────────────
  const handleAbort = async () => {
    if (!runningResultId) return;
    try {
      const res = await abortTestMutation.mutateAsync({ resultId: runningResultId });
      if (res.success) {
        toast.success("中止指令已下发，正在优雅停机...");
        setIsRunning(false);
        setRunningResultId(null);
      } else {
        toast.error("无法中止测试: " + (res.success === false ? "测试不在运行中" : "未知原因"));
      }
    } catch (e: any) {
      toast.error(`中止请求异常: ${e.message || e}`);
    }
  };

  // ── 核心测试执行逻辑 ──────────────────────────────────────────

  const executeRealTest = async () => {
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

    // 重置 UI 状态，并切入“监控终端”
    setIsRunning(true);
    setProgress(0);
    setLogs([]);
    setTestResults(null);
    setWorkspaceTab("run");

    // 步骤 3：API 预检 (仅针对 LLM)
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
          toast.error("API 连通性检查未通过，请检查网关或模型状态");
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
      setRunningResultId(resultId);
      addLog(`[System] Task queued successfully. Job ID: ${resultId}`, "info");

      let currentLogIndex = 0;

      await new Promise<void>((resolve, reject) => {
        const pollInterval = setInterval(async () => {
          try {
            const statusResult = await utils.test.pollStatus.fetch({
              resultId,
              fromLogIndex: currentLogIndex,
            });

            if (statusResult.logs && statusResult.logs.length > 0) {
              statusResult.logs.forEach((logLine) => {
                const isError = logLine.includes('❌') || logLine.includes('[ERROR]') || logLine.includes('failed:');
                const isSuccess = logLine.includes('✅') || logLine.includes('completed successfully') || logLine.includes('completed');
                const isWarning = logLine.includes('⚠️');
                const level = isError ? 'error' : isSuccess ? 'success' : isWarning ? 'warning' : 'info';

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
              setRunningResultId(null);

              const result = statusResult.result;
              setTestResults(result);

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
                addLog("⚠️ 测试运行完成，但业务请求全量异常！", "warning");
                if (result.analysis && result.analysis.length > 0) {
                  result.analysis.forEach((msg: string) => addLog(`[专家诊断] ${msg}`, "error"));
                }
                toast.error("核心请求全部失败，请查看专家诊断");
              } else {
                addLog("✅ Test completed successfully!", "success");
                toast.success("测试成功完成！");
              }

              utils.test.getResults.invalidate();
              resolve();
            } else if (statusResult.status === 'failed') {
              clearInterval(pollInterval);
              setRunningResultId(null);
              addLog(`❌ 测试运行失败: ${statusResult.error || '未知错误'}`, "error");
              toast.error(`测试执行失败: ${statusResult.error || '未知错误'}`);

              utils.test.getResults.invalidate();
              reject(new Error(statusResult.error));
            } else if (statusResult.status === 'aborted') {
              clearInterval(pollInterval);
              setRunningResultId(null);
              addLog(`⏹️ 测试运行被用户主动中止`, "warning");
              toast.warning("测试运行被用户主动中止");
              utils.test.getResults.invalidate();
              resolve();
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
    setRunningResultId(null);
    setApiHealthStatus("idle");
    setApiHealthError(null);
  };

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

  const getLogColor = (level: string) => {
    switch (level) {
      case "success":
        return "text-green-500";
      case "warning":
        return "text-yellow-500 font-semibold";
      case "error":
        return "text-red-500 font-semibold";
      default:
        return "text-muted-foreground";
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors duration-300">
      {/* ── 顶部导航栏 ── */}
      <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/40 transition-all duration-200">
        <div className="container flex items-center justify-between h-16">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-lg font-bold hover:opacity-85 transition-opacity"
          >
            <Zap className="w-6 h-6 text-primary animate-pulse" />
            LLM Perf Portal
          </button>
          <Button
            variant="ghost"
            onClick={() => navigate("/")}
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            返回首页
          </Button>
        </div>
      </nav>

      <div className="container py-8 max-w-7xl">
        {/* ── 页面头部 ── */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8 gap-4">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-primary via-blue-500 to-indigo-600 bg-clip-text text-transparent">
              压测生成控制台
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              创建压测计划，支持双向同步 YAML 代码，监控硬件时序指标，并一键导出硅谷级对比报告。
            </p>
          </div>
          <div className="flex gap-2 bg-muted p-1 rounded-lg w-fit">
            <Button
              variant={workspaceTab !== "history" ? "secondary" : "ghost"}
              onClick={() => setWorkspaceTab("config")}
              className="text-xs font-semibold"
            >
              配置生成器
            </Button>
            <Button
              variant={workspaceTab === "history" ? "secondary" : "ghost"}
              onClick={() => setWorkspaceTab("history")}
              className="text-xs font-semibold"
            >
              历史分析库
            </Button>
          </div>
        </div>

        {/* ── 核心工作区：左右双栏切分 ── */}
        <div className="grid lg:grid-cols-12 gap-8">
          
          {/* 左侧：精简核心控制台 (1/3 宽度) */}
          <div className="lg:col-span-4 space-y-6">
            
            {/* 核心动作卡片 */}
            <Card className="card-premium border-primary/20 shadow-md">
              <CardHeader className="pb-4">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Activity className="w-5 h-5 text-primary" />
                  压测快速控制面板
                </CardTitle>
                <CardDescription className="text-2xs">一键启动或中止真实的接口吞吐压测</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col gap-2">
                  {!isRunning ? (
                    <Button
                      onClick={executeRealTest}
                      disabled={executeTestMutation.isPending}
                      className="w-full bg-gradient-to-r from-primary to-blue-600 hover:from-primary/95 hover:to-blue-600/95 shadow-md hover:shadow-lg transition-all text-white font-bold h-11 relative overflow-hidden group"
                    >
                      <Play className="w-4 h-4 mr-2" />
                      运行真实压测
                      <span className="absolute inset-0 w-full h-full bg-white/10 transform -skew-x-12 -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                    </Button>
                  ) : (
                    <Button
                      onClick={handleAbort}
                      variant="destructive"
                      className="w-full animate-pulse font-bold h-11"
                    >
                      <Square className="w-4 h-4 mr-2 fill-white" />
                      中止当前压测
                    </Button>
                  )}
                  
                  <Button
                    onClick={handleReset}
                    variant="outline"
                    disabled={isRunning}
                    className="w-full"
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    重置面板数据
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* SUT 关联探针 */}
            <Card className="card-premium">
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold">被测环境 (SUT)</CardTitle>
                  <CardDescription className="text-2xs">物理主机与推理框架硬件采集</CardDescription>
                </div>
                <SutManager
                  selectedId={selectedEnvId}
                  onSelect={(id) => setSelectedEnvId(id)}
                  trigger={
                    <Button variant="link" className="text-xs font-semibold text-primary p-0 h-auto">
                      管理环境
                    </Button>
                  }
                />
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <Select
                    value={selectedEnvId ? String(selectedEnvId) : "none"}
                    onValueChange={(val) => setSelectedEnvId(val === "none" ? undefined : Number(val))}
                    disabled={isRunning}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="未选择 (仅采集客户端指标)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">未选择 (仅采集客户端指标)</SelectItem>
                      {environments.map((env: any) => (
                        <SelectItem key={env.id} value={String(env.id)}>
                          {env.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <AnimatePresence mode="wait">
                    {selectedEnv ? (
                      <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        className="p-3.5 bg-green-500/5 border border-green-500/15 rounded-xl space-y-2 text-xs text-muted-foreground"
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-foreground flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                            SUT 探针就绪
                          </span>
                          <Badge variant="secondary" className="text-3xs px-2 py-0">
                            {selectedEnv.inferenceEngine}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-2xs pt-1.5 border-t border-border/40">
                          <div>
                            <span className="block text-muted-foreground/75">GPU 硬件规格</span>
                            <span className="font-semibold text-foreground/85">
                              {selectedEnv.gpuCount}x {selectedEnv.gpuModel}
                            </span>
                          </div>
                          <div>
                            <span className="block text-muted-foreground/75">推理量化</span>
                            <span className="font-semibold text-foreground/85">{selectedEnv.quantization || "无"}</span>
                          </div>
                        </div>
                      </motion.div>
                    ) : (
                      <div className="p-3 bg-muted/20 border border-dashed border-border rounded-xl text-center text-xs text-muted-foreground">
                        <span className="flex items-center justify-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5 text-muted-foreground/60" />
                          提示：未关联 GPU 硬件时序采集
                        </span>
                      </div>
                    )}
                  </AnimatePresence>
                </div>
              </CardContent>
            </Card>

            {/* 测试协议类型 */}
            <Card className="card-premium">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold">压测协议选择</CardTitle>
                <CardDescription className="text-2xs">支持通用的大模型网关与标准 REST API</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 bg-muted p-1 rounded-lg">
                  <Button
                    variant={testType === "LLM" ? "secondary" : "ghost"}
                    onClick={() => setTestType("LLM")}
                    disabled={isRunning}
                    className="flex-1 text-xs font-semibold h-8"
                  >
                    LLM 压测
                  </Button>
                  <Button
                    variant={testType === "REST_API" ? "secondary" : "ghost"}
                    onClick={() => setTestType("REST_API")}
                    disabled={isRunning}
                    className="flex-1 text-xs font-semibold h-8"
                  >
                    REST API 压测
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* 动态负载折线图预览 */}
            <Card className="card-premium">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-bold">拟合负载曲线预览</CardTitle>
                <CardDescription className="text-2xs">基于选定负载模式下的虚拟并发用户 (VUs) 走势</CardDescription>
              </CardHeader>
              <CardContent className="pt-2">
                <LoadCurveVisualizer loadMode={config.loadMode} />
              </CardContent>
            </Card>
          </div>

          {/* 右侧：Tab 形式的内容工作区 (2/3 宽度) */}
          <div className="lg:col-span-8">
            <Tabs value={workspaceTab} onValueChange={setWorkspaceTab} className="w-full space-y-6">
              
              <TabsList className="grid grid-cols-3 w-full bg-muted/60">
                <TabsTrigger value="config" className="text-xs font-semibold flex items-center gap-1.5">
                  <Settings className="w-3.5 h-3.5" />
                  配置与 YAML 绑定
                </TabsTrigger>
                <TabsTrigger value="run" className="text-xs font-semibold flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5" />
                  监控终端
                </TabsTrigger>
                <TabsTrigger value="history" className="text-xs font-semibold flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5" />
                  历史报告
                </TabsTrigger>
              </TabsList>

              {/* ── Tab 1: 配置与 YAML 双向同步 ── */}
              <TabsContent value="config" className="space-y-6 animate-fadeIn">
                <div className="grid md:grid-cols-2 gap-6 items-start">
                  
                  {/* 可视化表单 */}
                  <div className="space-y-6">
                    {/* API 核心配置 */}
                    {testType === "LLM" ? (
                      <Card className="border-border/60">
                        <CardHeader className="pb-3 flex flex-row items-center justify-between">
                          <CardTitle className="text-sm font-bold">API 接口配置</CardTitle>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={testApiConnection}
                            disabled={apiHealthStatus === "testing" || isRunning}
                            className="text-2xs h-7 px-3.5"
                          >
                            {apiHealthStatus === "testing" ? "测试中..." : "测试连接"}
                          </Button>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          {/* 连接状态显示 */}
                          {apiHealthStatus !== "idle" && (
                            <div className={`p-2.5 rounded-lg border text-2xs flex items-center justify-between ${
                              apiHealthStatus === "success" 
                                ? "bg-green-500/5 border-green-500/20 text-green-500" 
                                : apiHealthStatus === "failed"
                                ? "bg-red-500/5 border-red-500/20 text-red-500"
                                : "bg-yellow-500/5 border-yellow-500/20 text-yellow-600"
                            }`}>
                              <span className="flex items-center gap-1.5 font-semibold">
                                {apiHealthStatus === "success" && <CheckCircle2 className="w-4 h-4" />}
                                {apiHealthStatus === "failed" && <AlertCircle className="w-4 h-4" />}
                                {apiHealthStatus === "success" ? "网关测试通过" : apiHealthStatus === "failed" ? "连接未通过" : "连通性测试中..."}
                              </span>
                              {apiHealthError && <span className="text-3xs truncate max-w-40">{apiHealthError}</span>}
                            </div>
                          )}

                          <div>
                            <label className="block text-xs font-semibold mb-1.5 text-muted-foreground">服务供应商</label>
                            <Select
                              value={config.apiProvider}
                              onValueChange={val => setConfig({ ...config, apiProvider: val })}
                              disabled={isRunning}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="选择供应商" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="openai">OpenAI</SelectItem>
                                <SelectItem value="anthropic">Anthropic</SelectItem>
                                <SelectItem value="custom">自定义 (Custom)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div>
                            <label className="block text-xs font-semibold mb-1.5 text-muted-foreground">API 地址 (Base URL)</label>
                            <Input
                              type="text"
                              value={config.apiUrl}
                              onChange={e => setConfig({ ...config, apiUrl: e.target.value })}
                              disabled={isRunning}
                              className="text-xs"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-semibold mb-1.5 text-muted-foreground">API 密钥 (API Key)</label>
                            <Input
                              type="password"
                              value={config.apiKey}
                              onChange={e => setConfig({ ...config, apiKey: e.target.value })}
                              disabled={isRunning}
                              placeholder="sk-..."
                              className="text-xs font-mono"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-semibold mb-1.5 text-muted-foreground">指定模型名称 (Model)</label>
                            <Input
                              type="text"
                              value={config.model}
                              onChange={e => setConfig({ ...config, model: e.target.value })}
                              disabled={isRunning}
                              className="text-xs"
                            />
                          </div>
                        </CardContent>
                      </Card>
                    ) : (
                      <Card className="border-border/60">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-bold">REST API 端点配置</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div>
                            <label className="block text-xs font-semibold mb-1.5 text-muted-foreground">接口地址 (URL)</label>
                            <Input
                              type="text"
                              value={restConfig.url}
                              onChange={e => setRestConfig({ ...restConfig, url: e.target.value })}
                              disabled={isRunning}
                              className="text-xs"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-semibold mb-1.5 text-muted-foreground">请求方法 (Method)</label>
                              <Select
                                value={restConfig.method}
                                onValueChange={val => setRestConfig({ ...restConfig, method: val as any })}
                                disabled={isRunning}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="GET">GET</SelectItem>
                                  <SelectItem value="POST">POST</SelectItem>
                                  <SelectItem value="PUT">PUT</SelectItem>
                                  <SelectItem value="DELETE">DELETE</SelectItem>
                                  <SelectItem value="PATCH">PATCH</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold mb-1.5 text-muted-foreground">预期 HTTP 状态码</label>
                              <Input
                                type="text"
                                value={restConfig.expectedStatus}
                                onChange={e => {
                                  const val = e.target.value;
                                  if (val === "" || /^[0-9]+$/.test(val)) {
                                    setRestConfig({ ...restConfig, expectedStatus: val === "" ? "" as any : parseInt(val, 10) });
                                  }
                                }}
                                disabled={isRunning}
                                placeholder="200"
                                className="text-xs"
                              />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* 测试负载参数配置 */}
                    <Card className="border-border/60">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-bold">负载参数设置</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div>
                          <label className="block text-xs font-semibold mb-1.5 text-muted-foreground">负载模式 (Load Mode)</label>
                          <Select
                            value={config.loadMode}
                            onValueChange={val => {
                              let defaultLoadConfig = { concurrency: 60, duration: 60 };
                              if (val === "ramp_up") {
                                defaultLoadConfig = { start: 10, end: 60, step: 10, duration: 60 } as any;
                              } else if (val === "fluctuate") {
                                defaultLoadConfig = { min: 10, max: 60, period: 60, duration: 60 } as any;
                              } else if (val === "spike") {
                                defaultLoadConfig = { baseline: 10, spike: 60, spike_duration: 60 } as any;
                              }
                              setConfig({
                                ...config,
                                loadMode: val,
                                loadConfig: defaultLoadConfig,
                              });
                            }}
                            disabled={isRunning}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="constant">恒定负载 (Constant)</SelectItem>
                              <SelectItem value="ramp_up">阶梯增压 (Ramp Up)</SelectItem>
                              <SelectItem value="fluctuate">波动负载 (Fluctuate)</SelectItem>
                              <SelectItem value="spike">突刺负载 (Spike)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* 动态渲染负载输入字段 */}
                        {config.loadMode === "constant" && (
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-semibold mb-1.5 text-muted-foreground">并发数 (Concurrency)</label>
                              <Input
                                type="text"
                                value={config.loadConfig.concurrency !== undefined ? String(config.loadConfig.concurrency) : ""}
                                onChange={e => {
                                  const val = e.target.value;
                                  if (val === "" || /^[0-9]+$/.test(val)) {
                                    setConfig({
                                      ...config,
                                      loadConfig: { ...config.loadConfig, concurrency: val === "" ? "" : parseInt(val, 10) },
                                    });
                                  }
                                }}
                                disabled={isRunning}
                                placeholder="60"
                                className="text-xs"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold mb-1.5 text-muted-foreground">时长 (持续秒数)</label>
                              <Input
                                type="text"
                                value={config.loadConfig.duration !== undefined ? String(config.loadConfig.duration) : ""}
                                onChange={e => {
                                  const val = e.target.value;
                                  if (val === "" || /^[0-9]+$/.test(val)) {
                                    setConfig({
                                      ...config,
                                      loadConfig: { ...config.loadConfig, duration: val === "" ? "" : parseInt(val, 10) },
                                    });
                                  }
                                }}
                                disabled={isRunning}
                                placeholder="60"
                                className="text-xs"
                              />
                            </div>
                          </div>
                        )}

                        {config.loadMode === "ramp_up" && (
                          <div className="space-y-3">
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <label className="block text-3xs font-semibold mb-1 text-muted-foreground">起始并发</label>
                                <Input
                                  type="text"
                                  value={config.loadConfig.start !== undefined ? String(config.loadConfig.start) : ""}
                                  onChange={e => {
                                    const val = e.target.value;
                                    if (val === "" || /^[0-9]+$/.test(val)) {
                                      setConfig({ ...config, loadConfig: { ...config.loadConfig, start: val === "" ? "" : parseInt(val, 10) } });
                                    }
                                  }}
                                  disabled={isRunning}
                                  className="text-xs"
                                />
                              </div>
                              <div>
                                <label className="block text-3xs font-semibold mb-1 text-muted-foreground">目标并发</label>
                                <Input
                                  type="text"
                                  value={config.loadConfig.end !== undefined ? String(config.loadConfig.end) : ""}
                                  onChange={e => {
                                    const val = e.target.value;
                                    if (val === "" || /^[0-9]+$/.test(val)) {
                                      setConfig({ ...config, loadConfig: { ...config.loadConfig, end: val === "" ? "" : parseInt(val, 10) } });
                                    }
                                  }}
                                  disabled={isRunning}
                                  className="text-xs"
                                />
                              </div>
                              <div>
                                <label className="block text-3xs font-semibold mb-1 text-muted-foreground">步长 (Step)</label>
                                <Input
                                  type="text"
                                  value={config.loadConfig.step !== undefined ? String(config.loadConfig.step) : ""}
                                  onChange={e => {
                                    const val = e.target.value;
                                    if (val === "" || /^[0-9]+$/.test(val)) {
                                      setConfig({ ...config, loadConfig: { ...config.loadConfig, step: val === "" ? "" : parseInt(val, 10) } });
                                    }
                                  }}
                                  disabled={isRunning}
                                  className="text-xs"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold mb-1.5 text-muted-foreground">时长 (持续秒数)</label>
                              <Input
                                type="text"
                                value={config.loadConfig.duration !== undefined ? String(config.loadConfig.duration) : ""}
                                onChange={e => {
                                  const val = e.target.value;
                                  if (val === "" || /^[0-9]+$/.test(val)) {
                                    setConfig({ ...config, loadConfig: { ...config.loadConfig, duration: val === "" ? "" : parseInt(val, 10) } });
                                  }
                                }}
                                disabled={isRunning}
                                className="text-xs"
                              />
                            </div>
                          </div>
                        )}

                        {config.loadMode === "fluctuate" && (
                          <div className="space-y-3">
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <label className="block text-3xs font-semibold mb-1 text-muted-foreground">最小并发</label>
                                <Input
                                  type="text"
                                  value={config.loadConfig.min !== undefined ? String(config.loadConfig.min) : ""}
                                  onChange={e => {
                                    const val = e.target.value;
                                    if (val === "" || /^[0-9]+$/.test(val)) {
                                      setConfig({ ...config, loadConfig: { ...config.loadConfig, min: val === "" ? "" : parseInt(val, 10) } });
                                    }
                                  }}
                                  disabled={isRunning}
                                  className="text-xs"
                                />
                              </div>
                              <div>
                                <label className="block text-3xs font-semibold mb-1 text-muted-foreground">最大并发</label>
                                <Input
                                  type="text"
                                  value={config.loadConfig.max !== undefined ? String(config.loadConfig.max) : ""}
                                  onChange={e => {
                                    const val = e.target.value;
                                    if (val === "" || /^[0-9]+$/.test(val)) {
                                      setConfig({ ...config, loadConfig: { ...config.loadConfig, max: val === "" ? "" : parseInt(val, 10) } });
                                    }
                                  }}
                                  disabled={isRunning}
                                  className="text-xs"
                                />
                              </div>
                              <div>
                                <label className="block text-3xs font-semibold mb-1 text-muted-foreground">周期 (秒)</label>
                                <Input
                                  type="text"
                                  value={config.loadConfig.period !== undefined ? String(config.loadConfig.period) : ""}
                                  onChange={e => {
                                    const val = e.target.value;
                                    if (val === "" || /^[0-9]+$/.test(val)) {
                                      setConfig({ ...config, loadConfig: { ...config.loadConfig, period: val === "" ? "" : parseInt(val, 10) } });
                                    }
                                  }}
                                  disabled={isRunning}
                                  className="text-xs"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold mb-1.5 text-muted-foreground">总测试时长 (秒)</label>
                              <Input
                                type="text"
                                value={config.loadConfig.duration !== undefined ? String(config.loadConfig.duration) : ""}
                                onChange={e => {
                                  const val = e.target.value;
                                  if (val === "" || /^[0-9]+$/.test(val)) {
                                    setConfig({ ...config, loadConfig: { ...config.loadConfig, duration: val === "" ? "" : parseInt(val, 10) } });
                                  }
                                }}
                                disabled={isRunning}
                                className="text-xs"
                              />
                            </div>
                          </div>
                        )}

                        {config.loadMode === "spike" && (
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="block text-3xs font-semibold mb-1 text-muted-foreground">基线并发</label>
                              <Input
                                type="text"
                                value={config.loadConfig.baseline !== undefined ? String(config.loadConfig.baseline) : ""}
                                onChange={e => {
                                  const val = e.target.value;
                                  if (val === "" || /^[0-9]+$/.test(val)) {
                                    setConfig({ ...config, loadConfig: { ...config.loadConfig, baseline: val === "" ? "" : parseInt(val, 10) } });
                                  }
                                }}
                                disabled={isRunning}
                                className="text-xs"
                              />
                            </div>
                            <div>
                              <label className="block text-3xs font-semibold mb-1 text-muted-foreground">突刺并发</label>
                              <Input
                                type="text"
                                value={config.loadConfig.spike !== undefined ? String(config.loadConfig.spike) : ""}
                                onChange={e => {
                                  const val = e.target.value;
                                  if (val === "" || /^[0-9]+$/.test(val)) {
                                    setConfig({ ...config, loadConfig: { ...config.loadConfig, spike: val === "" ? "" : parseInt(val, 10) } });
                                  }
                                }}
                                disabled={isRunning}
                                className="text-xs"
                              />
                            </div>
                            <div>
                              <label className="block text-3xs font-semibold mb-1 text-muted-foreground">突刺时长</label>
                              <Input
                                type="text"
                                value={config.loadConfig.spike_duration !== undefined ? String(config.loadConfig.spike_duration) : ""}
                                onChange={e => {
                                  const val = e.target.value;
                                  if (val === "" || /^[0-9]+$/.test(val)) {
                                    setConfig({ ...config, loadConfig: { ...config.loadConfig, spike_duration: val === "" ? "" : parseInt(val, 10) } });
                                  }
                                }}
                                disabled={isRunning}
                                className="text-xs"
                              />
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* 请求体与自定义Headers */}
                    {testType === "REST_API" && (
                      <Card className="border-border/60">
                        <CardHeader className="pb-3 flex flex-row items-center justify-between">
                          <CardTitle className="text-sm font-bold">自定义请求参数</CardTitle>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setRestHeaders([...restHeaders, { key: "", value: "" }])}
                            disabled={isRunning}
                            className="text-2xs h-7 px-2"
                          >
                            <Plus className="w-3.5 h-3.5 mr-1" />
                            增加头
                          </Button>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="space-y-2">
                            <label className="block text-xs font-semibold text-muted-foreground">请求头列表 (Headers)</label>
                            {restHeaders.map((header, idx) => (
                              <div key={idx} className="flex gap-2 items-center">
                                <Input
                                  placeholder="Key"
                                  value={header.key}
                                  onChange={e => {
                                    const updated = [...restHeaders];
                                    updated[idx].key = e.target.value;
                                    setRestHeaders(updated);
                                  }}
                                  disabled={isRunning}
                                  className="h-8 text-2xs"
                                />
                                <Input
                                  placeholder="Value"
                                  value={header.value}
                                  onChange={e => {
                                    const updated = [...restHeaders];
                                    updated[idx].value = e.target.value;
                                    setRestHeaders(updated);
                                  }}
                                  disabled={isRunning}
                                  className="h-8 text-2xs"
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => setRestHeaders(restHeaders.filter((_, i) => i !== idx))}
                                  disabled={isRunning}
                                  className="text-destructive"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            ))}
                          </div>

                          {restConfig.method !== "GET" && (
                            <div>
                              <div className="flex justify-between items-center mb-1.5">
                                <label className="block text-xs font-semibold text-muted-foreground">请求体 (Request Body)</label>
                                <Select
                                  value={restConfig.bodyType}
                                  onValueChange={val => setRestConfig({ ...restConfig, bodyType: val as any })}
                                  disabled={isRunning}
                                >
                                  <SelectTrigger className="w-20 h-6 text-3xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="json">JSON</SelectItem>
                                    <SelectItem value="raw">Raw</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <Textarea
                                value={restConfig.bodyContent}
                                onChange={e => setRestConfig({ ...restConfig, bodyContent: e.target.value })}
                                disabled={isRunning}
                                rows={4}
                                className="font-mono text-xs"
                                placeholder={restConfig.bodyType === "json" ? '{\n  "key": "value"\n}' : "Text content..."}
                              />
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}

                    {/* LLM 数据输入配置 */}
                    {testType === "LLM" && (
                      <Card className="border-border/60">
                        <CardHeader className="pb-3 flex flex-row items-center justify-between">
                          <CardTitle className="text-sm font-bold">压测请求数据</CardTitle>
                          {config.inputType === "json" && (
                            <div className="flex gap-2 items-center">
                              <Badge variant={getJsonValidationStatus().isValid ? "secondary" : "destructive"} className="text-3xs px-2 py-0">
                                {getJsonValidationStatus().isValid ? "✓ 有效 JSON" : "✗ 无效 JSON"}
                              </Badge>
                              <Button
                                variant="link"
                                onClick={handleFormatJson}
                                disabled={isRunning || !getJsonValidationStatus().isValid}
                                className="text-2xs p-0 h-auto"
                              >
                                格式化
                              </Button>
                            </div>
                          )}
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div>
                            <label className="block text-xs font-semibold mb-1.5 text-muted-foreground">输入类型 (Input Type)</label>
                            <Select
                              value={config.inputType}
                              onValueChange={val => {
                                let defaultData = "";
                                if (val === "text") defaultData = "Explain quantum computing in simple terms.";
                                else if (val === "image") defaultData = "https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=500";
                                else if (val === "video") defaultData = "https://www.w3schools.com/html/mov_bbb.mp4";
                                else if (val === "json") defaultData = '[\n  {\n    "role": "user",\n    "content": "Hello!"\n  }\n]';
                                setConfig({ ...config, inputType: val, inputData: defaultData });
                              }}
                              disabled={isRunning}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="text">文本 (Text)</SelectItem>
                                <SelectItem value="image">图片 (Image)</SelectItem>
                                <SelectItem value="video">视频 (Video)</SelectItem>
                                <SelectItem value="json">JSON (完整请求体)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {/* 文本输入 */}
                          {config.inputType === "text" && (
                            <div className="space-y-2">
                              <Textarea
                                value={config.inputData}
                                onChange={e => setConfig({ ...config, inputData: e.target.value })}
                                disabled={isRunning}
                                rows={4}
                                placeholder="输入您的 Prompt 文本..."
                                className="text-xs focus-visible:ring-1"
                              />
                              <div className="flex gap-1.5 flex-wrap">
                                {[
                                  { label: "解释量子计算", text: "Explain quantum computing in simple terms." },
                                  { label: "写一首AI短诗", text: "Write a short poem about artificial intelligence." },
                                  { label: "分析冒泡排序", text: "Analyze the time and space complexity of Bubble Sort." }
                                ].map((chip, idx) => (
                                  <Button
                                    key={idx}
                                    type="button"
                                    variant="outline"
                                    onClick={() => setConfig({ ...config, inputData: chip.text })}
                                    disabled={isRunning}
                                    className="text-3xs h-6 px-2 py-0"
                                  >
                                    {chip.label}
                                  </Button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* 图片输入 */}
                          {config.inputType === "image" && (
                            <div className="space-y-3">
                              <div
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, "image")}
                                className={`border border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
                                  isDragOver ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/35 bg-muted/10"
                                }`}
                                onClick={() => document.getElementById("image-input-file")?.click()}
                              >
                                <input
                                  id="image-input-file"
                                  type="file"
                                  accept="image/*"
                                  onChange={handleImageUpload}
                                  className="hidden"
                                  disabled={isRunning}
                                />
                                <Upload className="w-7 h-7 mx-auto mb-2 text-muted-foreground/50" />
                                <p className="text-2xs text-muted-foreground font-semibold">拖拽图片或点击上传</p>
                              </div>
                              <Input
                                type="text"
                                value={config.inputData.startsWith("data:") ? "" : config.inputData}
                                onChange={e => setConfig({ ...config, inputData: e.target.value })}
                                disabled={isRunning}
                                placeholder="输入图片在线 URL..."
                                className="text-xs h-8"
                              />
                              {config.inputData && (
                                <div className="relative group rounded-lg overflow-hidden border border-border bg-muted/20 p-2 flex items-center justify-center max-h-32">
                                  <img src={config.inputData} alt="Preview" className="max-h-28 object-contain rounded" />
                                  <Button
                                    type="button"
                                    variant="destructive"
                                    size="icon-sm"
                                    onClick={() => setConfig({ ...config, inputData: "" })}
                                    disabled={isRunning}
                                    className="absolute top-2 right-2 rounded-full w-6 h-6"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}

                          {/* 视频输入 */}
                          {config.inputType === "video" && (
                            <div className="space-y-3">
                              <div
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, "video")}
                                className={`border border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
                                  isDragOver ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/35 bg-muted/10"
                                }`}
                                onClick={() => document.getElementById("video-input-file")?.click()}
                              >
                                <input
                                  id="video-input-file"
                                  type="file"
                                  accept="video/*"
                                  onChange={handleVideoUpload}
                                  className="hidden"
                                  disabled={isRunning}
                                />
                                <Upload className="w-7 h-7 mx-auto mb-2 text-muted-foreground/50" />
                                <p className="text-2xs text-muted-foreground font-semibold">拖拽视频或点击上传</p>
                              </div>
                              <Input
                                type="text"
                                value={config.inputData.startsWith("data:") ? "" : config.inputData}
                                onChange={e => setConfig({ ...config, inputData: e.target.value })}
                                disabled={isRunning}
                                placeholder="输入视频在线 URL..."
                                className="text-xs h-8"
                              />
                            </div>
                          )}

                          {/* JSON 输入 */}
                          {config.inputType === "json" && (
                            <div className="space-y-2">
                              <Textarea
                                value={config.inputData}
                                onChange={e => setConfig({ ...config, inputData: e.target.value })}
                                disabled={isRunning}
                                rows={6}
                                className="font-mono text-xs focus-visible:ring-1"
                              />
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}
                  </div>

                  {/* 右侧：YAML 编辑绑定 */}
                  <Card className="border-border/60 sticky top-24">
                    <CardHeader className="pb-3 flex flex-row items-center justify-between">
                      <div>
                        <CardTitle className="text-sm font-bold flex items-center gap-1.5">
                          <FileJson className="w-4 h-4 text-primary" />
                          config.yaml 配置文件
                        </CardTitle>
                        <CardDescription className="text-3xs">YAML 源码与上述可视化表单双向实时同步</CardDescription>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="icon-sm" onClick={handleCopyYaml} className="w-7 h-7">
                          {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                        </Button>
                        <Button variant="ghost" size="icon-sm" onClick={handleDownloadYaml} className="w-7 h-7">
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="relative">
                        <Textarea
                          value={yamlText}
                          onChange={(e) => handleYamlChange(e.target.value)}
                          onFocus={() => { isEditingYamlRef.current = true; }}
                          onBlur={() => { isEditingYamlRef.current = false; }}
                          className={`font-mono text-xs min-h-[500px] bg-muted/20 border-border/80 focus-visible:ring-1 ${yamlError ? "border-destructive/60" : ""}`}
                          placeholder="编写或粘贴 YAML 配置..."
                          disabled={isRunning}
                        />
                      </div>
                      <AnimatePresence>
                        {yamlError && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="p-2.5 bg-destructive/10 border border-destructive/20 text-destructive text-3xs rounded-lg font-mono flex items-start gap-1.5"
                          >
                            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                            <span>{yamlError}</span>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* ── Tab 2: 监控终端与指标时序图 ── */}
              <TabsContent value="run" className="space-y-6 animate-fadeIn">
                <Card className="border-border/60">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-bold flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-primary" />
                      实时执行监视器
                    </CardTitle>
                    <CardDescription className="text-2xs">观察系统进度、实时事件流以及核心聚合数据</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* 进度条与状态 */}
                    {(isRunning || progress > 0) && (
                      <div className="space-y-2 p-4 bg-muted/20 rounded-xl border border-border/40">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-semibold text-muted-foreground flex items-center gap-1.5">
                            {isRunning ? (
                              <span className="h-2 w-2 rounded-full bg-blue-500 animate-ping" />
                            ) : (
                              <span className="h-2 w-2 rounded-full bg-green-500" />
                            )}
                            {isRunning ? "测试执行中..." : "测试完成"}
                          </span>
                          <span className={`font-bold ${testResults?.successfulRequests === 0 ? "text-red-500" : "text-primary"}`}>
                            {progress}% {testResults?.successfulRequests === 0 && "(阻断中断)"}
                          </span>
                        </div>
                        <Progress
                          value={progress}
                          className={`h-2 transition-all ${testResults?.successfulRequests === 0 ? "bg-red-500" : "bg-primary"}`}
                        />
                      </div>
                    )}

                    {/* 专家警报 (100% 失败) */}
                    {testResults && testResults.successfulRequests === 0 && (
                      <div className="p-4 border border-red-500/30 bg-red-500/5 rounded-xl space-y-2 animate-shake">
                        <h4 className="text-red-500 font-bold flex items-center gap-2 text-sm">
                          <AlertCircle className="w-5 h-5" />
                          专家诊断预警 (High Risk)
                        </h4>
                        <p className="text-xs text-red-400">压测请求全量受阻，可能网关凭证无效或目标服务限流熔断：</p>
                        <ul className="list-disc list-inside text-xs text-red-400/80 pl-2">
                          {testResults.analysis && testResults.analysis.length > 0 ? (
                            testResults.analysis.map((msg: string, i: number) => <li key={i}>{msg}</li>)
                          ) : (
                            <li>未收到任何成功状态的网关回复</li>
                          )}
                        </ul>
                      </div>
                    )}

                    {/* 聚合指标卡片组 */}
                    {testResults && (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-4 border-t border-border/50">
                        <div className={`p-3 rounded-xl border ${testResults.successfulRequests === 0 ? "bg-red-500/5 border-red-500/10" : "bg-primary/5 border-primary/10"}`}>
                          <p className="text-3xs text-muted-foreground font-semibold">成功率</p>
                          <p className={`text-lg font-extrabold mt-1 ${testResults.successfulRequests === 0 ? "text-red-500" : "text-primary"}`}>
                            {testResults.successRate}%
                          </p>
                        </div>
                        <div className="p-3 rounded-xl border border-border bg-card">
                          <p className="text-3xs text-muted-foreground font-semibold">请求数 (成功/总计)</p>
                          <p className="text-lg font-extrabold text-foreground mt-1">
                            {testResults.successfulRequests} / {testResults.totalRequests}
                          </p>
                        </div>
                        <div className="p-3 rounded-xl border border-border bg-card">
                          <p className="text-3xs text-muted-foreground font-semibold">QPS</p>
                          <p className="text-lg font-extrabold text-foreground mt-1">
                            {testResults.qps} req/s
                          </p>
                        </div>
                        <div className="p-3 rounded-xl border border-border bg-card">
                          <p className="text-3xs text-muted-foreground font-semibold">平均延迟 (Avg Latency)</p>
                          <p className="text-lg font-extrabold text-foreground mt-1">
                            {testType === "LLM" ? `${testResults.ttftAvg} ms` : `${testResults.avgLatency} ms`}
                          </p>
                        </div>
                        <div className="p-3 rounded-xl border border-border bg-card">
                          <p className="text-3xs text-muted-foreground font-semibold">P95 延迟</p>
                          <p className="text-lg font-extrabold text-foreground mt-1">
                            {testType === "LLM" ? `${testResults.ttftP95} ms` : `${testResults.p95Latency} ms`}
                          </p>
                        </div>
                        {testType === "LLM" && (
                          <div className="p-3 rounded-xl border border-border bg-card">
                            <p className="text-3xs text-muted-foreground font-semibold">平均吞吐 (Avg TPS)</p>
                            <p className="text-lg font-extrabold text-foreground mt-1">
                              {testResults.tpsAvg} tok/s
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 导出按钮 */}
                    {testResults && (
                      <div className="flex gap-2 flex-wrap pt-2">
                        <Button variant="outline" size="sm" onClick={exportTestResultsJson} className="flex-1 min-w-[100px] text-xs">
                          <Download className="w-3.5 h-3.5 mr-1" />
                          JSON
                        </Button>
                        <Button variant="outline" size="sm" onClick={exportTestResultsPdf} disabled={isExportingPdf} className="flex-1 min-w-[100px] text-xs">
                          <Download className="w-3.5 h-3.5 mr-1" />
                          {isExportingPdf ? "导出中..." : "PDF 报告"}
                        </Button>
                        <Button variant="outline" size="sm" onClick={exportTestResultsWord} disabled={isExportingWord} className="flex-1 min-w-[100px] text-xs">
                          <Download className="w-3.5 h-3.5 mr-1" />
                          {isExportingWord ? "导出中..." : "Word 报告"}
                        </Button>
                        {testResults.id && (
                          <Button size="sm" onClick={() => navigate(`/dashboard?id=${testResults.id}`)} className="flex-1 min-w-[150px] text-xs bg-primary hover:bg-primary/95 text-white">
                            查看详细指标比对
                          </Button>
                        )}
                      </div>
                    )}

                    {/* 实时滚动终端 */}
                    {logs.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                            <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
                            控制台输出日志
                          </span>
                        </div>
                        <div className="bg-black text-green-400/90 rounded-xl p-4 h-72 overflow-y-auto font-mono text-xs border border-border shadow-inner leading-relaxed">
                          {logs.map(log => (
                            <div key={log.id} className="mb-1.5 flex gap-2 items-start">
                              <span className="text-gray-500 select-none flex-shrink-0">
                                [{log.timestamp}]
                              </span>
                              <span className={`flex-shrink-0 ${getLogColor(log.level)}`}>
                                {log.level === "success" ? "✓" : log.level === "error" ? "✗" : log.level === "warning" ? "⚠" : "•"}
                              </span>
                              <span className={`break-all ${log.level === 'error' ? 'text-red-400 font-medium' : log.level === 'warning' ? 'text-yellow-400 font-medium' : 'text-gray-200'}`}>
                                {log.message}
                              </span>
                            </div>
                          ))}
                          <div ref={logsEndRef} />
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* 性能折线时序图 (仅在测试完成后绘制) */}
                {testResults && testResults.id && (
                  <PerformanceCharts resultId={testResults.id} testType={testType} />
                )}
              </TabsContent>

              {/* ── Tab 3: 历史报告记录 ── */}
              <TabsContent value="history" className="animate-fadeIn">
                <Card className="border-border/60">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-bold flex items-center gap-2">
                      <History className="w-4 h-4 text-primary" />
                      历史测试报告归档
                    </CardTitle>
                    <CardDescription className="text-2xs">查看过往测试的核心结果或勾选多项进行交叉对比分析</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-2">
                    <TestHistoryPanel />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// 子组件：测试历史记录面板
// ──────────────────────────────────────────────────────────
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
    return <div className="text-center py-12 text-sm text-muted-foreground animate-pulse">正在加载历史档案数据...</div>;
  }

  if (testResults.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm border border-dashed border-border rounded-xl">
        暂无测试历史记录
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <span className="text-xs text-muted-foreground font-semibold">
          共 {testResults.length} 项测试记录 (已选 {selectedResults.length} 项)
        </span>
        <Button
          onClick={handleCompare}
          disabled={selectedResults.length < 2}
          variant="secondary"
          size="sm"
          className="text-xs font-bold"
        >
          对比所选项 ({selectedResults.length})
        </Button>
      </div>

      <div className="space-y-3">
        {testResults.map((result: any) => (
          <Card key={result.id} className="hover:shadow-xs transition-shadow duration-200 border-border/80 bg-card/65">
            <CardContent className="flex items-center gap-4 p-4">
              <Checkbox
                checked={selectedResults.includes(result.id)}
                onCheckedChange={(checked) => {
                  if (checked) {
                    setSelectedResults([...selectedResults, result.id]);
                  } else {
                    setSelectedResults(selectedResults.filter(id => id !== result.id));
                  }
                }}
              />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-semibold text-sm truncate max-w-[250px]">
                    {result.name || result.model || `测试 #${result.id}`}
                  </span>
                  <Badge variant={result.status === "completed" ? "secondary" : result.status === "failed" ? "destructive" : "outline"} className="text-3xs uppercase px-1.5 py-0">
                    {result.status === "completed" ? "成功" : result.status === "failed" ? "失败" : "进行中"}
                  </Badge>
                  <Badge variant="outline" className="text-3xs px-1.5 py-0 border-primary/20 text-primary">
                    {result.testType}
                  </Badge>
                </div>
                <p className="text-3xs text-muted-foreground">
                  执行于: {new Date(result.createdAt).toLocaleString()}　|　并发数: {result.concurrency} VUs
                </p>
                {result.status === "completed" && (
                  <p className="text-2xs text-muted-foreground/80 mt-1 pb-0.5">
                    {result.testType === "REST_API"
                      ? `平均延迟: ${result.avgLatency}ms | P95: ${result.p95Latency}ms | QPS: ${result.qps} req/s`
                      : `首包时间: ${result.ttftAvg}ms | TPS: ${result.tpsAvg} | QPS: ${result.qps} req/s`}
                  </p>
                )}
              </div>

              <div className="flex gap-3">
                {result.status === "completed" && (
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => navigate(`/dashboard?id=${result.id}`)}
                    className="text-xs text-primary font-bold p-0 h-auto"
                  >
                    查看详情
                  </Button>
                )}
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => handleDelete(result.id)}
                  className="text-xs text-destructive hover:text-destructive/80 p-0 h-auto"
                >
                  删除
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
