import asyncio
import time
import json
import argparse
import aiohttp
import numpy as np
import os
import yaml
from typing import List, Dict, Any

from protocols.protocol_interface import BaseProtocolExecutor
from protocols.llm_protocol import LlmProtocolExecutor
from protocols.http_protocol import HttpProtocolExecutor

class MultiProtocolPerfPlatform:
    """
    多协议性能测试平台核心类
    统一管理并发 Workers、自适应负载调度和遥测输出，协议的具体发送交由插件执行。
    """
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.test_config = config.get('test', {})
        self.report_config = config.get('report', {})
        
        # 解析测试类型 (默认为 LLM 以兼容老版本)
        self.test_type = config.get('test_type', 'LLM')
        
        # 组装协议配置
        if self.test_type == 'LLM':
            if 'api' in config:
                # 兼容老版 YAML 配置
                self.protocol_config = {
                    "url": config['api'].get('url', ''),
                    "key": config['api'].get('key', ''),
                    "model": config['api'].get('model', ''),
                    "provider": config['api'].get('provider', ''),
                    "stream": self.test_config.get('stream', True),
                    "input_type": self.test_config.get('input', {}).get('type', 'text'),
                    "input_data": self.test_config.get('input', {}).get('data', ''),
                }
            else:
                self.protocol_config = config.get('protocol_config', {})
            self.executor = LlmProtocolExecutor(self.protocol_config)
        elif self.test_type == 'REST_API':
            self.protocol_config = config.get('protocol_config', {})
            self.executor = HttpProtocolExecutor(self.protocol_config)
        else:
            raise ValueError(f"Unsupported test type: {self.test_type}")
            
        self.results = []
        self.start_time = 0
        self.total_time = 0
        self.should_stop = False
        self.active_tasks = []
        self.target_concurrency = 0
        self.running_workers = 0

    async def worker_loop(self, payload: Any):
        """工作协程的请求内循环"""
        self.running_workers += 1
        try:
            async with aiohttp.ClientSession() as session:
                while not self.should_stop:
                    # 检查是否需要收缩并发
                    if self.running_workers > self.target_concurrency:
                        break
                    result = await self.executor.make_request(session, payload)
                    # 将时间戳附在结果上用于遥测统计
                    result["timestamp"] = time.time()
                    
                    self.results.append(result)
                    
                    if self.running_workers > self.target_concurrency:
                        break
                    await asyncio.sleep(0.1) # 避免本地物理循环瞬间占满并发
        finally:
            self.running_workers -= 1

    async def adjust_concurrency_loop(self, load_mode: str, load_config: Dict[str, Any], payload: Any):
        """
        负载模式核心管理器：动态调整并发 Workers 协程数
        """
        if load_mode == 'constant':
            concurrency = load_config.get('concurrency', 1)
            self.target_concurrency = concurrency
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
            self.target_concurrency = current_concurrency
            print(f"[{time.strftime('%H:%M:%S')}] [Ramp-up] Starting with {current_concurrency} workers.")
            for _ in range(current_concurrency):
                self.active_tasks.append(asyncio.create_task(self.worker_loop(payload)))
                
            while current_concurrency < end and not self.should_stop:
                await asyncio.sleep(step_interval)
                if self.should_stop:
                    break
                to_add = min(step, end - current_concurrency)
                current_concurrency += to_add
                self.target_concurrency = current_concurrency
                for _ in range(to_add):
                    self.active_tasks.append(asyncio.create_task(self.worker_loop(payload)))
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
                
                self.target_concurrency = target
                
                # 动态伸缩 active tasks
                live_tasks = [t for t in self.active_tasks if not t.done()]
                current_count = len(live_tasks)
                
                if current_count < target:
                    for _ in range(target - current_count):
                        self.active_tasks.append(asyncio.create_task(self.worker_loop(payload)))
                
                print(f"[{time.strftime('%H:%M:%S')}] [Fluctuate] Elapsed: {elapsed:.1f}s | Target Concurrency: {target} | Active: {current_count}")
                await asyncio.sleep(2)

        elif load_mode == 'spike':
            baseline = load_config.get('baseline', 1)
            spike = load_config.get('spike', 10)
            spike_duration = load_config.get('spike_duration', 10)
            
            self.target_concurrency = baseline
            print(f"[{time.strftime('%H:%M:%S')}] [Spike] Baseline concurrency {baseline}. Spike target {spike} for {spike_duration}s.")
            for _ in range(baseline):
                self.active_tasks.append(asyncio.create_task(self.worker_loop(payload)))
                
            # 持续 15 秒基线后启动突刺
            await asyncio.sleep(15)
            if self.should_stop:
                return
                
            print(f"[{time.strftime('%H:%M:%S')}] [Spike] !!! SPIKE TRIGGERED !!! Concurrency spikes to {spike}.")
            self.target_concurrency = spike
            for _ in range(spike - baseline):
                self.active_tasks.append(asyncio.create_task(self.worker_loop(payload)))
                
            await asyncio.sleep(spike_duration)
            if self.should_stop:
                return
                
            print(f"[{time.strftime('%H:%M:%S')}] [Spike] Spike ended. Restoring back to baseline concurrency: {baseline}.")
            self.target_concurrency = baseline

    async def report_telemetry_loop(self):
        """每秒输出一次瞬时/累计遥测数据"""
        first_error_logged = False
        while not self.should_stop:
            await asyncio.sleep(1.0)
            if self.should_stop:
                break
            elapsed = time.perf_counter() - self.start_time
            successful = [r for r in self.results if r["success"]]
            failed_results = [r for r in self.results if not r["success"]]
            failed = len(failed_results)
            
            # 首次检测到失败时，打印具体的错误信息帮助诊断
            if failed > 0 and not first_error_logged:
                first_err = failed_results[0].get("error", "unknown")
                print(f"[⚠️ First Error] {first_err}")
                first_error_logged = True
            
            # 计算瞬时指标 (例如最近 3 秒内，防止被冷启动或前期指标拉平)
            now_time = time.time()
            recent_results = [r for r in self.results if now_time - r.get("timestamp", 0) < 3.0]
            recent_successful = [r for r in recent_results if r["success"]]
            
            avg_latency = np.mean([r["total_latency"] for r in recent_successful]) if recent_successful else 0
            
            # 兼容不同协议的吞吐计算
            if self.test_type == 'LLM':
                # 累计 TPS (Tokens per Second)
                total_tokens = sum(r["custom_metrics"].get("tokens", 0) for r in successful)
                cum_tps = total_tokens / elapsed if elapsed > 0 else 0
                
                # 瞬时 TTFT
                avg_ttft = np.mean([r["custom_metrics"].get("ttft") for r in recent_successful if r["custom_metrics"].get("ttft") is not None]) if recent_successful else 0
                print(f"[Telemetry] Time: {elapsed:.1f}s | Concurrency: {self.running_workers} | Success: {len(successful)} | Failed: {failed} | Latency: {avg_latency:.1f}ms | TTFT: {avg_ttft:.1f}ms | TPS: {cum_tps:.1f}")
            else:
                # 通用 QPS
                cum_qps = len(successful) / elapsed if elapsed > 0 else 0
                print(f"[Telemetry] Time: {elapsed:.1f}s | Concurrency: {self.running_workers} | Success: {len(successful)} | Failed: {failed} | Latency: {avg_latency:.1f}ms | QPS: {cum_qps:.1f}")

    async def run(self):
        """运行测试任务"""
        print(f"🚀 Starting {self.test_type} Performance Test.")
        self.start_time = time.perf_counter()
        payload = await self.executor.prepare_payload()
        
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

        # 启动自适应负载调度协程与实时遥测协程
        manager_task = asyncio.create_task(self.adjust_concurrency_loop(load_mode, load_config, payload))
        telemetry_task = asyncio.create_task(self.report_telemetry_loop())
        
        # 挂起主线程直到测试结束
        await asyncio.sleep(duration)
        
        # 触发停止信号
        self.should_stop = True
        
        # 优雅等待在途请求完成
        live_tasks = [t for t in self.active_tasks if not t.done()]
        if live_tasks:
            print(f"⏳ Waiting for {len(live_tasks)} in-flight request(s) to finish (max 30s)...")
            try:
                await asyncio.wait(live_tasks, timeout=30.0)
            except Exception:
                pass
        
        # 强制结束所有仍然未完成的任务
        still_running = [t for t in self.active_tasks if not t.done()]
        if still_running:
            print(f"⚠️ Force-cancelling {len(still_running)} task(s) that didn't finish in time.")
        for t in self.active_tasks:
            if not t.done():
                t.cancel()
        manager_task.cancel()
        telemetry_task.cancel()
        
        self.total_time = time.perf_counter() - self.start_time
        print(f"🏁 Test completed in {self.total_time:.2f} seconds.")
        
        return self.analyze_results()

    def analyze_results(self):
        """分析并生成报告数据"""
        successful = [r for r in self.results if r["success"]]
        latencies = [r["total_latency"] for r in successful]
        
        stats = {
            "total_requests": len(self.results),
            "successful": len(successful),
            "failed": len(self.results) - len(successful),
            "qps": round(len(successful) / self.total_time, 2) if self.total_time > 0 else 0,
            "avg_latency": round(np.mean(latencies), 2) if latencies else 0,
            "p95_latency": round(np.percentile(latencies, 95), 2) if latencies else 0,
            "p99_latency": round(np.percentile(latencies, 99), 2) if latencies else 0,
        }
        
        # 协议特有的后处理与性能评估
        analysis = []
        
        if self.test_type == 'LLM':
            ttfts = [r["custom_metrics"].get("ttft") for r in successful if r["custom_metrics"].get("ttft") is not None]
            
            # 计算 TPOT (Time Per Output Token) 作为 ITL 的代理指标
            tpots = []
            for r in successful:
                tokens = r["custom_metrics"].get("tokens", 0)
                ttft = r["custom_metrics"].get("ttft")
                if tokens > 1 and ttft is not None:
                    tpot = (r["total_latency"] - ttft) / (tokens - 1)
                    tpots.append(tpot)
                elif tokens == 1 and ttft is not None:
                    tpots.append(r["total_latency"] - ttft)

            stats.update({
                "avg_ttft": round(np.mean(ttfts), 2) if ttfts else 0,
                "p95_ttft": round(np.percentile(ttfts, 95), 2) if ttfts else 0,
                "p99_ttft": round(np.percentile(ttfts, 99), 2) if ttfts else 0,
                "avg_itl": round(np.mean(tpots), 2) if tpots else 0,
                "tps": round(sum(r["custom_metrics"].get("tokens", 0) for r in successful) / self.total_time, 2) if self.total_time > 0 else 0,
            })
            
            if stats["p95_ttft"] > 1000:
                analysis.append("⚠️ **High TTFT detected**: P95 TTFT > 1s indicates potential prefill bottlenecks or cold starts.")
            if stats["avg_itl"] > 100:
                analysis.append("🐢 **Slow Generation**: Average ITL > 100ms may lead to a laggy reading experience.")
        else:
            # REST API 特有分析
            response_sizes = [r["custom_metrics"].get("response_size", 0) for r in successful]
            avg_response_size = np.mean(response_sizes) if response_sizes else 0
            
            # 统计 HTTP 状态码分布
            status_codes = {}
            for r in self.results:
                code = r["custom_metrics"].get("status_code")
                if code:
                    status_codes[code] = status_codes.get(code, 0) + 1
            
            stats.update({
                "avg_response_size": round(avg_response_size, 2),
                "status_codes": json.dumps(status_codes),
                # 填充默认 LLM 字段防止 TS 解析报错
                "avg_ttft": 0,
                "p95_ttft": 0,
                "p99_ttft": 0,
                "avg_itl": 0,
                "tps": 0,
            })
            
            if stats["failed"] > 0:
                analysis.append(f"❌ **API Error rate is non-zero**: {stats['failed']} requests failed. Verify server capacity.")
            if stats["p95_latency"] > 500:
                analysis.append("⚠️ **Slow API response**: P95 Latency > 500ms. Consider checking DB indexes or network bottlenecks.")

        if stats["failed"] > 0:
            failed_results = [r for r in self.results if not r["success"] and r.get("error")]
            unique_errors = list(dict.fromkeys(r["error"] for r in failed_results))[:3]
            if unique_errors:
                analysis.append("📋 **Error Samples (前 3 条去重错误):**")
                for i, err in enumerate(unique_errors, 1):
                    err_display = err[:300] + "..." if len(err) > 300 else err
                    analysis.append(f"  {i}. {err_display}")
            stats["error_samples"] = unique_errors
            
        return {"stats": stats, "analysis": analysis}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Multi-Protocol Performance Platform Runner")
    parser.add_argument("--config", type=str, required=True, help="Path to config.yaml")
    args = parser.parse_args()
    
    with open(args.config, 'r') as f:
        config = yaml.safe_load(f)
    
    platform = MultiProtocolPerfPlatform(config)
    report_data = asyncio.run(platform.run())
    
    # 输出结果摘要
    print("\n--- Performance Summary ---")
    for k, v in report_data["stats"].items():
        print(f"{k}: {v}")
    print("\n--- Expert Analysis ---")
    for item in report_data["analysis"]:
        print(item)
