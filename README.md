# Selfhost Overseer

单用户、自托管的跨 VPS 控制平面：统一监控、容器管理、批量远程执行，集成 n8n 与 AI Agent。默认 SSH（Agentless），可选轻量 Agent；观测采用 VictoriaMetrics + Grafana（指标 7 天）与 Loki（日志 7 天）。不包含工单/审批、合规审计、SSO/RBAC。

## 特性一览
- 资产管理：批量接入 VPS，指纹校验与连通性检查
- 远程执行与分发：并发 SSH 命令/脚本、rsync 文件分发、实时输出
- 容器管理：发现/元数据、启动命令重建、Compose 配置查看、更新/重启（CLI 默认“先备份，失败回滚”）、每日 00:45 更新检查
- 观测：一键安装 Node Exporter、Promtail（可选 cAdvisor），Grafana 预置面板
- NPM 拓扑：读取各 VPS 的 Nginx Proxy Manager 数据，自动生成“域名 → NPM → 服务”的动态网络拓扑图，并能精确展示 FRP 穿透的完整链路，动态显示隧道密度。
- FRP 管理：两阶段同步系统确保 FRP 拓扑生成不受主机发现顺序影响；自动解析 FRPS/FRPC 配置、建立依赖关系、提供健康检查与自愈能力。
- 自动化：告警→n8n Webhook→回调执行；AI Agent 工具函数（查询/诊断/执行）

## 最近改进与补充
- 容器识别与更新：基于 Compose 标签识别 `project/service/working_dir/config_files`；CLI 容器可重建接近原始的 `docker run` 参数；更新策略“Compose 优先”，CLI 采用“先备份旧容器，失败自动回滚”；默认每日 00:45 执行更新检查（可配置）；不提供按标签批量更新。
- NPM 路由与拓扑：仅在容器内以只读方式访问 SQLite/MySQL；默认每 10 分钟增量同步；生成“域名 → NPM（VPS）→ 服务容器/逻辑端口”的拓扑，并提供证书到期报表；不存储私密凭证。
- 前端规范：采用原生 shadcn/ui（Default 风格），Next.js App Router + React Query + WebSocket；避免引入第三方 UI 套件，图标优先 `lucide-react`。
- 设置与保留：默认并发 30、超时 100s；范围校验（并发 10–100、超时 10–900s）；VictoriaMetrics 与 Loki 保留 7 天；设置变更即时生效（无需重启）。
- 后端与执行：NestJS 分层 + BullMQ 任务队列；SSH 执行器统一封装系统 `ssh/scp/rsync`，启用 StrictHostKeyChecking，实时回显通过 WebSocket 推送。

## 技术栈
- 前端：Next.js 15、TypeScript、Tailwind、shadcn/ui（原生风格）、React Query、Cytoscape.js、ECharts
- 后端：NestJS（Fastify）、TypeScript、BullMQ（Redis）、Prisma、PostgreSQL
- 观测：Prometheus、VictoriaMetrics（7d）、Loki（7d）、Grafana、（可选）cAdvisor
- 运行：OpenSSH 客户端、rsync/scp；可选反代 Caddy/Traefik

## 前置条件（Prerequisites）
- **控制平面主机**：Linux x86_64（建议 4 vCPU / 8 GB RAM / 100–200 GB 磁盘）
- **运行环境**：Node.js >= 22.0.0、Docker + Compose 插件
- **网络访问**：SSH 私钥可直连
- **可选组件**：NPM 容器、FRP 服务、DNS 提供商 API

## 快速开始

### 开发环境
```bash
# 1. 克隆项目
git clone <repository-url>
cd selfhost-overseer

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp apps/server/.env.example apps/server/.env
# 编辑 .env 文件，配置数据库连接等

# 4. 启动开发服务器
npm run dev
```

### Docker 快速部署

#### 使用预构建镜像（推荐）

从 Docker Hub 拉取最新版本并一键启动：

