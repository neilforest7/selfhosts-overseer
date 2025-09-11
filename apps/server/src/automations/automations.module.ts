import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

// Existing services
import { AutomationsService } from './automations.service';
import { AutomationsController } from './automations.controller';
import { ContainerUpdateAutomationService } from './container-update-automation.service';
import { AUTOMATION_QUEUE_NAME } from './plugins/processors/plugin-automations.processor';

// Plugin system
import { PluginRegistry } from './plugins/registry/plugin-registry.service';
import { AutomationEngine } from './plugins/engine/automation-engine.service';
import { PluginsController } from './plugins/plugins.controller';

// Built-in trigger plugins
import { 
  CronTriggerPlugin, 
  ManualTriggerPlugin, 
  WebhookTriggerPlugin 
} from './plugins/triggers';
import { HttpHealthCheckTriggerPlugin } from './plugins/triggers/http-health-check-trigger.plugin';
import { FileSystemTriggerPlugin } from './plugins/triggers/filesystem-trigger.plugin';
import { ContainerStateTriggerPlugin } from './plugins/triggers/container-state-trigger.plugin';
import { SystemResourceTriggerPlugin } from './plugins/triggers/system-resource-trigger.plugin';

// Built-in event plugins
import { 
  LogMessageEventPlugin,
  RestartContainerEventPlugin,
  DiscoverContainersEventPlugin,
  CheckContainerUpdatesEventPlugin
} from './plugins/events';
import { SendNotificationEventPlugin } from './plugins/events/send-notification-event.plugin';
import { ExecuteCommandEventPlugin } from './plugins/events/execute-command-event.plugin';
import { FileOperationsEventPlugin } from './plugins/events/file-operations-event.plugin';
import { ContainerManagementEventPlugin } from './plugins/events/container-management-event.plugin';

// Updated processor for plugin system
import { PluginAutomationsProcessor } from './plugins/processors/plugin-automations.processor';

// Dependencies
import { PrismaModule } from '../prisma/prisma.module';
import { HostsModule } from '../hosts/hosts.module';
import { ContainersModule } from '../containers/containers.module';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { ContextModule } from '../context/context.module';
import { SshModule } from '../ssh/ssh.module';
import { AuthModule } from '../auth/auth.module';
import { ModuleRef } from '@nestjs/core';

// Validators and Services
import { UpdateValidator } from './validators/update-validator';
import { AuditLogService } from './services/audit-log.service';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({
      name: AUTOMATION_QUEUE_NAME,
    }),
    HostsModule,
    forwardRef(() => ContainersModule),
    OperationLogModule,
    ContextModule,
    SshModule,
    AuthModule,
  ],
  controllers: [AutomationsController, PluginsController],
  providers: [
    // Core services
    AutomationsService,
    ContainerUpdateAutomationService,

    // Validators and Services
    UpdateValidator,
    AuditLogService,

    // Plugin system
    {
      provide: PluginRegistry,
      useFactory: (moduleRef: ModuleRef) => new PluginRegistry(
        moduleRef,
        {
          autoDiscovery: false, // Disable for now, register manually
          hotReload: false,
          loadTimeout: 10000
        }
      ),
      inject: [ModuleRef]
    },
    AutomationEngine,
    
    // Built-in trigger plugins
    CronTriggerPlugin,
    ManualTriggerPlugin,
    WebhookTriggerPlugin,
    HttpHealthCheckTriggerPlugin,
    FileSystemTriggerPlugin,
    ContainerStateTriggerPlugin,
    SystemResourceTriggerPlugin,
    
    // Built-in event plugins
    LogMessageEventPlugin,
    RestartContainerEventPlugin,
    DiscoverContainersEventPlugin,
    CheckContainerUpdatesEventPlugin,
    SendNotificationEventPlugin,
    ExecuteCommandEventPlugin,
    FileOperationsEventPlugin,
    ContainerManagementEventPlugin,
    
    // Processor (plugin-based)
    PluginAutomationsProcessor,
  ],
  exports: [
    AutomationsService, 
    ContainerUpdateAutomationService,
    PluginRegistry,
    AutomationEngine
  ],
})
export class AutomationsModule {}
