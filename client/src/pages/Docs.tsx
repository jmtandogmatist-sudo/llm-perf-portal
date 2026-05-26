import { useState } from "react";
import { BookOpen, BarChart3, Zap, Server, Gauge } from "lucide-react";
import { useLocation } from "wouter";

const sections = [
  {
    id: "metrics",
    title: "性能指标",
    icon: BarChart3,
    content: [
      {
        name: "TTFT",
        fullName: "首字延迟",
        description: "从发出请求到接收到第一个 token 的时间",
        details:
          "衡量 Prefill 阶段的性能。TTFT 越低，交互性越好。典型值：50-500ms",
      },
      {
        name: "TPS",
        fullName: "每秒 Token 数",
        description: "每秒生成的 token 数量",
        details:
          "评估 Decode 阶段的吞吐量。TPS 越高，文本生成越快。典型值：10-100 tokens/sec",
      },
      {
        name: "ITL",
        fullName: "Token 间延迟",
        description: "相邻 token 之间的平均间隔",
        details:
          "衡量生成的流畅度。较低的 ITL 能提供更流畅的阅读体验。典型值：10-100ms",
      },
      {
        name: "TBT",
        fullName: "Token 分布",
        description: "Token 生成间隔的分布情况",
        details:
          "分析生成的稳定性和抖动。包括 P50, P95, P99 百分位。需监控尾部延迟。",
      },
      {
        name: "QPS",
        fullName: "每秒请求数",
        description: "每秒处理的总请求数",
        details:
          "评估系统容量和吞吐量。典型值：根据模型和硬件的不同，通常在 1-100 QPS 之间。",
      },
    ],
  },
  {
    id: "providers",
    title: "支持的供应商",
    icon: Server,
    content: [
      {
        name: "OpenAI",
        protocol: "OpenAI API v1",
        models: "gpt-4, gpt-4-turbo, gpt-3.5-turbo",
        features: "流式输出，函数调用，视觉",
      },
      {
        name: "Anthropic",
        protocol: "Anthropic API",
        models: "claude-3-opus, claude-3-sonnet, claude-3-haiku",
        features: "流式输出，视觉，支持超长上下文 (200K)",
      },
      {
        name: "Google",
        protocol: "Google Generative AI",
        models: "gemini-pro, gemini-pro-vision",
        features: "流式输出，视觉，多模态支持",
      },
      {
        name: "Custom",
        protocol: "兼容 OpenAI 的接口",
        models: "任何兼容 OpenAI 的接口端点",
        features: "灵活配置，支持自托管，适用本地模型",
      },
    ],
  },
  {
    id: "loadmodes",
    title: "负载模式",
    icon: Gauge,
    content: [
      {
        name: "恒定负载",
        description: "维持固定的并发请求数",
        useCase: "基线性能测量",
        config: "concurrency: 10, duration: 60s",
        configAnnotations: [
          {
            key: "concurrency",
            desc: "并发数量：系统同时维持的请求/线程数，决定了基础负载水平。",
          },
          {
            key: "duration",
            desc: "持续时间：当前负载模式保持运行的时间，确保各项性能指标趋于稳定。",
          },
        ],
      },
      {
        name: "阶梯增压",
        description: "逐渐增加并发请求数",
        useCase: "识别系统的临界点和容量极限",
        config: "start: 1, end: 50, step: 5, duration: 60s",
        configAnnotations: [
          {
            key: "start",
            desc: "起始并发数：阶梯测试阶段的初始并发请求数量。",
          },
          {
            key: "end",
            desc: "目标并发数：压测最终需要达到的最大并发测试数量极限。",
          },
          { key: "step", desc: "步长：每次并发数向上递增的数量幅度。" },
          {
            key: "duration",
            desc: "持续时间：到达目标并发前，整体阶梯增压过程的时间。",
          },
        ],
      },
      {
        name: "波动负载",
        description: "在低并发和高并发之间振荡",
        useCase: "模拟真实的业务流量模式",
        config: "min: 5, max: 50, period: 30s, duration: 300s",
        configAnnotations: [
          { key: "min", desc: "最小并发数：波动期间的最低系统负载界限。" },
          { key: "max", desc: "最大并发数：波动期间的最高系统负载界限。" },
          {
            key: "period",
            desc: "波动周期：一次完整的高低峰值交替所需的时间（秒）。",
          },
          { key: "duration", desc: "持续时间：整个波动负载测试运行的总时长。" },
        ],
      },
      {
        name: "突刺负载",
        description: "突发高负载后恢复正常负载",
        useCase: "测试系统的恢复能力和稳定性",
        config: "baseline: 10, spike: 100, spike_duration: 10s",
        configAnnotations: [
          {
            key: "baseline",
            desc: "基线并发数：系统在无突刺情况下的常规负载请求量。",
          },
          {
            key: "spike",
            desc: "突刺并发数：短暂的且远高于基线的极端并发请求量。",
          },
          {
            key: "spike_duration",
            desc: "突刺持续时间：维持极端并发负载的具体时长（秒）。",
          },
        ],
      },
    ],
  },
];