```bash
# 1. 拉取最新镜像
docker pull neilforest/selfhost-overseer:latest
# 拉取 MCP 服务器镜像（可选）
docker pull neilforest/selfhost-overseer-mcp-server:latest

# 2. 创建工作目录
mkdir -p ~/selfhost-overseer && cd ~/selfhost-overseer

# 3. 下载配置文件
curl -o .env https://raw.githubusercontent.com/neilforest7/selfhosts-overseer/main/.env.example
curl -o docker-compose.yml https://raw.githubusercontent.com/neilforest7/selfhosts-overseer/main/docker-compose.yml

# 4. 配置环境变量
cp .env.example .env
# 编辑 .env 文件，配置数据库连接、认证信息等

# 5. 准备 SSH 私钥（权限 0600）
chmod 600 /path/to/ssh/private/key
# 在 docker-compose.yml 中将私钥以只读卷挂载到 /ssh/id_rsa

# 6. 启动服务
docker compose up -d

# 7. 配置反向代理（生产建议统一暴露 443，并保持同源访问）

# 8. 验证访问
# 前端：https://<your-domain>/
# 后端 API（同源相对路径）：/api/v1/
# WebSocket（同源）：/socket.io
```

#### 指定版本部署

```bash
# 拉取指定版本
docker pull neilforest/selfhost-overseer:v0.1.0

# 拉取 MCP 服务器镜像（可选）
docker pull neilforest/selfhost-overseer-mcp-server:v0.1.0

# 在 docker-compose.yml 中修改镜像版本：
# image: neilforest/selfhost-overseer:v0.1.0
# mcp-server 镜像版本：
# MCP_IMAGE_NAME=neilforest/selfhost-overseer-mcp-server
# MCP_IMAGE_TAG=v0.1.0
```

#### 生产部署（Docker Compose - 源码构建）
```bash
# 1. 克隆项目
git clone <repository-url>
cd selfhost-overseer

# 2. 准备环境文件
cp .env.example .env
# 必填：DATABASE_URL=postgresql://user:pass@postgres:5432/app?schema=public
# 可选：REDIS_HOST=redis REDIS_PORT=6379

# 3. 准备 SSH 私钥
chmod 600 /path/to/ssh/private/key
# 在 docker-compose.yml 中将私钥以只读卷挂载到 /ssh/id_rsa

# 4. 构建镜像（可选，使用预构建镜像时可跳过）
./docker-build.sh local

# 5. 启动服务
docker compose up -d

# 6. 配置反向代理

# 7. 验证访问
```

#### 端口与同源建议
- 默认建议通过外部反代统一暴露 443，避免浏览器混合内容与 CORS 问题。
- 前端请求应使用相对路径 `/api/...`，WebSocket 统一 `/socket.io`，详见 `docs/PORTS_AND_ORIGIN_GUIDE.md`。
- Compose 中不必对外暴露 3001，交由反代层转发（按需调整）。

### 初始配置
访问前端界面后，进行以下配置：
1. **设置代理**: 设置代理服务器地址端口以正常访问镜像仓库（可选）
2. **添加主机**：配置 VPS 连接信息
3. **同步容器**：在容器页面点击“发现容器”按钮
4. **可选 NPM 配置**：在主机编辑页面启用 NPM 读取

## 核心配置（前端可改）
- 设置 → 调度与并发：并发/超时/版本检查时点
- 设置 → dockerhub credentials: 设置 dockerhub 凭证（可选）
- 设置 → ghcr credentials: 设置 ghcr 凭证（可选）

## 典型用法
- 容器管理：检查更新、更新/重启；查看 `docker run` 重建命令与 Compose 有效配置
- 远程执行：并发命令/脚本、rsync 分发、实时输出
- 拓扑：通过动态网络视图，洞察“域名→NPM→FRP→服务”的完整流量链路与依赖关系。
- FRP 同步：支持任意主机发现顺序，自动解析配置依赖，提供健康监控与故障自愈。
- Nginx Proxy Manager 路由同步：支持任意主机发现顺序，自动解析配置依赖，提供健康监控与故障自愈。

