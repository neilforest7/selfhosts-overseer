## 项目文档（定版草案）

### 一、项目简介
单用户、自托管的跨 VPS 控制平面，统一监控与管理分布在不同 VPS 上的服务与容器。默认基于 SSH（Agentless）执行远程命令与分发，可选启用轻量 Agent 以获得更强并发与弱网稳定性。观测采用 VictoriaMetrics + Grafana（指标 7 天保留）与 Loki（日志 7 天保留）。深度集成 n8n（事件驱动自动化）与 AI Agent（诊断/执行工具）以实现告警处理与自愈能力。

不包含：工单/事件生命周期、合规审计、RBAC/SSO、人工审批闸。

### 二、目标与范围
- 核心目标：
  - 集中监控（指标/日志）与可视化
  - 批量/并发远程执行、文件分发
  - 容器管理（状态、端口、更新时间、版本可更新性、启动命令/Compose、更新与重启）
  - 告警 → n8n → 回调执行修复脚本；AI Agent 提供诊断与执行工具
- 范围边界：单用户、本地 Token 登录；无需审计/审批/合规；暂不支持私有镜像仓库鉴权

### 三、架构总览
- 控制平面（Server + Web）：
  - 后端：NestJS（REST + WebSocket）、Redis + BullMQ（任务编排）、PostgreSQL（元数据）
  - 前端：Next.js（App Router）+ Tailwind + shadcn/ui；拓扑用 React Flow，图表 ECharts
  - SSH/分发：系统 openssh-client（ssh/scp/rsync），StrictHostKeyChecking，可选 ProxyJump；实时回显通过 Socket.IO 网关（事件 `joinTask` 订阅 `task:{taskId}`）
- 观测栈：
  - 指标：Prometheus 抓取 Node Exporter → remote_write 至 VictoriaMetrics（保留 7 天）
  - 日志：Promtail → Loki（保留 7 天）
  - 可视化：Grafana（预置主机/容器面板）
  - 可选：cAdvisor 一键部署（默认关闭），提供容器级指标
- **自动化中心 (Automation Center)**:
  - **核心理念**: 解耦“触发器 (Triggers)”、“动作 (Actions)”与“通知 (Notifications)”，实现 `M x N x P` 的灵活自动化流程编排。
  - **触发器**: 定义“何时/何种条件下”执行动作。支持 CRON 定时、外部 Webhook 调用、内部系统事件（如 `container.down`）等。
  - **动作**: 定义“做什么事”。采用可插拔的插件式架构，支持远程命令、容器发现、健康检查、调用 Webhook 等多种可扩展的任务类型。
  - **通知**: 定义“完成后如何告知结果”。支持按条件（成功/失败/总是）通过多种渠道（邮件、Slack、Webhook）发送通知。
- 网络：控制平面可直连各 VPS 的 SSH(22)；仅暴露 443；Agentless 为默认
- 可选轻量 Agent（Go）：出站长连接至控制平面，提供高并发与弱网稳态（默认不启）

### 四、技术栈清单（实际实现）
- **前端**：Next.js 15、TypeScript、Tailwind CSS、shadcn/ui、React Query、Cytoscape.js、ECharts、Socket.IO Client
- **后端**：NestJS（Fastify）、TypeScript、BullMQ（Redis）、Prisma、PostgreSQL 15+、Socket.IO、json-rules-engine
- **观测**：Prometheus、VictoriaMetrics、Loki、Grafana、（可选）cAdvisor
- **自动化**：json-rules-engine（规则引擎）、BullMQ（任务调度）、node-cron（定时任务）
- **工具库**：bcrypt（加密）、ssh2（SSH 连接）、ini/yaml（配置解析）、dns2（DNS 解析）、crypto（加密工具）
- **运行与网络**：OpenSSH 客户端、rsync/scp、Docker、Docker Compose

### 五、核心能力说明
1) 资产与拓扑
   - 管理 `Host`（地址、用户、端口、标签、SSH 选项），周期性连通性检查
   - 可视拓扑（主机与服务/容器关系）

2) 远程执行与分发（Agentless 默认）
   - 并发执行命令/脚本，超时与重试，实时输出回显（WebSocket）
   - 文件分发：`rsync -az --partial --inplace`（支持限速与校验）

