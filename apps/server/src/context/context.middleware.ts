import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ContextService } from './context.service';

@Injectable()
export class ContextMiddleware implements NestMiddleware {
  constructor(private readonly contextService: ContextService) {}

  use(req: Request, res: Response, next: NextFunction) {
    // For every request, we establish a new async context.
    // The opId will be added to this context later by the service that initiates the operation.
    this.contextService.run(undefined, next);
  }
}
