import asyncio
import time
import json
import argparse
import aiohttp
import numpy as np
import os
import base64
from jinja2 import Template
from typing import List, Dict, Any

class MultimodalInputProcessor:
    """
    多模态输入处理器：负责将用户输入的字符串或文件路径解析为 OpenAI 标准的 JSON 结构。
    """
    @staticmethod
    def process_payload(input_type: str, input_data: str, model: str, stream: bool) -> dict:
        """
        根据输入类型，构造不同的请求 payload 参数。
        input_type: 'image', 'text', 'json'
        input_data: 文件路径或直接的字符串内容
        """
        # 工具函数：读取文件内容（包含处理 txt 中的 base64/url 或直接图片编码）
        def get_file_content_or_string(data: str, is_image: bool = False):
            if os.path.exists(data):
                ext = os.path.splitext(data)[1].lower()
                # 如果是图片格式直接转 base64
                if ext in ['.png', '.jpg', '.jpeg', '.webp']:
                    with open(data, "rb") as f:
                        base64_img = base64.b64encode(f.read()).decode('utf-8')
                        return f"data:image/{ext[1:]};base64,{base64_img}"
                else:
                    # 如果是 .txt 等文本，直接读出里面的 URL 或 Base64 字符串
                    with open(data, 'r', encoding='utf-8') as f:
                        content = f.read().strip()
                        # 对于图片类型，如果文件内容是不带 data: 的 base64，可自动拼接
                        if is_image and not content.startswith('http') and not content.startswith('data:'):
                            return f"data:image/jpeg;base64,{content}"
                        return content
            return data

        # 开始组装基础 payload
        payload = {
            "model": model,
            "stream": stream
        }

        if input_type == 'image':
            image_val = get_file_content_or_string(input_data, is_image=True)
            payload["messages"] = [
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": image_val}},
                        {"type": "text", "text": "识别图中内容"}
                    ]
                }
            ]
            # 根据用户需求增加 chat_template_kwargs
            payload["chat_template_kwargs"] = {"enable_thinking": False}

        elif input_type == 'text':
            text_val = get_file_content_or_string(input_data, is_image=False)
            payload["messages"] = [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": text_val}
                    ]
                }
            ]
        
        elif input_type == 'json':
            # 直接将文件作为自定义 Payload。如果里面包含 ${file} 可以做参数替换
            json_str = get_file_content_or_string(input_data, is_image=False)
            # 如果需要进一步参数化，可以在这里预留替换逻辑：json_str.replace('${file}', ...)
            payload = json.loads(json_str)
            # 确保覆盖基础参数
            payload["model"] = model
            payload["stream"] = stream

        return payload

