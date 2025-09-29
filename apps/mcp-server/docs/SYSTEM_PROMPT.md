# Self-Host Serv Agent MCP Server

## 概述
这是一个专门为Self-Host Serv Agent设计的MCP服务器，提供分布式VPS基础设施管理功能。

## 服务器能力
- **资源订阅**: 支持实时资源变更通知
- **列表变更通知**: 当资源列表发生变化时会发送通知
- **工具支持**: 提供容器管理和连接性检查工具

## 可用资源

### 主机资源 (selfhost://hosts/*)
- `selfhost://hosts/overview` - 主机概览仪表板 (Markdown格式)
- `selfhost://hosts/summary` - 主机汇总统计 (JSON格式)
- `selfhost://hosts/{host_id}/details` - 特定主机详情 (Markdown格式)
- `selfhost://hosts/{host_id}/connectivity` - 主机连接历史 (JSON格式)
- `selfhost://hosts/by-status/{status}` - 按状态过滤主机 (Markdown格式)
- `selfhost://hosts/by-tag/{tag}` - 按标签过滤主机 (Markdown格式)

### 容器资源 (selfhost://containers/*)
- `selfhost://containers/overview` - 容器概览仪表板 (Markdown格式)
- `selfhost://containers/summary` - 容器汇总统计 (JSON格式)
- `selfhost://containers/{container_id}/details` - 特定容器详情 (Markdown格式)
- `selfhost://containers/by-host/{host_id}` - 按主机过滤容器 (Markdown格式)
- `selfhost://containers/by-status/{status}` - 按状态过滤容器 (Markdown格式)
- `selfhost://containers/update-status` - 容器更新状态 (JSON格式)

## 输出格式

### Markdown格式
用于概览页面和详情页面，包含：
- 统计信息汇总
- 状态指示器 (🟢 在线, 🔴 离线)
- 结构化的信息展示
- 表格和列表

### JSON格式
用于结构化数据，包含：
- 统计指标
- 过滤后的数据
- 机器可读的格式

### 纯文本格式
用于日志和输出，保持原始格式。

## 错误处理
所有资源都使用标准化的错误处理：
- 资源未找到 (-32002)
- 访问错误 (-32003)
- 验证错误 (-32602)
- 内部错误 (-32603)

## 使用示例

### 获取主机概览
```
资源: selfhost://hosts/overview
返回: Markdown格式的主机概览，包含统计信息和主机列表
```

### 获取容器更新状态
```
资源: selfhost://containers/update-status
返回: JSON格式的更新状态统计
```

### 按状态过滤
```
资源: selfhost://hosts/by-status/ONLINE
返回: 只显示在线主机的Markdown概览
```

## 认证
服务器使用JWT认证与主应用程序通信，自动处理令牌获取和刷新。
