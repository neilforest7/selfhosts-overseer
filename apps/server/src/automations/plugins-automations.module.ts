import { Module, forwardRef } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';

// Existing services
import { AutomationsService } from './automations.service';
import { AutomationsController } from './automations.controller';
import { ContainerUpdateAutomationService } from './container-update-automation.service';
import { AUTOMATION_QUEUE_NAME } from './automations.processor';

// Plugin system
import { PluginRegistry } from './plugins/registry/plugin-registry.service';
import { AutomationEngine } from './plugins/engine/automation-engine.service';
import { PluginsController } from './plugins/plugins.controller';

// Built-in trigger plugins
import { 
  CronTriggerPlugin, 
  ManualTriggerPlugin, 
  WebhookTriggerPlugin,
  HttpHealthCheckTriggerPlugin,
  FileSystemTriggerPlugin,
  ContainerStateTriggerPlugin,
  SystemResourceTriggerPlugin
} from './plugins/triggers';

// Built-in event plugins
import { 
  LogMessageEventPlugin,
  RestartContainerEventPlugin,
  DiscoverContainersEventPlugin,
  CheckContainerUpdatesEventPlugin,
  SendNotificationEventPlugin,
  ExecuteCommandEventPlugin,
  FileOperationsEventPlugin,
  ContainerManagementEventPlugin
} from './plugins/events';

// Updated processor for plugin system
import { PluginAutomationsProcessor } from './plugins/processors/plugin-automations.processor';

// Dependencies
import { PrismaModule } from '../prisma/prisma.module';
import { HostsModule } from '../hosts/hosts.module';
import { ContainersModule } from '../containers/containers.module';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { ContextModule } from '../context/context.module';

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
  ],
  controllers: [AutomationsController, PluginsController],
  providers: [
    // Core services
    AutomationsService,
    ContainerUpdateAutomationService,
    
    // Plugin system
    {
      provide: PluginRegistry,
      useFactory: (moduleRef) => new PluginRegistry(
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