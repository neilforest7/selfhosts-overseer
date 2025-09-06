# API Documentation

## Overview

Self-Host Serv Agent provides a comprehensive REST API and WebSocket interface for managing distributed VPS infrastructure. All API endpoints are prefixed with `/api/v1/` and use JSON for request/response payloads.

**Base URL**: `http://localhost:3001/api/v1/`
**WebSocket URL**: `ws://localhost:3001/`

## Authentication

Currently implements simple authentication without complex RBAC. Future versions may include token-based authentication.

## REST API Endpoints

### Host Management

#### List Hosts
```http
GET /api/v1/hosts
```

**Response:**
```json
{
  "items": [
    {
      "id": "string",
      "name": "string",
      "address": "string",
      "sshUser": "string",
      "port": 22,
      "tags": ["string"],
      "role": "local|remote",
      "status": "ONLINE|OFFLINE|UNKNOWN",
      "lastOnlineAt": "2024-01-01T00:00:00Z",
      "lastOfflineAt": "2024-01-01T00:00:00Z",
      "lastConnectivityCheck": "2024-01-01T00:00:00Z",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

#### Create Host
```http
POST /api/v1/hosts
```

**Request Body:**
```json
{
  "name": "string",
  "address": "string",
  "sshUser": "string",
  "port": 22,
  "tags": ["string"],
  "sshAuthMethod": "password|privateKey",
  "sshPassword": "string",
  "sshPrivateKey": "string",
  "sshPrivateKeyPassphrase": "string",
  "role": "local|remote"
}
```

#### Update Host
```http
PATCH /api/v1/hosts/:id
```

#### Delete Host
```http
DELETE /api/v1/hosts/:id
```

#### Test Connection
```http
POST /api/v1/hosts/:id/test-connection
```

**Response:**
```json
{
  "success": true,
  "message": "Connection successful",
  "latency": 123
}
```

#### Get Connectivity History
```http
GET /api/v1/hosts/:id/connectivity-history
```

### Container Management

#### List Containers
```http
GET /api/v1/containers?hostId=string&hostName=string&q=string&updateAvailable=boolean&composeManaged=boolean
```

**Response:**
```json
{
  "items": [
    {
      "id": "string",
      "hostId": "string",
      "containerId": "string",
      "name": "string",
      "state": "string",
      "status": "string",
      "restartCount": 0,
      "imageName": "string",
      "imageTag": "string",
      "repoDigest": "string",
      "remoteDigest": "string",
      "updateAvailable": false,
      "updateCheckedAt": "2024-01-01T00:00:00Z",
      // 新增镜像状态跟踪字段
      "containerImageDigest": "sha256:abc123...",
      "containerImageId": "sha256:def456...",
      "containerImageCreated": "2024-01-01T00:00:00Z",
      "localImageDigest": "sha256:ghi789...",
      "localImageId": "sha256:jkl012...",
      "localImageCreated": "2024-01-01T00:00:00Z",
      "imageUpdateStatus": "UP_TO_DATE|CONTAINER_OUTDATED|IMAGE_OUTDATED|BOTH_OUTDATED|UNKNOWN",
      // 其他字段
      "createdAt": "2024-01-01T00:00:00Z",
      "startedAt": "2024-01-01T00:00:00Z",
      "isComposeManaged": false,
      "composeProject": "string",
      "composeService": "string",
      "composeWorkingDir": "string",
      "ports": {},
      "mounts": {},
      "networks": {},
      "labels": {}
    }
  ]
}
```

#### Discover Containers
```http
POST /api/v1/containers/discover
```

**Request Body:**
```json
{
  "hostIds": ["string"] // or "all"
}
```

**Response:**
```json
{
  "taskId": "string"
}
```

#### Check Container Updates
```http
POST /api/v1/containers/check-updates
```

**镜像状态说明：**

新的容器镜像状态跟踪系统提供了更精确的更新检测：

- **`containerImageDigest`**: 容器实际运行的镜像摘要
- **`localImageDigest`**: 本地最新镜像摘要
- **`remoteDigest`**: 远程最新镜像摘要
- **`imageUpdateStatus`**: 综合状态枚举
  - `UP_TO_DATE`: 容器和镜像都是最新版本
  - `CONTAINER_OUTDATED`: 本地镜像已更新，但容器仍使用旧版本（需重启）
  - `IMAGE_OUTDATED`: 远程有新版本，但本地未拉取（需拉取）
  - `BOTH_OUTDATED`: 远程有新版本，且容器也未使用最新本地镜像（需拉取+重启）
  - `UNKNOWN`: 状态未知或检测失败

**操作建议：**
- `CONTAINER_OUTDATED`: 只需重启容器
- `IMAGE_OUTDATED`: 只需拉取镜像
- `BOTH_OUTDATED`: 需要先拉取镜像，再重启容器

#### Update Container
```http
POST /api/v1/containers/:id/update
```

#### Restart Container
```http
POST /api/v1/containers/:id/restart
```

#### Compose Operations
```http
POST /api/v1/containers/compose/operate
```

**Request Body:**
```json
{
  "operation": "start|stop|restart|pull|up",
  "hostId": "string",
  "project": "string",
  "service": "string"
}
```

#### Registry API Management

#### Get Registry Health
```http
GET /api/v1/containers/registry/health
```

**Response:**
```json
{
  "healthy": true,
  "details": {
    "tokenCacheSize": 3,
    "lastTokenCheck": "2024-01-01T00:00:00Z",
    "registryUrl": "https://registry-1.docker.io/v2"
  }
}
```

#### Get Registry Statistics
```http
GET /api/v1/containers/registry/stats
```

**Response:**
```json
{
  "tokenCacheSize": 3,
  "cachedTokens": [
    {
      "scope": "repository:nginx:pull",
      "expiresAt": "2024-01-01T01:00:00Z",
      "expiresIn": 3600
    }
  ]
}
```

#### Perform Registry Maintenance
```http
POST /api/v1/containers/registry/maintenance
```

**Response:** 204 No Content

#### Test Registry API
```http
POST /api/v1/containers/registry/test/{imageRef}
```

**Response:**
```json
{
  "success": true,
  "imageRef": "nginx:latest",
  "digest": "sha256:abcd1234...",
  "error": null,
  "rateLimited": false
}
```

#### Diagnose Registry Connectivity
```http
POST /api/v1/containers/registry/diagnose
```

**Response:**
```json
{
  "success": true,
  "diagnostics": {
    "proxyTest": {
      "success": true,
      "latency": 1500
    },
    "directTest": {
      "success": false,
      "error": "Connection timeout"
    },
    "dnsTest": {
      "success": true,
      "resolvedIPs": ["104.244.46.52", "104.244.46.53"]
    },
    "recommendations": [
      "Direct connection failed but proxy works - network may require proxy"
    ]
  },
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### Task Execution

#### Execute Command
```http
POST /api/v1/tasks/exec
```

**Request Body:**
```json
{
  "command": "string",
  "targets": ["hostId1", "hostId2"] // or "all"
}
```

**Response:**
```json
{
  "taskId": "string"
}
```

### Operation Logs

#### List Operations
```http
GET /api/v1/operations?page=1&limit=50&status=string&type=string
```

#### Get Operation Details
```http
GET /api/v1/operations/:id
```

**Response:**
```json
{
  "id": "string",
  "type": "string",
  "status": "PENDING|RUNNING|COMPLETED|ERROR",
  "startedAt": "2024-01-01T00:00:00Z",
  "finishedAt": "2024-01-01T00:00:00Z",
  "automationRuleId": "string",
  "entries": [
    {
      "id": "string",
      "timestamp": "2024-01-01T00:00:00Z",
      "stream": "stdout|stderr|system|info|error",
      "content": "string",
      "hostId": "string"
    }
  ]
}
```

### Automation Rules

#### List Automation Rules
```http
GET /api/v1/automations
```

#### Create Automation Rule
```http
POST /api/v1/automations
```

**Request Body:**
```json
{
  "name": "string",
  "description": "string",
  "isEnabled": true,
  "ruleJson": {
    "conditions": {
      "all": [
        {
          "fact": "containerStatus",
          "operator": "equal",
          "value": "exited",
          "params": {
            "containerName": "my-app"
          }
        }
      ]
    },
    "event": {
      "type": "restart-container",
      "params": {
        "containerId": "container-id"
      }
    }
  }
}
```

#### Update Automation Rule
```http
PATCH /api/v1/automations/:id
```

#### Delete Automation Rule
```http
DELETE /api/v1/automations/:id
```

#### Execute Automation Rule
```http
POST /api/v1/automations/:id/run
```

### Logs

#### Get Application Logs
```http
GET /api/v1/logs/application?limit=200
```

#### Get System Logs
```http
GET /api/v1/logs/system?lines=100
```

#### Get Docker Logs
```http
GET /api/v1/logs/docker?lines=100
```

### Network Topology

#### Get Topology Data
```http
GET /api/v1/topology/graph-data
```

**Response:**
```json
{
  "nodes": [
    {
      "data": {
        "id": "string",
        "label": "string",
        "type": "host|container|domain|remote-port",
        "parent": "string",
        "metadata": {}
      }
    }
  ],
  "edges": [
    {
      "data": {
        "id": "string",
        "source": "string",
        "target": "string",
        "label": "string",
        "type": "string"
      }
    }
  ]
}
```

### Reverse Proxy

#### Get Reverse Proxy Routes
```http
GET /api/v1/reverse-proxy/routes?hostId=string
```

#### Get Certificates
```http
GET /api/v1/certificates
```

### DNS Management

#### List DNS Providers
```http
GET /api/v1/dns/providers
```

#### Get Available Providers
```http
GET /api/v1/dns/providers/available
```

#### Get Single DNS Provider
```http
GET /api/v1/dns/providers/:id
```

#### Create DNS Provider
```http
POST /api/v1/dns/providers
```

**Request Body:**
```json
{
  "name": "cloudflare",
  "displayName": "Cloudflare",
  "isEnabled": true,
  "apiConfig": {
    "apiToken": "your-api-token",
    "email": "your-email@example.com"
  },
  "rateLimitPerMinute": 60,
  "timeoutSeconds": 30
}
```

#### Update DNS Provider
```http
PUT /api/v1/dns/providers/:id
```

#### Delete DNS Provider
```http
DELETE /api/v1/dns/providers/:id
```

#### Test DNS Provider Connection
```http
POST /api/v1/dns/providers/:id/test
```

**Response:**
```json
{
  "connected": true
}
```

#### Discover DNS Records
```http
POST /api/v1/dns/providers/:id/discover
```

**Request Body:**
```json
{
  "importRecords": false,
  "recordTypes": ["A", "AAAA", "CNAME"],
  "skipExisting": true,
  "updateExisting": false
}
```

#### Get Discovery Stats
```http
GET /api/v1/dns/providers/:id/discovery-stats
```

#### List DNS Records
```http
GET /api/v1/dns/records?providerId=string&isEnabled=boolean&status=string
```

#### Get Single DNS Record
```http
GET /api/v1/dns/records/:id
```

#### Create DNS Record
```http
POST /api/v1/dns/records
```

**Request Body:**
```json
{
  "providerId": "string",
  "domain": "example.com",
  "type": "A",
  "name": "www",
  "value": "192.168.1.1",
  "ttl": 300,
  "priority": 10,
  "isEnabled": true
}
```

#### Update DNS Record
```http
PUT /api/v1/dns/records/:id
```

#### Delete DNS Record
```http
DELETE /api/v1/dns/records/:id
```

#### Resolve DNS Record
```http
POST /api/v1/dns/records/:id/resolve
```

#### Batch Resolve DNS Records
```http
POST /api/v1/dns/records/batch-resolve
```

**Request Body:**
```json
{
  "recordIds": ["id1", "id2"],
  "batchSize": 10
}
```

#### Get Record Resolutions
```http
GET /api/v1/dns/records/:id/resolutions?limit=number
```

#### Get All Resolutions
```http
GET /api/v1/dns/resolutions?hours=number
```

#### Get DNS Stats
```http
GET /api/v1/dns/stats
```

#### Get DNS Health
```http
GET /api/v1/dns/health
```

**Response:**
```json
{
  "status": "healthy",
  "totalRecords": 100,
  "enabledRecords": 95,
  "recordsDue": 5,
  "last24HourSuccess": 90,
  "last24HourFailures": 5,
  "timestamp": "2024-01-01T00:00:00Z"
}
```

#### Cleanup DNS Resolutions
```http
POST /api/v1/dns/cleanup?retentionDays=number
```

### Settings

#### Get Settings
```http
GET /api/v1/settings
```

**Response:**
```json
{
  "sshConcurrency": 30,
  "commandTimeoutSeconds": 100,
  "containerUpdateCheckCron": "45 0 * * *",
  "activityLogRetentionDays": 30,
  "activityLogCleanupEnabled": true,
  "dockerProxyEnabled": false,
  "dockerProxyHost": "",
  "dockerProxyPort": 8080,
  "dockerCredentialsEnabled": false,
  "connectivityCheckInterval": 300,
  "connectivityCheckTimeout": 10,
  "connectivityCheckRetries": 1,
  "connectivityAlertThreshold": 3,
  "connectivityCheckEnabled": true,
  "dnsResolutionFrequencyMinutes": 60,
  "dnsSkipNonAddressRecords": false
}
```

#### Update Settings
```http
PUT /api/v1/settings
```

### Activity Logs

#### List Activity Logs
```http
GET /api/v1/activity-logs?category=string&resourceType=string&hostId=string&action=string&startDate=string&endDate=string&limit=number&offset=number&search=string
```

**Response:**
```json
{
  "items": [
    {
      "id": "string",
      "hostId": "string",
      "category": "string",
      "action": "string",
      "details": "string",
      "metadata": {},
      "timestamp": "2024-01-01T00:00:00Z"
    }
  ]
}
```

#### Get Recent Activity Logs
```http
GET /api/v1/activity-logs/recent?limit=number
```

#### Get Activity Stats
```http
GET /api/v1/activity-logs/stats?hostId=string&days=number
```

#### Get Activity by Resource
```http
GET /api/v1/activity-logs/resource/:resourceType/:resourceId?limit=number
```

#### Run Activity Log Cleanup
```http
POST /api/v1/activity-logs/cleanup
```

**Request Body:**
```json
{
  "retentionDays": 30
}
```

#### Get Cleanup Stats
```http
GET /api/v1/activity-logs/cleanup/stats
```

### Automation Rules (Extended)

#### Get Single Automation Rule
```http
GET /api/v1/automations/:id
```

#### Test Automation Rule
```http
POST /api/v1/automations/:id/test
```

**Request Body:**
```json
{
  "facts": {
    "containerStatus": "exited",
    "hostId": "string"
  }
}
```

### Container Management (Extended)

#### Update Manual Port Mapping
```http
PATCH /api/v1/containers/:id/manual-port
```

**Request Body:**
```json
{
  "manualPortMapping": {
    "hostPort": 8080,
    "containerPort": 80,
    "protocol": "tcp"
  }
}
```

#### Delete Manual Port Mapping
```http
DELETE /api/v1/containers/:id/manual-port
```

#### Check Single Container Update
```http
POST /api/v1/containers/:id/check-update
```

#### Check Compose Updates
```http
POST /api/v1/containers/check-compose-updates
```

**Request Body:**
```json
{
  "hostId": "string",
  "composeProject": "string"
}
```

#### Start Container
```http
POST /api/v1/containers/:id/start
```

**Request Body:**
```json
{
  "host": {
    "id": "string"
  },
  "opId": "string"
}
```

#### Stop Container
```http
POST /api/v1/containers/:id/stop
```

#### Compose Reactivate
```http
POST /api/v1/containers/compose/reactivate
```

**Request Body:**
```json
{
  "hostId": "string",
  "project": "string",
  "workingDir": "string"
}
```

#### Get Compose Down Projects
```http
GET /api/v1/containers/compose/down-projects?hostId=string
```

#### Test Docker Credentials
```http
POST /api/v1/containers/test-credentials
```

**Request Body:**
```json
{
  "username": "string",
  "personalAccessToken": "string"
}
```

### DIUN (Docker Image Update Notifier)

#### DIUN Webhook Handler
```http
POST /diun/notify
```

**Request Body:**
```json
{
  "hostname": "string",
  "entries": []
}
```

#### Check Single Image
```http
POST /diun/check-image
```

**Request Body:**
```json
{
  "image": "nginx:latest"
}
```

### FRP Management (Extended)

#### Resolve FRP Dependencies
```http
POST /api/v1/frp/resolve-dependencies
```

#### Get FRP Health
```http
GET /api/v1/frp/health
```

#### Heal FRP Relationships
```http
POST /api/v1/frp/heal
```

#### Get FRP Metrics
```http
GET /api/v1/frp/metrics
```

#### Get FRP Logs
```http
GET /api/v1/frp/logs?limit=number
```

### Host Management (Extended)

#### Cleanup Orphaned Routes
```http
POST /api/v1/hosts/cleanup/orphaned-routes
```

#### Get Host Connectivity
```http
GET /api/v1/hosts/:id/connectivity?limit=number
```

#### Check Host Connectivity
```http
POST /api/v1/hosts/:id/check-connectivity
```

#### Check All Hosts Connectivity
```http
POST /api/v1/hosts/check-all-connectivity
```

#### Get Connectivity Stats
```http
GET /api/v1/hosts/connectivity/stats
```

### Reverse Proxy (Extended)

#### Sync and Cleanup
```http
POST /api/v1/reverse-proxy/sync-and-cleanup/:hostId
```

#### Cleanup Orphaned Routes
```http
POST /api/v1/reverse-proxy/cleanup/orphaned-routes
```

### Health Check

#### Get Health Status
```http
GET /api/v1/health
```

**Response:**
```json
{
  "ok": true,
  "service": "server",
  "ts": "2024-01-01T00:00:00Z"
}
```

## WebSocket Events

The application uses Socket.IO for real-time communication. Connect to `ws://localhost:3001/` with the `websocket` transport.

### Task Execution Monitoring

#### Join Task Room
```javascript
socket.emit('joinTask', { taskId: 'string' });
```

#### Task Output Events
```javascript
// Listen for task output
socket.on('task:output', (data) => {
  // data: { stream: 'stdout|stderr|system|info|error', content: 'string', hostId?: 'string' }
});

// Listen for task completion
socket.on('task:end', (data) => {
  // data: { taskId: 'string', status: 'completed|failed' }
});
```

### Log Streaming

#### Join Logs Room
```javascript
socket.emit('joinLogs', {
  kind: 'application|system|docker',
  limit: 200
});
```

#### Log Events
```javascript
// Listen for new log lines
socket.on('logs.line', (data) => {
  // data: {
  //   eventId: 'string',
  //   tsNs: 'string',
  //   kind: 'application|system|docker',
  //   stream: 'stdout|stderr',
  //   source: 'string',
  //   content: 'string',
  //   labels: {}
  // }
});

// Listen for replay completion
socket.on('logs.replayEnd', () => {
  // Indicates historical logs have been sent
});
```

### Activity Log Monitoring

#### Join Activity Log Room
```javascript
socket.emit('joinActivityLog', { hostId?: 'string' });
```

#### Activity Events
```javascript
// Listen for activity history
socket.on('activity.history', (data) => {
  // data: { activities: ActivityLog[] }
});

// Listen for new activities
socket.on('activity.new', (data) => {
  // data: ActivityLog
});
```

### Connectivity Monitoring

#### Join Connectivity Room
```javascript
socket.emit('joinConnectivity', { hostId?: 'string' });
```

#### Connectivity Events
```javascript
// Listen for connectivity updates
socket.on('connectivity.update', (data) => {
  // data: {
  //   hostId: 'string',
  //   status: 'ONLINE|OFFLINE|UNKNOWN',
  //   timestamp: 'string',
  //   latency?: number
  // }
});
```

## Error Handling

### HTTP Status Codes

- `200 OK` - Request successful
- `201 Created` - Resource created successfully
- `400 Bad Request` - Invalid request parameters
- `401 Unauthorized` - Authentication required
- `403 Forbidden` - Access denied
- `404 Not Found` - Resource not found
- `409 Conflict` - Resource conflict (e.g., duplicate name)
- `422 Unprocessable Entity` - Validation errors
- `500 Internal Server Error` - Server error

### Error Response Format

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "details": {}
  }
}
```

### Common Error Codes

- `VALIDATION_ERROR` - Request validation failed
- `HOST_NOT_FOUND` - Host does not exist
- `CONNECTION_FAILED` - SSH connection failed
- `CONTAINER_NOT_FOUND` - Container does not exist
- `OPERATION_FAILED` - Operation execution failed
- `AUTOMATION_RULE_INVALID` - Invalid automation rule format
- `SETTINGS_VALIDATION_ERROR` - Settings validation failed

## Rate Limiting

Currently no rate limiting is implemented. Future versions may include rate limiting for API endpoints.

## Pagination

List endpoints support pagination with the following query parameters:

- `page` - Page number (default: 1)
- `limit` - Items per page (default: 50, max: 100)
- `sort` - Sort field
- `order` - Sort order (`asc` or `desc`)

## Filtering

Many list endpoints support filtering with query parameters:

- `q` - General search query
- `status` - Filter by status
- `type` - Filter by type
- `hostId` - Filter by host ID
- `enabled` - Filter by enabled status

## Examples

### Complete Container Discovery Workflow

```javascript
// 1. Start container discovery
const response = await fetch('/api/v1/containers/discover', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ hostIds: ['host-id-1', 'host-id-2'] })
});
const { taskId } = await response.json();

