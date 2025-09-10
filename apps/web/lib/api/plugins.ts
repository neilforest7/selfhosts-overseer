/**
 * Plugin management API client functions
 */

export interface Plugin {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  author?: string;
  tags?: string[];
  dependencies?: string[];
  type: string;
  configSchema?: Record<string, any>;
}

export interface PluginSummary {
  total: number;
  triggers: number;
  events: number;
  enabled: number;
  disabled: number;
}

export interface TriggerPlugin extends Plugin {
  type: 'trigger';
  triggerType: string;
  configSchema?: Record<string, any>;
  availableConditions?: string[];
  dbPluginId?: string | null; // Database plugin metadata ID for foreign key references
}

export interface EventPlugin extends Plugin {
  type: 'event';
  eventType: string;
  configSchema?: Record<string, any>;
  paramsSchema?: Record<string, any>;
  availableActions?: string[];
  dbPluginId?: string | null; // Database plugin metadata ID for foreign key references
}

/**
 * Fetch all plugins
 */
export async function fetchPlugins(): Promise<Plugin[]> {
  const response = await fetch('/api/v1/plugins');
  if (!response.ok) {
    throw new Error('Failed to fetch plugins');
  }
  return response.json();
}

/**
 * Fetch plugin summary
 */
export async function fetchPluginSummary(): Promise<PluginSummary> {
  const response = await fetch('/api/v1/plugins/summary');
  if (!response.ok) {
    throw new Error('Failed to fetch plugin summary');
  }
  return response.json();
}

/**
 * Fetch trigger plugins
 */
export async function fetchTriggerPlugins(): Promise<TriggerPlugin[]> {
  const response = await fetch('/api/v1/plugins/triggers');
  if (!response.ok) {
    throw new Error('Failed to fetch trigger plugins');
  }
  return response.json();
}

/**
 * Fetch event plugins
 */
export async function fetchEventPlugins(): Promise<EventPlugin[]> {
  const response = await fetch('/api/v1/plugins/events');
  if (!response.ok) {
    throw new Error('Failed to fetch event plugins');
  }
  return response.json();
}

/**
 * Fetch single plugin details
 */
export async function fetchPlugin(id: string): Promise<Plugin> {
  const response = await fetch(`/api/v1/plugins/${id}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch plugin ${id}`);
  }
  return response.json();
}

/**
 * Enable/disable a plugin
 */
export async function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
  const response = await fetch(`/api/v1/plugins/${id}/enabled`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ enabled }),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Failed to ${enabled ? 'enable' : 'disable'} plugin`);
  }
}

/**
 * Reload a plugin
 */
export async function reloadPlugin(id: string): Promise<void> {
  const response = await fetch(`/api/v1/plugins/${id}/reload`, {
    method: 'POST',
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to reload plugin');
  }
}

/**
 * Register a new plugin
 */
export async function registerPlugin(registration: any): Promise<void> {
  const response = await fetch('/api/v1/plugins/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(registration),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to register plugin');
  }
}

/**
 * Unregister a plugin
 */
export async function unregisterPlugin(id: string): Promise<void> {
  const response = await fetch(`/api/v1/plugins/${id}`, {
    method: 'DELETE',
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to unregister plugin');
  }
}
