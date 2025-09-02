# Activity Log API Documentation

## Overview

The Activity Log system provides comprehensive tracking and monitoring of all system activities across the selfhost-serv-agent platform. It captures events from host management, container operations, FRP configurations, reverse proxy changes, and automation executions.

## Data Model

### ActivityLog

```typescript
interface ActivityLog {
  id: string;
  timestamp: string;
  category: ActivityCategory;
  action: string;
  resourceType: string;
  resourceId?: string;
  resourceName?: string;
  hostId?: string;
  hostName?: string;
  title: string;
  description?: string;
  metadata?: any;
  oldValues?: any;
  newValues?: any;
  host?: {
    name: string;
    address: string;
  };
}
```

### ActivityCategory

```typescript
enum ActivityCategory {
  HOST_MANAGEMENT = 'HOST_MANAGEMENT',
  CONTAINER_LIFECYCLE = 'CONTAINER_LIFECYCLE',
  CONTAINER_UPDATE = 'CONTAINER_UPDATE',
  COMPOSE_OPERATION = 'COMPOSE_OPERATION',
  FRP_CONFIGURATION = 'FRP_CONFIGURATION',
  REVERSE_PROXY = 'REVERSE_PROXY',
  SYSTEM_OPERATION = 'SYSTEM_OPERATION',
  AUTOMATION = 'AUTOMATION'
}
```

## API Endpoints

### GET /api/v1/activity-logs

Retrieve activity logs with filtering and pagination.

**Query Parameters:**
- `category` (optional): Filter by activity category
- `resourceType` (optional): Filter by resource type
- `hostId` (optional): Filter by host ID
- `action` (optional): Filter by action type
- `startDate` (optional): Filter activities after this date (ISO string)
- `endDate` (optional): Filter activities before this date (ISO string)
- `limit` (optional): Number of results per page (default: 50, max: 100)
- `offset` (optional): Number of results to skip (default: 0)
- `search` (optional): Search in title, description, resource name, and host name

**Response:**
```json
{
  "items": [
    {
      "id": "clx1234567890",
      "timestamp": "2024-01-15T14:30:25.000Z",
      "category": "CONTAINER_LIFECYCLE",
      "action": "restarted",
      "resourceType": "container",
      "resourceId": "container-abc123",
      "resourceName": "nginx",
      "hostId": "host-xyz789",
      "hostName": "web-server-01",
      "title": "Container 'nginx' restarted",
      "description": "CLI container restarted",
      "metadata": {
        "isComposeManaged": false,
        "imageName": "nginx",
        "imageTag": "latest"
      },
      "host": {
        "name": "web-server-01",
        "address": "192.168.1.100"
      }
    }
  ],
  "total": 150,
  "hasMore": true
}
```

### GET /api/v1/activity-logs/recent

Get recent activity logs for dashboard display.

**Query Parameters:**
- `limit` (optional): Number of recent activities to return (default: 10)

**Response:**
```json
[
  {
    "id": "clx1234567890",
    "timestamp": "2024-01-15T14:30:25.000Z",
    "category": "HOST_MANAGEMENT",
    "action": "created",
    "title": "Host 'web-server-02' created",
    "description": "New host added: 192.168.1.101:22 (ubuntu)",
    "hostName": "web-server-02"
  }
]
```

### GET /api/v1/activity-logs/stats

Get activity statistics for analytics.

**Query Parameters:**
- `hostId` (optional): Filter statistics by host
- `days` (optional): Number of days to include in statistics (default: 7)

**Response:**
```json
{
  "total": 245,
  "byCategory": [
    {
      "category": "CONTAINER_LIFECYCLE",
      "count": 120
    },
    {
      "category": "HOST_MANAGEMENT",
      "count": 45
    }
  ],
  "byAction": [
    {
      "action": "restarted",
      "count": 85
    },
    {
      "action": "updated",
      "count": 60
    }
  ]
}
```

### GET /api/v1/activity-logs/resource/:resourceType/:resourceId

Get activity logs for a specific resource.