class LLMPerfTesterV2:
    """
    核心性能测试类：支持异步并发请求、流式/非流式解析及指标收集。
    """
    def __init__(self, api_url: str, api_key: str, model: str, payload_template: dict, concurrency: int, duration: int, stream: bool = True):
        self.api_url = api_url
        self.api_key = api_key.strip()
        if self.api_key.startswith("Bearer "):
            self.api_key = self.api_key[7:].strip()
        self.model = model
        self.payload = payload_template
        self.concurrency = concurrency
        self.duration = duration
        self.stream = stream
        self.results = []
        self.start_time = 0

    async def make_request(self, session: aiohttp.ClientSession):
        """
        发起单个 API 请求并记录性能数据。
        [扩展点]：如果需要增加 ITL (Inter-Token Latency)，请在循环中记录每个 chunk 的到达时间。
        """
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        request_start = time.perf_counter()
        ttft = None
        total_tokens = 0
        
        try:
            # 浅拷贝避免多协程竞争修改（如果有动态参数）
            current_payload = self.payload.copy()
            async with session.post(self.api_url, headers=headers, json=current_payload, timeout=300) as response:
                if response.status != 200:
                    err = await response.text()
                    return {"success": False, "error": f"状态码 {response.status}: {err}"}
                
                if self.stream:
                    # 流式处理模式
                    async for line in response.content:
                        line = line.decode('utf-8').strip()
                        if not line or line == "data: [DONE]":
                            continue
                        if line.startswith("data: "):
                            # 记录首字延迟 (TTFT)
                            if ttft is None:
                                ttft = (time.perf_counter() - request_start) * 1000
                            try:
                                data = json.loads(line[6:])
                                if "choices" in data and len(data["choices"]) > 0:
                                    delta = data["choices"][0].get("delta", {})
                                    if "content" in delta:
                                        # 粗略估计 Token 数
                                        total_tokens += 1
                            except:
                                pass
                else:
                    # 非流式处理模式
                    data = await response.json()
                    total_tokens = data.get("usage", {}).get("completion_tokens", 0)
                    # 非流式下，首字延迟等于总延迟
                    ttft = (time.perf_counter() - request_start) * 1000
                            
                total_latency = (time.perf_counter() - request_start) * 1000
                return {
                    "ttft": ttft,
                    "total_latency": total_latency,
                    "tokens": total_tokens,
                    "success": True,
                    "timestamp": time.time()
                }
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def worker(self):
        """
        单个并发工人的循环逻辑。
        """
        async with aiohttp.ClientSession() as session:
            while time.perf_counter() - self.start_time < self.duration:
                res = await self.make_request(session)
                if res:
                    self.results.append(res)
                # 稍微停顿，防止请求过于密集触发简单限流
                await asyncio.sleep(0.1)

    async def run(self):
        """
        启动测试任务并等待完成。
        """
        self.start_time = time.perf_counter()
        tasks = [asyncio.create_task(self.worker()) for _ in range(self.concurrency)]
        await asyncio.gather(*tasks)
        return self.generate_report()

    def generate_report(self):
        """
        汇总测试结果并计算统计指标。
        [扩展点]：如果增加了新原始指标，请在此处添加相应的数学计算逻辑。
        """
        successful = [r for r in self.results if r.get("success")]
        failed = [r for r in self.results if not r.get("success")]
        
        total_time = time.perf_counter() - self.start_time
        qps = len(successful) / total_time if total_time > 0 else 0
        tps = sum(r["tokens"] for r in successful) / total_time if total_time > 0 else 0
        
        ttfts = [r["ttft"] for r in successful if r["ttft"] is not None]
        latencies = [r["total_latency"] for r in successful]
        
        stats = {
            "model": self.model,
            "concurrency": self.concurrency,
            "duration": self.duration,
            "total_requests": len(self.results),
            "successful": len(successful),
            "failed": len(failed),
            "qps": round(qps, 2),
            "tps": round(tps, 2),
            "avg_ttft": round(np.mean(ttfts), 2) if ttfts else 0,
            "p95_ttft": round(np.percentile(ttfts, 95), 2) if ttfts else 0,
            "avg_latency": round(np.mean(latencies), 2) if latencies else 0,
            "p95_latency": round(np.percentile(latencies, 95), 2) if latencies else 0,
            "total_time": round(total_time, 2)
        }
        
        # 调用专家分析引擎
        analysis = self.expert_analysis(stats)
        
        return {
            "stats": stats,
            "analysis": analysis,
            "raw_results": self.results
        }

    def expert_analysis(self, stats):
        """
        基于硅谷性能工程经验的自动化诊断建议。
        """
        analysis = []
        if stats["p95_ttft"] > 1000:
            analysis.append("⚠️ **首字延迟警告**: P95 TTFT 超过 1秒。这通常意味着冷启动、队列堆积或 Prompt 过长。建议检查后端推理引擎负载。")
        elif stats["p95_ttft"] < 200:
            analysis.append("✅ **极致响应速度**: TTFT 低于 200ms。该接口表现极其出色，适合高实时性交互。")
        
        if stats["failed"] > 0:
            fail_rate = (stats["failed"] / stats["total_requests"]) * 100
            analysis.append(f"❌ **稳定性风险**: 发现 {fail_rate:.1f}% 的失败率。请检查 429 限流或后端超时设置。")
        
        if stats["qps"] < stats["concurrency"] * 0.5:
            analysis.append("🐢 **吞吐量瓶颈**: 实际 QPS 远低于预期并发。这暗示后端可能存在请求串行化或硬性带宽限制。")
            
        return analysis

