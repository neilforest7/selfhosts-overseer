import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthInitService implements OnModuleInit {
  private readonly logger = new Logger(AuthInitService.name);

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.initializeAdminUser();
  }

  async initializeAdminUser() {
    try {
      const userCount = await this.prisma.user.count();
      
      if (userCount === 0) {
        const username = process.env.USERNAME;
        const password = process.env.PASSWORD;
        
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
      this.logger.error('Failed to initialize admin user:', error);
    }
  }
}