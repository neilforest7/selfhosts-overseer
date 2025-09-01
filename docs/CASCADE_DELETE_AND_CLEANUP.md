# 级联删除与数据清理功能

## 概述

本文档描述了新增的级联删除和数据清理功能，用于维护数据库的一致性和清理孤立记录。

## 功能特性

### 1. 主机级联删除

当删除主机时，系统会自动删除与该主机关联的所有相关记录，确保数据一致性。

#### 删除范围
- **Container**: 删除该主机上的所有容器记录
- **FrpcProxy**: 删除该主机上的所有 FRP 客户端代理配置
- **FrpsConfig**: 删除该主机上的所有 FRP 服务端配置
- **ReverseProxyRoute**: 删除该主机上的所有反向代理路由
- **HostNpmConfig**: 删除该主机的 NPM 配置

#### 实现特点
- 使用数据库事务确保原子性操作
- 详细的日志记录，显示每种类型删除的记录数量
- 错误处理和回滚机制

#### API 端点
```
DELETE /api/v1/hosts/:id
```

### 2. 孤立记录清理

提供清理孤立反向代理路由记录的功能，删除那些引用不存在主机的记录。

#### 清理逻辑
- 查找所有 `hostId` 字段引用的主机在系统中不存在的 `ReverseProxyRoute` 记录
- 批量删除这些孤立记录
- 返回删除的记录数量

#### API 端点

**主机服务清理端点**:
```
POST /api/v1/hosts/cleanup/orphaned-routes
```

**反向代理服务清理端点**:
```
POST /api/v1/reverse-proxy/cleanup/orphaned-routes
```

**同步并清理端点**:
```
POST /api/v1/reverse-proxy/sync-and-cleanup/:hostId
```

## 使用示例

### 删除主机（自动级联删除）

```bash
curl -X DELETE http://localhost:3001/api/v1/hosts/host-id-123
```

响应：
```json
{
  "ok": true
}
```

### 清理孤立的反向代理路由

```bash
curl -X POST http://localhost:3001/api/v1/hosts/cleanup/orphaned-routes
```

响应：
```json
{
  "deletedCount": 5
}
```

### 同步并清理（推荐）

```bash
curl -X POST http://localhost:3001/api/v1/reverse-proxy/sync-and-cleanup/host-id-123
```

响应：
```json
{
  "message": "NPM route sync and cleanup initiated for host host-id-123."
}
```

## 日志示例

### 级联删除日志
```
[HostsService] 开始删除主机: host-id-123
[HostsService] 删除了 3 个容器记录
[HostsService] 删除了 2 个 FrpcProxy 记录
[HostsService] 删除了 1 个 FrpsConfig 记录
[HostsService] 删除了 5 个反向代理路由记录
[HostsService] 删除了 1 个 HostNpmConfig 记录
[HostsService] ✅ 主机删除成功: host-id-123
```

### 清理孤立记录日志
```
[HostsService] 开始清理孤立的反向代理路由记录
[HostsService] 发现 3 个孤立的反向代理路由记录
[HostsService] 删除孤立路由: example1.com (hostId: missing-host-1)
[HostsService] 删除孤立路由: example2.com (hostId: missing-host-2)
[HostsService] 删除孤立路由: example3.com (hostId: missing-host-3)
[HostsService] ✅ 成功清理了 3 个孤立的反向代理路由记录
```

## 最佳实践

### 1. 定期清理
建议定期执行孤立记录清理，可以通过以下方式：
- 手动调用清理 API
- 集成到自动化规则中
- 在同步操作后自动执行

### 2. 监控和告警
- 监控清理操作的执行频率和删除数量
- 如果孤立记录数量异常增长，可能表示系统存在问题

### 3. 备份策略
- 在执行大量删除操作前，建议备份数据库
- 级联删除是不可逆操作，请谨慎使用

## 错误处理

### 常见错误
1. **主机不存在**: 删除不存在的主机会返回错误
2. **数据库连接问题**: 事务会自动回滚
3. **权限问题**: 确保有足够的数据库操作权限

### 错误响应示例
```json
{
  "error": "Host with ID host-id-123 not found",
  "statusCode": 404
}
```

## 性能考虑

### 大量数据处理
- 级联删除使用事务，确保数据一致性
- 对于大量数据，操作可能需要较长时间
- 清理操作使用批量删除，提高效率

### 数据库索引
确保以下字段有适当的索引：
- `Container.hostId`
- `FrpcProxy.hostId`
- `FrpsConfig.hostId`
- `ReverseProxyRoute.hostId`
- `HostNpmConfig.hostId`

## 测试

项目包含完整的单元测试：
- `apps/server/src/hosts/hosts.service.spec.ts`
- `apps/server/src/reverse-proxy/reverse-proxy.service.spec.ts`

运行测试：
```bash
npm test -- hosts.service.spec.ts
npm test -- reverse-proxy.service.spec.ts
```
