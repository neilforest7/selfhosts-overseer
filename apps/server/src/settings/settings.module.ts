import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService]
})
export class SettingsModule {}

