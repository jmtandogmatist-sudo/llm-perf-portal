import asyncio
import time
import json
import argparse
import aiohttp
import numpy as np
import os
import base64
import yaml
from jinja2 import Template
from typing import List, Dict, Any

class LLMPerfPlatform:
    """
    LLM 性能测试平台核心类 (V3)
    支持多协议驱动、深度指标收集、多种负载模式。
    """
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.api_config = config.get('api', {})
        self.test_config = config.get('test', {})
        self.report_config = config.get('report', {})
        
        self.results = []
        self.start_time = 0
        self.total_time = 0

    def prepare_payload(self) -> Dict[str, Any]:
        """根据配置准备请求 Payload"""
        input_type = self.test_config.get('input', {}).get('type', 'text')
        input_data = self.test_config.get('input', {}).get('data', '')
        model = self.api_config.get('model', '')
        stream = self.test_config.get('stream', True)

        payload = {"model": model, "stream": stream}

        if input_type == 'text':
            payload["messages"] = [{"role": "user", "content": input_data}]
        elif input_type == 'image':
            # 简化的图片处理逻辑，实际可扩展
            payload["messages"] = [{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": input_data}},
                    {"type": "text", "text": "Describe this image."}
                ]
            }]
        elif input_type == 'json':
            if os.path.exists(input_data):
                with open(input_data, 'r') as f:
                    payload = json.load(f)
            else:
                payload = json.loads(input_data)
        
        return payload

    async def make_request(self, session: aiohttp.ClientSession, payload: Dict[str, Any]):
        """发起单个请求并收集深度指标"""
        headers = {
            "Authorization": f"Bearer {self.api_config.get('key', '')}",
            "Content-Type": "application/json"
        }
        
        request_start = time.perf_counter()
        ttft = None
        token_timestamps = []
        total_tokens = 0
        success = False
        error_msg = ""

        try:
            async with session.post(self.api_config.get('url', ''), headers=headers, json=payload, timeout=300) as response:
                if response.status != 200:
                    error_msg = f"Status {response.status}: {await response.text()}"
                else:
                    if self.test_config.get('stream', True):
                        async for line in response.content:
                            line = line.decode('utf-8').strip()
                            if not line or line == "data: [DONE]": continue
                            if line.startswith("data: "):
                                current_time = time.perf_counter()
                                if ttft is None:
                                    ttft = (current_time - request_start) * 1000
                                token_timestamps.append(current_time)
                                total_tokens += 1 # 简化：每个 chunk 计为一个 token
                        success = True
                    else:
                        data = await response.json()
                        total_tokens = data.get("usage", {}).get("completion_tokens", 0)
                        ttft = (time.perf_counter() - request_start) * 1000
                        success = True
        except Exception as e:
            error_msg = str(e)

        total_latency = (time.perf_counter() - request_start) * 1000
        
        # 计算 ITL (Inter-Token Latency)
        itls = []
        if len(token_timestamps) > 1:
            itls = [(token_timestamps[i] - token_timestamps[i-1]) * 1000 for i in range(1, len(token_timestamps))]
        
        return {
            "success": success,
            "error": error_msg,
            "ttft": ttft,
            "total_latency": total_latency,
            "tokens": total_tokens,
            "itls": itls,
            "timestamp": time.time()
        }

    async def worker(self, queue: asyncio.Queue, payload: Dict[str, Any]):
        """工作协程"""
        async with aiohttp.ClientSession() as session:
            while True:
                # 根据负载模式，这里可以引入不同的调度逻辑
                # 目前简化为持续请求直到达到持续时间
                duration = getattr(self, 'actual_duration', self.test_config.get('duration', 60))
                if time.perf_counter() - self.start_time > duration:
                    break
                
                result = await self.make_request(session, payload)
                self.results.append(result)
                await asyncio.sleep(0.1) # 避免过度密集的本地循环

    async def run(self):
        """运行测试任务"""
        print(f"🚀 Starting LLM Performance Test for model: {self.api_config.get('model')}")
        self.start_time = time.perf_counter()
        payload = self.prepare_payload()
        
        load_mode = self.test_config.get('load_mode', 'constant')
        load_config = self.test_config.get('load_config', {})
        
        concurrency = 1
        duration = 60

        if load_mode == 'constant':
            concurrency = load_config.get('concurrency', 1)
            duration = load_config.get('duration', self.test_config.get('duration', 60))
        elif load_mode == 'ramp_up':
            concurrency = load_config.get('end', 1)
            duration = load_config.get('duration', self.test_config.get('duration', 60))
        elif load_mode == 'fluctuate':
            concurrency = load_config.get('max', 1)
            duration = load_config.get('duration', self.test_config.get('duration', 60))
        elif load_mode == 'spike':
            concurrency = load_config.get('spike', 1)
            duration = load_config.get('spike_duration', 10) + 60
        else:
            concurrency = self.test_config.get('concurrency', 1)
            duration = self.test_config.get('duration', 60)

        self.actual_duration = duration
        tasks = [asyncio.create_task(self.worker(None, payload)) for _ in range(concurrency)]
        
        await asyncio.gather(*tasks)
        self.total_time = time.perf_counter() - self.start_time
        print(f"🏁 Test completed in {self.total_time:.2f} seconds.")
        
        return self.analyze_results()

    def analyze_results(self):
        """分析并生成报告数据"""
        successful = [r for r in self.results if r["success"]]
        ttfts = [r["ttft"] for r in successful if r["ttft"] is not None]
        itls = [itl for r in successful for itl in r["itls"]]
        latencies = [r["total_latency"] for r in successful]
        
        stats = {
            "model": self.api_config.get('model'),
            "concurrency": self.test_config.get('concurrency'),
            "duration": self.test_config.get('duration'),
            "total_requests": len(self.results),
            "successful": len(successful),
            "failed": len(self.results) - len(successful),
            "qps": round(len(successful) / self.total_time, 2) if self.total_time > 0 else 0,
            "tps": round(sum(r["tokens"] for r in successful) / self.total_time, 2) if self.total_time > 0 else 0,
            "avg_ttft": round(np.mean(ttfts), 2) if ttfts else 0,
            "p95_ttft": round(np.percentile(ttfts, 95), 2) if ttfts else 0,
            "avg_itl": round(np.mean(itls), 2) if itls else 0,
            "avg_latency": round(np.mean(latencies), 2) if latencies else 0,
            "p95_latency": round(np.percentile(latencies, 95), 2) if latencies else 0,
        }
        
        # 专家诊断建议
        analysis = []
        if stats["p95_ttft"] > 1000:
            analysis.append("⚠️ **High TTFT detected**: P95 TTFT > 1s indicates potential prefill bottlenecks or cold starts.")
        if stats["avg_itl"] > 100:
            analysis.append("🐢 **Slow Generation**: Average ITL > 100ms may lead to a laggy reading experience.")
        if stats["failed"] > 0:
            analysis.append(f"❌ **Reliability Issue**: {stats['failed']} requests failed. Check rate limits or backend stability.")
            
        return {"stats": stats, "analysis": analysis}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="LLM Performance Platform Runner")
    parser.add_argument("--config", type=str, required=True, help="Path to config.yaml")
    args = parser.parse_args()
    
    with open(args.config, 'r') as f:
        config = yaml.safe_load(f)
    
    platform = LLMPerfPlatform(config)
    report_data = asyncio.run(platform.run())
    
    # 输出结果摘要
    print("\n--- Performance Summary ---")
    for k, v in report_data["stats"].items():
        print(f"{k}: {v}")
    print("\n--- Expert Analysis ---")
    for item in report_data["analysis"]:
        print(item)
