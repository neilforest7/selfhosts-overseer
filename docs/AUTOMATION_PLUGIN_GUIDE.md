# Automation Plugin Development Guide

## Overview

The Self-Host Serv Agent automation system uses a plugin-based architecture that allows easy extension of triggers and events. This guide covers how to develop custom plugins for the automation system.

## Architecture

The plugin system consists of:

- **Plugin Registry**: Central registry for all plugins
- **Base Plugin Classes**: Abstract classes providing common functionality
- **Trigger Plugins**: Define WHEN automation rules should fire
- **Event Plugins**: Define WHAT ACTIONS to take when rules fire
- **Automation Engine**: Evaluates rules using registered plugins

## Plugin Types

### Trigger Plugins

Trigger plugins determine when automation rules should fire. They evaluate conditions and return whether the trigger should fire.

**Example use cases:**
- Time-based triggers (CRON schedules)
- Event-based triggers (webhook calls)
- System state triggers (resource usage thresholds)
- External service triggers (API calls)

### Event Plugins

Event plugins define the actions that are executed when automation rules are triggered.

**Example use cases:**
- Container operations (restart, update, stop/start)
- System commands (execute scripts, send notifications)
- API calls (webhook notifications, service integrations)
- Data operations (backup, cleanup, synchronization)

## Creating a Trigger Plugin

### 1. Extend BaseTriggerPlugin

```typescript
import { Injectable } from '@nestjs/common';
import { BaseTriggerPlugin } from '../base';
import { TriggerConfig, TriggerContext, TriggerResult } from '../interfaces';

@Injectable()
export class MyCustomTriggerPlugin extends BaseTriggerPlugin {
  public readonly id = 'my-custom-trigger';
  public readonly name = 'My Custom Trigger';
  public readonly description = 'A custom trigger for specific conditions';
  public readonly version = '1.0.0';
  public readonly author = 'Your Name';
  public readonly tags = ['custom', 'example'];
  public readonly triggerType = 'my-custom';
  
  /**
   * Evaluate whether this trigger should fire
   */
  public async evaluate(config: TriggerConfig, context: TriggerContext): Promise<TriggerResult> {
    if (!this.isTriggerEnabled(config)) {
      return this.createTriggerResult(false, { reason: 'Trigger is disabled' });
    }
    
    // Your custom trigger logic here
    const shouldTrigger = await this.evaluateCustomLogic(config, context);
    
    return this.createTriggerResult(shouldTrigger, {
      reason: shouldTrigger ? 'Custom condition met' : 'Custom condition not met',
      triggerData: {
        evaluationTime: context.timestamp,
        // Add any relevant data
      }
    });
  }
  
  /**
   * Get trigger configuration schema for UI generation
   */
  public getTriggerConfigSchema(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        myParameter: {
          type: 'string',
          title: 'My Parameter',
          description: 'Description of what this parameter does',
          minLength: 1
        },
        threshold: {
          type: 'number',
          title: 'Threshold',
          description: 'Numeric threshold value',
          minimum: 0,
          default: 100
        }
      },
      required: ['myParameter'],
      additionalProperties: false
    };
  }
  
  /**
   * Validate trigger-specific configuration
   */
  protected async validateCustomConfig(config: TriggerConfig): Promise<boolean> {
    if (!this.validateRequiredFields(config, ['myParameter'])) {
      return false;
    }
    
    const threshold = config.config.threshold;
    if (threshold !== undefined && threshold < 0) {
      this.logError('Threshold must be a positive number');
      return false;
    }
    
    return true;
  }
  
  /**
   * Your custom evaluation logic
   */
  private async evaluateCustomLogic(config: TriggerConfig, context: TriggerContext): Promise<boolean> {
    const myParameter = this.getConfigValue(config, 'myParameter', '');
    const threshold = this.getConfigValue(config, 'threshold', 100);
    
    // Implement your trigger logic here
    // Return true if trigger should fire, false otherwise
    
    return false; // Placeholder
  }
}
```

### 2. Register the Plugin

Add your plugin to the automation module:

```typescript
// In plugins-automations.module.ts
import { MyCustomTriggerPlugin } from './plugins/triggers/my-custom-trigger.plugin';

@Module({
  providers: [
    // ... other providers
    MyCustomTriggerPlugin,
  ],
})
export class AutomationsModule {}
```

## Creating an Event Plugin

### 1. Extend BaseEventPlugin