3) 观测栈
   - 一键安装 Node Exporter、Promtail；Prometheus/Loki 自动注册
   - 指标与日志保留 7 天；Grafana 预置面板
   - 可选 cAdvisor：容器级指标（默认关闭，可一键启用）

4) 告警与自动化
   - Prometheus/Loki 告警 → n8n Webhook；n8n 回调执行 `TaskRun`（无审批）
   - AI Agent 工具：查询资产/指标/日志，执行命令/脚本，发布/回滚

5) 容器管理（重点）
   - 发现与元数据：`docker ps -a` + `docker inspect`，收集状态、端口、挂载、网络、镜像标签/摘要、创建/启动时间、重启计数
   - **镜像状态跟踪（三层检测）**：
     - **容器实际运行镜像**：通过 `docker inspect` 获取容器启动时使用的镜像摘要
     - **本地最新镜像**：通过 `docker images` 获取本地最新镜像摘要
     - **远程最新镜像**：通过 registry API 获取远程最新镜像摘要
     - **状态分类**：
       - `UP_TO_DATE`：容器和镜像都是最新版本
       - `CONTAINER_OUTDATED`：本地镜像已更新，但容器仍使用旧版本（需重启）
       - `IMAGE_OUTDATED`：远程有新版本，但本地未拉取（需拉取）
       - `BOTH_OUTDATED`：远程有新版本，且容器也未使用最新本地镜像（需拉取+重启）
       - `UNKNOWN`：状态未知或检测失败
     - **精确操作**：根据状态提供精确的操作建议（仅重启 vs 仅拉取 vs 拉取+重启）
   - 启动命令与 Compose：
     - CLI 容器：由 `docker inspect` 重建近似 `docker run` 的“用户输入部分”（端口/卷/env/重启策略等）
     - Compose 容器：读取容器标签识别 `project/service/working_dir/config_files`，并通过 `docker compose config` 展示有效配置
   - 操作：
     - 启动/停止容器：
       - CLI：`docker start <name|id>` / `docker stop <name|id>`
       - Compose：`docker compose start <service>` / `docker compose stop <service>`
     - 重启容器：CLI 用 `docker restart`；Compose 用 `docker compose restart <service>` 或 `cd <working_dir> && docker compose down && docker compose up -d`
     - 更新容器（默认先备份旧容器，失败自动回滚）
       - Compose：`docker compose pull <service>` → `docker compose up -d --no-deps <service>`
       - CLI：`docker pull` → `docker stop && docker rename <name> <name>_bk_<ts>` → 以重建参数 `docker run ...` → 健康检查通过后清理备份；失败自动回滚
    - 定时更新检查：默认开启（每日 00:45，可配置）
   - 不支持：按标签批量更新（应你的要求不启用）

6) 反向代理与网络拓扑（Nginx Proxy Manager 驱动）
   - 发现与同步：
     - 通过 SSH 定位 NPM 容器（镜像名含 `jc21/nginx-proxy-manager` 或容器名约定），识别其数据库类型：默认 SQLite（`/data/database.sqlite`），可选 MySQL/MariaDB（通过容器环境变量判断）。
     - SQLite：优先使用容器内 `sqlite3` 以只读方式导出所需表；如不可用则 `docker cp` 快照后由控制平面离线解析。
     - MySQL/MariaDB：在容器网络内执行只读查询（`docker exec`）或通过外部只读账户连接（如已配置）。
   - 采集字段：域名、路由类型（HTTP/Stream/Redirect）、上游 `forward_host/forward_port`、启用状态、证书/到期时间、附加 Nginx 片段（如有）。
   - 关系映射：
     - 通过 `forward_host` 与本机 Docker 网络映射容器（同名服务/容器或容器 IP）；必要时结合 `docker network inspect` 精确匹配到容器实例。
     - 生成“域名/路由 → NPM（VPS）→ 后端容器/端口”的有向边，用于网络拓扑图。
   - 仪表与报表：
     - 路由总览：按域名/状态/证书有效期分组统计；即将到期证书列表。
     - 运行态：基于 Loki 的 NPM 容器日志（或 /data/logs）进行 2xx/4xx/5xx 请求率、P95/P99 延迟（如日志有时延字段）等可视化。
    - 调度：默认每 10 分钟同步一次（可配置）；支持手动触发全量重扫。
    - 面板配置（按 VPS 维度，可在“资产 → VPS 编辑”中设置）：
      - 启用 NPM 读取：开/关（默认关）
      - NPM 类型：`sqlite` 或 `mysql`（默认 `sqlite`）
      - 连接策略：`container-local`（默认，容器内本地连接）
      - 容器名/ID：例如 `nginxproxymanager_app_1`
      - 如果为 SQLite：数据库路径（默认 `/data/database.sqlite`）
      - 如果为 MySQL/MariaDB：使用容器环境变量 `DB_MYSQL_*`（不在控制平面保存凭证）

