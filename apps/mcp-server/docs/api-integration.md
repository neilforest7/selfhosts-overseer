# Minimal MCP Server API 集成文档

## 概述

本文档详细描述了简化版 MCP Server 与 Self-Host Serv Agent 主应用的 API 集成方案，专注于基本功能和简单实现。

## API 集成架构

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   MCP Server    │    │  Internal API   │    │   Main App      │
│   (Python)      │◄──►│   Client        │◄──►│   (NestJS)      │
│                 │    │                 │    │                 │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │ MCP Handler │ │    │ │ HTTP Client  │ │    │ │ API Router  │ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 简化的认证机制

### 基础 JWT 认证

MCP Server 使用简单的 JWT Token 认证：

```python
# apps/mcp/server/client.py
import httpx
from typing import Optional, Dict, Any
from .config import ServerConfig

class InternalAPIClient:
    def __init__(self, config: ServerConfig):
        self.config = config
        self.client = httpx.AsyncClient(
            base_url=config.api_base_url,
            timeout=config.api_timeout,
            headers={"Authorization": f"Bearer {config.api_token}"}
        )

    async def get(self, endpoint: str, **kwargs) -> Dict[str, Any]:
        """GET 请求包装器"""
        try:
            response = await self.client.get(endpoint, **kwargs)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            raise APIError(f"API request failed: {e}")

    async def post(self, endpoint: str, **kwargs) -> Dict[str, Any]:
        """POST 请求包装器"""
        try:
            response = await self.client.post(endpoint, **kwargs)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            raise APIError(f"API request failed: {e}")

class APIError(Exception):
    """API 错误"""
    pass
```

## 简化的 API 映射

### Resources API 映射

| MCP Resource | API Endpoint | Method | Description |
|--------------|--------------|--------|-------------|
| `hosts://list` | `/api/v1/hosts` | GET | 获取主机列表 |
| `hosts://{hostId}` | `/api/v1/hosts/{id}` | GET | 获取主机详情 |
| `hosts://by-tag/{tag}` | `/api/v1/hosts?tag={tag}` | GET | 按标签获取主机 |
| `containers://list` | `/api/v1/containers` | GET | 获取容器列表 |
| `containers://{containerId}` | `/api/v1/containers/{id}` | GET | 获取容器详情 |
| `containers://by-host/{hostId}` | `/api/v1/containers?hostId={hostId}` | GET | 按主机获取容器 |

### Tools API 映射

| MCP Tool | API Endpoint | Method | Description |
|----------|--------------|--------|-------------|
| `test_host_connectivity` | `/api/v1/hosts/{id}/test-connection` | POST | 测试主机连通性 |
| `manage_container` | `/api/v1/containers/{id}/manage` | POST | 管理容器 |

## 简化的资源实现

### 主机资源实现

```python
# apps/mcp/resources/hosts.py
from mcp.server.fastmcp import FastMCP
from ..server.client import InternalAPIClient

async def register_hosts_resources(mcp: FastMCP, client: InternalAPIClient):
    """注册主机相关资源"""

    @mcp.resource("hosts://list")
    async def get_hosts_list() -> str:
        """获取所有主机列表"""
        try:
            hosts = await client.get("/api/v1/hosts")
            return format_hosts_list(hosts)
        except APIError as e:
            return f"获取主机列表失败: {e}"

    @mcp.resource("hosts://{host_id}")
    async def get_host_detail(host_id: str) -> str:
        """获取特定主机详情"""
        try:
            host = await client.get(f"/api/v1/hosts/{host_id}")
            return format_host_detail(host)
        except APIError as e:
            return f"获取主机详情失败: {e}"

    @mcp.resource("hosts://by-tag/{tag}")
    async def get_hosts_by_tag(tag: str) -> str:
        """按标签获取主机"""
        try:
            hosts = await client.get(f"/api/v1/hosts?tag={tag}")
            return format_hosts_list(hosts)
        except APIError as e:
            return f"按标签获取主机失败: {e}"

def format_hosts_list(hosts: dict) -> str:
    """格式化主机列表"""
    if not hosts.get("items"):
        return "No hosts found"

    result = "=== Hosts List ===\n\n"
    for host in hosts["items"]:
        result += f"🖥️  {host['name']} ({host['id']})\n"
        result += f"   Status: {host.get('status', 'unknown')}\n"
        result += f"   Address: {host.get('address', 'N/A')}\n"
        result += f"   Tags: {', '.join(host.get('tags', []))}\n\n"

    return result

def format_host_detail(host: dict) -> str:
    """格式化主机详情"""
    result = f"=== Host Details ===\n\n"
    result += f"🖥️  {host['name']}\n"
    result += f"ID: {host['id']}\n"
    result += f"Status: {host.get('status', 'unknown')}\n"
    result += f"Address: {host.get('address', 'N/A')}\n"
    result += f"Port: {host.get('port', 22)}\n"
    result += f"Tags: {', '.join(host.get('tags', []))}\n"

    if host.get('last_connection'):
        result += f"Last Connection: {host['last_connection']}\n"

    return result
```

