# FRP API Specification

## Overview

This document provides detailed API specifications for the FRP (Fast Reverse Proxy) Two-Phase Sync System. All endpoints are RESTful and return JSON responses.

## Base URL

```
/api/v1/frp
```

## Authentication

All endpoints require authentication. Use the same authentication mechanism as other API endpoints in the system.

## Endpoints

### 1. Get FRP Configurations

Retrieve all FRP configurations including FRPS configs and FRPC proxies.

**Endpoint**: `GET /api/v1/frp/configs`

**Parameters**: None

**Response**:
```json
{
  "frpsConfigs": [
    {
      "id": "frps-config-1",
      "hostId": "host-1",
      "containerId": "container-1",
      "bindPort": 7000,
      "vhostHttpPort": 8080,
      "vhostHttpsPort": 8443,
      "subdomainHost": "example.com",
      "rawConfig": {...},
      "lastSyncedAt": "2024-01-15T10:30:00Z",
      "proxies": [...]
    }
  ],
  "frpcProxies": [
    {
      "id": "frpc-proxy-1",
      "hostId": "host-2",
      "containerId": "container-2",
      "frpsConfigId": "frps-config-1",
      "name": "web",
      "type": "http",
      "localIp": "127.0.0.1",
      "localPort": 80,
      "remotePort": 8080,
      "subdomain": "web",
      "customDomains": [],
      "syncStatus": "linked",
      "pendingServerAddr": "192.168.1.100",
      "pendingServerPort": 7000,
      "lastLinkAttempt": "2024-01-15T10:30:00Z",
      "linkErrorMessage": null,
      "rawConfig": {...},
      "lastSyncedAt": "2024-01-15T10:30:00Z"
    }
  ]
}
```

**Status Codes**:
- `200 OK`: Success
- `500 Internal Server Error`: Server error

### 2. Sync FRP from Host

Trigger FRP synchronization for a specific host (parse phase only).

**Endpoint**: `POST /api/v1/frp/sync/:hostId`

**Parameters**:
- `hostId` (path): Host identifier

**Response**:
```json
{
  "message": "FRP sync initiated for host host-1"
}
```

**Status Codes**:
- `202 Accepted`: Sync initiated successfully
- `404 Not Found`: Host not found
- `500 Internal Server Error`: Server error

**Notes**:
- This endpoint runs asynchronously
- Only performs parse phase (no dependency resolution)
- Use WebSocket or polling to monitor progress

### 3. Resolve FRP Dependencies

Manually trigger global FRP dependency resolution.

**Endpoint**: `POST /api/v1/frp/resolve-dependencies`

**Parameters**: None

**Response**:
```json
{
  "message": "FRP dependency resolution initiated"
}
```

**Status Codes**:
- `202 Accepted`: Resolution initiated successfully
- `500 Internal Server Error`: Server error

**Notes**:
- Processes all pending FRPC proxies
- Links them to appropriate FRPS configs
- Runs asynchronously

### 4. Get FRP Health Status

Get current FRP topology health status.

**Endpoint**: `GET /api/v1/frp/health`

**Parameters**: None

**Response**:
```json
{
  "totalFrpcProxies": 10,
  "linkedProxies": 8,
  "pendingProxies": 1,
  "failedProxies": 1,
  "orphanedProxies": 0,
  "issues": [
    "1 FRPC proxies failed to link to FRPS configs",
    "1 FRPC proxies have been pending for over 1 hour"
  ],
  "isHealthy": false
}
```

**Status Codes**:
- `200 OK`: Success
- `500 Internal Server Error`: Server error

**Health Indicators**:
- `isHealthy`: `true` if no issues detected
- `issues`: Array of human-readable issue descriptions

### 5. Heal FRP Relationships

Trigger automatic healing for broken FRP relationships.

**Endpoint**: `POST /api/v1/frp/heal`

**Parameters**: None

**Response**:
```json
{
  "message": "FRP relationship healing initiated"
}
```

**Status Codes**:
- `202 Accepted`: Healing initiated successfully
- `500 Internal Server Error`: Server error

**Notes**:
- Retries failed FRPC proxies
- Cleans up orphaned proxies
- Runs asynchronously

### 6. Get FRP Metrics

Get comprehensive FRP sync metrics and statistics.

**Endpoint**: `GET /api/v1/frp/metrics`

**Parameters**: None

**Response**:
```json
{
  "overview": {
    "totalFrpsConfigs": 3,
    "totalFrpcProxies": 10,
    "healthyProxies": 8,
    "unhealthyProxies": 2,
    "healthPercentage": 80
  },
  "syncStatus": {
    "linked": 8,
    "pending": 1,
    "failed": 1
  },
  "recentActivity": {
    "lastSyncTime": "2024-01-15T10:30:00Z",
    "syncFrequency": "On container discovery",
    "recentErrors": [
      {
        "proxyName": "web-proxy",
        "errorMessage": "FRPS config not found",
        "timestamp": "2024-01-15T10:25:00Z"
      }
    ]
  },
  "performance": {
    "successRate": 89,
    "stalePendingCount": 0
  }
}
```

**Status Codes**:
- `200 OK`: Success
- `500 Internal Server Error`: Server error

### 7. Get FRP Sync Logs

Get detailed FRP sync logs for debugging.

**Endpoint**: `GET /api/v1/frp/logs`

**Parameters**:
- `limit` (query, optional): Number of log entries to return (default: 50, max: 200)

