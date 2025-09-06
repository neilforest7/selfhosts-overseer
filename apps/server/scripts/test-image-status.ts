#!/usr/bin/env tsx

/**
 * 完整流程测试脚本：测试新的容器镜像状态跟踪功能
 * 
 * 此脚本将：
 * 1. 测试 ImageStatusService 的各种状态分析
 * 2. 模拟容器发现流程
 * 3. 测试更新检测逻辑
 * 4. 验证前端 API 响应
 */

import { PrismaClient, ImageUpdateStatus } from '@prisma/client';
import { ImageStatusService } from '../src/containers/image-status.service';

const prisma = new PrismaClient();

async function testImageStatusService() {
  console.log('🧪 测试 ImageStatusService...');
  
  const service = new ImageStatusService();

  // 测试 1: 所有镜像都是最新的（使用正确的镜像ID比较）
  console.log('\n📋 测试 1: 所有镜像都是最新');
  const result1 = service.analyzeImageStatus(
    'sha256:abc123',  // containerImageDigest
    'sha256:def456',  // containerImageId
    'sha256:abc123',  // localImageDigest
    'sha256:def456',  // localImageId (相同)
    'sha256:abc123'   // remoteImageDigest
  );
  console.log('结果:', result1);
  console.log('显示:', service.getStatusDisplay(result1.status));

  // 测试 2: 容器过时（本地镜像已更新，但容器未重启）
  console.log('\n📋 测试 2: 容器过时（镜像ID不同）');
  const result2 = service.analyzeImageStatus(
    'sha256:old123',  // containerImageDigest
    'sha256:old456',  // containerImageId (旧的)
    'sha256:new123',  // localImageDigest
    'sha256:new456',  // localImageId (新的，与容器不同)
    'sha256:new123'   // remoteImageDigest (与本地相同)
  );
  console.log('结果:', result2);
  console.log('显示:', service.getStatusDisplay(result2.status));

  // 测试 3: 镜像过时（远程有新版本）
  console.log('\n📋 测试 3: 镜像过时');
  const result3 = service.analyzeImageStatus(
    'sha256:same123',  // containerImageDigest
    'sha256:same456',  // containerImageId
    'sha256:same123',  // localImageDigest
    'sha256:same456',  // localImageId (与容器相同)
    'sha256:remote789' // remoteImageDigest (远程有新版本)
  );
  console.log('结果:', result3);
  console.log('显示:', service.getStatusDisplay(result3.status));

  // 测试 4: 都过时
  console.log('\n📋 测试 4: 都过时');
  const result4 = service.analyzeImageStatus(
    'sha256:container123', // containerImageDigest
    'sha256:container456', // containerImageId (旧的)
    'sha256:local123',     // localImageDigest
    'sha256:local456',     // localImageId (与容器不同)
    'sha256:remote789'     // remoteImageDigest (远程有新版本)
  );
  console.log('结果:', result4);
  console.log('显示:', service.getStatusDisplay(result4.status));

  // 测试 5: 统计功能
  console.log('\n📋 测试 5: 状态统计');
  const statuses = [
    'UP_TO_DATE' as const,
    'CONTAINER_OUTDATED' as const,
    'IMAGE_OUTDATED' as const,
    'BOTH_OUTDATED' as const,
    'UNKNOWN' as const,
  ];
  const stats = service.getStatusStats(statuses);
  console.log('统计:', stats);

  console.log('✅ ImageStatusService 测试完成');
}

