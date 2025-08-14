import { Controller, Get, Query } from '@nestjs/common';
import { ReverseProxyService } from './reverse-proxy.service';

@Controller('/api/v1/reverse-proxy/routes')
export class ReverseProxyController {
  constructor(private readonly svc: ReverseProxyService) {}

  @Get()
  async list(@Query('hostId') hostId?: string) {
    return this.svc.listRoutes({ hostId });
  }
}


