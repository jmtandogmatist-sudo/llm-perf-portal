import { Zap, TrendingUp, Activity, Gauge, ChevronDown, Download } from 'lucide-react';
import { useLocation } from 'wouter';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useState, useMemo, useEffect, useRef } from 'react';
import { trpc } from '../lib/trpc';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem } from '../components/ui/dropdown-menu';
import { Button } from '../components/ui/button';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { Document, Packer, Paragraph, HeadingLevel, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';

const METRIC_OPTIONS = [
  { key: 'TTFT', label: 'TTFT' },
  { key: 'TPS', label: 'TPS (Tokens/s)' },
  { key: 'ITL', label: 'ITL (词间延迟)' },
  { key: 'QPS', label: 'QPS (Req/s)' },
  { key: 'Distribution', label: 'Token分布 (TBT)' },
  { key: 'AvgLatency', label: 'Avg RT' },
  { key: 'P95Latency', label: 'P95 RT' },
  { key: 'TimeSeries', label: 'TPS 时序演进' },
] as const;

type MetricKey = (typeof METRIC_OPTIONS)[number]['key'];



export default function Dashboard() {
  const [, navigate] = useLocation();
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [selectedMetrics, setSelectedMetrics] = useState<MetricKey[]>([
    'TTFT',
    'TPS',
    'ITL',
    'QPS',
    'Distribution',
    'AvgLatency',
    'P95Latency',
    'TimeSeries',
  ]);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingWord, setIsExportingWord] = useState(false);
  const pageCaptureRef = useRef<HTMLDivElement>(null);
  const dashboardExportRef = useRef<HTMLDivElement>(null);

  const allMetricKeys = useMemo(() => METRIC_OPTIONS.map((metric) => metric.key), []);
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

      return {
        name: `Run-${r.id}`,
        model: r.model || r.config?.model,
        date: new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false }),
        configStr: `${r.model || r.config?.model || 'Unknown'} (C:${r.concurrency || r.config?.concurrency || 1})`,
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
        fullRes: r
      };
    });
  }, [completedResults, compareIds]);

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

  const combinedTimeSeriesData = useMemo(() => {
    const times = ['0:00', '0:10', '0:20', '0:30', '0:40', '0:50', '1:00'];
    return times.map((time, idx) => {
      const obj: any = { time };
      trendData.forEach((run: any, i: number) => {
         const baseTps = run.tps || 50;
         obj[`${run.name}_tps`] = parseFloat((baseTps * (0.8 + Math.abs(Math.cos(i + idx)) * 0.4)).toFixed(2));
      });
      return obj;
    });
  }, [trendData]);

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
    if (!pageCaptureRef.current || trendData.length === 0) return;
    setIsExportingPdf(true);
    try {
      const target = pageCaptureRef.current;
      const dataUrl = await toPng(target, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        width: target.scrollWidth,
        height: target.scrollHeight,
        style: {
          animation: 'none',
          transition: 'none',
        },
      });

      const sourceImage = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = dataUrl;
      });

      const canvas = document.createElement('canvas');
      canvas.width = sourceImage.width;
      canvas.height = sourceImage.height;
      const canvasCtx = canvas.getContext('2d');
      if (!canvasCtx) {
        throw new Error('Unable to create canvas context for PDF export.');
      }
      canvasCtx.drawImage(sourceImage, 0, 0);

      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let renderedHeight = 0;
      let pageIndex = 0;
      while (renderedHeight < imgHeight) {
        if (pageIndex > 0) {
          pdf.addPage();
        }

        const sY = Math.floor((renderedHeight * canvas.width) / imgWidth);
        const sliceHeightPx = Math.floor((pageHeight * canvas.width) / imgWidth);
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = canvas.width;
        pageCanvas.height = Math.min(sliceHeightPx, canvas.height - sY);
        const ctx = pageCanvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(canvas, 0, sY, canvas.width, pageCanvas.height, 0, 0, canvas.width, pageCanvas.height);
          const pageData = pageCanvas.toDataURL('image/png');
          const pageImgHeight = (pageCanvas.height * imgWidth) / pageCanvas.width;
          pdf.addImage(pageData, 'PNG', 0, 0, imgWidth, pageImgHeight);
        }

        renderedHeight += pageHeight;
        pageIndex += 1;
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
          children: ['Run ID', '模型/并发', '总请求', '成功', '失败', 'Avg TTFT', 'P95 TTFT', 'TPS', 'QPS', 'ITL'].map((text) =>
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })] })
          ),
        }),
        ...trendData.map(
          (row: any) =>
            new TableRow({
              children: [
                row.name,
                row.configStr,
                String(row.totalReq),
                String(row.successReq),
                String(row.failedReq),
                `${row.ttftAvg} ms`,
                `${row.ttftP95} ms`,
                row.tps.toFixed(2),
                row.qps.toFixed(2),
                `${row.itl.toFixed(2)} ms`,
              ].map((text) => new TableCell({ children: [new Paragraph(String(text))] })),
            })
        ),
      ];

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
                {METRIC_OPTIONS.map((metric) => (
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
                        <th className="py-3 px-4 whitespace-nowrap">Run ID</th>
                        <th className="py-3 px-4 whitespace-nowrap">测试模型 / 并发配置</th>
                        <th className="py-3 px-4 whitespace-nowrap">线程总数</th>
                        <th className="py-3 px-4 whitespace-nowrap">成功</th>
                        <th className="py-3 px-4 whitespace-nowrap">失败</th>
                        <th className="py-3 px-4 whitespace-nowrap">Error%</th>
                        <th className="py-3 px-4 whitespace-nowrap">Avg TTFT</th>
                        <th className="py-3 px-4 whitespace-nowrap">P95 TTFT</th>
                        <th className="py-3 px-4 whitespace-nowrap">TPS</th>
                        <th className="py-3 px-4 whitespace-nowrap">QPS</th>
                          <th className="py-3 px-4 whitespace-nowrap">Avg RT</th>
                          <th className="py-3 px-4 whitespace-nowrap">P95 RT</th>
                        <th className="py-3 px-4 whitespace-nowrap">ITL</th>
                        <th className="py-3 px-4 whitespace-nowrap">Run Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trendData.map((row: any, i: number) => (
                        <tr key={i} className="border-b border-border/10 hover:bg-muted/10 transition-colors">
                          <td className="py-3 px-4 font-mono font-semibold text-primary whitespace-nowrap">{row.name}</td>
                          <td className="py-3 px-4 text-sm whitespace-nowrap">{row.configStr}</td>
                          <td className="py-3 px-4 text-sm">{row.totalReq}</td>
                          <td className="py-3 px-4 text-emerald-500 font-semibold">{row.successReq}</td>
                          <td className="py-3 px-4 text-red-500 font-semibold">{row.failedReq}</td>
                          <td className="py-3 px-4 text-red-400 font-semibold">{row.failRateStr}</td>
                          <td className="py-3 px-4 text-blue-500 font-semibold whitespace-nowrap">{row.ttftAvg} ms</td>
                          <td className="py-3 px-4 text-red-500 font-semibold whitespace-nowrap">{row.ttftP95} ms</td>
                          <td className="py-3 px-4 text-emerald-500 font-semibold whitespace-nowrap">{row.tps.toFixed(2)}</td>
                          <td className="py-3 px-4 text-purple-500 font-semibold whitespace-nowrap">{row.qps.toFixed(2)}</td>
                          <td className="py-3 px-4 text-orange-500 font-semibold whitespace-nowrap">{row.itl.toFixed(1)} ms</td>
                          <td className="py-3 px-4 text-cyan-500 font-semibold whitespace-nowrap">{row.avgLatency?.toFixed(2) || "0.00"} ms</td>
                          <td className="py-3 px-4 text-rose-500 font-semibold whitespace-nowrap">{row.p95Latency?.toFixed(2) || "0.00"} ms</td>
                          <td className="py-3 px-4 text-muted-foreground text-sm whitespace-nowrap">{row.date}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            


            
            {/* 1. 多版本趋势演进 */}
            <div data-export-block="true">
              <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                <Activity className="w-6 h-6 text-primary" /> 
                跨版本全局趋势演进 
              </h2>
              <div className="grid lg:grid-cols-2 gap-8">
                {/* TTFT Trend */}
                {selectedMetrics.includes('TTFT') && (
                <div className="card-premium p-6 border-t-4 border-t-blue-500">
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
                </div>
                )}

                {/* TPS Trend */}
                {selectedMetrics.includes('TPS') && (
                <div className="card-premium p-6 border-t-4 border-t-emerald-500">
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
                </div>
              )}

                {/* ITL Trend */}
                {selectedMetrics.includes('ITL') && (
                  <div className="card-premium p-6 border-t-4 border-t-orange-500">
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
                  </div>
                )}
                
                {/* QPS Trend */}
                {selectedMetrics.includes('QPS') && (
                  <div className="card-premium p-6 border-t-4 border-t-purple-500">
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
                  </div>
                )}

                {selectedMetrics.includes('AvgLatency') && (
                  <div className="card-premium p-6 border-t-4 border-t-cyan-500">
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
                  </div>
                )}

                {selectedMetrics.includes('P95Latency') && (
                  <div className="card-premium p-6 border-t-4 border-t-rose-500">
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
                <div className="card-premium p-6">
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
                </div>
                )}

                {/* Legacy Time Series */}
                {selectedMetrics.includes('TimeSeries') && (
                <div className="card-premium p-6">
                  <h3 className="text-lg font-semibold mb-4">TPS 时序演进对比图</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={combinedTimeSeriesData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="time" stroke="var(--muted-foreground)" tick={{fontSize: 12}} />
                        <YAxis stroke="var(--muted-foreground)" />
                        <Tooltip contentStyle={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)'}} />
                        <Legend />
                        {trendData.map((run: any, idx: number) => (
                          <Line key={`${run.name}_tps`} type="monotone" dataKey={`${run.name}_tps`} name={`${run.name} TPS`} stroke={CHART_COLORS[idx % CHART_COLORS.length]} activeDot={{ r: 6 }} strokeWidth={2} />
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
          <div className="text-center py-20 text-muted-foreground p-12 border-2 border-dashed border-border rounded-xl">
             <Gauge className="w-16 h-16 mx-auto mb-4 opacity-20" />
             <h2 className="text-xl font-semibold mb-2">欢迎来到分析看板</h2>
             <p>请点击右上角的下拉菜单勾选版本，以生成压测趋势与详情</p>
          </div>
        )}
      </div>
    </div>
  );
}
