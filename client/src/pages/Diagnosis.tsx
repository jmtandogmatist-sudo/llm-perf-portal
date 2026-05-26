import { Zap, AlertCircle, Lightbulb, TrendingDown } from 'lucide-react';
import { useLocation } from 'wouter';

const diagnosticRules = [
  {
    id: 1,
    title: 'Prefill 瓶颈',
    severity: 'high',
    description: 'TTFT 明显高于预期',
    symptoms: [
      'TTFT > 500ms',
      'TTFT 值方差大',
      '负载下 QPS 下降',
    ],
    causes: [
      '模型输入处理缓慢',
      '可用于批量处理的 GPU 内存不足',
      'Token 嵌入计算遇到瓶颈',
    ],
    solutions: [
      '增加 prefill 阶段的批处理大小',
      '优化输入标记化管道',
      '使用量化降低内存压力',
      '考虑使用更小的模型变体',
    ],
  },
  {
    id: 2,
    title: 'KV Cache 溢出',
    severity: 'high',
    description: 'KV Cache 积压造成的内存压力',
    symptoms: [
      'TPS 随时间逐渐下降',
      '长序列延迟增加',
      '内存溢出 错误',
    ],
    causes: [
      '序列长度超过模型容量',
      '批处理大小对于可用 GPU 内存来说过大',
      'KV 缓存管理不当',
    ],
    solutions: [
      '减小批处理大小或序列长度',
      '实施 KV 缓存驱逐策略',
      '使用 paged attention 提升内存效率',
      '启用 flash attention 优化',
    ],
  },
  {
    id: 3,
    title: '并发争抢',
    severity: 'medium',
    description: '高并发环境下的性能下降',
    symptoms: [
      'P95 延迟远超平均延迟',
      '并发请求较多时错误率上升',
      '负载下 TPS 不稳定',
    ],
    causes: [
      '请求队列容量不足',
      'GPU 上下文切换开销大',
      '请求调度器中存在锁竞争',
    ],
    solutions: [
      '优化请求调度算法',
      '逐步增加 GPU 批处理大小',
      '实现请求优先级排序',
      '针对非关键操作使用异步处理',
    ],
  },
  {
    id: 4,
    title: 'Token 生成抖动',
    severity: 'medium',
    description: 'Token 间延迟 波动过大',
    symptoms: [
      'TBT 的 P95/P99 百分位居高不下',
      'Token 生成速度不一致',
      '流式输出体验差',
    ],
    causes: [
      'GPU 利用率不稳定',
      '因温度过高而降频',
      '系统资源争用',
    ],
    solutions: [
      '保证 GPU 时钟频率稳定',
      '减轻后台系统负载',
      '实施带缓冲的 Token 流式输出',
      '使用专用 GPU 进行推理',
    ],
  },
  {
    id: 5,
    title: 'API 延迟突刺',
    severity: 'medium',
    description: '响应时间突然增加',
    symptoms: [
      '偶尔出现高延迟请求',
      'P99 延迟显著高于 P95 延迟',
      '性能不可预测',
    ],
    causes: [
      '垃圾回收暂停',
      '网络丢包或重传',
      '从磁盘加载模型权重',
    ],
    solutions: [
      '调整垃圾回收设置',
      '增加请求重试逻辑',
      '预加载模型权重到内存中',
      '使用连接池',
    ],
  },
];

export default function Diagnosis() {
  const [, navigate] = useLocation();

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high':
        return 'text-destructive';
      case 'medium':
        return 'text-yellow-600';
      default:
        return 'text-green-600';
    }
  };

  const getSeverityBgColor = (severity: string) => {
    switch (severity) {
      case 'high':
        return 'bg-destructive/10';
      case 'medium':
        return 'bg-yellow-50';
      default:
        return 'bg-green-50';
    }
  };

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
            onClick={() => navigate('/')}
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            返回首页
          </button>
        </div>
      </nav>

      <div className="container py-12">
        <div className="mb-12">
          <h1 className="text-4xl font-bold mb-2">专家诊断指南</h1>
          <p className="text-lg text-muted-foreground">
            通过专家级诊断识别和解决常见的 LLM 性能问题
          </p>
        </div>

        <div className="space-y-6">
          {diagnosticRules.map((rule) => (
            <div key={rule.id} className="card-premium p-8 border-l-4 border-l-primary">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <h2 className="text-2xl font-bold">{rule.title}</h2>
                    <span
                      className={`px-3 py-1 rounded-full text-sm font-semibold ${getSeverityBgColor(
                        rule.severity
                      )} ${getSeverityColor(rule.severity)}`}
                    >
                      {rule.severity.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-lg">{rule.description}</p>
                </div>
                <AlertCircle className={`w-8 h-8 flex-shrink-0 ${getSeverityColor(rule.severity)}`} />
              </div>

              <div className="grid md:grid-cols-3 gap-6">
                <div>
                  <h3 className="font-bold mb-3 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-primary" />
                    症状
                  </h3>
                  <ul className="space-y-2">
                    {rule.symptoms.map((symptom, idx) => (
                      <li key={idx} className="text-sm text-muted-foreground flex gap-2">
                        <span className="text-primary font-bold">•</span>
                        {symptom}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="font-bold mb-3 flex items-center gap-2">
                    <TrendingDown className="w-4 h-4 text-primary" />
                    原因
                  </h3>
                  <ul className="space-y-2">
                    {rule.causes.map((cause, idx) => (
                      <li key={idx} className="text-sm text-muted-foreground flex gap-2">
                        <span className="text-primary font-bold">•</span>
                        {cause}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="font-bold mb-3 flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-primary" />
                    解决方案
                  </h3>
                  <ul className="space-y-2">
                    {rule.solutions.map((solution, idx) => (
                      <li key={idx} className="text-sm text-muted-foreground flex gap-2">
                        <span className="text-primary font-bold">•</span>
                        {solution}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 p-8 bg-secondary/5 rounded-2xl border border-secondary/20">
          <h3 className="text-2xl font-bold mb-6">通用最佳实践</h3>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-bold mb-3">监控</h4>
              <ul className="space-y-2 text-muted-foreground text-sm">
                <li>• 持续追踪 TTFT、TPS、ITL、与 TBT </li>
                <li>• 监测 P95/P99 延迟，而不仅看平均值</li>
                <li>• 设置性能降级报警</li>
                <li>• 将性能指标和系统事件进行关联</li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-3">测试</h4>
              <ul className="space-y-2 text-muted-foreground text-sm">
                <li>• 使用真实的负载和并发测试</li>
                <li>• 保持足够长的测试时间 (60+ 秒)</li>
                <li>• 对不同模型进行公平对比</li>
                <li>• 记录并存档基线性能指标</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
