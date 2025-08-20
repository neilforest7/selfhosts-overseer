import { Module, Global } from '@nestjs/common';
import { FrpService } from './frp.service';
import { FrpController } from './frp.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { DockerModule } from '../docker/docker.module';

@Global()
@Module({
  imports: [
    PrismaModule,
    SecurityModule,
    DockerModule,
  ],
  providers: [FrpService],
  controllers: [FrpController],
  exports: [FrpService],
})
export class FrpModule {}