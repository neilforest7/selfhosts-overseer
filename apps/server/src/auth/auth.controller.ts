import { Controller, Get, Post, Body, Req, UseGuards, UnauthorizedException } from '@nestjs/common';
import { JwtValidationService } from './jwt-validation.service';
import { AuthGuard } from './auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

export class LoginDto {
  username: string;
  password: string;
}

export class AuthResponseDto {
  success: boolean;
  message: string;
  user?: {
    id: string;
    username: string;
  };
}

export class LoginResponseDto {
  success: boolean;
  message: string;
  user?: {
    id: string;
    username: string;
  };
  token?: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private jwtValidationService: JwtValidationService,
    private prisma: PrismaService,
  ) {}

  @Post('login')
  async login(@Body() loginDto: LoginDto): Promise<LoginResponseDto> {
    const { username, password } = loginDto;

    const user = await this.prisma.user.findUnique({
      where: { username },
    });

    if (!user || !user.isActive) {
      return {
        success: false,
        message: 'Invalid username or password',
      };
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    
    if (!isPasswordValid) {
      return {
        success: false,
        message: 'Invalid username or password',
      };
    }

    const token = this.jwtValidationService.generateToken({
      sub: user.id,
      username: user.username,
    });

    // Update last login time
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
      },
      token,
    };
  }

  @Post('validate')
  async validateToken(@Req() request: any): Promise<AuthResponseDto> {
    const token = this.jwtValidationService.extractTokenFromHeader(request);
    
    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    const payload = this.jwtValidationService.validateToken(token);
    
    if (!payload) {
      throw new UnauthorizedException('Invalid token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    return {
      success: true,
      message: 'Token is valid',
      user: {
        id: user.id,
        username: user.username,
      },
    };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async getCurrentUser(@Req() request: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: request.user.sub },
      select: { id: true, username: true, isActive: true, lastLoginAt: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    return user;
  }
}