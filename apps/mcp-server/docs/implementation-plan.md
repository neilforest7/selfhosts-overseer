# Minimal MCP Server Implementation Plan

## 开发计划概览

本文档详细描述了 Self-Host Serv Agent 简化版 MCP 服务器的实施计划，专注于快速实现核心功能。

## 技术栈选择

### 核心技术
- **语言**: Python 3.12+
- **MCP 框架**: FastMCP (官方 Python SDK)
- **HTTP 客户端**: httpx (异步 HTTP 客户端)
- **配置**: Pydantic + 环境变量
- **日志**: Python 标准日志库
- **测试**: pytest

### 依赖管理
```python
# requirements.txt
mcp>=1.2.0
fastmcp>=0.1.0
httpx>=0.25.0
pydantic>=2.5.0
pytest>=7.4.0
pytest-asyncio>=0.21.0
```

## 第一阶段：基础实现 (1 周)

### 1.1 项目初始化 (1 天)

**任务列表:**
- [ ] 创建项目目录结构
- [ ] 初始化 Python 项目
- [ ] 配置 requirements.txt 和 pyproject.toml
- [ ] 创建基础配置文件

**交付物:**
- 完整的项目目录结构
- 可工作的开发环境

**详细步骤:**

```bash
# 创建项目结构
mkdir -p apps/mcp/{server,resources,tools,tests,docs}
cd apps/mcp

# 配置 pyproject.toml
cat > pyproject.toml << EOF
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "selfhost-mcp-server"
version = "1.0.0"
description = "Minimal MCP Server for Self-Host Serv Agent"
authors = [{name = "Self-Host Team"}]
license = {text = "MIT"}
requires-python = ">=3.12"
dependencies = [
    "mcp>=1.2.0",
    "fastmcp>=0.1.0",
    "httpx>=0.25.0",
    "pydantic>=2.5.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.4.0",
    "pytest-asyncio>=0.21.0",
]

[tool.black]
line-length = 88
target-version = ['py312']
EOF
```

### 1.2 MCP Server 基础框架 (2 天)

**任务列表:**
- [ ] 实现 MCP Server 基础类
- [ ] 配置日志系统
- [ ] 实现配置管理
- [ ] 创建服务器入口点

**关键实现:**

```python
# apps/mcp/server/main.py
import asyncio
from mcp.server.fastmcp import FastMCP
from .config import ServerConfig
from .client import InternalAPIClient

async def main():
    # 初始化配置
    config = ServerConfig()

    # 创建 MCP 服务器
    mcp = FastMCP(config.server_name)

    # 创建 API 客户端
    api_client = InternalAPIClient(config)

    # 注册资源和工具
    from ..resources.hosts import register_hosts_resources
    from ..resources.containers import register_containers_resources
    from ..tools.connectivity import register_connectivity_tools
    from ..tools.container_mgmt import register_container_tools

    await register_hosts_resources(mcp, api_client)
    await register_containers_resources(mcp, api_client)
    await register_connectivity_tools(mcp, api_client)
    await register_container_tools(mcp, api_client)

    # 启动服务器
    await mcp.run(transport='stdio')

if __name__ == "__main__":
    asyncio.run(main())
```

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

### 1.3 Internal API Client (2 天)

**任务列表:**
- [ ] 实现 HTTP 客户端类
- [ ] 添加 JWT 认证机制
- [ ] 实现基本错误处理
- [ ] 添加重试逻辑

**关键实现:**

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

### 1.4 基础 Resources 实现 (2 天)

**任务列表:**
- [ ] 实现 Hosts Resource (只读)
- [ ] 实现 Containers Resource (只读)
- [ ] 添加基本测试

**关键实现:**

```python
# apps/mcp/resources/hosts.py
from mcp.server.fastmcp import FastMCP
from ..server.client import InternalAPIClient

async def register_hosts_resources(mcp: FastMCP, client: InternalAPIClient):
    """注册主机相关资源"""

    @mcp.resource("hosts://list")
    async def get_hosts_list() -> str:
        """获取所有主机列表"""
        hosts = await client.get("/api/v1/hosts")
        return format_hosts_list(hosts)

    @mcp.resource("hosts://{host_id}")
    async def get_host_detail(host_id: str) -> str:
        """获取特定主机详情"""
        host = await client.get(f"/api/v1/hosts/{host_id}")
        return format_host_detail(host)

    @mcp.resource("hosts://by-tag/{tag}")
    async def get_hosts_by_tag(tag: str) -> str:
        """按标签获取主机"""
        hosts = await client.get(f"/api/v1/hosts?tag={tag}")
        return format_hosts_list(hosts)

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

```python
# apps/mcp/resources/containers.py
from mcp.server.fastmcp import FastMCP
from ..server.client import InternalAPIClient

