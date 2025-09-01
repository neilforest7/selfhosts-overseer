import { Global, Module } from '@nestjs/common';
import { DockerService } from '../containers/docker.service';
import { DockerExecService } from '../containers/docker-exec.service';
import { DockerContainerService } from '../containers/docker-container.service';
import { DockerImageService } from '../containers/docker-image.service';
import { SshModule } from '../ssh/ssh.module';
import { SettingsModule } from '../settings/settings.module';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [SshModule, SettingsModule, PrismaModule],
  providers: [
    DockerExecService,
    DockerContainerService,
    DockerImageService,
    DockerService,
  ],
  exports: [DockerService],
})
export class DockerModule {}