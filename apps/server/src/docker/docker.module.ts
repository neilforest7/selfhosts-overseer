import { Global, Module } from '@nestjs/common';
import { DockerService } from '../containers/docker.service';
import { DockerExecService } from '../containers/docker-exec.service';
import { DockerContainerService } from '../containers/docker-container.service';
import { DockerImageService } from '../containers/docker-image.service';
import { DockerRegistryService } from '../containers/docker-registry.service';
import { SshModule } from '../ssh/ssh.module';
import { SettingsModule } from '../settings/settings.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { OperationLogModule } from '../operation-log/operation-log.module';

@Global()
@Module({
  imports: [SshModule, SettingsModule, PrismaModule, SecurityModule, OperationLogModule],
  providers: [
    DockerExecService,
    DockerContainerService,
    DockerImageService,
    DockerRegistryService,
    DockerService,
  ],
  exports: [DockerService, DockerRegistryService],
})
export class DockerModule {}