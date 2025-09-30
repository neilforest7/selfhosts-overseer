# Selfhost Overseer MCP Server - Docker部署指南

## 概述

这是 Selfhost Overseer 的 MCP (Model Context Protocol) 服务器，为 AI Agents 提供对主机和容器的访问能力。

## 功能特性

### ✅ 已实现功能
- **资源访问**: 主机列表、容器列表、详细信息查询
- **工具操作**: 连通性测试、容器管理（启动/停止/重启）
- **性能优化**: 连接池、性能监控、响应时间优化
- **质量保证**: 代码格式化、质量检查、测试覆盖
- **生产就绪**: 健康检查、监控、日志管理

### 📊 性能指标
- **响应时间**: P95 < 1秒
- **错误率**: < 5%
- **吞吐量**: > 100 请求/秒
- **测试覆盖率**: 64%

## Docker 部署

### 1. 构建Docker镜像

```bash
# 进入MCP Server目录
cd apps/mcp-server

# 使用构建脚本（默认使用代理 http://192.168.31.5:7890）
./build.sh

# 使用自定义代理
./build.sh --proxy http://your-proxy:port

# 或者手动构建
docker build \
  --build-arg HTTP_PROXY=http://192.168.31.5:7890 \
  --build-arg HTTPS_PROXY=http://192.168.31.5:7890 \
  --build-arg NO_PROXY=localhost,127.0.0.1 \
  -t selfhost-mcp-server:latest .
```

### 2. 配置环境变量

MCP Server现在从根目录的 `.env` 文件读取配置。在项目根目录创建或编辑 `.env` 文件：

```env
# MCP Server 配置
MCP_SERVER_NAME=selfhost-overseer
MCP_SERVER_PORT=3002
MCP_LOG_LEVEL=INFO
MCP_API_TIMEOUT=30

# Docker 构建代理配置
HTTP_PROXY=http://192.168.31.5:7890
HTTPS_PROXY=http://192.168.31.5:7890
NO_PROXY=localhost,127.0.0.1
```

### 3. 使用Docker Compose部署

在项目根目录运行：
```bash
# 启动MCP Server
docker-compose --profile mcp up -d

# 查看日志
docker-compose logs -f mcp-server

# 停止服务
docker-compose --profile mcp down
```

### 4. 单独运行Docker容器

```bash
# 运行容器
docker run -d \
  --name mcp-server \
  --network selfhost-network \
  -p 3002:3002 \
  -e API_BASE_URL=http://app:3001 \
  -e MCP_SERVER_NAME=selfhost-overseer \
  -e MCP_SERVER_PORT=3002 \
  selfhost-mcp-server:latest

# 查看日志
docker logs -f mcp-server

# 停止容器
docker stop mcp-server
docker rm mcp-server
```

## 配置说明

### 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `API_BASE_URL` | `http://localhost:3001` | 主应用API地址 |
| `MCP_SERVER_NAME` | `selfhost-overseer` | MCP服务器名称 |
| `MCP_SERVER_PORT` | `3002` | MCP服务器端口 |
| `LOG_LEVEL` | `INFO` | 日志级别 |
| `API_TIMEOUT` | `30` | API请求超时时间（秒） |

### Docker Compose配置

MCP Server已集成到根目录的 `docker-compose.yml` 中：

```yaml
mcp-server:
  image: selfhost-mcp-server:latest
  container_name: selfhost-mcp
  restart: unless-stopped
  
  build:
    context: ./apps/mcp-server
    dockerfile: Dockerfile
  
  ports:
    - "${MCP_SERVER_PORT:-3002}:3002"
  
    environment:
      API_BASE_URL: http://app:3001
      MCP_SERVER_NAME: ${MCP_SERVER_NAME:-selfhost-overseer}
      MCP_SERVER_PORT: ${MCP_SERVER_PORT:-3002}
      LOG_LEVEL: ${MCP_LOG_LEVEL:-INFO}
      API_TIMEOUT: ${MCP_API_TIMEOUT:-30}
  
  depends_on:
    app:
      condition: service_healthy
  
  networks:
    - selfhost-network
  
  profiles:
    - mcp
```

## 监控和维护

### 健康检查

```bash
# 检查容器状态
docker ps | grep mcp-server

# 查看健康检查
docker inspect mcp-server | grep -A 10 Health
```

### 日志查看

```bash
# 查看实时日志
docker logs -f mcp-server

# 查看最近100行日志
docker logs --tail 100 mcp-server
```

### 性能监控

```bash
# 进入容器运行性能测试
docker exec -it mcp-server uv run python performance_test.py

# 运行健康检查
docker exec -it mcp-server uv run python production_monitor.py
```

## API 接口

### Resources (资源)

#### 主机资源
- `hosts://list` - 获取所有主机
- `hosts://detail/{host_id}` - 获取主机详情
- `hosts://by-tag/{tag}` - 按标签筛选主机

#### 容器资源
- `containers://list` - 获取所有容器
- `containers://detail/{container_id}` - 获取容器详情
- `containers://by-host/{host_id}` - 按主机筛选容器

### Tools (工具)

#### 连通性测试
- `test_connectivity` - 测试主机连通性
  - 参数: `host_id` (必需)

#### 容器管理
- `manage_container` - 管理容器状态
  - 参数: `container_id` (必需), `action` (必需: start/stop/restart)

## 故障排除

### 常见问题

1. **容器启动失败**
   ```bash
   # 检查日志
   docker logs mcp-server
   
   # 检查环境变量
   docker exec mcp-server env | grep MCP
   ```

2. **API连接失败**
   ```bash
   # 检查网络连接
   docker exec mcp-server curl $API_BASE_URL/health
   ```

3. **依赖安装失败**
   ```bash
   # 重新构建镜像
   ./build.sh --no-cache
   ```

### 调试模式

```bash
# 以调试模式运行
docker run -it --rm \
  -e LOG_LEVEL=DEBUG \
  -e API_BASE_URL=http://app:3001 \
  selfhost-mcp-server:latest
```

## 开发指南

### 本地开发

```bash
# 安装依赖
uv sync --extra dev

# 运行测试
uv run pytest tests/

# 启动开发服务器
uv run python main.py
```

### 代码质量

```bash
# 代码格式化
uv run black .

# 代码检查
uv run flake8 .

# 测试覆盖率
uv run pytest tests/ --cov=. --cov-report=term-missing
```

## 安全考虑

- 无需认证，直接访问
- 限制容器资源使用
- 非特权用户运行
- 网络隔离
- 日志轮转和限制

## 许可证

本项目采用 MIT 许可证。

## 支持

如有问题，请提交 Issue 或联系开发团队。