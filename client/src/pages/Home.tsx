import { useLocation } from "wouter";
import { ArrowRight, Zap, BarChart3, Brain, Code, Database, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

const features = [
  {
    icon: GitBranch,
    title: "多协议支持",
    description: "支持 OpenAI、Anthropic、Google 等主流 LLM API 协议，轻松扩展自定义接口",
  },
  {
    icon: BarChart3,
    title: "核心衡量指标",
    description: "亚毫秒级性能指标：TTFT、TPS、ITL、TBT、QPS，全面评估模型响应和生成质量",
  },
  {
    icon: Brain,
    title: "专家诊断",
    description: "基于硅谷性能工程标准的自动诊断，识别 Prefill 瓶颈、KV Cache 溢出等问题",
  },
];

const quickStartSteps = [
  { number: "1", title: "配置 API", description: "输入 API URL、Key 和模型名称" },
  { number: "2", title: "设置测试参数", description: "选择并发数、时长和负载模式" },
  { number: "3", title: "执行测试", description: "一键启动性能测试" },
  { number: "4", title: "查看报告", description: "获取详细的性能分析报告" },
];

export default function Home() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-secondary/5">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <Zap className="w-6 h-6 text-primary" />
            <span className="text-xl font-bold">LLM Perf Portal</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate("/docs")}
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              文档
            </button>
            <button
              onClick={() => navigate("/generator")}
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              配置生成器
            </button>
            <button
              onClick={() => navigate("/dashboard")}
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              结果看板
            </button>
            <LanguageSwitcher />
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="section-padding">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-5xl md:text-6xl font-bold mb-6 leading-tight">
              <span className="gradient-text">LLM 性能测试平台</span>
            </h1>
            <p className="text-xl text-muted-foreground mb-8 leading-relaxed">
              专业级的大语言模型 API 性能基准测试工具。精确捕捉亚毫秒级延迟，模拟真实业务负载，提供硅谷级别的专家诊断。
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button
                onClick={() => navigate("/generator")}
                className="button-primary"
              >
                开始测试
                <ArrowRight className="w-4 h-4 ml-2" />
              </button>
              <button
                onClick={() => navigate("/docs")}
                className="button-outline"
              >
                查看文档
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="section-padding bg-card/50 border-y border-border/40">
        <div className="container">
          <h2 className="text-4xl font-bold text-center mb-16">核心特性</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {features.map((feature, idx) => {
              const Icon = feature.icon;
              return (
                <div key={idx} className="card-premium p-8">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                    <Icon className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{feature.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Quick Start Section */}
      <section className="section-padding">
        <div className="container">
          <h2 className="text-4xl font-bold text-center mb-16">快速入门</h2>
          <div className="max-w-4xl mx-auto">
            <div className="grid md:grid-cols-4 gap-6 mb-12">
              {quickStartSteps.map((step, idx) => (
                <div key={idx} className="relative">
                  <div className="card-premium p-6 text-center">
                    <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold mx-auto mb-4">
                      {step.number}
                    </div>
                    <h4 className="font-semibold mb-2">{step.title}</h4>
                    <p className="text-sm text-muted-foreground">{step.description}</p>
                  </div>
                  {idx < quickStartSteps.length - 1 && (
                    <div className="hidden md:flex absolute top-1/2 -right-3 transform -translate-y-1/2">
                      <ArrowRight className="w-5 h-5 text-muted-foreground" />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="text-center">
              <button onClick={() => navigate("/generator")} className="button-primary">
                立即开始
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Metrics Preview Section */}
      <section className="section-padding bg-card/50 border-y border-border/40">
        <div className="container">
          <h2 className="text-4xl font-bold text-center mb-16">核心指标</h2>
          <div className="grid md:grid-cols-5 gap-4">
            {[
              { label: "TTFT", desc: "首字延迟" },
              { label: "TPS", desc: "每秒 Token" },
              { label: "ITL", desc: "Token 间隔" },
              { label: "TBT", desc: "Token 分布" },
              { label: "QPS", desc: "每秒请求" },
            ].map((metric, idx) => (
              <div key={idx} className="card-premium p-6 text-center">
                <div className="text-2xl font-bold text-primary mb-2">{metric.label}</div>
                <p className="text-sm text-muted-foreground">{metric.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="section-padding">
        <div className="container">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-4xl font-bold mb-6">准备好了吗？</h2>
            <p className="text-lg text-muted-foreground mb-8">
              使用我们的配置生成器快速创建测试配置，或查看详细文档了解更多信息。
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button onClick={() => navigate("/generator")} className="button-primary">
                配置生成器
              </button>
              <button onClick={() => navigate("/dashboard")} className="button-secondary">
                查看示例报告
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40 bg-card/30 py-8">
        <div className="container text-center text-sm text-muted-foreground">
          <p>大模型性能测试平台 © 2024。为性能工程师精心打造。</p>
        </div>
      </footer>
    </div>
  );
}
