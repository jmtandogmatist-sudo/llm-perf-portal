import { Zap, TrendingUp, TrendingDown, ArrowLeft } from 'lucide-react';
import { useLocation } from 'wouter';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';
import { trpc } from '../lib/trpc';
import { useMemo, useEffect, useState } from 'react';
import { Button } from '../components/ui/button';

export default function Comparison() {
  const [, navigate] = useLocation();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const idsParam = params.get('ids');
    if (idsParam) {
      const ids = idsParam.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
      if (ids.length > 0) {
        setSelectedIds(ids);
      }
    }
  }, []);

  const { data: testResults = [], isLoading } = trpc.test.getResults.useQuery();
  const { data: environments = [] } = trpc.environment.getEnvironments.useQuery();

  const { comparisonData, modelStats, radarData, isRestApiOnly } = useMemo(() => {
    if (!testResults || selectedIds.length === 0) {
      return { comparisonData: [], modelStats: [], radarData: [], isRestApiOnly: false };
    }

    const selectedResults = testResults.filter((r: any) => selectedIds.includes(r.id) && r.status === 'completed');

    if (selectedResults.length === 0) return { comparisonData: [], modelStats: [], radarData: [], isRestApiOnly: false };

    const isRest = selectedResults.every((r: any) => r.testType === 'REST_API');

    // Format results to mapping object for charts
    const metric1Data: any = { metric: isRest ? 'Avg Latency (ms)' : 'TTFT (ms)' };
    const metric2Data: any = { metric: isRest ? 'Avg Size (KB)' : 'TPS' };
    const metric3Data: any = { metric: 'QPS' };
    const metric4Data: any = { metric: isRest ? 'P95 Latency (ms)' : 'P95 TTFT (ms)' };

    const stats: any[] = [];
    const radarFeatures = isRest 
      ? ['QPS 吞吐', '平均延迟', 'P95 延迟', '平均大小', '并发量']
      : ['TTFT 响应', 'TPS 吞吐', 'QPS 大小', 'P95 稳定', '并发量'];
    const rData = radarFeatures.map((feat: string) => ({ subject: feat } as any));

    selectedResults.forEach((res: any, idx: number) => {
      const modelName = res.model || res.config?.model || `Model ${idx + 1}`;
      const uniqueName = res.name || `${modelName} (#${res.id})`;
      
      const ttft = parseInt(typeof res.ttftAvg === 'string' ? res.ttftAvg.replace('ms', '') : res.ttftAvg || '0');
      const tps = parseFloat(res.tpsAvg || '0');
      const qps = parseFloat(res.qps || '0');
      const p95 = parseInt(typeof res.ttftP95 === 'string' ? res.ttftP95.replace('ms', '') : res.ttftP95 || '0');
      const concurrency = res.concurrency || res.config?.concurrency || 1;

      const avgLatency = parseFloat(res.avgLatency || res.latencyAvg || '0');
      const p95Latency = parseFloat(res.p95Latency || res.latencyP95 || '0');

      const protocolMetrics = res.protocolMetrics as { statusCodes?: Record<string, number>; avgResponseSize?: number } | null;
      const avgResponseSizeVal = protocolMetrics?.avgResponseSize || 0;
      const avgResponseSizeInKb = parseFloat((avgResponseSizeVal / 1024).toFixed(2));
      const avgResponseSizeFormatted = avgResponseSizeVal > 1024 
        ? `${avgResponseSizeInKb} KB` 
        : `${avgResponseSizeVal} Bytes`;

      if (isRest) {
        metric1Data[uniqueName] = avgLatency;
        metric2Data[uniqueName] = avgResponseSizeInKb;
        metric3Data[uniqueName] = qps;
        metric4Data[uniqueName] = p95Latency;
      } else {
        metric1Data[uniqueName] = ttft;
        metric2Data[uniqueName] = tps;
        metric3Data[uniqueName] = qps;
        metric4Data[uniqueName] = p95;
      }

      const env = environments.find((e: any) => e.id === res.environmentId);
      const envName = env ? env.name : '线上/默认 API';
      const envSpecs = env ? `${env.gpuCount ? `${env.gpuCount}x ` : ''}${env.gpuModel || 'NVIDIA'} | ${env.inferenceEngine || 'vLLM'} | ${env.quantization || 'None'}` : '无/默认 API';

      stats.push({
        id: res.id,
        name: uniqueName,
        model: modelName,
        isRest,
        ttft: isRest ? undefined : res.ttftAvg,
        tps: isRest ? undefined : `${tps.toFixed(2)} tok/s`,
        qps: `${qps.toFixed(2)} req/s`,
        p95: isRest ? undefined : res.ttftP95,
        avgLatency: isRest ? `${avgLatency.toFixed(2)} ms` : undefined,
        p95Latency: isRest ? `${p95Latency.toFixed(2)} ms` : undefined,
        avgResponseSize: isRest ? avgResponseSizeFormatted : undefined,
        cost: '参考API定价',
        date: new Date(res.createdAt).toLocaleString(),
        verdict: '真实压测数据',
        envName,
        envSpecs,
      });

      if (isRest) {
        rData[0][uniqueName] = Math.max(0, 100 - (avgLatency / 10)); 
        rData[1][uniqueName] = Math.max(0, 100 - (avgResponseSizeInKb / 5)); 
        rData[2][uniqueName] = Math.min(100, qps * 5); 
        rData[3][uniqueName] = Math.max(0, 100 - (p95Latency / 15)); 
        rData[4][uniqueName] = Math.min(100, concurrency * 5); 
      } else {
        rData[0][uniqueName] = Math.max(0, 100 - (ttft / 50)); 
        rData[1][uniqueName] = Math.min(100, tps * 2); 
        rData[2][uniqueName] = Math.min(100, qps * 5); 
        rData[3][uniqueName] = Math.max(0, 100 - (p95 / 80)); 
        rData[4][uniqueName] = Math.min(100, concurrency * 5); 
      }
    });

    return { 
      comparisonData: [metric1Data, metric2Data, metric3Data, metric4Data], 
      modelStats: stats,
      radarData: rData,
      isRestApiOnly: isRest
    };
  }, [selectedIds, testResults, environments]);

  const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b'];

  return (
    <div className="min-h-screen bg-background">
      <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="container flex items-center justify-between h-16">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-lg font-bold hover:opacity-80 transition-opacity"
          >
            <Zap className="w-6 h-6 text-primary" />
            LLM Perf Portal
          </button>
          <button
            onClick={() => navigate('/generator')}
            className="text-sm border py-1 px-3 rounded-md font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            返回生成器
          </button>
        </div>
      </nav>

      <div className="container py-12">
        <div className="mb-12">
          <h1 className="text-4xl font-bold mb-2">多模型深度对比</h1>
          <p className="text-lg text-muted-foreground">
            对比您勾选的历史测试执行结果记录 ({modelStats.length} 个结果)
          </p>
        </div>

        {isLoading ? (
           <p>加载中...</p>
        ) : modelStats.length < 2 ? (
          <div className="card-premium p-12 text-center">
            <h2 className="text-2xl font-bold mb-4">选择的数据不足</h2>
            <p className="text-muted-foreground mb-6">您需要至少选择 2 个已完成的测试记录进行对比。</p>
            <Button onClick={() => navigate('/generator')}>返回历史记录面板重选</Button>
          </div>
        ) : (
          <>
            {/* Chart Grid */}
            <div className="grid md:grid-cols-2 gap-8 mb-12">
              <div className="card-premium p-8">
                <h2 className="text-xl font-bold mb-6">柱状数据图</h2>
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={comparisonData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="metric" stroke="var(--muted-foreground)" />
                    <YAxis stroke="var(--muted-foreground)" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend />
                    {modelStats.map((stat, idx) => (
                      <Bar key={stat.name} dataKey={stat.name} fill={colors[idx % colors.length]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="card-premium p-8">
                <h2 className="text-xl font-bold mb-6">综合性能雷达图 (面积越大越优)</h2>
                <ResponsiveContainer width="100%" height={350}>
                  <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
                    <PolarGrid stroke="var(--border)" />
                    <PolarAngleAxis dataKey="subject" />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} />
                    <Tooltip />
                    <Legend />
                    {modelStats.map((stat, idx) => (
                      <Radar key={stat.name} name={stat.name} dataKey={stat.name} stroke={colors[idx % colors.length]} fill={colors[idx % colors.length]} fillOpacity={0.4} />
                    ))}
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Detailed Comparison */}
            <div className="mb-12">
              <h2 className="text-2xl font-bold mb-6">详细压测参数分析</h2>
              <div className="grid md:grid-cols-2 gap-6">
                {modelStats.map((model, idx) => (
                  <div key={model.name} className="card-premium p-8 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-2 h-full" style={{ backgroundColor: colors[idx % colors.length] }} />
                    <h3 className="text-xl font-bold mb-1">{model.model}</h3>
                    <p className="text-sm text-muted-foreground mb-4">测试时间: {model.date}</p>
                    <div className="space-y-3 mb-6">
                      <div className="flex justify-between items-center bg-muted/20 p-2 rounded">
                        <span className="text-muted-foreground text-xs">被测环境 (SUT)</span>
                        <span className="font-semibold text-xs text-right truncate max-w-[180px]" title={model.envSpecs}>{model.envName}</span>
                      </div>
                      <div className="flex justify-between items-center p-2 rounded">
                        <span className="text-muted-foreground text-xs">环境规格配置</span>
                        <span className="text-2xs text-muted-foreground/80 text-right truncate max-w-[180px]" title={model.envSpecs}>{model.envSpecs}</span>
                      </div>
                      {!model.isRest ? (
                        <>
                          <div className="flex justify-between items-center bg-muted/20 p-2 rounded">
                            <span className="text-muted-foreground">TTFT</span>
                            <span className="font-semibold">{model.ttft}</span>
                          </div>
                          <div className="flex justify-between items-center p-2 rounded">
                            <span className="text-muted-foreground">TPS</span>
                            <span className="font-semibold">{model.tps}</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex justify-between items-center bg-muted/20 p-2 rounded">
                            <span className="text-muted-foreground">平均响应延迟</span>
                            <span className="font-semibold">{model.avgLatency}</span>
                          </div>
                          <div className="flex justify-between items-center p-2 rounded">
                            <span className="text-muted-foreground">平均响应大小</span>
                            <span className="font-semibold">{model.avgResponseSize}</span>
                          </div>
                        </>
                      )}
                      <div className="flex justify-between items-center bg-muted/20 p-2 rounded">
                        <span className="text-muted-foreground">QPS</span>
                        <span className="font-semibold">{model.qps}</span>
                      </div>
                      <div className="flex justify-between items-center p-2 rounded">
                        <span className="text-muted-foreground">{model.isRest ? 'P95 响应延迟' : 'P95 TTFT'}</span>
                        <span className="font-semibold">{model.isRest ? model.p95Latency : model.p95}</span>
                      </div>
                    </div>
                    <div className="pt-4 border-t border-border flex justify-between items-center">
                       <span className="text-sm font-semibold text-primary">{model.verdict}</span>
                       <Button size="sm" variant="outline" onClick={() => navigate(`/dashboard?id=${model.id}`)}>
                         查看单项详细报告
                       </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