async def register_containers_resources(mcp: FastMCP, client: InternalAPIClient):
    """注册容器相关资源"""

    @mcp.resource("containers://list")
    async def get_containers_list() -> str:
        """获取所有容器列表"""
        containers = await client.get("/api/v1/containers")
        return format_containers_list(containers)

    @mcp.resource("containers://{container_id}")
    async def get_container_detail(container_id: str) -> str:
        """获取特定容器详情"""
        container = await client.get(f"/api/v1/containers/{container_id}")
        return format_container_detail(container)

    @mcp.resource("containers://by-host/{host_id}")
    async def get_containers_by_host(host_id: str) -> str:
        """获取特定主机的容器"""
        containers = await client.get(f"/api/v1/containers?hostId={host_id}")
        return format_containers_list(containers)

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

**第一阶段验收标准:**
- [ ] MCP Server 可以成功启动
- [ ] 可以通过 MCP Client 连接
- [ ] 基础 Resources 可以正常访问
- [ ] API 客户端可以正常调用

## 第二阶段：功能完善 (1 周)

### 2.1 核心 Tools 实现 (3 天)

**任务列表:**
- [ ] 实现连通性测试工具
- [ ] 实现容器管理工具 (启动/停止/重启)
- [ ] 添加基本测试

**关键实现:**

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
        except Exception as e:
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
        except Exception as e:
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

### 2.2 测试和集成 (2 天)

**任务列表:**
- [ ] 编写单元测试
- [ ] 编写集成测试
- [ ] 错误处理验证
- [ ] 性能优化

**测试实现:**

```python
# apps/mcp/tests/test_basic.py
import pytest
import asyncio
from unittest.mock import AsyncMock, patch
from server.main import main
from server.config import ServerConfig

@pytest.mark.asyncio
async def test_hosts_resource():
    """测试主机资源访问"""
    config = ServerConfig()
    with patch('server.client.InternalAPIClient') as mock_client:
        # Mock API 响应
        mock_client.return_value.get.return_value = {
            "items": [
                {
                    "id": "test-host",
                    "name": "Test Host",
                    "status": "online",
                    "address": "192.168.1.100",
                    "tags": ["test"]
                }
            ]
        }

        # 创建 MCP 服务器
        mcp = FastMCP("test-server")
        from resources.hosts import register_hosts_resources
        await register_hosts_resources(mcp, mock_client.return_value)

        # 测试资源访问
        result = await mcp._resources["hosts://list"]()
        assert "Test Host" in result
        assert "test-host" in result

@pytest.mark.asyncio
async def test_connectivity_tool():
    """测试连通性工具"""
    with patch('server.client.InternalAPIClient') as mock_client:
        mock_client.return_value.post.return_value = {
            "success": True,
            "message": "Connection successful"
        }

        # 创建 MCP 服务器
        mcp = FastMCP("test-server")
        from tools.connectivity import register_connectivity_tools
        await register_connectivity_tools(mcp, mock_client.return_value)

        # 测试工具调用
        result = await mcp._tools["test_host_connectivity"]("test-host")
        assert "成功" in result
```

### 2.3 部署准备 (2 天)

**任务列表:**
- [ ] 创建 Dockerfile
- [ ] 配置 docker-compose 集成
- [ ] 完善文档
- [ ] 最终测试

**Dockerfile 实现:**

```dockerfile
FROM python:3.12-slim

WORKDIR /app

# 复制依赖文件
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY . .

# 创建非 root 用户
RUN useradd -m -u 1000 mcpuser && chown -R mcpuser:mcpuser /app
USER mcpuser

# 启动命令
CMD ["python", "-m", "server.main"]
```

**第二阶段验收标准:**
- [ ] 所有 Resources 可以正常访问
- [ ] 所有 Tools 可以正常执行
- [ ] 测试覆盖率达到 80%+
- [ ] 部署配置完整

## 成功标准

### 功能标准
- [ ] Hosts Resource 可以正常访问
- [ ] Containers Resource 可以正常访问
- [ ] 连通性测试工具可以正常执行
- [ ] 容器管理工具可以正常执行

### 性能标准
- [ ] 95% 的请求响应时间 < 1 秒
- [ ] 错误率 < 5%

### 质量标准
- [ ] 代码结构清晰，易于理解
- [ ] 基本测试覆盖
- [ ] 文档完整

## 总结

这个简化的实施计划提供了一个 2 周的开发路线图，将 Self-Host Serv Agent 简化版 MCP 服务器从概念变为可用的解决方案。通过精简的功能范围和聚焦核心价值，我们可以确保快速交付和高质量实现。

**关键成功因素：**
- 聚焦核心功能，避免过度设计
- 保持代码简单性和可维护性
- 确保与现有 API 的良好集成
- 提供清晰的文档和测试覆盖