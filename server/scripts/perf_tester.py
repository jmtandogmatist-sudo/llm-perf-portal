import asyncio
import time
import json
import argparse
import aiohttp
import numpy as np
from typing import List, Dict, Any

class LLMPerfTester:
    def __init__(self, api_url: str, api_key: str, model: str, prompt: str, concurrency: int, duration: int):
        self.api_url = api_url
        self.api_key = api_key.strip()
        if self.api_key.startswith("Bearer "):
            self.api_key = self.api_key[7:].strip()
        self.model = model
        self.prompt = prompt
        self.concurrency = concurrency
        self.duration = duration
        self.results = []
        self.start_time = 0

    async def make_request(self, session: aiohttp.ClientSession):
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": self.prompt}],
            "stream": True
        }
        
        request_start = time.perf_counter()
        ttft = None
        total_tokens = 0
        
        try:
            async with session.post(self.api_url, headers=headers, json=payload) as response:
                if response.status != 200:
                    return None
                
                async for line in response.content:
                    line = line.decode('utf-8').strip()
                    if not line or line == "data: [DONE]":
                        continue
                    
                    if line.startswith("data: "):
                        if ttft is None:
                            ttft = (time.perf_counter() - request_start) * 1000
                        
                        try:
                            data = json.loads(line[6:])
                            if "choices" in data and len(data["choices"]) > 0:
                                delta = data["choices"][0].get("delta", {})
                                if "content" in delta:
                                    total_tokens += 1
                        except:
                            pass
                            
                total_latency = (time.perf_counter() - request_start) * 1000
                return {
                    "ttft": ttft,
                    "total_latency": total_latency,
                    "tokens": total_tokens,
                    "success": True
                }
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def worker(self):
        async with aiohttp.ClientSession() as session:
            while time.perf_counter() - self.start_time < self.duration:
                res = await self.make_request(session)
                if res:
                    self.results.append(res)

    async def run(self):
        print(f"Starting test: {self.concurrency} concurrency, {self.duration}s duration")
        self.start_time = time.perf_counter()
        tasks = [asyncio.create_task(self.worker()) for _ in range(self.concurrency)]
        await asyncio.gather(*tasks)
        self.report()

    def report(self):
        successful = [r for r in self.results if r.get("success")]
        if not successful:
            print("No successful requests.")
            return

        ttfts = [r["ttft"] for r in successful if r["ttft"] is not None]
        latencies = [r["total_latency"] for r in successful]
        tokens = [r["tokens"] for r in successful]
        
        total_time = time.perf_counter() - self.start_time
        qps = len(successful) / total_time
        tps = sum(tokens) / total_time
        
        print("\n--- Test Results ---")
        print(f"Total Requests: {len(self.results)}")
        print(f"Successful Requests: {len(successful)}")
        print(f"QPS: {qps:.2f} req/s")
        print(f"TPS (Output): {tps:.2f} tokens/s")
        if ttfts:
            print(f"Avg TTFT: {np.mean(ttfts):.2f} ms")
            print(f"P95 TTFT: {np.percentile(ttfts, 95):.2f} ms")
        print(f"Avg Latency: {np.mean(latencies):.2f} ms")
        print(f"P95 Latency: {np.percentile(latencies, 95):.2f} ms")
        print(f"Total Duration: {total_time:.2f} s")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--key", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--prompt", default="Hello, write a short poem about AI.")
    parser.add_argument("--c", type=int, default=1)
    parser.add_argument("--d", type=int, default=10)
    args = parser.parse_args()

    tester = LLMPerfTester(args.url, args.key, args.model, args.prompt, args.c, args.d)
    asyncio.run(tester.run())
