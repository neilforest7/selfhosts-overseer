/**
 * 容器镜像更新状态枚举
 */
export enum ImageUpdateStatus {
  UNKNOWN = 'UNKNOWN',                    // 未知状态
  UP_TO_DATE = 'UP_TO_DATE',             // 完全最新
  CONTAINER_OUTDATED = 'CONTAINER_OUTDATED', // 容器过时（本地镜像已更新，但容器未重启）
  IMAGE_OUTDATED = 'IMAGE_OUTDATED',     // 镜像过时（远程有新版本，但本地未拉取）
  BOTH_OUTDATED = 'BOTH_OUTDATED',       // 都过时（远程有新版本，且容器也未使用最新本地镜像）
}

/**
 * 镜像更新检测结果
 */
export interface ImageUpdateResult {
  status: ImageUpdateStatus;
  containerNeedsRestart: boolean;  // 容器是否需要重启
  imageNeedsPull: boolean;         // 镜像是否需要拉取
  containerImageDigest?: string;   // 容器实际运行的镜像摘要
  localImageDigest?: string;       // 本地最新镜像摘要
  remoteImageDigest?: string;      // 远程最新镜像摘要
  error?: string;                  // 错误信息
}

/**
 * 容器镜像信息
 */
export interface ContainerImageInfo {
  // 容器实际运行的镜像信息
  containerImageDigest?: string;
  containerImageId?: string;
  containerImageCreated?: Date;
  
  // 本地最新镜像信息
  localImageDigest?: string;
  localImageId?: string;
  localImageCreated?: Date;
  
  // 远程镜像信息
  remoteDigest?: string;
  
  // 更新状态
  imageUpdateStatus: ImageUpdateStatus;
  updateAvailable: boolean; // 向后兼容字段，建议使用 imageUpdateStatus
  updateCheckedAt?: Date;
}

/**
 * 更新状态显示信息
 */
export interface UpdateStatusDisplay {
  text: string;
  color: 'green' | 'orange' | 'blue' | 'red' | 'gray' | 'purple-400' | 'pink-400' | 'indigo-400';
  action: 'restart' | 'pull' | 'update' | null;
  description: string;
  icon?: string;
}

/**
 * 获取更新状态的显示信息
 */
export function getUpdateStatusDisplay(status: ImageUpdateStatus | string): UpdateStatusDisplay {
  switch (status) {
    case ImageUpdateStatus.UP_TO_DATE:
    case 'UP_TO_DATE':
      return {
        text: '',
        color: 'green',
        action: null,
        description: '容器和镜像都是最新版本',
        icon: ''
      };
    case ImageUpdateStatus.CONTAINER_OUTDATED:
    case 'CONTAINER_OUTDATED':
      return {
        text: '重启容器更新',
        color: 'indigo-400',
        action: 'restart',
        description: '本地镜像已更新，但容器仍在使用旧版本，需要重启容器',
        icon: '🔄'
      };
    case ImageUpdateStatus.IMAGE_OUTDATED:
    case 'IMAGE_OUTDATED':
      return {
        text: '发现新版本',
        color: 'purple-400',
        action: 'pull',
        description: '远程有新版本镜像，需要拉取最新镜像',
        icon: '📥'
      };
    case ImageUpdateStatus.BOTH_OUTDATED:
    case 'BOTH_OUTDATED':
      return {
        text: '发现新版本',
        color: 'pink-400',
        action: 'update',
        description: '远程有新版本，且容器也未使用最新本地镜像，需要拉取镜像并重启容器',
        icon: '🔄📥'
      };
    default:
      return {
        text: '未知',
        color: 'gray',
        action: null,
        description: '更新状态未知，需要检查',
        icon: '❓'
      };
  }
}

/**
 * 检查是否需要执行某种操作
 */
export function needsAction(status: ImageUpdateStatus): {
  needsPull: boolean;
  needsRestart: boolean;
} {
  switch (status) {
    case ImageUpdateStatus.CONTAINER_OUTDATED:
      return { needsPull: false, needsRestart: true };
    case ImageUpdateStatus.IMAGE_OUTDATED:
      return { needsPull: true, needsRestart: false };
    case ImageUpdateStatus.BOTH_OUTDATED:
      return { needsPull: true, needsRestart: true };
    default:
      return { needsPull: false, needsRestart: false };
  }
}
