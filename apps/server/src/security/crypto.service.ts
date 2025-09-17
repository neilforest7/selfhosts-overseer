import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly key: Buffer;

  constructor(private configService: ConfigService) {
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');

    // In production, always use ENCRYPTION_KEY
    // In development, prioritize DEV_ENCRYPTION_KEY for backward compatibility
    let raw: string;
    if (nodeEnv === 'production') {
      raw = this.configService.get<string>('ENCRYPTION_KEY', '');
      if (!raw) {
        throw new Error('ENCRYPTION_KEY is required in production environment');
      }
      this.logger.log('🔒 Using production encryption key');
    } else {
      raw = this.configService.get<string>('DEV_ENCRYPTION_KEY') ||
            this.configService.get<string>('ENCRYPTION_KEY') ||
            'dev-insecure-key-please-change-immediately';
      this.logger.log('🔓 Using development encryption key');
    }

    // Derive 32-byte key via sha256
    this.key = createHash('sha256').update(raw).digest();
    this.logger.log(`🔑 CryptoService initialized for ${nodeEnv} environment`);
  }

  encryptString(plain?: string | null): string | null {
    if (!plain) return null;
    try {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.key, iv);
      const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
    } catch (e) {
      this.logger.warn(`encrypt failed: ${String(e)}`);
      return null;
    }
  }

  decryptString(enc?: string | null): string | null {
    if (!enc) return null;
    try {
      if (!enc.startsWith('v1:')) return enc; // backward/plain
      const [, ivB64, tagB64, dataB64] = enc.split(':');
      const iv = Buffer.from(ivB64, 'base64');
      const tag = Buffer.from(tagB64, 'base64');
      const data = Buffer.from(dataB64, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      const dec = Buffer.concat([decipher.update(data), decipher.final()]);
      return dec.toString('utf8');
    } catch (e) {
      this.logger.warn(`decrypt failed: ${String(e)}`);
      return null;
    }
  }
}


