import { Controller, Get, Query } from '@nestjs/common';
import { CertificatesService } from './certificates.service';

@Controller('/api/v1/certificates')
export class CertificatesController {
  constructor(private readonly svc: CertificatesService) {}

  @Get()
  async list(@Query('limit') limitStr?: string) {
    const limit = Math.min(500, Math.max(1, Number(limitStr) || 200));
    return this.svc.list(limit);
  }
}


