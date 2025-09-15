import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { DatabaseMigrationService } from './database-migration.service';

@Injectable()
export class MigrationGuard implements CanActivate {
  private readonly logger = new Logger(MigrationGuard.name);
  private isMigrating = false;
  private migrationLock: { by: string; at: Date } | null = null;

  constructor(private readonly migrationService: DatabaseMigrationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id || 'anonymous';

    if (this.isMigrating) {
      this.logger.warn(`Migration blocked - already in progress by ${this.migrationLock?.by}`);
      throw new ConflictException({
        message: 'Database migration is already in progress',
        status: 'MIGRATION_IN_PROGRESS',
        lockedBy: this.migrationLock?.by,
        lockedAt: this.migrationLock?.at,
      });
    }

    // Check database health before allowing migration
    const health = await this.migrationService.checkHealth();
    if (!health.connected) {
      throw new ConflictException({
        message: 'Database connection is not available',
        status: 'DATABASE_UNAVAILABLE',
        health,
      });
    }

    // Acquire migration lock
    this.acquireLock(userId);

    return true;
  }

  private acquireLock(by: string): void {
    this.isMigrating = true;
    this.migrationLock = {
      by,
      at: new Date(),
    };

    this.logger.log(`Migration lock acquired by ${by} at ${this.migrationLock.at}`);

    // Set up automatic lock release in case of failure
    setTimeout(() => {
      this.releaseLock('timeout');
    }, 300000); // 5 minutes
  }

  releaseLock(releasedBy: string): void {
    if (this.isMigrating) {
      const duration = Date.now() - (this.migrationLock?.at.getTime() || 0);
      this.logger.log(`Migration lock released by ${releasedBy} after ${duration}ms`);

      this.isMigrating = false;
      this.migrationLock = null;
    }
  }

  getLockStatus(): {
    isLocked: boolean;
    lockedBy?: string;
    lockedAt?: Date;
    duration?: number;
  } {
    if (!this.isMigrating) {
      return { isLocked: false };
    }

    return {
      isLocked: true,
      lockedBy: this.migrationLock?.by,
      lockedAt: this.migrationLock?.at,
      duration: this.migrationLock?.at ? Date.now() - this.migrationLock.at.getTime() : undefined,
    };
  }
}