7) 可选轻量 Agent（后续按需启用）
   - Go 实现；出站 WebSocket/mTLS；并发加速、弱网稳态、断点续传

8) 安全（最小化）
   - 单用户登录（本地口令或静态 API Token）
   - SSH 私钥无口令，控制平面以只读卷挂载并启用 StrictHostKeyChecking；首次指纹需显式导入
   - 仅保留最小操作日志（任务发起/目标/结果），用于排障

### 六、数据模型（实际实现）
- **`Host`**：id、name、address、sshUser、port?、tags[]、sshOptions(Json?)、sshAuthMethod、sshPassword?、sshPrivateKey?、sshPrivateKeyPassphrase?、role(local|remote)、status(ONLINE|OFFLINE|UNKNOWN)、lastOnlineAt?、lastOfflineAt?、lastConnectivityCheck?、createdAt、updatedAt
- **`Container`**：id、hostId、containerId、name、state?、status?、restartCount?、imageName?、imageTag?、
  **镜像跟踪字段**：
  - containerImageDigest?（容器实际运行的镜像摘要）
  - containerImageId?（容器镜像ID）
  - containerImageCreated?（容器镜像创建时间）
  - localImageDigest?（本地最新镜像摘要）
  - localImageId?（本地最新镜像ID）
  - localImageCreated?（本地最新镜像创建时间）
  - repoDigest?（保留向后兼容）
  - remoteDigest?（远程最新镜像摘要）
  - imageUpdateStatus（UNKNOWN|UP_TO_DATE|CONTAINER_OUTDATED|IMAGE_OUTDATED|BOTH_OUTDATED）
  - updateAvailable（保留向后兼容）
  - updateCheckedAt?、
  **其他字段**：createdAt、startedAt?、isComposeManaged、composeProject?、composeService?、composeWorkingDir?、composeGroupKey?、composeFolderName?、composeConfigFiles(Json?)、runCommand?、ports(Json?)、mounts(Json?)、networks(Json?)、labels(Json?)
- **`ComposeProject`**：id、project、workingDir、configFiles[]、effectiveConfigHash?、lastSyncedAt?
- **`AutomationRule`**：id、name、description?、isEnabled、ruleJson(Json)、createdAt、updatedAt、operations[]
- **`OperationLog`**：id、type、status(PENDING|RUNNING|COMPLETED|ERROR)、startedAt?、finishedAt?、automationRuleId?、entries[]
- **`OperationLogEntry`**：id、timestamp、stream、content、operationLogId、hostId?
- **`ReverseProxyRoute`**：id、hostId、provider('npm')、type('http'|'stream'|'redirect')、vpsName?、domain、forwardHost?、forwardPort?、enabled、certificateId?、certExpiresAt?、rawAdvancedConfig?、lastSyncedAt?
- **`Certificate`**：id、provider、cn、sans[]、issuer?、notBefore?、notAfter?、autoRenew、lastSyncedAt?、createdAt
- **`HostNpmConfig`**：hostId、enabled、dbType('sqlite'|'mysql')、connectionMode('container-local')、containerName?、sqlitePath?、mysqlUseContainerEnv?、updatedAt
- **`FrpsConfig`**：id、hostId、containerId、bindPort?、vhostHttpPort?、vhostHttpsPort?、subdomainHost?、rawConfig(Json?)、lastSyncedAt?、proxies[]
- **`FrpcProxy`**：id、hostId、containerId、frpsConfigId、name、type、localIp、localPort、remotePort、subdomain?、customDomains[]、rawConfig(Json?)、lastSyncedAt?
- **`DnsProvider`**：id、name、displayName、isEnabled、apiConfig(Json)、rateLimitPerMinute、timeoutSeconds、createdAt、updatedAt、dnsRecords[]
- **`DnsRecord`**：id、providerId、domain、type、name、value、ttl?、priority?、isEnabled、lastSyncedAt?、createdAt、updatedAt
- **`ActivityLog`**：id、hostId、category、action、details?、metadata(Json?)、timestamp
- **`SystemLog`**：id、category、level、stream、source?、hostId?、hostLabel?、content、metadata(Json?)、ts
- **`AppSetting`**：key、value（存储应用配置的键值对）