async function testDatabaseIntegration() {
  console.log('\n🗄️ 测试数据库集成...');

  try {
    // 查询现有容器
    const containers = await prisma.container.findMany({
      take: 5,
      select: {
        id: true,
        name: true,
        imageName: true,
        imageTag: true,
        containerImageDigest: true,
        localImageDigest: true,
        remoteDigest: true,
        imageUpdateStatus: true,
        updateAvailable: true,
      },
    });

    console.log(`📦 找到 ${containers.length} 个容器`);

    containers.forEach((container, index) => {
      console.log(`\n容器 ${index + 1}: ${container.name}`);
      console.log(`  镜像: ${container.imageName}:${container.imageTag}`);
      console.log(`  容器镜像摘要: ${container.containerImageDigest || '未知'}`);
      console.log(`  本地镜像摘要: ${container.localImageDigest || '未知'}`);
      console.log(`  远程镜像摘要: ${container.remoteDigest || '未知'}`);
      console.log(`  更新状态: ${container.imageUpdateStatus}`);
      console.log(`  需要更新: ${container.updateAvailable ? '是' : '否'}`);
    });

    // 测试状态统计
    const statusCounts = await prisma.container.groupBy({
      by: ['imageUpdateStatus'],
      _count: true,
    });

    console.log('\n📊 状态分布:');
    statusCounts.forEach(stat => {
      console.log(`  ${stat.imageUpdateStatus}: ${stat._count} 个容器`);
    });

    console.log('✅ 数据库集成测试完成');
  } catch (error) {
    console.error('❌ 数据库测试失败:', error);
  }
}

async function testApiEndpoints() {
  console.log('\n🌐 测试 API 端点...');

  try {
    // 测试容器列表 API
    const response = await fetch('http://localhost:3001/api/v1/containers');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const containers = await response.json();
    console.log(`📡 API 返回 ${containers.length} 个容器`);

    // 检查新字段是否存在
    const sampleContainer = containers[0];
    if (sampleContainer) {
      console.log('\n🔍 检查 API 响应字段:');
      console.log(`  containerImageDigest: ${sampleContainer.containerImageDigest !== undefined ? '✅' : '❌'}`);
      console.log(`  localImageDigest: ${sampleContainer.localImageDigest !== undefined ? '✅' : '❌'}`);
      console.log(`  imageUpdateStatus: ${sampleContainer.imageUpdateStatus !== undefined ? '✅' : '❌'}`);
      console.log(`  updateAvailable: ${sampleContainer.updateAvailable !== undefined ? '✅' : '❌'}`);
    }

    console.log('✅ API 端点测试完成');
  } catch (error) {
    console.error('❌ API 测试失败:', error);
  }
}

async function testUpdateDetection() {
  console.log('\n🔄 测试更新检测逻辑...');

  try {
    // 查找一个容器进行测试
    const container = await prisma.container.findFirst({
      where: {
        imageName: { not: null },
        imageTag: { not: null },
      },
    });

    if (!container) {
      console.log('⚠️ 没有找到可测试的容器');
      return;
    }

    console.log(`🎯 测试容器: ${container.name}`);

    // 模拟更新检测 API 调用
    const response = await fetch(`http://localhost:3001/api/v1/containers/${container.id}/check-update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ opId: 'test-' + Date.now() }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    console.log('🔍 更新检测结果:', result);

    // 检查更新后的容器状态
    const updatedContainer = await prisma.container.findUnique({
      where: { id: container.id },
      select: {
        name: true,
        containerImageDigest: true,
        localImageDigest: true,
        remoteDigest: true,
        imageUpdateStatus: true,
        updateAvailable: true,
        updateCheckedAt: true,
      },
    });

    console.log('📊 更新后的容器状态:');
    console.log(`  容器镜像摘要: ${updatedContainer?.containerImageDigest || '未知'}`);
    console.log(`  本地镜像摘要: ${updatedContainer?.localImageDigest || '未知'}`);
    console.log(`  远程镜像摘要: ${updatedContainer?.remoteDigest || '未知'}`);
    console.log(`  更新状态: ${updatedContainer?.imageUpdateStatus}`);
    console.log(`  需要更新: ${updatedContainer?.updateAvailable ? '是' : '否'}`);
    console.log(`  检查时间: ${updatedContainer?.updateCheckedAt}`);

    console.log('✅ 更新检测测试完成');
  } catch (error) {
    console.error('❌ 更新检测测试失败:', error);
  }
}

async function main() {
  console.log('🚀 开始完整流程测试...\n');

  try {
    await testImageStatusService();
    await testDatabaseIntegration();
    await testApiEndpoints();
    await testUpdateDetection();

    console.log('\n🎉 所有测试完成！');
  } catch (error) {
    console.error('\n💥 测试过程中发生错误:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  main();
}

export { main as testImageStatusFlow };
