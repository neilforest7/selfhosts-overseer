# 容器镜像比较逻辑修正

## 问题描述

在容器镜像状态检测逻辑中发现了一个关键错误：判断"容器是否需要重启"的比较逻辑不正确。

### 错误的逻辑

**原始实现**：
```typescript
// ❌ 错误：比较容器镜像摘要与本地镜像摘要
const containerVsLocal = containerImageDigest !== localImageDigest;
```

**问题**：
- `containerImageDigest` 和 `localImageDigest` 都是摘要格式
- 它们可能来自不同的源，格式可能不一致
- 无法准确判断容器是否真正需要重启

### 正确的逻辑

**修正后的实现**：
```typescript
// ✅ 正确：比较容器镜像ID与本地镜像ID
const containerVsLocal = normalizeImageId(containerImageId) !== normalizeImageId(localImageId);
```

**原因**：
- 镜像ID是镜像的唯一标识符
- 同一个镜像在不同环境下的ID是一致的
- 更可靠地判断容器是否使用了最新的本地镜像

## 修正内容

### 1. 数据模型更新

在 `ImageStatusResult` 接口中添加了镜像ID字段：

```typescript
export interface ImageStatusResult {
  status: ImageUpdateStatus;
  containerNeedsRestart: boolean;
  imageNeedsPull: boolean;
  containerImageDigest?: string;
  containerImageId?: string;        // 新增
  localImageDigest?: string;
  localImageId?: string;            // 新增
  remoteImageDigest?: string;
  error?: string;
}
```

### 2. ImageStatusService 修正

#### 方法签名更新

```typescript
analyzeImageStatus(
  containerImageDigest?: string | null,
  containerImageId?: string | null,     // 新增参数
  localImageDigest?: string | null,
  localImageId?: string | null,         // 新增参数
  remoteImageDigest?: string | null,
  error?: string
): ImageStatusResult
```

#### 比较逻辑修正

```typescript
// 正确的比较逻辑：使用镜像ID进行比较
const containerVsLocal = this.normalizeImageId(containerImageId) !== this.normalizeImageId(localImageId);

// 镜像是否需要拉取：比较本地镜像摘要与远程镜像摘要
const localVsRemote = normalizedRemoteDigest && normalizedLocalDigest && 
  normalizedLocalDigest !== normalizedRemoteDigest;
```

#### 新增镜像ID标准化方法

```typescript
private normalizeImageId(imageId: string): string {
  if (!imageId) return '';
  // 移除 sha256: 前缀，只保留哈希部分
  if (imageId.startsWith('sha256:')) {
    return imageId.substring(7);
  }
  return imageId;
}
```

### 3. ContainerUpdateService 修正

#### 获取镜像ID信息

```typescript
// 获取容器镜像ID
let containerImageId: string | null = null;
try {
  const { code, stdout } = await this.docker.exec(hostCred, ['inspect', '--format', '{{.Image}}', container.containerId], 30);
  if (code === 0) {
    containerImageId = stdout.trim();
  }
} catch (error) {
  // 忽略错误，继续处理
}

// 获取本地镜像ID
let localImageId: string | null = null;
try {
  const { code, stdout } = await this.docker.exec(hostCred, ['inspect', '--format', '{{.Id}}', imageRef], 30);
  if (code === 0) {
    localImageId = stdout.trim();
  }
} catch (error) {
  // 忽略错误，继续处理
}
```

#### 调用修正后的分析方法

```typescript
const statusResult = this.imageStatusService.analyzeImageStatus(
  containerImageDigest,
  containerImageId,    // 新增
  localImageDigest,
  localImageId,        // 新增
  remoteImageDigest
);
```

### 4. 测试用例更新

所有测试用例都已更新以反映正确的比较逻辑：

```typescript
it('should return CONTAINER_OUTDATED when container image ID differs from local image ID', () => {
  const result = service.analyzeImageStatus(
    'sha256:container123', // containerImageDigest
    'sha256:old456',       // containerImageId (old)
    'sha256:local123',     // localImageDigest
    'sha256:new456',       // localImageId (new, different from container)
    'sha256:local123'      // remoteImageDigest (same as local)
  );

  expect(result.status).toBe('CONTAINER_OUTDATED');
  expect(result.containerNeedsRestart).toBe(true);
  expect(result.imageNeedsPull).toBe(false);
});
```

## 验证结果

### 测试输出

修正后的测试显示系统现在能正确检测到容器状态：

```
📋 测试 2: 容器过时（镜像ID不同）
结果: {
  status: 'CONTAINER_OUTDATED',
  containerNeedsRestart: true,
  imageNeedsPull: false,
  containerImageDigest: 'sha256:old123',
  containerImageId: 'sha256:old456',
  localImageDigest: 'sha256:new123',
  localImageId: 'sha256:new456',
  remoteImageDigest: 'sha256:new123'
}
```

### 实际环境验证

在实际环境中，系统现在正确识别了多个 `CONTAINER_OUTDATED` 状态的容器：

```
📊 状态分布:
  BOTH_OUTDATED: 2 个容器
  CONTAINER_OUTDATED: 23 个容器
```

这表明修正后的逻辑能够准确检测到本地镜像已更新但容器未重启的情况。

## 影响和改进

### 正面影响

1. **准确性提升**：现在能正确识别容器是否需要重启
2. **用户体验改善**：提供精确的操作建议（重启 vs 拉取）
3. **资源优化**：避免不必要的镜像拉取操作
4. **可靠性增强**：基于镜像ID的比较更加可靠

### 向后兼容

- 保持了所有现有的API接口
- 新增字段为可选，不影响现有功能
- 保留了 `updateAvailable` 字段的向后兼容性

## 总结

这次修正解决了容器镜像状态检测中的一个关键逻辑错误，确保了系统能够准确判断容器是否需要重启。通过使用镜像ID而不是摘要进行比较，大大提高了检测的准确性和可靠性。

**关键要点**：
- ✅ 容器重启判断：使用 `containerImageId` vs `localImageId`
- ✅ 镜像拉取判断：使用 `localImageDigest` vs `remoteImageDigest`
- ✅ 标准化处理：统一镜像ID和摘要的格式
- ✅ 全面测试：覆盖所有状态场景的测试用例

这个修正对于准确判断容器是否需要重启至关重要，是整个容器管理系统的核心改进。