### 七、自动化中心 (Automation Center)
为了实现强大的自动化能力，系统对“动作”、“触发器”和“通知”进行了明确的区分，构建了一个灵活的自动化流程编排引擎。

- **动作 (`Action`)**: 代表一个**可执行的任务单元**。它是一个静态的配置实体，描述了“做什么事”（`taskType`）以及执行该任务所需的参数（`taskPayload`）。例如，“一个用于在特定主机上执行 `docker system prune -af` 的动作”。所有动作都由用户通过 UI 进行 CRUD 管理。

- **触发器 (`Trigger`)**: 代表一个**动作的启动条件**。每个动作可以关联多个触发器。支持的类型包括：
  - **`CRON`**: 基于时间的触发器，使用 CRON 表达式定义。
  - **`WEBHOOK`**: 提供一个唯一的 URL，可由外部系统（如 Grafana 告警、GitHub Actions）调用来触发关联的动作。
  - **`EVENT`**: 订阅系统内部发布的事件（如 `container.down`），当事件发生时触发关联的动作。

- **通知 (`Notification`)**: 代表一个**动作完成后的反馈机制**。每个动作可以关联多个通知规则。用户可以配置通知的渠道（如 `EMAIL`, `SLACK`, `WEBHOOK`）和触发条件（`仅成功时`, `仅失败时`, `总是通知`）。

- **操作日志 (`OperationLog`)**: 代表一次**动作的执行记录**。它是一个动态的、一次性的日志实体。每当一个 `Trigger` 触发了一个 `Action`，或用户手动执行一个 `Action` 时，系统都会创建一个 `OperationLog` 来跟踪这次执行的全过程，包括其状态、触发方式、起止时间以及详细的输出日志（`OperationLogEntry`）。

这种设计将“做什么”、“何时做”以及“如何通知”彻底解耦，使得自动化流程的管理和扩展变得清晰、可靠且极其灵活。

### 八、API 概览（完整实现的端点）
- **主机管理**：
  - GET/POST/PATCH/DELETE `/api/v1/hosts`
  - POST `/api/v1/hosts/:id/test-connection`、`/check-connectivity`
  - GET `/api/v1/hosts/:id/connectivity`
  - POST `/api/v1/hosts/check-all-connectivity`、`/cleanup/orphaned-routes`
  - GET `/api/v1/hosts/connectivity/stats`
- **容器管理**：
  - GET `/api/v1/containers`（支持 hostId/hostName/q/updateAvailable/composeManaged）
  - POST `/api/v1/containers/discover`、`/check-updates`、`/check-compose-updates`
  - POST `/api/v1/containers/:id/update`、`/:id/restart`、`/:id/start`、`/:id/stop`、`/:id/check-update`
  - PATCH/DELETE `/api/v1/containers/:id/manual-port`
  - POST `/api/v1/containers/compose/operate`、`/compose/reactivate`
  - GET `/api/v1/containers/compose/down-projects`
  - POST `/api/v1/containers/refresh-status`、`/cleanup-duplicates`、`/purge`、`/test-credentials`
- **自动化规则**：
  - GET/POST/PATCH/DELETE `/api/v1/automations`
  - GET `/api/v1/automations/:id`
  - POST `/api/v1/automations/:id/test`（测试规则）
