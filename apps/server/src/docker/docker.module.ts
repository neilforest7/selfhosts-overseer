import { Global, Module } from '@nestjs/common';
import { DockerService } from '../containers/docker.service';
import { SshModule } from '../ssh/ssh.module';
import { SettingsModule } from '../settings/settings.module';

@Global()
@Module({
  imports: [SshModule, SettingsModule],
  providers: [DockerService],
  exports: [DockerService],
})
export class DockerModule {}