### 容器资源实现

```python
# apps/mcp/resources/containers.py
from mcp.server.fastmcp import FastMCP
from ..server.client import InternalAPIClient

async def register_containers_resources(mcp: FastMCP, client: InternalAPIClient):
    """注册容器相关资源"""

    @mcp.resource("containers://list")
    async def get_containers_list() -> str:
        """获取所有容器列表"""
        try:
            containers = await client.get("/api/v1/containers")
            return format_containers_list(containers)
        except APIError as e:
            return f"获取容器列表失败: {e}"

    @mcp.resource("containers://{container_id}")
    async def get_container_detail(container_id: str) -> str:
        """获取特定容器详情"""
        try:
            container = await client.get(f"/api/v1/containers/{container_id}")
            return format_container_detail(container)
        except APIError as e:
            return f"获取容器详情失败: {e}"

    @mcp.resource("containers://by-host/{host_id}")
    async def get_containers_by_host(host_id: str) -> str:
        """获取特定主机的容器"""
        try:
            containers = await client.get(f"/api/v1/containers?hostId={host_id}")
            return format_containers_list(containers)
        except APIError as e:
            return f"获取主机容器失败: {e}"

def format_containers_list(containers: dict) -> str:
    """格式化容器列表"""
    if not containers.get("items"):
        return "No containers found"

    result = "=== Containers List ===\n\n"
    for container in containers["items"]:
        result += f"📦 {container['name']} ({container['id']})\n"
        result += f"   Status: {container.get('status', 'unknown')}\n"
        result += f"   Image: {container.get('image', 'N/A')}\n"
        result += f"   Host: {container.get('host_name', 'N/A')}\n\n"

    return result

def format_container_detail(container: dict) -> str:
    """格式化容器详情"""
    result = f"=== Container Details ===\n\n"
    result += f"📦 {container['name']}\n"
    result += f"ID: {container['id']}\n"
    result += f"Status: {container.get('status', 'unknown')}\n"
    result += f"Image: {container.get('image', 'N/A')}\n"
    result += f"Host: {container.get('host_name', 'N/A')}\n"

    if container.get('ports'):
        result += f"Ports: {container['ports']}\n"

    if container.get('created_at'):
        result += f"Created: {container['created_at']}\n"

    return result
```

## 简化的工具实现

### 连通性测试工具

```python
# apps/mcp/tools/connectivity.py
from mcp.server.fastmcp import FastMCP
from ..server.client import InternalAPIClient

async def register_connectivity_tools(mcp: FastMCP, client: InternalAPIClient):
    """注册连通性测试工具"""

    @mcp.tool()
    async def test_host_connectivity(host_id: str) -> str:
        """测试指定主机的连通性

        Args:
            host_id: 主机 ID，要测试连通性的主机标识符
        """
        try:
            result = await client.post(f"/api/v1/hosts/{host_id}/test-connection")
            return format_connectivity_result(result)
        except APIError as e:
            return f"连通性测试失败: {e}"

def format_connectivity_result(result: dict) -> str:
    """格式化连通性测试结果"""
    success = result.get("success", False)
    message = result.get("message", "Unknown")

    if success:
        return f"✅ 连通性测试成功\n{message}"
    else:
        return f"❌ 连通性测试失败\n{message}"
```

### 容器管理工具