- **活动日志**：
  - GET `/api/v1/activity-logs`（支持多种过滤参数）
  - GET `/api/v1/activity-logs/recent`、`/stats`、`/cleanup/stats`
  - GET `/api/v1/activity-logs/resource/:resourceType/:resourceId`
  - POST `/api/v1/activity-logs/cleanup`
- **任务与操作日志**：
  - GET `/api/v1/operations`、`/operations/:id`
  - POST `/api/v1/operations`、`/tasks/exec`
- **日志系统**：
  - GET `/api/v1/logs/application`、`/system`、`/docker`
  - WebSocket: `joinLogs` 事件订阅实时日志流
- **DNS 管理**（完整实现）：
  - GET/POST/PUT/DELETE `/api/v1/dns/providers`、`/providers/:id`
  - GET `/api/v1/dns/providers/available`、`/providers/:id/discovery-stats`
  - POST `/api/v1/dns/providers/:id/test`、`/:id/discover`
  - GET/POST/PUT/DELETE `/api/v1/dns/records`、`/records/:id`
  - POST `/api/v1/dns/records/:id/resolve`、`/records/batch-resolve`
  - GET `/api/v1/dns/records/:id/resolutions`、`/resolutions`、`/stats`、`/health`
  - POST `/api/v1/dns/cleanup`
- **网络拓扑与反向代理**：
  - GET `/api/v1/topology/graph-data`
  - GET `/api/v1/reverse-proxy/routes`、`/certificates`
  - POST `/api/v1/reverse-proxy/sync/:hostId`、`/sync-and-cleanup/:hostId`、`/cleanup/orphaned-routes`
- **FRP 管理**：
  - GET `/api/v1/frp/configs`、`/health`、`/metrics`、`/logs`
  - POST `/api/v1/frp/sync/:hostId`、`/resolve-dependencies`、`/heal`
- **DIUN 集成**：
  - POST `/diun/notify`、`/diun/check-image`
- **设置与健康**：
  - GET/PUT `/api/v1/settings`
  - GET `/api/v1/health`
- **WebSocket 事件**：
  - `joinTask` → 订阅任务执行日志
  - `joinLogs` → 订阅系统日志流
  - `joinActivityLog` → 订阅活动日志
  - `joinConnectivity` → 订阅连接状态更新

详细的 API 文档参见 `docs/API_DOCUMENTATION.md`

### 九、部署与运行
- 形态：单机 Docker Compose（默认）
  - 组件：Server/Web、PostgreSQL、Redis、Prometheus、VictoriaMetrics、Loki、Grafana
  - 可选：cAdvisor（按需部署）
- 网络与安全：仅 443 暴露；控制平面直连各 VPS 22 端口；SSH 私钥以只读卷挂载
- 保留策略：VictoriaMetrics `-retentionPeriod=7d`；Loki 7 天；Prometheus 本地保留 24h（可选）
- 首次接入：
  1) 导入主机（地址、用户、端口、标签）并确认主机指纹
  2) 一键安装 Node Exporter、Promtail（可选 cAdvisor）
  3) 验证 Grafana 面板、测试一次远程命令
  4) 如该 VPS 使用 NPM：在“资产 → VPS 编辑”中启用 NPM 读取，选择类型（SQLite/MySQL），填写容器名，保持“容器内本地连接”默认即可

- Grafana 预置与路径：
  - 仪表盘：`infra/observability/grafana/dashboards/*.json`
  - 自动加载：`infra/observability/grafana/provisioning/dashboards/*.yaml`
  - 数据源：`infra/observability/grafana/provisioning/datasources/vm_loki.yml`
  - 预置清单（安装后自动出图）：
    - System Overview（Node Exporter 主机总览）
    - Host Detail（主机明细）
    - Container Overview（cAdvisor 容器总览）
    - Container Detail（cAdvisor 容器明细）
    - Logs Explorer（Loki 日志浏览）
    - NPM Routes Overview（按域名/状态码的请求量与错误率，基于 Loki 日志）

### 十、容量与性能建议（7 天留存）
- 10–30 台 VPS 建议：4 vCPU / 8 GB RAM；磁盘 100–200 GB（VM+Loki+DB 合计）
- 并发：SSH 并发默认 30（可配置 10–100）；命令超时默认 100s（可配置）
- 日志量估算：日 5–20 GB → 7 天 35–140 GB（按需设置 Loki 限速与保留）

