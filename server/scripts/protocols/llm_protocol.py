import aiohttp
import time
import json
import os
from typing import Dict, Any
from .protocol_interface import BaseProtocolExecutor

class LlmProtocolExecutor(BaseProtocolExecutor):
    """大模型接口性能测试执行插件"""
    
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

    async def prepare_payload(self) -> Dict[str, Any]:
        """根据配置准备请求 Payload"""
        input_type = self.config.get('input_type', 'text')
        input_data = self.config.get('input_data', '')
        model = self.config.get('model', '')
        stream = self.config.get('stream', True)

        payload = {"model": model, "stream": stream}

        if stream:
            # 向 OpenAI 类接口申请返回 stream 状态下的 usage 指标
            payload["stream_options"] = {"include_usage": True}

        # Resolve static uploads path to local disk path
        resolved_input_data = input_data
        if isinstance(input_data, str) and input_data.startswith('/uploads/'):
            filename = os.path.basename(input_data)
            disk_path = os.path.join('/tmp/llm-perf-tests/uploads', filename)
            if os.path.exists(disk_path):
                if input_type in ['image', 'video']:
                    import base64
                    import mimetypes
                    mime_type, _ = mimetypes.guess_type(disk_path)
                    if not mime_type:
                        mime_type = 'image/jpeg' if input_type == 'image' else 'video/mp4'
                    try:
                        with open(disk_path, 'rb') as f:
                            file_bytes = f.read()
                            b64_str = base64.b64encode(file_bytes).decode('utf-8')
                            resolved_input_data = f"data:{mime_type};base64,{b64_str}"
                    except Exception as e:
                        print(f"Failed to read upload file {disk_path}: {e}")
                else:
                    resolved_input_data = disk_path

        if input_type == 'text':
            payload["messages"] = [{"role": "user", "content": resolved_input_data}]
        elif input_type == 'image':
            payload["messages"] = [{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": resolved_input_data}},
                    {"type": "text", "text": "Describe this image."}
                ]
            }]
        elif input_type == 'video':
            payload["messages"] = [{
                "role": "user",
                "content": [
                    {"type": "video_url", "video_url": {"url": resolved_input_data}},
                    {"type": "text", "text": "Describe this video."}
                ]
            }]
        elif input_type == 'json':
            if os.path.exists(resolved_input_data):
                with open(resolved_input_data, 'r') as f:
                    payload = json.load(f)
            else:
                payload = json.loads(resolved_input_data)
        
        return payload

    async def make_request(self, session: aiohttp.ClientSession, payload: Dict[str, Any]) -> Dict[str, Any]:
        """发起单个大模型请求并收集深度指标"""
        api_key = self.config.get('key', '').strip()
        if api_key.startswith("Bearer "):
            api_key = api_key[7:].strip()
            
        headers = {
            "Authorization": f"Bearer {api_key}",
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
            async with session.post(self.config.get('url', ''), headers=headers, json=payload, timeout=300) as response:
                if response.status != 200:
                    error_msg = f"Status {response.status}: {await response.text()}"
                else:
                    if self.config.get('stream', True):
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
            "total_latency": total_latency,
            "custom_metrics": {
                "ttft": ttft,
                "tokens": total_tokens,
                "itls": itls
            }
        }
