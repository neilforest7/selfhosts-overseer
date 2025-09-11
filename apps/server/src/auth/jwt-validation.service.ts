import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

export interface JwtPayload {
  sub: string;
  username: string;
  iat: number;
  exp: number;
}

@Injectable()
export class JwtValidationService {
  private readonly logger = new Logger(JwtValidationService.name);

  constructor(private configService: ConfigService) {}

  validateToken(token: string): JwtPayload | null {
    try {
      const secret = this.configService.get<string>('JWT_SECRET');
      if (!secret) {
        this.logger.error('JWT_SECRET is not configured');
        return null;
      }

      return jwt.verify(token, secret) as JwtPayload;
    } catch (error) {
      this.logger.warn(`JWT validation failed: ${error.message}`);
      return null;
    }
  }

  extractTokenFromHeader(request: any): string | null {
    const authHeader = request.headers?.authorization;
    if (!authHeader) {
      return null;
    }

    const [type, token] = authHeader.split(' ');
    if (type !== 'Bearer' || !token) {
      return null;
    }

    return token;
  }

  generateToken(payload: { sub: string; username: string }): string {
    const secret = this.configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET is not configured');
    }

    return jwt.sign(payload, secret, { expiresIn: '7d' });
  }
}