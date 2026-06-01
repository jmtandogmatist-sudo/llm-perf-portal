import aiohttp
import time
import json
from typing import Dict, Any
from .protocol_interface import BaseProtocolExecutor

class HttpProtocolExecutor(BaseProtocolExecutor):
    """通用 REST/HTTP 接口性能测试执行插件"""
    
    def __init__(self, protocol_config: Dict[str, Any]):
        super().__init__(protocol_config)
        self.method = self.config.get("method", "GET").upper()
        self.url = self.config.get("url", "")
        self.headers = self.config.get("headers", {})
        self.params = self.config.get("queryParams", {})
        self.body_content = self.config.get("bodyContent", "")
        self.body_type = self.config.get("bodyType", "json")
        self.expected_status = int(self.config.get("expectedStatus", 200))

    async def prepare_payload(self) -> Any:
        """根据 bodyType 准备格式"""
        if not self.body_content:
            return None
            
        if self.body_type == "json":
            try:
                # 尝试解析 JSON 字符串为 Python 字典/列表
                if isinstance(self.body_content, str):
                    return json.loads(self.body_content)
                return self.body_content
            except Exception:
                return self.body_content
        return self.body_content

    async def make_request(self, session: aiohttp.ClientSession, payload: Any) -> Dict[str, Any]:
        """发起单个通用 HTTP 请求并记录延时与响应大小"""
        request_start = time.perf_counter()
        success = False
        error_msg = ""
        status_code = None
        response_size = 0

        kwargs = {
            "headers": self.headers,
            "params": self.params,
            "timeout": aiohttp.ClientTimeout(total=30.0) # 30s 默认超时
        }

        # 挂载 Body
        if payload is not None:
            if self.body_type == "json":
                kwargs["json"] = payload
            else:
                kwargs["data"] = payload

        try:
            async with session.request(self.method, self.url, **kwargs) as response:
                status_code = response.status
                body = await response.read()
                response_size = len(body)
                
                # 检查期望的 HTTP 状态码
                if status_code == self.expected_status:
                    success = True
                else:
                    error_msg = f"HTTP 异常状态码: {status_code} (期望: {self.expected_status})"
        except Exception as e:
            error_msg = str(e)

        total_latency = (time.perf_counter() - request_start) * 1000 # 毫秒
        
        return {
            "success": success,
            "error": error_msg,
            "total_latency": total_latency,
            "custom_metrics": {
                "status_code": status_code,
                "response_size": response_size
            }
        }