```typescript
import { Injectable } from '@nestjs/common';
import { BaseEventPlugin } from '../base';
import { EventConfig, EventContext, EventResult } from '../interfaces';

@Injectable()
export class MyCustomEventPlugin extends BaseEventPlugin {
  public readonly id = 'my-custom-event';
  public readonly name = 'My Custom Event';
  public readonly description = 'A custom event that performs specific actions';
  public readonly version = '1.0.0';
  public readonly author = 'Your Name';
  public readonly tags = ['custom', 'example'];
  public readonly eventType = 'my-custom-action';
  
  /**
   * Execute the event action
   */
  public async execute(config: EventConfig, context: EventContext): Promise<EventResult> {
    try {
      if (!this.validateRequiredParams(config, ['target'])) {
        return this.createFailureResult('Missing required parameter: target');
      }
      
      const target = this.getParam(config, 'target', '');
      const options = this.getParam(config, 'options', {});
      
      // Execute with retry logic if enabled
      return await this.executeWithRetry(async () => {
        // Your custom action logic here
        const result = await this.performCustomAction(target, options);
        
        return this.createSuccessResult(
          `Custom action completed successfully for ${target}`,
          { target, result, executedAt: new Date() }
        );
      }, config, context);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logError('Failed to execute custom action', error);
      return this.createFailureResult(`Custom action failed: ${errorMessage}`);
    }
  }
  
  /**
   * Get event configuration schema
   */
  public getEventConfigSchema(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          const: 'my-custom-action'
        },
        params: {
          $ref: '#/definitions/MyCustomActionParams'
        },
        enabled: {
          type: 'boolean',
          default: true
        },
        options: {
          type: 'object',
          properties: {
            timeout: {
              type: 'number',
              minimum: 1000,
              maximum: 300000,
              default: 30000
            },
            retry: {
              type: 'boolean',
              default: true
            }
          }
        }
      },
      required: ['type', 'params'],
      definitions: {
        MyCustomActionParams: {
          type: 'object',
          properties: {
            target: {
              type: 'string',
              title: 'Target',
              description: 'Target for the custom action',
              minLength: 1
            },
            options: {
              type: 'object',
              title: 'Options',
              description: 'Additional options for the action',
              additionalProperties: true,
              default: {}
            }
          },
          required: ['target']
        }
      }
    };
  }
  
  /**
   * Get event parameter schema
   */
  public getEventParamsSchema(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          title: 'Target',
          description: 'Target for the custom action',
          minLength: 1
        },
        options: {
          type: 'object',
          title: 'Options',
          description: 'Additional options for the action',
          additionalProperties: true,
          default: {}
        }
      },
      required: ['target'],
      additionalProperties: false
    };
  }
  
  /**
   * Validate event-specific configuration
   */
  protected async validateCustomConfig(config: EventConfig): Promise<boolean> {
    if (!this.validateRequiredParams(config, ['target'])) {
      return false;
    }
    
    // Add custom validation logic here
    return true;
  }
  
  /**
   * Check if this event can be executed safely
   */
  public async canExecute(config: EventConfig, context: EventContext): Promise<boolean> {
    if (!this.isEventEnabled(config)) {
      return false;
    }
    
    // Add safety checks here
    return true;
  }
  
  /**
   * Your custom action implementation
   */
  private async performCustomAction(target: string, options: any): Promise<any> {
    // Implement your custom action logic here
    this.logInfo(`Performing custom action on target: ${target}`);
    
    // Placeholder implementation
    return { success: true, target, timestamp: new Date() };
  }
  
  /**
   * Estimate execution time for this event
   */
  public getEstimatedExecutionTime(config: EventConfig): number {
    return 5000; // 5 seconds estimate
  }
  
  /**
   * Check if this event requires elevated privileges
   */
  public requiresElevatedPrivileges(config: EventConfig): boolean {
    return false; // Change based on your action requirements
  }
}
```

## Built-in Plugin Examples

### Available Trigger Plugins

1. **CronTriggerPlugin** (`cron`): Time-based scheduling using CRON expressions
2. **ManualTriggerPlugin** (`manual`): Manual execution by users
3. **WebhookTriggerPlugin** (`webhook`): HTTP webhook-based triggers

### Available Event Plugins

1. **LogMessageEventPlugin** (`log-message`): Log messages to operation log
2. **RestartContainerEventPlugin** (`restart-container`): Restart Docker containers
3. **DiscoverContainersEventPlugin** (`discover-containers`): Discover containers on hosts
4. **CheckContainerUpdatesEventPlugin** (`check-container-updates`): Check for container updates

## Plugin Registration

### Manual Registration

```typescript
import { PluginRegistry } from './plugins/registry/plugin-registry.service';

// In your module or service
await pluginRegistry.registerPlugin({
  metadata: {
    id: 'my-custom-plugin',
    name: 'My Custom Plugin',
    description: 'Description of what it does',
    version: '1.0.0',
    author: 'Your Name',
    tags: ['custom'],
    enabled: true
  },
  pluginClass: MyCustomPlugin,
  config: {
    // Plugin-specific configuration
  }
});
```

### Automatic Registration via DI

Add your plugin to the module providers:

```typescript
@Module({
  providers: [
    // ... other providers
    MyCustomTriggerPlugin,
    MyCustomEventPlugin,
  ],
})
export class AutomationsModule {}
```

