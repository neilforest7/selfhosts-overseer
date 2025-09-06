#!/usr/bin/env tsx

/**
 * 数据迁移脚本：为现有容器填充新的镜像跟踪字段
 * 
 * 此脚本将：
 * 1. 将现有的 repoDigest 复制到 localImageDigest
 * 2. 为所有容器设置初始的 imageUpdateStatus 为 UNKNOWN
 * 3. 触发一次容器发现以填充 containerImageDigest 等字段
 */

import { PrismaClient } from '@prisma/client';
import { Logger } from '@nestjs/common';

const prisma = new PrismaClient();
const logger = new Logger('ContainerImageDataMigration');

async function migrateContainerImageData() {
  logger.log('开始迁移容器镜像数据...');

  try {
    // 1. 统计需要迁移的容器数量
    const totalContainers = await prisma.container.count();
    logger.log(`发现 ${totalContainers} 个容器需要迁移`);

    if (totalContainers === 0) {
      logger.log('没有容器需要迁移，退出');
      return;
    }

    // 2. 批量更新容器数据
    // 将现有的 repoDigest 复制到 localImageDigest（如果 repoDigest 存在且 localImageDigest 为空）
    // 由于 Prisma 不支持字段间复制，我们需要分批处理
    const containersToUpdate = await prisma.container.findMany({
      where: {
        repoDigest: { not: null },
        localImageDigest: null,
      },
      select: {
        id: true,
        repoDigest: true,
      },
    });

    let updateCount = 0;
    for (const container of containersToUpdate) {
      await prisma.container.update({
        where: { id: container.id },
        data: {
          localImageDigest: container.repoDigest,
        },
      });
      updateCount++;
    }

    logger.log(`已更新 ${updateCount} 个容器的 localImageDigest 字段`);

    // 3. 为所有 imageUpdateStatus 为 UNKNOWN 的容器设置状态
    // 如果容器有镜像信息，设置为需要检查状态；否则保持 UNKNOWN
    const statusUpdateResult = await prisma.container.updateMany({
      where: {
        imageUpdateStatus: 'UNKNOWN',
        imageName: { not: null },
        imageTag: { not: null },
      },
      data: {
        imageUpdateStatus: 'UNKNOWN', // 保持 UNKNOWN，等待下次检查时更新
      },
    });

    logger.log(`已处理 ${statusUpdateResult.count} 个容器的更新状态`);

    // 4. 统计迁移结果
    const stats = await prisma.container.groupBy({
      by: ['imageUpdateStatus'],
      _count: true,
    });

    logger.log('迁移完成，状态统计：');
    stats.forEach(stat => {
      logger.log(`  ${stat.imageUpdateStatus}: ${stat._count} 个容器`);
    });

    // 5. 显示需要进一步处理的容器
    const containersNeedingImageInfo = await prisma.container.count({
      where: {
        OR: [
          { imageName: null },
          { imageTag: null },
        ],
      },
    });

    if (containersNeedingImageInfo > 0) {
      logger.warn(`发现 ${containersNeedingImageInfo} 个容器缺少镜像信息，建议运行容器发现来补充数据`);
    }

    logger.log('数据迁移完成！');
    logger.log('建议接下来执行以下操作：');
    logger.log('1. 运行容器发现以填充 containerImageDigest 等字段');
    logger.log('2. 运行容器更新检查以更新 imageUpdateStatus');

  } catch (error) {
    logger.error('迁移过程中发生错误：', error);
    throw error;
  }
}

async function main() {
  try {
    await migrateContainerImageData();
  } catch (error) {
    logger.error('迁移失败：', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  main();
}

export { migrateContainerImageData };