// 2. Monitor progress via WebSocket
const socket = io('ws://localhost:3001');
socket.emit('joinTask', { taskId });

socket.on('task:output', (data) => {
  console.log(`[${data.stream}] ${data.content}`);
});

socket.on('task:end', (data) => {
  console.log(`Task ${data.taskId} completed with status: ${data.status}`);

  // 3. Fetch updated container list
  fetch('/api/v1/containers')
    .then(res => res.json())
    .then(data => console.log('Updated containers:', data.items));
});
```

### Real-time Log Monitoring

```javascript
const socket = io('ws://localhost:3001');

// Join application logs
socket.emit('joinLogs', { kind: 'application', limit: 100 });

// Handle incoming log lines
socket.on('logs.line', (logLine) => {
  const timestamp = new Date(parseInt(logLine.tsNs) / 1000000);
  console.log(`[${timestamp.toISOString()}] ${logLine.content}`);
});

// Switch to system logs
socket.emit('joinLogs', { kind: 'system', limit: 50 });
```

### Automation Rule Creation

```javascript
const automationRule = {
  name: "Restart Failed Containers",
  description: "Automatically restart containers that have exited",
  isEnabled: true,
  ruleJson: {
    conditions: {
      all: [
        {
          fact: "containerStatus",
          operator: "equal",
          value: "exited",
          params: {
            containerName: "my-critical-app"
          }
        }
      ]
    },
    event: {
      type: "restart-container",
      params: {
        containerId: "container-abc-123"
      }
    }
  }
};

const response = await fetch('/api/v1/automations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(automationRule)
});

if (response.ok) {
  const created = await response.json();
  console.log('Automation rule created:', created.id);
} else {
  const error = await response.json();
  console.error('Failed to create rule:', error.error.message);
}
```
