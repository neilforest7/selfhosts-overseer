# GHCR (GitHub Container Registry) 认证配置指南

## 概述

本系统现在支持 GitHub Container Registry (GHCR) 的认证，允许您访问私有的 GHCR 镜像仓库。

## 功能特性

- ✅ 支持 GitHub Personal Access Token (PAT) 认证
- ✅ 加密存储敏感凭证
- ✅ 连接测试和权限验证
- ✅ 与现有 Docker Hub 认证系统兼容
- ✅ 支持公开和私有 GHCR 仓库

## 配置步骤

### 1. 创建 GitHub Personal Access Token

1. 登录到 GitHub
2. 进入 **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)**
3. 点击 **Generate new token** → **Generate new token (classic)**
4. 设置 Token 名称，例如：`SelfHost-Serv-Agent-GHCR`
5. 选择过期时间（建议选择较长时间或无过期）
6. **重要**：勾选以下权限：
   - ✅ `read:packages` - 读取包权限（必需）
   - ✅ `repo` - 如果需要访问私有仓库的包（可选）
7. 点击 **Generate token**
8. **重要**：复制生成的 token，这是唯一一次显示

### 2. 在系统中配置 GHCR 凭证

1. 打开系统设置页面
2. 找到 **"GHCR 凭证设置"** 部分
3. 勾选 **"启用 GitHub Container Registry (GHCR) 凭证"**
4. 填写以下信息：
   - **GitHub 用户名**：您的 GitHub 用户名
   - **GitHub Personal Access Token**：刚才创建的 PAT
5. 点击 **"测试 GHCR 连接"** 验证配置
6. 点击 **"保存设置"** 保存配置

### 3. 验证配置

配置完成后，系统将能够：
- 访问您的私有 GHCR 镜像
- 检查镜像更新
- 执行容器管理操作

## API 端点

### 获取 GHCR 凭证状态
```bash
GET /api/v1/settings/ghcr-credentials
```

响应：
```json
{
  "enabled": true,
  "username": "yourusername",
  "hasToken": true
}
```

### 设置 GHCR 凭证
```bash
PUT /api/v1/settings/ghcr-credentials
Content-Type: application/json

{
  "enabled": true,
  "username": "yourusername",
  "personalAccessToken": "ghp_xxxxxxxxxxxx"
}
```

### 测试 GHCR 连接
```bash
POST /api/v1/settings/test-ghcr-connectivity
Content-Type: application/json

{
  "username": "yourusername",
  "personalAccessToken": "ghp_xxxxxxxxxxxx"
}
```

## 安全性

- ✅ Personal Access Token 使用 AES-256 加密存储
- ✅ Token 不会在日志中显示
- ✅ 连接测试不会暴露敏感信息
- ✅ 支持权限验证和错误提示

## 故障排除

### 常见错误

1. **"GHCR 认证失败：用户名或 Personal Access Token 无效"**
   - 检查用户名是否正确
   - 确认 PAT 是否有效且未过期
   - 重新生成 PAT 并更新配置

2. **"Personal Access Token 权限不足，请确保包含 read:packages 权限"**
   - 检查 PAT 是否包含 `read:packages` 权限
   - 如需访问私有仓库，可能还需要 `repo` 权限

3. **"连接 GHCR 超时"**
   - 检查网络连接
   - 确认代理设置（如果使用代理）

### 测试镜像

您可以使用以下镜像测试 GHCR 功能：

**公开镜像**（无需认证）：
```bash
ghcr.io/dingyufei615/ai-goofish:latest
```

**私有镜像**（需要认证）：
```bash
ghcr.io/yourusername/your-private-repo:latest
```

## 兼容性

- ✅ 与现有 Docker Hub 认证完全兼容
- ✅ 支持同时使用 Docker Hub 和 GHCR 认证
- ✅ 不影响其他容器仓库的访问

## 支持的镜像格式

- ✅ OCI 镜像格式
- ✅ Docker 镜像格式
- ✅ 多架构镜像
- ✅ 镜像索引和清单列表
