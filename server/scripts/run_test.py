import asyncio
import time
import json
import argparse
import aiohttp
import numpy as np
import os
import yaml
from typing import List, Dict, Any

class LLMPerfPlatform:
    """
    LLM 性能测试平台核心类 (V3 - 重构版)
    支持真实 Token 计数评估、多负载并发模式动态调度。
    """
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.api_config = config.get('api', {})
        self.test_config = config.get('test', {})
        self.report_config = config.get('report', {})
        
        self.results = []
        self.start_time = 0
        self.total_time = 0
        self.should_stop = False
        self.active_tasks = []

    def estimate_tokens_heuristic(self, text: str) -> int:
        """
        启发式 Token 计数器：针对未返回 native usage 的供应商计算近似 Token
        中文字符估算为 1.5 token，英文单词估算为 1.3 token，符号为空白字符估算为 0.3 token
        """
        if not text:
            return 0
        chinese_chars = 0
        other_chars = 0
        for char in text:
            if '\u4e00' <= char <= '\u9fff':
                chinese_chars += 1
            else:
                other_chars += 1
        
        words = len(text.split())
        symbols_and_spaces = max(0, other_chars - words)
        estimated = int(chinese_chars * 1.5 + words * 1.3 + symbols_and_spaces * 0.3)
        return max(1, estimated)

    def prepare_payload(self) -> Dict[str, Any]:
        """根据配置准备请求 Payload"""
        input_type = self.test_config.get('input', {}).get('type', 'text')
        input_data = self.test_config.get('input', {}).get('data', '')
        model = self.api_config.get('model', '')
        stream = self.test_config.get('stream', True)

        payload = {"model": model, "stream": stream}

        if stream:
            # 向 OpenAI 类接口申请返回 stream 状态下的 usage 指标
            payload["stream_options"] = {"include_usage": True}

        if input_type == 'text':
            payload["messages"] = [{"role": "user", "content": input_data}]
        elif input_type == 'image':
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
        accumulated_content = ""

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
                                
                                # 解析流数据，累加内容或提取官方 token 计数
                                try:
                                    chunk_data = json.loads(line[6:])
                                    # 1. 尝试从 stream_options 提取官方统计
                                    if "usage" in chunk_data and chunk_data["usage"]:
                                        usage_tokens = chunk_data["usage"].get("completion_tokens", 0)
                                        if usage_tokens > 0:
                                            total_tokens = usage_tokens
                                    
                                    # 2. 累加文字内容用于 fallback 启发式估算
                                    if "choices" in chunk_data and len(chunk_data["choices"]) > 0:
                                        delta = chunk_data["choices"][0].get("delta", {})
                                        content = delta.get("content", "")
                                        if content:
                                            accumulated_content += content
                                except:
                                    pass
                        
                        # Fallback 估算 Token
                        if total_tokens == 0 and accumulated_content:
                            total_tokens = self.estimate_tokens_heuristic(accumulated_content)
                        elif total_tokens == 0:
                            # 终极 Fallback (按 chunk 估算)
                            total_tokens = len(token_timestamps)

                        success = True
                    else:
                        data = await response.json()
                        total_tokens = data.get("usage", {}).get("completion_tokens", 0)
                        if total_tokens == 0:
                            # 如果非流式接口没有返回 usage，估算它的 choices content
                            try:
                                choices_text = data["choices"][0]["message"]["content"]
                                total_tokens = self.estimate_tokens_heuristic(choices_text)
                            except:
                                pass
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

    async def worker_loop(self, payload: Dict[str, Any]):
        """工作协程的请求内循环"""
        async with aiohttp.ClientSession() as session:
            while not self.should_stop:
                result = await self.make_request(session, payload)
                self.results.append(result)
                await asyncio.sleep(0.1) # 避免本地物理循环瞬间占满并发

    async def adjust_concurrency_loop(self, load_mode: str, load_config: Dict[str, Any], payload: Dict[str, Any]):
        """
        负载模式核心管理器：动态调整并发 Workers 协程数
        """
        if load_mode == 'constant':
            concurrency = load_config.get('concurrency', 1)
            print(f"[{time.strftime('%H:%M:%S')}] [Constant] Spawning {concurrency} static workers.")
            for _ in range(concurrency):
                self.active_tasks.append(asyncio.create_task(self.worker_loop(payload)))

        elif load_mode == 'ramp_up':
            start = load_config.get('start', 1)
            end = load_config.get('end', 10)
            step = load_config.get('step', 2)
            duration = load_config.get('duration', 60)
            
            # 计算阶梯步长周期
            num_steps = max(1, (end - start) // step)
            step_interval = duration / num_steps
            
            current_concurrency = start
            print(f"[{time.strftime('%H:%M:%S')}] [Ramp-up] Starting with {current_concurrency} workers.")
            for _ in range(current_concurrency):
                self.active_tasks.append(asyncio.create_task(self.worker_loop(payload)))
                
            while current_concurrency < end and not self.should_stop:
                await asyncio.sleep(step_interval)
                if self.should_stop:
                    break
                to_add = min(step, end - current_concurrency)
                for _ in range(to_add):
                    self.active_tasks.append(asyncio.create_task(self.worker_loop(payload)))
                current_concurrency += to_add
                print(f"[{time.strftime('%H:%M:%S')}] [Ramp-up] Scaled up to {current_concurrency} workers.")

        elif load_mode == 'fluctuate':
            min_c = load_config.get('min', 1)
            max_c = load_config.get('max', 10)
            period = load_config.get('period', 30)
            print(f"[{time.strftime('%H:%M:%S')}] [Fluctuate] Oscillating concurrency [{min_c} ~ {max_c}] every {period}s.")
            
            while not self.should_stop:
                elapsed = time.perf_counter() - self.start_time
                sine_val = np.sin((2 * np.pi * elapsed) / period)
                target = int(min_c + (max_c - min_c) * (sine_val + 1) / 2)
                target = max(1, target)
                
                # 动态伸缩 active tasks
                live_tasks = [t for t in self.active_tasks if not t.done()]
                current_count = len(live_tasks)
                
                if current_count < target:
                    for _ in range(target - current_count):
                        self.active_tasks.append(asyncio.create_task(self.worker_loop(payload)))
                elif current_count > target:
                    for i in range(current_count - target):
                        live_tasks[i].cancel()
                
                print(f"[{time.strftime('%H:%M:%S')}] [Fluctuate] Elapsed: {elapsed:.1f}s | Target Concurrency: {target}")
                await asyncio.sleep(2)

        elif load_mode == 'spike':
            baseline = load_config.get('baseline', 1)
            spike = load_config.get('spike', 10)
            spike_duration = load_config.get('spike_duration', 10)
            
            print(f"[{time.strftime('%H:%M:%S')}] [Spike] Baseline concurrency {baseline}. Spike target {spike} for {spike_duration}s.")
            for _ in range(baseline):
                self.active_tasks.append(asyncio.create_task(self.worker_loop(payload)))
                
            # 持续 15 秒基线后启动突刺
            await asyncio.sleep(15)
            if self.should_stop:
                return
                
            print(f"[{time.strftime('%H:%M:%S')}] [Spike] !!! SPIKE TRIGGERED !!! Concurrency spikes to {spike}.")
            spike_tasks = []
            for _ in range(spike - baseline):
                t = asyncio.create_task(self.worker_loop(payload))
                self.active_tasks.append(t)
                spike_tasks.append(t)
                
            await asyncio.sleep(spike_duration)
            if self.should_stop:
                return
                
            print(f"[{time.strftime('%H:%M:%S')}] [Spike] Spike ended. Restoring back to baseline concurrency: {baseline}.")
            for t in spike_tasks:
                if not t.done():
                    t.cancel()

    async def run(self):
        """运行测试任务"""
        print(f"🚀 Starting LLM Performance Test for model: {self.api_config.get('model')}")
        self.start_time = time.perf_counter()
        payload = self.prepare_payload()
        
        load_mode = self.test_config.get('load_mode', 'constant')
        load_config = self.test_config.get('load_config', {})
        
        duration = 60
        if load_mode == 'constant':
            duration = load_config.get('duration', 60)
        elif load_mode in ['ramp_up', 'fluctuate']:
            duration = load_config.get('duration', 60)
        elif load_mode == 'spike':
            duration = load_config.get('spike_duration', 10) + 20 # 15s baseline + spike_duration + 5s cooldown
        else:
            duration = self.test_config.get('duration', 60)

        # 启动自适应负载调度协程
        manager_task = asyncio.create_task(self.adjust_concurrency_loop(load_mode, load_config, payload))
        
        # 挂起主线程直到测试结束
        await asyncio.sleep(duration)
        
        # 触发停止信号
        self.should_stop = True
        
        # 强制结束所有仍然活动的任务并收集数据
        for t in self.active_tasks:
            if not t.done():
                t.cancel()
        manager_task.cancel()
        
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
