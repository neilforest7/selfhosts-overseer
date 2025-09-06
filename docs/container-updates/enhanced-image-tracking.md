# 增强的容器镜像状态跟踪系统

## 概述

本文档描述了新实现的容器镜像状态跟踪系统，该系统解决了原有更新检测机制的关键问题：当本地镜像已更新但容器未重启时，系统无法检测到容器实际需要更新的问题。

## 问题背景

### 原有问题

原系统只比较容器的 `repoDigest`（本地镜像摘要）与 `remoteDigest`（远程镜像摘要），存在以下问题：

1. **检测盲区**：当用户手动执行 `docker pull` 更新本地镜像后，`repoDigest` 已经是新的，与 `remoteDigest` 相同
2. **容器状态丢失**：系统无法知道容器仍在运行旧版本的镜像
3. **操作不精确**：无法区分"需要拉取镜像"和"需要重启容器"两种不同的操作需求

### 解决方案

实现三层镜像状态跟踪：
- **容器实际运行的镜像**：容器启动时使用的镜像摘要
- **本地最新镜像**：通过 `docker images` 获取的最新镜像摘要
- **远程最新镜像**：通过 registry API 获取的最新镜像摘要

## 技术实现

### 数据模型扩展

在 `Container` 模型中添加了以下字段：

```prisma
model Container {
  // 容器实际运行的镜像信息
  containerImageDigest    String?   // 容器启动时使用的镜像摘要
  containerImageId        String?   // 容器镜像ID
  containerImageCreated   DateTime? // 容器镜像创建时间
  
  // 本地最新镜像信息
  localImageDigest        String?   // 本地最新镜像摘要
  localImageId            String?   // 本地最新镜像ID
  localImageCreated       DateTime? // 本地最新镜像创建时间
  
  // 更新状态
  imageUpdateStatus       ImageUpdateStatus @default(UNKNOWN)
  
  // 保留向后兼容字段
  repoDigest              String?   // 逐步迁移到 localImageDigest
  updateAvailable         Boolean   @default(false)
}

enum ImageUpdateStatus {
  UNKNOWN           // 未知状态
  UP_TO_DATE        // 完全最新
  CONTAINER_OUTDATED // 容器过时（本地镜像已更新，但容器未重启）
  IMAGE_OUTDATED    // 镜像过时（远程有新版本，但本地未拉取）
  BOTH_OUTDATED     // 都过时（远程有新版本，且容器也未使用最新本地镜像）
}
```

### 核心服务

#### ImageStatusService

新增的 `ImageStatusService` 提供状态分析和显示逻辑：

```typescript
interface ImageStatusResult {
  status: ImageUpdateStatus;
  containerNeedsRestart: boolean;
  imageNeedsPull: boolean;
  containerImageDigest?: string;
  localImageDigest?: string;
  remoteImageDigest?: string;
}
```

#### 三层比较逻辑（修正版）

**关键修正**：容器重启判断使用镜像ID比较，而不是摘要比较

```typescript
// 正确的比较逻辑：使用镜像ID进行容器重启判断
const containerVsLocal = normalizeImageId(containerImageId) !== normalizeImageId(localImageId);

// 镜像拉取判断：使用摘要进行远程比较
const localVsRemote = normalizeDigest(localImageDigest) !== normalizeDigest(remoteImageDigest);

if (!containerVsLocal && !localVsRemote) {
  status = 'UP_TO_DATE';
} else if (containerVsLocal && !localVsRemote) {
  status = 'CONTAINER_OUTDATED';  // 只需重启
} else if (!containerVsLocal && localVsRemote) {
  status = 'IMAGE_OUTDATED';      // 只需拉取
} else {
  status = 'BOTH_OUTDATED';       // 需要拉取+重启
}
```

**为什么使用镜像ID而不是摘要？**
- `containerImageId` 和 `localImageId` 都是镜像的唯一标识符
- 同一个镜像在不同环境下的ID是一致的
- 摘要可能因为来源不同而格式不一致

### 前端显示增强

#### 状态显示

- ✅ `UP_TO_DATE`: 最新（绿色）
- 🔄 `CONTAINER_OUTDATED`: 容器需重启（橙色）
- 📥 `IMAGE_OUTDATED`: 镜像需更新（蓝色）
- 🔄📥 `BOTH_OUTDATED`: 需更新+重启（红色）
- ❓ `UNKNOWN`: 未知（灰色）

#### 操作按钮

根据状态提供精确的操作选项：
- 仅重启容器
- 仅拉取镜像
- 拉取镜像并重启容器

## API 变更

### 容器列表响应

```json
{
  "items": [
    {
      "id": "string",
      "name": "string",
      // 新增字段
      "containerImageDigest": "sha256:abc123...",
      "localImageDigest": "sha256:def456...",
      "imageUpdateStatus": "CONTAINER_OUTDATED",
      // 保留字段
      "updateAvailable": true,
      "repoDigest": "sha256:def456...",
      "remoteDigest": "sha256:ghi789..."
    }
  ]
}
```

### 向后兼容

- 保留 `updateAvailable` 字段，当 `containerNeedsRestart || imageNeedsPull` 时为 `true`
- 保留 `repoDigest` 字段，逐步迁移到 `localImageDigest`

## 数据迁移

### 自动迁移脚本

```bash
# 运行数据迁移
cd apps/server
npx tsx scripts/migrate-container-image-data.ts
```

迁移脚本会：
1. 将现有的 `repoDigest` 复制到 `localImageDigest`
2. 设置所有容器的初始状态为 `UNKNOWN`
3. 提供迁移统计信息

### 手动触发更新

迁移后建议：
1. 运行容器发现以填充 `containerImageDigest` 等字段
2. 运行容器更新检查以更新 `imageUpdateStatus`

## 测试验证

### 完整流程测试

```bash
# 运行完整流程测试
cd apps/server
npx tsx scripts/test-image-status.ts
```

测试覆盖：
- ✅ ImageStatusService 各种状态分析
- ✅ 数据库集成和字段存储
- ✅ API 端点响应格式
- ✅ 更新检测流程

### 测试结果

```
🧪 测试 ImageStatusService...
✅ 所有状态分析逻辑正确

🗄️ 测试数据库集成...
✅ 新字段正确存储和查询

🌐 测试 API 端点...
✅ API 响应包含新字段

🔄 测试更新检测逻辑...
✅ 更新检测流程正常运行
```

## 性能影响

### 数据库

- 新增 6 个字段，对现有查询性能影响最小
- 添加 `imageUpdateStatus` 索引以优化状态过滤查询

### 网络

- 容器发现时增加镜像摘要获取，每个容器增加 1-2 次 Docker 命令调用
- 更新检测逻辑更精确，减少不必要的镜像拉取操作

## 未来改进

1. **缓存优化**：缓存镜像摘要信息，减少重复查询
2. **批量操作**：支持批量更新具有相同状态的容器
3. **历史记录**：记录镜像更新历史，提供回滚能力
4. **通知增强**：根据不同状态发送不同类型的通知

## 总结

新的镜像状态跟踪系统成功解决了原有的检测盲区问题，提供了：

- **精确检测**：能够准确区分容器过时和镜像过时
- **用户友好**：清晰显示需要执行的操作类型
- **性能优化**：避免不必要的镜像拉取或容器重启
- **向后兼容**：保持现有 API 接口不变
- **可扩展性**：为未来的高级功能奠定基础

这个改进大大提升了容器管理的精确性和用户体验。
