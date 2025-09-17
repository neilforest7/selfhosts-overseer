import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthInitService implements OnModuleInit {
  private readonly logger = new Logger(AuthInitService.name);
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly readyCheckInterval: number;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService
  ) {
    this.maxRetries = parseInt(this.configService.get<string>('AUTH_INIT_MAX_RETRIES') || this.configService.get<string>('DEV_AUTH_INIT_MAX_RETRIES') || '10');
    this.retryDelay = parseInt(this.configService.get<string>('AUTH_INIT_RETRY_DELAY') || this.configService.get<string>('DEV_AUTH_INIT_RETRY_DELAY') || '3000');
    this.readyCheckInterval = parseInt(this.configService.get<string>('AUTH_INIT_READY_CHECK_INTERVAL') || this.configService.get<string>('DEV_AUTH_INIT_READY_CHECK_INTERVAL') || '2000');
  }

  async onModuleInit() {
    await this.initializeAdminUser();
  }

  async initializeAdminUser() {
    let retryCount = 0;

    while (retryCount < this.maxRetries) {
      try {
        await this.waitForDatabaseReady();
        await this.createAdminUserIfNeeded();
        break;
      } catch (error) {
        retryCount++;

        if (retryCount >= this.maxRetries) {
          this.logger.error(`Failed to initialize admin user after ${retryCount} attempts:`, error);
          return;
        }

        this.logger.warn(`Attempt ${retryCount}/${this.maxRetries} failed. Retrying in ${this.retryDelay}ms...`);
        await this.sleep(this.retryDelay);
      }
    }
  }

  private async waitForDatabaseReady(): Promise<void> {
    this.logger.log('Checking if database schema is ready for auth initialization...');

    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        const isReady = await this.isDatabaseReady();
        if (isReady) {
          this.logger.log(`Database schema is ready (attempt ${attempt})`);
          return;
        }
      } catch (error) {
        this.logger.debug(`Database readiness check attempt ${attempt} failed:`, error);
      }

      if (attempt < 10) {
        await this.sleep(this.readyCheckInterval);
      }
    }

    throw new Error('Database schema is not ready after maximum attempts');
  }

  private async isDatabaseReady(): Promise<boolean> {
    try {
      const result = await this.prisma.$queryRaw<[{ exists: boolean }]>`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'User'
        ) as exists
      `;

      return result[0].exists;
    } catch (error) {
      this.logger.debug('Database readiness check failed:', error);
      return false;
    }
  }

  private async createAdminUserIfNeeded(): Promise<void> {
    try {
      const userCount = await this.prisma.user.count();

      if (userCount === 0) {
        const username = this.configService.get<string>('USERNAME') || this.configService.get<string>('DEV_USERNAME');
        const password = this.configService.get<string>('PASSWORD') || this.configService.get<string>('DEV_PASSWORD');

        if (!username || !password) {
          this.logger.warn('USERNAME or PASSWORD environment variables not set. Skipping user initialization.');
          return;
        }

        this.logger.log('No users found. Creating admin user...');

        const passwordHash = await bcrypt.hash(password, 12);

        await this.prisma.user.create({
          data: {
            username,
            passwordHash,
            isActive: true,
          },
        });

        this.logger.log(`Admin user '${username}' created successfully`);
      } else {
        this.logger.log(`${userCount} user(s) found. Skipping initialization.`);
      }
    } catch (error) {
      this.logger.error('Failed to create admin user:', error);
      throw error;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}