## 开发指南

### 项目结构
```
selfhost-overseer/
├── apps/
│   ├── web/                 # Next.js 前端应用
│   └── server/              # NestJS 后端应用
├── packages/
│   └── shared/              # 共享类型和工具
├── infra/
│   └── observability/       # 监控配置（Grafana、Prometheus 等）
├── docs/                    # 项目文档
└── .cursor/rules/           # 开发规范和约定
```

### 开发工作流
```bash
# 启动开发环境
npm run dev                  # 同时启动前后端
npm run dev:web             # 仅启动前端 (端口 3000)
npm run dev:server          # 仅启动后端 (端口 3001)

# 数据库操作
npm run db:generate         # 生成 Prisma 客户端
npm run db:push            # 推送 schema 到数据库
npm run db:migrate         # 创建迁移

# 代码检查
npm run lint               # ESLint 检查所有包
npm run type-check         # TypeScript 类型检查所有包

# 构建
npm run build              # 构建所有应用 (shared → server → web)
npm run build:web          # 仅构建前端
npm run build:server       # 仅构建后端

# 测试
npm --workspace apps/server run test              # 运行后端测试
npm --workspace apps/server run test:coverage     # 运行测试并生成覆盖率报告
```

### API 概览
- **主机管理**：`GET/POST/PATCH/DELETE /api/v1/hosts`
- **容器管理**：`GET /api/v1/containers`、`POST /api/v1/containers/discover`
- **任务执行**：`POST /api/v1/tasks/exec`
- **自动化规则**：`GET/POST/PATCH/DELETE /api/v1/automations`
- **操作日志**：`GET /api/v1/operations`
- **网络拓扑**：`GET /api/v1/topology/graph-data`
- **设置管理**：`GET/PUT /api/v1/settings`

详细 API 文档见 `docs/API_DOCUMENTATION.md`



## 故障排除

### 常见问题

**1. SSH 连接失败**
```bash
# 检查 SSH 私钥权限
chmod 600 /path/to/private/key

# 测试 SSH 连接
ssh -i /path/to/private/key user@host

# 检查 SSH 配置
cat ~/.ssh/config
```

**2. 容器发现失败**
- 确保目标主机 Docker 服务正常运行
- 检查 SSH 用户是否有 Docker 权限
- 验证网络连接和防火墙设置

**3. WebSocket 连接问题**
- 检查浏览器控制台错误
- 确认后端服务正常运行
- 验证端口 3001 是否可访问

**4. 数据库连接错误**
```bash
# 检查数据库状态
docker compose ps postgres

# 查看数据库日志
docker compose logs postgres

# 重置数据库
npm run db:push
```

### 日志查看
```bash
# 应用日志
docker compose logs web
docker compose logs server

# 系统日志
journalctl -u docker
```

## 文档索引

### 核心文档
- [项目规范](docs/PROJECT_SPEC.md) - 完整的项目规范和架构说明
- [API 文档](docs/API_DOCUMENTATION.md) - 详细的 API 接口文档
- [开发规范](.cursor/rules/) - 代码规范和开发约定

### 功能文档
- [活动日志系统](docs/activity-log-system.md) - 系统活动记录
- [DNS API 文档](docs/DNS_API.md) - DNS 管理接口
- [级联删除与清理](docs/CASCADE_DELETE_AND_CLEANUP.md) - 数据清理策略

### 部署与运维
- [Grafana 配置](infra/observability/grafana/) - 监控面板配置
- [Docker 配置](infra/dev/docker-compose.yml) - 容器编排配置

## 贡献指南

1. **Fork 项目**并创建功能分支
2. **遵循代码规范**（见 `.cursor/rules/`）
3. **编写测试**并确保通过
4. **提交 Pull Request**

### 代码规范
- 使用 TypeScript 严格模式
- 遵循 ESLint 和 Prettier 配置
- 组件使用 shadcn/ui 原生风格
- API 遵循 RESTful 设计原则

## 许可证

[MIT License](LICENSE)