## Testing Plugins

### Unit Testing

```typescript
import { Test } from '@nestjs/testing';
import { MyCustomTriggerPlugin } from './my-custom-trigger.plugin';

describe('MyCustomTriggerPlugin', () => {
  let plugin: MyCustomTriggerPlugin;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [MyCustomTriggerPlugin],
    }).compile();

    plugin = module.get<MyCustomTriggerPlugin>(MyCustomTriggerPlugin);
  });

  it('should be defined', () => {
    expect(plugin).toBeDefined();
  });

  it('should evaluate trigger correctly', async () => {
    const config = {
      type: 'my-custom',
      config: {
        myParameter: 'test-value',
        threshold: 50
      },
      enabled: true
    };

    const context = {
      timestamp: new Date(),
      facts: { testFact: 'value' },
      metadata: {}
    };

    const result = await plugin.evaluate(config, context);
    
    expect(result).toBeDefined();
    expect(result.shouldTrigger).toBe(false); // Adjust based on your logic
  });
});
```

### Integration Testing

Test your plugins within the automation system:

```typescript
describe('Plugin Integration', () => {
  let automationEngine: AutomationEngine;
  let pluginRegistry: PluginRegistry;

  beforeEach(async () => {
    // Setup test module with your plugins
  });

  it('should register and execute plugin correctly', async () => {
    // Register your plugin
    await pluginRegistry.registerPlugin({
      metadata: { /* ... */ },
      pluginClass: MyCustomPlugin
    });

    // Test rule evaluation with your plugin
    const rule = {
      id: 'test-rule',
      name: 'Test Rule',
      isEnabled: true,
      triggers: [{ type: 'my-custom', config: { /* ... */ }, enabled: true }],
      events: [{ type: 'my-custom-action', params: { /* ... */ }, enabled: true }]
    };

    const result = await automationEngine.evaluateRule(rule, { /* facts */ });
    
    expect(result).toBeDefined();
    // Assert expected behavior
  });
});
```

## Best Practices

### 1. Error Handling

- Always wrap plugin logic in try-catch blocks
- Return appropriate error results instead of throwing exceptions
- Use the built-in logging methods (`logInfo`, `logError`, etc.)
- Provide meaningful error messages and reasons

### 2. Configuration Validation

- Implement thorough configuration validation
- Use JSON Schema for configuration schemas
- Validate required parameters and their types
- Provide default values where appropriate

### 3. Performance

- Implement `getNextEvaluationTime()` for triggers to optimize evaluation
- Use `getEstimatedExecutionTime()` for events to help with scheduling
- Avoid blocking operations in trigger evaluation
- Use async/await for all I/O operations

### 4. Security

- Implement `canExecute()` checks for events
- Use `requiresElevatedPrivileges()` to indicate permission requirements
- Validate all input parameters for security issues
- Never expose sensitive information in logs or error messages

### 5. Documentation

- Provide clear descriptions and examples
- Document all configuration parameters
- Include usage examples in comments
- Specify dependencies and requirements

## Advanced Features

### Plugin Dependencies

```typescript
export class MyAdvancedPlugin extends BasePlugin {
  public readonly dependencies = ['other-plugin-id'];
  
  async initialize(): Promise<void> {
    const dependency = this.pluginRegistry.getPlugin('other-plugin-id');
    if (!dependency) {
      throw new Error('Required dependency not found');
    }
    
    await super.initialize();
  }
}
```

### Dynamic Configuration

```typescript
public async validateConfig(config: any): Promise<boolean> {
  // Validate against external services or dynamic requirements
  const isValid = await this.validateAgainstExternalService(config);
  return isValid && await super.validateConfig(config);
}
```

### Plugin Lifecycle Hooks

```typescript
async initialize(): Promise<void> {
  await super.initialize();
  
  // Setup resources, connections, etc.
  this.setupResources();
}

async cleanup(): Promise<void> {
  // Cleanup resources, close connections, etc.
  this.cleanupResources();
  
  await super.cleanup();
}
```

## Troubleshooting

### Common Issues

1. **Plugin Not Registered**: Check module providers and registration
2. **Configuration Validation Fails**: Review schema and required fields
3. **Plugin Not Triggering**: Check trigger logic and evaluation conditions
4. **Event Execution Fails**: Verify parameters and error handling

### Debugging

- Enable debug logging: `this.logDebug('Debug message')`
- Use operation logs for event debugging
- Test plugins in isolation before integration
- Check plugin registry status: `pluginRegistry.getPluginSummary()`

### Log Analysis

```typescript
// In your plugin
this.logInfo('Plugin execution started');
this.logDebug('Configuration:', JSON.stringify(config));
this.logWarn('Non-critical issue detected');
this.logError('Critical error occurred', error);
```

This comprehensive guide should help you create robust and well-integrated plugins for the automation system. Remember to follow the established patterns and best practices for consistency and maintainability.