### 十一、里程碑
- M0 最小可用
  - 资产录入/连通性、批量命令/脚本、实时输出
  - 安装 Node Exporter/Promtail；Grafana 预置面板；VM/Loki 7 天保留
  - 容器发现与元数据、容器重启、镜像拉取、运行参数与 Compose 有效配置查看
- M1 自动化与更新
  - 告警 → n8n Webhook；n8n 回调执行修复脚本
  - 容器更新（Compose/CLI）；默认“先备份旧容器，失败自动回滚”
  - 定时更新检查（默认每日 1 次，可配置）
- M2 强化
  - 可选轻量 Agent；批量更新稳定性优化
  - cAdvisor 面板预置；容器回滚/固定 digest 的覆盖策略

### 十二、风险与对策
- 日志爆量：Promtail 限流/丢弃低价值标签；Loki 保留/压缩/分区
- SSH 并发抖动：设置全局并发阈值与队列退避
- 单点：VM/Loki/DB 单实例；后续可按需扩展 HA

### 十三、配置项（默认值）
- SSH 并发：30；命令超时：100s；重试：1 次；全局队列并发：50
- 容器发现：每 10 分钟；版本检查：每日 00:45（可配置）
- 指标保留：7 天（VictoriaMetrics）；日志保留：7 天（Loki）
- cAdvisor：默认关闭，可“一键启用”
  注：以上均可在 Web 前端“设置 → 调度与并发”中修改并持久化。

### 十四、网络拓扑图
#### 1. 目标
自动生成一个可视化的网络拓扑图，清晰展示所有受管主机、容器、对外域名以及它们之间的连接关系，特别是 `frp` 穿透和 `Nginx Proxy Manager` (NPM) 的反向代理流量。

#### 2. 技术栈与数据流
- **后端**: `TopologyService` 在 NestJS 框架内运行，使用 Prisma 从 PostgreSQL 数据库获取数据。
- **前端**: 视图由 Next.js 和 React 构建。数据获取采用 `@tanstack/react-query`。
- **可视化**: 核心渲染由 `Cytoscape.js` (通过 `react-cytoscapejs` 封装) 完成，并使用 `cytoscape-dagre` 插件进行自动布局。
- **数据流**: 前端 `TopologySection` 组件调用 `GET /api/v1/topology/graph-data` API。后端 `TopologyService` 从数据库查询 `Host`, `Container`, `ReverseProxyRoute`, `FrpsConfig`, `FrpcProxy` 五个模型，经过复杂的业务逻辑处理后，生成 Cytoscape.js 所需的节点和边数据，并返回给前端进行渲染。

#### 3. 图的构成与核心逻辑
拓扑图由多种类型的**节点 (Nodes)** 和 **边 (Edges)** 构成，以展示物理和逻辑关系。

- **节点 (Nodes)**:
  - **分组节点**:
    -   `地域分组`: 最高层级的容器，用于区分“公网云服务器”和“本地网络”，由主机的 `role` 字段决定。
    -   `主机 (Host)`: 代表一个物理或虚拟主机。
    -   `Compose 项目`: 嵌套在主机节点内，用于将属于同一个 `docker-compose` 项目的容器框在一起。
  - **实体与逻辑节点**:
    -   `域名 (Domain)`: 外部访问的入口点。
    -   `容器 (Container)`: 代表 Docker 容器，并根据镜像名称特殊渲染为 `NPM`, `FRPS`, `FRPC` 等类型。
    -   `逻辑端口 (Remote Port)`: **核心逻辑节点**。它不代表真实容器，而是 `frps` 为 `frpc` 客户端的 `remotePort` 所开放的逻辑入口。

