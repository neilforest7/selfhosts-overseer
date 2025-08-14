import { Controller, Get } from '@nestjs/common';

@Controller('/api/v1/health')
export class AppController {
  @Get()
  getHealth() {
    return { ok: true, service: 'server', ts: new Date().toISOString() };
  }
}

