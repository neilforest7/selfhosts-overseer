import { Injectable, Logger } from '@nestjs/common';
import { ImageUpdateStatus } from '../shared';

export interface ImageStatusResult {
  status: ImageUpdateStatus;
  containerNeedsRestart: boolean;
  imageNeedsPull: boolean;
  containerImageDigest?: string;
  containerImageId?: string;
  localImageDigest?: string;
  localImageId?: string;
  remoteImageDigest?: string;
  error?: string;
}


@Injectable()
export class ImageStatusService {
  private readonly logger = new Logger(ImageStatusService.name);

  /**
   * 分析三层镜像状态并确定更新状态
   *
   * @param containerImageDigest 容器实际运行的镜像摘要
   * @param containerImageId 容器实际运行的镜像ID
   * @param localImageDigest 本地最新镜像摘要
   * @param localImageId 本地最新镜像ID
   * @param remoteImageDigest 远程最新镜像摘要
   * @param error 错误信息
   */
  analyzeImageStatus(
    containerImageDigest?: string | null,
    containerImageId?: string | null,
    localImageDigest?: string | null,
    localImageId?: string | null,
    remoteImageDigest?: string | null,
    error?: string
  ): ImageStatusResult {
    // 如果有错误，返回未知状态
    if (error) {
      return {
        status: 'UNKNOWN',
        containerNeedsRestart: false,
        imageNeedsPull: false,
        error,
      };
    }

    // 如果缺少关键信息，返回未知状态
    if (!containerImageId || !localImageId) {
      return {
        status: 'UNKNOWN',
        containerNeedsRestart: false,
        imageNeedsPull: false,
        containerImageDigest: containerImageDigest || undefined,
        containerImageId: containerImageId || undefined,
        localImageDigest: localImageDigest || undefined,
        localImageId: localImageId || undefined,
        remoteImageDigest: remoteImageDigest || undefined,
      };
    }

    // 正确的比较逻辑：使用镜像ID进行比较
    // 容器是否需要重启：比较容器实际运行的镜像ID与本地最新镜像ID
    const containerVsLocal = this.normalizeImageId(containerImageId) !== this.normalizeImageId(localImageId);

    // 镜像是否需要拉取：比较本地镜像摘要与远程镜像摘要
    const normalizedLocalDigest = localImageDigest ? this.normalizeDigest(localImageDigest) : null;
    const normalizedRemoteDigest = remoteImageDigest ? this.normalizeDigest(remoteImageDigest) : null;
    const localVsRemote = normalizedRemoteDigest && normalizedLocalDigest &&
      normalizedLocalDigest !== normalizedRemoteDigest;

    // 确定状态
    let status: ImageUpdateStatus;
    let containerNeedsRestart = false;
    let imageNeedsPull = false;

    if (!containerVsLocal && !localVsRemote) {
      status = 'UP_TO_DATE';
    } else if (containerVsLocal && !localVsRemote) {
      status = 'CONTAINER_OUTDATED';
      containerNeedsRestart = true;
    } else if (!containerVsLocal && localVsRemote) {
      status = 'IMAGE_OUTDATED';
      imageNeedsPull = true;
    } else {
      status = 'BOTH_OUTDATED';
      containerNeedsRestart = true;
      imageNeedsPull = true;
    }

    return {
      status,
      containerNeedsRestart,
      imageNeedsPull,
      containerImageDigest: containerImageDigest || undefined,
      containerImageId: containerImageId || undefined,
      localImageDigest: localImageDigest || undefined,
      localImageId: localImageId || undefined,
      remoteImageDigest: remoteImageDigest || undefined,
    };
  }


  /**
   * 检查是否需要执行某种操作
   */
  needsAction(status: ImageUpdateStatus): {
    needsPull: boolean;
    needsRestart: boolean;
    needsAnyAction: boolean;
  } {
    switch (status) {
      case 'CONTAINER_OUTDATED':
        return { needsPull: false, needsRestart: true, needsAnyAction: true };
      case 'IMAGE_OUTDATED':
        return { needsPull: true, needsRestart: false, needsAnyAction: true };
      case 'BOTH_OUTDATED':
        return { needsPull: true, needsRestart: true, needsAnyAction: true };
      default:
        return { needsPull: false, needsRestart: false, needsAnyAction: false };
    }
  }

  /**
   * 获取状态的优先级（用于排序）
   */
  getStatusPriority(status: ImageUpdateStatus): number {
    switch (status) {
      case 'BOTH_OUTDATED':
        return 4; // 最高优先级
      case 'IMAGE_OUTDATED':
        return 3;
      case 'CONTAINER_OUTDATED':
        return 2;
      case 'UNKNOWN':
        return 1;
      case 'UP_TO_DATE':
        return 0; // 最低优先级
      default:
        return -1;
    }
  }

  /**
   * 标准化摘要格式以便比较
   */
  private normalizeDigest(digest: string): string {
    if (!digest) return '';
    // 移除可能的前缀，只保留 sha256:xxx 部分
    const match = digest.match(/sha256:[a-f0-9]+/);
    return match ? match[0] : digest;
  }

  /**
   * 标准化镜像ID格式以便比较
   */
  private normalizeImageId(imageId: string): string {
    if (!imageId) return '';
    // 移除 sha256: 前缀，只保留哈希部分
    if (imageId.startsWith('sha256:')) {
      return imageId.substring(7);
    }
    return imageId;
  }


  /**
   * 获取状态统计信息
   */
  getStatusStats(statuses: ImageUpdateStatus[]): {
    total: number;
    upToDate: number;
    containerOutdated: number;
    imageOutdated: number;
    bothOutdated: number;
    unknown: number;
    needsAction: number;
  } {
    const stats = {
      total: statuses.length,
      upToDate: 0,
      containerOutdated: 0,
      imageOutdated: 0,
      bothOutdated: 0,
      unknown: 0,
      needsAction: 0,
    };

    statuses.forEach(status => {
      switch (status) {
        case 'UP_TO_DATE':
          stats.upToDate++;
          break;
        case 'CONTAINER_OUTDATED':
          stats.containerOutdated++;
          stats.needsAction++;
          break;
        case 'IMAGE_OUTDATED':
          stats.imageOutdated++;
          stats.needsAction++;
          break;
        case 'BOTH_OUTDATED':
          stats.bothOutdated++;
          stats.needsAction++;
          break;
        case 'UNKNOWN':
          stats.unknown++;
          break;
      }
    });

    return stats;
  }

  /**
   * 获取状态显示信息
   */
  getStatusDisplay(status: ImageUpdateStatus): {
    text: string;
    color: string;
    action: string | null;
    icon: string;
  } {
    switch (status) {
      case 'UP_TO_DATE':
        return {
          text: '最新',
          color: 'green',
          action: null,
          icon: '✅'
        };
      case 'CONTAINER_OUTDATED':
        return {
          text: '容器需重启',
          color: 'orange',
          action: 'restart',
          icon: '🔄'
        };
      case 'IMAGE_OUTDATED':
        return {
          text: '镜像需更新',
          color: 'blue',
          action: 'update',
          icon: '⬇️'
        };
      case 'BOTH_OUTDATED':
        return {
          text: '镜像和容器都需更新',
          color: 'red',
          action: 'both',
          icon: '⚠️'
        };
      case 'UNKNOWN':
      default:
        return {
          text: '未知状态',
          color: 'gray',
          action: null,
          icon: '❓'
        };
    }
  }
}