- **边 (Edges) 与核心逻辑**:
  - **路由类型判断**: 系统通过检查 NPM 路由的 `forwardPort` 是否匹配数据库中任何一个 `FrpcProxy` 的 `remotePort`，来**权威地**判断该路由是 **FRP 链路**还是 **Direct Proxy** 链路。
  - **FRP 完整链路**:
    1.  `域名` → `NPM` 容器
    2.  `NPM` 容器 → `逻辑端口` 节点
    3.  `FRPS` 容器 → `逻辑端口` 节点 (关系为 "opens")
    4.  `FRPS` 容器 → `FRPC` 容器 (表示物理隧道，**线的粗细与隧道数量成正比**，动态展示负载)
    5.  `FRPC` 容器 → `最终目标容器` (此连接**严格限制**在 `frpc` 所在的主机内部)
  - **Direct Proxy 链路**:
    1.  `域名` → `NPM` 容器 → `最终目标容器`
    2.  **核心约束**: 此类连接的目标容器**必须**与 `NPM` 容器在同一个主机上，且该主机的 `role` 不能是 `local`。
  - **其他约束**:
    -   指向内部 IP (`192.168.x.x`, `172.16-31.x.x`, `10.x.x.x`) 的路由，其目标容器的搜索范围被严格限制在 NPM 所在的主机。
    -   NPM 指向自身的路由会被自动过滤。

### 十五、FRP 配置发现与同步

#### 1. 目标
自动发现并解析所有主机上的 `frps` 和 `frpc` 容器的配置文件，提取其监听端口和代理规则，并将这些关系存储到数据库中，为网络拓扑图提供数据支持。

#### 2. 实现步骤

1.  **发现 frp 容器**:
    -   在 `ContainersService` 的 `discoverOnHost` 流程中，增加一个步骤来识别 `frps` 和 `frpc` 容器。
    -   **识别方法**: 通过容器镜像名称（如 `snowdreamtech/frps`, `snowdreamtech/frpc`）或容器名称中包含 `frps` / `frpc` 来识别。

2.  **定位并读取配置文件**:
    -   对于已识别的 `frp` 容器，执行 `docker inspect`。
    -   从 `Mounts` 部分解析出配置文件的挂载路径，找到它在主机上的绝对路径（例如，`/etc/frp/frps.ini` -> `/var/lib/docker/volumes/frp_data/_data/frps.ini`）。
    -   使用 SSH `cat` 命令读取主机上的配置文件内容。

3.  **解析配置文件**:
    -   在后端创建一个新的服务（例如 `FrpService`）来处理 `frp` 的逻辑。
    -   实现一个 `.ini` 或 `.toml` 格式的解析器（可以使用现有的 npm 库，如 `ini`）。
    -   **解析 `frps.ini`**: 提取 `[common]` 部分的 `bind_port`, `vhost_http_port`, `vhost_https_port`, `subdomain_host` 等关键信息。
    -   **解析 `frpc.ini`**: 提取 `[common]` 部分的 `server_addr`, `server_port`，并遍历所有代理规则（如 `[web]`, `[ssh]`），提取 `type`, `local_ip`, `local_port`, `remote_port`, `subdomain`, `custom_domains` 等。

4.  **存储与关联**:
    -   将解析出的 `frps` 配置存入 `FrpsConfig` 表。
    -   将 `frpc` 的代理规则存入 `FrpcProxy` 表。
    -   通过 `frpc` 的 `server_addr` 和 `server_port`，将其与对应的 `FrpsConfig` 记录关联起来（设置 `frpsConfigId`）。

5.  **触发机制**:
    -   此同步过程应在每次容器发现 (`discoverOnHost`) 成功后自动触发。
    -   同时，创建一个新的 API 端点 `POST /api/v1/frp/sync/:hostId`，允许用户手动触发对单个主机的 `frp` 配置同步。

### 十六、自动化中心 (Automation Center) - **核心设计**

为了实现强大而灵活的自动化能力，我们摒弃了传统的、分离的“动作”和“触发器”模型，采用了一种更先进、更符合逻辑直觉的**“自动化规则 (Automation Rule)”**模型。其核心技术选型为 **`json-rules-engine`**，一个强大且轻量级的规则引擎。

#### 1. 核心理念

系统的核心是 `AutomationRule`。每一条规则都完整地定义了一个自动化流程，它将**“条件”**和**“事件”**封装在一个单一、原子化的实体中，清晰地回答了两个基本问题：

1.  **“在什么条件下？” (Conditions)**: 一组用逻辑（AND/OR）组合的条件，当满足时触发。
2.  **“做什么事？” (Event)**: 条件满足后，应该执行什么动作。

这种设计使得自动化流程的创建、管理和理解都变得极其简单和直观。

