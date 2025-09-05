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

  @Post('test-ghcr-connectivity')
  async testGhcrConnectivity(@Body() body: {
    username: string;
    personalAccessToken: string;
  }): Promise<{ success: boolean; message: string; details?: any }> {
    return this.settingsService.testGhcrConnectivity(body);
  }

  @Put('ghcr-credentials')
  async updateGhcrCredentials(@Body() body: {
    enabled: boolean;
    username: string;
    personalAccessToken: string;
  }): Promise<{ success: boolean; message: string }> {
    await this.settingsService.setGhcrCredentials(body);
    return { success: true, message: 'GHCR 凭证已更新' };
  }

  @Get('ghcr-credentials')
  async getGhcrCredentials(): Promise<{
    enabled: boolean;
    username: string;
    hasToken: boolean;
  }> {
    const credentials = await this.settingsService.getDecryptedGhcrCredentials();
    return {
      enabled: credentials.enabled,
      username: credentials.username,
      hasToken: !!credentials.personalAccessToken,
    };
  }
}

