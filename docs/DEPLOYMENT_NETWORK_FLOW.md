# Self-Host Serv Agent 部署网络流向图

## 网络架构概览

基于当前 `docker-compose.yml` 配置，项目部署后的网络流向如下：

## 1. 容器网络拓扑

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Network: selfhost-network         │
│                        (172.25.0.0/16)                     │
└─────────────────────────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       ▼
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│    app      │         │  postgres   │         │    redis    │
│ (3000/3001) │         │   (5432)    │         │   (6379)    │
└─────────────┘         └─────────────┘         └─────────────┘
        │                       │                       │
        └───────────────────────┼───────────────────────┘
                                │
                                ▼
                        ┌─────────────┐
                        │ mcp-server  │
                        │   (3002)    │
                        └─────────────┘
```

## 2. 外部访问端口映射

| 服务 | 容器端口 | 宿主机端口 | 用途 |
|------|----------|------------|------|
| app | 3000 | ${FRONTEND_PORT:-3000} | 前端界面 |
| app | 3001 | ${BACKEND_PORT:-3001} | 后端API |
| postgres | 5432 | ${POSTGRES_PORT:-5432} | 数据库（可选） |
| redis | 6379 | ${REDIS_PORT:-6379} | 缓存（可选） |
| mcp-server | 3002 | ${MCP_SERVER_PORT:-3002} | MCP服务 |

## 3. 请求流向详解

### 3.1 用户访问前端 (生产环境推荐)

```
用户浏览器
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│                    反向代理 (Nginx/Traefik)                  │
│                    - 仅暴露 443 端口                        │
│                    - SSL 终止                               │
│                    - 路径路由                               │
└─────────────────────────────────────────────────────────────┘
    │
    ├─ / → app:3000 (前端)
    ├─ /api/v1/* → app:3000 (Next.js Route Handler 代理到 app:3001)
    └─ /socket.io → app:3000 (Next.js 代理到 app:3001)
```

### 3.2 用户直接访问 (开发环境)

```
用户浏览器
    │
    ├─ http://localhost:3000 → app:3000 (前端)
    ├─ http://localhost:3001 → app:3001 (后端API)
    └─ ws://localhost:3001 → app:3001 (WebSocket)
```

### 3.3 前端到后端的内部通信

```
Next.js 前端 (app:3000)
    │
    ├─ API 请求 → Next.js Route Handler → app:3001 (后端)
    │   ├─ /api/auth/* → /api/v1/auth/*
    │   ├─ /api/v1/* → /api/v1/*
    │   └─ 其他 → /api/v1/*
    │
    └─ WebSocket → app:3001 (后端)
        └─ /socket.io
```

### 3.4 后端服务间通信

```
app (后端)
    │
    ├─ 数据库查询 → postgres:5432
    │   └─ DATABASE_URL: postgresql://user:pass@postgres:5432/db
    │
    ├─ 缓存操作 → redis:6379
    │   └─ REDIS_HOST: redis, REDIS_PORT: 6379
    │
    └─ MCP 调用 → mcp-server:3002
        └─ API_BASE_URL: http://app:3001
```

## 4. 环境变量配置

### 4.1 前端环境变量

```bash
# 生产环境 (推荐同源)
NEXT_PUBLIC_API_BASE=""                    # 空字符串 = 同源请求
NEXT_PUBLIC_WS_BASE=""                     # 空字符串 = 同源 WebSocket

# 开发环境 (可选直连)
DEV_NEXT_PUBLIC_API_BASE="http://localhost:3001"
DEV_NEXT_PUBLIC_WS_BASE="ws://localhost:3001"
```

### 4.2 后端环境变量

```bash
# 内部通信
INTERNAL_API_URL="http://127.0.0.1:3001"   # 容器内部 API URL
DATABASE_URL="postgresql://user:pass@postgres:5432/db"
REDIS_HOST="redis"
REDIS_PORT="6379"
```

### 4.3 MCP 服务环境变量

```bash
API_BASE_URL="http://app:3001"             # 调用主应用 API
MCP_SERVER_PORT="3002"
```

## 5. 安全考虑

### 5.1 生产环境

- **仅暴露 443 端口**：通过反向代理统一入口
- **内部网络隔离**：服务间通过 Docker 网络通信
- **SSL 终止**：在反向代理层处理 HTTPS
- **同源策略**：前端使用相对路径，避免跨域问题

### 5.2 开发环境

- **端口直连**：便于调试和开发
- **CORS 配置**：后端需要配置允许跨域
- **环境变量**：使用 `DEV_` 前缀覆盖生产配置

## 6. 部署建议

### 6.1 生产环境

1. **使用反向代理** (Nginx/Traefik)
2. **配置 SSL 证书**
3. **设置环境变量**：`NEXT_PUBLIC_API_BASE=""` 和 `NEXT_PUBLIC_WS_BASE=""`
4. **关闭数据库和 Redis 外部端口**

### 6.2 开发环境

1. **保留端口映射**：便于直接访问
2. **设置开发环境变量**：`DEV_NEXT_PUBLIC_*`
3. **启用 CORS**：允许跨域请求

## 7. 故障排查

### 7.1 常见问题

- **404 错误**：检查 API 路径是否为 `/api/v1/*`
- **WebSocket 连接失败**：检查路径是否为 `/socket.io`
- **跨域错误**：确保使用同源配置或正确设置 CORS
- **数据库连接失败**：检查 `DATABASE_URL` 中的服务名

### 7.2 网络诊断

```bash
# 检查容器网络
docker network ls
docker network inspect selfhost-network

# 检查容器连接
docker exec -it selfhost-app ping postgres
docker exec -it selfhost-app ping redis
docker exec -it selfhost-app ping mcp-server
```