#### 2. 技术实现: `json-rules-engine`

我们将使用 `json-rules-engine` 作为核心的规则评估引擎。

-   **规则定义**: 所有自动化规则都将以 `json-rules-engine` 所要求的特定 JSON 格式存储在数据库中。这种格式天然地表达了“条件”与“事件”的逻辑关系。
-   **后台执行器**: 在 NestJS 的 `automations.processor.ts` 中，一个基于 BullMQ 的周期性任务（例如每分钟执行一次）会：
    1.  从数据库加载所有已启用的 `AutomationRule`。
    2.  从各个服务（`HostsService`, `ContainersService` 等）收集系统当前的实时状态，作为规则引擎的**“事实 (Facts)”**。例如：`{ "cpuUsage": 85, "containerStatus": "stopped" }`。
    3.  将规则和事实送入 `json-rules-engine` 实例进行评估。
    4.  当规则的 `conditions` 被满足时，引擎会返回一个 `event`。
-   **动作分发**: 执行器捕获到 `event` 后，会根据 `event.type` 和 `event.params` 调用相应的服务来执行具体操作（例如，调用 `ContainersService` 重启一个容器）。

#### 3. 数据模型 (`AutomationRule`)

为了与 `json-rules-engine` 无缝集成，`AutomationRule` 模型被设计得非常简洁：

```prisma
model AutomationRule {
  id          String   @id @default(cuid())
  name        String   @unique
  description String?
  isEnabled   Boolean  @default(true)

  // 存储 json-rules-engine 的完整规则定义
  // 包含 "conditions" (条件) 和 "event" (事件) 两部分
  ruleJson    Json

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

-   **`ruleJson`**: 这是模型的关键字段，直接存储了规则的 JSON 对象。一个示例可能如下：
    ```json
    {
      "conditions": {
        "all": [{
          "fact": "containerStatus",
          "operator": "equal",
          "value": "exited",
          "params": { "containerName": "my-app-db" }
        }]
      },
      "event": {
        "type": "restart-container",
        "params": {
          "containerId": "container-abc-123"
        }
      }
    }
    ```

#### 4. 执行与日志

-   **事实提供者 (Fact Providers)**: 后端服务会负责提供动态的、可供规则引擎使用的事实。例如，可以定义一个 `fact` 叫做 `containerStatus`，它接受 `containerName` 作为参数，并能实时查询该容器的状态。
-   **操作日志 (`OperationLog`)**: 每当一条自动化规则被成功触发并执行时，系统都会创建一个 `OperationLog` 记录。这个记录会捕获该次执行的所有细节，包括触发时满足条件的“事实”、执行的事件详情、以及最终的成功或失败状态，为审计和调试提供了完整的追溯能力。

#### 5. API 概览
- **自动化**:
  - `GET /api/v1/automations`: 获取所有自动化规则。
  - `POST /api/v1/automations`: 创建一条新的自动化规则。
  - `PATCH /api/v1/automations/:id`: 更新指定的自动化规则。
  - `DELETE /api/v1/automations/:id`: 删除指定的自动化规则。

#### 6. 前端 UI/UX
- **自动化页面**: 一个专门的页面，用于集中展示和管理所有的 `AutomationRule`。
- **规则构建器**: 一个线性的、从上到下的表单，用于创建和编辑自动化规则。该表单是**上下文感知**的：
  - 用户可以从一个预设的“条件”列表中选择（例如，“CPU 使用率”、“容器状态”）。
  - 根据所选的条件，表单会动态渲染出相应的操作符（大于、等于、包含等）和值输入框。
  - 用户同样可以从一个预设的“动作”列表中选择（例如，“执行命令”、“重启容器”），并填写所需参数。
- 这种设计将完全屏蔽底层 `json-rules-engine` 的 JSON 结构，使用户能够通过直观的点击和输入，轻松地编排复杂的自动化流程。

### 十七、非功能与未来规划
- 未来可选：
  - 危险命令防护开关（黑白名单/提示）
  - 私有镜像仓库凭证（GHCR/Harbor）
  - Tracing（Tempo）与更细的拓扑映射
- 明确不做：审计/审批/RBAC/SSO/工单