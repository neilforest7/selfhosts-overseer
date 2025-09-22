# Self-Host Serv Agent Minimal MCP Server Architecture

## 概述

本文档描述了为 Self-Host Serv Agent 项目设计的简化版 MCP (Model Context Protocol) 服务器架构。该 MCP 服务器将为 AI Agents 提供对项目中主机和容器的基本访问能力，专注于核心功能，易于实现和维护。

## 架构设计

### 系统架构图

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   AI Clients    │    │   Main App     │    │   MCP Server    │
│   (Claude/etc)  │◄──►│   (NestJS)     │◄──►│   (Python)      │
│                 │    │                 │    │                 │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │ MCP Client  │ │    │ │ API Server  │ │    │ │ FastMCP     │ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │  Remote Hosts   │
                       │  (SSH/Docker)   │
                       └─────────────────┘
```

### 核心组件

#### 1. MCP Server Core (Python)
- **框架**: 使用 FastMCP (Python MCP SDK)
- **传输协议**: STDIO (简单传输)
- **配置管理**: 环境变量 (最小配置)
- **日志记录**: 基础日志输出

#### 2. Resources (资源提供者)
提供对项目资源的只读访问：

- **Hosts Resource**: 主机信息和状态
- **Containers Resource**: 容器列表和状态

#### 3. Tools (工具)
提供基本的操作功能：

- **连接性测试工具**: 测试主机连通性
- **容器管理工具**: 启动、停止、重启容器

#### 4. Internal API Client
负责与主应用 API 通信：

- **HTTP 客户端**: 使用 httpx
- **错误处理**: 基本错误处理和重试
- **简单配置**: 最小化配置

## 详细设计

### MCP Server 结构

```
apps/mcp/
├── server/                 # MCP 服务器核心代码
│   ├── __init__.py
│   ├── main.py            # 主入口点
│   ├── config.py          # 配置管理
│   └── client.py          # 内部 API 客户端
├── resources/             # 资源提供者
│   ├── __init__.py
│   ├── hosts.py           # 主机资源
│   └── containers.py       # 容器资源
├── tools/                 # 工具实现
│   ├── __init__.py
│   ├── connectivity.py    # 连通性测试工具
│   └── container_mgmt.py  # 容器管理工具
├── tests/                 # 测试
├── Dockerfile            # 容器构建文件
├── requirements.txt      # Python 依赖
└── pyproject.toml        # 项目配置
```

### Resources 设计

#### 1. Hosts Resource
```python
# 固定资源 URI
hosts://list                    # 所有主机列表
hosts://{hostId}               # 特定主机详情

# 资源模板
hosts://by-tag/{tag}           # 按标签过滤的主机
```

#### 2. Containers Resource
```python
# 固定资源 URI
containers://list                    # 所有容器列表
containers://{containerId}           # 特定容器详情

# 资源模板
containers://by-host/{hostId}         # 特定主机的容器
```

### Tools 设计

#### 1. 连通性测试工具
```python
@mcp.tool()
async def test_host_connectivity(host_id: str) -> str:
    """测试指定主机的连通性

    Args:
        host_id: 主机 ID
    """
    # 调用内部 API 测试连通性
    # 返回测试结果
```

#### 2. 容器管理工具
```python
@mcp.tool()
async def manage_container(
    container_id: str,
    action: str,  # start, stop, restart
    force: bool = False
) -> str:
    """管理容器状态

    Args:
        container_id: 容器 ID
        action: 操作类型
        force: 是否强制执行
    """
```

## 配置管理

### 环境变量配置

```bash
# API 配置
API_BASE_URL=http://localhost:3001
API_TOKEN=your_jwt_token

# 日志配置
LOG_LEVEL=INFO

# MCP 配置
MCP_SERVER_NAME=selfhost-serv-agent
```

### 配置文件 (可选)

```yaml
# config.yaml (可选，简化配置)
api:
  base_url: "${API_BASE_URL}"
  timeout: 30

resources:
  hosts:
    enabled: true
  containers:
    enabled: true

tools:
  connectivity:
    enabled: true
  container_management:
    enabled: true
```

## 部署设计

### Dockerfile

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

### docker-compose.yml 集成

```yaml
# 在主 docker-compose.yml 中添加
services:
  # ... 其他服务

  mcp-server:
    image: ${MCP_IMAGE_NAME:-selfhost-mcp-server}:${MCP_IMAGE_TAG:-latest}
    container_name: ${MCP_CONTAINER_NAME:-selfhost-mcp}
    restart: ${RESTART_POLICY:-unless-stopped}

    environment:
      - API_BASE_URL=http://app:3001
      - API_TOKEN=${MCP_API_TOKEN}
      - LOG_LEVEL=${LOG_LEVEL:-INFO}

    profiles:
      - mcp
```

## 开发计划

### 第一阶段：基础实现 (1 周)
1. **项目初始化**
   - 创建项目结构
   - 配置开发环境
   - 实现 MCP Server 基础框架

2. **Internal API Client**
   - 实现 HTTP 客户端
   - 添加基本认证
   - 实现错误处理

3. **基础 Resources**
   - 实现 Hosts Resource
   - 实现 Containers Resource
   - 基础测试

### 第二阶段：功能完善 (1 周)
1. **核心 Tools**
   - 连通性测试工具
   - 容器管理工具
   - 基本测试

2. **集成测试**
   - 端到端测试
   - 错误处理验证
   - 性能优化

3. **部署准备**
   - 容器化部署
   - 文档完善
   - 最终测试

## 总结

这个简化的 MCP 服务器设计专注于核心功能，为 Self-Host Serv Agent 项目提供了基础的 AI Agent 集成能力。通过标准化的 MCP 协议，AI Agents 可以安全地访问基本项目资源并执行简单的管理操作。

**核心优势：**
- **简单性**: 最小化的复杂度，易于实现和维护
- **快速部署**: 短时间内即可投入生产使用
- **核心功能**: 聚焦最常用的主机和容器管理功能
- **可扩展**: 基础架构支持后续功能扩展
- **轻量级**: 最小依赖和资源消耗