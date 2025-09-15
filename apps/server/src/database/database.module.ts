import { Module } from '@nestjs/common';
import { DatabaseMigrationService } from './database-migration.service';
import { DatabaseController } from './database.controller';
import { MigrationGuard } from './migration.guard';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [DatabaseController],
  providers: [DatabaseMigrationService, MigrationGuard, PrismaService],
  exports: [DatabaseMigrationService, MigrationGuard],
})
export class DatabaseModule {}