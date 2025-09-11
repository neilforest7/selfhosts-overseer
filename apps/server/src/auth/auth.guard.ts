import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtValidationService, JwtPayload } from './jwt-validation.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwtValidationService: JwtValidationService,
    private reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = this.jwtValidationService.extractTokenFromHeader(request);
    
    if (!token) {
      throw new UnauthorizedException('No authentication token provided');
    }

    const payload = this.jwtValidationService.validateToken(token);
    
    if (!payload) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Add user payload to request for use in controllers
    request.user = payload;
    
    return true;
  }
}

@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(
    private jwtValidationService: JwtValidationService,
    private reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = this.jwtValidationService.extractTokenFromHeader(request);
    
    if (!token) {
      // Allow access without token for public endpoints
      request.user = null;
      return true;
    }

    const payload = this.jwtValidationService.validateToken(token);
    
    if (!payload) {
      // Token provided but invalid - don't block, just set user to null
      request.user = null;
      return true;
    }

    request.user = payload;
    return true;
  }
}