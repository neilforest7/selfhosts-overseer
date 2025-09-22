"""Internal API client for communicating with the main application."""

import httpx
import asyncio
from typing import Dict, Any, Optional
from .config import ServerConfig
from .performance import monitor_performance, ConnectionPool


class APIError(Exception):
    """API 错误"""

    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


class InternalAPIClient:
    """内部 API 客户端"""

    def __init__(self, config: ServerConfig):
        self.config = config
        self.connection_pool = ConnectionPool(
            max_connections=5, 
            base_url=config.api_base_url
        )
        self._default_headers = {}
        self._auth_token: Optional[str] = None
        self._token_lock = asyncio.Lock()

    async def _get_auth_token(self) -> str:
        """获取认证令牌"""
        async with self._token_lock:
            if self._auth_token:
                return self._auth_token
            
            # 登录获取令牌
            client = await self.connection_pool.get_connection()
            try:
                login_data = {
                    "username": self.config.username,
                    "password": self.config.password
                }
                
                response = await client.post("/auth/login", json=login_data)
                response.raise_for_status()
                
                result = response.json()
                if result.get("success") and result.get("token"):
                    self._auth_token = result["token"]
                    return self._auth_token
                else:
                    raise APIError(f"Login failed: {result.get('message', 'Unknown error')}")
                    
            except httpx.HTTPError as e:
                raise APIError(f"Authentication failed: {e}")
            finally:
                await self.connection_pool.return_connection(client)

    async def _ensure_auth_token(self):
        """确保有有效的认证令牌"""
        if not self._auth_token:
            await self._get_auth_token()
        
        # 更新默认头部
        self._default_headers = {
            "Authorization": f"Bearer {self._auth_token}"
        }

    @monitor_performance
    async def get(self, endpoint: str, **kwargs) -> Dict[str, Any]:
        """GET 请求包装器"""
        await self._ensure_auth_token()
        
        client = await self.connection_pool.get_connection()
        try:
            # 合并默认头部
            headers = {**self._default_headers, **kwargs.get("headers", {})}
            kwargs["headers"] = headers

            response = await client.get(endpoint, **kwargs)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            raise APIError(f"API request failed: {e}")
        finally:
            await self.connection_pool.return_connection(client)

    @monitor_performance
    async def post(self, endpoint: str, **kwargs) -> Dict[str, Any]:
        """POST 请求包装器"""
        await self._ensure_auth_token()
        
        client = await self.connection_pool.get_connection()
        try:
            # 合并默认头部
            headers = {**self._default_headers, **kwargs.get("headers", {})}
            kwargs["headers"] = headers

            response = await client.post(endpoint, **kwargs)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            raise APIError(f"API request failed: {e}")
        finally:
            await self.connection_pool.return_connection(client)

    async def close(self):
        """关闭客户端连接"""
        await self.connection_pool.close_all()
