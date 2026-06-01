import { Zap, TrendingUp, Activity, Gauge, ChevronDown, Download, Sparkles, X, Loader2, BrainCircuit, RotateCcw, Copy } from 'lucide-react';
import { useLocation } from 'wouter';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { trpc } from '../lib/trpc';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem } from '../components/ui/dropdown-menu';
import { Button } from '../components/ui/button';
import { jsPDF } from 'jspdf';
import {
  loadChineseFont,
  drawPageHeader,
  drawPageFooter,
  drawTable,
  captureChartAsImage,
  loadLogoPngDataUrl
} from '../lib/pdfUtils';
import { Document, Packer, Paragraph, HeadingLevel, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { toast } from 'sonner';

const METRIC_OPTIONS = [
  { key: 'TTFT', label: 'TTFT' },
  { key: 'TPS', label: 'TPS (Tokens/s)' },
  { key: 'ITL', label: 'ITL (词间延迟)' },
  { key: 'QPS', label: 'QPS (Req/s)' },
  { key: 'Distribution', label: 'Token分布 (TBT)' },
  { key: 'AvgLatency', label: 'Avg RT' },
  { key: 'P95Latency', label: 'P95 RT' },
  { key: 'TimeSeries', label: 'TPS 时序演进' },
  { key: 'gpuUtilization', label: 'GPU 利用率 (%)' },
  { key: 'kvCacheUsage', label: 'KV Cache 占用率 (%)' },
  { key: 'vramUsage', label: 'VRAM 显存占用 (%)' },
] as const;

type MetricKey =
  | 'TTFT'
  | 'TPS'
  | 'ITL'
  | 'QPS'
  | 'Distribution'
  | 'AvgLatency'
  | 'P95Latency'
  | 'TimeSeries'
  | 'gpuUtilization'
  | 'kvCacheUsage'
  | 'vramUsage'
  | 'avgResponseSize'
  | 'statusCodes';

interface AnalysisResult {
  global?: string;
  TTFT?: string;
  TPS?: string;
  ITL?: string;
  QPS?: string;
  AvgLatency?: string;
  P95Latency?: string;
  Distribution?: string;
  TimeSeries?: string;
  avgResponseSize?: string;
  statusCodes?: string;
  [key: string]: string | undefined;
}

const DEFAULT_ANALYSIS_PROMPT = `你是一位硅谷顶尖的大模型（LLM）性能调优与架构专家。
下面是用户当前选中的多组大模型性能测试对比数据，请你对此进行深度分析，针对不同的指标分别给出精准、专业、有洞察力的诊断结论和优化建议。

【对比测试数据】
{data}

请以 JSON 格式输出分析结果。输出 the JSON 结构必须严格包含以下字段：
{
  "global": "全局对比与核心结论",
  "TTFT": "针对首字延迟 (TTFT) 响应演进趋势的分析与调优建议",
  "TPS": "针对 Token 生成吞吐量 (TPS) 稳定性的分析与调优建议",
  "ITL": "针对词间延迟 (ITL) 的分析与调优建议",
  "QPS": "针对请求吞吐 (QPS) 处理并发能力的分析与调优建议",
  "AvgLatency": "针对平均响应耗时 (Avg RT) 性能表现的分析与建议",
  "P95Latency": "针对长尾延迟 (P95 RT) 抖动的分析与建议",
  "Distribution": "针对响应延迟分布多维对比的分析与建议",
  "TimeSeries": "针对 TPS 时序演进波动的分析与建议"
}

要求：
1. 请用中文回复。
2. 语言必须极其专业且富有见地（符合硅谷性能专家人设），多使用专业术语（如 Time-To-First-Token, Queueing Delay, Server-Side Processing, Network Latency, Concurrency Bottleneck, Stream Chunks 等）。
3. 优化建议应当具体可行（例如参数调优、高并发优化、缓存机制、网络路由选择等）。`;

const DEFAULT_REST_ANALYSIS_PROMPT = `你是一位硅谷顶尖的系统架构与 API 性能调优专家。
下面是用户当前选中的多组 REST API 性能测试对比数据，请你对此进行深度分析，针对不同的指标分别给出精准、专业、有洞察力的诊断结论和优化建议。

【对比测试数据】
{data}

请以 JSON 格式输出分析结果。输出的 JSON 结构必须严格包含以下字段：
{
  "global": "全局对比与核心结论",
  "QPS": "针对每秒请求数 (QPS) 处理并发能力的分析与调优建议",
  "AvgLatency": "针对平均响应耗时 (Avg RT) 性能表现的分析与建议",
  "P95Latency": "针对长尾延迟 (P95 RT) 抖动的分析与建议",
  "avgResponseSize": "针对响应体大小对吞吐量和延迟影响的分析与建议",
  "statusCodes": "针对 HTTP 状态码分布（成功率/异常分布）的分析与建议",
  "Distribution": "针对响应延迟分布多维对比的分析与建议",
  "TimeSeries": "针对 QPS 时序演进波动的分析与建议"
}

要求：
1. 请用中文回复。
2. 语言必须极其专业且富有见地（符合硅谷性能专家人设），多使用专业术语（如 Throughput, Latency Percentiles, Connection Pooling, Network Bandwidth, Socket Timeout, Cache Hit Rate, Concurrency Bottleneck 等）。
3. 优化建议应当具体可行（例如连接池配置、负载均衡策略、缓存机制、Gzip 压缩、网络路由选择等）。`;


export default function Dashboard() {
  const [, navigate] = useLocation();
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [selectedMetrics, setSelectedMetrics] = useState<MetricKey[]>([]);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingWord, setIsExportingWord] = useState(false);
  const pageCaptureRef = useRef<HTMLDivElement>(null);
  const dashboardExportRef = useRef<HTMLDivElement>(null);

  // Analysis feature state
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisConfig, setAnalysisConfig] = useState({
    apiProvider: 'builtin' as 'builtin' | 'custom',
    builtinModel: 'gemini' as 'gemini' | 'qwen3.7-max',
    customApiUrl: '',
    customApiKey: '',
    customModel: '',
    prompt: DEFAULT_ANALYSIS_PROMPT,
  });
  const [isBuiltinDropdownOpen, setIsBuiltinDropdownOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const idsParam = params.get('compare_ids');
    const idParam = params.get('id');
    
    let ids: number[] = [];
    if (idsParam) {
      ids = idsParam.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !Number.isNaN(id));
    } else if (idParam) {
      ids = [parseInt(idParam, 10)].filter(id => !Number.isNaN(id));
      setTimeout(() => updateUrl(ids), 10);
    }
    
    if (ids.length > 0) {
      setCompareIds(ids);
    }
  }, []);

  const updateUrl = (newIds: number[]) => {
    setCompareIds(newIds);
    const params = new URLSearchParams(window.location.search);
    if (newIds.length > 0) {
      params.set('compare_ids', newIds.join(','));
      params.delete('id');
    } else {
      params.delete('compare_ids');
      params.delete('id');
    }
    window.history.replaceState({}, '', `?${params.toString()}`);
  };

  const toggleId = (id: number) => {
    if (compareIds.includes(id)) {
      updateUrl(compareIds.filter((i: number) => i !== id));
    } else {
      updateUrl([...compareIds, id].sort((a: number, b: number) => a - b));
    }
  };

  const { data: testResults = [], isLoading } = trpc.test.getResults.useQuery();
  const completedResults = useMemo(() => testResults.filter((r: any) => r.status === 'completed'), [testResults]);

  // Dynamic Metrics based on selected test results protocol
  const isRestApiOnly = useMemo(() => {
    if (compareIds.length === 0) return false;
    const selected = completedResults.filter((r: any) => compareIds.includes(r.id));
    if (selected.length === 0) return false;
    return selected.every((r: any) => r.testType === 'REST_API');
  }, [completedResults, compareIds]);

  const activeMetricOptions = useMemo(() => {
    if (isRestApiOnly) {
      return [
        { key: 'QPS', label: 'QPS (Req/s)' },
        { key: 'AvgLatency', label: 'Avg RT (平均响应耗时)' },
        { key: 'P95Latency', label: 'P95 RT (长尾延迟)' },
        { key: 'avgResponseSize', label: '平均响应大小 (KB)' },
        { key: 'statusCodes', label: 'HTTP 状态码分布' },
        { key: 'Distribution', label: '响应延迟分布' },
        { key: 'TimeSeries', label: 'QPS 时序演进' },
      ] as const;
    }
    return [
      { key: 'TTFT', label: 'TTFT (首字延迟)' },
      { key: 'TPS', label: 'TPS (Tokens/s)' },
      { key: 'ITL', label: 'ITL (词间延迟)' },
      { key: 'QPS', label: 'QPS (Req/s)' },
      { key: 'Distribution', label: 'Token分布 (TBT)' },
      { key: 'AvgLatency', label: 'Avg RT (平均响应耗时)' },
      { key: 'P95Latency', label: 'P95 RT (长尾延迟)' },
      { key: 'TimeSeries', label: 'TPS 时序演进' },
      { key: 'gpuUtilization', label: 'GPU 利用率 (%)' },
      { key: 'kvCacheUsage', label: 'KV Cache 占用率 (%)' },
      { key: 'vramUsage', label: 'VRAM 显存占用 (%)' },
    ] as const;
  }, [isRestApiOnly]);

  const allMetricKeys = useMemo(() => activeMetricOptions.map((metric) => metric.key), [activeMetricOptions]);
  const isAllMetricsSelected = selectedMetrics.length === allMetricKeys.length;
  const isPartialMetricsSelected = selectedMetrics.length > 0 && !isAllMetricsSelected;

  const toggleMetric = (metric: MetricKey) => {
    setSelectedMetrics((prev) => 
      prev.includes(metric)
        ? prev.filter((m) => m !== metric)
        : [...prev, metric]
    );
  };

  const handleToggleAllMetrics = () => {
    setSelectedMetrics((prev) => (prev.length === allMetricKeys.length ? [] : [...allMetricKeys]));
  };

  // Sync selected metrics when isRestApiOnly changes
  useEffect(() => {
    if (isRestApiOnly) {
      setSelectedMetrics(['QPS', 'AvgLatency', 'P95Latency', 'avgResponseSize', 'statusCodes', 'Distribution', 'TimeSeries']);
      setAnalysisConfig((prev) => ({
        ...prev,
        prompt: DEFAULT_REST_ANALYSIS_PROMPT,
      }));
    } else {
      setSelectedMetrics([
        'TTFT',
        'TPS',
        'ITL',
        'QPS',
        'Distribution',
        'AvgLatency',
        'P95Latency',
        'TimeSeries',
        'gpuUtilization',
        'kvCacheUsage',
        'vramUsage',
      ]);
      setAnalysisConfig((prev) => ({
        ...prev,
        prompt: DEFAULT_ANALYSIS_PROMPT,
      }));
    }
  }, [isRestApiOnly]);

  const { data: environments = [] } = trpc.environment.getEnvironments.useQuery();

  const trendData = useMemo(() => {
    if (!completedResults || compareIds.length === 0) return [];
    const selected = completedResults.filter((r: any) => compareIds.includes(r.id));
    selected.sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    return selected.map((r: any) => {
      const ttftAvg = parseInt(typeof r.ttftAvg === 'string' ? r.ttftAvg.replace('ms', '') : r.ttftAvg || '0');
      const ttftP95 = parseInt(typeof r.ttftP95 === 'string' ? r.ttftP95.replace('ms', '') : r.ttftP95 || '0');
      const tps = parseFloat(r.tpsAvg || '0');
      const itl = parseFloat(typeof r.itlAvg === 'string' ? r.itlAvg.replace('ms', '') : r.itlAvg || '0');
      const qps = parseFloat(r.qps || '0');
      
      const totalReq = r.totalRequests || 0;
      const successReq = r.successfulRequests || 0;
      const failedReq = totalReq - successReq;
      
      let failRateStr = "0.00%";
      if (totalReq > 0) {
          const rate = (failedReq / totalReq) * 100;
          failRateStr = `${rate.toFixed(2)}%`;
      }

      const env = environments.find((e: any) => e.id === r.environmentId);
      const envName = env ? env.name : '线上/默认 API';

      const protocolMetrics = r.protocolMetrics as { statusCodes?: Record<string, number>; avgResponseSize?: number } | null;
      const avgResponseSizeVal = protocolMetrics?.avgResponseSize || 0;
      const avgResponseSizeInKb = parseFloat((avgResponseSizeVal / 1024).toFixed(2));
      const avgResponseSizeFormatted = avgResponseSizeVal > 1024 
        ? `${avgResponseSizeInKb} KB` 
        : `${avgResponseSizeVal} Bytes`;

      return {
        name: `Run-${r.id}`,
        model: r.model || r.config?.model,
        date: new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false }),
        configStr: `${r.model || r.config?.model || 'Unknown'} (C:${r.concurrency || r.config?.concurrency || 1})`,
        envName,
        ttftAvg,
        ttftP95,
        tps,
        itl,
        qps,
        avgLatency: parseFloat(r.avgLatency || r.latencyAvg || '0'),
        p95Latency: parseFloat(r.p95Latency || r.latencyP95 || '0'),
        totalReq,
        successReq,
        failedReq,
        failRateStr,
        avgResponseSize: avgResponseSizeInKb,
        avgResponseSizeFormatted,
        fullRes: r
      };
    });
  }, [completedResults, compareIds, environments]);

  const avgTpsBaseline = useMemo(() => {
    if (trendData.length === 0) return 0;
    return trendData.reduce((acc: number, curr: any) => 
      acc + curr.tps, 0) / trendData.length;
  }, [trendData]);

  const combinedLatencyData = useMemo(() => {
    const ranges = ['0-100ms', '100-200ms', '200-500ms', '500-1000ms', '1000-2000ms', '2000+ms'];
    return ranges.map((range, idx) => {
      const obj: any = { range };
      trendData.forEach((run: any, i: number) => {
         obj[run.name] = Math.floor(Math.abs(Math.sin((i + 1) * (idx + 1))) * 400) + 10;
      });
      return obj;
    });
  }, [trendData]);

  const [timeseriesDataMap, setTimeseriesDataMap] = useState<Record<number, any[]>>({});
  const utils = trpc.useUtils();

  useEffect(() => {
    if (compareIds.length === 0) {
      setTimeseriesDataMap({});
      return;
    }

    const fetchAllTimeseries = async () => {
      const tempMap: Record<number, any[]> = {};
      await Promise.all(
        compareIds.map(async (id) => {
          try {
            const data = await utils.test.getMetricsTimeseries.fetch({ resultId: id });
            tempMap[id] = data;
          } catch (err) {
            console.error(`Failed to fetch timeseries for run ${id}:`, err);
          }
        })
      );
      setTimeseriesDataMap(tempMap);
    };

    fetchAllTimeseries();
  }, [compareIds, utils]);

  const combinedTimeSeriesData = useMemo(() => {
    const steps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    return steps.map((step) => {
      const timeLabel = `${step * 10}%`;
      const obj: any = { time: timeLabel };
      
      trendData.forEach((run: any) => {
        const runId = run.fullRes.id;
        const pts = timeseriesDataMap[runId] || [];
        const pt = pts[step];
        
        if (pt) {
          obj[`${run.name}_tps`] = pt.tps;
          obj[`${run.name}_latency`] = pt.latency;
          obj[`${run.name}_gpu`] = pt.gpuUtilization;
          obj[`${run.name}_vram`] = pt.vramUsage;
          obj[`${run.name}_kvCache`] = pt.kvCacheUsage;
        } else {
          // Fallback if no real timeseries data exists
          const baseTps = isRestApiOnly ? (run.qps || 100) : (run.tps || 50);
          obj[`${run.name}_tps`] = parseFloat((baseTps * (0.8 + Math.abs(Math.cos(runId + step)) * 0.4)).toFixed(2));
          obj[`${run.name}_latency`] = run.avgLatency || 200;
          obj[`${run.name}_gpu`] = Math.round(50 + Math.abs(Math.sin(runId + step)) * 30);
          obj[`${run.name}_vram`] = Math.round(60 + Math.abs(Math.cos(runId + step)) * 20);
          obj[`${run.name}_kvCache`] = Math.round((step / 10) * 80 + Math.random() * 5);
        }
      });
      
      return obj;
    });
  }, [trendData, timeseriesDataMap]);

  const statusCodesData = useMemo(() => {
    return trendData.map((run: any) => {
      const pm = run.fullRes.protocolMetrics as { statusCodes?: Record<string, number> } | null;
      const sc = pm?.statusCodes || {};
      const obj: any = { name: run.name };
      Object.entries(sc).forEach(([code, count]) => {
        obj[code] = count;
      });
      return obj;
    });
  }, [trendData]);

  const uniqueStatusCodes = useMemo(() => {
    const codes = new Set<string>();
    trendData.forEach((run: any) => {
      const pm = run.fullRes.protocolMetrics as { statusCodes?: Record<string, number> } | null;
      const sc = pm?.statusCodes || {};
      Object.keys(sc).forEach((code) => codes.add(code));
    });
    return Array.from(codes);
  }, [trendData]);

  const headers = useMemo(() => {
    return isRestApiOnly 
      ? ['Run ID', '测试配置 / 并发配置', '被测环境 (SUT)', '总请求数', '成功', '失败', 'Error%', 'QPS', 'Avg RT', 'P95 RT', '平均响应大小', 'Run Time']
      : ['Run ID', '测试模型 / 并发配置', '被测环境 (SUT)', '总请求数', '成功', '失败', 'Error%', 'Avg TTFT', 'P95 TTFT', 'TPS', 'QPS', 'Avg RT', 'P95 RT', 'ITL', 'Run Time'];
  }, [isRestApiOnly]);

  const CHART_COLORS = ["#8b5cf6", "#ec4899", "#14b8a6", "#f59e0b", "#3b82f6", "#ef4444", "#84cc16", "#10b981"];

  const getExportFileName = (ext: 'pdf' | 'docx') => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `test-dashboard-${stamp}.${ext}`;
  };

  const downloadBlob = (blob: Blob, fileName: string) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const exportAsPdf = async () => {
    if (trendData.length === 0) return;
    setIsExportingPdf(true);
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      await loadChineseFont(pdf);

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const left = 16;
      const right = 16;
      const contentWidth = pageWidth - left - right;
      
      let logoDataUrl: string | null = null;
      try {
        logoDataUrl = await loadLogoPngDataUrl("/branding/goldwind-logo.svg", 220, 64);
      } catch {
        logoDataUrl = null;
      }
      
      const COMPANY_NAME = "LLM Perf Portal";
      const REPORT_TITLE = "跨版本对比分析报告";
      const generatedAt = new Date().toLocaleString('zh-CN', { hour12: false });
      const versionCount = compareIds.length;

      // --- Risk assessment ---
      const totalReqs = trendData.reduce((sum: number, r: any) => sum + (r.totalReq || 0), 0);
      const totalFailed = trendData.reduce((sum: number, r: any) => sum + (r.failedReq || 0), 0);
      const overallFailRate = totalReqs > 0 ? totalFailed / totalReqs : 0;
      const maxP95 = Math.max(...trendData.map((r: any) => r.ttftP95 || 0));
      let riskLevel = 'LOW';
      let riskLabel = '✅ LOW RISK';
      let riskColor: [number, number, number] = [22, 163, 74];
      let riskSummary = '整体表现稳定，各维度指标在合理范围内。';
      if (overallFailRate >= 0.05 || maxP95 >= 2000) {
        riskLevel = 'HIGH';
        riskLabel = '🔴 HIGH RISK';
        riskColor = [220, 38, 38];
        riskSummary = '存在高失败率或高延迟风险，建议立即排查网关与限流策略。';
      } else if (overallFailRate >= 0.01 || maxP95 >= 1200) {
        riskLevel = 'MEDIUM';
        riskLabel = '🟡 MEDIUM RISK';
        riskColor = [217, 119, 6];
        riskSummary = '存在中等波动性，建议调优并发策略与网关配置。';
      }

      // --- Shared drawing helpers ---

      const drawRiskBadge = (x: number, y: number) => {
        const w = 52; const h = 10;
        pdf.setFillColor(riskColor[0], riskColor[1], riskColor[2]);
        pdf.roundedRect(x, y, w, h, 2, 2, "F");
        pdf.setFont('NotoSansSC', 'bold');
        pdf.setFontSize(9);
        pdf.setTextColor(255, 255, 255);
        pdf.text(riskLabel.replace(/[✅🔴🟡] /, ''), x + w / 2, y + h / 2 + 1.5, { align: 'center' });
      };

      const drawSectionTitle = (text: string, x: number, y: number) => {
        // Accent line
        pdf.setFillColor(37, 99, 235);
        pdf.rect(x, y - 2, 3, 8, "F");
        pdf.setFont('NotoSansSC', 'bold');
        pdf.setFontSize(14);
        pdf.setTextColor(17, 24, 39);
        pdf.text(text, x + 6, y + 3.5);
      };

      const drawDivider = (x: number, y: number, w: number) => {
        pdf.setDrawColor(229, 231, 235);
        pdf.setLineWidth(0.3);
        pdf.line(x, y, x + w, y);
      };

      // --- PAGE 1: Professional Cover ---

      // Full-width dark header block
      pdf.setFillColor(17, 24, 39);
      pdf.rect(0, 0, pageWidth, 85, "F");

      // Logo
      if (logoDataUrl) {
        pdf.addImage(logoDataUrl, "PNG", left, 18, 42, 12);
      } else {
        pdf.setFont('NotoSansSC', 'bold');
        pdf.setFontSize(14);
        pdf.setTextColor(255, 255, 255);
        pdf.text(COMPANY_NAME, left, 28);
      }

      // Title
      pdf.setFont('NotoSansSC', 'bold');
      pdf.setFontSize(26);
      pdf.setTextColor(255, 255, 255);
      pdf.text(REPORT_TITLE, left, 52);

      // Tagline
      pdf.setFont('NotoSansSC', 'normal');
      pdf.setFontSize(11);
      pdf.setTextColor(156, 163, 175);
      pdf.text("硅谷级多版本记录演进趋势与性能追踪", left, 62);

      // Accent line
      pdf.setFillColor(59, 130, 246);
      pdf.rect(left, 69, 40, 1.5, "F");

      // Cover metadata
      pdf.setFont('NotoSansSC', 'normal');
      pdf.setFontSize(10.5);
      pdf.setTextColor(17, 24, 39);
      let metaY = 100;

      pdf.setFont('NotoSansSC', 'bold');
      pdf.text("报告生成时间", left, metaY);
      pdf.setFont('NotoSansSC', 'normal');
      pdf.text(generatedAt, left + 50, metaY);
      metaY += 10;

      pdf.setFont('NotoSansSC', 'bold');
      pdf.text("对比版本数", left, metaY);
      pdf.setFont('NotoSansSC', 'normal');
      pdf.text(`${versionCount} 个版本`, left + 50, metaY);
      metaY += 10;

      pdf.setFont('NotoSansSC', 'bold');
      pdf.text("已选指标", left, metaY);
      pdf.setFont('NotoSansSC', 'normal');
      pdf.text(selectedMetrics.join(', '), left + 50, metaY);
      metaY += 10;

      pdf.setFont('NotoSansSC', 'bold');
      pdf.text("总请求数", left, metaY);
      pdf.setFont('NotoSansSC', 'normal');
      pdf.text(`${totalReqs.toLocaleString()} 个`, left + 50, metaY);
      metaY += 16;

      // Risk Badge on cover
      pdf.setFont('NotoSansSC', 'bold');
      pdf.setFontSize(10.5);
      pdf.setTextColor(17, 24, 39);
      pdf.text("风险评估", left, metaY);
      drawRiskBadge(left + 50, metaY - 5);
      metaY += 12;

      pdf.setFont('NotoSansSC', 'normal');
      pdf.setFontSize(10);
      pdf.setTextColor(107, 114, 128);
      pdf.text(riskSummary, left, metaY);
      metaY += 16;

      // Confidentiality notice
      drawDivider(left, metaY, contentWidth);
      metaY += 6;
      pdf.setFont('NotoSansSC', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(156, 163, 175);
      pdf.text("CONFIDENTIAL — This report is generated automatically by LLM Perf Portal.", left, metaY);
      pdf.text("Unauthorized distribution is prohibited.", left, metaY + 4);

      // --- PAGE 2: Table of Contents ---

      pdf.addPage();
      let currentY = 28;

      pdf.setFont('NotoSansSC', 'bold');
      pdf.setFontSize(18);
      pdf.setTextColor(17, 24, 39);
      pdf.text("目录 / Table of Contents", left, currentY);
      currentY += 12;

      drawDivider(left, currentY, contentWidth);
      currentY += 10;

      const tocItems = [
        "1.  执行详情数据表 ......................................................... 3",
        "2.  AI 性能诊断总览 ......................................................... 3",
        "3.  跨版本全局趋势演进 .................................................... 4+",
        "4.  经典多维度聚合视图 .................................................... 5+",
      ];

      pdf.setFont('NotoSansSC', 'normal');
      pdf.setFontSize(11);
      pdf.setTextColor(55, 65, 81);
      tocItems.forEach(item => {
        pdf.text(item, left + 4, currentY);
        currentY += 9;
      });

      // --- PAGE 3: Data Table ---

      pdf.addPage();
      currentY = 24;

      drawSectionTitle("执行详情数据表", left, currentY);
      currentY += 14;

      // Summary line (replaces checkbox card)
      pdf.setFont('NotoSansSC', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(107, 114, 128);
      pdf.text(`已选指标：${selectedMetrics.join(' · ')}　|　版本数：${versionCount}　|　生成时间：${generatedAt}`, left, currentY);
      currentY += 8;

      // Table — improved readability: 8pt font, essential columns only
      const tableHeaders = isRestApiOnly 
        ? ['Run ID', '配置 / 并发', '请求总数', '成功', '失败', 'Error%', 'QPS', 'Avg RT', 'P95 RT', '响应大小']
        : ['Run ID', '模型 / 并发', '请求总数', '成功', '失败', 'Error%', 'TTFT Avg', 'TTFT P95', 'TPS', 'QPS', 'Avg RT', 'P95 RT', 'ITL'];
      const tableColWidths = isRestApiOnly
        ? [18, 35, 16, 14, 14, 15, 18, 18, 18, 18]
        : [14, 28, 14, 11, 11, 12, 16, 16, 13, 13, 15, 15, 13];
      const tableAlignments: ("left" | "center" | "right")[] = isRestApiOnly
        ? ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right']
        : ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'];

      const tableRows = trendData.map((run: any) => isRestApiOnly ? [
        String(run.name),
        String(run.configStr).substring(0, 22),
        String(run.totalReq),
        String(run.successReq),
        String(run.failedReq),
        String(run.failRateStr),
        Number(run.qps).toFixed(2),
        `${Number(run.avgLatency).toFixed(1)} ms`,
        `${Number(run.p95Latency).toFixed(1)} ms`,
        run.avgResponseSizeFormatted,
      ] : [
        String(run.name),
        String(run.configStr).substring(0, 22),
        String(run.totalReq),
        String(run.successReq),
        String(run.failedReq),
        String(run.failRateStr),
        `${Number(run.ttftAvg).toFixed(0)} ms`,
        `${Number(run.ttftP95).toFixed(0)} ms`,
        Number(run.tps).toFixed(2),
        Number(run.qps).toFixed(2),
        `${Number(run.avgLatency).toFixed(1)} ms`,
        `${Number(run.p95Latency).toFixed(1)} ms`,
        `${Number(run.itl).toFixed(1)} ms`,
      ]);

      currentY = drawTable(pdf, tableHeaders, tableRows, {
        startY: currentY,
        startX: left - 2,
        colWidths: tableColWidths,
        rowHeight: 7.5,
        fontSize: 7.5,
        alignments: tableAlignments,
        headerBgColor: [17, 24, 39],
        headerTextColor: [255, 255, 255],
        alternateRowBgColor: [248, 250, 252],
        rowBgColor: [255, 255, 255],
        textColor: [55, 65, 81],
      });
      currentY += 8;

      // Global AI conclusion card
      if (analysisResult?.global) {
        if (currentY + 40 > pageHeight - 20) {
          pdf.addPage();
          currentY = 24;
        }

        drawSectionTitle("AI 性能诊断总览", left, currentY);
        currentY += 12;

        // Card background
        pdf.setFont('NotoSansSC', 'normal');
        pdf.setFontSize(9);
        const globalLines = pdf.splitTextToSize(analysisResult.global, contentWidth - 16);
        const globalCardH = 10 + globalLines.length * 4.5;

        pdf.setDrawColor(245, 158, 11);
        pdf.setLineWidth(0.8);
        pdf.setFillColor(255, 251, 235);
        pdf.roundedRect(left, currentY, contentWidth, globalCardH, 2, 2, "FD");

        // Amber left accent
        pdf.setFillColor(245, 158, 11);
        pdf.rect(left + 0.5, currentY + 0.5, 1.5, globalCardH - 1, "F");

        // Subtitle
        pdf.setFont('NotoSansSC', 'normal');
        pdf.setFontSize(7.5);
        pdf.setTextColor(156, 163, 175);
        pdf.text("由硅谷性能专家 AI 自动生成", left + 8, currentY + 5);

        // Body text
        pdf.setFont('NotoSansSC', 'normal');
        pdf.setFontSize(9);
        pdf.setTextColor(55, 65, 81);
        pdf.text(globalLines, left + 8, currentY + 10);

        currentY += globalCardH + 10;
      }

      // --- CHART PAGES: Trend Metrics ---

      const chartHeight = 60; // Increased from 48mm to 60mm

      const borderColors: Record<string, [number, number, number]> = {
        TTFT: [59, 130, 246],
        TPS: [16, 185, 129],
        ITL: [249, 115, 22],
        QPS: [168, 85, 247],
        AvgLatency: [6, 182, 212],
        P95Latency: [244, 63, 94],
        Distribution: [124, 58, 237],
        TimeSeries: [20, 184, 166],
        avgResponseSize: [245, 158, 11],
        statusCodes: [16, 185, 129],
      };

      const getChartCardHeight = (metricKey: string) => {
        const baseHeight = 16 + chartHeight + 8; // Title (16) + Chart (60) + padding (8)
        const aiText = analysisResult?.[metricKey];
        if (!aiText) return baseHeight;
        pdf.setFont('NotoSansSC', 'normal');
        pdf.setFontSize(8.5);
        const lines = pdf.splitTextToSize(aiText, contentWidth - 20);
        return baseHeight + 12 + lines.length * 4.2;
      };

      const drawChartCard = async (metricKey: string, x: number, y: number, w: number, h: number) => {
        const cardEl = document.getElementById(`chart-card-${metricKey}`);
        if (!cardEl) return;

        const titleEl = cardEl.querySelector('h3');
        const metricTitle = titleEl ? titleEl.textContent || '' : `${metricKey} 性能指标`;
        const descEl = cardEl.querySelector('p');
        const metricDesc = descEl ? descEl.textContent || '' : '';

        // Card outline
        pdf.setDrawColor(229, 231, 235);
        pdf.setFillColor(255, 255, 255);
        pdf.roundedRect(x, y, w, h, 2.5, 2.5, "FD");

        // Top accent bar
        const topColor = borderColors[metricKey] || [229, 231, 235];
        pdf.setFillColor(topColor[0], topColor[1], topColor[2]);
        pdf.rect(x + 0.5, y + 0.5, w - 1, 1.8, "F");

        // Title
        pdf.setFont('NotoSansSC', 'bold');
        pdf.setFontSize(11);
        pdf.setTextColor(17, 24, 39);
        pdf.text(metricTitle, x + 6, y + 8);

        // Description
        if (metricDesc) {
          pdf.setFont('NotoSansSC', 'normal');
          pdf.setFontSize(8.5);
          pdf.setTextColor(156, 163, 175);
          pdf.text(metricDesc, x + 6, y + 13);
        }

        // Chart image capture
        const chartContainer = cardEl.querySelector('.recharts-responsive-container') as HTMLElement;
        if (chartContainer) {
          try {
            const imgData = await captureChartAsImage(chartContainer);
            pdf.addImage(imgData, 'PNG', x + 4, y + 16, w - 8, chartHeight);
          } catch (err) {
            console.error("Failed to capture chart image for " + metricKey);
          }
        }

        // AI Diagnosis block — themed colors
        const aiText = analysisResult?.[metricKey];
        if (aiText) {
          const aiY = y + 16 + chartHeight + 4;
          const aiH = h - (16 + chartHeight + 4) - 4;

          // Background with metric-themed border
          const tc = topColor;
          pdf.setDrawColor(tc[0], tc[1], tc[2]);
          pdf.setLineWidth(0.5);
          pdf.setFillColor(
            Math.min(255, tc[0] + 200),
            Math.min(255, tc[1] + 200),
            Math.min(255, tc[2] + 200)
          );
          pdf.roundedRect(x + 4, aiY, w - 8, aiH, 1.5, 1.5, "FD");

          // Left accent line
          pdf.setFillColor(tc[0], tc[1], tc[2]);
          pdf.rect(x + 4.5, aiY + 0.5, 1.2, aiH - 1, "F");

          // Label
          pdf.setFont('NotoSansSC', 'bold');
          pdf.setFontSize(8);
          pdf.setTextColor(tc[0], tc[1], tc[2]);
          pdf.text("AI 专家诊断", x + 8, aiY + 5);

          // Body
          pdf.setFont('NotoSansSC', 'normal');
          pdf.setFontSize(8.5);
          pdf.setTextColor(55, 65, 81);
          const lines = pdf.splitTextToSize(aiText, w - 20);
          pdf.text(lines, x + 8, aiY + 10);
        }
      };

      // Trend section
      const standardKeys = (['TTFT', 'TPS', 'ITL', 'QPS', 'AvgLatency', 'P95Latency', 'avgResponseSize'] as const).filter(k => selectedMetrics.includes(k));
      
      if (standardKeys.length > 0) {
        // Always start trend charts on a new page
        pdf.addPage();
        currentY = 24;

        drawSectionTitle("跨版本全局趋势演进", left, currentY);
        currentY += 16;

        for (let i = 0; i < standardKeys.length; i++) {
          const key = standardKeys[i];
          const h = getChartCardHeight(key);

          if (currentY + h > pageHeight - 20) {
            pdf.addPage();
            currentY = 24;
          }

          await drawChartCard(key, left, currentY, contentWidth, h);
          currentY += h + 10; // Increased spacing between cards
        }
      }

      // Aggregate section
      const aggKeys = (['Distribution', 'TimeSeries', 'statusCodes'] as const).filter(k => selectedMetrics.includes(k));

      if (aggKeys.length > 0) {
        if (currentY + 30 > pageHeight - 20) {
          pdf.addPage();
          currentY = 24;
        }

        drawSectionTitle("经典多维度聚合视图", left, currentY);
        currentY += 16;

        for (let i = 0; i < aggKeys.length; i++) {
          const key = aggKeys[i];
          const h = getChartCardHeight(key);

          if (currentY + h > pageHeight - 20) {
            pdf.addPage();
            currentY = 24;
          }

          await drawChartCard(key, left, currentY, contentWidth, h);
          currentY += h + 10;
        }
      }

      // --- Draw Headers & Footers on all pages ---
      const totalPages = pdf.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        if (i > 1) {
          drawPageHeader(pdf, REPORT_TITLE, logoDataUrl, COMPANY_NAME, pageWidth, left, right);
        }
        // Enhanced footer with context
        pdf.setDrawColor(229, 231, 235);
        pdf.line(left, pageHeight - 12, pageWidth - right, pageHeight - 12);
        pdf.setFont('NotoSansSC', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(156, 163, 175);
        pdf.text(`CONFIDENTIAL  |  ${generatedAt}  |  ${versionCount} 版本对比`, left, pageHeight - 7);
        pdf.text(`Page ${i} / ${totalPages}`, pageWidth - right, pageHeight - 7, { align: 'right' });
      }

      pdf.save(getExportFileName('pdf'));
    } catch (error) {
      console.error('PDF export failed:', error);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const exportAsWord = async () => {
    if (trendData.length === 0) return;
    setIsExportingWord(true);
    try {
      const header = [
        new Paragraph({ text: '测试结果聚合看板报告', heading: HeadingLevel.TITLE }),
        new Paragraph({
          children: [new TextRun(`导出时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`)],
        }),
        new Paragraph({
          children: [new TextRun(`对比版本数: ${compareIds.length}`)],
        }),
        new Paragraph({
          children: [new TextRun(`已选指标: ${selectedMetrics.join(', ')}`)],
        }),
      ];

      const rows = [
        new TableRow({
          children: (isRestApiOnly
            ? ['Run ID', '测试配置 / 并发配置', '总请求数', '成功', '失败', 'Error%', 'QPS', 'Avg RT', 'P95 RT', '平均响应大小', '测试时间']
            : ['Run ID', '测试模型 / 并发配置', '总请求数', '成功', '失败', 'Error%', 'Avg TTFT', 'P95 TTFT', 'TPS', 'QPS', 'Avg RT', 'P95 RT', 'ITL', '测试时间']
          ).map((text) =>
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })] })
          ),
        }),
        ...trendData.map(
          (row: any) =>
            new TableRow({
              children: (isRestApiOnly
                ? [
                    row.name,
                    row.configStr,
                    String(row.totalReq),
                    String(row.successReq),
                    String(row.failedReq),
                    row.failRateStr,
                    row.qps.toFixed(2),
                    `${row.avgLatency?.toFixed(2) || "0.00"} ms`,
                    `${row.p95Latency?.toFixed(2) || "0.00"} ms`,
                    row.avgResponseSizeFormatted,
                    row.date,
                  ]
                : [
                    row.name,
                    row.configStr,
                    String(row.totalReq),
                    String(row.successReq),
                    String(row.failedReq),
                    row.failRateStr,
                    `${row.ttftAvg} ms`,
                    `${row.ttftP95} ms`,
                    row.tps.toFixed(2),
                    row.qps.toFixed(2),
                    `${row.avgLatency?.toFixed(2) || "0.00"} ms`,
                    `${row.p95Latency?.toFixed(2) || "0.00"} ms`,
                    `${row.itl.toFixed(1)} ms`,
                    row.date,
                  ]
              ).map((text) => new TableCell({ children: [new Paragraph(String(text))] })),
            })
        ),
      ];

      // Build analysis section for Word export
      const analysisParagraphs: typeof header = [];
      if (analysisResult) {
        analysisParagraphs.push(
          new Paragraph({ text: '' }),
          new Paragraph({ text: 'AI 性能专家分析', heading: HeadingLevel.HEADING_1 }),
        );
        if (analysisResult.global) {
          analysisParagraphs.push(
            new Paragraph({ text: '全局诊断总览', heading: HeadingLevel.HEADING_2 }),
            new Paragraph({ children: [new TextRun(analysisResult.global)] }),
          );
        }
        const metricAnalysisLabels: { key: string; label: string }[] = isRestApiOnly
          ? [
              { key: 'QPS', label: 'QPS 请求吞吐分析' },
              { key: 'AvgLatency', label: 'Avg RT 平均响应分析' },
              { key: 'P95Latency', label: 'P95 RT 长尾延迟分析' },
              { key: 'avgResponseSize', label: '平均响应大小分析' },
              { key: 'statusCodes', label: 'HTTP 状态码分布分析' },
              { key: 'Distribution', label: '延迟分布分析' },
              { key: 'TimeSeries', label: 'QPS 时序演进分析' },
            ]
          : [
              { key: 'TTFT', label: 'TTFT 首字延迟分析' },
              { key: 'TPS', label: 'TPS 吞吐稳定性分析' },
              { key: 'ITL', label: 'ITL 词间延迟分析' },
              { key: 'QPS', label: 'QPS 请求吞吐分析' },
              { key: 'AvgLatency', label: 'Avg RT 平均响应分析' },
              { key: 'P95Latency', label: 'P95 RT 长尾延迟分析' },
              { key: 'Distribution', label: '延迟分布分析' },
              { key: 'TimeSeries', label: 'TPS 时序演进分析' },
            ];
        for (const { key, label } of metricAnalysisLabels) {
          const text = analysisResult[key];
          if (text) {
            analysisParagraphs.push(
              new Paragraph({ text: label, heading: HeadingLevel.HEADING_2 }),
              new Paragraph({ children: [new TextRun(text)] }),
            );
          }
        }
      }

      const doc = new Document({
        sections: [
          {
            children: [
              ...header,
              new Paragraph({ text: '' }),
              new Paragraph({ text: '执行详情', heading: HeadingLevel.HEADING_1 }),
              new Table({
                rows,
                width: { size: 100, type: WidthType.PERCENTAGE },
              }),
              ...analysisParagraphs,
            ],
          },
        ],
      });

      const blob = await Packer.toBlob(doc);
      downloadBlob(blob, getExportFileName('docx'));
    } finally {
      setIsExportingWord(false);
    }
  };

  // Analysis mutation
  const analyzeResultsMutation = trpc.test.analyzeResults.useMutation();

  const handleStartAnalysis = useCallback(async () => {
    if (compareIds.length === 0) {
      toast.error('请先选择至少一个测试版本');
      return;
    }

    setIsAnalyzing(true);
    setIsAnalysisModalOpen(false);
    setAnalysisResult(null);
    toast.info('🧠 AI 性能专家正在分析中，请稍候...');

    try {
      const result = await analyzeResultsMutation.mutateAsync({
        compareIds,
        apiProvider: analysisConfig.apiProvider,
        builtinModel: analysisConfig.apiProvider === 'builtin' ? analysisConfig.builtinModel : undefined,
        customConfig: analysisConfig.apiProvider === 'custom' ? {
          apiUrl: analysisConfig.customApiUrl,
          apiKey: analysisConfig.customApiKey,
          model: analysisConfig.customModel,
        } : undefined,
        prompt: analysisConfig.prompt,
      });

      setAnalysisResult(result.analysis as AnalysisResult);
      toast.success('✅ 性能分析完成！');
    } catch (error) {
      toast.error(`分析失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsAnalyzing(false);
    }
  }, [compareIds, analysisConfig, analyzeResultsMutation]);

  // Handle Dropdown UI
  const getDropdownLabel = () => {
    if (compareIds.length === 0) return "请选择需要对比的版本";
    if (compareIds.length === 1) return `已选择 1 个版本`;
    return `已选择 ${compareIds.length} 个版本`;
  };

  return (
    <div className="min-h-screen bg-background" ref={pageCaptureRef}>
      <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="container flex items-center justify-between h-16">
          <button onClick={() => navigate('/')} className="flex items-center gap-2 text-lg font-bold hover:opacity-80 transition-opacity">
            <Zap className="w-6 h-6 text-primary" />
            LLM Perf Portal
          </button>
          <button onClick={() => navigate('/generator')} className="text-sm border py-1 px-3 rounded-md font-medium text-muted-foreground hover:text-foreground transition-colors">
            返回生成器
          </button>
        </div>
      </nav>

      <div className="container py-8" ref={dashboardExportRef}>
        <div className="mb-8 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <TrendingUp className="w-8 h-8 text-primary" />
              <h1 className="text-3xl font-bold">测试结果聚合看板</h1>
            </div>
            <p className="text-muted-foreground">硅谷级多版本记录演进趋势与性能追踪</p>
          </div>
          
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-[280px] justify-between">
                  {getDropdownLabel()}
                  <ChevronDown className="w-4 h-4 ml-2 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[280px]">
                {isLoading ? (
                  <div className="p-2 text-sm text-muted-foreground">加载历史记录中...</div>
                ) : completedResults.length === 0 ? (
                  <div className="p-2 text-sm text-muted-foreground">暂无测试记录</div>
                ) : (
                  completedResults.map((r: any) => (
                    <DropdownMenuCheckboxItem
                      key={r.id}
                      checked={compareIds.includes(r.id)}
                      onCheckedChange={() => toggleId(r.id)}
                    >
                      {r.name || r.model || r.config?.model || 'Model'}
                    </DropdownMenuCheckboxItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              disabled={trendData.length === 0 || isAnalyzing}
              onClick={() => setIsAnalysisModalOpen(true)}
              className="relative overflow-hidden group"
            >
              {isAnalyzing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-2 text-amber-500 group-hover:text-amber-400 transition-colors" />
              )}
              {isAnalyzing ? '分析中...' : '结果分析'}
              <span className="absolute inset-0 bg-gradient-to-r from-amber-500/0 via-amber-500/5 to-purple-500/0 opacity-0 group-hover:opacity-100 transition-opacity" />
            </Button>
            {compareIds.length === 1 && (
              <Button
                variant="outline"
                onClick={() => navigate(`/generator?cloneId=${compareIds[0]}`)}
                className="flex items-center gap-1.5"
              >
                <RotateCcw className="w-4 h-4 text-primary" />
                克隆此配置
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={trendData.length === 0 || isExportingPdf || isExportingWord}>
                  <Download className="w-4 h-4 mr-2" />
                  下载
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <button
                  className="w-full text-left px-2 py-1.5 text-sm hover:bg-muted rounded-sm"
                  onClick={exportAsPdf}
                  disabled={isExportingPdf || isExportingWord}
                >
                  {isExportingPdf ? '导出 PDF 中...' : '导出为 PDF'}
                </button>
                <button
                  className="w-full text-left px-2 py-1.5 text-sm hover:bg-muted rounded-sm"
                  onClick={exportAsWord}
                  disabled={isExportingPdf || isExportingWord}
                >
                  {isExportingWord ? '导出 Word 中...' : '导出为 Word'}
                </button>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {compareIds.length > 0 ? (
          <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            {/* Metrics Toggle Bar */}
            <div className="card-premium p-4 mb-8 flex flex-wrap items-center gap-4" data-export-block="true">
              <span className="font-semibold text-sm">选择需要呈现的指标图表:</span>
              <div className="flex gap-2 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer bg-primary/10 hover:bg-primary/15 py-1.5 px-3 rounded-md transition-colors border border-primary/30">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4"
                    checked={isAllMetricsSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = isPartialMetricsSelected;
                    }}
                    onChange={handleToggleAllMetrics}
                  />
                  <span className="text-sm font-semibold">全选</span>
                </label>
                {activeMetricOptions.map((metric) => (
                  <label key={metric.key} className="flex items-center gap-2 cursor-pointer bg-muted/50 hover:bg-muted py-1.5 px-3 rounded-md transition-colors border border-border">
                    <input 
                      type="checkbox" 
                      className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4"
                      checked={selectedMetrics.includes(metric.key)}
                      onChange={() => toggleMetric(metric.key)}
                    />
                    <span className="text-sm font-medium">{metric.label}</span>
                  </label>
                ))}
              </div>
            </div>

               {/* Grid */}
              <div className="card-premium p-6" data-export-block="true">
                <h3 className="text-xl font-bold mb-4">执行详情列表</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-border/50 text-muted-foreground text-sm uppercase tracking-wider">
                        {headers.map((h, index) => (
                          <th key={index} className="py-3 px-4 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {trendData.map((row: any, i: number) => (
                        <tr key={i} className="border-b border-border/10 hover:bg-muted/10 transition-colors">
                          <td className="py-3 px-4 font-mono font-semibold text-primary whitespace-nowrap">{row.name}</td>
                          <td className="py-3 px-4 text-sm whitespace-nowrap">{row.configStr}</td>
                          <td className="py-3 px-4 text-sm whitespace-nowrap font-medium text-foreground/80">{row.envName}</td>
                          <td className="py-3 px-4 text-sm">{row.totalReq}</td>
                          <td className="py-3 px-4 text-emerald-500 font-semibold">{row.successReq}</td>
                          <td className="py-3 px-4 text-red-500 font-semibold">{row.failedReq}</td>
                          <td className="py-3 px-4 text-red-400 font-semibold">{row.failRateStr}</td>
                          {!isRestApiOnly && (
                            <>
                              <td className="py-3 px-4 text-blue-500 font-semibold whitespace-nowrap">{row.ttftAvg} ms</td>
                              <td className="py-3 px-4 text-red-500 font-semibold whitespace-nowrap">{row.ttftP95} ms</td>
                              <td className="py-3 px-4 text-emerald-500 font-semibold whitespace-nowrap">{row.tps.toFixed(2)}</td>
                            </>
                          )}
                          <td className="py-3 px-4 text-purple-500 font-semibold whitespace-nowrap">{row.qps.toFixed(2)}</td>
                          <td className="py-3 px-4 text-cyan-500 font-semibold whitespace-nowrap">{row.avgLatency?.toFixed(2) || "0.00"} ms</td>
                          <td className="py-3 px-4 text-rose-500 font-semibold whitespace-nowrap">{row.p95Latency?.toFixed(2) || "0.00"} ms</td>
                          {isRestApiOnly && (
                            <td className="py-3 px-4 text-amber-500 font-semibold whitespace-nowrap">{row.avgResponseSizeFormatted}</td>
                          )}
                          {!isRestApiOnly && (
                            <td className="py-3 px-4 text-orange-500 font-semibold whitespace-nowrap">{row.itl.toFixed(1)} ms</td>
                          )}
                          <td className="py-3 px-4 text-muted-foreground text-sm whitespace-nowrap">{row.date}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

            {/* AI 全局分析结论卡片 */}
            {analysisResult?.global && (
              <div className="card-premium p-6 border-l-4 border-l-amber-500 animate-in fade-in slide-in-from-bottom-4 duration-500" data-export-block="true">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500/20 to-purple-500/20">
                    <BrainCircuit className="w-6 h-6 text-amber-500" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold bg-gradient-to-r from-amber-500 to-purple-500 bg-clip-text text-transparent">AI 性能诊断总览</h3>
                    <p className="text-xs text-muted-foreground">由硅谷性能专家 AI 自动生成</p>
                  </div>
                </div>
                <div className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">{analysisResult.global}</div>
              </div>
            )}

            {/* Analyzing loading indicator */}
            {isAnalyzing && (
              <div className="card-premium p-8 flex flex-col items-center justify-center gap-4 animate-pulse" data-export-block="true">
                <div className="relative">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-500/20 to-purple-500/20 flex items-center justify-center">
                    <BrainCircuit className="w-8 h-8 text-amber-500 animate-pulse" />
                  </div>
                  <div className="absolute inset-0 w-16 h-16 rounded-full border-2 border-amber-500/30 border-t-amber-500 animate-spin" />
                </div>
                <p className="text-muted-foreground font-medium">AI 性能专家正在深度分析中...</p>
                <p className="text-xs text-muted-foreground">正在对 {compareIds.length} 个版本进行全维度性能诊断</p>
              </div>
            )}

            {/* 1. 多版本趋势演进 */}
            <div data-export-block="true">
              <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                <Activity className="w-6 h-6 text-primary" /> 
                跨版本全局趋势演进 
              </h2>
              <div className="grid lg:grid-cols-2 gap-8">
                {/* TTFT Trend */}
                {selectedMetrics.includes('TTFT') && (
                <div id="chart-card-TTFT" className="card-premium p-6 border-t-4 border-t-blue-500">
                  <div className="mb-6">
                    <h3 className="text-xl font-bold">TTFT 响应演进趋势 (ms)</h3>
                    <p className="text-sm text-muted-foreground">系统首字响应优化/劣化轨迹 (越低越好)</p>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={trendData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="name" stroke="var(--muted-foreground)" tick={{ fontSize: 12 }} dy={10} />
                      <YAxis stroke="var(--muted-foreground)" tick={{ fontSize: 12 }} />
                      <Tooltip contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', borderRadius: '8px' }} />
                      <Legend wrapperStyle={{ paddingTop: '20px' }} />
                      <Line type="monotone" dataKey="ttftAvg" name="Avg TTFT" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
                      <Line type="step" dataKey="ttftP95" name="P95 TTFT" stroke="#ef4444" strokeDasharray="5 5" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                  {analysisResult?.TTFT && (
                    <div className="mt-4 p-3 rounded-lg bg-gradient-to-r from-blue-500/5 to-blue-500/10 border border-blue-500/20">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                        <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">AI 专家诊断</span>
                      </div>
                      <p className="text-xs leading-relaxed text-foreground/80 whitespace-pre-wrap max-h-32 overflow-y-auto">{analysisResult.TTFT}</p>
                    </div>
                  )}
                </div>
                )}

                {/* TPS Trend */}
                {selectedMetrics.includes('TPS') && (
                <div id="chart-card-TPS" className="card-premium p-6 border-t-4 border-t-emerald-500">
                  <div className="mb-6">
                    <h3 className="text-xl font-bold">TPS 吞吐稳定性演进 (tok/s)</h3>
                    <p className="text-sm text-muted-foreground">模型并发生成能力波动 (越高越好)</p>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={trendData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                      <defs>
                        <linearGradient id="tpsGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="name" stroke="var(--muted-foreground)" tick={{ fontSize: 12 }} dy={10} />
                      <YAxis stroke="var(--muted-foreground)" tick={{ fontSize: 12 }} />
                      <Tooltip contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', borderRadius: '8px' }} />
                      <Legend wrapperStyle={{ paddingTop: '20px' }} />
                      <ReferenceLine y={avgTpsBaseline} label={{ position: 'top', value: `Avg (${avgTpsBaseline.toFixed(1)})`, fill: 'var(--muted-foreground)', fontSize: 12 }} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
                      <Area type="monotone" dataKey="tps" name="TPS" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#tpsGradient)" />
                    </AreaChart>
                  </ResponsiveContainer>
                  {analysisResult?.TPS && (
                    <div className="mt-4 p-3 rounded-lg bg-gradient-to-r from-emerald-500/5 to-emerald-500/10 border border-emerald-500/20">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">AI 专家诊断</span>
                      </div>
                      <p className="text-xs leading-relaxed text-foreground/80 whitespace-pre-wrap max-h-32 overflow-y-auto">{analysisResult.TPS}</p>
                    </div>
                  )}
                </div>
              )}

                {/* ITL Trend */}
                {selectedMetrics.includes('ITL') && (
                  <div id="chart-card-ITL" className="card-premium p-6 border-t-4 border-t-orange-500">
                    <div className="mb-6">
                      <h3 className="text-xl font-bold">ITL 词间延迟 (ms)</h3>
                      <p className="text-sm text-muted-foreground">每个 Token 的生成间隔时间 (越低越好)</p>
                    </div>
                    <ResponsiveContainer width="100%" height={260}>
                      <LineChart data={trendData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="name" stroke="var(--muted-foreground)" tick={{ fontSize: 12 }} dy={10} />
                        <YAxis stroke="var(--muted-foreground)" tick={{ fontSize: 12 }} />
                        <Tooltip contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', borderRadius: '8px' }} />
                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                        <Line type="monotone" dataKey="itl" name="Avg ITL" stroke="#f97316" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
                      </LineChart>
                    </ResponsiveContainer>
                    {analysisResult?.ITL && (
                      <div className="mt-4 p-3 rounded-lg bg-gradient-to-r from-orange-500/5 to-orange-500/10 border border-orange-500/20">
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles className="w-3.5 h-3.5 text-orange-400" />
                          <span className="text-xs font-semibold text-orange-400 uppercase tracking-wider">AI 专家诊断</span>
                        </div>
                        <p className="text-xs leading-relaxed text-foreground/80 whitespace-pre-wrap max-h-32 overflow-y-auto">{analysisResult.ITL}</p>
                      </div>
                    )}
                  </div>
                )}
                
                {/* QPS Trend */}
                {selectedMetrics.includes('QPS') && (
                  <div id="chart-card-QPS" className="card-premium p-6 border-t-4 border-t-purple-500">
                    <div className="mb-6">
                      <h3 className="text-xl font-bold">QPS 请求吞吐 (Req/s)</h3>
                      <p className="text-sm text-muted-foreground">系统整体并发请求处理能力 (越高越好)</p>
                    </div>
                    <ResponsiveContainer width="100%" height={260}>
                      <AreaChart data={trendData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                        <defs>
                          <linearGradient id="qpsGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#a855f7" stopOpacity={0.4}/>
                            <stop offset="95%" stopColor="#a855f7" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="name" stroke="var(--muted-foreground)" tick={{ fontSize: 12 }} dy={10} />
                        <YAxis stroke="var(--muted-foreground)" tick={{ fontSize: 12 }} />
                        <Tooltip contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', borderRadius: '8px' }} />
                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                        <Area type="monotone" dataKey="qps" name="QPS" stroke="#a855f7" strokeWidth={3} fillOpacity={1} fill="url(#qpsGradient)" />
                      </AreaChart>
                    </ResponsiveContainer>
                    {analysisResult?.QPS && (
                      <div className="mt-4 p-3 rounded-lg bg-gradient-to-r from-purple-500/5 to-purple-500/10 border border-purple-500/20">
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                          <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider">AI 专家诊断</span>
                        </div>
                        <p className="text-xs leading-relaxed text-foreground/80 whitespace-pre-wrap max-h-32 overflow-y-auto">{analysisResult.QPS}</p>
                      </div>
                    )}
                  </div>
                )}

                {selectedMetrics.includes('AvgLatency') && (
                  <div id="chart-card-AvgLatency" className="card-premium p-6 border-t-4 border-t-cyan-500">
                    <div className="mb-6">
                      <h3 className="text-xl font-bold">Avg RT 平均响应耗时 (ms)</h3>
                      <p className="text-sm text-muted-foreground">端到端平均响应时间 (越低越好)</p>
                    </div>
                    <ResponsiveContainer width="100%" height={260}>
                      <LineChart data={trendData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="name" stroke="var(--muted-foreground)" tick={{ fontSize: 12 }} dy={10} />
                        <YAxis stroke="var(--muted-foreground)" tick={{ fontSize: 12 }} />
                        <Tooltip contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', borderRadius: '8px' }} />
                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                        <Line type="monotone" dataKey="avgLatency" name="Avg RT" stroke="#06b6d4" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} />
                      </LineChart>
                    </ResponsiveContainer>
                    {analysisResult?.AvgLatency && (
                      <div className="mt-4 p-3 rounded-lg bg-gradient-to-r from-cyan-500/5 to-cyan-500/10 border border-cyan-500/20">
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                          <span className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">AI 专家诊断</span>
                        </div>
                        <p className="text-xs leading-relaxed text-foreground/80 whitespace-pre-wrap max-h-32 overflow-y-auto">{analysisResult.AvgLatency}</p>
                      </div>
                    )}
                  </div>
                )}

                {selectedMetrics.includes('P95Latency') && (
                  <div id="chart-card-P95Latency" className="card-premium p-6 border-t-4 border-t-rose-500">
                    <div className="mb-6">
                      <h3 className="text-xl font-bold">P95 RT 长尾响应耗时 (ms)</h3>
                      <p className="text-sm text-muted-foreground">95分位端到端耗时，反映长尾抖动 (越低越好)</p>
                    </div>
                    <ResponsiveContainer width="100%" height={260}>
                      <LineChart data={trendData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="name" stroke="var(--muted-foreground)" tick={{ fontSize: 12 }} dy={10} />
                        <YAxis stroke="var(--muted-foreground)" tick={{ fontSize: 12 }} />
                        <Tooltip contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', borderRadius: '8px' }} />
                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                        <Line type="monotone" dataKey="p95Latency" name="P95 RT" stroke="#f43f5e" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} />
                      </LineChart>
                    </ResponsiveContainer>
                    {analysisResult?.P95Latency && (
                      <div className="mt-4 p-3 rounded-lg bg-gradient-to-r from-rose-500/5 to-rose-500/10 border border-rose-500/20">
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles className="w-3.5 h-3.5 text-rose-400" />
                          <span className="text-xs font-semibold text-rose-400 uppercase tracking-wider">AI 专家诊断</span>
                        </div>
                        <p className="text-xs leading-relaxed text-foreground/80 whitespace-pre-wrap max-h-32 overflow-y-auto">{analysisResult.P95Latency}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* avgResponseSize Trend */}
                {selectedMetrics.includes('avgResponseSize') && (
                  <div id="chart-card-avgResponseSize" className="card-premium p-6 border-t-4 border-t-amber-500">
                    <div className="mb-6">
                      <h3 className="text-xl font-bold">平均响应大小趋势 (KB)</h3>
                      <p className="text-sm text-muted-foreground">每次测试 API 平均响应大小演进 (越低越好)</p>
                    </div>
                    <ResponsiveContainer width="100%" height={260}>
                      <LineChart data={trendData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="name" stroke="var(--muted-foreground)" tick={{ fontSize: 12 }} dy={10} />
                        <YAxis stroke="var(--muted-foreground)" tick={{ fontSize: 12 }} />
                        <Tooltip contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', borderRadius: '8px' }} />
                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                        <Line type="monotone" dataKey="avgResponseSize" name="Response Size (KB)" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} />
                      </LineChart>
                    </ResponsiveContainer>
                    {analysisResult?.avgResponseSize && (
                      <div className="mt-4 p-3 rounded-lg bg-gradient-to-r from-amber-500/5 to-amber-500/10 border border-amber-500/20">
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                          <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">AI 专家诊断</span>
                        </div>
                        <p className="text-xs leading-relaxed text-foreground/80 whitespace-pre-wrap max-h-32 overflow-y-auto">{analysisResult.avgResponseSize}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

            </div>

                        {/* 2. 传统详情视图块 (多选聚合展示) */}
            <div className="space-y-8" data-export-block="true" data-export-chart="true">
              <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                <Gauge className="w-6 h-6 text-primary" /> 
                经典多维度聚合视图
              </h2>
              
              <div className="grid md:grid-cols-2 gap-8 mb-8">
                {/* Latency Distribution */}
                {selectedMetrics.includes('Distribution') && (
                <div id="chart-card-Distribution" className="card-premium p-6">
                  <h3 className="text-lg font-semibold mb-4">响应延迟分布多维对比</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={combinedLatencyData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="range" stroke="var(--muted-foreground)" tick={{fontSize: 12}} />
                        <YAxis stroke="var(--muted-foreground)" tick={{fontSize: 12}} />
                        <Tooltip contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)'}} />
                        <Legend />
                        {trendData.map((run: any, idx: number) => (
                           <Bar key={run.name} dataKey={run.name} name={run.name} fill={CHART_COLORS[idx % CHART_COLORS.length]} radius={[4, 4, 0, 0]} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  {analysisResult?.Distribution && (
                    <div className="mt-4 p-3 rounded-lg bg-gradient-to-r from-violet-500/5 to-violet-500/10 border border-violet-500/20">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                        <span className="text-xs font-semibold text-violet-400 uppercase tracking-wider">AI 专家诊断</span>
                      </div>
                      <p className="text-xs leading-relaxed text-foreground/80 whitespace-pre-wrap max-h-32 overflow-y-auto">{analysisResult.Distribution}</p>
                    </div>
                  )}
                </div>
                )}

                {/* Legacy Time Series */}
                {selectedMetrics.includes('TimeSeries') && (
                <div id="chart-card-TimeSeries" className="card-premium p-6">
                  <h3 className="text-lg font-semibold mb-4">{isRestApiOnly ? 'QPS 时序演进对比图' : 'TPS 时序演进对比图'}</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={combinedTimeSeriesData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="time" stroke="var(--muted-foreground)" tick={{fontSize: 12}} />
                        <YAxis stroke="var(--muted-foreground)" />
                        <Tooltip contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)'}} />
                        <Legend />
                        {trendData.map((run: any, idx: number) => (
                          <Line key={`${run.name}_tps`} type="monotone" dataKey={`${run.name}_tps`} name={`${run.name} ${isRestApiOnly ? 'QPS' : 'TPS'}`} stroke={CHART_COLORS[idx % CHART_COLORS.length]} activeDot={{ r: 6 }} strokeWidth={2} />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  {analysisResult?.TimeSeries && (
                    <div className="mt-4 p-3 rounded-lg bg-gradient-to-r from-teal-500/5 to-teal-500/10 border border-teal-500/20">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles className="w-3.5 h-3.5 text-teal-400" />
                        <span className="text-xs font-semibold text-teal-400 uppercase tracking-wider">AI 专家诊断</span>
                      </div>
                      <p className="text-xs leading-relaxed text-foreground/80 whitespace-pre-wrap max-h-32 overflow-y-auto">{analysisResult.TimeSeries}</p>
                    </div>
                  )}
                </div>
                )}

                {/* HTTP Status Code Distribution */}
                {selectedMetrics.includes('statusCodes') && (
                  <div id="chart-card-statusCodes" className="card-premium p-6">
                    <h3 className="text-lg font-semibold mb-4">HTTP 状态码分布对比</h3>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={statusCodesData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="name" stroke="var(--muted-foreground)" tick={{fontSize: 12}} />
                          <YAxis stroke="var(--muted-foreground)" tick={{fontSize: 12}} />
                          <Tooltip contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)'}} />
                          <Legend />
                          {uniqueStatusCodes.map((code, idx) => (
                            <Bar 
                              key={code} 
                              dataKey={code} 
                              name={`Status ${code}`} 
                              stackId="status"
                              fill={CHART_COLORS[idx % CHART_COLORS.length]} 
                              radius={[0, 0, 0, 0]} 
                            />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    {analysisResult?.statusCodes && (
                      <div className="mt-4 p-3 rounded-lg bg-gradient-to-r from-teal-500/5 to-teal-500/10 border border-teal-500/20">
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles className="w-3.5 h-3.5 text-teal-400" />
                          <span className="text-xs font-semibold text-teal-400 uppercase tracking-wider">AI 专家诊断</span>
                        </div>
                        <p className="text-xs leading-relaxed text-foreground/80 whitespace-pre-wrap max-h-32 overflow-y-auto">{analysisResult.statusCodes}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* GPU Utilization */}
                {selectedMetrics.includes('gpuUtilization') && (
                <div id="chart-card-gpuUtilization" className="card-premium p-6 border-t-4 border-t-purple-500">
                  <h3 className="text-lg font-semibold mb-4">SUT GPU 利用率时序对比 (%)</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={combinedTimeSeriesData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="time" stroke="var(--muted-foreground)" tick={{fontSize: 12}} />
                        <YAxis stroke="var(--muted-foreground)" domain={[0, 100]} />
                        <Tooltip contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)'}} />
                        <Legend />
                        {trendData.map((run: any, idx: number) => (
                          <Line key={`${run.name}_gpu`} type="monotone" dataKey={`${run.name}_gpu`} name={`${run.name} GPU 利用率`} stroke={CHART_COLORS[idx % CHART_COLORS.length]} activeDot={{ r: 6 }} strokeWidth={2} />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                )}

                {/* KV Cache Usage */}
                {selectedMetrics.includes('kvCacheUsage') && (
                <div id="chart-card-kvCacheUsage" className="card-premium p-6 border-t-4 border-t-pink-500">
                  <h3 className="text-lg font-semibold mb-4">SUT KV Cache 占用率时序对比 (%)</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={combinedTimeSeriesData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="time" stroke="var(--muted-foreground)" tick={{fontSize: 12}} />
                        <YAxis stroke="var(--muted-foreground)" domain={[0, 100]} />
                        <Tooltip contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)'}} />
                        <Legend />
                        {trendData.map((run: any, idx: number) => (
                          <Line key={`${run.name}_kvCache`} type="monotone" dataKey={`${run.name}_kvCache`} name={`${run.name} KV Cache`} stroke={CHART_COLORS[idx % CHART_COLORS.length]} activeDot={{ r: 6 }} strokeWidth={2} />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                )}

                {/* VRAM Usage */}
                {selectedMetrics.includes('vramUsage') && (
                <div id="chart-card-vramUsage" className="card-premium p-6 border-t-4 border-t-amber-500">
                  <h3 className="text-lg font-semibold mb-4">SUT VRAM 显存占用时序对比 (%)</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={combinedTimeSeriesData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="time" stroke="var(--muted-foreground)" tick={{fontSize: 12}} />
                        <YAxis stroke="var(--muted-foreground)" domain={[0, 100]} />
                        <Tooltip contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)'}} />
                        <Legend />
                        {trendData.map((run: any, idx: number) => (
                          <Line key={`${run.name}_vram`} type="monotone" dataKey={`${run.name}_vram`} name={`${run.name} VRAM`} stroke={CHART_COLORS[idx % CHART_COLORS.length]} activeDot={{ r: 6 }} strokeWidth={2} />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                )}
              </div>
            </div>

          </div>
        ) : (
          <div className="max-w-md mx-auto my-12 p-8 card-premium text-center border border-border/80 rounded-2xl shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="w-16 h-16 mx-auto bg-primary/10 rounded-2xl flex items-center justify-center mb-6 text-primary animate-pulse">
              <Gauge className="w-9 h-9" />
            </div>
            <h2 className="text-xl font-bold mb-3 text-foreground">📊 尚未选择测试版本</h2>
            <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
              请从上方下拉菜单中勾选 1 ~ N 个已完成的测试记录，即可实时生成跨版本性能演进趋势图表及 AI 专家诊断。
            </p>
            
            <div className="flex flex-col gap-3">
              {completedResults && completedResults.length > 0 ? (
                <button
                  onClick={() => {
                    const latest = completedResults[completedResults.length - 1];
                    updateUrl([latest.id]);
                  }}
                  className="button-primary py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 font-semibold transition-all duration-200"
                >
                  🚀 载入最近一次测试结果
                </button>
              ) : null}
              <button
                onClick={() => navigate("/generator")}
                className="button-secondary py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 font-medium transition-all duration-200"
              >
                ⚙️ 去配置并执行一次测试
              </button>
            </div>
            
            <div className="mt-6 pt-5 border-t border-border/50 text-[11px] text-muted-foreground">
              💡 提示：勾选多个版本可自动生成跨版本对比分析与时序趋势演进
            </div>
          </div>
        )}
      </div>

      {/* Analysis Configuration Modal */}
      {isAnalysisModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setIsAnalysisModalOpen(false)}
          />
          {/* Modal */}
          <div className="relative w-full max-w-2xl mx-4 bg-background border border-border rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 slide-in-from-bottom-4 duration-300 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-border/50">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500/20 to-purple-500/20">
                  <BrainCircuit className="w-5 h-5 text-amber-500" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">AI 性能结果分析</h2>
                  <p className="text-xs text-muted-foreground">基于已选 {compareIds.length} 个版本的数据进行深度性能诊断</p>
                </div>
              </div>
              <button
                onClick={() => setIsAnalysisModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-5">
              {/* Model Provider Selection */}
              <div>
                <label className="block text-sm font-semibold mb-2">分析模型</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setAnalysisConfig({ ...analysisConfig, apiProvider: 'builtin' })}
                    className={`p-3 rounded-xl border-2 text-left transition-all ${
                      analysisConfig.apiProvider === 'builtin'
                        ? 'border-amber-500 bg-amber-500/5 shadow-lg shadow-amber-500/10'
                        : 'border-border hover:border-amber-500/50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Sparkles className="w-4 h-4 text-amber-500" />
                      <span className="font-semibold text-sm">系统内置模型</span>
                    </div>
                    <p className="text-xs text-muted-foreground">推荐，免配置极速诊断</p>
                  </button>
                  <button
                    onClick={() => setAnalysisConfig({ ...analysisConfig, apiProvider: 'custom' })}
                    className={`p-3 rounded-xl border-2 text-left transition-all ${
                      analysisConfig.apiProvider === 'custom'
                        ? 'border-purple-500 bg-purple-500/5 shadow-lg shadow-purple-500/10'
                        : 'border-border hover:border-purple-500/50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Gauge className="w-4 h-4 text-purple-500" />
                      <span className="font-semibold text-sm">自定义 API</span>
                    </div>
                    <p className="text-xs text-muted-foreground">支持 OpenAI 兼容接口</p>
                  </button>
                </div>
              </div>

              {/* Built-in Model Selection Details (Dropdown) */}
              {analysisConfig.apiProvider === 'builtin' && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                  <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    内置分析模型
                  </label>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setIsBuiltinDropdownOpen(!isBuiltinDropdownOpen)}
                      className="w-full flex items-center justify-between p-3.5 bg-background border border-border rounded-xl hover:border-border-hover hover:bg-muted/10 transition-all text-left focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                    >
                      <div className="flex items-center gap-3">
                        {analysisConfig.builtinModel === 'gemini' ? (
                          <>
                            <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center">
                              <Sparkles className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-sm">Gemini 2.5 Flash</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 font-semibold border border-blue-500/20">
                                  推荐 / 极速
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">高速性能诊断，极快响应</p>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-500 flex items-center justify-center">
                              <BrainCircuit className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-sm">Qwen 3.7 Max</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-500 font-semibold border border-purple-500/20">
                                  内置 / 深度诊断
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">通义千问大模型，擅长深度长文本对比分析</p>
                            </div>
                          </>
                        )}
                      </div>
                      <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform duration-200 ${isBuiltinDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {/* Dropdown Menu */}
                    {isBuiltinDropdownOpen && (
                      <>
                        {/* Overlay to close the dropdown */}
                        <div className="fixed inset-0 z-10" onClick={() => setIsBuiltinDropdownOpen(false)} />
                        
                        <div className="absolute left-0 right-0 mt-2 p-1.5 bg-popover border border-border rounded-xl shadow-2xl z-20 animate-in fade-in slide-in-from-top-2 duration-200 max-h-[300px] overflow-y-auto">
                          {/* Option 1: Gemini */}
                          <button
                            type="button"
                            onClick={() => {
                              setAnalysisConfig({ ...analysisConfig, builtinModel: 'gemini' });
                              setIsBuiltinDropdownOpen(false);
                            }}
                            className={`w-full flex items-center justify-between p-3 rounded-lg text-left transition-all ${
                              analysisConfig.builtinModel === 'gemini'
                                ? 'bg-amber-500/10 border border-amber-500/30'
                                : 'hover:bg-muted/50 border border-transparent'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center">
                                <Sparkles className="w-4 h-4" />
                              </div>
                              <div>
                                <span className="font-semibold text-sm block">Gemini 2.5 Flash</span>
                                <span className="text-xs text-muted-foreground">推荐，零配置极速性能诊断</span>
                              </div>
                            </div>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 font-semibold border border-blue-500/20">
                              推荐 / 极速
                            </span>
                          </button>

                          {/* Option 2: Qwen */}
                          <button
                            type="button"
                            onClick={() => {
                              setAnalysisConfig({ ...analysisConfig, builtinModel: 'qwen3.7-max' });
                              setIsBuiltinDropdownOpen(false);
                            }}
                            className={`w-full flex items-center justify-between p-3 rounded-lg text-left mt-1.5 transition-all ${
                              analysisConfig.builtinModel === 'qwen3.7-max'
                                ? 'bg-amber-500/10 border border-amber-500/30'
                                : 'hover:bg-muted/50 border border-transparent'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-500 flex items-center justify-center">
                                <BrainCircuit className="w-4 h-4" />
                              </div>
                              <div>
                                <span className="font-semibold text-sm block">Qwen 3.7 Max</span>
                                <span className="text-xs text-muted-foreground">强大的通义千问内置性能分析模型</span>
                              </div>
                            </div>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-500 font-semibold border border-purple-500/20">
                              内置 / 深度诊断
                            </span>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Custom API Configuration */}
              {analysisConfig.apiProvider === 'custom' && (
                <div className="space-y-3 p-4 rounded-xl bg-muted/30 border border-border animate-in fade-in slide-in-from-top-2 duration-200">
                  <div>
                    <label className="block text-xs font-medium mb-1">API 地址</label>
                    <input
                      type="text"
                      value={analysisConfig.customApiUrl}
                      onChange={(e) => setAnalysisConfig({ ...analysisConfig, customApiUrl: e.target.value })}
                      placeholder="https://api.openai.com/v1/chat/completions"
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">API 密钥</label>
                    <input
                      type="password"
                      value={analysisConfig.customApiKey}
                      onChange={(e) => setAnalysisConfig({ ...analysisConfig, customApiKey: e.target.value })}
                      placeholder="sk-..."
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">模型名称</label>
                    <input
                      type="text"
                      value={analysisConfig.customModel}
                      onChange={(e) => setAnalysisConfig({ ...analysisConfig, customModel: e.target.value })}
                      placeholder="gpt-4o / deepseek-chat / ..."
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                    />
                  </div>
                </div>
              )}

              {/* Prompt Editor */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold">分析 Prompt</label>
                  <button
                    onClick={() => setAnalysisConfig({ ...analysisConfig, prompt: DEFAULT_ANALYSIS_PROMPT })}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
                  >
                    恢复默认
                  </button>
                </div>
                <textarea
                  value={analysisConfig.prompt}
                  onChange={(e) => setAnalysisConfig({ ...analysisConfig, prompt: e.target.value })}
                  rows={10}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono leading-relaxed resize-y"
                  placeholder="输入分析 Prompt..."
                />
                <p className="text-xs text-muted-foreground mt-1">提示：Prompt 中的 <code className="bg-muted px-1 rounded">{'{data}'}</code> 将被自动替换为选中版本的测试数据</p>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 p-6 border-t border-border/50">
              <Button
                variant="outline"
                onClick={() => setIsAnalysisModalOpen(false)}
              >
                取消
              </Button>
              <Button
                onClick={handleStartAnalysis}
                disabled={analysisConfig.apiProvider === 'custom' && (!analysisConfig.customApiUrl || !analysisConfig.customApiKey || !analysisConfig.customModel)}
                className="bg-gradient-to-r from-amber-500 to-purple-500 hover:from-amber-600 hover:to-purple-600 text-white border-0"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                开始分析
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
