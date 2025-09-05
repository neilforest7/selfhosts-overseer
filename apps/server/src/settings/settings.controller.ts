import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { SettingsService, Settings } from './settings.service';

@Controller('/api/v1/settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async getSettings(): Promise<Settings> {
    return this.settingsService.get();
  }

  @Put()
  async updateSettings(@Body() body: Partial<Settings>): Promise<Settings> {
    return this.settingsService.update(body);
  }

  @Post('test-docker-hub-connectivity')
  async testDockerHubConnectivity(@Body() body: {
    proxyHost: string;
    proxyPort: number;
    proxyUsername?: string;
    proxyPassword?: string;
  }): Promise<{ success: boolean; message: string; details?: any }> {
    return this.settingsService.testDockerHubConnectivity(body);
  }
}