```python
# apps/mcp/tools/container_mgmt.py
from mcp.server.fastmcp import FastMCP
from ..server.client import InternalAPIClient

async def register_container_tools(mcp: FastMCP, client: InternalAPIClient):
    """注册容器管理工具"""

    @mcp.tool()
    async def manage_container(
        container_id: str,
        action: str,  # start, stop, restart
        force: bool = False
    ) -> str:
        """管理容器状态

        Args:
            container_id: 容器 ID
            action: 操作类型 (start/stop/restart)
            force: 是否强制执行
        """
        # 验证操作类型
        valid_actions = ["start", "stop", "restart"]
        if action not in valid_actions:
            return f"无效的操作类型: {action}，支持的操作: {', '.join(valid_actions)}"

        try:
            payload = {"action": action, "force": force}
            result = await client.post(f"/api/v1/containers/{container_id}/manage", json=payload)
            return format_container_action_result(result)
        except APIError as e:
            return f"容器操作失败: {e}"

def format_container_action_result(result: dict) -> str:
    """格式化容器操作结果"""
    success = result.get("success", False)
    message = result.get("message", "Unknown")

    if success:
        return f"✅ 容器操作成功\n{message}"
    else:
        return f"❌ 容器操作失败\n{message}"
```

## 简化的错误处理

### 基本错误处理

```python
# apps/mcp/server/exceptions.py
class MCPError(Exception):
    """MCP 服务器基础错误"""
    pass

class APIError(MCPError):
    """API 调用错误"""
    def __init__(self, message: str, status_code: int = None):
        super().__init__(message)
        self.status_code = status_code

class ValidationError(MCPError):
    """数据验证错误"""
    def __init__(self, message: str, field: str = None):
        super().__init__(message)
        self.field = field
```

### 错误处理装饰器

```python
# apps/mcp/server/decorators.py
import functools
from typing import Callable, Any
from ..exceptions import APIError

def handle_errors(func: Callable) -> Callable:
    """错误处理装饰器"""
    @functools.wraps(func)
    async def wrapper(*args, **kwargs) -> Any:
        try:
            return await func(*args, **kwargs)
        except APIError as e:
            return f"API 错误: {e}"
        except Exception as e:
            return f"内部错误: {e}"
    return wrapper
```

## 简化的配置管理

### 基础配置

```python
# apps/mcp/server/config.py
import os
from pydantic import BaseSettings

class ServerConfig(BaseSettings):
    """MCP 服务器配置"""
    api_base_url: str = os.getenv("API_BASE_URL", "http://localhost:3001")
    api_token: str = os.getenv("API_TOKEN", "")
    server_name: str = os.getenv("MCP_SERVER_NAME", "selfhost-serv-agent")
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    api_timeout: int = int(os.getenv("API_TIMEOUT", "30"))

    class Config:
        env_file = ".env"
```

## 简化的测试

### 基础测试

```python
# apps/mcp/tests/test_basic.py
import pytest
import asyncio
from unittest.mock import AsyncMock, patch
from server.client import InternalAPIClient
from server.config import ServerConfig

@pytest.mark.asyncio
async def test_api_client():
    """测试 API 客户端"""
    config = ServerConfig()
    client = InternalAPIClient(config)

    with patch.object(client, '_make_request') as mock_request:
        mock_request.return_value = {"data": "test"}

        result = await client.get("/api/v1/hosts")
        assert result == {"data": "test"}

@pytest.mark.asyncio
async def test_error_handling():
    """测试错误处理"""
    config = ServerConfig()
    client = InternalAPIClient(config)

    with patch.object(client, '_make_request') as mock_request:
        mock_request.side_effect = Exception("API Error")

        with pytest.raises(APIError):
            await client.get("/api/v1/hosts")
```

## 总结

这个简化的 API 集成方案专注于核心功能，提供了：

1. **简单认证**: 基础 JWT Token 认证
2. **清晰映射**: Resources 和 Tools 到 API 端点的简单映射
3. **基本错误处理**: 简单的错误处理和恢复机制
4. **最小依赖**: 只需要必要的 Python 库
5. **易于测试**: 简单的测试结构

这个方案确保了 MCP Server 能够快速、安全地与主应用通信，为 AI Agents 提供稳定可靠的基本资源访问和工具执行能力。