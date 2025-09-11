import { Module } from '@nestjs/common';
import { JwtValidationService } from './jwt-validation.service';
import { AuthController } from './auth.controller';
import { AuthGuard, OptionalAuthGuard } from './auth.guard';
import { AuthInitService } from './auth-init.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [
    JwtValidationService,
    AuthGuard,
    OptionalAuthGuard,
    AuthInitService,
  ],
  exports: [
    JwtValidationService,
    AuthGuard,
    OptionalAuthGuard,
  ],
})
export class AuthModule {}