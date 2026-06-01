import aiohttp
from typing import Dict, Any

class BaseProtocolExecutor:
    """所有协议执行器的抽象基类"""
    def __init__(self, protocol_config: Dict[str, Any]):
        self.config = protocol_config

    async def prepare_payload(self) -> Any:
        """根据配置准备请求的 payload"""
        raise NotImplementedError

    async def make_request(self, session: aiohttp.ClientSession, payload: Any) -> Dict[str, Any]:
        """
        发送单个请求，计算延迟并返回统一的元数据。
        必须返回以下键值结构:
        {
            "success": bool,
            "error": str,
            "total_latency": float, # ms
            "custom_metrics": dict  # 用于协议特有指标
        }
        """
        raise NotImplementedError
