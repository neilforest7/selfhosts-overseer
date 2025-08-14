# Self-Host Serv Agent

单用户、自托管的跨 VPS 控制平面：统一监控、容器管理、批量远程执行，集成 n8n 与 AI Agent。默认 SSH（Agentless），可选轻量 Agent；观测采用 VictoriaMetrics + Grafana（指标 7 天）与 Loki（日志 7 天）。不包含工单/审批、合规审计、SSO/RBAC。

## 特性一览
- 资产管理：批量接入 VPS，指纹校验与连通性检查
- 远程执行与分发：并发 SSH 命令/脚本、rsync 文件分发、实时输出
- 容器管理：发现/元数据、启动命令重建、Compose 配置查看、更新/重启（CLI 默认“先备份，失败回滚”）、每日 00:45 更新检查
- 观测：一键安装 Node Exporter、Promtail（可选 cAdvisor），Grafana 预置面板
- NPM 拓扑：读取各 VPS 的 Nginx Proxy Manager（SQLite/MySQL，仅只读），生成“域名 → NPM（VPS）→ 服务容器/端口”的网络拓扑与路由仪表
- 自动化：告警→n8n Webhook→回调执行；AI Agent 工具函数（查询/诊断/执行）

## 最近改进与补充
- 容器识别与更新：基于 Compose 标签识别 `project/service/working_dir/config_files`；CLI 容器可重建接近原始的 `docker run` 参数；更新策略“Compose 优先”，CLI 采用“先备份旧容器，失败自动回滚”；默认每日 00:45 执行更新检查（可配置）；不提供按标签批量更新。
- NPM 路由与拓扑：仅在容器内以只读方式访问 SQLite/MySQL；默认每 10 分钟增量同步；生成“域名 → NPM（VPS）→ 服务容器/端口”的拓扑，并提供证书到期报表；不存储私密凭证。
- 前端规范：采用原生 shadcn/ui（Default 风格），Next.js App Router + React Query + WebSocket；避免引入第三方 UI 套件，图标优先 `lucide-react`。
- 设置与保留：默认并发 30、超时 100s；范围校验（并发 10–100、超时 10–900s）；VictoriaMetrics 与 Loki 保留 7 天；设置变更即时生效（无需重启）。
- 后端与执行：NestJS 分层 + BullMQ 任务队列；SSH 执行器统一封装系统 `ssh/scp/rsync`，启用 StrictHostKeyChecking，实时回显通过 WebSocket 推送。

## 技术栈
- 前端：Next.js 15、TypeScript、Tailwind、shadcn/ui（原生风格）、React Query、React Flow、ECharts
- 后端：NestJS（Fastify）、TypeScript、BullMQ（Redis）、Prisma、PostgreSQL
- 观测：Prometheus、VictoriaMetrics（7d）、Loki（7d）、Grafana、（可选）cAdvisor
- 运行：OpenSSH 客户端、rsync/scp；可选反代 Caddy/Traefik

## 前置条件（Prerequisites）
- 控制平面主机：Linux x86_64（建议 4 vCPU / 8 GB RAM / 100–200 GB 磁盘）
- Docker + Compose 插件
- SSH 私钥（无口令）可直连各 VPS 的 22 端口
- 可选：n8n Webhook/Token、AI Agent API、NPM 容器

## 快速开始（Compose）
1) 准备 `.env` 与 SSH 私钥（权限 0600，容器内以只读卷挂载）
2) 启动：`docker compose up -d`
3) 登录控制台（443） → 设置默认项：
   - SSH 并发：30（10–100）
   - 命令超时：100s（10–900s）
   - 容器版本检查：每日 00:45

## 核心配置（前端可改）
- 设置 → 调度与并发：并发/超时/版本检查时点
- VPS → 编辑（可选 NPM）：启用 NPM 读取；类型 sqlite/mysql；连接策略 container-local；容器名；SQLite 路径或 MySQL 环境变量（`DB_MYSQL_*`）

## 典型用法
- 容器管理：检查更新、更新/重启；查看 `docker run` 重建命令与 Compose 有效配置
- 远程执行：并发命令/脚本、rsync 分发、实时输出
- 观测：Grafana 主机/容器（cAdvisor）/日志（Loki）与 NPM 路由概览
- 拓扑：网络视图展示“域名→NPM→服务容器/端口”的依赖关系

## Grafana 预置
- Dashboards：`infra/observability/grafana/dashboards/*.json`
- Provisioning：`infra/observability/grafana/provisioning/dashboards/*.yaml`
- Datasources：`infra/observability/grafana/provisioning/datasources/vm_loki.yml`
- 预置：System Overview、Host Detail、Container Overview/Detail（cAdvisor）、Logs Explorer、NPM Routes Overview

## API 概览
- Hosts：GET `/api/v1/hosts`
- 执行：POST `/api/v1/tasks/exec`；WS `/api/v1/tasks/{taskRunId}/stream`；GET `/api/v1/tasks/{taskRunId}`
- 观测：GET `/api/v1/metrics/query?vmQuery=...&range=...`；GET `/api/v1/logs/search?query=...&start=...&end=...`
- 容器：GET `/api/v1/containers?hostId=&q=&isCompose=&updateAvailable=`；GET `/api/v1/containers/{id}`；GET `/api/v1/containers/{id}/run-command`；GET `/api/v1/containers/{id}/compose-config`；POST `/api/v1/containers/{id}/restart|check-update|update`
- 反向代理与拓扑：GET `/api/v1/proxies/routes?hostId=&domain=&type=`；POST `/api/v1/proxies/sync?hostId=`；GET `/api/v1/topology/network`
- Compose：GET `/api/v1/compose/projects?hostId=`；GET `/api/v1/compose/projects/{project}/services`；POST `/api/v1/compose/projects/{project}/services/{service}/update`
- 更多细节见 `docs/PROJECT_SPEC.md` 与 `.cursor/rules/api-overview.mdc`

## 路线图
- M0：资产/连通性、并发执行、采集器安装、Grafana 预置、容器发现/重启/镜像拉取、运行参数/Compose 查看
- M1：告警→n8n 回调执行；容器更新（Compose/CLI，默认备份+失败回滚）；定时更新检查
- M2：可选轻量 Agent、批量更新稳定性优化；cAdvisor 面板；容器回滚/固定 digest 策略

## 目录与文档
- 目录：`apps/web`、`apps/server`、`packages/shared`、`infra/observability`、`docs`、`.cursor/rules`
- 详细说明：`docs/PROJECT_SPEC.md`
- 规则：`.cursor/rules/*`（含 shadcn/ui 原生风格与脚手架约定）
