import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

interface IRequestContext {
  opId?: string;
}

@Injectable()
export class ContextService {
  private readonly asyncLocalStorage = new AsyncLocalStorage<IRequestContext>();

  run<T>(opId: string | undefined, callback: () => T): T {
    return this.asyncLocalStorage.run({ opId }, callback);
  }

  getOpId(): string | undefined {
    return this.asyncLocalStorage.getStore()?.opId;
  }
}
