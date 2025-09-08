## ComposeProject 引入与激进 Reactivate 改造计划

### 目标
- 启用 `ComposeProject` 表，显式建模每个 Compose 项目（绑定 hostId / project / workingDir / configFiles）。
- `Container` 通过 `composeProjectId` 关联到所属 Compose 项目。
- 以 `composeProjectId` 作为主要分组锚点；`composeGroupKey` 继续保留（兼容），生成优先使用 `project`，缺失时回退到 `hostId::compose::project::folder`。
- 激进 reactivate：up 前快照旧集 → up 后发现写入 → 仅 Running 健康校验（带重试/超时）→ 删除同组未覆盖的旧记录。

### 数据模型变更
- `ComposeProject`：新增 `hostId`，建立唯一键 `@@unique([hostId, project, workingDir])`。
- `Container`：新增可空 `composeProjectId` 外键，`@relation(..., onDelete: SetNull)`。

### 写入路径调整
- 发现/写入（`container-discovery.service.ts`）与 Compose 写入（`container-compose.service.ts`）中：
  1) 解析 labels 提取 `project/workingDir/config_files`
  2) upsert/find `ComposeProject` by `(hostId, project, workingDir)`
  3) 在 `Container.upsert` 的 `create/update` 中写入 `composeProjectId`
  4) `composeGroupKey` 生成保持 `hostId::compose::project`（兼容）；缺失时回退 `hostId::compose::project::folder`

### 激进 Reactivate 核心步骤
- down 前快照旧组容器（按 `composeProjectId` 或回退键）
- up 后触发发现/upsert，写入新容器
- 健康校验：仅 `running` 通过；如存在 healthcheck 则 `healthy` 优先
- 校验通过后批量删除旧记录（限同组、未被新容器覆盖）

### 迁移与回填
- 历史回填：从 `Container` 聚合 `(hostId, composeProject, composeWorkingDir)` 生成 `ComposeProject`，回写 `composeProjectId`
- 对缺失 `composeGroupKey` 的记录，按照回退规则补齐

### 测试与文档
- 覆盖：迁移/回填、发现/写入、reactivate 成功/失败/部分缺失/超时
- 更新 API/文档：数据模型图、分组键与删除策略、幂等性说明

### 默认参数
- 健康重试：10 次；间隔 3s；总 ~30s（可配置）