# HTML 报告模板（基于 Jinja2）
HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>LLM 性能测试报告 - {{ stats.model }}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 1000px; margin: 0 auto; padding: 20px; background: #f4f7f9; }
        .card { background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); padding: 25px; margin-bottom: 20px; }
        h1, h2 { color: #2c3e50; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; }
        .metric { text-align: center; padding: 15px; background: #ebf2f7; border-radius: 6px; }
        .metric-value { font-size: 24px; font-weight: bold; color: #3498db; }
        .metric-label { font-size: 14px; color: #7f8c8d; }
        .analysis-item { padding: 10px; border-left: 4px solid #3498db; background: #f9f9f9; margin-bottom: 10px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { text-align: left; padding: 12px; border-bottom: 1px solid #eee; }
        th { background: #f8f9fa; }
    </style>
</head>
<body>
    <h1>🚀 LLM 性能分析专家报告</h1>
    <div class="card">
        <h2>核心摘要: {{ stats.model }}</h2>
        <div class="grid">
            <div class="metric"><div class="metric-value">{{ stats.qps }}</div><div class="metric-label">QPS (每秒请求)</div></div>
            <div class="metric"><div class="metric-value">{{ stats.tps }}</div><div class="metric-label">TPS (每秒 Token)</div></div>
            <div class="metric"><div class="metric-value">{{ stats.avg_ttft }}ms</div><div class="metric-label">平均首字延迟</div></div>
            <div class="metric"><div class="metric-value">{{ stats.p95_latency }}ms</div><div class="metric-label">P95 总延迟</div></div>
        </div>
    </div>

    <div class="card">
        <h2>专家诊断分析</h2>
        {% for item in analysis %}
        <div class="analysis-item">{{ item }}</div>
        {% endfor %}
    </div>

    <div class="card">
        <h2>详细统计数据</h2>
        <table>
            <tr><th>指标名称</th><th>数值</th></tr>
            <tr><td>总请求数</td><td>{{ stats.total_requests }}</td></tr>
            <tr><td>成功请求</td><td>{{ stats.successful }}</td></tr>
            <tr><td>失败请求</td><td>{{ stats.failed }}</td></tr>
            <tr><td>P95 TTFT</td><td>{{ stats.p95_ttft }} ms</td></tr>
            <tr><td>测试总耗时</td><td>{{ stats.total_time }} s</td></tr>
        </table>
    </div>

    <div class="card">
        <h2>延迟分布曲线 (Latency Distribution)</h2>
        <canvas id="latencyChart"></canvas>
    </div>

    <script>
        const ctx = document.getElementById('latencyChart').getContext('2d');
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: {{ labels | tojson }},
                datasets: [{
                    label: '总延迟 (ms)',
                    data: {{ latencies | tojson }},
                    borderColor: '#3498db',
                    tension: 0.1,
                    fill: false
                }]
            },
            options: { responsive: true, scales: { y: { beginAtZero: true, title: { display: true, text: '延迟 (毫秒)' } } } }
        });
    </script>
</body>
</html>
"""

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True, help="API 接口地址")
    parser.add_argument("--key", required=True, help="API 密钥")
    parser.add_argument("--model", required=True, help="模型名称")
    parser.add_argument("--type", choices=['image', 'text', 'json'], default='text', help="输入类型：图片(image)、文本(text)、JSON模板(json)")
    parser.add_argument("--input", required=True, help="提示词、图片路径，或 JSON 模板文件路径")
    parser.add_argument("--c", type=int, default=1, help="并发数")
    parser.add_argument("--d", type=int, default=10, help="持续时间(秒)")
    parser.add_argument("--no-stream", action="store_true", help="禁用流式传输")
    parser.add_argument("--output-dir", default="reports", help="报告输出目录")
    args = parser.parse_args()

    # 处理输入内容，生成最终请求 payload
    payload = MultimodalInputProcessor.process_payload(args.type, args.input, args.model, not args.no_stream)
    
    # 打印 payload 预览以便排查
    print(">>> Request Payload Preview:")
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    print("<<< ======================")

    # 初始化测试器
    tester = LLMPerfTesterV2(args.url, args.key, args.model, payload, args.c, args.d, stream=not args.no_stream)
    
    # 运行测试并获取数据
    report_data = asyncio.run(tester.run())
    
    # 渲染 HTML 报告
    template = Template(HTML_TEMPLATE)
    successful_results = [r for r in report_data["raw_results"] if r.get("success")]
    latencies = [r["total_latency"] for r in successful_results]
    labels = [i for i in range(len(latencies))]
    
    html_output = template.render(
        stats=report_data["stats"], 
        analysis=report_data["analysis"],
        latencies=latencies,
        labels=labels
    )
    
    # 确保输出目录存在
    os.makedirs(args.output_dir, exist_ok=True)
    
    # 报告命名前缀
    file_prefix = f"{args.model.replace('/', '_')}_c{args.c}_d{args.d}"
    
    # 保存 JSON 结果
    json_path = os.path.join(args.output_dir, f"{file_prefix}_results.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(report_data, f, indent=2, ensure_ascii=False)
    
    # 保存 HTML 报告文件
    report_path = os.path.join(args.output_dir, f"{file_prefix}_report.html")
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(html_output)
    
    # 为了兼容旧流程，在当前目录也生成一份 perf_report.html
    legacy_report_path = os.path.join(os.getcwd(), "perf_report.html")
    with open(legacy_report_path, "w", encoding="utf-8") as f:
        f.write(html_output)
    
    print(f"REPORT_PATH: {report_path}")
    print(f"JSON_PATH: {json_path}")
    print(json.dumps(report_data["stats"], indent=2, ensure_ascii=False))
