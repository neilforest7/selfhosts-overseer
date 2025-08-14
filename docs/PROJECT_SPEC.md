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
- 自动化与智能：
  - n8n：接收告警事件（HTTP/Webhook），回调控制平面执行任务
  - AI Agent：以工具函数方式访问主机/指标/日志与执行命令、发布/回滚
- 网络：控制平面可直连各 VPS 的 SSH(22)；仅暴露 443；Agentless 为默认
- 可选轻量 Agent（Go）：出站长连接至控制平面，提供高并发与弱网稳态（默认不启）

### 四、技术栈清单
- 前端：Next.js 15、TypeScript、Tailwind CSS、shadcn/ui、React Query、React Flow、ECharts
- 后端：NestJS（Fastify）、TypeScript、BullMQ（Redis）、Prisma、PostgreSQL 15+
- 观测：Prometheus、VictoriaMetrics、Loki、Grafana、（可选）cAdvisor
- 自动化：n8n（HTTP/Webhook 双向）、AI Agent（HTTP/函数调用工具）
- 运行与网络：OpenSSH 客户端、rsync/scp、Caddy/Traefik（可选反向代理与证书）

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
   - 版本与可更新性：
     - 公有 registry：可通过 `docker pull <image:tag>` 解析输出判断是否有更新（因暂不支持私有仓库鉴权）
     - 记录本地 `RepoDigests` 与最近检查时间
   - 启动命令与 Compose：
     - CLI 容器：由 `docker inspect` 重建近似 `docker run` 的“用户输入部分”（端口/卷/env/重启策略等）
     - Compose 容器：读取容器标签识别 `project/service/working_dir/config_files`，并通过 `docker compose config` 展示有效配置
   - 操作：
     - 重启容器：CLI 用 `docker restart`；Compose 用 `docker compose restart <service>`
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

### 六、数据模型（核心）
- `Host`：id、name、address、sshUser、port?、tags[]、sshOptions(Json?)、sshAuthMethod('password'|'privateKey')、sshPassword?、sshPrivateKey?、sshPrivateKeyPassphrase?、createdAt、updatedAt
- `TaskRun`：id、status、command、targets[]、stdoutRef?、stderrRef?、startedAt?、finishedAt?、createdAt
- `TaskLog`：id、taskId、ts、stream('stdout'|'stderr')、hostLabel?、content
- `Container`：id、hostId、containerId、name、state?、status?、restartCount?、imageName?、imageTag?、repoDigest?、remoteDigest?、updateAvailable、updateCheckedAt?、createdAt、startedAt?、isComposeManaged、composeProject?、composeService?、composeWorkingDir?、composeGroupKey?、composeFolderName?、composeConfigFiles(Json?)、runCommand?、ports(Json?)、mounts(Json?)、networks(Json?)、labels(Json?)
- `ComposeProject`（可选缓存）：id、project、workingDir、configFiles[]、effectiveConfigHash?、lastSyncedAt?
- `AlertRule`/`AlertEvent`：阈值触发与事件负载（用于发送到 n8n）
- `ReverseProxyRoute`：id、hostId、provider('npm')、type('http'|'stream'|'redirect')、vpsName?、domain、forwardHost?、forwardPort?、enabled、certificateId?、certExpiresAt?、rawAdvancedConfig?、lastSyncedAt?
- `Certificate`：id、provider、cn、sans[]、issuer?、notBefore?、notAfter?、autoRenew、lastSyncedAt?、createdAt
- `HostNpmConfig`：hostId(id)、enabled、dbType('sqlite'|'mysql')、connectionMode('container-local')、containerName?、sqlitePath（默认 `/data/database.sqlite`）、mysqlUseContainerEnv（从容器 `DB_MYSQL_*` 读取）、updatedAt

### 七、API 概览（对前端、n8n、AI Agent）
- Hosts：GET/POST/PATCH/DELETE `/api/v1/hosts`；POST `/api/v1/hosts/:id/test-connection`
- 执行：GET `/api/v1/tasks`；POST `/api/v1/tasks/exec`；GET `/api/v1/tasks/:id`；GET `/api/v1/tasks/:id/logs`；GET `/api/v1/tasks/:id/logs/export`
  - 回显：Socket.IO 事件 `joinTask` 订阅 `task:{taskId}` 接收 `data|stderr|end|error`
- 日志：GET `/api/v1/logs/application|system|docker`
- 容器：GET `/api/v1/containers`（支持 hostId/hostName/q/updateAvailable/composeManaged）；POST `discover|check-updates|:id/update|:id/restart|compose/operate|refresh-status|cleanup-duplicates|purge`
- 反向代理：GET `/api/v1/reverse-proxy/routes?hostId=`；证书：GET `/api/v1/certificates`
- 设置：GET/PUT `/api/v1/settings`；健康：GET `/api/v1/health`

### 八、部署与运行
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

### 九、容量与性能建议（7 天留存）
- 10–30 台 VPS 建议：4 vCPU / 8 GB RAM；磁盘 100–200 GB（VM+Loki+DB 合计）
- 并发：SSH 并发默认 30（可配置 10–100）；命令超时默认 100s（可配置）
- 日志量估算：日 5–20 GB → 7 天 35–140 GB（按需设置 Loki 限速与保留）

### 十、里程碑
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

### 十一、风险与对策
- 日志爆量：Promtail 限流/丢弃低价值标签；Loki 保留/压缩/分区
- SSH 并发抖动：设置全局并发阈值与队列退避
- 单点：VM/Loki/DB 单实例；后续可按需扩展 HA

### 十二、配置项（默认值）
- SSH 并发：30；命令超时：100s；重试：1 次；全局队列并发：50
- 容器发现：每 10 分钟；版本检查：每日 00:45（可配置）
- 指标保留：7 天（VictoriaMetrics）；日志保留：7 天（Loki）
- cAdvisor：默认关闭，可“一键启用”
  注：以上均可在 Web 前端“设置 → 调度与并发”中修改并持久化。

### 十三、非功能与未来规划
- 未来可选：
  - 危险命令防护开关（黑白名单/提示）
  - 私有镜像仓库凭证（GHCR/Harbor）
  - Tracing（Tempo）与更细的拓扑映射
- 明确不做：审计/审批/RBAC/SSO/工单