export default function Docs() {
  const [activeSection, setActiveSection] = useState("metrics");
  const [, navigate] = useLocation();

  const currentSection = sections.find(s => s.id === activeSection);

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

      <div className="flex flex-col md:flex-row">
        <aside className="w-full md:w-64 border-b md:border-b-0 md:border-r border-border/40 bg-card/50 md:sticky md:top-16 md:h-[calc(100vh-4rem)] md:overflow-y-auto">
          <div className="p-6">
            <h3 className="text-sm font-semibold text-muted-foreground mb-4 uppercase tracking-wider">
              文档
            </h3>
            <nav className="flex md:flex-col gap-2 overflow-x-auto md:overflow-x-visible">
              {sections.map(section => {
                const Icon = section.icon;
                const isActive = activeSection === section.id;
                const activeClass = isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50";
                return (
                  <button
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all whitespace-nowrap md:w-full ${activeClass}`}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    {section.title}
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        <main className="flex-1 p-6 md:p-12">
          {currentSection && (
            <div>
              <div className="mb-12">
                <h1 className="text-4xl font-bold mb-4">
                  {currentSection.title}
                </h1>
              </div>

              <div className="space-y-8">
                {currentSection.id === "metrics" &&
                  currentSection.content.map((item: any, idx) => (
                    <div key={idx} className="card-premium p-8">
                      <div className="flex items-start gap-4">
                        <div className="w-2 h-2 rounded-full bg-primary mt-2 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <h3 className="text-2xl font-bold text-primary">
                              {item.name}
                            </h3>
                            <p className="text-muted-foreground text-sm">
                              ({item.fullName})
                            </p>
                          </div>
                          <p className="text-muted-foreground mt-2 mb-3">
                            {item.description}
                          </p>
                          <div className="bg-muted/30 rounded-lg p-4 border border-border/50">
                            <p className="text-sm leading-relaxed">
                              {item.details}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                {currentSection.id === "providers" &&
                  currentSection.content.map((item: any, idx) => (
                    <div key={idx} className="card-premium p-8">
                      <h3 className="text-2xl font-bold mb-2">{item.name}</h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        {item.protocol}
                      </p>
                      <div className="space-y-3">
                        <div>
                          <p className="text-sm font-semibold mb-2">
                            支持的模型
                          </p>
                          <p className="text-foreground text-sm">
                            {item.models}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm font-semibold mb-2">特性</p>
                          <p className="text-foreground text-sm">
                            {item.features}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}

                {currentSection.id === "loadmodes" &&
                  currentSection.content.map((item: any, idx) => (
                    <div key={idx} className="card-premium p-8">
                      <h3 className="text-2xl font-bold mb-2">{item.name}</h3>
                      <p className="text-muted-foreground mb-4">
                        {item.description}
                      </p>
                      <div className="grid md:grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm font-semibold text-muted-foreground mb-2">
                            适用场景
                          </p>
                          <p className="text-foreground">{item.useCase}</p>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-muted-foreground mb-2">
                            配置示例
                          </p>
                          <p className="text-foreground font-mono text-sm bg-secondary/20 p-2 rounded break-words mb-2">
                            {item.config}
                          </p>
                          {item.configAnnotations && (
                            <div className="mt-4 space-y-2">
                              {item.configAnnotations.map(
                                (anno: any, aIdx: number) => (
                                  <div key={aIdx} className="text-sm">
                                    <span className="font-semibold text-primary">
                                      {anno.key}
                                    </span>
                                    <span className="text-muted-foreground ml-2">
                                      {anno.desc}
                                    </span>
                                  </div>
                                )
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
