## 同源与端口改造指导

本指导文档描述将前端/后端改为同源访问、消除浏览器侧跨端口/混合内容风险的具体操作步骤，以及与 mcp-server 的容器网络访问约定。

### 目标
- 浏览器端所有 REST 请求使用相对路径 `/api/...`（同源）。
- 浏览器端 Socket.IO 使用同源 `wss://<domain>/socket.io`（生产），开发可通过 `DEV_` 覆盖。
- 不在前端硬编码 `http://localhost:3001`、`ws://localhost:3001` 等端口/协议。
- mcp-server 通过容器网络名访问主项目后端（如 `http://app:3001`）。

### 环境与约定
- 前后端默认同容器部署。
- mcp-server 与主项目分容器，但同一 compose 网络。
- 统一使用仓库根目录 `.env`；仅开发时使用 `DEV_` 前缀变量。

### 具体改造项
1) 前端 REST 统一为相对路径
   - `apps/web/src/lib/api-client.ts`：`ApiClient` 默认基址为空（同源）。
   - 支持覆盖：`NEXT_PUBLIC_API_BASE`（生产明确需要时），开发可用 `DEV_NEXT_PUBLIC_API_BASE`。
   - 所有组件里直接 `fetch('http://localhost:3001/...')` 的调用改为 `fetch('/api/...')` 或通过 `apiClient`。

2) 前端 WebSocket 统一为同源
   - 统一使用 `io()` 同源连接，`path: '/socket.io'`，`transports: ['websocket']`。
   - 可选覆盖：`NEXT_PUBLIC_WS_BASE`（生产明确需要时），开发用 `DEV_NEXT_PUBLIC_WS_BASE`。

3) Next.js 重写
   - `apps/web/next.config.js`：将 `/api/:path*` 转发到容器内后端 `http://127.0.0.1:3001/api/:path*`。
   - WebSocket 由外层反向代理处理 `/socket.io` → 后端 3001；Next 不做 WS 转发。

4) Next 路由处理（Server 端转发）
   - `apps/web/app/api/auth/*` 等服务端 Route：通过 `INTERNAL_API_URL` 或默认 `http://127.0.0.1:3001` 转发。

5) Docker/Compose 与环境变量
   - 删除前端构建/运行期不安全的默认 `NEXT_PUBLIC_*`（含 `ws://localhost:3001`）。
   - 开发仅使用根 `.env` 中 `DEV_NEXT_PUBLIC_API_BASE`、`DEV_NEXT_PUBLIC_WS_BASE`。
   - 生产建议不暴露后端 3001 到宿主，仅由反代统一 443；本改造不强制更改端口映射（按环境自行选择）。

6) mcp-server（分容器同网络）
   - `.env` 中配置 `API_BASE_URL=http://<主项目服务名>:3001` 或 `http://127.0.0.1:3001`（如合并同容器）。
   - 可按需提供 `DEV_API_BASE_URL`，仅在开发下生效。

### 验收清单
- 浏览器 Network：REST 走 `https://<domain>/api/...`；无 `http://localhost:3001` 请求。
- 浏览器 Network：WS 走 `wss://<domain>/socket.io/...`；无 `ws://localhost:3001`。
- 无 CORS/Mixed Content 报错。
- mcp-server 可通过容器网络名成功访问后端。