**Response**:
```json
[
  {
    "id": "op-log-1",
    "title": "FRP Sync from host-1",
    "status": "COMPLETED",
    "createdAt": "2024-01-15T10:30:00Z",
    "completedAt": "2024-01-15T10:30:05Z",
    "duration": 5000,
    "entries": [
      {
        "level": "info",
        "message": "Starting FRP sync for host host-1",
        "timestamp": "2024-01-15T10:30:00Z",
        "hostId": "host-1"
      },
      {
        "level": "system",
        "message": "Found 2 FRP containers",
        "timestamp": "2024-01-15T10:30:01Z",
        "hostId": "host-1"
      }
    ]
  }
]
```

**Status Codes**:
- `200 OK`: Success
- `400 Bad Request`: Invalid limit parameter
- `500 Internal Server Error`: Server error

## Data Models

### FrpsConfig

```typescript
interface FrpsConfig {
  id: string;
  hostId: string;
  containerId: string;
  bindPort?: number;
  vhostHttpPort?: number;
  vhostHttpsPort?: number;
  subdomainHost?: string;
  rawConfig?: object;
  lastSyncedAt?: string;
  proxies?: FrpcProxy[];
}
```

### FrpcProxy

```typescript
interface FrpcProxy {
  id: string;
  hostId: string;
  containerId: string;
  frpsConfigId?: string;
  name: string;
  type: string;
  localIp: string;
  localPort: number;
  remotePort: number;
  subdomain?: string;
  customDomains: string[];
  rawConfig?: object;
  lastSyncedAt?: string;
  
  // Two-phase sync fields
  syncStatus: 'pending' | 'linked' | 'failed';
  pendingServerAddr?: string;
  pendingServerPort?: number;
  lastLinkAttempt?: string;
  linkErrorMessage?: string;
}
```

### Health Status

```typescript
interface HealthStatus {
  totalFrpcProxies: number;
  linkedProxies: number;
  pendingProxies: number;
  failedProxies: number;
  orphanedProxies: number;
  issues: string[];
  isHealthy: boolean;
}
```

### Metrics

```typescript
interface Metrics {
  overview: {
    totalFrpsConfigs: number;
    totalFrpcProxies: number;
    healthyProxies: number;
    unhealthyProxies: number;
    healthPercentage: number;
  };
  syncStatus: {
    linked: number;
    pending: number;
    failed: number;
  };
  recentActivity: {
    lastSyncTime?: string;
    syncFrequency: string;
    recentErrors: Array<{
      proxyName: string;
      errorMessage: string;
      timestamp: string;
    }>;
  };
  performance: {
    successRate: number;
    stalePendingCount: number;
  };
}
```

## Error Handling

### Standard Error Response

```json
{
  "error": {
    "code": "FRP_SYNC_ERROR",
    "message": "Failed to sync FRP configuration",
    "details": {
      "hostId": "host-1",
      "reason": "SSH connection failed"
    }
  }
}
```

### Common Error Codes

- `FRP_SYNC_ERROR`: General FRP sync failure
- `HOST_NOT_FOUND`: Specified host does not exist
- `INVALID_CONFIGURATION`: FRP configuration is invalid
- `DEPENDENCY_RESOLUTION_FAILED`: Failed to resolve dependencies
- `HEALING_FAILED`: Healing operation failed

## Rate Limiting

- All endpoints are subject to standard API rate limiting
- Sync operations (`POST` endpoints) have additional throttling
- Maximum 10 sync operations per minute per host

## WebSocket Events

For real-time updates, subscribe to these WebSocket events:

### FRP Sync Events

```typescript
// Join task to receive updates
socket.emit('joinTask', { taskId: 'frp-sync-task-id' });

// Receive updates
socket.on('task:frp-sync-task-id', (data) => {
  // data.level: 'info' | 'error' | 'system'
  // data.message: Log message
  // data.timestamp: ISO timestamp
});
```

## Usage Examples

### JavaScript/TypeScript

```typescript
// Get FRP health status
const response = await fetch('/api/v1/frp/health');
const health = await response.json();

if (!health.isHealthy) {
  console.log('FRP issues detected:', health.issues);
  
  // Trigger healing
  await fetch('/api/v1/frp/heal', { method: 'POST' });
}

// Get detailed metrics
const metricsResponse = await fetch('/api/v1/frp/metrics');
const metrics = await metricsResponse.json();

console.log(`FRP Health: ${metrics.overview.healthPercentage}%`);
```

### cURL

```bash
# Get FRP configurations
curl -X GET /api/v1/frp/configs

# Trigger sync for specific host
curl -X POST /api/v1/frp/sync/host-1

# Check health status
curl -X GET /api/v1/frp/health

# Trigger dependency resolution
curl -X POST /api/v1/frp/resolve-dependencies

# Get sync logs
curl -X GET "/api/v1/frp/logs?limit=20"
```

## Migration Notes

### Breaking Changes

1. **Sync Behavior**: Individual host sync now only performs parse phase
2. **Dependency Resolution**: Must be triggered separately after batch operations
3. **Status Field**: New `syncStatus` field replaces implicit status checking

### Backward Compatibility

- Existing API endpoints remain functional
- New fields are optional and backward compatible
- Old sync behavior available via migration scripts

### Migration Steps

1. Run data migration script to fix existing relationships
2. Update client code to use new dependency resolution flow
3. Monitor health endpoints for topology issues
4. Use healing endpoints for automatic recovery