**Path Parameters:**
- `resourceType`: Type of resource (e.g., 'host', 'container', 'frps_config')
- `resourceId`: ID of the resource

**Query Parameters:**
- `limit` (optional): Number of activities to return (default: 20)

**Response:**
```json
[
  {
    "id": "clx1234567890",
    "timestamp": "2024-01-15T14:30:25.000Z",
    "category": "CONTAINER_LIFECYCLE",
    "action": "started",
    "title": "Container 'nginx' started",
    "resourceType": "container",
    "resourceId": "container-abc123"
  }
]
```

### POST /api/v1/activity-logs/cleanup

Manually trigger activity log cleanup.

**Request Body:**
```json
{
  "retentionDays": 30
}
```

**Response:**
```json
{
  "count": 125,
  "retentionDays": 30
}
```

### GET /api/v1/activity-logs/cleanup/stats

Get cleanup statistics and information.

**Response:**
```json
{
  "totalEntries": 1500,
  "entriesOlderThan30Days": 200,
  "entriesOlderThan90Days": 50,
  "oldestEntry": "2023-06-15T10:20:30.000Z",
  "newestEntry": "2024-01-15T14:30:25.000Z"
}
```

## WebSocket Events

### Subscribing to Activity Updates

**Event:** `joinActivityLog`
**Payload:**
```json
{
  "hostId": "host-xyz789" // optional, for host-specific updates
}
```

### Receiving Activity History

**Event:** `activity.history`
**Payload:**
```json
{
  "activities": [
    // Array of recent ActivityLog objects
  ]
}
```

### Receiving New Activities

**Event:** `activity.new`
**Payload:**
```json
{
  // Single ActivityLog object
  "id": "clx1234567890",
  "timestamp": "2024-01-15T14:30:25.000Z",
  "category": "CONTAINER_LIFECYCLE",
  "action": "started",
  "title": "Container 'nginx' started"
}
```

### Unsubscribing from Activity Updates

**Event:** `leaveActivityLog`
**Payload:**
```json
{
  "hostId": "host-xyz789" // optional, should match the join request
}
```

## Activity Categories and Actions

### HOST_MANAGEMENT
- **Actions:** `created`, `updated`, `deleted`, `connection_test_success`, `connection_test_failed`
- **Resources:** Host configurations, SSH connections

### CONTAINER_LIFECYCLE
- **Actions:** `discovered`, `started`, `stopped`, `restarted`, `state_changed`
- **Resources:** Docker containers, container state changes

### CONTAINER_UPDATE
- **Actions:** `updated`, `pull`, `rollback`
- **Resources:** Container image updates, version changes

### COMPOSE_OPERATION
- **Actions:** `up`, `down`, `restart`, `pull`, `build`
- **Resources:** Docker Compose projects and services

### FRP_CONFIGURATION
- **Actions:** `frps_config_synced`, `frpc_proxy_synced`
- **Resources:** FRP server configurations, proxy rules

### REVERSE_PROXY
- **Actions:** `route_created`, `route_updated`, `route_deleted`, `route_synced`
- **Resources:** Nginx Proxy Manager routes

### SYSTEM_OPERATION
- **Actions:** `backup_created`, `maintenance_started`, `maintenance_completed`
- **Resources:** System-level operations

### AUTOMATION
- **Actions:** `rule_executed`, `rule_created`, `rule_updated`, `rule_deleted`
- **Resources:** Automation rules and executions

## Configuration

Activity log behavior can be configured through the settings API:

```json
{
  "activityLogRetentionDays": 30,
  "activityLogCleanupEnabled": true
}
```

## Scheduled Tasks

- **Daily Cleanup:** Runs at 2:00 AM daily, removes entries older than configured retention period
- **Weekly Statistics Cleanup:** Runs on Sundays at 3:00 AM, removes entries older than 90 days regardless of settings

## Error Handling

All API endpoints return standard HTTP status codes:
- `200`: Success
- `400`: Bad Request (invalid parameters)
- `500`: Internal Server Error

Error responses include a descriptive message:
```json
{
  "error": "Invalid date format for startDate parameter",
  "statusCode": 400
}
```
